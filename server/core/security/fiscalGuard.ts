/**
 * FASE 9B — fiscalGuard.ts
 *
 * Validadores reutilizáveis para campos fiscais críticos.
 * Puramente síncrono, sem efeitos colaterais — o chamador decide
 * se loga, lança ou apenas registra o resultado.
 */

// ── assertValidNumber ─────────────────────────────────────────────────────────

export type ValidNumberResult =
  | { valid: true; value: number }
  | { valid: false; message: string; context: Record<string, any> };

/**
 * Verifica se `value` pode ser convertido para um número finito válido.
 *
 * Retorna `{ valid: true, value: num }` em caso de sucesso, ou
 * `{ valid: false, message, context }` se o valor for undefined, null,
 * NaN ou não conversível.
 *
 * Zero (0) é considerado válido — o chamador decide se zero é aceitável
 * para o campo em questão.
 */
export function assertValidNumber(
  value: any,
  field: string,
  context: Record<string, any>,
): ValidNumberResult {
  const num = Number(value);
  if (value === undefined || value === null || isNaN(num)) {
    return { valid: false, message: `${field} inválido`, context };
  }
  return { valid: true, value: num };
}

// ── assertNonEmptyArray ───────────────────────────────────────────────────────

export type ValidArrayResult<T> =
  | { valid: true; value: T[] }
  | { valid: false; message: string; context: Record<string, any> };

/**
 * Verifica se `arr` é um array com pelo menos um elemento.
 *
 * Retorna `{ valid: true, value: arr }` em caso de sucesso, ou
 * `{ valid: false, message, context }` se o array for vazio, nulo
 * ou não for um array.
 */
export function assertNonEmptyArray<T>(
  arr: any,
  field: string,
  context: Record<string, any>,
): ValidArrayResult<T> {
  if (!Array.isArray(arr) || arr.length === 0) {
    return { valid: false, message: `${field} vazio ou inválido`, context };
  }
  return { valid: true, value: arr as T[] };
}
