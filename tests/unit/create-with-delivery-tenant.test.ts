import assert from "node:assert/strict";
import test from "node:test";
import { runWithTenant } from "../../server/core/tenant/context";
import { OrdersService } from "../../server/modules/orders/orders.service";

function makeService(company: any = {
  id: 17,
  active: true,
  isLocked: false,
  adminFee: 0,
  useNewPricing: false,
  addressStreet: "Authorized address",
  addressZip: "00000-000",
  addressCity: "Authorized city",
  addressState: "SP",
}) {
  const calls: any[] = [];
  const repo = {
    getUser: async () => ({ id: 4, role: "ADMIN" }),
    getCompany: async (id: number) => {
      calls.push(["getCompany", id]);
      return company;
    },
    createOrderWithDelivery: async (order: any, items: any[], delivery: any) => {
      calls.push(["create", order, items, delivery]);
      return {
        order: { id: 90, ...order },
        delivery: { id: 91, orderId: 90, companyId: order.companyId, ...delivery },
      };
    },
    getProductById: async () => null,
  };
  const service = new OrdersService(repo as any);
  (service as any).afterCreate = async () => undefined;
  return { service, calls };
}

const selectedAdminTenant = {
  principal: { kind: "admin" as const, empresaId: 17, userId: 4, role: "MASTER" },
  empresaId: 17,
};

test("createWithDelivery obtém empresa e endereço do tenant autorizado selecionado", async () => {
  const { service, calls } = makeService();
  const result = await runWithTenant(selectedAdminTenant, () => service.createWithDelivery(
    { companyId: "17", deliveryDate: "2026-10-30", items: [] },
    { userId: 4, role: "MASTER" } as any,
  ));

  assert.equal(calls[0][0], "getCompany");
  assert.equal(calls[0][1], 17);
  const createCall = calls.find(([kind]) => kind === "create");
  assert.equal(createCall[1].companyId, 17);
  assert.equal(createCall[3].addressStreet, "Authorized address");
  assert.equal(result.order.companyId, 17);
  assert.equal(result.delivery.companyId, 17);
});

test("createWithDelivery rejeita companyId divergente antes de consultar empresa ou preço", async () => {
  const { service, calls } = makeService();
  await assert.rejects(
    () => runWithTenant(selectedAdminTenant, () => service.createWithDelivery(
      { companyId: 18, deliveryDate: "2026-10-30", items: [] },
      { userId: 4, role: "MASTER" } as any,
    )),
    /Empresa não autorizada/,
  );
  assert.deepEqual(calls, []);
});

test("createWithDelivery rejeita empresa inexistente, inativa ou bloqueada antes de persistir", async () => {
  for (const company of [null, { id: 17, active: false, isLocked: false }, { id: 17, active: true, isLocked: true }]) {
    const { service, calls } = makeService(company);
    await assert.rejects(
      () => runWithTenant(selectedAdminTenant, () => service.createWithDelivery(
        { companyId: 17, deliveryDate: "2026-10-30", items: [] },
        { userId: 4, role: "MASTER" } as any,
      )),
      /empresa selecionada não está disponível/,
    );
    assert.equal(calls.some(([kind]) => kind === "create"), false);
  }
});

test("createWithDelivery exige empresa selecionada mesmo para perfil global", async () => {
  const { service, calls } = makeService();
  const globalAdmin = {
    principal: { kind: "admin" as const, empresaId: null, userId: 4, role: "MASTER" },
    empresaId: null,
  };
  await assert.rejects(
    () => runWithTenant(globalAdmin, () => service.createWithDelivery(
      { companyId: 17, deliveryDate: "2026-10-30", items: [] },
      { userId: 4, role: "MASTER" } as any,
    )),
  );
  assert.deepEqual(calls, []);
});
