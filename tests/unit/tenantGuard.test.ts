/**
 * FASE 6.1 — testes de segurança multi-tenant.
 *
 * Trava o comportamento da camada de proteção introduzida em FASE 1
 * (server/core/security/tenantGuard.ts) e adotada em FASE 6 nas rotas
 * de leitura. Os testes atacam DIRETAMENTE o guard — não as rotas — para
 * isolar a lógica de tenant da camada HTTP.
 *
 * Estratégia de isolamento:
 *   - tenant ativo: instalado via `runWithTenant({ ... }, fn)` — mesma
 *     função usada pela camada HTTP em produção, garantindo que o guard
 *     leia exatamente da AsyncLocalStorage real (zero fakes do contexto).
 *   - storage.getOrder: mockado por requisição via `mock.method` do
 *     `node:test`. Nenhuma query real toca o banco. Cada teste restaura
 *     o método original via `t.after(() => restore())` para evitar
 *     vazamento entre testes.
 *   - console.error: spy para validar o log [SECURITY] TENANT_MISMATCH
 *     sem poluir a saída do test runner.
 *
 * Run with: npx tsx --test tests/unit/tenantGuard.test.ts
 */
import { test, describe, mock } from "node:test";
import assert from "node:assert/strict";
import {
  validateOrderTenant,
  safeGetOrder,
} from "../../server/core/security/tenantGuard";
import { runWithTenant } from "../../server/core/tenant/context";
import { storage } from "../../server/services/storage";
import {
  AppError,
  ForbiddenError,
  NotFoundError,
  UnauthorizedError,
} from "../../server/shared/errors/AppError";

// ── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Roda `fn` com um tenant "company" instalado — equivalente ao que o
 * middleware `tenantContext` faz em produção para um usuário cliente.
 */
function withCompanyTenant<T>(empresaId: number, fn: () => Promise<T>): Promise<T> {
  return runWithTenant(
    { principal: { kind: "company", empresaId }, empresaId },
    fn,
  );
}

/**
 * Substitui temporariamente `storage.getOrder` por uma implementação
 * fake. Devolve um `restore()` que reverte a substituição — chamado
 * via `t.after(...)` para garantir isolamento entre testes.
 */
function stubGetOrder(impl: (id: number) => any) {
  const original = (storage as any).getOrder.bind(storage);
  (storage as any).getOrder = async (id: number) => impl(id);
  return () => {
    (storage as any).getOrder = original;
  };
}

// ────────────────────────────────────────────────────────────────────────────
// ETAPA 2 — cenários obrigatórios
// ────────────────────────────────────────────────────────────────────────────

describe("validateOrderTenant — TESTE 1: mesmo tenant (sucesso)", () => {
  test("não lança quando order.companyId == tenantId", async (t) => {
    const restore = stubGetOrder((id) => ({
      order: { id, companyId: 1 },
      items: [],
    }));
    t.after(restore);

    await withCompanyTenant(1, async () => {
      await assert.doesNotReject(() => validateOrderTenant(123));
    });
  });

  test("aceita também `empresaId` no shape do pedido (compat legada)", async (t) => {
    const restore = stubGetOrder((id) => ({
      order: { id, empresaId: 7, companyId: null },
      items: [],
    }));
    t.after(restore);

    await withCompanyTenant(7, async () => {
      await assert.doesNotReject(() => validateOrderTenant(456));
    });
  });
});

describe("validateOrderTenant — TESTE 2: tenant diferente (bloqueio 403)", () => {
  test("lança ForbiddenError quando companyId != tenantId", async (t) => {
    const restore = stubGetOrder((id) => ({
      order: { id, companyId: 2 },
      items: [],
    }));
    t.after(restore);

    await withCompanyTenant(1, async () => {
      await assert.rejects(
        () => validateOrderTenant(123),
        (err: any) => {
          assert.ok(err instanceof ForbiddenError, "deve ser ForbiddenError");
          assert.ok(err instanceof AppError, "deve ser AppError");
          assert.equal(err.status, 403, "status HTTP = 403");
          return true;
        },
      );
    });
  });

  test("companyId nulo no pedido também é tratado como mismatch", async (t) => {
    const restore = stubGetOrder((id) => ({
      order: { id, companyId: null, empresaId: null },
      items: [],
    }));
    t.after(restore);

    await withCompanyTenant(1, async () => {
      await assert.rejects(
        () => validateOrderTenant(123),
        (err: any) => err instanceof ForbiddenError && err.status === 403,
      );
    });
  });
});

describe("validateOrderTenant — TESTE 3: pedido inexistente (404)", () => {
  test("lança NotFoundError quando storage.getOrder devolve undefined", async (t) => {
    const restore = stubGetOrder(() => undefined);
    t.after(restore);

    await withCompanyTenant(1, async () => {
      await assert.rejects(
        () => validateOrderTenant(999),
        (err: any) => {
          assert.ok(err instanceof NotFoundError, "deve ser NotFoundError");
          assert.ok(err instanceof AppError);
          assert.equal(err.status, 404, "status HTTP = 404");
          return true;
        },
      );
    });
  });

  test("lança NotFoundError para id inválido (<= 0) sem nem chamar storage", async (t) => {
    let called = false;
    const restore = stubGetOrder(() => {
      called = true;
      return { order: { companyId: 1 }, items: [] };
    });
    t.after(restore);

    await withCompanyTenant(1, async () => {
      await assert.rejects(
        () => validateOrderTenant(0),
        (err: any) => err instanceof NotFoundError && err.status === 404,
      );
      assert.equal(called, false, "storage.getOrder não deve ser invocado");
    });
  });
});

describe("validateOrderTenant — TESTE 4: log de segurança", () => {
  test("mismatch emite [SECURITY] + Tenant mismatch em console.error", async (t) => {
    const restore = stubGetOrder((id) => ({
      order: { id, companyId: 999 },
      items: [],
    }));
    t.after(restore);

    const captured: string[] = [];
    const errorSpy = mock.method(console, "error", (...args: unknown[]) => {
      captured.push(args.map((a) => String(a)).join(" "));
    });
    t.after(() => errorSpy.mock.restore());

    await withCompanyTenant(1, async () => {
      await assert.rejects(() => validateOrderTenant(42), ForbiddenError);
    });

    const logLine = captured.find((l) => l.includes("[SECURITY]"));
    assert.ok(logLine, "deve haver pelo menos um log com [SECURITY]");
    assert.match(logLine!, /\[SECURITY\]/);
    assert.match(logLine!, /TENANT_MISMATCH/);
    assert.match(logLine!, /Tenant mismatch/);
    assert.match(logLine!, /orderId=42/);
    assert.match(logLine!, /tenant=1/);
    assert.match(logLine!, /orderCompanyId=999/);
  });

  test("acerto de tenant NÃO emite log [SECURITY]", async (t) => {
    const restore = stubGetOrder((id) => ({
      order: { id, companyId: 1 },
      items: [],
    }));
    t.after(restore);

    const captured: string[] = [];
    const errorSpy = mock.method(console, "error", (...args: unknown[]) => {
      captured.push(args.map((a) => String(a)).join(" "));
    });
    t.after(() => errorSpy.mock.restore());

    await withCompanyTenant(1, async () => {
      await validateOrderTenant(7);
    });

    assert.equal(
      captured.filter((l) => l.includes("[SECURITY]")).length,
      0,
      "fluxo feliz não deve gerar log de segurança",
    );
  });
});

// ────────────────────────────────────────────────────────────────────────────
// ETAPA 3 — safeGetOrder (mesma política do guard, mas devolve o pedido)
// ────────────────────────────────────────────────────────────────────────────

describe("safeGetOrder — paridade com validateOrderTenant", () => {
  test("devolve { order, items } quando o tenant casa", async (t) => {
    const fakeOrder = { id: 10, companyId: 1, status: "DRAFT" };
    const fakeItems = [{ id: 1, productId: 99 }];
    const restore = stubGetOrder(() => ({ order: fakeOrder, items: fakeItems }));
    t.after(restore);

    await withCompanyTenant(1, async () => {
      const result = await safeGetOrder(10);
      assert.deepEqual(result.order, fakeOrder);
      assert.deepEqual(result.items, fakeItems);
    });
  });

  test("bloqueia tenant diferente com ForbiddenError 403", async (t) => {
    const restore = stubGetOrder((id) => ({
      order: { id, companyId: 2 },
      items: [],
    }));
    t.after(restore);

    await withCompanyTenant(1, async () => {
      await assert.rejects(
        () => safeGetOrder(10),
        (err: any) => err instanceof ForbiddenError && err.status === 403,
      );
    });
  });

  test("pedido inexistente → NotFoundError 404", async (t) => {
    const restore = stubGetOrder(() => null);
    t.after(restore);

    await withCompanyTenant(1, async () => {
      await assert.rejects(
        () => safeGetOrder(404),
        (err: any) => err instanceof NotFoundError && err.status === 404,
      );
    });
  });
});

// ────────────────────────────────────────────────────────────────────────────
// ETAPA 4 — não regressão (contratos preservados)
// ────────────────────────────────────────────────────────────────────────────

describe("não regressão — contratos do guard", () => {
  test("sem tenant ativo → UnauthorizedError (fail-closed)", async () => {
    // Sem runWithTenant: requireTenantId() lança UnauthorizedError.
    // Nenhum stub necessário — o guard quebra antes de chamar storage.
    await assert.rejects(
      () => validateOrderTenant(1),
      (err: any) => {
        assert.ok(err instanceof UnauthorizedError, "deve ser UnauthorizedError");
        assert.ok(err instanceof AppError);
        assert.equal(err.status, 401);
        return true;
      },
    );
  });

  test("todos os erros do guard são AppError (lockable pelo errorHandler global)", async (t) => {
    // 1) mismatch
    let restore = stubGetOrder((id) => ({
      order: { id, companyId: 2 },
      items: [],
    }));
    t.after(restore);
    await withCompanyTenant(1, async () => {
      await assert.rejects(
        () => validateOrderTenant(1),
        (err: any) => err instanceof AppError,
      );
    });
    restore();

    // 2) not found
    restore = stubGetOrder(() => undefined);
    t.after(restore);
    await withCompanyTenant(1, async () => {
      await assert.rejects(
        () => validateOrderTenant(1),
        (err: any) => err instanceof AppError,
      );
    });
  });

  test("mensagens humanas preservadas (snapshot leve)", async (t) => {
    const restore = stubGetOrder((id) => ({
      order: { id, companyId: 99 },
      items: [],
    }));
    t.after(restore);

    await withCompanyTenant(1, async () => {
      try {
        await validateOrderTenant(77);
        assert.fail("deveria ter lançado");
      } catch (err: any) {
        assert.match(err.message, /Acesso negado ao pedido #77/);
        assert.match(err.message, /outro tenant/);
      }
    });
  });
});
