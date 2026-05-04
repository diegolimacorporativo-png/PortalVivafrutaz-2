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
  const res = await fetch(url, {
    ...options,
    credentials: "include",
    headers: {
      ...(options.headers ?? {}),
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
      if (SESSION_ERROR_CODES.has(errorCode)) {
        dispatchAuthExpired();
      }
    } catch {
      // Se não conseguir parsear o body, não dispara auth:expired
    }
  }

  return res;
}
