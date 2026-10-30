import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { assertFiscalBootSafe } from "../../server/core/fiscal/homologation.guard";
import {
  assertRemoteHomologationDatabaseIsEmpty,
  getRuntimeDatabaseUrl,
  validateRemoteHomologationApiUrl,
  validateRemoteHomologationConfig,
  verifyRemoteHomologationDatabaseIdentity,
  type ReadOnlyQuery,
} from "../../server/core/runtimeMode";

const projectRef = "abcdefghijklmnopqrst";
const markerId = "123e4567-e89b-42d3-a456-426614174000";
const dataDirectory = path.join(os.tmpdir(), "vivafrutaz-remote-homologation-test");
const validEnv: NodeJS.ProcessEnv = {
  NODE_ENV: "test",
  ISOLATED_REMOTE_HOMOLOGATION_MODE: "1",
  ISOLATED_REMOTE_HOMOLOGATION_DATABASE_URL:
    `postgresql://postgres.${projectRef}:x@aws-0-us-east-1.pooler.supabase.com:6543/postgres`,
  ISOLATED_REMOTE_HOMOLOGATION_PROJECT_REF: projectRef,
  ISOLATED_REMOTE_HOMOLOGATION_ENVIRONMENT: "homologation",
  ISOLATED_REMOTE_HOMOLOGATION_SCHEMA: "public",
  ISOLATED_REMOTE_HOMOLOGATION_MARKER_ID: markerId,
  ISOLATED_REMOTE_HOMOLOGATION_DATA_DIR: dataDirectory,
};

function markerRow(overrides: Record<string, unknown> = {}) {
  return {
    application: "PortalVivafrutaz-2",
    project_ref: projectRef,
    environment: "homologation",
    schema_name: "public",
    marker_id: markerId,
    data_classification: "synthetic_only",
    write_enabled: true,
    ...overrides,
  };
}

test("remote homologation accepts only an explicit non-primary Supabase target", () => {
  const config = validateRemoteHomologationConfig(validEnv);
  assert.equal(config.projectRef, projectRef);
  assert.equal(config.environment, "homologation");
  assert.equal(config.schema, "public");
  assert.equal(config.databaseName, "postgres");
  assert.equal(config.dataDirectory, dataDirectory);
  assert.equal(config.databaseUrl, validEnv.ISOLATED_REMOTE_HOMOLOGATION_DATABASE_URL);
});

test("remote homologation rejects unsafe mode, fallback, primary project, and mismatched target", () => {
  const invalidEnvironments = [
    { ...validEnv, NODE_ENV: "production" },
    { ...validEnv, ISOLATED_PREVIEW_MODE: "1" },
    { ...validEnv, DATABASE_URL: "postgresql://fallback.invalid/postgres" },
    { ...validEnv, SUPABASE_DATABASE_URL: "postgresql://fallback.invalid/postgres" },
    { ...validEnv, ISOLATED_REMOTE_HOMOLOGATION_PROJECT_REF: "kqvutmzqwgrcntpivnhy" },
    {
      ...validEnv,
      ISOLATED_REMOTE_HOMOLOGATION_DATABASE_URL:
        "postgresql://postgres.abcdefghijklmnopqrst:x@aws-0-us-east-1.pooler.supabase.com:6543/postgres",
      ISOLATED_REMOTE_HOMOLOGATION_PROJECT_REF: "zyxwvutsrqponmlkjihgf",
    },
    { ...validEnv, ISOLATED_REMOTE_HOMOLOGATION_ENVIRONMENT: "production" },
    { ...validEnv, ISOLATED_REMOTE_HOMOLOGATION_SCHEMA: "tenant_data" },
    { ...validEnv, ISOLATED_REMOTE_HOMOLOGATION_MARKER_ID: undefined },
    { ...validEnv, ISOLATED_REMOTE_HOMOLOGATION_DATA_DIR: path.join(os.tmpdir(), "..", "outside") },
    {
      ...validEnv,
      ISOLATED_REMOTE_HOMOLOGATION_DATABASE_URL:
        "postgresql://postgres.kqvutmzqwgrcntpivnhy:x@aws-0-us-east-1.pooler.supabase.com:6543/postgres",
      ISOLATED_REMOTE_HOMOLOGATION_PROJECT_REF: "kqvutmzqwgrcntpivnhy",
    },
  ];
  for (const env of invalidEnvironments) {
    assert.throws(() => validateRemoteHomologationConfig(env));
  }
});

test("runtime selects only the dedicated remote URL and fails closed without explicit mode", () => {
  const names = [
    ...Object.keys(validEnv),
    "DATABASE_URL",
    "SUPABASE_DATABASE_URL",
  ];
  const previous = new Map(names.map((name) => [name, process.env[name]]));
  try {
    for (const name of names) delete process.env[name];
    Object.assign(process.env, validEnv);
    assert.equal(getRuntimeDatabaseUrl(), validEnv.ISOLATED_REMOTE_HOMOLOGATION_DATABASE_URL);

    process.env.ISOLATED_REMOTE_HOMOLOGATION_MODE = "0";
    process.env.DATABASE_URL = "postgresql://fallback.invalid/postgres";
    assert.throws(() => getRuntimeDatabaseUrl(), /fallback bloqueado/);
  } finally {
    for (const [name, value] of previous) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});

test("remote API accepts only local HTTP endpoints", () => {
  assert.equal(validateRemoteHomologationApiUrl("http://127.0.0.1:5000").port, "5000");
  assert.equal(validateRemoteHomologationApiUrl("http://localhost:5000/").hostname, "localhost");
  for (const url of [
    undefined,
    "https://127.0.0.1:5000",
    "http://example.invalid",
    "http://127.0.0.1:5000/path",
    "http://user:password@127.0.0.1:5000",
  ]) {
    assert.throws(() => validateRemoteHomologationApiUrl(url));
  }
});

test("remote identity requires matching live SQL identity and the exact synthetic-only marker", async () => {
  const config = validateRemoteHomologationConfig(validEnv);
  const rows = [
    [{ database: "postgres", schema: "public" }],
    [markerRow()],
  ];
  const statements: string[] = [];
  const query: ReadOnlyQuery = async (statement) => {
    statements.push(statement);
    return { rows: rows.shift() ?? [] };
  };

  const identity = await verifyRemoteHomologationDatabaseIdentity(query, config);
  assert.deepEqual(identity, {
    projectRef,
    environment: "homologation",
    database: "postgres",
    schema: "public",
    markerId,
  });
  assert.equal(statements.length, 2);
  assert.ok(statements.every((statement) => /^\s*SELECT\b/i.test(statement)));
});

test("remote identity fails closed when SQL or marker differs", async () => {
  const config = validateRemoteHomologationConfig(validEnv);
  const mismatches = [
    [{ database: "postgres", schema: "other" }],
    [{ database: "another_db", schema: "public" }],
  ];
  for (const databaseRows of mismatches) {
    await assert.rejects(
      () => verifyRemoteHomologationDatabaseIdentity(async () => ({ rows: databaseRows }), config),
    );
  }

  const badMarkers = [
    markerRow({ project_ref: "zyxwvutsrqponmlkjihgf" }),
    markerRow({ marker_id: "00000000-0000-4000-8000-000000000000" }),
    markerRow({ data_classification: "production_copy" }),
    markerRow({ write_enabled: false }),
  ];
  for (const badMarker of badMarkers) {
    const resultSets = [[{ database: "postgres", schema: "public" }], [badMarker]];
    await assert.rejects(
      () => verifyRemoteHomologationDatabaseIdentity(async () => ({ rows: resultSets.shift() ?? [] }), config),
    );
  }
});

test("remote preflight requires the core schema and empty synthetic target tables", async () => {
  const tableNames = [
    "companies", "users", "products", "orders", "order_items", "deliveries",
    "workflow_events", "nf_drafts", "company_config", "inventory_settings",
    "system_logs", "audit_logs", "auth_attempts",
    "production_batches", "production_batch_items", "fiscal_invoices", "nfe_emissoes",
    "nfe_cce", "nfe_cce_audit_logs", "nf_manual", "nfe_training_logs",
    "danfe_records", "fiscal_closures",
  ];
  let count = 0;
  const cleanQuery: ReadOnlyQuery = async (statement) => {
    if (statement.includes("information_schema.tables")) {
      return { rows: tableNames.map((table_name) => ({ table_name })) };
    }
    count += 1;
    return { rows: [{ count: 0 }] };
  };
  await assertRemoteHomologationDatabaseIsEmpty(cleanQuery);
  assert.equal(count, tableNames.length);

  await assert.rejects(() => assertRemoteHomologationDatabaseIsEmpty(async (statement) => {
    if (statement.includes("information_schema.tables")) {
      return { rows: tableNames.map((table_name) => ({ table_name })) };
    }
    return { rows: [{ count: statement.includes('"companies"') ? 1 : 0 }] };
  }));
});

test("isolated runtime refuses live fiscal homologation and production modes", () => {
  const previous = {
    remote: process.env.ISOLATED_REMOTE_HOMOLOGATION_MODE,
    preview: process.env.ISOLATED_PREVIEW_MODE,
    nodeEnv: process.env.NODE_ENV,
    fiscalMode: process.env.NFE_SEFAZ_MODE,
  };
  try {
    process.env.ISOLATED_REMOTE_HOMOLOGATION_MODE = "1";
    process.env.ISOLATED_PREVIEW_MODE = "0";
    process.env.NODE_ENV = "development";
    for (const mode of ["homologacao", "production"]) {
      process.env.NFE_SEFAZ_MODE = mode;
      assert.throws(() => assertFiscalBootSafe(), /Runtime isolado exige NFE_SEFAZ_MODE=mock/);
    }
    process.env.NFE_SEFAZ_MODE = "mock";
    assert.doesNotThrow(() => assertFiscalBootSafe());
  } finally {
    if (previous.remote === undefined) delete process.env.ISOLATED_REMOTE_HOMOLOGATION_MODE;
    else process.env.ISOLATED_REMOTE_HOMOLOGATION_MODE = previous.remote;
    if (previous.preview === undefined) delete process.env.ISOLATED_PREVIEW_MODE;
    else process.env.ISOLATED_PREVIEW_MODE = previous.preview;
    if (previous.nodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previous.nodeEnv;
    if (previous.fiscalMode === undefined) delete process.env.NFE_SEFAZ_MODE;
    else process.env.NFE_SEFAZ_MODE = previous.fiscalMode;
  }
});
