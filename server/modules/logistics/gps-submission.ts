import {
  TRACKING_GPS_FUTURE_TOLERANCE_MS,
  TRACKING_GPS_MAX_AGE_MS,
} from "./delivery-tracking.logic";

export type GpsSubmissionErrorCode =
  | "GPS_COORDINATES_INVALID"
  | "GPS_TELEMETRY_INVALID"
  | "GPS_CAPTURE_TIME_INVALID"
  | "GPS_CAPTURE_TIME_STALE";

export type GpsSubmissionResult =
  | {
      ok: true;
      latitude: string;
      longitude: string;
      accuracy?: string;
      speed?: string;
      heading?: string;
      recordedAt: Date;
    }
  | {
      ok: false;
      code: GpsSubmissionErrorCode;
      status: 400 | 409;
      message: string;
    };

function finiteNumber(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value !== "string" || value.trim() === "") return null;
  const parsed = Number(value.trim());
  return Number.isFinite(parsed) ? parsed : null;
}

function optionalNumber(
  value: unknown,
  name: string,
  min: number,
  max: number,
): { value?: number; error?: GpsSubmissionResult & { ok: false } } {
  if (value === undefined || value === null) return {};
  const parsed = finiteNumber(value);
  if (parsed === null || parsed < min || parsed > max) {
    return {
      error: {
        ok: false,
        code: "GPS_TELEMETRY_INVALID",
        status: 400,
        message: `${name} inválido`,
      },
    };
  }
  return { value: parsed };
}

function parseCaptureTime(value: unknown, now: Date): number | null {
  if (value === undefined) return now.getTime(); // compatibility with older tracker builds
  if (typeof value !== "number" && typeof value !== "string") return null;
  if (typeof value === "string" && !/^\d{1,16}$/.test(value.trim())) return null;
  const timestamp = Number(value);
  return Number.isSafeInteger(timestamp) && timestamp > 0 ? timestamp : null;
}

export function validateGpsSubmission(
  body: unknown,
  now: Date = new Date(),
): GpsSubmissionResult {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return {
      ok: false,
      code: "GPS_COORDINATES_INVALID",
      status: 400,
      message: "latitude e longitude válidas são obrigatórias",
    };
  }

  const input = body as Record<string, unknown>;
  const latitude = finiteNumber(input.latitude);
  const longitude = finiteNumber(input.longitude);
  if (
    latitude === null ||
    longitude === null ||
    latitude < -90 ||
    latitude > 90 ||
    longitude < -180 ||
    longitude > 180
  ) {
    return {
      ok: false,
      code: "GPS_COORDINATES_INVALID",
      status: 400,
      message: "latitude e longitude válidas são obrigatórias",
    };
  }

  const accuracy = optionalNumber(input.accuracy, "accuracy", 0, 999_999.99);
  const speed = optionalNumber(input.speed, "speed", 0, 100);
  const heading = optionalNumber(input.heading, "heading", 0, 360);
  const telemetryError = accuracy.error ?? speed.error ?? heading.error;
  if (telemetryError) return telemetryError;

  const capturedAt = parseCaptureTime(input.capturedAt, now);
  if (capturedAt === null) {
    return {
      ok: false,
      code: "GPS_CAPTURE_TIME_INVALID",
      status: 400,
      message: "Horário da captura GPS inválido",
    };
  }

  const age = now.getTime() - capturedAt;
  if (
    age > TRACKING_GPS_MAX_AGE_MS ||
    age < -TRACKING_GPS_FUTURE_TOLERANCE_MS
  ) {
    return {
      ok: false,
      code: "GPS_CAPTURE_TIME_STALE",
      status: 409,
      message: "Posição GPS antiga ou com horário futuro; capture uma posição nova",
    };
  }

  return {
    ok: true,
    latitude: latitude.toFixed(7),
    longitude: longitude.toFixed(7),
    accuracy: accuracy.value?.toFixed(2),
    speed: speed.value?.toFixed(2),
    heading: heading.value === undefined
      ? undefined
      : (heading.value % 360).toFixed(2),
    recordedAt: new Date(capturedAt),
  };
}
