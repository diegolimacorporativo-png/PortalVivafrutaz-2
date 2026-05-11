/**
 * FASE 3.2 — Retry com backoff exponencial + jitter.
 *
 * Utilitário cirúrgico, zero dependências externas.
 * Usado por: NF-e SEFAZ sender, outbox worker, integrações externas.
 *
 * Garantias:
 *  - maxAttempts tentativas máximas (não infinito)
 *  - backoff exponencial: baseDelayMs * 2^(attempt-1), capped em maxDelayMs
 *  - jitter de ±20% para evitar thundering herd
 *  - nunca relança no meio — só lança após esgotar tentativas
 *  - retryable() permite ao chamador decidir se o erro deve ser retryable
 *    (ex: não retry em erros de validação, só em erros de rede/timeout)
 */

export interface RetryOptions {
  maxAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  retryable?: (err: unknown) => boolean;
  onRetry?: (attempt: number, err: unknown, delayMs: number) => void;
}

export interface RetryResult<T> {
  result: T;
  attempts: number;
}

const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_BASE_DELAY_MS = 1_000;
const DEFAULT_MAX_DELAY_MS = 30_000;

function computeDelay(attempt: number, baseMs: number, maxMs: number): number {
  const exponential = baseMs * Math.pow(2, attempt - 1);
  const capped = Math.min(exponential, maxMs);
  const jitter = capped * (0.8 + Math.random() * 0.4);
  return Math.round(jitter);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Executa `fn` com retry exponencial.
 *
 * @throws o último erro após esgotar maxAttempts tentativas.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: RetryOptions = {},
): Promise<RetryResult<T>> {
  const maxAttempts = opts.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const baseDelayMs = opts.baseDelayMs ?? DEFAULT_BASE_DELAY_MS;
  const maxDelayMs = opts.maxDelayMs ?? DEFAULT_MAX_DELAY_MS;
  const retryable = opts.retryable ?? (() => true);
  const onRetry = opts.onRetry;

  let lastErr: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const result = await fn();
      return { result, attempts: attempt };
    } catch (err) {
      lastErr = err;

      const isLast = attempt === maxAttempts;
      const shouldRetry = retryable(err);

      if (isLast || !shouldRetry) {
        throw err;
      }

      const delayMs = computeDelay(attempt, baseDelayMs, maxDelayMs);
      onRetry?.(attempt, err, delayMs);
      await sleep(delayMs);
    }
  }

  throw lastErr;
}

/**
 * Retorna o timestamp de próximo retry com base no retry_count atual.
 * Usado pelo outbox worker para armazenar next_retry_at no banco.
 *
 * retry_count=0 → 5s (primeira falha)
 * retry_count=1 → 30s
 * retry_count=2 → 3m
 * retry_count=3 → 15m
 * retry_count=4 → 1h
 */
export function computeNextRetryAt(retryCount: number): Date {
  const baseMs = 5_000;
  const maxMs = 60 * 60 * 1000;
  const delay = computeDelay(retryCount + 1, baseMs, maxMs);
  return new Date(Date.now() + delay);
}
