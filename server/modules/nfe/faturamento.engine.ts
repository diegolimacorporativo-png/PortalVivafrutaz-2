import { BILLING_STRICT_MODE, BILLING_DRY_RUN } from "../../config/flags";

/**
 * STEP 9.2Z — Motor de Faturamento (Fase 1, sem alterar schema).
 *
 * Camada de DECISÃO que interpreta os campos JÁ EXISTENTES de `companies`
 * (clientType, billingTerm, paymentDates, contractStartDate/EndDate) e
 * devolve um contexto que o guard usa para liberar/bloquear a emissão.
 *
 * Fase 1: apenas classifica e bloqueia casos óbvios (contrato fora de
 * vigência). Não agrupa, não emite automático, não gera ciclo — isso é
 * Fase 2.
 *
 * IMPORTANTE: este módulo é DEFENSIVO. Quando faltar dado, o default é
 * "permitir" — para nunca quebrar pedidos que hoje funcionam. Os bloqueios
 * só disparam quando o dado existe E aponta inequivocamente para um motivo
 * de bloqueio (ex: contrato expirado). Toda regra mais agressiva entra em
 * Fase 2 com flag de rollout.
 */

export type FaturamentoTipo =
  | "imediato"
  | "semanal"
  | "mensal"
  | "contratual"
  | "pontual";

export type FaturamentoContext = {
  tipo: FaturamentoTipo;
  /** Prazo de pagamento em dias, parseado de `billingTerm` (0 quando à vista). */
  prazoDias: number;
  /** False bloqueia a emissão; o `motivo` explica por quê. */
  podeEmitir: boolean;
  motivo: string;
  /** Texto curto para a UI ("Faturamento mensal", "Prazo: 30 dias"…). */
  label: string;
};

/** Aceita campos snake_case (vindos do raw SQL) ou camelCase (vindos do ORM). */
function pick<T = any>(o: any, ...keys: string[]): T | undefined {
  for (const k of keys) {
    if (o?.[k] !== undefined && o?.[k] !== null) return o[k];
  }
  return undefined;
}

function parsePrazoDias(billingTerm: unknown): number {
  if (!billingTerm) return 0;
  const s = String(billingTerm).trim();
  // Aceita "30", "30 dias", "30/45/60" (pega o primeiro), "à vista" → 0.
  const m = s.match(/(\d+)/);
  return m ? Number(m[1]) : 0;
}

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

export function getFaturamentoContext(
  company: any,
  order: any,
): FaturamentoContext {
  const now = startOfDay(new Date());

  const ctx: FaturamentoContext = {
    tipo: "imediato",
    prazoDias: 0,
    podeEmitir: true,
    motivo: "",
    label: "Faturamento imediato",
  };

  // ── 1. Tipo de cliente ────────────────────────────────────────────
  const clientType = String(
    pick<string>(company, "client_type", "clientType") ?? "mensal",
  ).toLowerCase();

  switch (clientType) {
    case "semanal":
      ctx.tipo = "semanal";
      ctx.label = "Faturamento semanal";
      break;
    case "mensal":
      ctx.tipo = "mensal";
      ctx.label = "Faturamento mensal";
      break;
    case "contratual":
      ctx.tipo = "contratual";
      ctx.label = "Faturamento contratual";
      break;
    case "pontual":
      ctx.tipo = "pontual";
      ctx.label = "Faturamento pontual";
      break;
    default:
      ctx.tipo = "imediato";
      ctx.label = "Faturamento imediato";
  }

  // ── 2. Prazo de pagamento ─────────────────────────────────────────
  ctx.prazoDias = parsePrazoDias(
    pick(company, "billing_term", "billingTerm"),
  );
  if (ctx.prazoDias > 0) {
    ctx.label += ` · Prazo ${ctx.prazoDias} dias`;
  }

  // ── 3. Vigência contratual (bloqueio duro quando dado existir) ────
  // Estes checks duplicam parcialmente o guard básico de propósito: aqui
  // o motivo é mais descritivo, e em Fase 2 a engine pode evoluir sem
  // tocar o guard.
  const contractStart = pick(
    company,
    "contract_start_date",
    "contractStartDate",
  );
  if (contractStart) {
    const start = startOfDay(new Date(contractStart as any));
    if (start > now) {
      ctx.podeEmitir = false;
      ctx.motivo = "Contrato da empresa ainda não iniciou";
      return ctx;
    }
  }

  const contractEnd = pick(company, "contract_end_date", "contractEndDate");
  if (contractEnd) {
    const end = startOfDay(new Date(contractEnd as any));
    if (end < now) {
      ctx.podeEmitir = false;
      ctx.motivo = "Contrato da empresa expirado";
      return ctx;
    }
  }

  // ── 4. STEP 9.2Z.1 / 9.2Z.1B — Bloqueio progressivo por ciclo ─────
  // A avaliação roda sempre que houver delivery_date e a flag dry-run OU
  // strict estiver ligada. Comportamento por flag:
  //   STRICT=false, DRY=false  → no-op (Fase 1, apenas informativo).
  //   STRICT=false, DRY=true   → simula: loga [NFE_DRY_RUN_BLOCK], NÃO bloqueia.
  //   STRICT=true,  DRY=*      → bloqueia de fato (motivo aparece na UI).
  // O admin sempre pode passar por cima usando "Liberar agora"
  // (force-release), que zera o `fiscal_status` para `nota_liberada`.
  if (BILLING_STRICT_MODE || BILLING_DRY_RUN) {
    const deliveryRaw = pick(order, "delivery_date", "deliveryDate");
    if (deliveryRaw) {
      const delivery = startOfDay(new Date(deliveryRaw as any));
      const orderId = pick(order, "id");

      // Semanal: só pode emitir 7 dias após a entrega (fechamento da semana).
      if (ctx.tipo === "semanal") {
        const diffDias = Math.floor(
          (now.getTime() - delivery.getTime()) / (1000 * 60 * 60 * 24),
        );
        if (diffDias < 7) {
          const motivo = "Aguardando fechamento semanal";
          if (BILLING_DRY_RUN) {
            console.warn("[NFE_DRY_RUN_BLOCK]", {
              orderId,
              tipo: "semanal",
              motivo,
              deliveryDate: delivery.toISOString(),
              diffDias,
            });
          }
          if (BILLING_STRICT_MODE) {
            ctx.podeEmitir = false;
            ctx.motivo = motivo;
            return ctx;
          }
        }
      }

      // Mensal: entregas do mês corrente só faturam no mês seguinte.
      if (ctx.tipo === "mensal") {
        const sameMonth =
          delivery.getMonth() === now.getMonth() &&
          delivery.getFullYear() === now.getFullYear();
        if (sameMonth) {
          const motivo = "Faturamento apenas no mês seguinte";
          if (BILLING_DRY_RUN) {
            console.warn("[NFE_DRY_RUN_BLOCK]", {
              orderId,
              tipo: "mensal",
              motivo,
              deliveryDate: delivery.toISOString(),
            });
          }
          if (BILLING_STRICT_MODE) {
            ctx.podeEmitir = false;
            ctx.motivo = motivo;
            return ctx;
          }
        }
      }
    }
  }

  return ctx;
}
