import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import {
  ALLOWED_TRANSITIONS,
  LEGACY_STATUS_MAP,
  OrderStatus,
  assertDispatchHasEligibleDelivery,
  assertTransitionAllowed,
  assertTransitionRole,
  validateBusinessRules,
} from "../../server/modules/orders/orders.workflow";

const activeCompany = { active: true, isLocked: false, companyName: "Cliente Teste" };

test("workflow operacional despacha READY sem faturamento e mantém INVOICED histórico", () => {
  assert.equal(OrderStatus.INVOICED, "INVOICED");
  assert.deepEqual(ALLOWED_TRANSITIONS[OrderStatus.READY], [
    OrderStatus.SHIPPED,
    OrderStatus.CANCELLED,
  ]);
  assert.deepEqual(ALLOWED_TRANSITIONS[OrderStatus.APPROVED], [
    OrderStatus.PROCESSING,
    OrderStatus.CANCELLED,
  ]);
  assert.deepEqual(ALLOWED_TRANSITIONS[OrderStatus.INVOICED], [
    OrderStatus.SHIPPED,
    OrderStatus.CANCELLED,
  ]);
  assert.doesNotThrow(() => assertTransitionAllowed(OrderStatus.READY, OrderStatus.SHIPPED));
  assert.throws(() => assertTransitionAllowed(OrderStatus.READY, OrderStatus.INVOICED));
  assert.throws(() => assertTransitionAllowed(OrderStatus.PENDING_APPROVAL, OrderStatus.SHIPPED));
  assert.doesNotThrow(() => assertTransitionRole(OrderStatus.SHIPPED, "LOGISTICS"));
  assert.throws(() => assertTransitionRole(OrderStatus.SHIPPED, "CLIENT"));
  assert.equal(LEGACY_STATUS_MAP[OrderStatus.INVOICED], "CONFIRMED");
  assert.equal(LEGACY_STATUS_MAP[OrderStatus.CUSTOMER_CONFIRMED], "ACTIVE");
});

test("customer-confirmed orders may only be released through APPROVED", () => {
  assert.deepEqual(ALLOWED_TRANSITIONS[OrderStatus.CUSTOMER_CONFIRMED], [
    OrderStatus.APPROVED,
    OrderStatus.CANCELLED,
  ]);
  assert.throws(() => assertTransitionAllowed(OrderStatus.CREATED, OrderStatus.APPROVED));
  assert.throws(() => assertTransitionAllowed(OrderStatus.CUSTOMER_CONFIRMED, OrderStatus.INVOICED));
  assert.throws(() => assertTransitionRole(OrderStatus.APPROVED, "CLIENT"));
  assert.doesNotThrow(() => assertTransitionRole(OrderStatus.APPROVED, "DIRECTOR"));
});

test("special and recurring orders retain their distinct starting states", () => {
  assert.equal(OrderStatus.PENDING_APPROVAL, "PENDING_APPROVAL");
  assert.equal(LEGACY_STATUS_MAP[OrderStatus.PENDING_APPROVAL], "ACTIVE");
  assert.equal(OrderStatus.CREATED, "CREATED");
});

test("Fase 1 — SHIPPED não exige NF, pré-nota ou status fiscal", () => {
  assert.doesNotThrow(() =>
    validateBusinessRules({
      orderId: 1,
      to: OrderStatus.SHIPPED,
      company: activeCompany,
      orderRow: {
        fiscalStatus: "nota_pendente",
        preNotaNumber: null,
        erpExportStatus: "nao_exportado",
        erpId: null,
      },
      arByCompany: [],
    }),
  );
});

test("Fase 1 — aprovação continua bloqueando empresa inválida", () => {
  assert.throws(
    () =>
      validateBusinessRules({
        orderId: 1,
        to: OrderStatus.APPROVED,
        company: { ...activeCompany, isLocked: true },
        orderRow: {},
        arByCompany: [],
      }),
    /bloqueada/,
  );
});

test("Fase 1 — aprovação operacional não depende de lançamentos financeiros", () => {
  assert.doesNotThrow(
    () =>
      validateBusinessRules({
        orderId: 1,
        to: OrderStatus.APPROVED,
        company: activeCompany,
        orderRow: {},
      }),
  );
});

test("despacho atualiza somente entregas pendentes do pedido e rejeita se nenhuma for elegível", () => {
  const source = readFileSync(
    resolve(process.cwd(), "server/modules/orders/orders.transaction.ts"),
    "utf8",
  );
  const dispatch = source.slice(
    source.indexOf("if (to === OrderStatus.SHIPPED)"),
    source.indexOf("// ── Step 4: Commit the state transition"),
  );

  assert.match(dispatch, /UPDATE deliveries[\s\S]*WHERE\s+order_id\s*=\s*\$\{orderId\}[\s\S]*status\s*=\s*'pendente'[\s\S]*RETURNING id/);
  assert.match(dispatch, /assertDispatchHasEligibleDelivery\(updated\.map\(\(\{ id \}\) => id\)\)/);
  assert.doesNotMatch(dispatch, /INSERT INTO deliveries/i);
});

test("entrega é atualizada antes do pedido e evento segue protegido pela transação", () => {
  const source = readFileSync(
    resolve(process.cwd(), "server/modules/orders/orders.transaction.ts"),
    "utf8",
  );
  assert.match(source, /return db\.transaction\(async \(tx\) =>/);
  const guardPosition = source.indexOf("assertDispatchHasEligibleDelivery(updated.map");
  const orderUpdatePosition = source.indexOf("const [updatedOrder]");
  const eventInsertPosition = source.indexOf("await tx.insert(workflowEvents)");
  assert.notEqual(guardPosition, -1, "validação de delivery elegível deve existir");
  assert.notEqual(orderUpdatePosition, -1, "atualização do pedido deve existir");
  assert.notEqual(eventInsertPosition, -1, "evento deve ser persistido na transação");
  assert.ok(guardPosition < orderUpdatePosition, "validar delivery antes de atualizar pedido");
  assert.ok(guardPosition < eventInsertPosition, "validar delivery antes de registrar evento");
});

test("despacho aceita resultado com delivery pendente atualizada e rejeita resultado vazio", () => {
  assert.doesNotThrow(() => assertDispatchHasEligibleDelivery([101]));
  assert.throws(
    () => assertDispatchHasEligibleDelivery([]),
    /não possui entrega elegível para despacho/,
  );
});
