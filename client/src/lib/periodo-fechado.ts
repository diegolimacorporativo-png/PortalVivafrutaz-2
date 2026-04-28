/**
 * NF.7.9.7 — Feedback visual amigável para erro 403 PERIODO_FECHADO.
 *
 * Helper puramente ADITIVO. Não altera fluxo existente: cada chamada deve
 * usar `handleIfPeriodoFechado(err, toast)` como early-return na primeira
 * linha do `onError` / `catch`. Se a função retornar `true`, o erro foi
 * tratado e o restante do handler deve ser pulado. Caso contrário, o
 * tratamento atual segue normalmente — zero regressão.
 *
 * Backends cobertos (formatos de erro reconhecidos):
 *   - apiRequest():            Error("403: {\"message\":\"PERIODO_FECHADO\"}")
 *   - apiRequest() raw text:   Error("403: PERIODO_FECHADO")
 *   - normalizeError(body):    Error("PERIODO_FECHADO")  (após .message)
 *   - axios-like:              { response: { data: { error|message: "PERIODO_FECHADO" } } }
 *   - body já parseado:        { error|message: "PERIODO_FECHADO" }
 */

import type { useToast } from "@/hooks/use-toast";

type ToastFn = ReturnType<typeof useToast>["toast"];

export function isPeriodoFechadoError(err: unknown): boolean {
  if (!err) return false;
  const anyErr = err as any;

  if (typeof anyErr === "string" && anyErr.includes("PERIODO_FECHADO")) {
    return true;
  }
  if (typeof anyErr.message === "string" && anyErr.message.includes("PERIODO_FECHADO")) {
    return true;
  }
  if (anyErr.error === "PERIODO_FECHADO") return true;
  if (anyErr.response?.data?.error === "PERIODO_FECHADO") return true;
  if (anyErr.response?.data?.message === "PERIODO_FECHADO") return true;

  return false;
}

export function notifyPeriodoFechado(toast: ToastFn): void {
  toast({
    title: "🔒 Período fechado",
    description:
      "Este pedido pertence a um mês já fechado. Alterações não são permitidas.",
    variant: "destructive",
  });
}

/**
 * Conveniência: testa e dispara o toast em uma única chamada.
 * Retorna `true` se o erro era PERIODO_FECHADO (caller deve dar `return`),
 * `false` caso contrário (caller segue com seu tratamento atual).
 */
export function handleIfPeriodoFechado(err: unknown, toast: ToastFn): boolean {
  if (isPeriodoFechadoError(err)) {
    notifyPeriodoFechado(toast);
    return true;
  }
  return false;
}
