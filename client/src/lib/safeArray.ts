/**
 * safeArray — normaliza qualquer resposta de API para array.
 *
 * Casos tratados:
 *   - input já é array           → retorna input
 *   - input é { data: Array }    → retorna input.data
 *   - qualquer outro valor       → retorna []
 *
 * Uso: const items = safeArray(queryData);
 */
export function safeArray<T = any>(input: unknown): T[] {
  if (Array.isArray(input)) return input as T[];
  if (
    input !== null &&
    typeof input === "object" &&
    Array.isArray((input as any).data)
  ) {
    return (input as any).data as T[];
  }
  if (input !== undefined && input !== null) {
    console.warn("[safeArray] unexpected API payload shape:", input);
  }
  return [];
}

/**
 * safeObjectArray — extrai array aninhado de um objeto por chave.
 *
 * Exemplos:
 *   safeObjectArray(data, "alerts")   → safeArray(data?.alerts)
 *   safeObjectArray(data, "items")    → safeArray(data?.items)
 */
export function safeObjectArray<T = any>(
  obj: unknown,
  key: string
): T[] {
  if (obj === null || obj === undefined || typeof obj !== "object") return [];
  return safeArray<T>((obj as any)[key]);
}
