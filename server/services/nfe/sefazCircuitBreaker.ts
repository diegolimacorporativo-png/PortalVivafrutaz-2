/**
 * FASE NF-e 1.2 — T1204: Circuit Breaker SEFAZ
 *
 * Previne envios em rajada quando o SEFAZ está indisponível.
 * Estados: closed → open → half-open → closed
 *
 * Regras:
 *   - Abre após FAILURE_THRESHOLD falhas consecutivas (padrão: 5)
 *   - Permanece aberto por RESET_TIMEOUT_MS (padrão: 60s)
 *   - Entra em half-open: permite 1 tentativa de teste
 *   - Se teste passar: fecha. Se falhar: abre novamente.
 *   - Calls quando aberto lançam SEFAZ_CIRCUIT_OPEN imediatamente.
 *
 * Escopo: in-memory por processo. Não persiste no DB.
 * Thread-safe: operações síncronas em Node.js single-thread.
 */

export type CircuitState = "closed" | "open" | "half-open";

interface CircuitBreakerState {
  state: CircuitState;
  failures: number;
  lastFailureAt: number | null;
  openedAt: number | null;
  halfOpenAt: number | null;
  totalOpenings: number;
}

const FAILURE_THRESHOLD = 5;
const RESET_TIMEOUT_MS = 60_000; // 60s antes de tentar half-open

const _state: CircuitBreakerState = {
  state: "closed",
  failures: 0,
  lastFailureAt: null,
  openedAt: null,
  halfOpenAt: null,
  totalOpenings: 0,
};

export function getCircuitState(): Readonly<CircuitBreakerState & { isOpen: boolean }> {
  return { ..._state, isOpen: _state.state !== "closed" };
}

/**
 * Verifica se o circuit breaker permite uma chamada.
 * Lança SEFAZ_CIRCUIT_OPEN se o circuito estiver aberto.
 * Transiciona para half-open automaticamente após o timeout.
 */
export function checkCircuit(): void {
  if (_state.state === "closed") return;

  if (_state.state === "open") {
    const elapsed = Date.now() - (_state.openedAt ?? 0);
    if (elapsed >= RESET_TIMEOUT_MS) {
      // Transiciona para half-open: permite 1 tentativa de probe
      _state.state = "half-open";
      _state.halfOpenAt = Date.now();
      console.warn("[SEFAZ_CIRCUIT_HALF_OPEN]", {
        openedAt: _state.openedAt,
        elapsedMs: elapsed,
        totalOpenings: _state.totalOpenings,
      });
      return; // permite a chamada como probe
    }
    // Circuito aberto — bloqueia
    console.warn("[SEFAZ_CIRCUIT_OPEN_BLOCKED]", {
      openedAt: _state.openedAt,
      elapsedMs: elapsed,
      remainingMs: RESET_TIMEOUT_MS - elapsed,
      failures: _state.failures,
    });
    throw new Error("SEFAZ_CIRCUIT_OPEN");
  }

  if (_state.state === "half-open") {
    // Permite a probe, mas não bloqueia
    return;
  }
}

/** Registra uma falha. Abre o circuito se atingir o threshold. */
export function recordCircuitFailure(err?: unknown): void {
  _state.failures += 1;
  _state.lastFailureAt = Date.now();

  const msg = err instanceof Error ? err.message : String(err ?? "");

  if (_state.state === "half-open") {
    // Probe falhou — abre novamente
    _state.state = "open";
    _state.openedAt = Date.now();
    _state.totalOpenings += 1;
    console.error("[SEFAZ_CIRCUIT_REOPENED]", {
      reason: msg,
      failures: _state.failures,
      totalOpenings: _state.totalOpenings,
    });
    return;
  }

  if (_state.state === "closed" && _state.failures >= FAILURE_THRESHOLD) {
    _state.state = "open";
    _state.openedAt = Date.now();
    _state.totalOpenings += 1;
    console.error("[SEFAZ_DOWN]", {
      reason: `Circuit opened after ${_state.failures} consecutive failures`,
      lastError: msg,
      totalOpenings: _state.totalOpenings,
    });
  }
}

/** Registra sucesso. Fecha o circuito se estava half-open. */
export function recordCircuitSuccess(): void {
  if (_state.state === "half-open") {
    console.info("[SEFAZ_CIRCUIT_CLOSED]", {
      wasOpenFor: Date.now() - (_state.openedAt ?? 0),
      totalOpenings: _state.totalOpenings,
    });
  }
  _state.state = "closed";
  _state.failures = 0;
  _state.openedAt = null;
  _state.halfOpenAt = null;
}

/** Classifica o erro axios para logs estruturados. */
export function classifyAxiosError(err: unknown): "timeout" | "connection" | "http" | "unknown" {
  // Lazy import to avoid circular deps — caller already has axios in scope
  const e = err as any;
  if (!e) return "unknown";
  if (e.code === "ECONNABORTED" || e.code === "ETIMEDOUT") return "timeout";
  if (e.code === "ECONNREFUSED" || e.code === "ENOTFOUND" || e.code === "ECONNRESET") return "connection";
  if (e.response) return "http";
  return "unknown";
}
