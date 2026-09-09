/**
 * Unit tests for the migrated `/api/inventory/*` module.
 *
 * Strategy: drive `InventoryController` directly with a hand-rolled fake
 * repository. The repository is the only seam to the database, so injecting
 * a fake here exercises the FULL service + controller stack (validation,
 * auth gate, business logic, response shape) without touching Postgres.
 *
 * What we lock down (matches STEP 9 of the migration brief):
 *   ✅ 1 success case  (200 + body)
 *   ✅ 1 validation error (400 + exact message)
 *   ✅ 1 auth error (401 + exact message)
 *   ✅ 1 edge case from legacy behaviour (createEntry side-effects:
 *      settings upsert + ENTRY movement insert + weighted-avg price)
 *
 * Run with:
 *   npx tsx --test tests/unit/inventory.test.ts
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import type { Request, Response } from "express";
import { InventoryController } from "../../server/modules/inventory/inventory.controller";
import { InventoryService } from "../../server/modules/inventory/inventory.service";
import { hasInventoryRole } from "../../server/modules/inventory/inventory.policy";
import type { InventoryRepository } from "../../server/modules/inventory/inventory.repository";
import type {
  InsertInventoryEntry,
  InsertInventoryMovement,
  InsertInventoryPhysicalCount,
  InsertInventorySettings,
  InventoryEntry,
  InventoryMovement,
  InventoryPhysicalCount,
  InventorySettings,
} from "../../server/modules/inventory/inventory.types";

/** Minimal Response stub that captures `status()` and `json()` calls. */
function makeRes(): Response & { _status: number; _body: any } {
  const res: any = {
    _status: 200,
    _body: undefined,
    status(code: number) {
      this._status = code;
      return this;
    },
    json(body: any) {
      this._body = body;
      return this;
    },
  };
  return res as Response & { _status: number; _body: any };
}

/** Builds a Request stub with the given session + body/query/params. */
function makeReq(opts: {
  session?: { userId?: number; userName?: string; userRole?: string } | null;
  body?: any;
  query?: any;
  params?: any;
}): Request {
  const session = opts.session
    ? {
        ...opts.session,
        userRole:
          opts.session.userRole ??
          (opts.session.userId ? "ADMIN" : undefined),
      }
    : null;
  return {
    session,
    body: opts.body ?? {},
    query: opts.query ?? {},
    params: opts.params ?? {},
  } as unknown as Request;
}

/**
 * In-memory fake of `InventoryRepository`. Records every write so the
 * side-effect test can assert exact ordering and field values.
 */
class FakeRepo implements InventoryRepository {
  tenantId = 1;
  productIds = new Set<number>();
  settings: InventorySettings[] = [];
  entries: InventoryEntry[] = [];
  movements: InventoryMovement[] = [];
  counts: InventoryPhysicalCount[] = [];
  upsertCalls: InsertInventorySettings[] = [];
  movementCalls: InsertInventoryMovement[] = [];
  entryCalls: InsertInventoryEntry[] = [];
  countCalls: InsertInventoryPhysicalCount[] = [];

  async getSettings(): Promise<InventorySettings[]> {
    return this.settings.filter(
      (setting) => setting.tenantId == null || setting.tenantId === this.tenantId,
    );
  }
  async getSettingById(id: number) {
    return (await this.getSettings()).find((s) => s.id === id);
  }
  async getSettingByProductId(productId: number) {
    return (await this.getSettings()).find((s) => s.productId === productId);
  }
  async getSettingByProductName(productName: string) {
    return (await this.getSettings()).find((s) => s.productName === productName);
  }
  async getProductById(productId: number) {
    return this.productIds.has(productId) ? ({ id: productId } as any) : undefined;
  }
  async upsertSetting(data: InsertInventorySettings) {
    this.upsertCalls.push(data);
    const cast = data as any;
    const id = cast.id ?? this.settings.length + 1;
    const row = {
      ...(cast as any),
      tenantId: this.tenantId,
      id,
      updatedAt: new Date(),
    } as InventorySettings;
    const idx = this.settings.findIndex((s) => s.id === id);
    if (idx >= 0) this.settings[idx] = row;
    else this.settings.push(row);
    return row;
  }
  async getEntries() {
    return this.entries.filter(
      (entry) => entry.tenantId == null || entry.tenantId === this.tenantId,
    );
  }
  async createEntry(data: InsertInventoryEntry) {
    this.entryCalls.push(data);
    const row = {
      ...(data as any),
      tenantId: this.tenantId,
      id: this.entries.length + 1,
      createdAt: new Date(),
    } as InventoryEntry;
    this.entries.push(row);
    return row;
  }
  async deleteEntry(id: number) {
    this.entries = this.entries.filter((e) => e.id !== id);
  }
  async getMovements() {
    return this.movements.filter(
      (movement) => movement.tenantId == null || movement.tenantId === this.tenantId,
    );
  }
  async createMovement(data: InsertInventoryMovement) {
    this.movementCalls.push(data);
    const row = {
      ...(data as any),
      tenantId: this.tenantId,
      id: this.movements.length + 1,
      createdAt: new Date(),
    } as InventoryMovement;
    this.movements.push(row);
    return row;
  }
  async getPhysicalCounts() {
    return this.counts.filter(
      (count) => count.tenantId == null || count.tenantId === this.tenantId,
    );
  }
  async createPhysicalCount(data: InsertInventoryPhysicalCount) {
    this.countCalls.push(data);
    const row = {
      ...(data as any),
      tenantId: this.tenantId,
      id: this.counts.length + 1,
      createdAt: new Date(),
    } as InventoryPhysicalCount;
    this.counts.push(row);
    return row;
  }
}

function makeController(): {
  ctrl: InventoryController;
  repo: FakeRepo;
} {
  const repo = new FakeRepo();
  const service = new InventoryService(repo as unknown as InventoryRepository);
  const ctrl = new InventoryController(service);
  return { ctrl, repo };
}

describe("InventoryController — auth gate (legacy parity)", () => {
  test("GET /settings without session → 401 'Não autorizado'", async () => {
    const { ctrl } = makeController();
    const req = makeReq({ session: null });
    const res = makeRes();
    await ctrl.listSettings(req, res);
    assert.equal(res._status, 401);
    assert.deepEqual(res._body, { message: "Não autorizado" });
  });

  test("POST /entries without session → 401 'Não autorizado'", async () => {
    const { ctrl } = makeController();
    const req = makeReq({
      session: null,
      body: {
        productName: "Banana",
        quantity: 10,
        unit: "kg",
        entryDate: "2026-04-25",
      },
    });
    const res = makeRes();
    await ctrl.createEntry(req, res);
    assert.equal(res._status, 401);
    assert.deepEqual(res._body, { message: "Não autorizado" });
  });
});

describe("InventoryController — validation parity", () => {
  test("POST /settings without productName → 400 with EXACT legacy message", async () => {
    const { ctrl } = makeController();
    const req = makeReq({
      session: { userId: 1, userName: "Tester" },
      body: { unit: "kg" },
    });
    const res = makeRes();
    await ctrl.createSetting(req, res);
    assert.equal(res._status, 400);
    assert.deepEqual(res._body, {
      message: "productName e unit são obrigatórios",
    });
  });

  test("POST /entries missing required fields → 400 with EXACT legacy message", async () => {
    const { ctrl } = makeController();
    const req = makeReq({
      session: { userId: 1, userName: "Tester" },
      body: { productName: "Banana" },
    });
    const res = makeRes();
    await ctrl.createEntry(req, res);
    assert.equal(res._status, 400);
    assert.deepEqual(res._body, {
      message: "Campos obrigatórios: productName, quantity, unit, entryDate",
    });
  });

  test("POST /physical-counts missing fields → 400 with EXACT legacy message", async () => {
    const { ctrl } = makeController();
    const req = makeReq({
      session: { userId: 1, userName: "Tester" },
      body: { productName: "Banana" },
    });
    const res = makeRes();
    await ctrl.createPhysicalCount(req, res);
    assert.equal(res._status, 400);
    assert.deepEqual(res._body, {
      message: "productName, physicalStock e date são obrigatórios",
    });
  });
});

describe("InventoryController — happy paths", () => {
  test("GET /settings with session → 200 + raw rows (no envelope)", async () => {
    const { ctrl, repo } = makeController();
    repo.settings.push({
      id: 1,
      productId: 10,
      productName: "Banana",
      unit: "kg",
      currentStock: "5",
      minStock: "2",
      avgPurchasePrice: "1.50",
      category: "Frutas",
    } as unknown as InventorySettings);
    const req = makeReq({ session: { userId: 1 } });
    const res = makeRes();
    await ctrl.listSettings(req, res);
    assert.equal(res._status, 200);
    assert.equal(Array.isArray(res._body), true);
    assert.equal(res._body.length, 1);
    assert.equal(res._body[0].productName, "Banana");
    // Verify NO envelope wrapping was added.
    assert.equal((res._body as any).success, undefined);
    assert.equal((res._body as any).data, undefined);
  });

  test("DELETE /entries/:id → 200 { ok: true } (legacy shape)", async () => {
    const { ctrl, repo } = makeController();
    repo.entries.push({ id: 42 } as unknown as InventoryEntry);
    const req = makeReq({ session: { userId: 1 }, params: { id: "42" } });
    const res = makeRes();
    await ctrl.deleteEntry(req, res);
    assert.equal(res._status, 200);
    assert.deepEqual(res._body, { ok: true });
    assert.equal(repo.entries.length, 0);
  });
});

describe("InventoryController — legacy edge case: createEntry side-effects", () => {
  /**
   * Locks down the EXACT side-effect chain documented in routes.ts:
   *   1. createInventoryEntry returns the row
   *   2. find-or-create inventory_settings
   *   3. weighted-average purchase price recomputed
   *   4. settings upserted with new currentStock + new avgPurchasePrice
   *   5. ENTRY movement inserted referencing the entry id
   */
  test("first entry for a new product → upserts settings AND records ENTRY movement", async () => {
    const { ctrl, repo } = makeController();
    const req = makeReq({
      session: { userId: 7, userName: "Operator" },
      body: {
        productName: "Maçã",
        quantity: 10,
        unit: "kg",
        purchasePrice: 5,
        invoiceNumber: "NF-001",
        entryDate: "2026-04-25",
      },
    });
    const res = makeRes();
    await ctrl.createEntry(req, res);

    // 200 + the persisted entry returned verbatim
    assert.equal(res._status, 200);
    assert.equal(res._body.productName, "Maçã");
    assert.equal(res._body.quantity, "10");
    assert.equal(res._body.createdBy, "Operator");
    assert.equal(res._body.createdById, 7);

    // Two upserts: (a) initial create-if-missing  (b) stock+avg refresh
    assert.equal(repo.upsertCalls.length, 2);
    const [initialUpsert, finalUpsert] = repo.upsertCalls as any[];
    assert.equal(initialUpsert.currentStock, "0");
    assert.equal(initialUpsert.minStock, "0");
    // After 0 + 10 = 10kg @ avg = 5 (no prior stock)
    assert.equal(finalUpsert.currentStock, "10");
    assert.equal(finalUpsert.avgPurchasePrice, "5");

    // Exactly one ENTRY movement linked to the new entry
    assert.equal(repo.movementCalls.length, 1);
    const mv = repo.movementCalls[0] as any;
    assert.equal(mv.movementType, "ENTRY");
    assert.equal(mv.quantity, "10");
    assert.equal(mv.balanceAfter, "10");
    assert.equal(mv.referenceType, "entry");
    assert.equal(mv.notes, "NF NF-001");
    assert.equal(mv.createdBy, "Operator");
  });
});

describe("Etapa 20 — Inventory RBAC, tenant isolation and mass assignment", () => {
  test("1. una sessão ausente continua recebendo 401", async () => {
    const { ctrl } = makeController();
    const res = makeRes();
    await ctrl.listMovements(makeReq({ session: null }), res);
    assert.equal(res._status, 401);
  });

  test("2. usuário A consulta o estoque permitido do próprio tenant", async () => {
    const { ctrl, repo } = makeController();
    repo.tenantId = 1;
    repo.settings.push({ id: 1, tenantId: 1, productName: "A", unit: "kg" } as any);
    const res = makeRes();
    await ctrl.listSettings(
      makeReq({ session: { userId: 10, userRole: "PURCHASE_MANAGER" } }),
      res,
    );
    assert.equal(res._status, 200);
    assert.deepEqual(res._body.map((row: any) => row.productName), ["A"]);
  });

  test("3. usuário A não consulta estoque do tenant B", async () => {
    const { ctrl, repo } = makeController();
    repo.tenantId = 1;
    repo.settings.push({ id: 2, tenantId: 2, productName: "B", unit: "kg" } as any);
    const res = makeRes();
    await ctrl.listSettings(
      makeReq({ session: { userId: 10, userRole: "ADMIN" } }),
      res,
    );
    assert.deepEqual(res._body, []);
  });

  test("4. usuário A não altera configuração do tenant B", async () => {
    const { ctrl, repo } = makeController();
    repo.settings.push({
      id: 20,
      tenantId: 2,
      productName: "B",
      unit: "kg",
      currentStock: "4",
      minStock: "1",
    } as any);
    const res = makeRes();
    await ctrl.updateSetting(
      makeReq({
        session: { userId: 10, userRole: "ADMIN" },
        params: { id: "20" },
        body: { minStock: 99 },
      }),
      res,
    );
    assert.equal(res._status, 404);
    assert.equal((repo.settings[0] as any).minStock, "1");
  });

  test("5. usuário A não exclui entrada do tenant B", async () => {
    const { ctrl, repo } = makeController();
    repo.entries.push({ id: 30, tenantId: 2 } as any);
    const res = makeRes();
    await ctrl.deleteEntry(
      makeReq({
        session: { userId: 10, userRole: "ADMIN" },
        params: { id: "30" },
      }),
      res,
    );
    assert.equal(res._status, 404);
    assert.equal(repo.entries.length, 1);
  });

  test("6. companyId enviado no payload não troca o tenant", async () => {
    const { ctrl, repo } = makeController();
    const res = makeRes();
    await ctrl.createSetting(
      makeReq({
        session: { userId: 10, userRole: "ADMIN" },
        body: {
          productName: "Banana",
          unit: "kg",
          companyId: 999,
          empresaId: 999,
        },
      }),
      res,
    );
    assert.equal(res._status, 200);
    assert.equal((res._body as any).tenantId, 1);
    assert.equal((repo.upsertCalls[0] as any).companyId, undefined);
    assert.equal((repo.upsertCalls[0] as any).empresaId, undefined);
  });

  test("7. tenantId enviado no payload não troca o tenant", async () => {
    const { ctrl, repo } = makeController();
    const res = makeRes();
    await ctrl.createEntry(
      makeReq({
        session: { userId: 10, userName: "A", userRole: "ADMIN" },
        body: {
          productName: "Banana",
          quantity: 2,
          unit: "kg",
          entryDate: "2026-04-25",
          tenantId: 999,
        },
      }),
      res,
    );
    assert.equal(res._status, 200);
    assert.equal((repo.entryCalls[0] as any).tenantId, undefined);
    assert.equal((res._body as any).tenantId, 1);
  });

  test("8. criação é gravada no tenant resolvido pela sessão/repositório", async () => {
    const { ctrl, repo } = makeController();
    repo.tenantId = 7;
    const res = makeRes();
    await ctrl.createEntry(
      makeReq({
        session: { userId: 10, userName: "Operator", userRole: "DIRECTOR" },
        body: {
          productName: "Maçã",
          quantity: 3,
          unit: "kg",
          entryDate: "2026-04-25",
        },
      }),
      res,
    );
    assert.equal(res._status, 200);
    assert.equal((res._body as any).tenantId, 7);
  });

  test("9. role sem permissão recebe 403", async () => {
    const { ctrl } = makeController();
    const res = makeRes();
    await ctrl.listSettings(
      makeReq({ session: { userId: 10, userRole: "LOGISTICS" } }),
      res,
    );
    assert.equal(res._status, 403);
    assert.deepEqual(res._body, { message: "Sem permissão para esta operação" });
  });

  test("10. role autorizada continua funcionando", async () => {
    const { ctrl } = makeController();
    const res = makeRes();
    await ctrl.listSettings(
      makeReq({ session: { userId: 10, userRole: "PURCHASE_MANAGER" } }),
      res,
    );
    assert.equal(res._status, 200);
  });

  test("11. campos protegidos não sofrem mass assignment", async () => {
    const { ctrl, repo } = makeController();
    const res = makeRes();
    await ctrl.createEntry(
      makeReq({
        session: { userId: 10, userName: "Server User", userRole: "ADMIN" },
        body: {
          productName: "Pera",
          quantity: 2,
          unit: "kg",
          entryDate: "2026-04-25",
          createdBy: "Attacker",
          createdById: 999,
          balanceAfter: "99999",
          currentStock: "99999",
          status: "APPROVED",
          approvedBy: 999,
        },
      }),
      res,
    );
    assert.equal((repo.entryCalls[0] as any).createdBy, "Server User");
    assert.equal((repo.entryCalls[0] as any).createdById, 10);
    assert.equal((repo.entryCalls[0] as any).balanceAfter, undefined);
    assert.equal((repo.entryCalls[0] as any).currentStock, undefined);
    assert.equal((repo.entryCalls[0] as any).status, undefined);
  });

  test("12. produto relacionado de outro tenant é rejeitado", async () => {
    const { ctrl, repo } = makeController();
    const res = makeRes();
    await ctrl.createEntry(
      makeReq({
        session: { userId: 10, userRole: "ADMIN" },
        body: {
          productId: 500,
          productName: "Produto B",
          quantity: 1,
          unit: "kg",
          entryDate: "2026-04-25",
        },
      }),
      res,
    );
    assert.equal(res._status, 403);
    assert.equal(repo.entryCalls.length, 0);
  });

  test("13. saldo posterior é calculado no servidor", async () => {
    const { ctrl, repo } = makeController();
    repo.settings.push({
      id: 1,
      tenantId: 1,
      productName: "Pera",
      unit: "kg",
      currentStock: "10",
      minStock: "0",
      avgPurchasePrice: "2",
    } as any);
    const res = makeRes();
    await ctrl.createEntry(
      makeReq({
        session: { userId: 10, userName: "Operator", userRole: "ADMIN" },
        body: {
          productName: "Pera",
          quantity: 3,
          unit: "kg",
          entryDate: "2026-04-25",
          balanceAfter: "999",
        },
      }),
      res,
    );
    assert.equal((repo.movementCalls[0] as any).balanceAfter, "13");
    assert.equal((repo.movementCalls[0] as any).quantity, "3");
  });

  test("14. MASTER e DIRECTOR mantêm acesso autorizado", () => {
    assert.equal(hasInventoryRole("MASTER"), true);
    assert.equal(hasInventoryRole("DIRECTOR"), true);
  });

  test("15. operação permitida de inventário físico continua funcionando", async () => {
    const { ctrl, repo } = makeController();
    repo.settings.push({
      id: 1,
      tenantId: 1,
      productName: "Uva",
      unit: "kg",
      currentStock: "10",
      minStock: "0",
    } as any);
    const res = makeRes();
    await ctrl.createPhysicalCount(
      makeReq({
        session: { userId: 10, userName: "Auditor", userRole: "DIRECTOR" },
        body: {
          productName: "Uva",
          physicalStock: 7,
          unit: "kg",
          date: "2026-04-25",
        },
      }),
      res,
    );
    assert.equal(res._status, 200);
    assert.equal((repo.countCalls[0] as any).systemStock, "10");
    assert.equal((repo.countCalls[0] as any).physicalStock, "7");
    assert.equal((repo.countCalls[0] as any).difference, "-3");
  });
});
