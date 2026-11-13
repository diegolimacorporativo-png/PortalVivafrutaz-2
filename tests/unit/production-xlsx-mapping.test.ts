import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import * as XLSX from "xlsx";
import {
  classifyProcessedPackaging,
  resolveInNaturaHeader,
} from "../../server/modules/production/production-xlsx-mapping";
import { renderInNaturaWorkbook } from "../../server/modules/production/production-xlsx-renderer";
import { renderProcessedWorkbook } from "../../server/modules/production/production-processed-xlsx-renderer";
import { productionExportQuerySchema } from "../../server/modules/production/production.validation";
import { readXlsxEntries } from "../../server/modules/production/xlsx-ooxml";

test("resolves only exact normalized official product headers", () => {
  assert.deepEqual(resolveInNaturaHeader("Pêssego", null, [
    { column: 5, header: "PÊSSEGO" },
  ]), { column: 5, status: "matched" });
  assert.deepEqual(resolveInNaturaHeader("Pêssego Gala", null, [
    { column: 5, header: "PÊSSEGO" },
  ]), { status: "unmatched" });
});

test("maps the reviewed Pêssego Nacional início safra catalog name to the unique official PÊSSEGO column", () => {
  assert.deepEqual(resolveInNaturaHeader("Pêssego Nacional (início safra)", null, [
    { column: 31, header: "PÊSSEGO" },
  ]), { column: 31, status: "matched" });
  assert.deepEqual(resolveInNaturaHeader("Pêssego Nacional (início safra)", null, [
    { column: 31, header: "PÊSSEGO" },
    { column: 32, header: "PÊSSEGO" },
  ]), { status: "ambiguous" });
});

test("maps Porção de Morango to the conventional official Morango 50g column", () => {
  assert.deepEqual(resolveInNaturaHeader("Porção de Morango", null, [
    { column: 54, header: "Morango 50g" },
    { column: 55, header: "Morango 50g BIODEGRADÁVEL" },
  ]), { column: 54, status: "matched" });
  assert.deepEqual(resolveInNaturaHeader("Porção de Morango", null, [
    { column: 54, header: "Morango 100g" },
  ]), { status: "unmatched" });
});

test("exports catalog-classified industrialized products under the generic official header", () => {
  const template = readFileSync("server/modules/production/templates/in-natura-template.xlsx");
  const output = renderInNaturaWorkbook(template, {
    id: 82,
    productionDate: "2026-11-10",
    items: [{
      productId: 9001,
      productName: "Coca-Cola Zero 220 ml",
      category: "Bebidas",
      unit: "CAIXA",
      productionClassification: "IN_NATURA",
      totalQuantity: 2,
      orderBreakdown: [
        { itemId: 1201, orderId: 701, companyId: 27, companyName: "Empresa Industrializada", quantity: 1, isIndustrialized: true },
        { itemId: 1202, orderId: 702, companyId: 27, companyName: "Empresa Industrializada", quantity: 1, isIndustrialized: true },
      ],
    }],
  });
  const workbook = XLSX.read(output, { type: "buffer" });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  assert.equal(sheet.B12.v, "Empresa Industrializada");
  assert.equal(sheet.CZ12.v, "Coca-Cola Zero 220 ml — 2 CAIXA");
});

test("exports Pêssego Nacional as PÊSSEGO with one company row aggregated across addresses", () => {
  const template = readFileSync("server/modules/production/templates/in-natura-template.xlsx");
  const batch = {
    id: 79,
    productionDate: "2026-11-10",
    items: [{
      productId: 395,
      productName: "Pêssego Nacional (início safra)",
      unit: "UN",
      productionClassification: "IN_NATURA" as const,
      totalQuantity: 5,
      orderBreakdown: [
        { itemId: 1101, orderId: 601, companyId: 25, companyName: "Empresa teste", quantity: 2, routeName: "Rota Norte", deliveryAddressId: 301, deliveryAddress: { id: 301, companyId: 25, label: "Unidade A", logradouro: "Rua A", numero: "1", complemento: null, bairro: null, cidade: "São Paulo", estado: "SP", cep: null } },
        { itemId: 1102, orderId: 602, companyId: 25, companyName: "Empresa teste", quantity: 3, routeName: "Rota Sul", deliveryAddressId: 302, deliveryAddress: { id: 302, companyId: 25, label: "Unidade B", logradouro: "Rua B", numero: "2", complemento: null, bairro: null, cidade: "São Paulo", estado: "SP", cep: null } },
      ],
    }],
  };
  const output = renderInNaturaWorkbook(template, batch);
  const workbook = XLSX.read(output, { type: "buffer", cellStyles: true, cellFormula: true });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  assert.equal(sheet.B12.v, "Empresa teste");
  assert.equal(sheet.C12.v, "Rota Norte / Rota Sul");
  assert.equal(sheet.AE12.v, 5);
  assert.equal(Object.keys(sheet).filter((address) => /^B\d+$/.test(address) && sheet[address]?.v === "Empresa teste").length, 1);
});

test("exports by company when the source order has no delivery address", () => {
  const template = readFileSync("server/modules/production/templates/in-natura-template.xlsx");
  const output = renderInNaturaWorkbook(template, {
    id: 80,
    productionDate: "2026-11-10",
    items: [{ productId: 395, productName: "Pêssego Nacional (início safra)", unit: "UN", productionClassification: "IN_NATURA", totalQuantity: 1,
      orderBreakdown: [{ itemId: 1103, orderId: 603, companyId: 25, companyName: "Empresa teste", quantity: 1 }] }],
  });
  const sheet = XLSX.read(output, { type: "buffer" }).Sheets[XLSX.read(template, { type: "buffer" }).SheetNames[0]];
  assert.equal(sheet.B12.v, "Empresa teste");
  assert.equal(sheet.AE12.v, 1);
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
  assert.equal(classifyProcessedPackaging("Pote biodegradável 200g"), null);
  assert.equal(classifyProcessedPackaging("P07 plástico 200g"), null);
  assert.equal(classifyProcessedPackaging("P07 plástico 100g", "FRUTAS PROCESSADAS"), "P07_PLASTIC_100G");
  assert.equal(classifyProcessedPackaging("P07 plástico", "FRUTAS PROCESSADAS 200g"), null);
  assert.equal(classifyProcessedPackaging("Pote plástico 200g"), "POT_200G");
  assert.equal(classifyProcessedPackaging("Embalagem PET", "FRUTAS PROCESSADAS - (EMBALAGEM PLÁSTICA)"), "PET");
  assert.equal(classifyProcessedPackaging("Pote Bio 100g", "FRUTAS PROCESSADAS - BIODEGRADÁVEL"), "BIO_100G");
  assert.equal(classifyProcessedPackaging("P07 Bio 100g"), null);
  assert.equal(classifyProcessedPackaging("P07 plástico 100g", "Embalagem 200g"), null);
});

test("does not infer a PET block from a generic plastic category and product name", () => {
  assert.equal(classifyProcessedPackaging(
    null,
    "FRUTAS PROCESSADAS - (EMBALAGEM PLÁSTICA)",
    "Pote de Manga e Iogurte Grego",
  ), null);
});

test("blocks export until the plastic pot packaging is explicitly identified", () => {
  const template = readFileSync("server/modules/production/templates/processed-template.xlsx");
  assert.throws(() => renderProcessedWorkbook(template, {
    id: 81,
    productionDate: "2026-11-10",
    items: [{
      productId: 395,
      productName: "Pote de Manga e Iogurte Grego",
      category: "FRUTAS PROCESSADAS - (EMBALAGEM PLÁSTICA)",
      unit: "POTE",
      productionClassification: "PROCESSADOS",
      totalQuantity: 4,
      orderBreakdown: [{
        itemId: 1104, orderId: 604, companyId: 26, companyName: "Empresa Processados teste", quantity: 4,
        routeName: "Rota teste",
      }],
    }],
  }, { shift: "morning", responsibleName: "Responsável sintético" }), /conferência manual/);
});

test("renders one In Natura row per company and preserves the workbook structure", () => {
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

  assert.equal(resultSheet.B12.v, "Empresa sintética");
  assert.equal(resultSheet.M12.v, 11);
  assert.equal(Object.keys(resultSheet).filter((address) => /^B\d+$/.test(address) && resultSheet[address]?.v === "Empresa sintética").length, 1);
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

test("Processados requires an explicit valid shift at export time", () => {
  assert.equal(productionExportQuerySchema.safeParse({ shift: "morning" }).success, true);
  assert.equal(productionExportQuerySchema.safeParse({ shift: "afternoon" }).success, true);
  assert.equal(productionExportQuerySchema.safeParse({ shift: "night" }).success, false);
});

test("renders Processados from the saved snapshot with one row per company and responsible", () => {
  const template = readFileSync("server/modules/production/templates/processed-template.xlsx");
  const output = renderProcessedWorkbook(template, {
    id: 71,
    productionDate: "2026-11-10",
    items: [{
      productId: 45,
      productName: "MixFrutas",
      unit: "POTE",
      productionClassification: "PROCESSADOS",
      totalQuantity: 8,
      orderBreakdown: [
        { itemId: 1001, orderId: 501, companyId: 22, companyName: "Empresa sintética", quantity: 3, subCategoryId: 10, subCategoryName: "Pote biodegradável 100g", deliveryAddressId: 201, deliveryAddress: { id: 201, companyId: 22, label: "Unidade A", logradouro: "Rua de Teste", numero: "10", complemento: null, bairro: null, cidade: "São Paulo", estado: "SP", cep: null } },
        { itemId: 1002, orderId: 502, companyId: 22, companyName: "Empresa sintética", quantity: 5, subCategoryId: 10, subCategoryName: "Pote biodegradável 100g", deliveryAddressId: 202, deliveryAddress: { id: 202, companyId: 22, label: "Unidade B", logradouro: "Av. de Teste", numero: "20", complemento: null, bairro: null, cidade: "São Paulo", estado: "SP", cep: null } },
      ],
    }],
  }, { shift: "morning", responsibleName: "Responsável Sintético" });
  const result = XLSX.read(output, { type: "buffer", cellStyles: true, cellFormula: true });
  const sheet = result.Sheets[result.SheetNames[0]];
  const values = Object.values(sheet).filter((cell: any) => cell && typeof cell === "object").map((cell: any) => cell.v);
  assert.equal(values.filter((value) => value === "Empresa sintética").length, 1);
  assert.ok(values.includes("Responsável Sintético"));
  assert.ok(values.includes(8));
  assert.ok(values.includes("MixFrutas"));
  assert.equal(sheet.M2.v, 10);
  assert.equal(sheet.M3.v, "TERÇA-FEIRA");
  const original = XLSX.read(template, { type: "buffer", cellStyles: true, cellFormula: true });
  assert.equal(sheet["!merges"].length, original.Sheets[original.SheetNames[0]]["!merges"].length);
  const formulaCount = (candidate: XLSX.WorkSheet) => Object.keys(candidate).filter((key) => !key.startsWith("!") && Boolean(candidate[key]?.f)).length;
  assert.equal(formulaCount(sheet), formulaCount(original.Sheets[original.SheetNames[0]]));
});

test("routes P07 plastic into the selected shift block, separate from biodegradable Bio", () => {
  const template = readFileSync("server/modules/production/templates/processed-template.xlsx");
  const batch = {
    id: 73,
    productionDate: "2026-11-10",
    items: [{ productId: 47, productName: "MixFrutas", unit: "POTE", productionClassification: "PROCESSADOS" as const, totalQuantity: 2, orderBreakdown: [
      { itemId: 1004, orderId: 504, companyId: 24, companyName: "Empresa P07 sintética", quantity: 2, subCategoryId: 12, subCategoryName: "P07 plástico 100g", deliveryAddressId: 204, deliveryAddress: { id: 204, companyId: 24, label: "Unidade P07", logradouro: "Rua de Teste", numero: null, complemento: null, bairro: null, cidade: "São Paulo", estado: "SP", cep: null } },
    ] }],
  };
  for (const [shift, expectedRow] of [["morning", "B92"], ["afternoon", "B259"]] as const) {
    const result = XLSX.read(renderProcessedWorkbook(template, batch, { shift, responsibleName: "Responsável Sintético" }), { type: "buffer" });
    const sheet = result.Sheets[result.SheetNames[0]];
    assert.equal(sheet[expectedRow]?.v, "Empresa P07 sintética");
    const bioRow = shift === "morning" ? "B10" : "B310";
    assert.equal(sheet[bioRow]?.v, undefined);
  }
});

test("blocks Processados export when a packaging category has no block in the selected shift", () => {
  const template = readFileSync("server/modules/production/templates/processed-template.xlsx");
  assert.throws(() => renderProcessedWorkbook(template, {
    id: 72,
    productionDate: "2026-11-10",
    items: [{ productId: 46, productName: "Produto sintético", unit: "UN", productionClassification: "PROCESSADOS", totalQuantity: 1, orderBreakdown: [
      { itemId: 1003, orderId: 503, companyId: 23, companyName: "Empresa sintética", quantity: 1, subCategoryName: "Pote 200g", subCategoryId: 11, deliveryAddressId: 203, deliveryAddress: { id: 203, companyId: 23, label: "Unidade C", logradouro: "Rua de Teste", numero: null, complemento: null, bairro: null, cidade: "São Paulo", estado: "SP", cep: null } },
    ] }],
  }, { shift: "afternoon", responsibleName: "Responsável Sintético" }), /não possui bloco de POT_200G para o turno selecionado/);
});
