import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const cron = read("../../server/jobs/recurring-orders.cron.ts");
const occurrencePersistence = read("../../server/modules/orders/contract-occurrence-materialization.ts");
const companies = read("../../server/modules/companies/companies.service.ts");
const special = read("../../server/routes/special-order-requests.routes.ts");
const specialMaterialization = read("../../server/modules/special-orders/special-order-materialization.ts");
const production = read("../../server/modules/production/production.repository.ts");

test("recorrência grava pedido, ocorrência e itens sob a mesma transação e tenant", () => {
  assert.match(cron, /runWithTenant\([\s\S]*?db\.transaction\(async \(tx\)/);
  assert.match(cron, /ordersService\.createInternal\([\s\S]*?productionOrigin: "CONTRACT_FIXED"[\s\S]*?tx/);
  assert.match(cron, /persistContractOccurrence\(tx/);
  assert.match(occurrencePersistence, /tx\.insert\(recurringOrderLogs\)/);
  assert.match(occurrencePersistence, /tx\.insert\(recurringOrderLogItems\)/);
  assert.match(cron, /isUniqueOccurrenceConflict\(err\)/);
});

test("geração administrativa delega ao mesmo pipeline recorrente idempotente", () => {
  assert.match(companies, /runRecurringOrdersCron\(\{ companyId \}\)/);
  assert.doesNotMatch(companies, /ordersService\.createInternal/);
});

test("aprovação pontual bloqueia repetição com lock e persiste pedido na solicitação na transação", () => {
  assert.match(special, /db\.transaction\(async \(tx\)/);
  assert.match(special, /materializeSpecialOrderRequest\(tx/);
  assert.match(specialMaterialization, /\.where\(eq\(specialOrderRequests\.id, input\.requestId\)\)\.for\("update"\)/);
  assert.match(specialMaterialization, /if \(request\.generatedOrderId\) return/);
  assert.match(specialMaterialization, /generatedOrderId: order\.id/);
  assert.match(special, /productionOrigin: "SPECIAL"/);
});

test("consulta da Produção exige origem e evidência de ocorrência/item, sem aceitar status do cliente", () => {
  assert.match(production, /inArray\(orders\.workflowStatus, \["APPROVED", "PENDING_APPROVAL"\]\)/);
  assert.match(production, /isProductionOrderEligible\(/);
  assert.match(production, /eq\(recurringOrderLogItems\.orderItemId, orderItems\.id\)/);
  assert.match(production, /eq\(recurringOrderLogItems\.quantity, orderItems\.quantity\)/);
  assert.match(production, /eq\(specialOrderRequests\.generatedOrderId, orders\.id\)/);
});
