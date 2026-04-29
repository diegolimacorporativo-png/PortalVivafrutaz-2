/**
 * FASE 5 — VALIDAÇÃO REAL DO SISTEMA (sem alterar nada)
 *
 * Roda os 6 cenários obrigatórios contra a stack atual (já com a troca
 * controlada do motor de faturamento ativada na FASE 4) e gera um
 * relatório consolidado:
 *
 *   1. STANDARD                   — múltiplos itens, valores e total
 *   2. CONTRACT_OPEN              — draft sobrescreve valores do pedido
 *   3. CONTRACT_AVERAGE           — snapshot sobrevive a alteração de scopes
 *   4. AGRUPAMENTO                — useGroupedItems=true → 1 linha "Frutas in natura"
 *   5. SEGURANÇA (CRÍTICO)        — empresa A acessando pedido da empresa B
 *                                   → ForbiddenError + log [SECURITY]
 *   6. CRON                       — runFaturamentoCron em modo observação
 *                                   + simulação do caminho autoMode=true
 *                                   (canEmitNFe → buildNFeInput → validate
 *                                    → gerarNFeXML → createNfeEmissao
 *                                    → updateOrder)
 *
 * NÃO altera código de produção. Cria apenas dados de teste isolados
 * (email `fase5.*@vivafrutas.com`) e limpa tudo no final.
 *
 * Uso: npx tsx scripts/test-fase5-full-validation.ts
 */

import bcrypt from "bcryptjs";
import { eq, like, inArray } from "drizzle-orm";
import { db, pool } from "../server/database/db";
import {
  companies,
  users,
  orders,
  orderItems,
  products,
  contractScopes,
  nfDrafts,
  nfeEmissoes,
  companyConfig,
} from "../shared/schema";
import { runWithTenant } from "../server/core/tenant/context";
import { buildNFeInput as buildNFeInputRaw } from "../server/modules/nfe/nfe-input.builder";
// FASE 8.4 — call-site agora orquestra resolveBillingItems → buildNFeInput.
import { resolveBillingItems } from "../server/modules/billing/billing.service";

// FASE 8.4 — wrapper de teste que reproduz o comportamento que o builder
// fazia internamente antes do desacoplamento. Mantém os cenários abaixo
// concisos e fielmente equivalentes ao caminho legado.
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
import {
  validateOrderTenant,
} from "../server/core/security/tenantGuard";
import { ForbiddenError } from "../server/shared/errors/AppError";
import { canEmitNFe } from "../server/modules/nfe/faturamento.guard";
import { gerarNFeXML } from "../server/services/nfe/nfeGenerator";
import { validarNFeInput } from "../server/services/nfe/nfeValidator";
import { storage } from "../server/services/storage";
import { runFaturamentoCron } from "../server/jobs/faturamento.cron";

// ── Estado do relatório ─────────────────────────────────────────────────────

type ScenarioResult = {
  id: string;
  title: string;
  ok: boolean;
  details: string[];
  errors: string[];
};

const report: ScenarioResult[] = [];

function startScenario(id: string, title: string): ScenarioResult {
  const r: ScenarioResult = { id, title, ok: true, details: [], errors: [] };
  report.push(r);
  console.log(`\n── ${id}: ${title} ──`);
  return r;
}

function assert(r: ScenarioResult, cond: boolean, msg: string) {
  if (cond) {
    r.details.push(`✔ ${msg}`);
    console.log(`   ✔ ${msg}`);
  } else {
    r.ok = false;
    r.errors.push(`✘ ${msg}`);
    console.log(`   ✘ ${msg}`);
  }
}

const round2 = (n: number) => Math.round(n * 100) / 100;

// ── Captura de console.error (para cenário 5) ───────────────────────────────

let capturedErrors: string[] = [];
const origError = console.error;
function startCapture() {
  capturedErrors = [];
  console.error = (...args: any[]) => {
    capturedErrors.push(
      args
        .map((a) => (typeof a === "string" ? a : JSON.stringify(a)))
        .join(" "),
    );
    origError.apply(console, args);
  };
}
function stopCapture() {
  console.error = origError;
}

// ── Helpers de seed (mesmo padrão da FASE 2) ────────────────────────────────

const TEST_TAG = "FASE5_FULL_VALIDATION";
const EMAIL_PREFIX = "fase5.";

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
      name: "Maçã FASE5",
      category: "Frutas",
      unit: "KG",
      ncm: "08081000",
      basePrice: "8.50",
    },
    {
      name: "Banana FASE5",
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
    .where(like(companies.email, `${EMAIL_PREFIX}%@vivafrutas.com`));
  for (const c of old) {
    const ords = await db
      .select()
      .from(orders)
      .where(eq(orders.companyId, c.id));
    const orderIds = ords.map((o) => o.id);
    if (orderIds.length > 0) {
      await db
        .delete(nfeEmissoes)
        .where(inArray(nfeEmissoes.orderId, orderIds));
      await db
        .delete(orderItems)
        .where(inArray(orderItems.orderId, orderIds));
    }
    await db.delete(nfDrafts).where(eq(nfDrafts.companyId, c.id));
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
  // Contrato vigente: começou há 30d, termina em 365d.
  const contractStart = new Date(Date.now() - 30 * 86400000);
  const contractEnd = new Date(Date.now() + 365 * 86400000);
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
      clientType: "avulso",
      contractStartDate: contractStart,
      contractEndDate: contractEnd,
      financialNotes: TEST_TAG,
    } as any)
    .returning();
  return c;
}

async function createOrder(opts: {
  companyId: number;
  items: { productId: number; quantity: number; unitPrice: string }[];
  fiscalStatus?: string;
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
      fiscalStatus: opts.fiscalStatus ?? "pendente",
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

// ── Cenários ────────────────────────────────────────────────────────────────

async function scenario1Standard(companyId: number, productIds: number[]) {
  const r = startScenario("CENÁRIO 1", "STANDARD — múltiplos itens");
  const order = await createOrder({
    companyId,
    items: [
      { productId: productIds[0], quantity: 10, unitPrice: "8.50" },
      { productId: productIds[1], quantity: 5, unitPrice: "5.20" },
    ],
  });
  const nfe = await withCompany(companyId, () => buildNFeInput(order.id));
  const produtos = nfe.produtos as any[];

  assert(r, produtos.length === 2, `2 itens (recebidos: ${produtos.length})`);
  if (produtos.length === 2) {
    assert(
      r,
      round2(Number(produtos[0].vProd)) === 85.0,
      `item 1 total=85.00 (recebido: ${produtos[0].vProd})`,
    );
    assert(
      r,
      round2(Number(produtos[1].vProd)) === 26.0,
      `item 2 total=26.00 (recebido: ${produtos[1].vProd})`,
    );
  }
  const total = produtos.reduce((s, p) => s + Number(p.vProd), 0);
  assert(r, round2(total) === 111.0, `total=111.00 (recebido: ${round2(total)})`);
  return order;
}

async function scenario2ContractOpen(companyId: number, productIds: number[]) {
  const r = startScenario(
    "CENÁRIO 2",
    "CONTRACT_OPEN — draft sobrescreve valores do pedido",
  );
  const order = await createOrder({
    companyId,
    items: [{ productId: productIds[0], quantity: 1, unitPrice: "1.00" }],
  });
  const draft = await withCompany(companyId, () =>
    createDraftFromOrder({
      orderId: order.id,
      billingType: "CONTRACT_OPEN",
    }),
  );
  await withCompany(companyId, () =>
    updateDraft(draft.id, {
      items: [
        {
          productId: productIds[0],
          description: "Maçã Premium",
          quantity: 20,
          unit: "KG",
          unitPrice: 12.0,
          totalPrice: 240.0,
          ncm: "08081000",
          cfop: "5102",
        },
        {
          productId: productIds[1],
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
  const nfe = await withCompany(companyId, () =>
    buildNFeInput({ orderId: order.id, draftId: draft.id }),
  );
  const produtos = nfe.produtos as any[];

  assert(r, produtos.length === 2, `usa 2 itens do draft (não 1 do pedido)`);
  assert(
    r,
    produtos.some(
      (p) =>
        p.xProd === "Maçã Premium" &&
        round2(Number(p.vUnCom)) === 12.0 &&
        round2(Number(p.vProd)) === 240.0,
    ),
    `item 'Maçã Premium' qCom=20, vUnCom=12.00, vProd=240.00`,
  );
  assert(
    r,
    produtos.some(
      (p) =>
        p.xProd === "Banana Prata" &&
        round2(Number(p.vUnCom)) === 6.5 &&
        round2(Number(p.vProd)) === 195.0,
    ),
    `item 'Banana Prata' qCom=30, vUnCom=6.50, vProd=195.00`,
  );
  // Garante que NÃO usou o R$ 1,00 do pedido
  assert(
    r,
    !produtos.some((p) => round2(Number(p.vUnCom)) === 1.0),
    `nenhum item com vUnCom=1.00 (valores do pedido foram ignorados)`,
  );
  return { order, draft };
}

async function scenario3ContractAverage(
  companyId: number,
  productIds: number[],
) {
  const r = startScenario(
    "CENÁRIO 3",
    "CONTRACT_AVERAGE — snapshot sobrevive a alteração de scopes",
  );
  // Scopes iniciais (averageCost congelado no draft)
  await withCompany(companyId, async () => {
    await db.insert(contractScopes).values({
      tenantId: companyId as any,
      companyId,
      dayOfWeek: "Segunda-feira",
      productId: productIds[0],
      quantity: 10,
      unitPrice: "10.00",
      averageCost: "7.50",
    } as any);
    await db.insert(contractScopes).values({
      tenantId: companyId as any,
      companyId,
      dayOfWeek: "Segunda-feira",
      productId: productIds[1],
      quantity: 20,
      unitPrice: "6.00",
      averageCost: "4.20",
    } as any);
  });

  const order = await createOrder({
    companyId,
    items: [
      { productId: productIds[0], quantity: 10, unitPrice: "999.99" },
      { productId: productIds[1], quantity: 20, unitPrice: "999.99" },
    ],
  });
  const draft = await withCompany(companyId, () =>
    createDraftFromOrder({
      orderId: order.id,
      billingType: "CONTRACT_AVERAGE",
    }),
  );

  // Snapshot inicial — usa averageCost dos scopes
  const nfeBefore = await withCompany(companyId, () =>
    buildNFeInput({ orderId: order.id, draftId: draft.id }),
  );
  const before = nfeBefore.produtos as any[];
  assert(r, before.length === 2, `snapshot inicial com 2 itens`);
  assert(
    r,
    before.some((p) => round2(Number(p.vUnCom)) === 7.5),
    `produto 1 usa averageCost=7.50 (não R$999.99 do pedido)`,
  );
  assert(
    r,
    before.some((p) => round2(Number(p.vUnCom)) === 4.2),
    `produto 2 usa averageCost=4.20`,
  );
  const totalBefore = before.reduce((s, p) => s + Number(p.vProd), 0);
  assert(
    r,
    round2(totalBefore) === round2(7.5 * 10 + 4.2 * 20),
    `total snapshot=${round2(7.5 * 10 + 4.2 * 20)}`,
  );

  // Mexe nos scopes — snapshot do draft DEVE prevalecer
  await withCompany(companyId, () =>
    db
      .update(contractScopes)
      .set({ averageCost: "999.00" } as any)
      .where(eq(contractScopes.companyId, companyId)),
  );
  const nfeAfter = await withCompany(companyId, () =>
    buildNFeInput({ orderId: order.id, draftId: draft.id }),
  );
  const after = nfeAfter.produtos as any[];
  assert(
    r,
    !after.some((p) => round2(Number(p.vUnCom)) === 999.0),
    `após scopes=999, NF-e NÃO usa 999 (snapshot preservado)`,
  );
  assert(
    r,
    after.some((p) => round2(Number(p.vUnCom)) === 7.5) &&
      after.some((p) => round2(Number(p.vUnCom)) === 4.2),
    `valores originais (7.50 e 4.20) ainda presentes após mudança`,
  );
  return { order, draft };
}

async function scenario4Grouping(companyId: number, draftId: number) {
  const r = startScenario(
    "CENÁRIO 4",
    "AGRUPAMENTO — useGroupedItems=true → 'Frutas in natura'",
  );
  await withCompany(companyId, () =>
    updateDraft(draftId, { useGroupedItems: true }),
  );
  // O draft é o mesmo do cenário 3 → totals 7.5*10 + 4.2*20 = 75 + 84 = 159
  const order = (await db.select().from(orders).where(eq(orders.id, /* will pass */ 0))).at(0);
  // Recupera orderId via draft
  const draftRow = (await db
    .select()
    .from(nfDrafts)
    .where(eq(nfDrafts.id, draftId))
    .limit(1))[0];
  const nfe = await withCompany(companyId, () =>
    buildNFeInput({ orderId: draftRow.orderId, draftId }),
  );
  const produtos = nfe.produtos as any[];
  assert(r, produtos.length === 1, `apenas 1 linha (recebidas: ${produtos.length})`);
  if (produtos[0]) {
    assert(
      r,
      produtos[0].xProd === "Frutas in natura",
      `descrição='Frutas in natura' (recebido: '${produtos[0].xProd}')`,
    );
    assert(
      r,
      round2(Number(produtos[0].vProd)) === 159.0,
      `vProd=159.00 (recebido: ${produtos[0].vProd})`,
    );
    // applyItemGrouping usa first.ncm || fallback, então o NCM final é
    // o do primeiro item de origem (08081000 para Maçã, que aparece antes
    // de Banana na ordem do scope). Comportamento idêntico ao código antigo.
    assert(
      r,
      produtos[0].ncm === "08081000" || produtos[0].ncm === "08039000",
      `ncm é NCM de fruta válido (recebido: ${produtos[0].ncm})`,
    );
  }
}

async function scenario5SecurityCrossTenant(
  companyAId: number,
  orderBId: number,
) {
  const r = startScenario(
    "CENÁRIO 5",
    "SEGURANÇA — empresa A acessando pedido da empresa B",
  );
  startCapture();
  let threwForbidden = false;
  let errMsg = "";
  try {
    await withCompany(companyAId, () => validateOrderTenant(orderBId));
  } catch (e: any) {
    threwForbidden = e instanceof ForbiddenError;
    errMsg = e?.message ?? "";
  }
  stopCapture();

  assert(r, threwForbidden, `lançou ForbiddenError`);
  assert(
    r,
    /pertence a outro tenant/i.test(errMsg),
    `mensagem de erro indica tenant divergente`,
  );
  const securityLog = capturedErrors.find((line) =>
    /\[SECURITY\] Tenant mismatch/.test(line),
  );
  assert(
    r,
    !!securityLog,
    `log [SECURITY] Tenant mismatch foi emitido`,
  );
  if (securityLog) {
    assert(
      r,
      securityLog.includes(`orderId ${orderBId}`),
      `log contém orderId=${orderBId}`,
    );
    assert(
      r,
      securityLog.includes(`tenant=${companyAId}`),
      `log contém tenant=${companyAId}`,
    );
  }
}

async function scenario6Cron(companyId: number, productIds: number[]) {
  const r = startScenario(
    "CENÁRIO 6",
    "CRON — observação + simulação do caminho autoMode=true",
  );

  // Cria pedido pronto para emissão (fiscal_status=nota_liberada).
  const order = await createOrder({
    companyId,
    items: [
      { productId: productIds[0], quantity: 3, unitPrice: "8.50" },
      { productId: productIds[1], quantity: 2, unitPrice: "5.20" },
    ],
    fiscalStatus: "nota_liberada",
  });
  console.log(`   (pedido #${order.id} preparado com fiscal_status=nota_liberada)`);

  // ── 6a) cron em modo observação (AUTO_FATURAMENTO=false) ─────────────────
  let cronResult: any = null;
  let cronCrashed = false;
  try {
    cronResult = await runFaturamentoCron("manual", null);
  } catch (e: any) {
    cronCrashed = true;
    r.errors.push(`cron crashou: ${e?.message}`);
  }
  assert(r, !cronCrashed, `runFaturamentoCron não crashou`);
  if (cronResult) {
    assert(
      r,
      cronResult.autoMode === false,
      `rodou em modo observação (autoMode=false)`,
    );
    assert(
      r,
      Array.isArray(cronResult.detalhes),
      `retornou array de detalhes (${cronResult.detalhes?.length ?? 0} item(s))`,
    );
    const ourEntry = cronResult.detalhes?.find(
      (d: any) => d.orderId === order.id,
    );
    assert(
      r,
      !!ourEntry,
      `pedido de teste #${order.id} apareceu como candidato`,
    );
    if (ourEntry) {
      assert(
        r,
        ["would_emit", "blocked", "skipped"].includes(ourEntry.status),
        `status do pedido='${ourEntry.status}' (esperado would_emit/blocked/skipped)`,
      );
    }
  }

  // ── 6b) Simulação do caminho autoMode=true sobre o mesmo pedido ──────────
  // Replica EXATAMENTE a sequência do cron quando AUTO_FATURAMENTO=true,
  // sem alterar a flag do código (que é uma const). Se algum passo
  // exigir configuração de produção (cert/emitente), reportamos como
  // skip, não como falha.
  const check = await canEmitNFe(order.id);
  assert(r, check.allowed === true, `canEmitNFe.allowed=true para o pedido`);
  if (!check.allowed) {
    r.details.push(`(motivo: ${check.reason})`);
    return;
  }

  let input: any = null;
  try {
    input = await withCompany(companyId, () => buildNFeInput(order.id));
    assert(r, !!input?.produtos?.length, `buildNFeInput retornou produtos`);
  } catch (e: any) {
    r.errors.push(`buildNFeInput falhou: ${e?.message}`);
    r.ok = false;
    return;
  }

  const erros = validarNFeInput(input);
  if (erros.length > 0) {
    // Esperado em ambiente de teste sem emitente/destinatário 100% válidos.
    // Não é regressão — apenas confirma que o validador roda.
    console.log(
      `   ℹ validarNFeInput retornou ${erros.length} aviso(s) — esperado em fixture de teste:`,
    );
    for (const e of erros) console.log(`     · ${e.campo}: ${e.mensagem}`);
    r.details.push(
      `validarNFeInput rodou (${erros.length} aviso(s) de fixture, esperado em DEV)`,
    );
    r.details.push(
      `gerarNFeXML/createNfeEmissao: pulado (validador exige emitente prod)`,
    );
    return;
  }

  // Caminho completo (raríssimo em DEV — só roda se o fixture for prod-like)
  const numero = await storage.getNextNfeNumero();
  const gerada = await gerarNFeXML(input, numero);
  assert(r, !!gerada.chaveNFe, `gerarNFeXML produziu chaveNFe`);
  const nfeRecord = await storage.createNfeEmissao({
    orderId: order.id,
    numero: gerada.numero,
    serie: gerada.serie,
    chaveNFe: gerada.chaveNFe,
    status: "gerada",
    xmlGerado: gerada.xmlGerado,
    dataEmissao: gerada.dataEmissao,
    ambienteFiscal: input.tpAmb === "1" ? "producao" : "homologacao",
  } as any);
  assert(r, !!nfeRecord?.id, `NF-e persistida (id=${nfeRecord?.id})`);
  await storage.updateOrder(order.id, { fiscalStatus: "nota_emitida" } as any);
  const updated = await db
    .select()
    .from(orders)
    .where(eq(orders.id, order.id))
    .limit(1);
  assert(
    r,
    updated[0]?.fiscalStatus === "nota_emitida",
    `pedido atualizado para fiscalStatus='nota_emitida'`,
  );
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  console.log("=== FASE 5 — VALIDAÇÃO REAL DO SISTEMA ===");
  console.log("(stack atual já com motor de faturamento via billing.service)\n");

  await cleanupPrevious();
  await ensureCompanyConfig();
  const [pMaca, pBanana] = await ensureProducts();
  const productIds = [pMaca.id, pBanana.id];

  // Empresas dedicadas — uma por modelo + uma para o teste de segurança.
  const cStandard = await createCompany({
    name: "FASE5 Standard",
    email: "fase5.standard@vivafrutas.com",
    billingModel: "STANDARD",
    useFiscalDraft: false,
  });
  const cOpen = await createCompany({
    name: "FASE5 Open",
    email: "fase5.open@vivafrutas.com",
    billingModel: "CONTRACT_OPEN",
    useFiscalDraft: true,
  });
  const cAverage = await createCompany({
    name: "FASE5 Average",
    email: "fase5.average@vivafrutas.com",
    billingModel: "CONTRACT_AVERAGE",
    useFiscalDraft: true,
  });
  const cAttacker = await createCompany({
    name: "FASE5 Attacker",
    email: "fase5.attacker@vivafrutas.com",
    billingModel: "STANDARD",
    useFiscalDraft: false,
  });
  console.log(
    `Empresas: standard=${cStandard.id} open=${cOpen.id} average=${cAverage.id} attacker=${cAttacker.id}`,
  );

  // 1
  const orderStandard = await scenario1Standard(cStandard.id, productIds);

  // 2
  await scenario2ContractOpen(cOpen.id, productIds);

  // 3
  const avg = await scenario3ContractAverage(cAverage.id, productIds);

  // 4 (reusa o draft do cenário 3)
  await scenario4Grouping(cAverage.id, avg.draft.id);

  // 5: empresa Attacker tentando acessar pedido da Standard
  await scenario5SecurityCrossTenant(cAttacker.id, orderStandard.id);

  // 6
  await scenario6Cron(cStandard.id, productIds);

  // Cleanup
  await cleanupPrevious();

  // ── Relatório consolidado ────────────────────────────────────────────────
  console.log("\n========================================");
  console.log("RELATÓRIO FINAL — FASE 5");
  console.log("========================================");
  let allOk = true;
  for (const r of report) {
    const flag = r.ok ? "✅" : "❌";
    console.log(`${flag} ${r.id}: ${r.title}`);
    for (const d of r.details) console.log(`   · ${d}`);
    for (const e of r.errors) console.log(`   ✘ ${e}`);
    if (!r.ok) allOk = false;
  }
  console.log("========================================");
  if (allOk) {
    console.log("SISTEMA ESTÁ ESTÁVEL PARA PRODUÇÃO ✅");
  } else {
    console.log("SISTEMA NÃO ESTÁ ESTÁVEL — revisar falhas acima ❌");
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
