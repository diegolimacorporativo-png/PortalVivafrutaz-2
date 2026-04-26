/**
 * STEP 9.3F.12 — Camada de Entrega (Email / WhatsApp / etc.)
 *
 * REGRAS ABSOLUTAS:
 *   - NUNCA modifica `emitAlert` (apenas é invocado por ele de forma plugada).
 *   - NUNCA modifica `emitAlertSmart`.
 *   - NUNCA modifica `persistAlertLog`.
 *   - NUNCA altera o `results` que o emitAlert retorna / persiste.
 *   - Falha desta camada NUNCA pode quebrar o fluxo principal.
 *
 * Esta camada é puramente aditiva: recebe o payload do alerta, decide canais
 * (mock por enquanto) e devolve `results` no padrão já usado em analytics:
 *   `[{ channel, success }]`
 *
 * Preparação para o futuro (NÃO implementar agora):
 *   - `context.recipientsRoles` (vem do STEP 9.3F.10) é lido e ecoado no
 *     log para auditoria, mas nada é filtrado por papel ainda.
 *   - O ponto de filtragem por usuário (STEP 9.3F.11 — `userNotificationPreferences`)
 *     fica explicitamente marcado como TODO. Nada é consultado em DB aqui.
 */

export type DeliveryChannel = "email" | "whatsapp";

export interface DeliverAlertInput {
  title: string;
  message: string;
  severity: string;
  context?: Record<string, unknown>;
}

export interface DeliveryResult {
  channel: DeliveryChannel;
  success: boolean;
}

/**
 * Entrega o alerta pelos canais suportados.
 *
 * IMPORTANTE: por enquanto retorna mock para email + whatsapp.
 * O envio real será migrado nos próximos STEPs (9.3F.13+) sem alterar
 * a assinatura desta função.
 */
export async function deliverAlert(
  input: DeliverAlertInput,
): Promise<DeliveryResult[]> {
  // ── FASE 4 — preparação para roteamento + preferências (apenas leitura) ──
  // Lê os papéis sugeridos pelo roteamento (STEP 9.3F.10) sem aplicá-los.
  const ctx = (input.context ?? {}) as Record<string, unknown>;
  const recipientsRoles = Array.isArray(ctx.recipientsRoles)
    ? (ctx.recipientsRoles as string[])
    : [];

  // TODO (STEP 9.3F.13+): aqui entra o filtro por
  //   userNotificationPreferences (STEP 9.3F.11) cruzado com `recipientsRoles`.
  // Por ora, NÃO consulta DB e NÃO filtra nada.

  // ── FASE 2/5 — mock dos resultados no padrão de analytics ────────────────
  const results: DeliveryResult[] = [
    { channel: "email", success: true },
    { channel: "whatsapp", success: true },
  ];

  // Log estruturado e leve — útil para auditoria; nunca lança.
  try {
    console.log("[ALERT_DELIVERY]", {
      title: input.title,
      severity: input.severity,
      recipientsRoles,
      results,
    });
  } catch {
    /* no-op */
  }

  return results;
}
