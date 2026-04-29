/**
 * FASE 6.5 — In-memory tenant abuse blocker (safe mode).
 *
 * Bloqueio temporário em memória para usuários que ultrapassaram o
 * threshold de tenant mismatch (FASE 6.4). Nenhuma persistência: se o
 * processo reiniciar, todos os bloqueios caem — proposital, para evitar
 * que um falso-positivo sobreviva a deploys.
 *
 * Garantias:
 *   - chave por email (lowercased) — evita bypass por capitalização
 *   - email vazio/undefined  → nunca bloqueado
 *   - bloqueio expira sozinho após BLOCK_TIME_MS (lazy cleanup no read)
 *   - sem dependência de banco / sem efeito colateral em fluxos válidos
 */

const blockedUsers = new Map<string, number>();

/**
 * FASE 6.6 — set anti-spam: garante que `sendSecurityAlert` seja
 * disparado UMA única vez por janela de bloqueio (até o usuário
 * desbloquear, quando a entrada é removida e um novo abuso pode
 * gerar novo alerta).
 */
const alertedUsers = new Set<string>();

/** Janela de bloqueio: 5 minutos. Suficiente para frustrar flood automatizado. */
export const BLOCK_TIME_MS = 5 * 60 * 1000;

/**
 * FASE 6.6 — Dispara alerta de segurança quando um usuário é bloqueado.
 * Atualmente apenas loga em stderr (`[SECURITY_ALERT]`). Está pronto
 * para ser estendido com SMTP / webhook / Slack na próxima fase.
 *
 * Fail-safe: qualquer erro é capturado e logado — nunca propaga.
 */
export function sendSecurityAlert(email: string, count: number): void {
  try {
    console.warn("[SECURITY_ALERT]", {
      email,
      attempts: count,
      message: "User blocked due to repeated tenant mismatch",
    });
  } catch (e) {
    console.error("[SECURITY_ALERT_FAIL]", e);
  }
}

function normalize(email?: string | null): string | null {
  if (!email || typeof email !== "string") return null;
  const trimmed = email.trim().toLowerCase();
  return trimmed.length > 0 ? trimmed : null;
}

export function isUserBlocked(email?: string | null): boolean {
  const key = normalize(email);
  if (!key) return false;

  const blockedUntil = blockedUsers.get(key);
  if (!blockedUntil) return false;

  if (Date.now() > blockedUntil) {
    blockedUsers.delete(key);
    // FASE 6.6 — limpa o anti-spam ao expirar: próximo abuso pode
    // disparar um novo alerta legítimo.
    alertedUsers.delete(key);
    return false;
  }
  return true;
}

/**
 * Bloqueia um email por `BLOCK_TIME_MS` e dispara `sendSecurityAlert`
 * na primeira vez (anti-spam via `alertedUsers`). O parâmetro `count`
 * é o número de tentativas observadas — apenas informativo, vai pro log.
 *
 * FASE 6.9 — replica o bloqueio na tabela `security_blocked_users`
 * (fire-and-forget, fail-safe) para sobreviver a restarts do processo.
 */
export function blockUser(email: string, count?: number): void {
  const key = normalize(email);
  if (!key) return;
  const until = Date.now() + BLOCK_TIME_MS;
  blockedUsers.set(key, until);

  // FASE 6.9 — persistência DB. Promise descartada de propósito:
  // erro de DB nunca pode quebrar o bloqueio em memória, que é a
  // primeira linha de defesa.
  void import("./security.block.repository").then(({ persistBlock }) =>
    persistBlock(key, new Date(until)).catch(() => {}),
  );

  // FASE 6.6 — alerta one-shot por janela de bloqueio.
  if (!alertedUsers.has(key)) {
    alertedUsers.add(key);
    sendSecurityAlert(key, count ?? 0);
  }
}

/**
 * FASE 6.9 — Re-hidrata a memória a partir de um bloqueio encontrado
 * no DB (após restart). Usa o TTL ORIGINAL salvo no DB, NÃO renova
 * o bloqueio. Não dispara alerta (o usuário já foi notificado quando
 * o bloqueio foi criado originalmente) e não persiste de novo (já está
 * no DB). Idempotente.
 */
export function hydrateBlockFromDb(
  email: string,
  blockedUntilMs: number,
): void {
  const key = normalize(email);
  if (!key) return;
  if (!Number.isFinite(blockedUntilMs)) return;
  if (blockedUntilMs <= Date.now()) return;
  blockedUsers.set(key, blockedUntilMs);
  // Marca como já-alertado para não disparar alerta duplicado se
  // alguma race fizer blockUser ser chamado em seguida com o mesmo email.
  alertedUsers.add(key);
}

/**
 * FASE 6.8 — Desbloqueio manual (admin MASTER).
 * Remove o usuário do mapa de bloqueio E do anti-spam, permitindo que
 * uma nova ofensa subsequente dispare um novo `[SECURITY_ALERT]`.
 * Idempotente: chamar para um email já desbloqueado é no-op (apenas loga).
 * Fail-safe: nunca lança, retorna boolean indicando se havia bloqueio.
 */
export function unblockUser(email?: string | null): boolean {
  const key = normalize(email);
  if (!key) return false;

  const wasBlocked = blockedUsers.delete(key);
  alertedUsers.delete(key);

  // FASE 6.9 — também remove o bloqueio persistente, garantindo que
  // após restart o usuário não volte a ser bloqueado por uma linha
  // antiga ainda dentro do TTL. Fail-safe: erro de DB não propaga.
  void import("./security.block.repository").then(({ removeActiveBlock }) =>
    removeActiveBlock(key).catch(() => {}),
  );

  console.info("[SECURITY_UNBLOCK]", { email: key, wasBlocked });
  return wasBlocked;
}

/** Test-only helper: clears all blocks. Não usar em produção. */
export function _resetBlockerForTests(): void {
  blockedUsers.clear();
  alertedUsers.clear();
}

/** Read-only debug helper: tamanho do mapa de bloqueio. */
export function blockedCount(): number {
  return blockedUsers.size;
}
