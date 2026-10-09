import assert from "node:assert/strict";
import test from "node:test";
import {
  assertIsolatedPreviewDatabaseIdentity,
  validateIsolatedPreviewDatabaseUrl,
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
