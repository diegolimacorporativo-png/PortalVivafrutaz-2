import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  isNewerGpsCapture,
  validateGpsSubmission,
} from "../../server/modules/logistics/gps-submission";

const now = new Date("2026-10-09T15:00:00.000Z");

describe("GPS submission validation", () => {
  test("preserves the device capture time and normalizes coordinates", () => {
    const capturedAt = now.getTime() - 20_000;
    const result = validateGpsSubmission({
      latitude: "-23.5505200",
      longitude: "-46.6333080",
      accuracy: 8.3,
      speed: 5,
      heading: 360,
      capturedAt,
    }, now);

    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.latitude, "-23.5505200");
    assert.equal(result.longitude, "-46.6333080");
    assert.equal(result.recordedAt.getTime(), capturedAt);
    assert.equal(result.heading, "0.00");
  });

  test("rejects missing capture times rather than replacing them with server time", () => {
    const result = validateGpsSubmission({
      latitude: 0,
      longitude: 0,
      accuracy: null,
      speed: null,
      heading: null,
    }, now);

    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.status, 400);
      assert.equal(result.code, "GPS_CAPTURE_TIME_INVALID");
    }
  });

  test("rejects empty, null, and out-of-range coordinates rather than coercing them to zero", () => {
    for (const input of [
      { latitude: "", longitude: "-46" },
      { latitude: null, longitude: "-46" },
      { latitude: "-91", longitude: "-46" },
      { latitude: "-23", longitude: "181" },
    ]) {
      const result = validateGpsSubmission(input, now);
      assert.equal(result.ok, false);
      if (!result.ok) {
        assert.equal(result.code, "GPS_COORDINATES_INVALID");
        assert.equal(result.status, 400);
      }
    }
  });

  test("rejects malformed telemetry and invalid capture timestamps", () => {
    const invalidSpeed = validateGpsSubmission({
      latitude: 0,
      longitude: 0,
      speed: -1,
      capturedAt: now.getTime(),
    }, now);
    assert.equal(invalidSpeed.ok, false);
    if (!invalidSpeed.ok) assert.equal(invalidSpeed.code, "GPS_TELEMETRY_INVALID");

    for (const capturedAt of [null, "", "2026-10-09T15:00:00.000Z", Number.MAX_SAFE_INTEGER + 1]) {
      const invalidTimestamp = validateGpsSubmission({
        latitude: 0,
        longitude: 0,
        capturedAt,
      }, now);
      assert.equal(invalidTimestamp.ok, false);
      if (!invalidTimestamp.ok) {
        assert.equal(invalidTimestamp.code, "GPS_CAPTURE_TIME_INVALID");
      }
    }
  });

  test("rejects stale offline samples and timestamps too far in the future", () => {
    for (const capturedAt of [
      now.getTime() - 5 * 60_000 - 1,
      now.getTime() + 30_000 + 1,
    ]) {
      const result = validateGpsSubmission({
        latitude: 0,
        longitude: 0,
        capturedAt,
      }, now);
      assert.equal(result.ok, false);
      if (!result.ok) {
        assert.equal(result.status, 409);
        assert.equal(result.code, "GPS_CAPTURE_TIME_STALE");
      }
    }
  });

  test("only advances the latest GPS position for a strictly newer capture", () => {
    const latest = new Date(now.getTime());

    assert.equal(isNewerGpsCapture(new Date(now.getTime() + 1), latest), true);
    assert.equal(isNewerGpsCapture(new Date(now.getTime()), latest), false);
    assert.equal(isNewerGpsCapture(new Date(now.getTime() - 1), latest), false);
    assert.equal(isNewerGpsCapture(new Date(Number.NaN), latest), false);
    assert.equal(isNewerGpsCapture(new Date(now.getTime()), new Date(Number.NaN)), false);
    assert.equal(isNewerGpsCapture(new Date(now.getTime()), null), true);
  });
});
