/**
 * Cloudflare Worker gateway for Portal VivaFrutaz.
 *
 * The application backend is a full Node/Express service (PostgreSQL pool,
 * express-session, filesystem-backed fiscal tooling and background workers).
 * Those runtime features must remain on the Node deployment. This Worker is
 * deliberately thin: it serves the Vite assets and forwards API traffic to
 * the real backend, keeping the browser on one origin.
 *
 * Required secret:
 *   API_ORIGIN = HTTPS URL of the published Node/Express deployment
 */

export interface Env {
  ASSETS: Fetcher;
  API_ORIGIN?: string;
}

const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
};

function jsonError(status: number, message: string): Response {
  return new Response(
    JSON.stringify({
      success: false,
      error: message,
    }),
    {
      status,
      headers: JSON_HEADERS,
    },
  );
}

function isApiRequest(url: URL): boolean {
  return url.pathname === "/user" || url.pathname === "/api" || url.pathname.startsWith("/api/");
}

function hasRequestBody(method: string): boolean {
  return method !== "GET" && method !== "HEAD";
}

function getOriginUrl(rawOrigin: string | undefined, requestUrl: URL): URL | Response {
  if (!rawOrigin?.trim()) {
    return jsonError(
      503,
      "API backend não configurado neste deployment.",
    );
  }

  let origin: URL;
  try {
    origin = new URL(rawOrigin.trim());
  } catch {
    return jsonError(500, "Configuração do backend inválida.");
  }

  if (!["http:", "https:"].includes(origin.protocol)) {
    return jsonError(500, "Configuração do backend inválida.");
  }

  // A production Worker must never proxy to itself. This also turns a common
  // misconfiguration into a clear JSON error instead of a recursive loop.
  if (origin.host === requestUrl.host) {
    return jsonError(500, "Configuração do backend aponta para o próprio Worker.");
  }

  return origin;
}

async function proxyApiRequest(request: Request, env: Env): Promise<Response> {
  const requestUrl = new URL(request.url);
  const originOrError = getOriginUrl(env.API_ORIGIN, requestUrl);
  if (originOrError instanceof Response) return originOrError;

  const target = new URL(originOrError.toString());
  target.pathname = requestUrl.pathname;
  target.search = requestUrl.search;

  const headers = new Headers(request.headers);
  // The Node backend validates request origins. From the backend's point of
  // view the Worker is the trusted same-origin gateway.
  headers.set("host", target.host);
  headers.set("x-forwarded-host", requestUrl.host);
  headers.set("x-forwarded-proto", requestUrl.protocol.replace(":", ""));
  const browserOrigin = headers.get("origin");
  if (browserOrigin) headers.set("origin", originOrError.origin);

  const forwardedRequest = new Request(target, {
    method: request.method,
    headers,
    body: hasRequestBody(request.method) ? request.body : undefined,
    redirect: "manual",
  });

  try {
    return await fetch(forwardedRequest);
  } catch {
    // Do not leak origin details or runtime errors to the browser.
    return jsonError(502, "API backend indisponível.");
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (isApiRequest(url)) {
      return proxyApiRequest(request, env);
    }

    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;