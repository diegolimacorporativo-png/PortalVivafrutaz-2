import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import * as XLSX from "xlsx";
import {
  classifyProcessedPackaging,
  deliveryAddressDisplay,
  resolveInNaturaHeader,
} from "../../server/modules/production/production-xlsx-mapping";
import { renderInNaturaWorkbook } from "../../server/modules/production/production-xlsx-renderer";
import { readXlsxEntries } from "../../server/modules/production/xlsx-ooxml";

test("resolves only exact normalized official product headers", () => {
  assert.deepEqual(resolveInNaturaHeader("Pêssego", null, [
    { column: 5, header: "PÊSSEGO" },
  ]), { column: 5, status: "matched" });
  assert.deepEqual(resolveInNaturaHeader("Pêssego Gala", null, [
    { column: 5, header: "PÊSSEGO" },
  ]), { status: "unmatched" });
});

test("does not choose between duplicate official headers without an explicit discriminator", () => {
  const duplicate = [{ column: 15, header: "MAÇÃ" }, { column: 16, header: "Maçã" }];
  assert.deepEqual(resolveInNaturaHeader("Maçã", null, duplicate), { status: "ambiguous" });
});

test("maps P07 plastic to the non-Bio column when the official header omits the word plastic", () => {
  assert.deepEqual(resolveInNaturaHeader("Morango", "P07 plástico", [
    { column: 20, header: "Morango 50g" },
    { column: 21, header: "Morango 50g biodegradável" },
  ]), { column: 20, status: "matched" });
  assert.deepEqual(resolveInNaturaHeader("Morango", "Pote biodegradável", [
    { column: 20, header: "Morango 50g" },
    { column: 21, header: "Morango 50g biodegradável" },
  ]), { column: 21, status: "matched" });
});

test("uses Bio and P07 plastic markers as different packaging classes", () => {
  assert.equal(classifyProcessedPackaging("Pote biodegradável 100g"), "BIO_100G");
  assert.equal(classifyProcessedPackaging("P07 plástico 100g"), "P07_PLASTIC_100G");
  assert.notEqual(classifyProcessedPackaging("Pote biodegradável 100g"), classifyProcessedPackaging("P07 plástico 100g"));
});

test("requires the address captured in the production snapshot", () => {
  assert.equal(deliveryAddressDisplay({ companyId: 4, companyName: "Empresa teste", orderId: 10, quantity: 1 }), null);
  assert.equal(deliveryAddressDisplay({
    companyId: 4, companyName: "Empresa teste", orderId: 10, quantity: 1, deliveryAddressId: 8,
    deliveryAddress: { id: 8, companyId: 5, label: "Unidade alheia", logradouro: "Rua Teste", numero: null, complemento: null, bairro: null, cidade: "São Paulo", estado: null, cep: null },
  }), null);
  assert.equal(deliveryAddressDisplay({
    companyId: 4, companyName: "Empresa teste", orderId: 10, quantity: 1,
    deliveryAddressId: 8,
    deliveryAddress: { id: 8, companyId: 4, label: "Unidade Centro", logradouro: "Rua Teste", numero: "20", complemento: null, bairro: null, cidade: "São Paulo", estado: "SP", cep: null },
  }), "Empresa teste — Unidade Centro (Rua Teste, 20, São Paulo, SP)");
});

test("renders one In Natura row per saved delivery address and preserves the workbook structure", () => {
  const template = readFileSync("server/modules/production/templates/in-natura-template.xlsx");
  const original = XLSX.read(template, { type: "buffer", cellStyles: true, cellFormula: true });
  const originalSheet = original.Sheets[original.SheetNames[0]];
  const output = renderInNaturaWorkbook(template, {
    id: 77,
    productionDate: "2026-11-10",
    items: [{
      productId: 12,
      productName: "BANANA NANICA",
      unit: "UN",
      productionClassification: "IN_NATURA",
      totalQuantity: 11,
      orderBreakdown: [
        { itemId: 1, orderId: 21, companyId: 4, companyName: "Empresa sintética", quantity: 4, deliveryAddressId: 8, deliveryAddress: { id: 8, companyId: 4, label: "Unidade A", logradouro: "Rua Teste", numero: "1", complemento: null, bairro: null, cidade: "São Paulo", estado: "SP", cep: null } },
        { itemId: 2, orderId: 22, companyId: 4, companyName: "Empresa sintética", quantity: 7, deliveryAddressId: 9, deliveryAddress: { id: 9, companyId: 4, label: "Unidade B", logradouro: "Av. Teste", numero: "2", complemento: null, bairro: null, cidade: "São Paulo", estado: "SP", cep: null } },
      ],
    }],
  });
  const result = XLSX.read(output, { type: "buffer", cellStyles: true, cellFormula: true });
  const resultSheet = result.Sheets[result.SheetNames[0]];

  assert.equal(resultSheet.B12.v, "Empresa sintética — Unidade A (Rua Teste, 1, São Paulo, SP)");
  assert.equal(resultSheet.B13.v, "Empresa sintética — Unidade B (Av. Teste, 2, São Paulo, SP)");
  assert.equal(resultSheet.M12.v, 4);
  assert.equal(resultSheet.M13.v, 7);
  assert.match(String(resultSheet.CH3.v), /10\/11\/2026/);
  assert.equal(resultSheet["!merges"].length, originalSheet["!merges"].length);
  const formulaCount = (sheet: XLSX.WorkSheet) => Object.keys(sheet).filter((key) => !key.startsWith("!") && Boolean(sheet[key]?.f)).length;
  assert.equal(formulaCount(resultSheet), formulaCount(originalSheet));
});

test("checked-in official templates retain their workbook structure without prior customer rows", () => {
  const inNaturaEntries = readXlsxEntries(readFileSync("server/modules/production/templates/in-natura-template.xlsx"));
  const processedEntries = readXlsxEntries(readFileSync("server/modules/production/templates/processed-template.xlsx"));
  const inNatura = XLSX.read(readFileSync("server/modules/production/templates/in-natura-template.xlsx"), { type: "buffer" });
  const processed = XLSX.read(readFileSync("server/modules/production/templates/processed-template.xlsx"), { type: "buffer" });
  const inSheet = inNatura.Sheets[inNatura.SheetNames[0]];
  const processedSheet = processed.Sheets[processed.SheetNames[0]];
  assert.equal(inNatura.SheetNames.length, 3);
  assert.equal(processed.SheetNames.length, 2);
  assert.equal(inSheet["!ref"], "A1:DR219");
  assert.equal(processedSheet["!ref"], "A1:AD664");
  assert.equal(inSheet["!merges"].length, 39);
  assert.equal(processedSheet["!merges"].length, 511);
  assert.equal((inNaturaEntries.get("xl/worksheets/sheet1.xml")!.toString("utf8").match(/<f(?:\s|>)/g) ?? []).length, 158);
  assert.equal((processedEntries.get("xl/worksheets/sheet1.xml")!.toString("utf8").match(/<f(?:\s|>)/g) ?? []).length, 104);
  const allowedStructuralLabels = /^(?:TOTAL\b|POTE\b|FRUTAS PROCESSADAS\b|EMPRESA$|MANHÃ$|TARDE$)/i;
  const unexpectedInNaturaLabels = Object.keys(inSheet).filter((address) => {
    if (!/^B\d+$/.test(address) || Number(address.slice(1)) < 10) return false;
    const value = inSheet[address]?.v;
    return typeof value === "string" && value.trim() && !allowedStructuralLabels.test(value.trim());
  });
  assert.deepEqual(unexpectedInNaturaLabels, []);
  const unexpectedCompanyLabels = Object.keys(processedSheet).filter((address) => {
    if (!/^B\d+$/.test(address) || Number(address.slice(1)) <= 10) return false;
    const value = processedSheet[address]?.v;
    return typeof value === "string" && value.trim() && !allowedStructuralLabels.test(value.trim());
  });
  assert.deepEqual(unexpectedCompanyLabels, []);
});
