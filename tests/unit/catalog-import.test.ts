import assert from "node:assert/strict";
import { test } from "node:test";
import * as XLSX from "xlsx";

process.env.NODE_ENV = "development";
process.env.ISOLATED_PREVIEW_MODE = "1";
process.env.ISOLATED_PREVIEW_DATABASE_URL = "postgresql://preview@127.0.0.1:55439/vivafrutaz_preview";

const { parseOrderCatalog } = await import("../../server/modules/products/catalog-import");

function makeWorkbook(sheets: Array<{ name: string; rows: unknown[][] }>): Buffer {
  const workbook = XLSX.utils.book_new();
  for (const sheet of sheets) {
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(sheet.rows), sheet.name);
  }
  return XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
}

test("recognizes the VivaFrutaz order-sheet layout and lets the internal sheet override repeated weekday rows", () => {
  const workbook = makeWorkbook([
    {
      name: "Segunda-Feira",
      rows: [
        ["Tabela de pedidos"],
        [null, "PRODUTOS", "Unidade Medida", "Valor Unit.", "Quantidade", "Valor Total"],
        [null, "Snacks saudáveis"],
        [null, "Coco em fita", "Porção 15g.", "R$ 3,25", 0, 0],
        [null, "Coco em fita", "Pouch 15g.", "R$ 4,10", 0, 0],
      ],
    },
    {
      name: "USO EXCLUSIVO VIVAFRUTAZ",
      rows: [
        ["Tabela de pedidos"],
        [null, "Produtos", "Unidade de Medida", "Preço Unitário", "Quantidade"],
        [null, "Snacks saudáveis"],
        [null, "Coco em fita", "Porção 15g.", "R$ 3,50", 0],
        [null, "Coco em fita", "Pouch 15g.", "R$ 4,40", 0],
      ],
    },
  ]);

  const parsed = parseOrderCatalog(workbook);
  assert.equal(parsed.rows.length, 2);
  assert.equal(parsed.variants.length, 2);
  assert.deepEqual(parsed.categories, ["Snacks saudáveis"]);
  assert.equal(parsed.variants[0]?.prices[0]?.price, 3.5);
  assert.equal(parsed.variants[1]?.prices[0]?.price, 4.4);
  assert.equal(parsed.variants[0]?.unit, "porcao");
  assert.equal(parsed.variants[0]?.measure, "Porção 15g.");
});

test("recognizes shifted columns and per-row categories with Brazilian or dot-decimal prices", () => {
  const workbook = makeWorkbook([
    {
      name: "Produtos",
      rows: [
        ["Código", "Nome do Produto", "Categoria", "Apresentação", "Preço Unitário", "Qtd"],
        ["001", "Maçã", "In natura higienizada", "Unidade", "R$ 1.234,56", 0],
        ["002", "Maçã", "In natura não higienizada", "Unidade", "2.10", 0],
      ],
    },
  ]);

  const parsed = parseOrderCatalog(workbook);
  assert.equal(parsed.rows.length, 2);
  assert.equal(parsed.variants.length, 2);
  assert.deepEqual(parsed.categories, ["In natura higienizada", "In natura não higienizada"]);
  assert.equal(parsed.variants[0]?.prices[0]?.price, 1234.56);
  assert.equal(parsed.variants[1]?.prices[0]?.price, 2.1);
});
