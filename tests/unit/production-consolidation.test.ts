import assert from "node:assert/strict";
import test from "node:test";
import { runWithTenant } from "../../server/core/tenant/context";
import { assertProductionGlobalAccess } from "../../server/modules/production/production-authorization";
import { consolidateProduction } from "../../server/modules/production/production-consolidation";
import type { ProductionConsolidationSource } from "../../server/modules/production/production-consolidation";

const date = "2026-11-05";
function source(overrides: Partial<ProductionConsolidationSource> = {}): ProductionConsolidationSource {
  return {
    itemId: 1,
    orderId: 100,
    orderCode: "VF-100",
    companyId: 10,
    companyName: "Empresa A",
    deliveryDate: date,
    productId: 7,
    productName: "Maçã Gala",
    category: "Frutas",
    unit: "UN",
    productionClassification: "IN_NATURA",
    sourceDescriptionSnapshot: "Maçã Nacional Gala",
    quantity: 100,
    workflowStatus: "APPROVED",
    productionOrigin: "FREE",
    specialRequestApprovedAndMaterialized: false,
    contractOccurrenceValid: false,
    ...overrides,
  };
}

test("consolida várias empresas por identidade oficial e mantém cada item rastreável", () => {
  const result = consolidateProduction(date, [
    source({ itemId: 11, orderId: 100, companyId: 10, companyName: "Empresa A", quantity: 100 }),
    source({ itemId: 22, orderId: 200, companyId: 20, companyName: "Empresa B", quantity: 150, sourceDescriptionSnapshot: "Gala" }),
    source({ itemId: 33, orderId: 300, companyId: 30, companyName: "Empresa C", quantity: 50, sourceDescriptionSnapshot: "Maçã Gala 170g" }),
  ], []);
  assert.equal(result.products.length, 1);
  assert.equal(result.products[0].totalQuantity, 300);
  assert.deepEqual(result.products[0].sources.map((item) => item.itemId), [11, 22, 33]);
  assert.deepEqual(result.products[0].sources.map((item) => item.quantity), [100, 150, 50]);
  assert.deepEqual(result.products[0].sources.map((item) => item.companyId), [10, 20, 30]);
  assert.deepEqual(result.products[0].sources.map((item) => item.orderId), [100, 200, 300]);
});

test("descrições alternativas com o mesmo productId consolidam; productIds distintos não se misturam", () => {
  const result = consolidateProduction(date, [
    source({ itemId: 1, productId: 7, sourceDescriptionSnapshot: "Maçã Gala" }),
    source({ itemId: 2, productId: 7, sourceDescriptionSnapshot: "Maçã Nacional Gala", quantity: 2 }),
    source({ itemId: 3, productId: 8, productName: "Maçã Gala Orgânica", sourceDescriptionSnapshot: "Maçã Gala", quantity: 3 }),
  ], []);
  assert.equal(result.products.length, 2);
  assert.equal(result.products.find((product) => product.productId === 7)?.totalQuantity, 102);
  assert.equal(result.products.find((product) => product.productId === 8)?.totalQuantity, 3);
});

test("não converte unidades nem mistura datas diferentes", () => {
  const result = consolidateProduction(date, [
    source({ itemId: 1, unit: "UN", quantity: 4 }),
    source({ itemId: 2, unit: "KG", quantity: 5 }),
    source({ itemId: 3, deliveryDate: "2026-11-06", quantity: 9 }),
  ], []);
  assert.equal(result.products.length, 2);
  assert.deepEqual(result.products.map((product) => product.unit).sort(), ["KG", "UN"]);
  assert.equal(result.products.reduce((sum, product) => sum + product.totalQuantity, 0), 9);
  assert.equal(result.pending.ineligibleOrders[0].reason, "DATA_DIVERGENTE_DA_PRODUCAO_SOLICITADA");
});

test("aplica elegibilidade das três origens e exclui origem sem comprovação", () => {
  const result = consolidateProduction(date, [
    source({ itemId: 1, quantity: 1, productionOrigin: "FREE", workflowStatus: "APPROVED" }),
    source({ itemId: 2, orderId: 102, quantity: 2, productionOrigin: "FREE", workflowStatus: "PENDING_APPROVAL" }),
    source({ itemId: 3, orderId: 103, quantity: 3, productionOrigin: "CONTRACT_FIXED", workflowStatus: "PENDING_APPROVAL", contractOccurrenceValid: true }),
    source({ itemId: 4, orderId: 104, quantity: 4, productionOrigin: "CONTRACT_FIXED", workflowStatus: "PENDING_APPROVAL", contractOccurrenceValid: false }),
    source({ itemId: 5, orderId: 105, quantity: 5, productionOrigin: "SPECIAL", workflowStatus: "APPROVED", specialRequestApprovedAndMaterialized: true }),
    source({ itemId: 6, orderId: 106, quantity: 6, productionOrigin: "SPECIAL", workflowStatus: "PENDING_APPROVAL", specialRequestApprovedAndMaterialized: false }),
    source({ itemId: 7, orderId: 107, quantity: 7, productionOrigin: null, workflowStatus: "APPROVED" }),
  ], []);
  assert.equal(result.products[0].totalQuantity, 9);
  assert.deepEqual(result.products[0].sources.map((item) => item.origin).sort(), ["CONTRACT_FIXED", "FREE", "SPECIAL"]);
  assert.equal(result.pending.ineligibleOrders.length, 4);
  assert.equal(result.pending.inconsistentOrigins.length, 2);
});

test("ocorrências contratuais ausentes, produto desconhecido e classificação pendente não viram quantidade produtiva", () => {
  const result = consolidateProduction(date, [
    source({ itemId: 1, productId: null, productName: null, quantity: 8 }),
    source({ itemId: 2, productId: 9, productName: "Kiwi", productionClassification: null, quantity: 12 }),
  ], [], [{
    companyId: 10, companyName: "Empresa A", contractId: 5, contractScopeId: 70,
    productId: 3, productName: "Uva", quantity: 30, deliveryDate: date,
    reason: "OCORRENCIA_CONTRATUAL_SEM_PEDIDO_MATERIALIZADO",
  }]);
  assert.equal(result.products.length, 0);
  assert.equal(result.pending.unidentifiedItems.length, 1);
  assert.equal(result.pending.unclassifiedItems.length, 1);
  assert.equal(result.pending.missingContractOccurrences.length, 1);
});

test("acesso global é validado pelo principal interno, não pela empresa selecionada", () => {
  const internal = { principal: { kind: "admin" as const, empresaId: 10, userId: 1, role: "OPERATIONS_MANAGER" }, empresaId: 10 };
  assert.doesNotThrow(() => runWithTenant(internal, () => assertProductionGlobalAccess()));
  assert.throws(() => runWithTenant({ ...internal, principal: { ...internal.principal, role: "CLIENT" } }, () => assertProductionGlobalAccess()), /não autorizado/);
  assert.throws(() => runWithTenant({ principal: { kind: "company" as const, empresaId: 10 }, empresaId: 10 }, () => assertProductionGlobalAccess()), /não autorizado/);
});
