/**
 * FASE NF.5.2 — testes unitários para validarCRT e validarNFeInput.
 *
 * Cobre o fail-fast adicionado na FASE NF.5.1 ETAPA 5: o generator antes
 * mascarava CRT ausente/inválido com `|| '1'`, escolhendo Simples Nacional
 * por engano. Aqui garantimos que apenas '1', '2' ou '3' são aceitos.
 *
 * Run with: npx tsx --test tests/unit/nfeValidator.test.ts
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  validarCRT,
  validarNFeInput,
  type NFeInput,
} from "../../server/services/nfe/nfeValidator";

function baseInput(crt: any): NFeInput {
  return {
    emitente: {
      cnpj: "11222333000181",
      xNome: "Empresa Teste LTDA",
      ie: "123456789",
      crt,
      logradouro: "Rua Teste",
      numero: "100",
      bairro: "Centro",
      cMun: "3550308",
      xMun: "São Paulo",
      uf: "SP",
      cep: "01001000",
    },
    destinatario: {
      cnpj: "11444777000161",
      xNome: "Cliente Teste",
      logradouro: "Av Cliente",
      cMun: "3550308",
      xMun: "São Paulo",
      uf: "SP",
      cep: "01310100",
    },
    produtos: [
      {
        cProd: "000001",
        xProd: "Banana Prata",
        ncm: "08039000",
        cfop: "5102",
        uCom: "KG",
        qCom: 10,
        vUnCom: 5,
        vProd: 50,
      },
    ],
  };
}

describe("validarCRT", () => {
  test("aceita CRT '1' (Simples Nacional)", () => {
    assert.doesNotThrow(() => validarCRT(baseInput("1")));
  });

  test("aceita CRT '2' (MEI)", () => {
    assert.doesNotThrow(() => validarCRT(baseInput("2")));
  });

  test("aceita CRT '3' (Lucro Presumido/Real)", () => {
    assert.doesNotThrow(() => validarCRT(baseInput("3")));
  });

  test("rejeita CRT undefined com NFE_INVALID_CRT", () => {
    assert.throws(
      () => validarCRT(baseInput(undefined)),
      /NFE_INVALID_CRT/,
    );
  });

  test("rejeita CRT '0' com NFE_INVALID_CRT", () => {
    assert.throws(
      () => validarCRT(baseInput("0")),
      /NFE_INVALID_CRT/,
    );
  });

  test("rejeita CRT 'abc' com NFE_INVALID_CRT", () => {
    assert.throws(
      () => validarCRT(baseInput("abc")),
      /NFE_INVALID_CRT/,
    );
  });

  test("rejeita CRT vazio com NFE_INVALID_CRT", () => {
    assert.throws(() => validarCRT(baseInput("")), /NFE_INVALID_CRT/);
  });

  test("rejeita CRT numérico (não-string) com NFE_INVALID_CRT", () => {
    // includes() trata número e string como diferentes
    assert.throws(() => validarCRT(baseInput(1 as any)), /NFE_INVALID_CRT/);
  });
});

describe("validarNFeInput (smoke — sem regressão)", () => {
  test("input válido não retorna erros", () => {
    const erros = validarNFeInput(baseInput("1"));
    assert.equal(erros.length, 0);
  });

  test("CNPJ emitente inválido é capturado", () => {
    const input = baseInput("1");
    input.emitente.cnpj = "00000000000000";
    const erros = validarNFeInput(input);
    assert.ok(erros.some((e) => e.campo === "emitente.cnpj"));
  });
});
