/**
 * FASE NF.5.2 — testes unitários para translateNFeError.
 *
 * Cobre as mensagens amigáveis adicionadas na FASE NF.5.1 ETAPA 6, mais
 * o fallback genérico para códigos desconhecidos.
 *
 * Run with: npx tsx --test tests/unit/nfeErrorParser.test.ts
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { translateNFeError } from "../../server/services/nfe/diagnostics/nfe-error-parser";

describe("translateNFeError — códigos NF.5.1", () => {
  test("NFE_INVALID_CRT devolve mensagem amigável", () => {
    const out = translateNFeError(new Error("NFE_INVALID_CRT"));
    assert.equal(out.code, "NFE_INVALID_CRT");
    assert.equal(
      out.message,
      "Regime tributário inválido. Verifique a configuração da empresa.",
    );
  });

  test("NFE_INVALID_CSOSN devolve mensagem amigável", () => {
    const out = translateNFeError(new Error("NFE_INVALID_CSOSN"));
    assert.equal(out.code, "NFE_INVALID_CSOSN");
    assert.equal(
      out.message,
      "CSOSN inválido. Verifique a tributação do produto.",
    );
  });

  test("NFE_INVALID_CST devolve mensagem amigável (FASE NF.6)", () => {
    const out = translateNFeError(new Error("NFE_INVALID_CST"));
    assert.equal(out.code, "NFE_INVALID_CST");
    assert.equal(
      out.message,
      "CST inválido. Verifique a tributação do produto.",
    );
  });

  test("aceita string crua além de Error", () => {
    const out = translateNFeError("NFE_INVALID_CSOSN");
    assert.equal(out.code, "NFE_INVALID_CSOSN");
  });

  test("aceita objeto com .code", () => {
    const out = translateNFeError({ code: "NFE_INVALID_CRT" });
    assert.equal(out.code, "NFE_INVALID_CRT");
  });

  test("extrai código NFE_* mesmo quando vier prefixado", () => {
    const out = translateNFeError(new Error("Erro: NFE_INVALID_CRT no item"));
    assert.equal(out.code, "NFE_INVALID_CRT");
  });
});

describe("translateNFeError — códigos legados (sem regressão)", () => {
  test("NFE_MISSING_NCM continua mapeado", () => {
    const out = translateNFeError(new Error("NFE_MISSING_NCM"));
    assert.equal(out.code, "NFE_MISSING_NCM");
    assert.match(out.message, /NCM/);
  });

  test("NFE_XML_NO_ITEMS continua mapeado", () => {
    const out = translateNFeError(new Error("NFE_XML_NO_ITEMS"));
    assert.equal(out.code, "NFE_XML_NO_ITEMS");
  });
});

describe("translateNFeError — fallback", () => {
  test("código desconhecido devolve NFE_UNKNOWN_ERROR + mensagem genérica", () => {
    const out = translateNFeError(new Error("ALGO_NUNCA_VISTO"));
    assert.equal(out.code, "NFE_UNKNOWN_ERROR");
    assert.match(out.message, /Erro ao gerar nota fiscal/i);
  });

  test("entrada vazia devolve fallback genérico sem lançar", () => {
    const out = translateNFeError(undefined);
    assert.equal(out.code, "NFE_UNKNOWN_ERROR");
    assert.equal(typeof out.message, "string");
  });
});
