/** Extracts the API's nested error envelope without rendering objects as [object Object]. */
export function productionErrorMessage(payload: unknown, fallback: string): string {
  if (!payload || typeof payload !== "object") return fallback;

  const body = payload as { error?: unknown; message?: unknown };
  if (typeof body.error === "string" && body.error.trim()) return body.error;
  if (body.error && typeof body.error === "object") {
    const nestedMessage = (body.error as { message?: unknown }).message;
    if (typeof nestedMessage === "string" && nestedMessage.trim()) return nestedMessage;
  }
  if (typeof body.message === "string" && body.message.trim()) return body.message;
  return fallback;
}
