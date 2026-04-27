/**
 * STEP TEST — VALIDAÇÃO COMPLETA FISCAL (DRAFT → NF) — STEP FISCAL 2
 *
 * Cria 3 usuários + 3 empresas isolados (@vivafrutas.com), monta cenários
 * para STANDARD / CONTRACT_OPEN / CONTRACT_AVERAGE, dispara buildNFeInput
 * em cada cenário e devolve relatório JSON. Não toca em dados existentes.
 *
 * Uso: npx tsx scripts/test-fiscal-step2.ts
 */

import bcrypt from "bcryptjs";
import { and, eq, like } from "drizzle-orm";
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
import { buildNFeInput } from "../server/modules/nfe/nfe-input.builder";
import {
  createDraftFromOrder,
  updateDraft,
} from "../server/services/nf.draft";

const TEST_TAG = "STEP_FISCAL_2_TEST";
const errors: any[] = [];
const observations: string[] = [];

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

async function ensureProducts(): Promise<{ id: number; name: string; unit: string }[]> {
  const wanted = [
    { name: "Maçã Teste Fiscal", category: "Frutas", unit: "KG", ncm: "08081000", basePrice: "8.50" },
    { name: "Banana Teste Fiscal", category: "Frutas", unit: "KG", ncm: "08039000", basePrice: "5.20" },
  ];
  const out: any[] = [];
  for (const p of wanted) {
    const [exists] = await db.select().from(products).where(eq(products.name, p.name));
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
  // limpa drafts/orders/scopes/users/companies anteriores marcados como teste
  const oldCompanies = await db
    .select()
    .from(companies)
    .where(like(companies.email, "%@vivafrutas.com"));
  for (const c of oldCompanies) {
    await db.delete(nfDrafts).where(eq(nfDrafts.companyId, c.id));
    const ords = await db.select().from(orders).where(eq(orders.companyId, c.id));
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
      allowedOrderDays: ["Segunda-feira", "Terça-feira", "Quarta-feira", "Quinta-feira", "Sexta-feira"],
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

async function createUser(opts: { name: string; email: string; companyId: number }) {
  const password = await bcrypt.hash("123456", 10);
  const [u] = await db
    .insert(users)
    .values({
      empresaId: opts.companyId,
      name: opts.name,
      email: opts.email,
      password,
      role: "client",
      active: true,
    } as any)
    .returning();
  return u;
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

function check(label: string, cond: boolean, extra?: any) {
  if (!cond) {
    errors.push({ label, extra });
    console.log(`   ❌ ${label}`, extra ?? "");
    return false;
  }
  console.log(`   ✔ ${label}`);
  return true;
}

async function main() {
  console.log("=== STEP TEST FISCAL 2 ===\n");
  await cleanupPrevious();
  await ensureCompanyConfig();
  const prods = await ensureProducts();
  const [pMaca, pBanana] = prods;

  // ── FASE 1+2: usuários + empresas ──────────────────────────────────────────
  console.log("FASE 1+2: criando usuários e empresas");
  const cStandard = await createCompany({
    name: "Empresa Standard Teste",
    email: "fiscal.standard@vivafrutas.com",
    billingModel: "STANDARD",
    useFiscalDraft: false,
  });
  const cOpen = await createCompany({
    name: "Empresa Contrato Aberto Teste",
    email: "fiscal.open@vivafrutas.com",
    billingModel: "CONTRACT_OPEN",
    useFiscalDraft: true,
  });
  const cAverage = await createCompany({
    name: "Empresa Contrato Médio Teste",
    email: "fiscal.average@vivafrutas.com",
    billingModel: "CONTRACT_AVERAGE",
    useFiscalDraft: true,
  });
  const uStandard = await createUser({
    name: "User Standard",
    email: "fiscal.standard@vivafrutas.com",
    companyId: cStandard.id,
  });
  const uOpen = await createUser({
    name: "User Open",
    email: "fiscal.open@vivafrutas.com",
    companyId: cOpen.id,
  });
  const uAverage = await createUser({
    name: "User Average",
    email: "fiscal.average@vivafrutas.com",
    companyId: cAverage.id,
  });
  console.log("   companies:", cStandard.id, cOpen.id, cAverage.id);
  console.log("   users:    ", uStandard.id, uOpen.id, uAverage.id, "\n");

  // ── FASE 3: STANDARD ───────────────────────────────────────────────────────
  console.log("FASE 3: STANDARD — pedido com 2 itens, sem draft");
  const oStandard = await createOrder({
    companyId: cStandard.id,
    items: [
      { productId: pMaca.id, quantity: 10, unitPrice: "8.50" },
      { productId: pBanana.id, quantity: 5, unitPrice: "5.20" },
    ],
  });
  const standardExpected = 10 * 8.5 + 5 * 5.2; // 111
  check("totalValue do pedido = 111.00", Number(oStandard.totalValue) === standardExpected, {
    totalValue: oStandard.totalValue,
  });

  // ── FASE 4: CONTRACT_OPEN ──────────────────────────────────────────────────
  console.log("\nFASE 4: CONTRACT_OPEN — draft vazio + edição manual");
  const oOpen = await createOrder({
    companyId: cOpen.id,
    items: [{ productId: pMaca.id, quantity: 1, unitPrice: "1.00" }],
  });
  const draftOpen = await withCompany(cOpen.id, () =>
    createDraftFromOrder({ orderId: oOpen.id, billingType: "CONTRACT_OPEN" }),
  );
  check(
    "CONTRACT_OPEN inicia com items vazios",
    Array.isArray(draftOpen.items) && (draftOpen.items as any[]).length === 0,
    { items: draftOpen.items },
  );
  // edita items manualmente
  const manualItems = [
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
  ];
  const draftOpenUpd = await withCompany(cOpen.id, () =>
    updateDraft(draftOpen.id, { items: manualItems }),
  );
  check(
    "draft atualizado com 2 itens manuais",
    (draftOpenUpd.items as any[]).length === 2,
  );
  // build NF com draftId
  const nfeOpen = await buildNFeInput({ orderId: oOpen.id, draftId: draftOpen.id });
  check(
    "NF tem 2 produtos vindos do draft (não de order_items)",
    nfeOpen.produtos.length === 2,
    { produtos: nfeOpen.produtos.map((p: any) => p.xProd) },
  );
  check(
    "NF usa preços do draft (240 e 195)",
    nfeOpen.produtos.find((p: any) => p.xProd === "Maçã Premium")?.vProd === 240 &&
      nfeOpen.produtos.find((p: any) => p.xProd === "Banana Prata")?.vProd === 195,
    { produtos: nfeOpen.produtos },
  );

  // ── FASE 5: CONTRACT_AVERAGE ───────────────────────────────────────────────
  console.log("\nFASE 5: CONTRACT_AVERAGE — snapshot via averageCost");
  // cria contractScopes
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
  // pedido base com PREÇOS DIFERENTES (para provar que snapshot vem dos scopes, não do pedido)
  const oAverage = await createOrder({
    companyId: cAverage.id,
    items: [
      { productId: pMaca.id, quantity: 10, unitPrice: "999.99" },
      { productId: pBanana.id, quantity: 20, unitPrice: "999.99" },
    ],
  });
  const draftAvg = await withCompany(cAverage.id, () =>
    createDraftFromOrder({ orderId: oAverage.id, billingType: "CONTRACT_AVERAGE" }),
  );
  const draftAvgItems = draftAvg.items as any[];
  check(
    "CONTRACT_AVERAGE snapshotou 2 items dos contractScopes",
    draftAvgItems.length === 2,
    { items: draftAvgItems },
  );
  check(
    "preços do draft vêm de averageCost (7.50 e 4.20), não de unitPrice do pedido",
    draftAvgItems.some((i) => Number(i.unitPrice) === 7.5) &&
      draftAvgItems.some((i) => Number(i.unitPrice) === 4.2),
    { items: draftAvgItems },
  );
  // ALTERA contractScopes APÓS snapshot
  await withCompany(cAverage.id, () =>
    db
      .update(contractScopes)
      .set({ averageCost: "999.00" } as any)
      .where(eq(contractScopes.companyId, cAverage.id)),
  );
  const nfeAvg = await buildNFeInput({ orderId: oAverage.id, draftId: draftAvg.id });
  check(
    "snapshot preservado após alteração dos scopes (preços continuam 7.50/4.20)",
    nfeAvg.produtos.some((p: any) => Number(p.vUnCom) === 7.5) &&
      nfeAvg.produtos.some((p: any) => Number(p.vUnCom) === 4.2),
    { produtos: nfeAvg.produtos },
  );
  check(
    "NF NÃO usa preços do pedido (999.99)",
    !nfeAvg.produtos.some((p: any) => Number(p.vUnCom) === 999.99),
  );

  // ── FASE 6: useGroupedItems ────────────────────────────────────────────────
  console.log("\nFASE 6: useGroupedItems — agrupa em 'Frutas in natura'");
  await withCompany(cAverage.id, () =>
    updateDraft(draftAvg.id, { useGroupedItems: true }),
  );
  const nfeGrouped = await buildNFeInput({
    orderId: oAverage.id,
    draftId: draftAvg.id,
  });
  // total esperado = 10*7.50 + 20*4.20 = 75 + 84 = 159
  const expectedTotal = 159;
  check("NF agrupada tem exatamente 1 produto", nfeGrouped.produtos.length === 1, {
    produtos: nfeGrouped.produtos,
  });
  check(
    "produto único tem xProd='Frutas in natura'",
    nfeGrouped.produtos[0]?.xProd === "Frutas in natura",
    { xProd: nfeGrouped.produtos[0]?.xProd },
  );
  check(
    "qCom=1, vUnCom=vProd=159.00",
    nfeGrouped.produtos[0]?.qCom === 1 &&
      nfeGrouped.produtos[0]?.vProd === expectedTotal &&
      nfeGrouped.produtos[0]?.vUnCom === expectedTotal,
    { produto: nfeGrouped.produtos[0] },
  );

  // ── FASE 7: feature flag (auto-lookup) ─────────────────────────────────────
  console.log("\nFASE 7: feature flag — sem draftId, useFiscalDraft=true");
  // limpa o useGroupedItems para não poluir esta fase
  await withCompany(cOpen.id, () =>
    updateDraft(draftOpen.id, { useGroupedItems: false }),
  );
  const nfeAutoLookup = await buildNFeInput(oOpen.id); // sem draftId, assinatura legada
  check(
    "auto-lookup pegou draft do pedido (2 items, não 1 do pedido legado)",
    nfeAutoLookup.produtos.length === 2,
    { produtos: nfeAutoLookup.produtos.map((p: any) => p.xProd) },
  );

  // ── FASE 8: legado (STANDARD sem draft) ────────────────────────────────────
  console.log("\nFASE 8: legado — STANDARD sem draft");
  const nfeLegacy = await buildNFeInput(oStandard.id);
  check(
    "NF legacy tem 2 produtos (de order_items)",
    nfeLegacy.produtos.length === 2,
  );
  check(
    "NF legacy soma 111.00 (10*8.50 + 5*5.20)",
    Math.round(
      nfeLegacy.produtos.reduce((acc: number, p: any) => acc + Number(p.vProd), 0) *
        100,
    ) /
      100 ===
      standardExpected,
    { produtos: nfeLegacy.produtos },
  );
  // assinatura nova sem draftId, com useFiscalDraft=false → idêntico ao legado
  const nfeLegacyNewSig = await buildNFeInput({ orderId: oStandard.id });
  check(
    "assinatura nova (sem draftId) = assinatura legada",
    JSON.stringify(nfeLegacy.produtos) === JSON.stringify(nfeLegacyNewSig.produtos),
  );

  // ── RELATÓRIO ──────────────────────────────────────────────────────────────
  const report = {
    users: [
      { id: uStandard.id, email: uStandard.email, companyId: cStandard.id },
      { id: uOpen.id, email: uOpen.email, companyId: cOpen.id },
      { id: uAverage.id, email: uAverage.email, companyId: cAverage.id },
    ],
    companies: [
      {
        id: cStandard.id,
        email: cStandard.email,
        billingModel: cStandard.billingModel,
        useFiscalDraft: cStandard.useFiscalDraft,
      },
      {
        id: cOpen.id,
        email: cOpen.email,
        billingModel: cOpen.billingModel,
        useFiscalDraft: cOpen.useFiscalDraft,
      },
      {
        id: cAverage.id,
        email: cAverage.email,
        billingModel: cAverage.billingModel,
        useFiscalDraft: cAverage.useFiscalDraft,
      },
    ],
    orders: [
      { id: oStandard.id, companyId: cStandard.id, totalValue: oStandard.totalValue },
      { id: oOpen.id, companyId: cOpen.id, totalValue: oOpen.totalValue },
      { id: oAverage.id, companyId: cAverage.id, totalValue: oAverage.totalValue },
    ],
    drafts: [
      { id: draftOpen.id, billingType: "CONTRACT_OPEN", orderId: oOpen.id },
      { id: draftAvg.id, billingType: "CONTRACT_AVERAGE", orderId: oAverage.id },
    ],
    tests: {
      standard_ok:
        !errors.some((e) => e.label.includes("legacy") || e.label.includes("Standard") || e.label.includes("totalValue")),
      contract_open_ok: !errors.some(
        (e) => e.label.includes("CONTRACT_OPEN") || e.label.includes("draft atualizado") || e.label.includes("draft (240"),
      ),
      contract_average_ok: !errors.some(
        (e) =>
          e.label.includes("CONTRACT_AVERAGE") ||
          e.label.includes("snapshot") ||
          e.label.includes("averageCost") ||
          e.label.includes("999.99"),
      ),
      grouped_items_ok: !errors.some(
        (e) =>
          e.label.includes("agrupada") ||
          e.label.includes("Frutas in natura") ||
          e.label.includes("qCom=1"),
      ),
      feature_flag_ok: !errors.some((e) => e.label.includes("auto-lookup")),
      legacy_ok: !errors.some(
        (e) => e.label.includes("legacy") || e.label.includes("assinatura"),
      ),
    },
    errors,
    observations,
  };

  console.log("\n=== RELATÓRIO FINAL ===");
  console.log(JSON.stringify(report, null, 2));
  const allOk = Object.values(report.tests).every(Boolean) && errors.length === 0;
  console.log(
    "\n" +
      (allOk
        ? "✔ Sistema pronto para produção fiscal"
        : "❌ Ainda precisa ajustes — ver errors[]"),
  );
  await pool.end();
  process.exit(allOk ? 0 : 1);
}

main().catch((e) => {
  console.error("FATAL:", e);
  errors.push({ label: "FATAL", extra: String(e?.message || e) });
  pool.end().finally(() => process.exit(1));
});
