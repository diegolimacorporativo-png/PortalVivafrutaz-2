let _hasFired = false;

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
  // ETAPA 3 — validação de URL antes do fetch
  if (!url || typeof url !== "string") {
    console.error("[INVALID_URL]", url);
    throw new Error("Invalid URL");
  }
  if (!url.startsWith("/") && !url.startsWith("http")) {
    console.warn("[URL_FIX_APPLIED]", url);
    url = "/" + url;
  }

  // ETAPA 2 — sanitização obrigatória do X-Device-Id
  let deviceId = localStorage.getItem("device_id");
  if (!deviceId) {
    deviceId = "web-client";
  }
  const safeDeviceId = deviceId
    .toString()
    .replace(/[^a-zA-Z0-9-_]/g, "")
    .slice(0, 50);

  console.warn("[DEVICE_ID_DEBUG]", { original: deviceId, safe: safeDeviceId });

  // ETAPA 1 — log completo antes do fetch
  console.warn("[FETCH_DEBUG]", {
    url,
    method: options.method ?? "GET",
    headers: { ...(options.headers ?? {}), "X-Device-Id": safeDeviceId },
    body: options.body ?? null,
  });

  const res = await fetch(url, {
    ...options,
    credentials: "include",
    headers: {
      ...(options.headers ?? {}),
      "X-Device-Id": safeDeviceId,
    },
  });

  // ETAPA 1 — log global de resposta HTTP
  console.warn("[HTTP_RESPONSE_DEBUG]", { url, status: res.status, ok: res.ok });

  if (res.status === 401 && !url.startsWith("/api/auth")) {
    // JSON protegido no bloco de 401
    let body: any = null;
    try {
      body = await res.clone().json();
    } catch {
      console.error("[JSON_PARSE_ERROR]", { url, status: res.status });
    }

    // ETAPA 1 — log do body da resposta
    console.warn("[HTTP_BODY_DEBUG]", { url, body });

    console.warn("[AUTH_401_DEBUG]", {
      url,
      status: res.status,
      error: body?.error,
    });

    // ETAPA 2 — disparo APENAS para erros críticos de sessão, nunca erros de negócio
    const isCritical =
      body?.error === "SESSION_INVALIDATED" ||
      body?.error === "SESSION_EXPIRED";

    const isIgnored =
      url.includes("/api/company-config") ||
      url.includes("/api/settings") ||
      url.includes("/api/ai") ||
      url.includes("/api/intelligence") ||
      url.includes("/api/analysis") ||
      url.includes("/api/notifications") ||
      url.includes("/api/dashboard");

    if (isCritical && !isIgnored) {
      console.warn("[AUTH_EXPIRED_DISPATCH]", { url, error: body?.error });
      dispatchAuthExpired();
    }
  }

  return res;
}
