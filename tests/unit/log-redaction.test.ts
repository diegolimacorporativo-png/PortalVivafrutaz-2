import { test } from "node:test";
import assert from "node:assert/strict";
import { redactTrackingTokenFromPath } from "../../server/core/security/logRedaction";

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
