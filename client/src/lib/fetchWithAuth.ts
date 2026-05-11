const CRITICAL_ERRORS = ["SESSION_INVALIDATED", "SESSION_EXPIRED"];

const IGNORE_401_URLS = [
  "/api/company-config/logo",
  "/api/settings/maintenance",
  "/api/notifications",
  "/api/dashboard",
  "/api/ai",
  "/api/intelligence",
  "/api/analysis",
];

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
  // URL validation
  if (!url || typeof url !== "string") {
    console.error("[INVALID_URL]", url);
    throw new Error("Invalid URL");
  }
  if (!url.startsWith("/") && !url.startsWith("http")) {
    console.warn("[URL_FIX_APPLIED]", url);
    url = "/" + url;
  }

  // Persistent device ID — generate UUID once and reuse
  let deviceId = localStorage.getItem("device_id");
  if (!deviceId) {
    deviceId = crypto.randomUUID();
    localStorage.setItem("device_id", deviceId);
  }
  const safeDeviceId = deviceId
    .toString()
    .replace(/[^a-zA-Z0-9-_]/g, "")
    .slice(0, 50);

  // T804 — DEV-only: log device ID and request details (removed from prod to
  // eliminate console noise on every request in deployed environments).
  if (import.meta.env.DEV) {
    console.warn("[DEVICE_ID_DEBUG]", { original: deviceId, safe: safeDeviceId });
    console.warn("[FETCH_DEBUG]", {
      url,
      method: options.method ?? "GET",
      headers: { ...(options.headers ?? {}), "X-Device-Id": safeDeviceId },
      body: options.body ?? null,
    });
  }

  const res = await fetch(url, {
    ...options,
    credentials: "include",
    headers: {
      ...(options.headers ?? {}),
      "X-Device-Id": safeDeviceId,
    },
  });

  // T804 — DEV-only: log HTTP response status on every request.
  if (import.meta.env.DEV) {
    console.warn("[HTTP_RESPONSE_DEBUG]", { url, status: res.status, ok: res.ok });
  }

  if ((res.status === 401 || res.status === 403) && !url.startsWith("/api/auth")) {
    let body: any = null;
    try {
      body = await res.clone().json();
    } catch (_) {}

    const errorCode = body?.error;
    const isIgnored = IGNORE_401_URLS.some((u) => url.includes(u));

    // T804 — DEV-only: log 401 detail; in prod only truly critical decisions are logged.
    if (import.meta.env.DEV) {
      console.log("[AUTH_401_DEBUG]", { url, status: res.status, errorCode, isIgnored });
    }

    // Hard block: ignored endpoints never trigger logout
    if (isIgnored) {
      if (import.meta.env.DEV) console.warn("[SESSION_DECISION] ignored_401", { url, errorCode });
      return res;
    }

    // Only dispatch logout for genuinely critical session errors
    if (CRITICAL_ERRORS.includes(errorCode)) {
      dispatchAuthExpired();
    }
  }

  return res;
}
