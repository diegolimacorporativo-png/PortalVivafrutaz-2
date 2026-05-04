let _hasFired = false;

const SESSION_ERROR_CODES = new Set([
  "SESSION_INVALIDATED",
  "TOKEN_VERSION_MISMATCH",
  "SESSION_EXPIRED",
]);

// ETAPA 2 — Endpoints secundários que NUNCA devem derrubar a sessão inteira.
// Um 401 nesses endpoints é tolerável (logo sem logo, notificações vazias, etc.)
// e não deve disparar o evento global auth:expired.
const IGNORE_401_URLS = [
  "/api/company-config/logo",
  "/api/settings/maintenance",
  "/api/notifications",
  "/api/dashboard",
];

function dispatchAuthExpired(): void {
  if (_hasFired) return;
  _hasFired = true;
  window.dispatchEvent(new Event("auth:expired"));
  setTimeout(() => {
    _hasFired = false;
  }, 5000);
}

export async function fetchWithAuth(
  url: string,
  options: RequestInit = {},
): Promise<Response> {
  const deviceId = localStorage.getItem("device_id") || "web-client";
  const res = await fetch(url, {
    ...options,
    credentials: "include",
    headers: {
      ...(options.headers ?? {}),
      "X-Device-Id": deviceId,
    },
  });

  if (
    (res.status === 401 || res.status === 403) &&
    !url.startsWith("/api/auth/")
  ) {
    try {
      const cloned = res.clone();
      const body = await cloned.json();
      const errorCode: string = body?.error ?? body?.code ?? "";
      const isIgnored = IGNORE_401_URLS.some(u => url.includes(u));
      const willDispatch = SESSION_ERROR_CODES.has(errorCode) && !isIgnored;

      // ETAPA 1 — log completo para identificar qual endpoint ainda derruba a sessão
      console.warn("[AUTH_401_DEBUG]", {
        url,
        status: res.status,
        body,
        errorCode,
        isIgnored,
        isAuthRoute: url.startsWith("/api/auth/"),
        willDispatch,
      });

      // ETAPA 2 — nunca disparar auth:expired em rotas secundárias
      if (isIgnored) return res;

      if (SESSION_ERROR_CODES.has(errorCode)) {
        dispatchAuthExpired();
      }
    } catch {
      console.warn("[AUTH_401_DEBUG]", {
        url,
        status: res.status,
        body: "(parse failed)",
        willDispatch: false,
      });
    }
  }

  return res;
}
