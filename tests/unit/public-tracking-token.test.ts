import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  createPublicTrackingToken,
  verifyPublicTrackingToken,
} from "../../server/core/security/publicTrackingToken";
import {
  buildPublicDeliveryTrackingPayload,
  buildPublicRouteTrackingPayload,
} from "../../server/modules/logistics/public-tracking.dto";

const previousSecret = process.env.SESSION_SECRET;
const testSecret = "test-session-secret-for-public-tracking-0123456789";

before(() => {
  process.env.SESSION_SECRET = testSecret;
});

after(() => {
  if (previousSecret === undefined) delete process.env.SESSION_SECRET;
  else process.env.SESSION_SECRET = previousSecret;
});

describe("tokens de rastreamento público", () => {
  test("aceita token válido vinculado ao tipo e recurso", () => {
    const issued = createPublicTrackingToken("delivery", 123, 1_000);
    const claims = verifyPublicTrackingToken(issued.token, "delivery", 1_001);

    assert.equal(claims?.type, "delivery");
    assert.equal(claims?.resourceId, 123);
    assert.equal(claims?.purpose, "public_tracking");
    assert.equal(issued.token.includes("123"), false);
  });

  test("rejeita token inválido ou adulterado", () => {
    const issued = createPublicTrackingToken("route", 456, 1_000);
    const tokenParts = issued.token.split(".");
    const signature = tokenParts.pop()!;
    const tamperedSignature = `${signature[0] === "A" ? "B" : "A"}${signature.slice(1)}`;
    const tampered = [...tokenParts, tamperedSignature].join(".");

    assert.equal(verifyPublicTrackingToken(tampered, "route", 1_001), null);
    assert.equal(verifyPublicTrackingToken("456", "route", 1_001), null);
  });

  test("rejeita token expirado", () => {
    const issued = createPublicTrackingToken("delivery", 123, 1_000);
    assert.equal(
      verifyPublicTrackingToken(issued.token, "delivery", issued.expiresAt),
      null,
    );
  });

  test("rejeita troca de tipo e alteração do recurso", () => {
    const issued = createPublicTrackingToken("delivery", 123, 1_000);
    assert.equal(verifyPublicTrackingToken(issued.token, "route", 1_001), null);

    const claims = verifyPublicTrackingToken(issued.token, "delivery", 1_001);
    assert.notEqual(claims?.resourceId, 124);
  });

  test("ausência de token não é aceita", () => {
    assert.equal(verifyPublicTrackingToken(undefined, "delivery"), null);
    assert.equal(verifyPublicTrackingToken("", "route"), null);
  });
});

describe("DTOs públicos de rastreamento", () => {
  test("delivery DTO não expõe ID, empresa ou coordenada precisa", () => {
    const payload = buildPublicDeliveryTrackingPayload({
      status: "em_rota",
      scheduledDate: "2026-09-10",
      deliveredAt: null,
      routePosition: 2,
      totalStopsInRoute: 4,
      stopsAhead: 1,
      etaMinutes: 15,
      etaTime: "2026-09-10T12:00:00.000Z",
      driverPosition: {
        latitude: "-23.550520",
        longitude: "-46.633308",
        recordedAt: "2026-09-10T11:00:00.000Z",
      },
    });

    assert.equal("id" in payload, false);
    assert.equal("companyId" in payload, false);
    assert.equal(payload.driverPosition?.lat, "-23.55");
    assert.equal(payload.driverPosition?.lng, "-46.63");
  });

  test("route DTO remove identificadores, endereço completo e telemetria", () => {
    const payload = buildPublicRouteTrackingPayload({
      route: { name: "Rota manhã", status: "em_rota", deliveryDate: "2026-09-10" },
      stops: [{
        ordem: 1,
        cidade: "São Paulo",
        estado: "SP",
        latitude: "-23.550520",
        longitude: "-46.633308",
        status: "em_rota",
      }],
      deliveries: [{
        status: "em_rota",
        routePosition: 1,
        latitude: "-23.550520",
        longitude: "-46.633308",
        scheduledDate: "2026-09-10",
        deliveredAt: null,
      }],
      driverPosition: {
        lat: "-23.550520",
        lng: "-46.633308",
        recordedAt: "2026-09-10T11:00:00.000Z",
      },
    });

    assert.equal(payload.driver, null);
    assert.equal("id" in payload.route, false);
    assert.equal("companyId" in payload.stops[0], false);
    assert.equal("endereco" in payload.stops[0], false);
    assert.equal("accuracy" in payload.driverPosition!, false);
    assert.equal(payload.driverPosition?.lat, "-23.55");
  });
});