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

/** Janela de bloqueio: 5 minutos. Suficiente para frustrar flood automatizado. */
export const BLOCK_TIME_MS = 5 * 60 * 1000;

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
    return false;
  }
  return true;
}

export function blockUser(email: string): void {
  const key = normalize(email);
  if (!key) return;
  blockedUsers.set(key, Date.now() + BLOCK_TIME_MS);
}

/** Test-only helper: clears all blocks. Não usar em produção. */
export function _resetBlockerForTests(): void {
  blockedUsers.clear();
}

/** Read-only debug helper: tamanho do mapa de bloqueio. */
export function blockedCount(): number {
  return blockedUsers.size;
}
