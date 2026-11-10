import assert from "node:assert/strict";
import { test } from "node:test";
import { buildGeocodeUrl, buildGeocodeUrls, register } from "../../server/routes/geocode.routes";

function routeHandler() {
  let handler: ((req: any, res: any) => Promise<unknown>) | undefined;
  register({ get: (_path: string, callback: typeof handler) => { handler = callback; } } as any);
  assert.ok(handler, "geocode route should be registered");
  return handler;
}

function responseRecorder() {
  const result: { statusCode: number; body: unknown } = { statusCode: 200, body: undefined };
  return {
    result,
    status(code: number) { result.statusCode = code; return this; },
    json(body: unknown) { result.body = body; return this; },
  };
}

test("builds a structured Brazil geocoding query including number and CEP", () => {
  const url = buildGeocodeUrl({
    street: "Rua das Flores", number: "42", neighborhood: "Centro",
    city: "Campinas", state: "SP", postalcode: "13010-000",
  });

  assert.ok(url);
  assert.equal(url.searchParams.get("street"), "42 Rua das Flores, Centro");
  assert.equal(url.searchParams.get("city"), "Campinas");
  assert.equal(url.searchParams.get("state"), "SP");
  assert.equal(url.searchParams.get("postalcode"), "13010000");
  assert.equal(url.searchParams.get("countrycodes"), "br");
});

test("builds progressively simpler street queries without falling back to city-only coordinates", () => {
  const urls = buildGeocodeUrls({
    street: "Rua Quitanduba", number: "245", neighborhood: "Caxingui",
    city: "São Paulo", state: "SP", postalcode: "05516-030",
  });

  assert.equal(urls.length, 3);
  assert.equal(urls[0].searchParams.get("postalcode"), "05516030");
  assert.equal(urls[0].searchParams.get("street"), "245 Rua Quitanduba, Caxingui");
  assert.equal(urls[1].searchParams.get("street"), "245 Rua Quitanduba");
  assert.equal(urls[1].searchParams.has("postalcode"), false);
  assert.match(urls[2].searchParams.get("q") || "", /245 Rua Quitanduba.*São Paulo.*Brasil/);
  for (const url of urls) {
    assert.equal(url.searchParams.get("countrycodes"), "br");
    assert.match(url.searchParams.get("street") || url.searchParams.get("q") || "", /Rua Quitanduba/);
  }
});

test("rejects an empty geocoding query", async () => {
  const handler = routeHandler();
  const res = responseRecorder();
  await handler({ query: {} }, res);
  assert.equal(res.result.statusCode, 400);
});

test("returns only valid coordinates from the geocoder", async () => {
  const handler = routeHandler();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response(JSON.stringify([
    { lat: "-23.5", lon: "-46.6", display_name: "Synthetic address" },
    { lat: "999", lon: "0" },
  ]), { status: 200, headers: { "content-type": "application/json" } })) as typeof fetch;
  try {
    const res = responseRecorder();
    await handler({ query: { street: "Synthetic Street 9031", city: "Campinas", postalcode: "13010000" } }, res);
    assert.equal(res.result.statusCode, 200);
    assert.deepEqual(res.result.body, [{ lat: "-23.5", lon: "-46.6", display_name: "Synthetic address" }]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("retries with a simpler street query when the complete address has no result", async () => {
  const handler = routeHandler();
  const originalFetch = globalThis.fetch;
  const requestedUrls: URL[] = [];
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = new URL(String(input));
    requestedUrls.push(url);
    if (url.searchParams.has("postalcode")) {
      return new Response("[]", { status: 200, headers: { "content-type": "application/json" } });
    }
    return new Response(JSON.stringify([
      { lat: "-23.5817", lon: "-46.7166", display_name: "Rua Quitanduba, Caxingui, São Paulo" },
    ]), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;

  try {
    const res = responseRecorder();
    await handler({ query: {
      street: "Rua Quitanduba", number: "245", neighborhood: "Caxingui",
      city: "São Paulo", state: "SP", postalcode: "05516-030",
    } }, res);
    assert.equal(res.result.statusCode, 200);
    assert.equal(requestedUrls.length, 2);
    assert.equal(requestedUrls[1].searchParams.get("street"), "245 Rua Quitanduba");
    assert.deepEqual(res.result.body, [{
      lat: "-23.5817", lon: "-46.7166", display_name: "Rua Quitanduba, Caxingui, São Paulo",
    }]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("surfaces upstream rate limiting as a retryable service response", async () => {
  const handler = routeHandler();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response("", { status: 429 })) as typeof fetch;
  try {
    const res = responseRecorder();
    await handler({ query: { q: "synthetic address" } }, res);
    assert.equal(res.result.statusCode, 503);
    assert.match(String((res.result.body as any).message), /temporariamente ocupado/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
