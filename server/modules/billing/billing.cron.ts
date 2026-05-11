import cron from "node-cron";
import { storage } from "../../services/storage";
import type { Assinatura } from "@shared/schema";
// FASE 8.6K — isolamento multi-tenant: assinaturas são agrupadas por empresa
// e processadas em blocos dentro de runWithTenant(...). Garante que cada
// updateAssinatura rode com currentTenantId() correto, sem mistura entre
// tenants e sem o overhead de criar um frame ALS por item.
import { runWithTenant, type TenantPrincipal } from "../../core/tenant/context";
import { registerJob, startJobRun, finishJobRun } from "../../core/jobs/job-registry";
import { incJobFailures } from "../../core/observability/metrics";

const BILLING_JOB = "billing-check-boletos";
registerJob(BILLING_JOB);

export interface CheckBoletosResult {
  atrasadas: number;
  downgrades: number;
  detalhes: string[];
  executadoEm: Date;
}

export async function checkBoletosVencidos(): Promise<CheckBoletosResult> {
  const now = new Date();
  const allAssinaturas = await storage.getAssinaturas();
  const planos = await storage.getPlanos();
  const planFree =
    planos.find((p) => p.tipoPlano === "free" && p.ativo) ||
    planos.find((p) => parseFloat(p.preco) === 0 && p.ativo);

  let atrasadas = 0;
  let downgrades = 0;
  const detalhes: string[] = [];

  // FASE 8.6K — agrupa assinaturas por empresa ANTES do processamento.
  // Assinaturas sem companyId são puladas (fail-closed): não há tenant
  // alvo seguro para o updateAssinatura.
  const byCompany = new Map<number, Assinatura[]>();
  for (const a of allAssinaturas) {
    if (!a.companyId) continue;

    if (!byCompany.has(a.companyId)) {
      byCompany.set(a.companyId, []);
    }

    byCompany.get(a.companyId)!.push(a);
  }

  // FASE 8.6K — um runWithTenant por bloco (empresa), NÃO por item.
  // Mantém a performance original e ainda assim isola cada empresa.
  for (const [companyId, assinaturas] of byCompany.entries()) {
    const tenantPrincipal: TenantPrincipal = {
      kind: "admin",
      empresaId: companyId,
      userId: 0,
      role: "SERVICE",
    };

    await runWithTenant(
      { principal: tenantPrincipal, empresaId: companyId },
      async () => {
        for (const a of assinaturas) {
          // ↓↓↓ LÓGICA EXISTENTE INALTERADA ↓↓↓
          if (a.status !== "ativa" && a.status !== "trial") continue;
          if (!a.dataVencimento || new Date(a.dataVencimento) >= now) continue;

          // FASE 3.2 — isolamento de erro por assinatura: um updateAssinatura
          // com falha não aborta o processamento das demais assinaturas da empresa.
          try {
            await storage.updateAssinatura(a.id, { status: "atrasada" });
            atrasadas++;

            if (planFree) {
              await storage.updateAssinatura(a.id, {
                planoId: planFree.id,
                status: "inadimplente",
              });
              downgrades++;
              detalhes.push(
                `Empresa ${a.companyId} movida para plano free por inadimplência`,
              );
            }
          } catch (subErr: any) {
            console.error(
              `[BILLING-CRON] Falha ao processar assinatura #${a.id} (empresa ${a.companyId}):`,
              subErr?.message ?? subErr,
            );
            detalhes.push(
              `Erro ao processar assinatura #${a.id} da empresa ${a.companyId}: ${subErr?.message ?? "erro desconhecido"}`,
            );
          }
          // ↑↑↑ LÓGICA EXISTENTE INALTERADA ↑↑↑
        }
      },
    );
  }

  return { atrasadas, downgrades, detalhes, executadoEm: now };
}

let cronStarted = false;

export function startBillingCron(): void {
  if (cronStarted) return;
  cronStarted = true;

  cron.schedule("0 2 * * *", async () => {
    if (!startJobRun(BILLING_JOB)) {
      console.warn("[BILLING-CRON] Tick skipped — previous run still in progress");
      return;
    }
    try {
      const result = await checkBoletosVencidos();
      console.log(
        `[BILLING-CRON] check-boletos: ${result.atrasadas} atrasadas, ${result.downgrades} downgrades`,
      );
      finishJobRun(BILLING_JOB, true);
    } catch (err: any) {
      console.error("[BILLING-CRON] check-boletos error:", err.message);
      finishJobRun(BILLING_JOB, false, err?.message);
      incJobFailures();
    }
  });

  console.log("[BILLING-CRON] scheduled check-boletos at 02:00 daily");
}
