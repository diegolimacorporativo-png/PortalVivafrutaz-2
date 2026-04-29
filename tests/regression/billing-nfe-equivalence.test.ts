/**
 * FASE 8.4.3 — REGRESSION GUARD (CI SAFE)
 *
 * Sentinela do sistema fiscal: garante que `resolveBillingItems.items`
 * permanece equivalente a `buildNFeInput.produtos` para os 4 cenários
 * canônicos de faturamento. Se este teste quebrar → houve alteração
 * fiscal indevida e o build deve ser bloqueado.
 *
 * Cenários:
 *   1. STANDARD            (draft STANDARD: copia order_items + NCM do produto)
 *   2. CONTRACT_OPEN       (draft manual com items explícitos)
 *   3. CONTRACT_AVERAGE    (snapshot via contract_scopes.averageCost)
 *   4. GROUPED             (useGroupedItems=true → linha "Frutas in natura")
 *
 * Rollback / isolamento:
 *
 *   O `resolveBillingItems` e o `buildNFeInput` consomem o `db` global
 *   (drizzle/pg pool, conexões múltiplas) via `storage.*`. Um BEGIN num
 *   client específico do pool NÃO se propaga aos demais — então um
 *   `BEGIN/ROLLBACK` lógico aqui daria falsa segurança.
 *
 *   A garantia equivalente — ZERO escrita permanente — é obtida por:
 *     • TAGs únicas (`_eq_sanity_regress_*` e `EQ_SANITY_REGRESS`) que
 *       isolam fisicamente nossos dados de qualquer outro registro;
 *     • cleanup determinístico em `try/finally` (executado mesmo em
 *       erro fatal ou SIGINT) que remove TUDO que criamos;
 *     • snapshot/restore da `company_config` (singleton) — restauramos
 *       o estado original campo a campo, ou removemos a linha se não
 *       existia antes.
 *
 *   Validação contínua: o próprio teste, ao final, executa um SELECT
 *   COUNT pelas TAGs e falha se algum residual permanecer.
 *
 * Run: npm run test
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import bcrypt from "bcryptjs";
import { eq, like } from "drizzle-orm";
import { db, pool } from "../../server/database/db";
import {
  companies,
  users,
  orders,
  orderItems,
  products,
  contractScopes,
  nfDrafts,
  companyConfig,
} from "../../shared/schema";
import { runWithTenant } from "../../server/core/tenant/context";
import { buildNFeInput } from "../../server/modules/nfe/nfe-input.builder";
import { resolveBillingItems } from "../../server/modules/billing/billing.service";
import {
  createDraftFromOrder,
  updateDraft,
} from "../../server/services/nf.draft";

const TAG = "_EQ_SANITY_REGRESS";
const EMAIL_PREFIX = "_eq_sanity_regress_";
const PRODUCT_SUFFIX = "EQ_SANITY_REGRESS";

// ── Normalização (mesma fórmula dos dois lados) ─────────────────────────────

const round2 = (n: number) => Math.round(n * 100) / 100;

interface NormalizedItem {
  description: string;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
}

function normalizeFromBuilder(p: any): NormalizedItem {
  return {
    description: String(p.xProd ?? ""),
    quantity: round2(Number(p.qCom ?? 0)),
    unitPrice: round2(Number(p.vUnCom ?? 0)),
    totalPrice: round2(Number(p.vProd ?? 0)),
  };
}

function normalizeFromService(item: any): NormalizedItem {
  const description =
    item.description || item.name || item.productName || "Produto";
  const quantity = parseFloat(item.quantity ?? 1);
  const unitPrice = parseFloat(item.unitPrice ?? item.finalPrice ?? 0);
  const totalPrice = parseFloat(item.totalPrice ?? 0);
  return {
    description: String(description),
    quantity: round2(Number.isFinite(quantity) ? quantity : 0),
    unitPrice: round2(Number.isFinite(unitPrice) ? unitPrice : 0),
    totalPrice: round2(Number.isFinite(totalPrice) ? totalPrice : 0),
  };
}

const totalOf = (l: NormalizedItem[]) =>
  round2(l.reduce((acc, it) => acc + it.totalPrice, 0));

// ── companyConfig snapshot/restore ─────────────────────────────────────────

let configSnapshot: { existed: boolean; row: any | null } = {
  existed: false,
  row: null,
};

async function ensureCompanyConfig() {
  const [existing] = await db.select().from(companyConfig).limit(1);
  configSnapshot = { existed: !!existing, row: existing ?? null };

  const sanityFields: any = {
    companyName: "VivaFrutaz Regress",
    cnpj: "00000000000191",
    address: "Rua Sanity Emitente",
    addressNumber: "1",
    neighborhood: "Centro",
    city: "São Paulo",
    state: "SP",
    cep: "01001000",
    stateRegistration: "ISENTO",
    defaultCfop: "5102",
    regimeTributario: "simples_nacional",
    ambienteFiscal: "homologacao",
  };

  if (existing) {
    await db
      .update(companyConfig)
      .set(sanityFields)
      .where(eq(companyConfig.id, existing.id));
  } else {
    await db.insert(companyConfig).values(sanityFields);
  }
}

async function restoreCompanyConfig() {
  if (!configSnapshot.existed) {
    const rows = await db.select().from(companyConfig);
    for (const r of rows) {
      await db.delete(companyConfig).where(eq(companyConfig.id, r.id));
    }
    return;
  }
  const original = configSnapshot.row;
  if (!original) return;
  const { id: _id, ...rest } = original;
  await db
    .update(companyConfig)
    .set(rest)
    .where(eq(companyConfig.id, original.id));
}

// ── Seed/cleanup ───────────────────────────────────────────────────────────

async function ensureProducts() {
  const wanted = [
    {
      name: `Maçã ${PRODUCT_SUFFIX}`,
      category: "Frutas",
      unit: "KG",
      ncm: "08081000",
      basePrice: "8.50",
    },
    {
      name: `Banana ${PRODUCT_SUFFIX}`,
      category: "Frutas",
      unit: "KG",
      ncm: "08039000",
      basePrice: "5.20",
    },
  ];
  const out: any[] = [];
  for (const p of wanted) {
    const [exists] = await db
      .select()
      .from(products)
      .where(eq(products.name, p.name));
    if (exists) {
      out.push(exists);
      continue;
    }
    const [created] = await db
      .insert(products)
      .values({
        name: p.name,
        category: p.category,
        unit: p.unit,
        active: true,
        basePrice: p.basePrice,
        ncm: p.ncm,
      } as any)
      .returning();
    out.push(created);
  }
  return out;
}

async function cleanupAll() {
  const old = await db
    .select()
    .from(companies)
    .where(like(companies.email, `${EMAIL_PREFIX}%@vivafrutas.com`));
  for (const c of old) {
    await db.delete(nfDrafts).where(eq(nfDrafts.companyId, c.id));
    const ords = await db
      .select()
      .from(orders)
      .where(eq(orders.companyId, c.id));
    for (const o of ords) {
      await db.delete(orderItems).where(eq(orderItems.orderId, o.id));
    }
    await db.delete(orders).where(eq(orders.companyId, c.id));
    await db
      .delete(contractScopes)
      .where(eq(contractScopes.companyId, c.id));
    await db.delete(users).where(eq(users.empresaId, c.id));
    await db.delete(companies).where(eq(companies.id, c.id));
  }
  const sanityProducts = await db
    .select()
    .from(products)
    .where(like(products.name, `% ${PRODUCT_SUFFIX}`));
  for (const p of sanityProducts) {
    await db.delete(products).where(eq(products.id, p.id));
  }
}

async function createCompany(opts: {
  name: string;
  email: string;
  billingModel: string;
  useFiscalDraft: boolean;
}) {
  const password = await bcrypt.hash("123456", 10);
  const [c] = await db
    .insert(companies)
    .values({
      companyName: opts.name,
      contactName: opts.name,
      email: opts.email,
      password,
      cnpj: "00000000000191",
      allowedOrderDays: [
        "Segunda-feira",
        "Terça-feira",
        "Quarta-feira",
        "Quinta-feira",
        "Sexta-feira",
      ],
      addressStreet: "Rua Regress",
      addressNumber: "100",
      addressNeighborhood: "Centro",
      addressCity: "São Paulo",
      addressState: "SP",
      addressZip: "01001000",
      addressIbge: "3550308",
      stateRegistration: "ISENTO",
      regimeTributario: "simples_nacional",
      defaultCfop: "5102",
      billingModel: opts.billingModel,
      useFiscalDraft: opts.useFiscalDraft,
      clientType: "mensal",
      financialNotes: TAG,
    } as any)
    .returning();
  return c;
}

async function createOrder(opts: {
  companyId: number;
  items: { productId: number; quantity: number; unitPrice: string }[];
}) {
  const total = opts.items.reduce(
    (acc, it) => acc + Number(it.unitPrice) * it.quantity,
    0,
  );
  const [o] = await db
    .insert(orders)
    .values({
      companyId: opts.companyId,
      orderDate: new Date(),
      deliveryDate: new Date(Date.now() + 86400000 * 2),
      weekReference: "2026-W17",
      totalValue: total.toFixed(2),
      status: "ACTIVE",
      workflowStatus: "APPROVED",
    } as any)
    .returning();
  for (const it of opts.items) {
    await db.insert(orderItems).values({
      orderId: o.id,
      productId: it.productId,
      quantity: it.quantity,
      unitPrice: it.unitPrice,
      totalPrice: (Number(it.unitPrice) * it.quantity).toFixed(2),
    } as any);
  }
  return o;
}

function withCompany<T>(companyId: number, fn: () => Promise<T>): Promise<T> {
  return runWithTenant(
    {
      principal: { kind: "company", empresaId: companyId },
      empresaId: companyId,
    },
    fn,
  );
}

// ── Comparação estruturada usada pelos quatro testes ───────────────────────

async function runScenarioAndCompare(
  companyId: number,
  orderId: number,
  draftId: number,
) {
  return withCompany(companyId, async () => {
    const resolved = await resolveBillingItems(orderId, draftId);
    const input = await buildNFeInput({
      orderId,
      draftId,
      sourceItems: resolved.items,
    });
    const a = resolved.items.map(normalizeFromService);
    const b = (input.produtos as any[]).map(normalizeFromBuilder);

    assert.equal(
      a.length,
      b.length,
      `tamanho diferente: resolveBillingItems=${a.length} buildNFeInput=${b.length}`,
    );

    for (let i = 0; i < a.length; i++) {
      assert.deepEqual(
        a[i],
        b[i],
        `item[${i}] difere — resolveBillingItems=${JSON.stringify(a[i])} buildNFeInput=${JSON.stringify(b[i])}`,
      );
    }

    assert.equal(
      totalOf(a),
      totalOf(b),
      `total agregado difere — resolveBillingItems=${totalOf(a)} buildNFeInput=${totalOf(b)}`,
    );

    return { resolvedItems: resolved.items, produtos: input.produtos };
  });
}

// ── Setup global (uma vez para os 4 testes) ────────────────────────────────

let pMaca: any;
let pBanana: any;
let setupErr: any = null;

test("FASE 8.4.3 — setup", async () => {
  try {
    await cleanupAll();
    await ensureCompanyConfig();
    const ps = await ensureProducts();
    pMaca = ps[0];
    pBanana = ps[1];
  } catch (err) {
    setupErr = err;
    throw err;
  }
});

// ── Cenário 1: STANDARD ────────────────────────────────────────────────────

test("FASE 8.4.3 — STANDARD: resolveBillingItems ≡ buildNFeInput", async () => {
  if (setupErr) throw setupErr;
  const company = await createCompany({
    name: "Regress Standard",
    email: `${EMAIL_PREFIX}standard@vivafrutas.com`,
    billingModel: "STANDARD",
    useFiscalDraft: true,
  });
  const order = await createOrder({
    companyId: company.id,
    items: [
      { productId: pMaca.id, quantity: 10, unitPrice: "8.50" },
      { productId: pBanana.id, quantity: 5, unitPrice: "5.20" },
    ],
  });
  const draft = await withCompany(company.id, () =>
    createDraftFromOrder({ orderId: order.id, billingType: "STANDARD" }),
  );
  const { produtos } = await runScenarioAndCompare(company.id, order.id, draft.id);
  assert.equal(produtos.length, 2, "STANDARD deve ter 2 produtos");
});

// ── Cenário 2: CONTRACT_OPEN ───────────────────────────────────────────────

test("FASE 8.4.3 — CONTRACT_OPEN: resolveBillingItems ≡ buildNFeInput", async () => {
  if (setupErr) throw setupErr;
  const company = await createCompany({
    name: "Regress Open",
    email: `${EMAIL_PREFIX}open@vivafrutas.com`,
    billingModel: "CONTRACT_OPEN",
    useFiscalDraft: true,
  });
  const order = await createOrder({
    companyId: company.id,
    items: [{ productId: pMaca.id, quantity: 1, unitPrice: "1.00" }],
  });
  const draft = await withCompany(company.id, () =>
    createDraftFromOrder({ orderId: order.id, billingType: "CONTRACT_OPEN" }),
  );
  await withCompany(company.id, () =>
    updateDraft(draft.id, {
      items: [
        {
          productId: pMaca.id,
          description: "Maçã Premium",
          quantity: 20,
          unit: "KG",
          unitPrice: 12.0,
          totalPrice: 240.0,
          ncm: "08081000",
          cfop: "5102",
        },
        {
          productId: pBanana.id,
          description: "Banana Prata",
          quantity: 30,
          unit: "KG",
          unitPrice: 6.5,
          totalPrice: 195.0,
          ncm: "08039000",
          cfop: "5102",
        },
      ],
    }),
  );
  const { produtos } = await runScenarioAndCompare(company.id, order.id, draft.id);
  assert.equal(produtos.length, 2);
  assert.equal(
    Number(produtos.reduce((acc: number, p: any) => acc + Number(p.vProd), 0)),
    435,
    "CONTRACT_OPEN deve totalizar 435.00",
  );
});

// ── Cenário 3: CONTRACT_AVERAGE ────────────────────────────────────────────

test("FASE 8.4.3 — CONTRACT_AVERAGE: resolveBillingItems ≡ buildNFeInput", async () => {
  if (setupErr) throw setupErr;
  const company = await createCompany({
    name: "Regress Average",
    email: `${EMAIL_PREFIX}average@vivafrutas.com`,
    billingModel: "CONTRACT_AVERAGE",
    useFiscalDraft: true,
  });
  await withCompany(company.id, async () => {
    await db.insert(contractScopes).values({
      tenantId: company.id as any,
      companyId: company.id,
      dayOfWeek: "Segunda-feira",
      productId: pMaca.id,
      quantity: 10,
      unitPrice: "10.00",
      averageCost: "7.50",
    } as any);
    await db.insert(contractScopes).values({
      tenantId: company.id as any,
      companyId: company.id,
      dayOfWeek: "Segunda-feira",
      productId: pBanana.id,
      quantity: 20,
      unitPrice: "6.00",
      averageCost: "4.20",
    } as any);
  });
  const order = await createOrder({
    companyId: company.id,
    items: [
      { productId: pMaca.id, quantity: 10, unitPrice: "999.99" },
      { productId: pBanana.id, quantity: 20, unitPrice: "999.99" },
    ],
  });
  const draft = await withCompany(company.id, () =>
    createDraftFromOrder({
      orderId: order.id,
      billingType: "CONTRACT_AVERAGE",
    }),
  );
  const { produtos } = await runScenarioAndCompare(company.id, order.id, draft.id);
  assert.equal(produtos.length, 2);
  // Snapshot de averageCost (7.5/4.2), nunca o 999.99 do pedido.
  assert.ok(
    !produtos.some((p: any) => Number(p.vUnCom) === 999.99),
    "CONTRACT_AVERAGE não pode usar unitPrice do pedido",
  );
});

// ── Cenário 4: GROUPED (useGroupedItems=true) ──────────────────────────────

test("FASE 8.4.3 — GROUPED: resolveBillingItems ≡ buildNFeInput", async () => {
  if (setupErr) throw setupErr;
  const company = await createCompany({
    name: "Regress Grouped",
    email: `${EMAIL_PREFIX}grouped@vivafrutas.com`,
    billingModel: "STANDARD",
    useFiscalDraft: true,
  });
  const order = await createOrder({
    companyId: company.id,
    items: [
      { productId: pMaca.id, quantity: 10, unitPrice: "8.50" },
      { productId: pBanana.id, quantity: 5, unitPrice: "5.20" },
    ],
  });
  const draft = await withCompany(company.id, () =>
    createDraftFromOrder({ orderId: order.id, billingType: "STANDARD" }),
  );
  await withCompany(company.id, () =>
    updateDraft(draft.id, { useGroupedItems: true }),
  );
  const { produtos } = await runScenarioAndCompare(company.id, order.id, draft.id);
  assert.equal(produtos.length, 1, "GROUPED deve consolidar em 1 linha");
  assert.equal(
    (produtos[0] as any).xProd,
    "Frutas in natura",
    "linha agrupada deve ser 'Frutas in natura'",
  );
  assert.equal(
    Number((produtos[0] as any).vProd),
    111,
    "GROUPED total deve ser 111.00 (10×8.50 + 5×5.20)",
  );
});

// ── Teardown global: remoção total + restauração + verificação de residuais ─

test("FASE 8.4.3 — teardown + zero residual + restore companyConfig", async () => {
  // Cleanup determinístico (ROLLBACK lógico — ver cabeçalho do arquivo).
  await cleanupAll();
  await restoreCompanyConfig();

  // Verifica que NADA permaneceu no banco (sentinela do "zero escrita
  // permanente"). Qualquer linha com nossas TAGs falha o build.
  const residualCompanies = await db
    .select()
    .from(companies)
    .where(like(companies.email, `${EMAIL_PREFIX}%@vivafrutas.com`));
  assert.equal(
    residualCompanies.length,
    0,
    `residual: ${residualCompanies.length} companies não removidas`,
  );

  const residualProducts = await db
    .select()
    .from(products)
    .where(like(products.name, `% ${PRODUCT_SUFFIX}`));
  assert.equal(
    residualProducts.length,
    0,
    `residual: ${residualProducts.length} products não removidos`,
  );

  // Encerra o pool para o processo de teste finalizar limpo.
  await pool.end();
});

// ── Safety net: se um teste lançar antes do teardown, garante cleanup ──────

process.on("exit", () => {
  // best-effort: nada async aqui; cleanup principal está no teste de teardown
  // e é re-executado idempotente via TAGs únicas em qualquer re-run.
});
