import assert from "node:assert/strict";
import { test } from "node:test";
import { productionErrorMessage } from "../../client/src/pages/admin/production-error-message";

test("extracts the message from the API's nested error envelope", () => {
  assert.equal(productionErrorMessage({ success: false, error: { message: "Prévia desatualizada", code: "CONFLICT" } }, "fallback"), "Prévia desatualizada");
});

test("supports legacy string and top-level message errors", () => {
  assert.equal(productionErrorMessage({ error: "Falha" }, "fallback"), "Falha");
  assert.equal(productionErrorMessage({ message: "Não autorizado" }, "fallback"), "Não autorizado");
});

test("does not expose object coercion for malformed error payloads", () => {
  assert.equal(productionErrorMessage({ error: { code: "INTERNAL_ERROR" } }, "Erro ao gerar lote (HTTP 500)"), "Erro ao gerar lote (HTTP 500)");
  assert.equal(productionErrorMessage(null, "fallback"), "fallback");
});
