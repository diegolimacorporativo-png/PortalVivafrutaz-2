import assert from "node:assert/strict";
import { test } from "node:test";
import { createNfeTenantAccessMiddleware } from "../../server/modules/nfe/nfe-tenant-access.middleware";
import { runWithTenant } from "../../server/core/tenant/context";
import { requireRole } from "../../server/core/http/requireAuth";
import { FISCAL_ROLES } from "../../server/modules/orders/orders.service";

async function invoke(input: {
  tenantId: number | null;
  role?: string;
  nfe?: any;
  context?: boolean;
}) {
  const lookups: Array<[number, number] | [number]> = [];
  const validatedOrders: number[] = [];
  const middleware = createNfeTenantAccessMiddleware({
    getNfeEmissao: async (id) => { lookups.push([id]); return input.nfe; },
    getNfeEmissaoForCompany: async (id, companyId) => {
      lookups.push([id, companyId]);
      return input.nfe;
    },
    validateOrderTenant: async (orderId) => { validatedOrders.push(orderId); },
  });
  const req: any = { params: { id: "17" } };
  const execute = () => new Promise<any>((resolve) => {
    void middleware(req, {} as any, (error?: unknown) => resolve(error ?? null));
  });
  const error = input.context === false
    ? await execute()
    : await runWithTenant({
      principal: { kind: "admin", userId: 8, empresaId: input.tenantId, role: input.role },
      empresaId: input.tenantId,
    }, execute);
  return { error, req, lookups, validatedOrders };
}

test("NF-e de tenant é carregada com filtro SQL do mesmo tenant antes da autorização", async () => {
  const nfe = { id: 17, orderId: 33, xmlGerado: "synthetic" };
  const result = await invoke({ tenantId: 4, role: "FINANCEIRO", nfe });
  assert.equal(result.error, null);
  assert.deepEqual(result.lookups, [[17, 4]]);
  assert.deepEqual(result.validatedOrders, [33]);
  assert.equal(result.req.authorizedNfe, nfe);
});

test("NF-e de outra empresa e ID inexistente não fazem leitura global", async () => {
  const result = await invoke({ tenantId: 4, role: "FINANCEIRO", nfe: undefined });
  assert.ok(result.error);
  assert.deepEqual(result.lookups, [[17, 4]]);
  assert.deepEqual(result.validatedOrders, []);
  assert.equal(result.req.authorizedNfe, undefined);
});

test("perfil global sem tenant pode acessar NF-e ligada a pedido sob validação explícita", async () => {
  const result = await invoke({ tenantId: null, role: "DIRECTOR", nfe: { id: 17, orderId: 33 } });
  assert.equal(result.error, null);
  assert.deepEqual(result.lookups, [[17]]);
  assert.deepEqual(result.validatedOrders, [33]);
});

test("contexto ausente, perfil sem escopo global e NF-e sem pedido são rejeitados", async () => {
  const noContext = await invoke({ tenantId: null, role: "DIRECTOR", context: false });
  assert.ok(noContext.error);
  assert.deepEqual(noContext.lookups, []);

  const noTenant = await invoke({ tenantId: null, role: "COMERCIAL", nfe: { id: 17, orderId: 33 } });
  assert.ok(noTenant.error);
  assert.deepEqual(noTenant.lookups, []);

  const unlinked = await invoke({ tenantId: null, role: "MASTER", nfe: { id: 17, orderId: null } });
  assert.ok(unlinked.error);
  assert.deepEqual(unlinked.validatedOrders, []);
  assert.equal(unlinked.req.authorizedNfe, undefined);
});

test("transmissão fiscal exige perfil fiscal; perfis sem autorização recebem negação", async () => {
  const checkRole = requireRole([...FISCAL_ROLES]);
  let financeError: unknown;
  await checkRole({ session: { userId: 12, userRole: "FINANCEIRO" } } as any, {} as any, (error?: unknown) => { financeError = error; });
  assert.equal(financeError, undefined);

  let commercialError: any;
  await checkRole({ session: { userId: 13, userRole: "COMERCIAL" } } as any, {} as any, (error?: unknown) => { commercialError = error; });
  assert.equal(commercialError?.status, 403);
});
