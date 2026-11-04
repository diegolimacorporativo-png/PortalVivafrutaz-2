import assert from "node:assert/strict";
import test from "node:test";
import { runWithTenant } from "../../server/core/tenant/context";
import { OrdersService } from "../../server/modules/orders/orders.service";
import { OrderStatus } from "../../server/modules/orders/orders.workflow";

const company = {
  id: 73421,
  companyName: "Empresa sintética",
  active: true,
  isLocked: false,
};

const order = {
  id: 94127,
  companyId: company.id,
  orderCode: "SYNTHETIC-94127",
  status: "ACTIVE",
  workflowStatus: OrderStatus.CUSTOMER_CONFIRMED,
  deliveryDate: new Date("2026-11-10T12:00:00.000Z"),
};

function serviceWithRepository(orderCompanyId = company.id) {
  const currentOrder = { ...order, companyId: orderCompanyId };
  const calls: any[] = [];
  const repository: any = {
    getUser: async () => {
      throw new Error("A sessão de cliente não deve consultar um usuário interno");
    },
    get: async (id: number) => id === currentOrder.id
      ? { order: { ...currentOrder }, items: [] }
      : null,
    getCompany: async (id: number) => id === company.id ? company : null,
    executeTransition: async (input: any) => {
      calls.push(input);
      return {
        updatedOrder: {
          ...currentOrder,
          workflowStatus: input.to,
          status: "CONFIRMED",
        },
        preNotaNumber: null,
        deliveryCreated: true,
        deliveryUpdated: false,
      };
    },
  };
  return { service: new OrdersService(repository), calls };
}

test("customer confirmation releases only its own tenant without an internal userId", async () => {
  const { service, calls } = serviceWithRepository();
  const result = await runWithTenant(
    {
      principal: { kind: "company", empresaId: company.id },
      empresaId: company.id,
    },
    () => service.transition(
      order.id,
      OrderStatus.APPROVED,
      { companyId: company.id },
      undefined,
      true,
    ),
  );

  assert.equal(result.workflowStatus, OrderStatus.APPROVED);
  assert.equal(result.details.deliveryCreated, true);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].actor, {
    id: 0,
    email: "system:customer-confirmation",
    role: "CLIENT",
    name: "Cliente",
  });
});

test("customer confirmation cannot release an order belonging to another tenant", async () => {
  const { service, calls } = serviceWithRepository(company.id + 1);

  await assert.rejects(
    () => runWithTenant(
      {
        principal: { kind: "company", empresaId: company.id },
        empresaId: company.id,
      },
      () => service.transition(
        order.id,
        OrderStatus.APPROVED,
        { companyId: company.id },
        undefined,
        true,
      ),
    ),
    (error: any) => error?.status === 403,
  );
  assert.equal(calls.length, 0);
});

test("company sessions still cannot invoke a general workflow transition", async () => {
  const { service, calls } = serviceWithRepository();

  await assert.rejects(
    () => runWithTenant(
      {
        principal: { kind: "company", empresaId: company.id },
        empresaId: company.id,
      },
      () => service.transition(
        order.id,
        OrderStatus.APPROVED,
        { companyId: company.id },
      ),
    ),
    (error: any) => error?.status === 401,
  );
  assert.equal(calls.length, 0);
});
