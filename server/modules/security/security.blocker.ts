/**
 * FASE 6.5 — In-memory tenant abuse blocker (safe mode).
 *
 * BUG-03-FIX: Changed from fire-and-forget dynamic import pattern to a static
 * top-level import. The previous `void import(...).then(persistBlock)` could
 * silently fail or never resolve if the process crashed before the dynamic
 * import resolved. Static import ensures the module is ready at call time.
 *
 * blockUser is now async — awaits the DB write so crashes between the in-memory
 * set and the DB persist no longer lose the block record.
 * The one caller (security.repository.ts) uses `void blockUser(...)` to stay
 * non-blocking at the call site while still letting blockUser complete.
 */

import { persistBlock, removeActiveBlock as _removeActiveBlock } from "./security.block.repository";
// Route all security log lines through the unified pipeline instead of direct console calls.
import { logSecurity } from "../../core/security/securityLogger";

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
    logSecurity(
      `[SECURITY] TENANT_ABUSE_BLOCKED | email=${email} | attempts=${count} | reason=repeated_tenant_mismatch`,
    );
  } catch (e) {
    // logSecurity itself should never throw, but guard defensively.
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
 * na primeira vez (anti-spam via `alertedUsers`).
 *
 * BUG-03-FIX: now async — awaits the DB write so the block survives a
 * process crash. In-memory set happens first (immediate protection), then
 * the DB write is awaited. On DB error, the in-memory block is still
 * active and the error is logged — never propagated.
 */
export async function blockUser(email: string, count?: number): Promise<void> {
  const key = normalize(email);
  if (!key) return;
  const until = Date.now() + BLOCK_TIME_MS;

  // Set in-memory first — immediate protection, even if DB write fails.
  blockedUsers.set(key, until);

  // FASE 6.9 — await DB persist so crashes don't lose the block.
  try {
    await persistBlock(key, new Date(until));
  } catch (err) {
    console.error("[SECURITY_BLOCK_PERSIST_FAIL]", {
      key,
      error: err instanceof Error ? err.message : String(err),
    });
  }

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

  // FASE 6.9 — também remove o bloqueio persistente. Static import now
  // (BUG-03-FIX). Fail-safe: error logged but never propagated.
  _removeActiveBlock(key).catch((err) => {
    console.error("[SECURITY_UNBLOCK_PERSIST_FAIL]", {
      key,
      error: err instanceof Error ? err.message : String(err),
    });
  });

  logSecurity(`[SECURITY] TENANT_ABUSE_UNBLOCKED | email=${key} | wasBlocked=${wasBlocked}`);
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
