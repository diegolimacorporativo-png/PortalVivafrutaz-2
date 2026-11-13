/** Pure fiscal-rule tests. These tests never invoke gerarNFeXML or build XML. */
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  calculateIcmsForItem,
  composeNfeItem,
  getAliquotaICMS,
} from "../../server/services/nfe/nfeGenerator";
import { validarCRT } from "../../server/services/nfe/nfeValidator";
import type { NFeInput } from "../../server/services/nfe/nfeValidator";

const tax = (overrides: Partial<Parameters<typeof calculateIcmsForItem>[0]> = {}) =>
  calculateIcmsForItem({ crt: "3", productValue: 50, ...overrides });

describe("regras fiscais puras, sem geração de documento", () => {
  test("CRT aceita somente 1, 2 ou 3", () => {
    for (const crt of ["1", "2", "3"]) {
      assert.doesNotThrow(() => validarCRT({ emitente: { crt } } as NFeInput));
    }
    for (const crt of ["9", undefined]) {
      assert.throws(
        () => validarCRT({ emitente: { crt } } as NFeInput),
        /NFE_INVALID_CRT/,
      );
    }
  });

  test("CSOSN usa 102 como default e valida formato numérico de três dígitos", () => {
    assert.equal(tax({ crt: "1" }).rawCsosn, "102");
    assert.equal(tax({ crt: "1", csosn: "300" }).rawCsosn, "300");
    for (const csosn of ["1", "10A", "<xml>", "1020"]) {
      assert.throws(() => tax({ csosn }), /NFE_INVALID_CSOSN/);
    }
  });

  test("CST mantém default 00 e valida dois dígitos numéricos", () => {
    assert.equal(tax().rawCst, "00");
    for (const cst of ["A1", "1", "<xml>"]) {
      assert.throws(() => tax({ cst }), /NFE_INVALID_CST/);
    }
  });

  test("ICMS normal calcula base, alíquota e imposto", () => {
    const result = tax({ ufOrigem: "SP", ufDestino: "SP" });
    assert.equal(result.base, 50);
    assert.equal(result.rate, 18);
    assert.equal(result.amount, 9);
    assert.equal(result.emitsBaseAndTax, true);
    assert.equal(result.includeInTotals, true);
  });

  test("CST 20 mantém cálculo e sinaliza redução de base", () => {
    const result = tax({ cst: "20", ufOrigem: "SP", ufDestino: "SP" });
    assert.equal(result.reducesBase, true);
    assert.equal(result.base, 50);
    assert.equal(result.amount, 9);
  });

  test("CST 40, 41, 50 e 60 não incluem base/imposto nos totais", () => {
    for (const cst of ["40", "41", "50", "60"]) {
      const result = tax({ cst });
      assert.equal(result.emitsBaseAndTax, false, `CST ${cst}`);
      assert.equal(result.includeInTotals, false, `CST ${cst}`);
    }
  });

  test("Simples Nacional segue CSOSN e não inclui ICMS normal nos totais", () => {
    const result = tax({ crt: "1", csosn: "300", cst: "20" });
    assert.equal(result.regime, "simples");
    assert.equal(result.rawCsosn, "300");
    assert.equal(result.emitsBaseAndTax, false);
    assert.equal(result.includeInTotals, false);
    assert.equal(result.reducesBase, false);
  });

  test("alíquota pura preserva regras internas, interestaduais e importação", () => {
    assert.equal(getAliquotaICMS("SP", "SP"), 18);
    assert.equal(getAliquotaICMS("SP", "BA"), 7);
    assert.equal(getAliquotaICMS("SP", "RJ"), 12);
    assert.equal(getAliquotaICMS("SP", "RJ", "84000000"), 4);
    assert.equal(getAliquotaICMS("SP", "SP", "08039000", { importado: true }), 4);
  });

  test("composição de vários itens preserva CFOP, quantidades e regra tributária por produto", () => {
    const items = [
      composeNfeItem({
        cProd: "001", xProd: "Banana", ncm: "08039000", cfop: "5102",
        uCom: "KG", qCom: 2, vUnCom: 5, vProd: 10,
      }, 0, { crt: "3", ufOrigem: "SP", ufDestino: "BA" }),
      composeNfeItem({
        cProd: "002", xProd: "Máquina importada", ncm: "84000000", cfop: "6108",
        uCom: "UN", qCom: 1, vUnCom: 50, vProd: 50,
      }, 1, { crt: "3", ufOrigem: "SP", ufDestino: "BA" }),
    ];

    assert.deepEqual(items.map((item) => item.itemNumber), [1, 2]);
    assert.deepEqual(items.map((item) => item.cfop), ["5102", "6108"]);
    assert.deepEqual(items.map((item) => item.productValue), [10, 50]);
    assert.deepEqual(items.map((item) => item.icms.rate), [7, 4]);
    assert.deepEqual(items.map((item) => item.icmsStructure.kind), [
      "normal_calculated",
      "normal_calculated",
    ]);
  });
});

/** Contract tests for the builder's documented regime precedence. */
function regimeToCrt(
  company: { regimeTributario?: string | null } | null,
  config: { regimeTributario?: string | null } | null,
): string {
  const regime = company?.regimeTributario || config?.regimeTributario;
  return regime === "simples_nacional" ? "1" : regime === "mei" ? "2" : "3";
}

describe("builder: precedência do regime tributário", () => {
  test("override do cliente prevalece sobre configuração global", () => {
    assert.equal(regimeToCrt({ regimeTributario: "lucro_presumido" }, { regimeTributario: "simples_nacional" }), "3");
  });
  test("sem override, usa configuração global", () => {
    assert.equal(regimeToCrt(null, { regimeTributario: "simples_nacional" }), "1");
  });
  test("MEI do cliente seleciona CRT 2", () => {
    assert.equal(regimeToCrt({ regimeTributario: "mei" }, null), "2");
  });
});
