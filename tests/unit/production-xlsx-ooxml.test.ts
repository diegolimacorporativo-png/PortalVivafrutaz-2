import assert from "node:assert/strict";
import { test } from "node:test";
import { patchWorksheetXml } from "../../server/modules/production/xlsx-ooxml";

test("patches editable cell values while retaining cell styles, formulas, merges and order", () => {
  const source = '<?xml version="1.0"?><worksheet><sheetData><row r="1"><c r="A1" s="14" t="s"><v>2</v></c><c r="B1" s="7"/><c r="D1" s="3"><f>SUM(C1:C1)</f><v>0</v></c></row></sheetData><mergeCells count="1"><mergeCell ref="A2:B2"/></mergeCells></worksheet>';
  const result = patchWorksheetXml(source, new Map([
    ["A1", { value: "Empresa & Unidade" }],
    ["B1", { value: 25 }],
    ["C1", { value: 10 }],
  ]));

  assert.match(result, /<c r="A1" s="14" t="inlineStr"><is><t xml:space="preserve">Empresa &amp; Unidade<\/t><\/is><\/c>/);
  assert.match(result, /<c r="B1" s="7"><v>25<\/v><\/c>/);
  assert.match(result, /<c r="C1"><v>10<\/v><\/c><c r="D1" s="3"><f>SUM\(C1:C1\)<\/f><v>0<\/v><\/c>/);
  assert.match(result, /<mergeCell ref="A2:B2"\/>/);
});

test("clears a value without dropping its existing style", () => {
  const source = '<worksheet><sheetData><row r="3"><c r="B3" s="21" t="inlineStr"><is><t>Old value</t></is></c></row></sheetData></worksheet>';
  assert.equal(patchWorksheetXml(source, new Map([["B3", { value: null }]])), '<worksheet><sheetData><row r="3"><c r="B3" s="21"/></row></sheetData></worksheet>');
});

test("clears a formula cache while preserving shared-formula attributes and cell metadata", () => {
  const source = '<worksheet><sheetData><row r="1"><c r="D1" s="3" cm="1"><f t="shared" si="4" ref="D1:D2">SUM(C1:C1)</f><v>999</v></c></row></sheetData></worksheet>';
  const result = patchWorksheetXml(source, new Map([["D1", { value: null, preserveFormula: true }]]));
  assert.equal(result, '<worksheet><sheetData><row r="1"><c r="D1" s="3" cm="1"><f t="shared" si="4" ref="D1:D2">SUM(C1:C1)</f><v></v></c></row></sheetData></worksheet>');
});

test("refuses to clear formula cache for a cell without a formula", () => {
  const source = '<worksheet><sheetData><row r="1"><c r="A1"><v>10</v></c></row></sheetData></worksheet>';
  assert.throws(() => patchWorksheetXml(source, new Map([["A1", { value: null, preserveFormula: true }]])), /não contém fórmula/);
});
