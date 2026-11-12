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

test("classifies processed fruit and snack sections as Processados", () => {
  assert.equal(resolveProductionClassification("Frutas Processadas - (embalagem biodegradável)", null), "PROCESSADOS");
  assert.equal(resolveProductionClassification("Frutas Processadas - (embalagem plástica)", null), "PROCESSADOS");
  assert.equal(resolveProductionClassification("Snacks Saudáveis - (embalagem plástica)", null), "PROCESSADOS");
  assert.equal(resolveProductionClassification("Snack saudáveis plástico KG", null), "PROCESSADOS");
});

test("defaults all other catalog sections to In Natura", () => {
  assert.equal(resolveProductionClassification("Linha de Oleaginosas e Secas - (embalagem biodegradável)", null), "IN_NATURA");
  assert.equal(resolveProductionClassification("Industrializados", null), "IN_NATURA");
  assert.equal(resolveProductionClassification("Frutas cortadas e porcionadas", null), "IN_NATURA");
  assert.equal(resolveProductionClassification("Importado", null), "IN_NATURA");
});

test("explicit classification remains the fallback for categories without a recognized section", () => {
  assert.equal(resolveProductionClassification("Categoria comercial", "PROCESSADOS"), "PROCESSADOS");
});
