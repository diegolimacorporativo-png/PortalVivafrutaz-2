import assert from "node:assert/strict";
import { mock, test } from "node:test";
import { calculateRoadEta, computeRoadRoute } from "../../server/modules/logistics/road-routing.service";

const origin = { latitude: -23.55, longitude: -46.63 };
const firstStop = { latitude: -23.56, longitude: -46.64 };
const target = { latitude: -23.57, longitude: -46.65 };

async function withRouter<T>(url: string | undefined, run: () => Promise<T>): Promise<T> {
  const previous = process.env.OSRM_ROUTING_URL;
  if (url === undefined) delete process.env.OSRM_ROUTING_URL;
  else process.env.OSRM_ROUTING_URL = url;
  try {
    return await run();
  } finally {
    if (previous === undefined) delete process.env.OSRM_ROUTING_URL;
    else process.env.OSRM_ROUTING_URL = previous;
  }
}

test("sem endpoint configurado não calcula ETA fictício nem chama serviço externo", async () => {
  await withRouter("", async () => {
    const fetchMock = mock.method(globalThis, "fetch", async () => {
      throw new Error("fetch não deveria ser chamado");
    });
    try {
      assert.equal(await computeRoadRoute([origin, target]), null);
      assert.equal(fetchMock.mock.callCount(), 0);
    } finally {
      fetchMock.mock.restore();
    }
  });
});

test("consulta percurso com vários pontos e interpreta distâncias/tempos viários do OSRM", async () => {
  await withRouter("https://osrm.example.test/", async () => {
    const fetchMock = mock.method(globalThis, "fetch", async (input: any) => {
      const url = new URL(String(input));
      assert.equal(url.pathname, "/route/v1/driving/-46.630000,-23.550000;-46.640000,-23.560000;-46.650000,-23.570000");
      assert.equal(url.searchParams.get("overview"), "false");
      assert.equal(url.searchParams.get("steps"), "false");
      return new Response(JSON.stringify({
        code: "Ok",
        routes: [{
          duration: 1500,
          distance: 18000,
          legs: [
            { duration: 600, distance: 7000 },
            { duration: 900, distance: 11000 },
          ],
        }],
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    });
    const now = new Date("2026-10-28T12:00:00.000Z");
    try {
      const route = await computeRoadRoute([origin, firstStop, target], now);
      assert.equal(route?.provider, "osrm_openstreetmap");
      assert.equal(route?.distanceKm, 18);
      assert.equal(route?.durationSeconds, 1500);
      assert.equal(route?.legs.length, 2);
      const cached = await computeRoadRoute([origin, firstStop, target], new Date(now.getTime() + 1000));
      assert.deepEqual(cached, route);
      assert.equal(fetchMock.mock.callCount(), 1);
    } finally {
      fetchMock.mock.restore();
    }
  });
});

test("ETA viário soma tempos de percurso, janelas e tempo de parada", async () => {
  await withRouter("https://osrm.example.test", async () => {
    const fetchMock = mock.method(globalThis, "fetch", async () => new Response(JSON.stringify({
      code: "Ok",
      routes: [{
        duration: 1200,
        distance: 12000,
        legs: [
          { duration: 600, distance: 6000 },
          { duration: 600, distance: 6000 },
        ],
      }],
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
    try {
      const now = new Date("2026-10-28T12:00:00.000Z");
      const result = await calculateRoadEta([
        { latitude: -23.58, longitude: -46.68, tempoEstimadoMin: 5 },
        { latitude: -23.59, longitude: -46.69, includeDwell: false },
      ], origin, now);
      assert.equal(result?.provider, "osrm_openstreetmap");
      assert.equal(result?.stops[0].etaMinutes, 10);
      assert.equal(result?.stops[1].etaMinutes, 25);
      assert.equal(result?.summary.totalDistanceKm, 12);
      assert.equal(fetchMock.mock.callCount(), 1);
    } finally {
      fetchMock.mock.restore();
    }
  });
});

test("falha do serviço de rotas deixa a previsão indisponível", async () => {
  await withRouter("https://osrm.example.test", async () => {
    const fetchMock = mock.method(globalThis, "fetch", async () => new Response("{}", { status: 503 }));
    try {
      assert.equal(await computeRoadRoute([origin, { latitude: -23.58, longitude: -46.66 }]), null);
    } finally {
      fetchMock.mock.restore();
    }
  });
});