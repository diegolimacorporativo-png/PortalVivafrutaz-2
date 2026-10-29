import assert from "node:assert/strict";
import { test } from "node:test";
import { buildGeocodeUrl, register } from "../../server/routes/geocode.routes";

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
