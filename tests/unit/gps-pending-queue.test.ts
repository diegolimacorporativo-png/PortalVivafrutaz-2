import { test } from "node:test";
import assert from "node:assert/strict";
import {
  GPS_QUEUE_STORAGE_KEY,
  readPendingGpsPositions,
  writePendingGpsPositions,
  type PendingGpsPosition,
} from "../../client/src/lib/gps-pending-queue";

function createStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  const reads: string[] = [];
  return {
    reads,
    getItem(key: string) {
      reads.push(key);
      return values.get(key) ?? null;
    },
    setItem(key: string, value: string) {
      values.set(key, value);
    },
  };
}

test("offline replay preserves the original capture timestamp across storage", () => {
  const storage = createStorage();
  const capturedAt = Date.parse("2026-10-09T14:59:30.000Z");
  const position: PendingGpsPosition = {
    capturedAt,
    payload: {
      latitude: -23.55052,
      longitude: -46.633308,
      accuracy: 8,
      speed: 5,
      heading: 90,
    },
  };

  writePendingGpsPositions(storage, [position]);

  assert.deepEqual(readPendingGpsPositions(storage), [position]);
  assert.deepEqual(storage.reads, [GPS_QUEUE_STORAGE_KEY]);
});

test("does not replay legacy entries whose timestamp meant enqueue time", () => {
  const legacyQueue = JSON.stringify([{
    capturedAt: Date.now(),
    payload: {
      latitude: -23.5,
      longitude: -46.6,
      accuracy: null,
      speed: null,
      heading: null,
    },
  }]);
  const storage = createStorage({
    "vivafrutaz:gps-pending:v1": legacyQueue,
  });

  assert.deepEqual(readPendingGpsPositions(storage), []);
  assert.deepEqual(storage.reads, [GPS_QUEUE_STORAGE_KEY]);
});

test("drops malformed timestamps and out-of-range queued coordinates", () => {
  const storage = createStorage({
    [GPS_QUEUE_STORAGE_KEY]: JSON.stringify([
      {
        capturedAt: Number.MAX_SAFE_INTEGER + 1,
        payload: { latitude: 0, longitude: 0 },
      },
      {
        capturedAt: 1_791_558_000_000,
        payload: { latitude: 91, longitude: 0 },
      },
    ]),
  });

  assert.deepEqual(readPendingGpsPositions(storage), []);
});
