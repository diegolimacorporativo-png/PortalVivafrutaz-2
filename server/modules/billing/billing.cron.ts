import cron from "node-cron";
import { storage } from "../../services/storage";

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

  for (const a of allAssinaturas) {
    if (a.status !== "ativa" && a.status !== "trial") continue;
    if (!a.dataVencimento || new Date(a.dataVencimento) >= now) continue;

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
  }

  return { atrasadas, downgrades, detalhes, executadoEm: now };
}

let cronStarted = false;

export function startBillingCron(): void {
  if (cronStarted) return;
  cronStarted = true;

  cron.schedule("0 2 * * *", async () => {
    try {
      const result = await checkBoletosVencidos();
      console.log(
        `[BILLING-CRON] check-boletos: ${result.atrasadas} atrasadas, ${result.downgrades} downgrades`,
      );
    } catch (err: any) {
      console.error("[BILLING-CRON] check-boletos error:", err.message);
    }
  });

  console.log("[BILLING-CRON] scheduled check-boletos at 02:00 daily");
}
