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
