/**
 * Pure ICMS-structure contract tests. No test invokes gerarNFeXML or constructs
 * a fiscal XML document while issuance remains paused.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { buildIcmsItemStructure, calculateIcmsForItem } from "../../server/services/nfe/nfeGenerator";

const calculate = (crt: string, cst?: string, csosn?: string) =>
  calculateIcmsForItem({ crt, cst, csosn, productValue: 50, ufOrigem: "SP", ufDestino: "SP" });

test("CST 00 e default declaram estrutura completa sem compor XML", () => {
  for (const cst of [undefined, "00"]) {
    const result = calculate("3", cst);
    assert.equal(result.rawCst, "00");
    assert.equal(result.emitsBaseAndTax, true);
    assert.equal(result.reducesBase, false);
    assert.equal(result.rate, 18);
    assert.equal(result.amount, 9);
    assert.deepEqual(buildIcmsItemStructure(result), {
      kind: "normal_calculated",
      taxCode: "00",
      baseMode: "3",
      base: 50,
      reductionRate: null,
      rate: 18,
      amount: 9,
    });
  }
});

test("CST 20 sinaliza estrutura com redução e mantém o cálculo vigente", () => {
  const result = calculate("3", "20");
  assert.equal(result.reducesBase, true);
  assert.equal(result.emitsBaseAndTax, true);
  assert.equal(result.amount, 9);
  assert.deepEqual(buildIcmsItemStructure(result), {
    kind: "normal_calculated",
    taxCode: "20",
    baseMode: "3",
    base: 50,
    reductionRate: 0,
    rate: 18,
    amount: 9,
  });
});

test("CST 40, 41 e 50 usam forma isenta sem campos de base/imposto", () => {
  for (const cst of ["40", "41", "50"]) {
    const result = calculate("3", cst);
    assert.equal(result.rawCst, cst);
    assert.equal(result.emitsBaseAndTax, false);
    assert.equal(result.includeInTotals, false);
    assert.deepEqual(buildIcmsItemStructure(result), {
      kind: "normal_minimal",
      taxCode: cst,
    });
  }
});

test("CST 60 usa forma mínima sem base/imposto", () => {
  const result = calculate("3", "60");
  assert.equal(result.emitsBaseAndTax, false);
  assert.equal(result.includeInTotals, false);
  assert.deepEqual(buildIcmsItemStructure(result), {
    kind: "normal_minimal",
    taxCode: "60",
  });
});

test("CRT 1/2 escolhe regime Simples e CSOSN, sem base/imposto normal", () => {
  for (const crt of ["1", "2"]) {
    const result = calculate(crt, "20", "102");
    assert.equal(result.regime, "simples");
    assert.equal(result.rawCsosn, "102");
    assert.equal(result.emitsBaseAndTax, false);
    assert.equal(result.includeInTotals, false);
    assert.deepEqual(buildIcmsItemStructure(result), {
      kind: "simples",
      taxCode: "102",
    });
  }
});
