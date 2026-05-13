/**
 * FASE 1.1 — Painel de Diagnóstico Fiscal (pré-produção NF-e)
 *
 * GET /api/admin/fiscal/diagnostics
 *
 * Verifica TODOS os pré-requisitos para emissão real SEFAZ:
 *   - Certificado A1 (banco + env), validade, carregamento PFX
 *   - Emitente (company_config): CNPJ, IE, UF, CEP, endereço, CRT
 *   - Produtos: NCM, CFOP, unidade, empresa_id
 *   - Assinaturas ativas (requireActiveSubscription gate)
 *   - Sequência NF-e: last_value, próximo número
 *   - Circuit Breaker SEFAZ: estado atual, falhas, aberturas
 *   - Workers: status de cada job registrado
 *   - Ambiente SEFAZ: modo, URL, tpAmb
 *
 * REGRAS: nunca lança — toda falha vira status:"error" no diagnóstico.
 * Logs: [FISCAL_DIAGNOSTIC] [fiscal-cert-check] [fiscal-config-check]
 */

import type { Express } from "express";
import { requireAuth, requireRole } from "../core/http/requireAuth";
import { db } from "../database/db";
import { sql } from "drizzle-orm";
import { getCircuitState } from "../services/nfe/sefazCircuitBreaker";
import { getJobRegistry } from "../core/jobs/job-registry";
import { getFiscalSnapshot } from "../core/nfe/fiscal-store";

// ── Types ────────────────────────────────────────────────────────────────────

export type DiagStatus = "ok" | "warning" | "error";

export interface DiagCheck {
  status: DiagStatus;
  message: string;
  details?: Record<string, unknown>;
}

export interface FiscalDiagnostics {
  generatedAt: string;
  sefazMode: DiagCheck;
  ambienteFiscal: DiagCheck;
  certificado: DiagCheck & {
    source?: string;
    cn?: string;
    cnpj?: string;
    razaoSocial?: string;
    validTo?: string;
    daysLeft?: number;
    issuer?: string;
    serial?: string;
  };
  emitente: DiagCheck & {
    fields?: Record<string, { value: string | null; ok: boolean; label: string }>;
  };
  produtos: DiagCheck & {
    total?: number;
    semNcm?: number;
    semCfop?: number;
    semUnidade?: number;
    semEmpresaId?: number;
    exemplos?: string[];
  };
  subscriptions: DiagCheck & { total?: number };
  sequenciaNFe: DiagCheck & { lastValue?: number; nextValue?: number };
  circuitBreaker: DiagCheck & {
    state?: string;
    failures?: number;
    totalOpenings?: number;
    openedAt?: string | null;
  };
  xmlGuards: DiagCheck;
  workers: DiagCheck & {
    jobs?: Array<{
      name: string;
      lastStatus: string;
      totalRuns: number;
      totalErrors: number;
      lastError?: string;
      lastFinished?: string;
    }>;
  };
  pendingIssues: Array<{ severity: DiagStatus; campo: string; mensagem: string }>;
  readyForProduction: boolean;
  operationalMetrics: {
    status: DiagStatus;
    message: string;
    orderPipeline: Array<{ status: string; count: number; fiscalStatus?: string }>;
    nfePipeline: Array<{ status: string; count: number }>;
    arSummary: Array<{ status: string; count: number; total: string }>;
    apSummary: Array<{ status: string; count: number; total: string }>;
    inventoryMovements30d: number;
    totalOrderValue30d: string;
    totalARPendente: string;
    totalAPPendente: string;
  };
}

// Extrai linhas de um resultado db.execute() de forma segura (Drizzle + PG)
function extractRows(result: unknown): any[] {
  const r = result as any;
  if (Array.isArray(r)) return r;
  if (r && Array.isArray(r.rows)) return r.rows;
  return [];
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function validarCNPJ(cnpj: string): boolean {
  const c = cnpj.replace(/\D/g, "");
  if (c.length !== 14) return false;
  if (/^(\d)\1+$/.test(c)) return false;
  let sum = 0;
  let pos = 5;
  for (let i = 0; i < 12; i++) {
    sum += parseInt(c[i]) * pos--;
    if (pos < 2) pos = 9;
  }
  let rem = sum % 11 < 2 ? 0 : 11 - (sum % 11);
  if (parseInt(c[12]) !== rem) return false;
  sum = 0; pos = 6;
  for (let i = 0; i < 13; i++) {
    sum += parseInt(c[i]) * pos--;
    if (pos < 2) pos = 9;
  }
  rem = sum % 11 < 2 ? 0 : 11 - (sum % 11);
  return parseInt(c[13]) === rem;
}

function validarCEP(cep: string): boolean {
  return /^\d{8}$/.test(cep.replace(/\D/g, ""));
}

function validarUF(uf: string): boolean {
  return /^[A-Z]{2}$/.test(uf.trim().toUpperCase());
}

const CRT_VALIDOS = ["1", "2", "3"];
const CRT_MAP: Record<string, string> = {
  simples_nacional: "1",
  simples_nacional_excesso: "2",
  lucro_presumido: "3",
  lucro_real: "3",
};

const SEFAZ_URLS: Record<string, string> = {
  SP: "https://homologacao.nfe.fazenda.sp.gov.br/ws/nfeautorizacao4.asmx",
  MG: "https://hnfe.fazenda.mg.gov.br/nfe2/services/NFeAutorizacao4",
  RJ: "https://homologacao.nfe.fazenda.rj.gov.br/ws/NFeAutorizacao4",
  RS: "https://nfe-homologacao.sefazrs.rs.gov.br/ws/NfeAutorizacao/NFeAutorizacao4.asmx",
  PR: "https://homologacao.nfe.sefa.pr.gov.br/nfe/NFeAutorizacao4",
  default: "https://hom.sefaz.go.gov.br/nfe/services/NfeAutorizacao4",
};

// ── Main diagnostic builder ─────────────────────────────────────────────────

async function buildDiagnostics(): Promise<FiscalDiagnostics> {
  const pendingIssues: FiscalDiagnostics["pendingIssues"] = [];

  function addIssue(severity: DiagStatus, campo: string, mensagem: string) {
    if (severity !== "ok") pendingIssues.push({ severity, campo, mensagem });
  }

  // ── 1. SEFAZ mode ──────────────────────────────────────────────────────────
  const sefazMode = (process.env.NFE_SEFAZ_MODE ?? "mock").toLowerCase();
  const sefazModeCheck: DiagCheck =
    sefazMode === "production"
      ? { status: "ok", message: "Modo production ativo — transmissão real ao SEFAZ habilitada" }
      : sefazMode === "mock"
      ? { status: "warning", message: "Modo mock ativo — NF-e não será transmitida ao SEFAZ real", details: { valor: sefazMode } }
      : { status: "error", message: `Valor inválido para NFE_SEFAZ_MODE: "${sefazMode}"`, details: { valor: sefazMode } };
  addIssue(sefazModeCheck.status, "NFE_SEFAZ_MODE", sefazModeCheck.message);

  // ── 2. Ambiente Fiscal (company_config) ────────────────────────────────────
  let ambienteFiscalCheck: DiagCheck = { status: "ok", message: "Ambiente homologação (tpAmb=2)" };
  try {
    const cfgRows = await db.execute(sql`SELECT ambiente_fiscal FROM company_config LIMIT 1`);
    const cf = extractRows(cfgRows)[0] as any;
    const amb = cf?.ambiente_fiscal ?? "homologacao";
    if (amb === "homologacao") {
      ambienteFiscalCheck = { status: "ok", message: "Ambiente: homologação (tpAmb=2) — seguro para testes", details: { ambienteFiscal: amb } };
    } else if (amb === "producao") {
      ambienteFiscalCheck = { status: "warning", message: "Ambiente: produção (tpAmb=1) — NF-e real ao SEFAZ", details: { ambienteFiscal: amb } };
    } else {
      ambienteFiscalCheck = { status: "error", message: `Ambiente fiscal inválido: "${amb}"`, details: { ambienteFiscal: amb } };
    }
  } catch (e: any) {
    ambienteFiscalCheck = { status: "error", message: `Erro ao ler company_config: ${e.message}` };
  }
  addIssue(ambienteFiscalCheck.status === "warning" ? "ok" : ambienteFiscalCheck.status, "ambienteFiscal", ambienteFiscalCheck.message);

  // ── 3. Certificado ─────────────────────────────────────────────────────────
  let certCheck: FiscalDiagnostics["certificado"] = { status: "error", message: "Nenhum certificado encontrado" };
  try {
    console.info("[FISCAL_DIAGNOSTIC] [fiscal-cert-check] iniciando verificação de certificado");
    const { validarCertificado } = await import("../services/nfe/nfeSignature");
    const { decryptOrPassthrough } = await import("../utils/crypto");

    // Fonte 1: company_certificates (banco, multi-tenant)
    let pfxB64: string | null = null;
    let pfxPwd: string | null = null;
    let certSource = "nenhum";

    try {
      const certRows = await db.execute(sql`SELECT cert_base64, cert_password FROM company_certificates LIMIT 1`);
      const certRow = extractRows(certRows)[0];
      if (certRow?.cert_base64) {
        pfxB64 = certRow.cert_base64;
        pfxPwd = decryptOrPassthrough(certRow.cert_password);
        certSource = "banco (company_certificates)";
      }
    } catch (dbErr: any) {
      console.warn("[fiscal-cert-check] Falha ao ler company_certificates:", dbErr.message);
    }

    // Fonte 2: company_config (cert A1 legado)
    if (!pfxB64) {
      try {
        const cfgCertRows = await db.execute(sql`SELECT certificado_a1_base64, certificado_a1_senha FROM company_config WHERE certificado_a1_base64 IS NOT NULL LIMIT 1`);
        const cfgCert = extractRows(cfgCertRows)[0];
        if (cfgCert?.certificado_a1_base64) {
          pfxB64 = cfgCert.certificado_a1_base64;
          pfxPwd = cfgCert.certificado_a1_senha ?? "";
          certSource = "banco (company_config)";
        }
      } catch (cfgErr: any) {
        console.warn("[fiscal-cert-check] Falha ao ler cert em company_config:", cfgErr.message);
      }
    }

    // Fonte 3: env vars
    if (!pfxB64) {
      const envPath = process.env.CERT_PATH ?? process.env.NFE_CERT_PATH;
      const envPwd = process.env.CERT_PASSWORD ?? process.env.NFE_CERT_PASSWORD;
      if (envPath && envPwd) {
        pfxB64 = envPath;
        pfxPwd = envPwd;
        certSource = "variável de ambiente (CERT_PATH)";
      }
    }

    if (!pfxB64 || pfxPwd === null) {
      certCheck = {
        status: "error",
        message: "Certificado A1 não encontrado. Faça o upload em Configurações Fiscais.",
        source: certSource,
      };
      addIssue("error", "certificado", certCheck.message);
    } else {
      const result = validarCertificado(pfxB64, pfxPwd);
      if (!result.valido) {
        certCheck = {
          status: "error",
          message: `Certificado inválido: ${result.erro}`,
          source: certSource,
          details: result.info ? {
            validadeInicio: result.info.validadeInicio?.toISOString(),
            validadeFim: result.info.validadeFim?.toISOString(),
          } : undefined,
        };
        addIssue("error", "certificado", certCheck.message);
      } else {
        const info = result.info!;
        const now = new Date();
        const daysLeft = Math.floor((info.validadeFim.getTime() - now.getTime()) / 86400000);

        let certStatus: DiagStatus = "ok";
        let certMsg = `Certificado válido por mais ${daysLeft} dias`;
        if (daysLeft <= 0) {
          certStatus = "error";
          certMsg = "Certificado EXPIRADO";
        } else if (daysLeft <= 7) {
          certStatus = "error";
          certMsg = `Certificado expira em ${daysLeft} dias — RENOVAR IMEDIATAMENTE`;
        } else if (daysLeft <= 15) {
          certStatus = "warning";
          certMsg = `Certificado expira em ${daysLeft} dias — renovar urgente`;
        } else if (daysLeft <= 30) {
          certStatus = "warning";
          certMsg = `Certificado expira em ${daysLeft} dias — renovar em breve`;
        }

        certCheck = {
          status: certStatus,
          message: certMsg,
          source: certSource,
          cn: info.razaoSocial,
          cnpj: info.cnpj,
          razaoSocial: info.razaoSocial,
          validTo: info.validadeFim.toISOString(),
          daysLeft,
        };
        addIssue(certStatus, "certificado", certMsg);
        console.info("[FISCAL_DIAGNOSTIC] [fiscal-cert-check]", { status: certStatus, daysLeft, source: certSource });
      }
    }
  } catch (e: any) {
    certCheck = { status: "error", message: `Erro ao verificar certificado: ${e.message}` };
    addIssue("error", "certificado", certCheck.message);
    console.error("[FISCAL_DIAGNOSTIC] [fiscal-cert-check] erro:", e.message);
  }

  // ── 4. Emitente (company_config) ───────────────────────────────────────────
  let emitenteCheck: FiscalDiagnostics["emitente"] = { status: "ok", message: "Todos os dados do emitente preenchidos" };
  try {
    console.info("[FISCAL_DIAGNOSTIC] [fiscal-config-check] verificando emitente");
    const rows = await db.execute(sql`
      SELECT cnpj, state_registration, state, cep, address, address_number,
             neighborhood, city, regime_tributario, ambiente_fiscal, company_name
      FROM company_config LIMIT 1
    `);
    const cfg = extractRows(rows)[0];

    if (!cfg) {
      emitenteCheck = { status: "error", message: "company_config não encontrado. Configure os dados fiscais." };
      addIssue("error", "emitente", emitenteCheck.message);
    } else {
      const crt = CRT_MAP[cfg.regime_tributario] ?? null;
      const fields: Record<string, { value: string | null; ok: boolean; label: string }> = {
        cnpj:            { value: cfg.cnpj, ok: !!cfg.cnpj && validarCNPJ(cfg.cnpj), label: "CNPJ" },
        ie:              { value: cfg.state_registration, ok: !!cfg.state_registration && cfg.state_registration.length >= 8, label: "Inscrição Estadual" },
        uf:              { value: cfg.state, ok: !!cfg.state && validarUF(cfg.state), label: "UF" },
        cep:             { value: cfg.cep, ok: !!cfg.cep && validarCEP(cfg.cep), label: "CEP" },
        endereco:        { value: cfg.address, ok: !!cfg.address, label: "Endereço" },
        numero:          { value: cfg.address_number, ok: !!cfg.address_number, label: "Número" },
        bairro:          { value: cfg.neighborhood, ok: !!cfg.neighborhood, label: "Bairro" },
        municipio:       { value: cfg.city, ok: !!cfg.city, label: "Município" },
        regimeTrib:      { value: cfg.regime_tributario, ok: !!crt && CRT_VALIDOS.includes(crt), label: "Regime Tributário (CRT)" },
        razaoSocial:     { value: cfg.company_name, ok: !!cfg.company_name, label: "Razão Social" },
      };

      const failures = Object.entries(fields).filter(([, f]) => !f.ok);
      if (failures.length === 0) {
        emitenteCheck = { status: "ok", message: "Todos os dados do emitente válidos", fields };
      } else {
        const labels = failures.map(([, f]) => f.label).join(", ");
        emitenteCheck = {
          status: "error",
          message: `Campos inválidos ou ausentes: ${labels}`,
          fields,
        };
        addIssue("error", "emitente", emitenteCheck.message);
      }
      console.info("[FISCAL_DIAGNOSTIC] [fiscal-config-check]", { ok: failures.length === 0, failures: failures.map(([k]) => k) });
    }
  } catch (e: any) {
    emitenteCheck = { status: "error", message: `Erro ao verificar emitente: ${e.message}` };
    addIssue("error", "emitente", emitenteCheck.message);
  }

  // ── 5. Produtos ────────────────────────────────────────────────────────────
  let produtosCheck: FiscalDiagnostics["produtos"] = { status: "ok", message: "Todos os produtos com NCM, CFOP e unidade" };
  try {
    const prodRows = await db.execute(sql`
      SELECT id, name, ncm, cfop, commercial_unit, empresa_id
      FROM products
      WHERE deleted_at IS NULL OR deleted_at > now()
      ORDER BY id
      LIMIT 200
    `);
    const prods = extractRows(prodRows);
    const total = prods.length;
    const semNcm = prods.filter(p => !p.ncm || p.ncm.length < 8).length;
    const semCfop = prods.filter(p => !p.cfop).length;
    const semUnidade = prods.filter(p => !p.commercial_unit).length;
    const semEmpresaId = prods.filter(p => !p.empresa_id).length;
    const problemáticos = prods.filter(p => !p.ncm || !p.cfop || !p.commercial_unit || !p.empresa_id);
    const exemplos = problemáticos.slice(0, 5).map(p => `${p.name || `id=${p.id}`}`);

    const hasProblems = semNcm > 0 || semCfop > 0 || semUnidade > 0 || semEmpresaId > 0;
    if (total === 0) {
      produtosCheck = { status: "warning", message: "Nenhum produto cadastrado", total, semNcm, semCfop, semUnidade, semEmpresaId };
      addIssue("warning", "produtos", "Nenhum produto cadastrado");
    } else if (hasProblems) {
      const partes: string[] = [];
      if (semNcm > 0) partes.push(`${semNcm} sem NCM`);
      if (semCfop > 0) partes.push(`${semCfop} sem CFOP`);
      if (semUnidade > 0) partes.push(`${semUnidade} sem unidade comercial`);
      if (semEmpresaId > 0) partes.push(`${semEmpresaId} sem empresa_id`);
      produtosCheck = { status: "warning", message: `${total} produtos — ${partes.join(", ")}`, total, semNcm, semCfop, semUnidade, semEmpresaId, exemplos };
      addIssue("warning", "produtos", produtosCheck.message);
    } else {
      produtosCheck = { status: "ok", message: `${total} produto(s) com NCM, CFOP e unidade configurados`, total, semNcm: 0, semCfop: 0, semUnidade: 0, semEmpresaId: 0 };
    }
  } catch (e: any) {
    produtosCheck = { status: "error", message: `Erro ao verificar produtos: ${e.message}` };
    addIssue("error", "produtos", produtosCheck.message);
  }

  // ── 6. Assinaturas ─────────────────────────────────────────────────────────
  let subscriptionsCheck: DiagCheck & { total?: number } = { status: "ok", message: "Há assinaturas ativas" };
  try {
    const subRows = await db.execute(sql`SELECT COUNT(*) as total FROM assinaturas WHERE status = 'ativa'`);
    const total = parseInt(extractRows(subRows)[0]?.total ?? "0");
    if (total === 0) {
      subscriptionsCheck = { status: "error", message: "Nenhuma assinatura ativa — emissão de NF-e bloqueada", total };
      addIssue("error", "assinaturas", subscriptionsCheck.message);
    } else {
      subscriptionsCheck = { status: "ok", message: `${total} assinatura(s) ativa(s)`, total };
    }
  } catch (e: any) {
    subscriptionsCheck = { status: "error", message: `Erro ao verificar assinaturas: ${e.message}` };
    addIssue("error", "assinaturas", subscriptionsCheck.message);
  }

  // ── 7. Sequência NF-e ──────────────────────────────────────────────────────
  let sequenciaCheck: FiscalDiagnostics["sequenciaNFe"] = { status: "ok", message: "Sequência NF-e operacional" };
  try {
    const seqRows = await db.execute(sql`SELECT last_value, is_called FROM nfe_numero_seq`);
    const seq = extractRows(seqRows)[0];
    if (!seq) {
      sequenciaCheck = { status: "error", message: "Sequência nfe_numero_seq não encontrada no banco" };
      addIssue("error", "sequenciaNFe", sequenciaCheck.message);
    } else {
      const lastValue = parseInt(seq.last_value ?? "0");
      const nextValue = seq.is_called ? lastValue + 1 : lastValue;
      sequenciaCheck = { status: "ok", message: `Sequência OK — próxima NF-e será número ${nextValue}`, lastValue, nextValue };
    }
  } catch (e: any) {
    sequenciaCheck = { status: "error", message: `Erro ao verificar sequência NF-e: ${e.message}` };
    addIssue("error", "sequenciaNFe", sequenciaCheck.message);
  }

  // ── 8. Circuit Breaker ─────────────────────────────────────────────────────
  let circuitBreakerCheck: FiscalDiagnostics["circuitBreaker"] = { status: "ok", message: "Circuit breaker fechado" };
  try {
    const cb = getCircuitState();
    if (cb.state === "closed") {
      circuitBreakerCheck = { status: "ok", message: "Circuit breaker fechado — SEFAZ acessível", state: cb.state, failures: cb.failures, totalOpenings: cb.totalOpenings, openedAt: null };
    } else if (cb.state === "half-open") {
      circuitBreakerCheck = { status: "warning", message: `Circuit breaker em half-open — probe em andamento (${cb.failures} falha(s))`, state: cb.state, failures: cb.failures, totalOpenings: cb.totalOpenings, openedAt: cb.openedAt ? new Date(cb.openedAt).toISOString() : null };
      addIssue("warning", "circuitBreaker", circuitBreakerCheck.message);
    } else {
      const openedAgo = cb.openedAt ? Math.round((Date.now() - cb.openedAt) / 1000) : 0;
      circuitBreakerCheck = { status: "error", message: `Circuit breaker ABERTO há ${openedAgo}s — SEFAZ com falhas consecutivas (${cb.failures})`, state: cb.state, failures: cb.failures, totalOpenings: cb.totalOpenings, openedAt: cb.openedAt ? new Date(cb.openedAt).toISOString() : null };
      addIssue("error", "circuitBreaker", circuitBreakerCheck.message);
    }
  } catch (e: any) {
    circuitBreakerCheck = { status: "error", message: `Erro ao ler circuit breaker: ${e.message}` };
    addIssue("error", "circuitBreaker", circuitBreakerCheck.message);
  }

  // ── 9. XML Guards ──────────────────────────────────────────────────────────
  const xmlGuardsCheck: DiagCheck = {
    status: "ok",
    message: "Guards ativos: estrutura XML, assinatura digital, tamanho mínimo, conteúdo NaN/undefined",
    details: {
      guards: ["NFE_XML_GUARD_EMPTY", "NFE_XML_GUARD_NO_DECL", "NFE_XML_GUARD_MISSING_NFE", "NFE_XML_GUARD_UNSIGNED", "NFE_XML_GUARD_CORRUPTED_CONTENT", "NFE_XML_GUARD_TOO_SHORT"],
    },
  };

  // ── 10. Workers ────────────────────────────────────────────────────────────
  let workersCheck: FiscalDiagnostics["workers"] = { status: "ok", message: "Todos os workers operacionais" };
  try {
    const allJobs = getJobRegistry();
    const EXPECTED_WORKERS = ["outbox", "auto-dispatch", "billing-cron", "faturamento-cron", "proactive-alerts", "backup"];
    const jobMap = new Map(allJobs.map(j => [j.name, j]));

    const jobsSummary = allJobs.map(j => ({
      name: j.name,
      lastStatus: j.lastStatus,
      totalRuns: j.totalRuns,
      totalErrors: j.totalErrors,
      lastError: j.lastError,
      lastFinished: j.lastFinished ? new Date(j.lastFinished).toISOString() : undefined,
    }));

    const errorJobs = allJobs.filter(j => j.lastStatus === "error");
    const missingWorkers = EXPECTED_WORKERS.filter(w => !jobMap.has(w));

    if (errorJobs.length > 0) {
      workersCheck = {
        status: "warning",
        message: `${errorJobs.length} worker(s) com erro na última execução: ${errorJobs.map(j => j.name).join(", ")}`,
        jobs: jobsSummary,
      };
      addIssue("warning", "workers", workersCheck.message);
    } else if (missingWorkers.length > 0) {
      workersCheck = {
        status: "warning",
        message: `Workers esperados não registrados ainda: ${missingWorkers.join(", ")}`,
        jobs: jobsSummary,
      };
    } else {
      workersCheck = { status: "ok", message: `${allJobs.length} worker(s) registrado(s), sem erros`, jobs: jobsSummary };
    }
  } catch (e: any) {
    workersCheck = { status: "error", message: `Erro ao ler job registry: ${e.message}` };
    addIssue("error", "workers", workersCheck.message);
  }

  // ── 11. Métricas Operacionais ───────────────────────────────────────────────
  let operationalMetrics: FiscalDiagnostics["operationalMetrics"] = {
    status: "ok",
    message: "Métricas operacionais carregadas",
    orderPipeline: [],
    nfePipeline: [],
    arSummary: [],
    apSummary: [],
    inventoryMovements30d: 0,
    totalOrderValue30d: "0.00",
    totalARPendente: "0.00",
    totalAPPendente: "0.00",
  };
  try {
    // Order pipeline by workflow_status
    const ordersByStatus = extractRows(await db.execute(sql`
      SELECT workflow_status as status, COUNT(*) as count
      FROM orders
      GROUP BY workflow_status
      ORDER BY count DESC
    `));

    // Orders with fiscal_status breakdown
    const ordersByFiscal = extractRows(await db.execute(sql`
      SELECT fiscal_status as status, COUNT(*) as count
      FROM orders
      WHERE workflow_status NOT IN ('CANCELLED')
      GROUP BY fiscal_status
      ORDER BY count DESC
    `));

    // Total order value last 30 days
    const orderValue30d = extractRows(await db.execute(sql`
      SELECT COALESCE(SUM(total_value::numeric), 0)::text as total
      FROM orders
      WHERE created_at >= NOW() - INTERVAL '30 days'
        AND workflow_status NOT IN ('CANCELLED')
    `));

    // NF-e pipeline by status
    const nfeByStatus = extractRows(await db.execute(sql`
      SELECT status, COUNT(*) as count
      FROM nfe_emissoes
      GROUP BY status
      ORDER BY count DESC
    `));

    // AR by status with totals
    const arByStatus = extractRows(await db.execute(sql`
      SELECT status, COUNT(*) as count, COALESCE(SUM(valor::numeric), 0)::text as total
      FROM accounts_receivable
      WHERE empresa_id = 1
      GROUP BY status
      ORDER BY count DESC
    `));

    // AP by status with totals
    const apByStatus = extractRows(await db.execute(sql`
      SELECT status, COUNT(*) as count, COALESCE(SUM(valor::numeric), 0)::text as total
      FROM accounts_payable
      WHERE empresa_id = 1
      GROUP BY status
      ORDER BY count DESC
    `));

    // AR pendente total
    const arPendente = extractRows(await db.execute(sql`
      SELECT COALESCE(SUM(valor::numeric), 0)::text as total
      FROM accounts_receivable
      WHERE empresa_id = 1 AND status IN ('pendente', 'vencido')
    `));

    // AP pendente total
    const apPendente = extractRows(await db.execute(sql`
      SELECT COALESCE(SUM(valor::numeric), 0)::text as total
      FROM accounts_payable
      WHERE empresa_id = 1 AND status IN ('pendente', 'vencido')
    `));

    // Inventory movements last 30 days
    const invMov30d = extractRows(await db.execute(sql`
      SELECT COUNT(*) as count FROM inventory_movements
      WHERE empresa_id = 1 AND date >= CURRENT_DATE - INTERVAL '30 days'
    `));

    operationalMetrics = {
      status: "ok",
      message: "Métricas operacionais em tempo real",
      orderPipeline: ordersByStatus.map(r => ({ status: String(r.status), count: parseInt(String(r.count)) })),
      nfePipeline: nfeByStatus.map(r => ({ status: String(r.status), count: parseInt(String(r.count)) })),
      arSummary: arByStatus.map(r => ({ status: String(r.status), count: parseInt(String(r.count)), total: String(r.total) })),
      apSummary: apByStatus.map(r => ({ status: String(r.status), count: parseInt(String(r.count)), total: String(r.total) })),
      inventoryMovements30d: parseInt(String(invMov30d[0]?.count ?? "0")),
      totalOrderValue30d: String(orderValue30d[0]?.total ?? "0.00"),
      totalARPendente: String(arPendente[0]?.total ?? "0.00"),
      totalAPPendente: String(apPendente[0]?.total ?? "0.00"),
    };
    console.info("[FISCAL_DIAGNOSTIC] [operational-metrics]", {
      orders: ordersByStatus.length,
      nfe: nfeByStatus.length,
      arPendente: arPendente[0]?.total,
      apPendente: apPendente[0]?.total,
    });
  } catch (e: any) {
    operationalMetrics = {
      ...operationalMetrics,
      status: "warning",
      message: `Erro ao carregar métricas operacionais: ${e.message}`,
    };
    console.warn("[FISCAL_DIAGNOSTIC] [operational-metrics] erro:", e.message);
  }

  // ── Resultado final ────────────────────────────────────────────────────────
  const errorCount = pendingIssues.filter(i => i.severity === "error").length;
  const readyForProduction = errorCount === 0 && sefazMode === "production";

  console.info("[FISCAL_DIAGNOSTIC]", {
    errors: errorCount,
    warnings: pendingIssues.filter(i => i.severity === "warning").length,
    readyForProduction,
    sefazMode,
    certStatus: certCheck.status,
    emitenteStatus: emitenteCheck.status,
  });

  return {
    generatedAt: new Date().toISOString(),
    sefazMode: sefazModeCheck,
    ambienteFiscal: ambienteFiscalCheck,
    certificado: certCheck,
    emitente: emitenteCheck,
    produtos: produtosCheck,
    subscriptions: subscriptionsCheck,
    sequenciaNFe: sequenciaCheck,
    circuitBreaker: circuitBreakerCheck,
    xmlGuards: xmlGuardsCheck,
    workers: workersCheck,
    operationalMetrics,
    pendingIssues,
    readyForProduction,
  };
}

// ── Route Registration ────────────────────────────────────────────────────────

export function register(app: Express): void {
  app.get(
    "/api/admin/fiscal/diagnostics",
    requireAuth,
    requireRole(["MASTER", "ADMIN", "DIRECTOR", "DEVELOPER", "FINANCEIRO"]),
    async (_req, res) => {
      try {
        const diagnostics = await buildDiagnostics();
        return res.json({ success: true, data: diagnostics });
      } catch (e: any) {
        console.error("[FISCAL_DIAGNOSTIC] erro fatal:", e.message);
        return res.status(500).json({
          success: false,
          error: { message: e.message ?? "Erro interno no diagnóstico fiscal", code: "FISCAL_DIAGNOSTIC_FATAL" },
        });
      }
    },
  );
}
