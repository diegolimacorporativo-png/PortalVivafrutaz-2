import { test } from "node:test";
import assert from "node:assert/strict";
import { dateInTimeZone } from "../../server/modules/logistics/local-date";

test("route calendar date follows São Paulo instead of UTC", () => {
  assert.equal(dateInTimeZone(new Date("2026-10-27T00:30:00.000Z")), "2026-10-26");
  assert.equal(dateInTimeZone(new Date("2026-10-27T03:30:00.000Z")), "2026-10-27");
});
