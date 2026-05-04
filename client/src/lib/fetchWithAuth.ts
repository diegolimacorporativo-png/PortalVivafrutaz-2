let _hasFired = false;

const CRITICAL_ERRORS = [
  "SESSION_INVALIDATED",
  "TOKEN_VERSION_MISMATCH",
  "SESSION_EXPIRED",
];

const IGNORE_401_URLS = [
  "/api/company-config/logo",
  "/api/settings/maintenance",
  "/api/notifications",
  "/api/dashboard",
  "/api/ai",
  "/api/intelligence",
  "/api/analysis",
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

  if (
    (res.status === 401 || res.status === 403) &&
    !url.startsWith("/api/auth/")
  ) {
    // ETAPA 4 — JSON protegido no bloco de 401
    let body: any = null;
    try {
      body = await res.clone().json();
    } catch {
      console.error("[JSON_PARSE_ERROR]", { url, status: res.status });
    }

    console.warn("[AUTH_401_DEBUG]", {
      url,
      status: res.status,
      body,
      isAuthRoute: url.startsWith("/api/auth/"),
      willDispatch: !IGNORE_401_URLS.some(u => url.includes(u)) && CRITICAL_ERRORS.includes(body?.error),
    });

    if (IGNORE_401_URLS.some(u => url.includes(u))) {
      return res;
    }

    if (
      (res.status === 401 || res.status === 403) &&
      CRITICAL_ERRORS.includes(body?.error)
    ) {
      dispatchAuthExpired();
    }
  }

  return res;
}
