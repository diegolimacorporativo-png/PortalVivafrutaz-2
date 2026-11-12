import assert from "node:assert/strict";
import { mkdir, realpath, rename, rm, symlink, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  assertIsolatedPreviewDatabaseIdentity,
  validateIsolatedPreviewApiUrl,
  validateIsolatedPreviewDatabaseUrl,
  verifyIsolatedPreviewDatabase,
} from "../../server/core/runtimeMode";

const localPreviewUrl =
  "postgresql://preview@127.0.0.1:55439/vivafrutaz_preview";
const dataDirectory =
  "/tmp/vivafrutaz-isolated-preview.test/postgres";
const validIdentity = {
  database: "vivafrutaz_preview",
  username: "preview",
  address: "127.0.0.1/32",
  port: 55439,
  dataDirectory,
};

test("preview isolado aceita apenas o PostgreSQL local dedicado em development", () => {
  assert.equal(
    validateIsolatedPreviewDatabaseUrl(localPreviewUrl, "development"),
    localPreviewUrl,
  );
});

test("preview isolado falha fechado fora de development", () => {
  for (const nodeEnv of ["production", "test", undefined]) {
    assert.throws(
      () => validateIsolatedPreviewDatabaseUrl(localPreviewUrl, nodeEnv),
      /só é permitido com NODE_ENV=development/,
    );
  }
});

test("preview isolado não aceita URL ausente, externa ou com alvo diferente", () => {
  for (const url of [
    undefined,
    "postgresql://preview@db.example.com:55439/vivafrutaz_preview",
    "postgresql://preview@127.0.0.1:5432/production",
    "postgresql://preview:password@127.0.0.1:55439/vivafrutaz_preview",
    "postgresql://preview@127.0.0.1:55439/vivafrutaz_preview?sslmode=require",
  ]) {
    assert.throws(
      () => validateIsolatedPreviewDatabaseUrl(url, "development"),
      /ISOLATED_PREVIEW_DATABASE_URL|aceita somente/,
    );
  }
});

test("API local do preview aceita somente loopback HTTP nas portas isoladas", () => {
  for (const url of [
    "http://127.0.0.1:5000/",
    "http://127.0.0.1:5001/",
  ]) {
    assert.equal(validateIsolatedPreviewApiUrl(url).toString(), url);
  }

  for (const url of [
    undefined,
    "https://127.0.0.1:5000/",
    "http://localhost:5000/",
    "http://127.0.0.2:5000/",
    "http://192.168.1.10:5000/",
    "http://127.0.0.1:5432/",
    "http://127.0.0.1:55439/",
    "http://127.0.0.1:5002/",
    "http://user:pass@127.0.0.1:5000/",
    "http://127.0.0.1:5000/api/health",
    "http://127.0.0.1:5000/?target=external",
  ]) {
    assert.throws(() => validateIsolatedPreviewApiUrl(url));
  }
});

test("identidade aceita somente o servidor temporário local confirmado", () => {
  assert.doesNotThrow(() =>
    assertIsolatedPreviewDatabaseIdentity(validIdentity, dataDirectory),
  );
  assert.doesNotThrow(() =>
    assertIsolatedPreviewDatabaseIdentity(
      { ...validIdentity, address: "127.0.0.1" },
      dataDirectory,
    ),
  );
});

test("identidade do PostgreSQL falha fechado em qualquer desvio", () => {
  const mismatches = [
    { database: "production" },
    { username: "postgres" },
    { address: "127.0.0.1/24" },
    { address: "203.0.113.10" },
    { port: 5432 },
    { dataDirectory: "/tmp/other-postgres/postgres" },
  ];

  for (const mismatch of mismatches) {
    assert.throws(
      () =>
        assertIsolatedPreviewDatabaseIdentity(
          { ...validIdentity, ...mismatch },
          dataDirectory,
        ),
      /identidade do servidor PostgreSQL não corresponde ao banco temporário descartável/,
    );
  }
});

test("verificação completa exige raiz temporária nonce, marcador regular e identidade correspondente", async (t) => {
  const root = path.join(os.tmpdir(), `vivafrutaz-isolated-preview.${randomUUID().replace(/-/g, "")}`);
  await mkdir(root);
  const nonce = path.basename(root).slice("vivafrutaz-isolated-preview.".length);
  const dataDirectory = path.join(root, "postgres");
  await mkdir(dataDirectory);
  await writeFile(path.join(root, ".isolated-preview-marker"), `vivafrutaz-isolated-preview-v1:${nonce}\n`);
  t.after(async () => rm(root, { recursive: true, force: true }));

  const result = await verifyIsolatedPreviewDatabase(async () => ({
    rows: [{
      database: "vivafrutaz_preview",
      username: "preview",
      address: "127.0.0.1/32",
      port: 55439,
      data_directory: dataDirectory,
    }],
  }), root);

  assert.equal(result.dataRoot, await realpath(root));
  assert.equal(result.isolationId, nonce);
});

test("verificação local rejeita junction/symlink antes de consultar o pool", async (t) => {
  const root = path.join(os.tmpdir(), `vivafrutaz-isolated-preview.${randomUUID().replace(/-/g, "")}`);
  const outside = path.join(os.tmpdir(), `vivafrutaz-external.${randomUUID().replace(/-/g, "")}`);
  await mkdir(root);
  await mkdir(outside);
  t.after(async () => {
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  });
  const nonce = path.basename(root).slice("vivafrutaz-isolated-preview.".length);
  await writeFile(path.join(root, ".isolated-preview-marker"), `vivafrutaz-isolated-preview-v1:${nonce}\n`);
  const externalData = path.join(outside, "postgres");
  await mkdir(externalData);
  try {
    await symlink(externalData, path.join(root, "postgres"), process.platform === "win32" ? "junction" : "dir");
  } catch (error) {
    t.skip(`O sistema não permite criar junction/symlink para o teste: ${error instanceof Error ? error.message : String(error)}`);
    return;
  }

  let queryCalled = false;
  await assert.rejects(
    verifyIsolatedPreviewDatabase(async () => {
      queryCalled = true;
      return { rows: [] };
    }, root),
    /diretório regular, sem symlink ou junction/,
  );
  assert.equal(queryCalled, false, "a identidade do banco não deve ser consultada após caminho não confiável");
});

test("marcador ausente ou incorreto bloqueia antes de qualquer consulta", async (t) => {
  const root = path.join(os.tmpdir(), `vivafrutaz-isolated-preview.${randomUUID().replace(/-/g, "")}`);
  await mkdir(root);
  const dataDirectory = path.join(root, "postgres");
  await mkdir(dataDirectory);
  t.after(async () => rm(root, { recursive: true, force: true }));

  let queryCalled = false;
  await assert.rejects(
    verifyIsolatedPreviewDatabase(async () => {
      queryCalled = true;
      return { rows: [] };
    }, root),
  );
  assert.equal(queryCalled, false);
});

test("substituição do marcador durante a consulta é detectada antes de liberar o ambiente", async (t) => {
  const root = path.join(os.tmpdir(), `vivafrutaz-isolated-preview.${randomUUID().replace(/-/g, "")}`);
  await mkdir(root);
  const nonce = path.basename(root).slice("vivafrutaz-isolated-preview.".length);
  const dataDirectory = path.join(root, "postgres");
  const markerPath = path.join(root, ".isolated-preview-marker");
  await mkdir(dataDirectory);
  const markerContents = `vivafrutaz-isolated-preview-v1:${nonce}\n`;
  await writeFile(markerPath, markerContents);
  t.after(async () => rm(root, { recursive: true, force: true }));

  await assert.rejects(
    verifyIsolatedPreviewDatabase(async () => {
      await rename(markerPath, `${markerPath}.original`);
      await writeFile(markerPath, markerContents);
      return {
        rows: [{
          database: "vivafrutaz_preview",
          username: "preview",
          address: "127.0.0.1/32",
          port: 55439,
          data_directory: dataDirectory,
        }],
      };
    }, root),
    /identidade do diretório ou marcador mudou durante a verificação/,
  );
});
