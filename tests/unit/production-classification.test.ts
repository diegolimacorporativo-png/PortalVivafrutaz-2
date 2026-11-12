import assert from "node:assert/strict";
import test from "node:test";
import { resolveProductionClassification } from "../../shared/production-classification";

test("defaults products without an explicit production section to In Natura", () => {
  assert.equal(resolveProductionClassification("Frutas", null), "IN_NATURA");
  assert.equal(resolveProductionClassification("Categoria geral", undefined), "IN_NATURA");
});

test("keeps explicit In Natura catalog categories in the In Natura sheet", () => {
  assert.equal(resolveProductionClassification("Frutas In Natura - não higienizadas", null), "IN_NATURA");
});

test("classifies processed production sections even when the category omits the word Processados", () => {
  assert.equal(resolveProductionClassification("Linha de Oleaginosas e Secas - (embalagem biodegradável)", null), "PROCESSADOS");
  assert.equal(resolveProductionClassification("Snacks Saudáveis - (embalagem plástica)", null), "PROCESSADOS");
  assert.equal(resolveProductionClassification("Industrializados", null), "PROCESSADOS");
  assert.equal(resolveProductionClassification("Frutas cortadas e porcionadas", null), "PROCESSADOS");
});

test("explicit classification remains the fallback for categories without a recognized section", () => {
  assert.equal(resolveProductionClassification("Categoria comercial", "PROCESSADOS"), "PROCESSADOS");
});
