export type GpsQueuePayload = {
  latitude: number;
  longitude: number;
  accuracy: number | null;
  speed: number | null;
  heading: number | null;
};

export type PendingGpsPosition = {
  payload: GpsQueuePayload;
  capturedAt: number;
};

// v1 used enqueue time instead of the browser's GPS capture timestamp.
export const GPS_QUEUE_STORAGE_KEY = "vivafrutaz:gps-pending:v2";
export const GPS_QUEUE_LIMIT = 20;

type GpsQueueStorage = Pick<Storage, "getItem" | "setItem">;

export function readPendingGpsPositions(
  storage: Pick<GpsQueueStorage, "getItem">,
): PendingGpsPosition[] {
  try {
    const raw = storage.getItem(GPS_QUEUE_STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];

    return parsed
      .filter((entry): entry is PendingGpsPosition => {
        const payload = entry?.payload;
        const capturedAt = Number(entry?.capturedAt);
        const latitude = Number(payload?.latitude);
        const longitude = Number(payload?.longitude);
        return Boolean(
          payload &&
          Number.isSafeInteger(capturedAt) &&
          capturedAt > 0 &&
          Number.isFinite(latitude) &&
          latitude >= -90 &&
          latitude <= 90 &&
          Number.isFinite(longitude) &&
          longitude >= -180 &&
          longitude <= 180,
        );
      })
      .slice(-GPS_QUEUE_LIMIT)
      .map((entry) => ({
        capturedAt: Number(entry.capturedAt),
        payload: {
          latitude: Number(entry.payload.latitude),
          longitude: Number(entry.payload.longitude),
          accuracy: entry.payload.accuracy == null
            ? null
            : Number(entry.payload.accuracy),
          speed: entry.payload.speed == null ? null : Number(entry.payload.speed),
          heading: entry.payload.heading == null
            ? null
            : Number(entry.payload.heading),
        },
      }));
  } catch {
    return [];
  }
}

export function writePendingGpsPositions(
  storage: Pick<GpsQueueStorage, "setItem">,
  queue: PendingGpsPosition[],
): void {
  try {
    storage.setItem(
      GPS_QUEUE_STORAGE_KEY,
      JSON.stringify(queue.slice(-GPS_QUEUE_LIMIT)),
    );
  } catch {
    // Storage can be unavailable in private/restricted browser contexts.
  }
}
