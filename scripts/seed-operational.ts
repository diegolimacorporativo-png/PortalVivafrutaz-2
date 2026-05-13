/**
 * FASE 1.3 — ETAPA 2: Massa Operacional Controlada
 *
 * Cria dados realistas de simulação sem quebrar dados existentes.
 * TAG de identificação: [SEED-OP] em notes/observacoes/descricao
 *
 * REGRAS:
 *   - Idempotente: verifica existência antes de inserir
 *   - Nunca modifica dados existentes
 *   - Tenant isolation: empresaId=1 (VivaFrutaz) para todos os registros internos
 *   - Usa company_id das empresas clientes existentes (1=Acme Corp)
 *   - NF-e números 900-920 (longe da sequência real em 18)
 *
 * Execução: tsx scripts/seed-operational.ts
 */

import "../server/database/db"; // garante que dotenv está carregado
import { db } from "../server/database/db";
import { sql } from "drizzle-orm";
import bcrypt from "bcryptjs";

const SEED_TAG = "[SEED-OP]";
const TENANT_ID = 1; // VivaFrutaz (emitente / master tenant)
const NFE_SERIE = "001";
const NFE_NUMBER_START = 900; // longe da sequência real em 18

function log(msg: string) {
  console.log(`[SEED-OP] ${new Date().toISOString()} ${msg}`);
}

function rows(result: unknown): any[] {
  const r = result as any;
  if (Array.isArray(r)) return r;
  if (r && Array.isArray(r.rows)) return r.rows;
  return [];
}

// ── Helpers de data ──────────────────────────────────────────────────────────

function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().split("T")[0];
}

function daysFromNow(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString().split("T")[0];
}

function isoWeek(dateStr: string): string {
  const d = new Date(dateStr);
  const day = d.getDay() || 7;
  d.setDate(d.getDate() + 4 - day);
  const yearStart = new Date(d.getFullYear(), 0, 1);
  const week = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${d.getFullYear()}-W${String(week).padStart(2, "0")}`;
}

// Gera chave NF-e fake válida no formato correto (44 dígitos)
function fakeChaveNFe(numero: number): string {
  const cUF = "35"; // SP
  const aamm = "2605";
  const cnpj = "15415742000155"; // VIVAFRUTAZ
  const mod = "55";
  const serie = "001";
  const nNF = String(numero).padStart(9, "0");
  const tpEmis = "1";
  const cNF = String(Math.floor(Math.random() * 99999999)).padStart(8, "0");
  const base = `${cUF}${aamm}${cnpj}${mod}${serie}${nNF}${tpEmis}${cNF}`;
  return `${base}0`; // cDV=0 para seed (não enviado ao SEFAZ)
}

// ── ETAPA 2.1 — Client companies ─────────────────────────────────────────────

async function seedCompanies(): Promise<number[]> {
  log("ETAPA 2.1 — Verificando empresas clientes...");

  const SEED_COMPANIES = [
    {
      companyName: `${SEED_TAG} Hortifruti Central Ltda`,
      contactName: "Maria Souza",
      email: "seed-op-hortifruti@vivafrutaz.test",
      cnpj: null,
      phone: "(11) 3333-1001",
      clientType: "mensal",
      addressStreet: "Rua das Hortaliças",
      addressNumber: "42",
      addressNeighborhood: "Jardim Esperança",
      addressCity: "São Paulo",
      addressState: "SP",
      addressZip: "01310100",
    },
    {
      companyName: `${SEED_TAG} Mercado Bom Preço ME`,
      contactName: "João Pereira",
      email: "seed-op-mercadobom@vivafrutaz.test",
      cnpj: null,
      phone: "(11) 3333-1002",
      clientType: "semanal",
      addressStreet: "Av. Paulista",
      addressNumber: "1000",
      addressNeighborhood: "Bela Vista",
      addressCity: "São Paulo",
      addressState: "SP",
      addressZip: "01310100",
    },
    {
      companyName: `${SEED_TAG} Sacolão do Zé Eireli`,
      contactName: "José Santos",
      email: "seed-op-sacolaodze@vivafrutaz.test",
      cnpj: null,
      phone: "(11) 3333-1003",
      clientType: "mensal",
      addressStreet: "Rua da Feira",
      addressNumber: "7",
      addressNeighborhood: "Vila Prudente",
      addressCity: "São Paulo",
      addressState: "SP",
      addressZip: "03201000",
    },
  ];

  const pwHash = await bcrypt.hash("SeedOp2026!", 10);
  const createdIds: number[] = [];

  for (const co of SEED_COMPANIES) {
    const exists = rows(await db.execute(sql`SELECT id FROM companies WHERE email = ${co.email} LIMIT 1`));
    if (exists.length > 0) {
      log(`  SKIP companies: ${co.companyName} (já existe id=${exists[0].id})`);
      createdIds.push(exists[0].id);
      continue;
    }

    const r = rows(await db.execute(sql`
      INSERT INTO companies (
        company_name, contact_name, email, password, phone, cnpj,
        client_type, address_street, address_number, address_neighborhood,
        address_city, address_state, address_zip,
        allowed_order_days, active, billing_model, use_new_pricing,
        use_fiscal_draft, login_attempts, is_locked, beta_tester,
        must_change_password, password_temporary, token_version, created_at
      ) VALUES (
        ${co.companyName}, ${co.contactName}, ${co.email}, ${pwHash}, ${co.phone}, ${co.cnpj},
        ${co.clientType}, ${co.addressStreet}, ${co.addressNumber}, ${co.addressNeighborhood},
        ${co.addressCity}, ${co.addressState}, ${co.addressZip},
        '["Segunda-feira","Quarta-feira","Sexta-feira"]'::jsonb, true, 'STANDARD', false,
        false, 0, false, false,
        false, false, 0, NOW()
      ) RETURNING id
    `));
    const id = r[0]?.id;
    createdIds.push(id);
    log(`  CREATE company id=${id}: ${co.companyName}`);
  }

  return createdIds;
}

// ── ETAPA 2.2 — Orders in various states ─────────────────────────────────────

async function seedOrders(clientIds: number[]): Promise<number[]> {
  log("ETAPA 2.2 — Criando pedidos operacionais...");

  // Use mix of existing + seed companies
  const allClients = [1, ...clientIds]; // 1 = Acme Corp (existente)

  const ORDER_SCENARIOS = [
    // Acme Corp (id=1) — vários estados fiscais
    { code: "SEED-OP-001", clientId: 1, status: "CONFIRMED", workflow: "CREATED", fiscal: "nota_pendente", total: "450.00", daysOffset: -5 },
    { code: "SEED-OP-002", clientId: 1, status: "CONFIRMED", workflow: "APPROVED", fiscal: "nota_pendente", total: "820.00", daysOffset: -4 },
    { code: "SEED-OP-003", clientId: 1, status: "CONFIRMED", workflow: "INVOICED", fiscal: "nota_emitida", total: "1250.00", daysOffset: -10 },
    { code: "SEED-OP-004", clientId: 1, status: "DELIVERED", workflow: "DELIVERED", fiscal: "nota_emitida", total: "680.00", daysOffset: -12 },
    { code: "SEED-OP-005", clientId: 1, status: "CONFIRMED", workflow: "APPROVED", fiscal: "nota_liberada", total: "930.00", daysOffset: -3 },
    { code: "SEED-OP-006", clientId: 1, status: "CANCELLED", workflow: "CANCELLED", fiscal: "nota_pendente", total: "320.00", daysOffset: -8 },

    // Hortifruti Central (seed company 1)
    { code: "SEED-OP-007", clientId: allClients[1] ?? 1, status: "CONFIRMED", workflow: "CREATED", fiscal: "nota_pendente", total: "540.00", daysOffset: -2 },
    { code: "SEED-OP-008", clientId: allClients[1] ?? 1, status: "CONFIRMED", workflow: "APPROVED", fiscal: "nota_liberada", total: "1100.00", daysOffset: -6 },
    { code: "SEED-OP-009", clientId: allClients[1] ?? 1, status: "DELIVERED", workflow: "DELIVERED", fiscal: "nota_emitida", total: "760.00", daysOffset: -15 },

    // Mercado Bom Preço (seed company 2)
    { code: "SEED-OP-010", clientId: allClients[2] ?? 1, status: "CONFIRMED", workflow: "CREATED", fiscal: "nota_pendente", total: "290.00", daysOffset: -1 },
    { code: "SEED-OP-011", clientId: allClients[2] ?? 1, status: "CONFIRMED", workflow: "APPROVED", fiscal: "nota_pendente", total: "670.00", daysOffset: -7 },
    { code: "SEED-OP-012", clientId: allClients[2] ?? 1, status: "DELIVERED", workflow: "DELIVERED", fiscal: "nota_liberada", total: "1380.00", daysOffset: -20 },

    // Sacolão do Zé (seed company 3)
    { code: "SEED-OP-013", clientId: allClients[3] ?? 1, status: "CONFIRMED", workflow: "APPROVED", fiscal: "nota_liberada", total: "890.00", daysOffset: -9 },
    { code: "SEED-OP-014", clientId: allClients[3] ?? 1, status: "DELIVERED", workflow: "DELIVERED", fiscal: "nota_emitida", total: "2100.00", daysOffset: -25 },
    { code: "SEED-OP-015", clientId: allClients[3] ?? 1, status: "CONFIRMED", workflow: "CREATED", fiscal: "nota_pendente", total: "480.00", daysOffset: 2 },

    // Acme Corp — pedidos futuros
    { code: "SEED-OP-016", clientId: 1, status: "CONFIRMED", workflow: "CREATED", fiscal: "nota_pendente", total: "1560.00", daysOffset: 5 },
    { code: "SEED-OP-017", clientId: 1, status: "CONFIRMED", workflow: "APPROVED", fiscal: "nota_liberada", total: "780.00", daysOffset: 3 },
    { code: "SEED-OP-018", clientId: 1, status: "DELIVERED", workflow: "DELIVERED", fiscal: "nota_exportada", total: "2340.00", daysOffset: -30 },
  ];

  // Get existing products
  const prodRows = rows(await db.execute(sql`SELECT id, name, base_price FROM products WHERE empresa_id = ${TENANT_ID} ORDER BY id LIMIT 4`));

  const createdIds: number[] = [];

  for (const sc of ORDER_SCENARIOS) {
    // Check if order already exists
    const exists = rows(await db.execute(sql`SELECT id FROM orders WHERE order_code = ${sc.code} LIMIT 1`));
    if (exists.length > 0) {
      log(`  SKIP order: ${sc.code} (já existe id=${exists[0].id})`);
      createdIds.push(exists[0].id);
      continue;
    }

    const delivDate = new Date();
    delivDate.setDate(delivDate.getDate() + sc.daysOffset);
    const deliveryDate = delivDate.toISOString();
    const weekRef = isoWeek(delivDate.toISOString().split("T")[0]);

    const orderResult = rows(await db.execute(sql`
      INSERT INTO orders (
        order_code, status, workflow_status, fiscal_status,
        company_id, delivery_date, week_reference, total_value,
        order_note, created_at
      ) VALUES (
        ${sc.code}, ${sc.status}, ${sc.workflow}, ${sc.fiscal},
        ${sc.clientId}, ${deliveryDate}, ${weekRef}, ${sc.total},
        ${SEED_TAG + " Pedido de simulação operacional"},
        NOW() - (${Math.abs(sc.daysOffset)} || ' days')::interval
      ) RETURNING id
    `));

    const orderId = orderResult[0]?.id;
    if (!orderId) {
      log(`  ERROR: falha ao criar order ${sc.code}`);
      continue;
    }

    // Create order items (use available products)
    const numItems = 1 + (orderId % 3); // 1-3 items per order
    const usedProds = prodRows.slice(0, numItems);
    const perItem = (parseFloat(sc.total) / numItems).toFixed(2);

    for (const prod of usedProds) {
      const qty = 2 + (Math.floor(Math.random() * 8));
      const unitPrice = (parseFloat(perItem) / qty).toFixed(2);
      await db.execute(sql`
        INSERT INTO order_items (empresa_id, order_id, product_id, quantity, unit_price, total_price)
        VALUES (${TENANT_ID}, ${orderId}, ${prod.id}, ${qty}, ${unitPrice}, ${perItem})
      `);
    }

    createdIds.push(orderId);
    log(`  CREATE order id=${orderId}: ${sc.code} [${sc.workflow}/${sc.fiscal}] total=R$${sc.total}`);
  }

  return createdIds;
}

// ── ETAPA 2.3 — NF-e mock records ────────────────────────────────────────────

async function seedNfeEmissoes(orderIds: number[]): Promise<void> {
  log("ETAPA 2.3 — Criando registros NF-e mock (homologação)...");

  // Only create NF-e for INVOICED/DELIVERED orders
  const eligibleOrders = rows(await db.execute(sql`
    SELECT id, order_code FROM orders
    WHERE order_code LIKE 'SEED-OP-%'
      AND fiscal_status IN ('nota_emitida', 'nota_exportada')
    ORDER BY id LIMIT 8
  `));

  const NFE_SCENARIOS = [
    { status: "autorizada", cStat: "100", xMotivo: "Autorizado o uso da NF-e" },
    { status: "autorizada", cStat: "100", xMotivo: "Autorizado o uso da NF-e" },
    { status: "autorizada", cStat: "100", xMotivo: "Autorizado o uso da NF-e" },
    { status: "rejeitada", cStat: "539", xMotivo: "CNPJ do destinatário inválido [SEED-TEST]" },
    { status: "autorizada", cStat: "100", xMotivo: "Autorizado o uso da NF-e" },
    { status: "gerada", cStat: null, xMotivo: null },
    { status: "autorizada", cStat: "100", xMotivo: "Autorizado o uso da NF-e" },
    { status: "cancelada", cStat: "101", xMotivo: "Cancelamento de NF-e homologado [SEED-TEST]" },
  ];

  let numIdx = 0;

  for (let i = 0; i < eligibleOrders.length && i < NFE_SCENARIOS.length; i++) {
    const order = eligibleOrders[i];
    const sc = NFE_SCENARIOS[i];
    const nfeNum = String(NFE_NUMBER_START + numIdx);

    // Check if NF-e already exists for this order or number
    const existsOrder = rows(await db.execute(sql`SELECT id FROM nfe_emissoes WHERE order_id = ${order.id} LIMIT 1`));
    if (existsOrder.length > 0) {
      log(`  SKIP nfe_emissao for order ${order.id} (já existe)`);
      numIdx++;
      continue;
    }

    const existsNum = rows(await db.execute(sql`SELECT id FROM nfe_emissoes WHERE serie = ${NFE_SERIE} AND numero = ${nfeNum} LIMIT 1`));
    if (existsNum.length > 0) {
      log(`  SKIP nfe_emissao numero=${nfeNum} (já existe)`);
      numIdx++;
      continue;
    }

    const chave = fakeChaveNFe(NFE_NUMBER_START + numIdx);
    const dataEmissao = daysAgo(Math.abs(i * 2 + 1));
    const protocolo = sc.status === "autorizada" ? `135${String(Date.now()).slice(-10)}` : null;

    await db.execute(sql`
      INSERT INTO nfe_emissoes (
        order_id, numero, serie, chave_nfe, status,
        c_stat, x_motivo, data_emissao, ambiente_fiscal,
        protocolo, data_autorizacao, created_at
      ) VALUES (
        ${order.id}, ${nfeNum}, ${NFE_SERIE}, ${chave}, ${sc.status},
        ${sc.cStat}, ${sc.xMotivo ?? SEED_TAG + " NF-e mock"}, ${dataEmissao}, 'homologacao',
        ${protocolo},
        ${sc.status === "autorizada" ? sql`NOW() - (${i + 1} || ' days')::interval` : sql`NULL`},
        NOW() - (${i + 1} || ' days')::interval
      )
    `);

    log(`  CREATE nfe_emissao: numero=${nfeNum} serie=${NFE_SERIE} status=${sc.status} orderId=${order.id}`);
    numIdx++;
  }
}

// ── ETAPA 2.4 — Accounts Receivable ──────────────────────────────────────────

async function seedAccountsReceivable(orderIds: number[]): Promise<void> {
  log("ETAPA 2.4 — Criando contas a receber...");

  // Check if seed AR already exists
  const existsCheck = rows(await db.execute(sql`
    SELECT COUNT(*) as n FROM accounts_receivable WHERE descricao LIKE '%${sql.raw(SEED_TAG)}%'
  `));
  if (parseInt(existsCheck[0]?.n ?? "0") > 0) {
    log(`  SKIP accounts_receivable (já existem ${existsCheck[0].n} registros seed)`);
    return;
  }

  // Get seed orders
  const seedOrders = rows(await db.execute(sql`
    SELECT id, company_id, total_value FROM orders
    WHERE order_code LIKE 'SEED-OP-%' ORDER BY id LIMIT 10
  `));

  const AR_STATUSES = ["pendente", "pago", "pendente", "vencido", "pago", "pendente", "pago", "pendente", "vencido", "pago"];
  const FORMAS_PAGAMENTO = ["pix", "boleto", "pix", "boleto", "transferencia", "pix", "boleto", "pix", "boleto", "pix"];

  for (let i = 0; i < seedOrders.length; i++) {
    const order = seedOrders[i];
    const daysOff = i * 3;
    const emissao = daysAgo(daysOff + 5);
    const vencimento = daysAgo(daysOff - 7); // some already due, some future
    const status = AR_STATUSES[i];
    const forma = FORMAS_PAGAMENTO[i];

    await db.execute(sql`
      INSERT INTO accounts_receivable (
        empresa_id, company_id, order_id, descricao, valor,
        data_emissao, data_vencimento, status, forma_pagamento,
        pago_em, observacoes, created_at
      ) VALUES (
        ${TENANT_ID}, ${order.company_id}, ${order.id},
        ${SEED_TAG + ` Fatura pedido #${order.id}`},
        ${order.total_value}, ${emissao}, ${vencimento},
        ${status}, ${forma},
        ${status === "pago" ? sql`NOW() - (${i} || ' days')::interval` : sql`NULL`},
        ${SEED_TAG + " gerado por seed operacional"},
        NOW() - (${daysOff} || ' days')::interval
      )
    `);
    log(`  CREATE AR: ordem=${order.id} valor=R$${order.total_value} status=${status}`);
  }
}

// ── ETAPA 2.5 — Accounts Payable ─────────────────────────────────────────────

async function seedAccountsPayable(): Promise<void> {
  log("ETAPA 2.5 — Criando contas a pagar...");

  const existsCheck = rows(await db.execute(sql`
    SELECT COUNT(*) as n FROM accounts_payable WHERE descricao LIKE '%${sql.raw(SEED_TAG)}%'
  `));
  if (parseInt(existsCheck[0]?.n ?? "0") > 0) {
    log(`  SKIP accounts_payable (já existem ${existsCheck[0].n} registros seed)`);
    return;
  }

  const AP_DATA = [
    { fornecedor: "Fazenda Verde Ltda", desc: "Compra frutas semana 20", valor: "3200.00", venc: daysFromNow(10), cat: "fornecedor", status: "pendente" },
    { fornecedor: "Trans Rápido ME", desc: "Frete entrega zona sul", valor: "850.00", venc: daysAgo(3), cat: "logistica", status: "vencido" },
    { fornecedor: "Fazenda Verde Ltda", desc: "Compra frutas semana 19", valor: "2900.00", venc: daysAgo(7), cat: "fornecedor", status: "pago" },
    { fornecedor: "LimpezaTech Eireli", desc: "Material higienização galpão", valor: "420.00", venc: daysFromNow(5), cat: "operacional", status: "pendente" },
    { fornecedor: "Energia SP", desc: "Conta energia junho/26", valor: "1100.00", venc: daysFromNow(15), cat: "operacional", status: "pendente" },
    { fornecedor: "Sítio Boa Vista", desc: "Abastecimento frutas tropicais", valor: "1850.00", venc: daysAgo(2), cat: "fornecedor", status: "pago" },
    { fornecedor: "Trans Rápido ME", desc: "Frete entrega semana 21", valor: "920.00", venc: daysFromNow(7), cat: "logistica", status: "pendente" },
    { fornecedor: "Manutenção Frigorífico SA", desc: "Revisão câmara fria", valor: "650.00", venc: daysFromNow(20), cat: "operacional", status: "pendente" },
  ];

  for (const ap of AP_DATA) {
    await db.execute(sql`
      INSERT INTO accounts_payable (
        empresa_id, fornecedor, descricao, valor, data_vencimento,
        status, categoria, pago_em, observacoes, created_at
      ) VALUES (
        ${TENANT_ID}, ${ap.fornecedor}, ${SEED_TAG + " " + ap.desc}, ${ap.valor}, ${ap.venc},
        ${ap.status}, ${ap.cat},
        ${ap.status === "pago" ? sql`NOW()` : sql`NULL`},
        ${SEED_TAG + " seed operacional"},
        NOW()
      )
    `);
    log(`  CREATE AP: ${ap.fornecedor} R$${ap.valor} status=${ap.status}`);
  }
}

// ── ETAPA 2.6 — Inventory movements ─────────────────────────────────────────

async function seedInventoryMovements(): Promise<void> {
  log("ETAPA 2.6 — Criando movimentações de estoque...");

  const existsCheck = rows(await db.execute(sql`
    SELECT COUNT(*) as n FROM inventory_movements WHERE notes LIKE '%${sql.raw(SEED_TAG)}%'
  `));
  if (parseInt(existsCheck[0]?.n ?? "0") > 0) {
    log(`  SKIP inventory_movements (já existem ${existsCheck[0].n} registros seed)`);
    return;
  }

  const PRODUCTS = [
    { id: 1, name: "Banana", unit: "KG" },
    { id: 2, name: "Apple", unit: "KG" },
    { id: 3, name: "Melon", unit: "KG" },
    { id: 4, name: "Produto Auditoria", unit: "KG" },
  ];

  const MOVEMENTS = [
    { prod: PRODUCTS[0], type: "ENTRY",      qty: "500.000", bal: "500.000", ref: "order",   daysAgoN: 30 },
    { prod: PRODUCTS[0], type: "EXIT",       qty: "120.000", bal: "380.000", ref: "order",   daysAgoN: 25 },
    { prod: PRODUCTS[0], type: "EXIT",       qty: "95.000",  bal: "285.000", ref: "order",   daysAgoN: 20 },
    { prod: PRODUCTS[1], type: "ENTRY",      qty: "300.000", bal: "300.000", ref: "entry",   daysAgoN: 28 },
    { prod: PRODUCTS[1], type: "EXIT",       qty: "80.000",  bal: "220.000", ref: "order",   daysAgoN: 22 },
    { prod: PRODUCTS[2], type: "ENTRY",      qty: "200.000", bal: "200.000", ref: "entry",   daysAgoN: 15 },
    { prod: PRODUCTS[2], type: "EXIT",       qty: "45.000",  bal: "155.000", ref: "order",   daysAgoN: 10 },
    { prod: PRODUCTS[2], type: "ADJUSTMENT", qty: "-5.000",  bal: "150.000", ref: "adjustment", daysAgoN: 8 },
    { prod: PRODUCTS[3], type: "ENTRY",      qty: "150.000", bal: "150.000", ref: "entry",   daysAgoN: 12 },
    { prod: PRODUCTS[3], type: "EXIT",       qty: "30.000",  bal: "120.000", ref: "order",   daysAgoN: 5  },
    { prod: PRODUCTS[0], type: "ENTRY",      qty: "400.000", bal: "685.000", ref: "entry",   daysAgoN: 7  },
    { prod: PRODUCTS[1], type: "EXIT",       qty: "60.000",  bal: "160.000", ref: "order",   daysAgoN: 3  },
  ];

  for (const mv of MOVEMENTS) {
    const dateStr = daysAgo(mv.daysAgoN);
    await db.execute(sql`
      INSERT INTO inventory_movements (
        empresa_id, product_id, product_name, movement_type,
        quantity, balance_after, unit, reference_type, reference_id,
        notes, date, created_by, created_at
      ) VALUES (
        ${TENANT_ID}, ${mv.prod.id}, ${mv.prod.name}, ${mv.type},
        ${mv.qty}, ${mv.bal}, ${mv.prod.unit}, ${mv.ref}, null,
        ${SEED_TAG + " movimentação de simulação"},
        ${dateStr}, 'seed-operational', NOW() - (${mv.daysAgoN} || ' days')::interval
      )
    `);
    log(`  CREATE inv_movement: ${mv.prod.name} ${mv.type} qty=${mv.qty} date=${dateStr}`);
  }
}

// ── ETAPA 2.7 — Financial transactions ───────────────────────────────────────

async function seedFinancialTransactions(): Promise<void> {
  log("ETAPA 2.7 — Criando transações financeiras...");

  const existsCheck = rows(await db.execute(sql`
    SELECT COUNT(*) as n FROM financial_transactions WHERE descricao LIKE '%${sql.raw(SEED_TAG)}%'
  `));
  if (parseInt(existsCheck[0]?.n ?? "0") > 0) {
    log(`  SKIP financial_transactions (já existem ${existsCheck[0].n} registros seed)`);
    return;
  }

  const TRANSACTIONS = [
    { tipo: "entrada", valor: "1250.00", desc: "Recebimento pedido Acme Corp", daysAgoN: 12 },
    { tipo: "entrada", valor: "680.00",  desc: "Recebimento pedido entregue",  daysAgoN: 10 },
    { tipo: "saida",   valor: "3200.00", desc: "Pagamento fornecedor frutas",  daysAgoN: 8  },
    { tipo: "entrada", valor: "2100.00", desc: "Recebimento Sacolão do Zé",    daysAgoN: 5  },
    { tipo: "saida",   valor: "850.00",  desc: "Frete logística semana 20",    daysAgoN: 4  },
    { tipo: "entrada", valor: "760.00",  desc: "Recebimento Hortifruti",       daysAgoN: 3  },
    { tipo: "saida",   valor: "2900.00", desc: "Pagamento fazenda semana 19",  daysAgoN: 2  },
    { tipo: "entrada", valor: "1380.00", desc: "Recebimento Mercado Bom Preço",daysAgoN: 1  },
    { tipo: "saida",   valor: "420.00",  desc: "Limpeza e higienização",       daysAgoN: 0  },
    { tipo: "entrada", valor: "890.00",  desc: "Recebimento parcial Sacolão",  daysAgoN: 0  },
  ];

  for (const tx of TRANSACTIONS) {
    const dateStr = daysAgo(tx.daysAgoN);
    await db.execute(sql`
      INSERT INTO financial_transactions (
        empresa_id, tipo, valor, descricao, data, referencia_tipo, created_at
      ) VALUES (
        ${TENANT_ID}, ${tx.tipo}, ${tx.valor},
        ${SEED_TAG + " " + tx.desc}, ${dateStr}, 'manual',
        NOW() - (${tx.daysAgoN} || ' days')::interval
      )
    `);
    log(`  CREATE fin_tx: ${tx.tipo} R$${tx.valor} "${tx.desc}"`);
  }
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log("\n" + "═".repeat(60));
  console.log("[SEED-OP] FASE 1.3 — ETAPA 2: População Controlada");
  console.log("═".repeat(60) + "\n");

  try {
    const clientIds = await seedCompanies();
    const orderIds = await seedOrders(clientIds);
    await seedNfeEmissoes(orderIds);
    await seedAccountsReceivable(orderIds);
    await seedAccountsPayable();
    await seedInventoryMovements();
    await seedFinancialTransactions();

    console.log("\n" + "═".repeat(60));
    console.log("[SEED-OP] ✓ ETAPA 2 concluída com sucesso!");
    console.log("[SEED-OP] Para limpar: DELETE FROM orders WHERE order_code LIKE 'SEED-OP-%'");
    console.log("═".repeat(60) + "\n");
  } catch (e: any) {
    console.error("[SEED-OP] FATAL:", e.message);
    console.error(e.stack);
    process.exit(1);
  } finally {
    process.exit(0);
  }
}

main();
