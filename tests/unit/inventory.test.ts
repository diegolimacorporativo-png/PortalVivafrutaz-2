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
  session?: { userId?: number; userName?: string } | null;
  body?: any;
  query?: any;
  params?: any;
}): Request {
  return {
    session: opts.session ?? null,
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
  settings: InventorySettings[] = [];
  entries: InventoryEntry[] = [];
  movements: InventoryMovement[] = [];
  counts: InventoryPhysicalCount[] = [];
  upsertCalls: InsertInventorySettings[] = [];
  movementCalls: InsertInventoryMovement[] = [];
  entryCalls: InsertInventoryEntry[] = [];
  countCalls: InsertInventoryPhysicalCount[] = [];

  async getSettings(): Promise<InventorySettings[]> {
    return this.settings;
  }
  async getSettingByProductId(productId: number) {
    return this.settings.find((s) => s.productId === productId);
  }
  async getSettingByProductName(productName: string) {
    return this.settings.find((s) => s.productName === productName);
  }
  async upsertSetting(data: InsertInventorySettings) {
    this.upsertCalls.push(data);
    const cast = data as any;
    const id = cast.id ?? this.settings.length + 1;
    const row = { ...(cast as any), id, updatedAt: new Date() } as InventorySettings;
    const idx = this.settings.findIndex((s) => s.id === id);
    if (idx >= 0) this.settings[idx] = row;
    else this.settings.push(row);
    return row;
  }
  async getEntries() {
    return this.entries;
  }
  async createEntry(data: InsertInventoryEntry) {
    this.entryCalls.push(data);
    const row = {
      ...(data as any),
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
    return this.movements;
  }
  async createMovement(data: InsertInventoryMovement) {
    this.movementCalls.push(data);
    const row = {
      ...(data as any),
      id: this.movements.length + 1,
      createdAt: new Date(),
    } as InventoryMovement;
    this.movements.push(row);
    return row;
  }
  async getPhysicalCounts() {
    return this.counts;
  }
  async createPhysicalCount(data: InsertInventoryPhysicalCount) {
    this.countCalls.push(data);
    const row = {
      ...(data as any),
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
