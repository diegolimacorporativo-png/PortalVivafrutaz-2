/**
 * STEP TEST — EQUIVALÊNCIA: buildNFeInput  vs  resolveBillingItems.
 *
 * Compara, item a item, a saída atual de `buildNFeInput` (campo `produtos`)
 * com a saída do novo `resolveBillingItems` (campo `items`) — para os
 * 4 cenários obrigatórios:
 *
 *   1. STANDARD                — pedido com múltiplos itens, sem draft.
 *   2. CONTRACT_OPEN           — draft manual com valores ≠ do pedido.
 *   3. CONTRACT_AVERAGE        — snapshot via contract_scopes.averageCost,
 *                                e re-execução após alterar scopes (snapshot
 *                                deve permanecer).
 *   4. useGroupedItems=true    — agrupa em 1 linha "Frutas in natura"
 *                                com qCom=1 e vUnCom=vProd=Σ totalPrice.
 *
 * Não modifica buildNFeInput, billing.service.ts, routes.ts, storage.ts
 * nem nenhum endpoint. Cria/limpa apenas dados de teste com domínio
 * @vivafrutas.com (TEST_TAG marcado em financialNotes).
 *
 * Uso: npx tsx scripts/test-billing-equivalence.ts
 */

import bcrypt from "bcryptjs";
import { eq, like } from "drizzle-orm";
import { db, pool } from "../server/database/db";
import {
  companies,
  users,
  orders,
  orderItems,
  products,
  contractScopes,
  nfDrafts,
  companyConfig,
} from "../shared/schema";
import { runWithTenant } from "../server/core/tenant/context";
import { buildNFeInput as buildNFeInputRaw } from "../server/modules/nfe/nfe-input.builder";
import { resolveBillingItems } from "../server/modules/billing/billing.service";

// FASE 8.4 — wrapper de teste que reproduz o comportamento que o builder
// fazia internamente antes do desacoplamento. Este teste foi originalmente
// escrito para validar a equivalência (quando o acoplamento existia); após
// FASE 8.4 a equivalência é trivialmente verdadeira (o builder consome o
// próprio output do resolveBillingItems via call-site), mas o teste
// continua útil como guard de regressão de XML.
async function buildNFeInput(arg: number | { orderId: number; draftId?: number }) {
  const opts = typeof arg === "number" ? { orderId: arg } : arg;
  const resolved = await resolveBillingItems(opts.orderId, opts.draftId);
  return buildNFeInputRaw({
    orderId: opts.orderId,
    draftId: opts.draftId,
    sourceItems: resolved.items,
  });
}
import {
  createDraftFromOrder,
  updateDraft,
} from "../server/services/nf.draft";

const TEST_TAG = "TEST_BILLING_EQUIVALENCE";
const divergences: Array<{
  scenario: string;
  detail: any;
}> = [];

// ── Normalização (CRÍTICA — mesma fórmula dos 2 lados) ──────────────────────

interface NormalizedItem {
  description: string;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Normaliza um item do array `produtos` retornado por `buildNFeInput`.
 * Mantém EXATAMENTE o mapeamento que o builder faz internamente:
 *   xProd      → description
 *   qCom       → quantity
 *   vUnCom     → unitPrice
 *   vProd      → totalPrice
 */
function normalizeFromBuilder(p: any): NormalizedItem {
  return {
    description: String(p.xProd ?? ""),
    quantity: round2(Number(p.qCom ?? 0)),
    unitPrice: round2(Number(p.vUnCom ?? 0)),
    totalPrice: round2(Number(p.vProd ?? 0)),
  };
}

/**
 * Normaliza um item devolvido por `resolveBillingItems`. Aplica a MESMA
 * cadeia de fallbacks que o builder usa em `produtos.map(...)` (linha
 * 246+ de nfe-input.builder.ts) para garantir comparação justa quando
 * a fonte é `order_items` (que pode não ter `description`).
 *
 *   item.description || item.name || item.productName || "Produto"
 *   parseFloat(item.quantity || 1)
 *   parseFloat(item.unitPrice || item.finalPrice || 0)
 *   parseFloat(item.totalPrice || 0)
 */
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

function compareLists(
  scenario: string,
  listA: NormalizedItem[],
  listB: NormalizedItem[],
): boolean {
  if (listA.length !== listB.length) {
    divergences.push({
      scenario,
      detail: {
        reason: "tamanho diferente",
        a_length: listA.length,
        b_length: listB.length,
        a: listA,
        b: listB,
      },
    });
    console.log(
      `   ❌ tamanho diferente — buildNFeInput=${listA.length} | resolveBillingItems=${listB.length}`,
    );
    return false;
  }

  let ok = true;
  for (let i = 0; i < listA.length; i++) {
    const a = listA[i];
    const b = listB[i];
    const sameDesc = a.description === b.description;
    const sameQty = a.quantity === b.quantity;
    const sameUnit = a.unitPrice === b.unitPrice;
    const sameTotal = a.totalPrice === b.totalPrice;
    if (!sameDesc || !sameQty || !sameUnit || !sameTotal) {
      ok = false;
      divergences.push({
        scenario,
        detail: { index: i, a, b },
      });
      console.log(`   ❌ item ${i} difere`);
      console.log(`      A (buildNFeInput)      :`, a);
      console.log(`      B (resolveBillingItems):`, b);
    }
  }
  if (ok) console.log(`   ✔ ${listA.length} item(s) idênticos`);
  return ok;
}

// ── Helpers de seed (mesmo padrão de scripts/test-fiscal-step2.ts) ──────────

async function ensureCompanyConfig() {
  const [existing] = await db.select().from(companyConfig).limit(1);
  if (existing) return existing;
  const [created] = await db
    .insert(companyConfig)
    .values({
      companyName: "VivaFrutaz Teste",
      defaultCfop: "5102",
      regimeTributario: "simples_nacional",
    } as any)
    .returning();
  return created;
}

async function ensureProducts() {
  const wanted = [
    {
      name: "Maçã EQ Test",
      category: "Frutas",
      unit: "KG",
      ncm: "08081000",
      basePrice: "8.50",
    },
    {
      name: "Banana EQ Test",
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

async function cleanupPrevious() {
  const old = await db
    .select()
    .from(companies)
    .where(like(companies.email, "equiv.%@vivafrutas.com"));
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
    await db.delete(contractScopes).where(eq(contractScopes.companyId, c.id));
    await db.delete(users).where(eq(users.empresaId, c.id));
    await db.delete(companies).where(eq(companies.id, c.id));
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
      addressStreet: "Rua Teste",
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
      financialNotes: TEST_TAG,
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

// ── Casos de teste (envolvem 1 cenário cada) ────────────────────────────────

async function runScenario(
  label: string,
  orderId: number,
  draftId?: number,
): Promise<boolean> {
  console.log(`\n── ${label} ──`);
  const nfe = await buildNFeInput(
    draftId ? { orderId, draftId } : orderId,
  );
  const { items } = await resolveBillingItems(orderId, draftId);

  const a = (nfe.produtos as any[]).map(normalizeFromBuilder);
  const b = items.map(normalizeFromService);

  return compareLists(label, a, b);
}

async function main() {
  console.log("=== TEST: BILLING EQUIVALENCE ===");
  console.log("(buildNFeInput.produtos  vs  resolveBillingItems.items)\n");

  await cleanupPrevious();
  await ensureCompanyConfig();
  const [pMaca, pBanana] = await ensureProducts();

  // ── Setup empresas ────────────────────────────────────────────────────────
  const cStandard = await createCompany({
    name: "Equiv Standard",
    email: "equiv.standard@vivafrutas.com",
    billingModel: "STANDARD",
    useFiscalDraft: false,
  });
  const cOpen = await createCompany({
    name: "Equiv Open",
    email: "equiv.open@vivafrutas.com",
    billingModel: "CONTRACT_OPEN",
    useFiscalDraft: true,
  });
  const cAverage = await createCompany({
    name: "Equiv Average",
    email: "equiv.average@vivafrutas.com",
    billingModel: "CONTRACT_AVERAGE",
    useFiscalDraft: true,
  });
  console.log("Empresas:", cStandard.id, cOpen.id, cAverage.id);

  // ── 1) STANDARD — múltiplos itens, sem draft ─────────────────────────────
  const oStandard = await createOrder({
    companyId: cStandard.id,
    items: [
      { productId: pMaca.id, quantity: 10, unitPrice: "8.50" },
      { productId: pBanana.id, quantity: 5, unitPrice: "5.20" },
    ],
  });
  const okStandard = await withCompany(cStandard.id, () =>
    runScenario("CENÁRIO 1: STANDARD (sem draft)", oStandard.id),
  );

  // ── 2) CONTRACT_OPEN — draft manual com valores ≠ do pedido ──────────────
  const oOpen = await createOrder({
    companyId: cOpen.id,
    items: [{ productId: pMaca.id, quantity: 1, unitPrice: "1.00" }],
  });
  const draftOpen = await withCompany(cOpen.id, () =>
    createDraftFromOrder({
      orderId: oOpen.id,
      billingType: "CONTRACT_OPEN",
    }),
  );
  await withCompany(cOpen.id, () =>
    updateDraft(draftOpen.id, {
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
  const okOpen = await withCompany(cOpen.id, () =>
    runScenario(
      "CENÁRIO 2: CONTRACT_OPEN (draft manual, valores ≠ do pedido)",
      oOpen.id,
      draftOpen.id,
    ),
  );

  // ── 3) CONTRACT_AVERAGE — snapshot via contract_scopes ───────────────────
  await withCompany(cAverage.id, async () => {
    await db.insert(contractScopes).values({
      tenantId: cAverage.id as any,
      companyId: cAverage.id,
      dayOfWeek: "Segunda-feira",
      productId: pMaca.id,
      quantity: 10,
      unitPrice: "10.00",
      averageCost: "7.50",
    } as any);
    await db.insert(contractScopes).values({
      tenantId: cAverage.id as any,
      companyId: cAverage.id,
      dayOfWeek: "Segunda-feira",
      productId: pBanana.id,
      quantity: 20,
      unitPrice: "6.00",
      averageCost: "4.20",
    } as any);
  });
  const oAverage = await createOrder({
    companyId: cAverage.id,
    items: [
      { productId: pMaca.id, quantity: 10, unitPrice: "999.99" },
      { productId: pBanana.id, quantity: 20, unitPrice: "999.99" },
    ],
  });
  const draftAvg = await withCompany(cAverage.id, () =>
    createDraftFromOrder({
      orderId: oAverage.id,
      billingType: "CONTRACT_AVERAGE",
    }),
  );
  const okAverageBefore = await withCompany(cAverage.id, () =>
    runScenario(
      "CENÁRIO 3a: CONTRACT_AVERAGE (snapshot inicial)",
      oAverage.id,
      draftAvg.id,
    ),
  );

  // ── 4) useGroupedItems=true ──────────────────────────────────────────────
  await withCompany(cAverage.id, () =>
    updateDraft(draftAvg.id, { useGroupedItems: true }),
  );
  const okGrouped = await withCompany(cAverage.id, () =>
    runScenario(
      "CENÁRIO 4: useGroupedItems=true (Frutas in natura)",
      oAverage.id,
      draftAvg.id,
    ),
  );
  // valida regra do agrupamento (1 item, descrição fixa, vTotal=159)
  const nfeGroupedCheck = await withCompany(cAverage.id, () =>
    buildNFeInput({ orderId: oAverage.id, draftId: draftAvg.id }),
  );
  const groupedRulesOk =
    (nfeGroupedCheck.produtos as any[]).length === 1 &&
    (nfeGroupedCheck.produtos as any[])[0].xProd === "Frutas in natura" &&
    Number((nfeGroupedCheck.produtos as any[])[0].vProd) === 159;
  console.log(
    groupedRulesOk
      ? "   ✔ regra do agrupamento confere (1 item, 'Frutas in natura', vTotal=159)"
      : "   ❌ regra do agrupamento NÃO confere",
  );
  if (!groupedRulesOk) {
    divergences.push({
      scenario: "CENÁRIO 4: regra de agrupamento",
      detail: nfeGroupedCheck.produtos,
    });
  }

  // ── EXTRA: re-roda CONTRACT_AVERAGE após alterar contract_scopes ─────────
  console.log("\n── EXTRA: alterando contract_scopes para 999.00 ──");
  await withCompany(cAverage.id, () =>
    db
      .update(contractScopes)
      .set({ averageCost: "999.00" } as any)
      .where(eq(contractScopes.companyId, cAverage.id)),
  );
  // limpa o agrupamento para comparar com o snapshot original (não agrupado)
  await withCompany(cAverage.id, () =>
    updateDraft(draftAvg.id, { useGroupedItems: false }),
  );
  const okAverageAfter = await withCompany(cAverage.id, () =>
    runScenario(
      "CENÁRIO 3b: CONTRACT_AVERAGE (após alterar scopes — snapshot deve ficar)",
      oAverage.id,
      draftAvg.id,
    ),
  );
  // garante que NÃO usa 999.00
  const nfeAfter = await withCompany(cAverage.id, () =>
    buildNFeInput({ orderId: oAverage.id, draftId: draftAvg.id }),
  );
  const snapshotPreserved = !(nfeAfter.produtos as any[]).some(
    (p: any) => Number(p.vUnCom) === 999,
  );
  console.log(
    snapshotPreserved
      ? "   ✔ snapshot preservado (NF não usa o novo averageCost=999)"
      : "   ❌ snapshot QUEBROU — NF passou a usar averageCost=999",
  );
  if (!snapshotPreserved) {
    divergences.push({
      scenario: "CENÁRIO 3b: snapshot quebrou",
      detail: nfeAfter.produtos,
    });
  }

  // ── Cleanup final ────────────────────────────────────────────────────────
  await cleanupPrevious();

  // ── Veredito ─────────────────────────────────────────────────────────────
  console.log("\n========================================");
  const allOk =
    okStandard &&
    okOpen &&
    okAverageBefore &&
    okGrouped &&
    groupedRulesOk &&
    okAverageAfter &&
    snapshotPreserved &&
    divergences.length === 0;

  if (allOk) {
    console.log("EQUIVALENCE OK ✅");
    console.log(
      "buildNFeInput.produtos  ≡  resolveBillingItems.items  (4 cenários)",
    );
  } else {
    console.log("EQUIVALENCE FAILED ❌");
    console.log(`Divergências: ${divergences.length}`);
    for (const d of divergences) {
      console.log(`  • [${d.scenario}]`, JSON.stringify(d.detail, null, 2));
    }
  }
  console.log("========================================\n");

  await pool.end();
  process.exit(allOk ? 0 : 1);
}

main().catch(async (err) => {
  console.error("FATAL:", err);
  try {
    await cleanupPrevious();
  } catch {}
  await pool.end();
  process.exit(1);
});
