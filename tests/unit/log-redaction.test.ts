import { test } from "node:test";
import assert from "node:assert/strict";
import { redactTrackingTokenFromPath } from "../../server/core/security/logRedaction";
import { requestLogger } from "../../server/middleware/requestLogger";

test("redacts public delivery and authenticated route capabilities from log paths", () => {
  const deliveryPath = redactTrackingTokenFromPath(
    "/api/track/delivery-secret-capability?source=email",
  );
  const routePath = redactTrackingTokenFromPath(
    "/api/logistics/track/route-secret-capability",
  );

  assert.equal(deliveryPath, "/api/track/:token?source=email");
  assert.equal(routePath, "/api/logistics/track/:token");
  assert.equal(deliveryPath.includes("delivery-secret-capability"), false);
  assert.equal(routePath.includes("route-secret-capability"), false);
});

test("redacts PWA tracking routes and token-bearing query parameters", () => {
  const publicPage = redactTrackingTokenFromPath(
    "/track/delivery-secret-capability?source=email&trackingToken=query-secret",
  );
  const internalPage = redactTrackingTokenFromPath(
    "https://example.test/driver-map/route-secret-capability?access_token=access-secret",
  );
  const apiQuery = redactTrackingTokenFromPath(
    "/api/other?session_token=session-secret&keep=this",
  );

  assert.equal(
    publicPage,
    "/track/:token?source=email&trackingToken=[REDACTED]",
  );
  assert.equal(
    internalPage,
    "https://example.test/driver-map/:token?access_token=[REDACTED]",
  );
  assert.equal(
    apiQuery,
    "/api/other?session_token=[REDACTED]&keep=this",
  );
  for (const secret of [
    "delivery-secret-capability",
    "route-secret-capability",
    "query-secret",
    "access-secret",
    "session-secret",
  ]) {
    assert.equal(`${publicPage} ${internalPage} ${apiQuery}`.includes(secret), false);
  }
});

test("keeps request logging paths safe without changing live tracking URLs", () => {
  const liveUrl = "/track/valid-capability";
  const loggedPath = redactTrackingTokenFromPath(liveUrl);

  assert.equal(liveUrl, "/track/valid-capability");
  assert.equal(loggedPath, "/track/:token");
  assert.equal(loggedPath.includes("valid-capability"), false);
});

test("request logger never emits a complete tracking capability", () => {
  const lines: string[] = [];
  const originalInfo = console.info;
  let finish: (() => void) | undefined;
  console.info = (...values: any[]) => {
    lines.push(values.map(String).join(" "));
  };

  try {
    requestLogger(
      {
        path: "/driver-map/route-capability-secret",
        method: "GET",
        requestId: "redaction-test",
      } as any,
      {
        on: (_event: string, listener: () => void) => {
          finish = listener;
        },
      } as any,
      () => {},
    );
    finish?.();
  } finally {
    console.info = originalInfo;
  }

  assert.equal(lines.length, 2);
  assert.ok(lines.every((line) => !line.includes("route-capability-secret")));
  assert.ok(lines.every((line) => line.includes("/driver-map/:token")));
});
