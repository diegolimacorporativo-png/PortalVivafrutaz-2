import { execFileSync } from "node:child_process";
import { readFile, realpath } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Pool } from "pg";
import {
  assertIsolatedPreviewDatabaseIdentity,
  validateIsolatedPreviewDatabaseUrl,
} from "../server/core/runtimeMode";

const ISOLATED_ROOT_PREFIX = "vivafrutaz-isolated-preview.";
const ISOLATED_MARKER_PREFIX = "vivafrutaz-isolated-preview-v1:";

async function main(): Promise<void> {
  if (process.env.ISOLATED_PREVIEW_MODE !== "1") {
    throw new Error("A preparação do schema exige ISOLATED_PREVIEW_MODE=1.");
  }

  const databaseUrl = validateIsolatedPreviewDatabaseUrl(
    process.env.ISOLATED_PREVIEW_DATABASE_URL,
    process.env.NODE_ENV,
  );
  const configuredDataRoot = process.env.ISOLATED_PREVIEW_DATA_DIR;
  if (!configuredDataRoot) {
    throw new Error("ISOLATED_PREVIEW_DATA_DIR é obrigatório.");
  }

  const tempDirectory = await realpath(os.tmpdir());
  const dataRoot = await realpath(configuredDataRoot);
  const relativeToTemp = path.relative(tempDirectory, dataRoot);
  const rootName = path.basename(dataRoot);
  const nonce = rootName.startsWith(ISOLATED_ROOT_PREFIX)
    ? rootName.slice(ISOLATED_ROOT_PREFIX.length)
    : "";

  if (
    !relativeToTemp ||
    relativeToTemp === ".." ||
    relativeToTemp.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relativeToTemp) ||
    !/^[a-zA-Z0-9]+$/.test(nonce)
  ) {
    throw new Error("O diretório do PostgreSQL não é o temporário dedicado.");
  }

  const marker = await readFile(
    path.join(dataRoot, ".isolated-preview-marker"),
    "utf8",
  );
  if (marker !== `${ISOLATED_MARKER_PREFIX}${nonce}\n`) {
    throw new Error("O marcador do banco temporário está ausente ou inválido.");
  }

  const expectedDataDirectory = await realpath(
    path.join(dataRoot, "postgres"),
  );
  const pool = new Pool({
    connectionString: databaseUrl,
    ssl: false,
    max: 1,
    connectionTimeoutMillis: 5_000,
  });

  try {
    const identityResult = await pool.query<{
      database: string;
      username: string;
      address: string;
      port: number;
      data_directory: string;
      application_tables: number;
    }>(`
      SELECT
        current_database() AS database,
        current_user AS username,
        inet_server_addr()::text AS address,
        inet_server_port() AS port,
        current_setting('data_directory') AS data_directory,
        (
          SELECT count(*)::int
          FROM pg_catalog.pg_tables
          WHERE schemaname NOT IN ('pg_catalog', 'information_schema')
        ) AS application_tables
    `);
    const identity = identityResult.rows[0];

    assertIsolatedPreviewDatabaseIdentity(
      {
        database: identity.database,
        username: identity.username,
        address: identity.address,
        port: identity.port,
        dataDirectory: identity.data_directory,
      },
      expectedDataDirectory,
    );
    if (identity.application_tables !== 0) {
      throw new Error(
        "O banco descartável não está vazio; schema não será aplicado.",
      );
    }

    console.info("[ISOLATED_PREVIEW_DB_IDENTITY_VERIFIED]", {
      database: identity.database,
      username: identity.username,
      address: identity.address,
      port: identity.port,
      dataDirectory: identity.data_directory,
      applicationTablesBeforeSchema: identity.application_tables,
    });

    const rootDirectory = process.cwd();
    const drizzleEnvironment: NodeJS.ProcessEnv = {
      PATH: process.env.PATH ?? "/usr/bin:/bin",
      HOME: process.env.HOME ?? "/tmp",
      LC_ALL: "C",
      NODE_ENV: "development",
      DOTENV_CONFIG_PATH: "/dev/null",
      // Drizzle receives only the verified loopback URL, never an inherited
      // shared Supabase/Render connection string.
      SUPABASE_DATABASE_URL: databaseUrl,
    };

    execFileSync(
      path.join(rootDirectory, "node_modules/.bin/drizzle-kit"),
      [
        "push",
        "--dialect=postgresql",
        "--schema=./shared/schema.ts",
        `--url=${databaseUrl}`,
      ],
      {
        cwd: rootDirectory,
        env: drizzleEnvironment,
        stdio: "inherit",
      },
    );

    const postPushResult = await pool.query<{
      database: string;
      username: string;
      address: string;
      port: number;
      data_directory: string;
    }>(`
      SELECT
        current_database() AS database,
        current_user AS username,
        inet_server_addr()::text AS address,
        inet_server_port() AS port,
        current_setting('data_directory') AS data_directory
    `);
    const postPushIdentity = postPushResult.rows[0];
    assertIsolatedPreviewDatabaseIdentity(
      {
        database: postPushIdentity.database,
        username: postPushIdentity.username,
        address: postPushIdentity.address,
        port: postPushIdentity.port,
        dataDirectory: postPushIdentity.data_directory,
      },
      expectedDataDirectory,
    );

    // The normal PgSessionStore may create this table in non-isolated
    // environments. Isolated mode disables that behavior, so create the
    // default connect-pg-simple table only after re-verifying the DB.
    await pool.query(`
      CREATE TABLE "session" (
        "sid" varchar NOT NULL COLLATE "default",
        "sess" json NOT NULL,
        "expire" timestamp(6) NOT NULL,
        CONSTRAINT "session_pkey" PRIMARY KEY ("sid")
      )
    `);
    await pool.query(
      'CREATE INDEX "IDX_session_expire" ON "session" ("expire")',
    );

    console.info(
      "[ISOLATED_PREVIEW_SCHEMA_READY] Current app schema and session table prepared; seeds and workers remain disabled.",
    );
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error("[ISOLATED_PREVIEW_SCHEMA_BLOCKED]", message);
  process.exitCode = 1;
});
