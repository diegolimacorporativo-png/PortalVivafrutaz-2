import assert from "node:assert/strict";
import test from "node:test";
import { consolidateProduction, type ProductionConsolidation, type ProductionConsolidationSource } from "../../server/modules/production/production-consolidation";
import { assessProductionPreview, fingerprintProductionConsolidation } from "../../server/modules/production/production-preview";

const date = "2026-11-05";
function source(overrides: Partial<ProductionConsolidationSource> = {}): ProductionConsolidationSource {
  return {
    itemId: 1, orderId: 101, orderCode: "PED-101", companyId: 1, companyName: "Empresa A",
    deliveryDate: date, productId: 5, productName: "Maçã Gala", category: "Frutas", unit: "UN",
    productionClassification: "IN_NATURA", quantity: 100, workflowStatus: "APPROVED", productionOrigin: "FREE",
    specialRequestApprovedAndMaterialized: false, contractOccurrenceValid: false, ...overrides,
  };
}

function preview(rows: ProductionConsolidationSource[]): ProductionConsolidation {
  return consolidateProduction(date, rows, []);
}

test("prévia calcula produtos, empresas, pedidos e itens distintos a partir da consolidação", () => {
  const result = preview([
    source({ itemId: 1, orderId: 101, companyId: 1, quantity: 100 }),
    source({ itemId: 2, orderId: 102, companyId: 2, companyName: "Empresa B", quantity: 150 }),
    source({ itemId: 3, orderId: 102, companyId: 2, companyName: "Empresa B", quantity: 50 }),
  ]);
  const readiness = assessProductionPreview(result);
  assert.deepEqual(readiness.indicators, {
    productCount: 1, companyCount: 2, orderCount: 2, itemCount: 3, pendingCount: 0, inconsistencyCount: 0,
  });
  assert.equal(result.products[0].totalQuantity, 300);
});

test("a soma das parcelas rastreadas corresponde ao total de cada produto", () => {
  const result = preview([source({ quantity: 100 }), source({ itemId: 2, orderId: 102, quantity: 150 })]);
  for (const product of result.products) {
    assert.equal(product.sources.reduce((sum, item) => sum + item.quantity, 0), product.totalQuantity);
  }
  assert.equal(assessProductionPreview(result).canGenerate, true);
});

test("divergência e item de origem duplicado bloqueiam o lote e aparecem no indicador", () => {
  const base = preview([source({ itemId: 1, quantity: 10 }), source({ itemId: 2, orderId: 102, quantity: 20 })]);
  const duplicateSource = {
    ...base,
    products: base.products.map((product) => ({
      ...product,
      totalQuantity: product.totalQuantity + 1,
      sources: [...product.sources, { ...product.sources[0] }],
    })),
  };
  const readiness = assessProductionPreview(duplicateSource);
  assert.equal(readiness.canGenerate, false);
  assert.ok(readiness.indicators.inconsistencyCount >= 2);
});

test("impede geração com produto não identificado ou origem inconsistente; classificação padrão não bloqueia", () => {
  const withUnknownProduct = preview([source({ productId: null, productName: null })]);
  const withUnclassifiedProduct = preview([source({ productionClassification: null })]);
  const withBadOrigin = preview([source({ productionOrigin: "CONTRACT_FIXED", contractOccurrenceValid: false })]);
  assert.equal(assessProductionPreview(withUnknownProduct).canGenerate, false);
  assert.equal(assessProductionPreview(withUnclassifiedProduct).canGenerate, true);
  assert.equal(assessProductionPreview(withBadOrigin).canGenerate, false);
  assert.ok(assessProductionPreview(withBadOrigin).indicators.inconsistencyCount > 0);
});

test("pendências contratuais sem materialização bloqueiam por possível incompletude; pedidos inelegíveis ficam informativos", () => {
  const base = preview([source({ itemId: 1, orderId: 101, quantity: 100 }), source({
    itemId: 2, orderId: 202, quantity: 25, workflowStatus: "PENDING_APPROVAL", productionOrigin: "FREE",
  })]);
  assert.equal(assessProductionPreview(base).canGenerate, true);
  assert.equal(assessProductionPreview(base).indicators.pendingCount, 1);

  const missingContract: ProductionConsolidation = {
    ...base,
    pending: {
      ...base.pending,
      missingContractOccurrences: [{ companyId: 1, companyName: "Empresa A", contractId: 9, contractScopeId: 11,
        productId: 5, productName: "Maçã Gala", quantity: 20, deliveryDate: date,
        reason: "OCORRENCIA_CONTRATUAL_SEM_PEDIDO_MATERIALIZADO" }],
    },
  };
  assert.equal(assessProductionPreview(missingContract).canGenerate, false);
});

test("fingerprint é estável à ordem de leitura e muda quando a quantidade ou origem muda", () => {
  const first = preview([source({ itemId: 1 }), source({ itemId: 2, orderId: 102, quantity: 10 })]);
  const reordered = preview([source({ itemId: 2, orderId: 102, quantity: 10 }), source({ itemId: 1 })]);
  const changed = preview([source({ itemId: 1, quantity: 99 }), source({ itemId: 2, orderId: 102, quantity: 10 })]);
  assert.equal(fingerprintProductionConsolidation(first), fingerprintProductionConsolidation(reordered));
  assert.notEqual(fingerprintProductionConsolidation(first), fingerprintProductionConsolidation(changed));
});
