import assert from "node:assert/strict";
import test from "node:test";
import { validateIsolatedPreviewDatabaseUrl } from "../../server/core/runtimeMode";

const localPreviewUrl =
  "postgresql://preview@127.0.0.1:55439/vivafrutaz_preview";

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
