let _hasFired = false;

const SESSION_ERROR_CODES = new Set([
  "SESSION_INVALIDATED",
  "TOKEN_VERSION_MISMATCH",
  "SESSION_EXPIRED",
]);

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
      console.warn("[AUTH_401_FULL]", { url, status: res.status, body, errorCode, willDispatch: SESSION_ERROR_CODES.has(errorCode) });
      if (SESSION_ERROR_CODES.has(errorCode)) {
        dispatchAuthExpired();
      }
    } catch {
      console.warn("[AUTH_401_FULL]", { url, status: res.status, body: "(parse failed)", willDispatch: false });
    }
  }

  return res;
}
