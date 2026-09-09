import assert from "node:assert/strict";
import { test } from "node:test";
import { LogisticsService } from "../../server/modules/logistics/logistics.service";

const actorA = {
  id: 10,
  role: "LOGISTICS",
  email: "a@example.test",
  empresaId: 1,
};

function makeTenantRepo() {
  const companies = [
    {
      id: 1,
      companyName: "Tenant A",
      active: true,
      addressCity: "São Paulo",
      addressStreet: "Rua A",
      addressZip: "01000000",
      deliveryConfigJson: JSON.stringify({ monday: { enabled: true } }),
    },
    {
      id: 2,
      companyName: "Tenant B",
      active: true,
      addressCity: "Rio de Janeiro",
      addressStreet: "Rua B",
      addressZip: "20000000",
      deliveryConfigJson: JSON.stringify({ monday: { enabled: true } }),
    },
  ];
  const orders = [
    {
      id: 101,
      orderCode: "A-101",
      companyId: 1,
      status: "CONFIRMED",
      deliveryDate: "2026-09-14",
      totalValue: "10.00",
    },
    {
      id: 202,
      orderCode: "B-202",
      companyId: 2,
      status: "CONFIRMED",
      deliveryDate: "2026-09-14",
      totalValue: "20.00",
    },
  ];
  const drivers = [
    { id: 11, empresaId: 1, name: "Motorista A", active: true },
    { id: 22, empresaId: 2, name: "Motorista B", active: true },
  ];
  const routes = [
    { id: 111, empresaId: 1, name: "Rota A", deliveryDate: "2026-09-14", driverId: 11 },
    { id: 222, empresaId: 2, name: "Rota B", deliveryDate: "2026-09-14", driverId: 22 },
  ];
  const deliveries = [
    {
      id: 1001,
      companyId: 1,
      driverId: 11,
      routeId: 111,
      scheduledDate: "2026-09-14",
      status: "pendente",
      latitude: "-23.55",
      longitude: "-46.63",
    },
    {
      id: 2002,
      companyId: 2,
      driverId: 22,
      routeId: 222,
      scheduledDate: "2026-09-14",
      status: "pendente",
      latitude: "-22.90",
      longitude: "-43.20",
    },
  ];

  const repo: any = {
    getCompany: async (id: number) => companies.find((company) => company.id === id),
    getCompanies: async () => companies,
    getOrders: async () => orders,
    getOrdersSafe: async (tenantId: number) =>
      orders.filter((order) => order.companyId === tenantId),
    getDrivers: async () => drivers,
    getDriversSafe: async (tenantId: number) =>
      drivers.filter((driver) => driver.empresaId === tenantId),
    getRoutes: async () => routes,
    getRoutesSafe: async (tenantId: number) =>
      routes.filter((route) => route.empresaId === tenantId),
    getDeliveries: async (filters: any = {}) =>
      deliveries.filter((delivery) =>
        (!filters.companyId || delivery.companyId === filters.companyId) &&
        (!filters.driverId || delivery.driverId === filters.driverId) &&
        (!filters.routeId || delivery.routeId === filters.routeId) &&
        (!filters.status || delivery.status === filters.status) &&
        (!filters.date || delivery.scheduledDate === filters.date),
      ),
  };

  return { repo, companies, orders, drivers, routes, deliveries };
}

test("analytics tenant-bound uses only tenant A for search and recommendations", async () => {
  const { repo } = makeTenantRepo();
  const service = new LogisticsService(repo);

  const search = await service.smartSearch("Tenant", actorA);
  assert.deepEqual(search.map((item) => item.company.id), [1]);
  assert.equal(search[0]?.suggestion.bestDriver?.id, 11);
  assert.equal(search[0]?.suggestion.suggestedRoute?.id, 111);

  const best = await service.bestDriver("2026-09-14", actorA);
  assert.equal(best.driver?.id, 11);
  assert.deepEqual(best.allDrivers.map((driver: any) => driver.id), [11]);

  const plan = await service.smartRoutePlan("2026-09-14", actorA);
  assert.equal(plan.totalDeliveries, 1);
  assert.equal(plan.overloadedDrivers.some((driver: any) => driver.id === 22), false);
});

test("day-orders and route-assistant do not aggregate tenant B", async () => {
  const { repo } = makeTenantRepo();
  const service = new LogisticsService(repo);

  const day = await service.dayOrders({ date: "2026-09-14" }, actorA);
  assert.equal(day.total, 1);
  assert.deepEqual(day.orders.map((order) => order.companyId), [1]);

  const assistant = await service.routeAssistant(
    { day: "monday", date: "2026-09-14" },
    actorA,
  );
  assert.deepEqual(assistant.map((company) => company.id), [1]);
  assert.equal(assistant[0]?.hasOrderForDate, true);
});

test("route-insertion rejects a companyId from another tenant", async () => {
  const { repo } = makeTenantRepo();
  const service = new LogisticsService(repo);

  await assert.rejects(
    service.routeInsertion({ companyId: 2, date: "2026-09-14" }, actorA),
    /não pertence ao tenant autorizado/i,
  );
});

test("suggest-route, simulate-day and delivery reports use tenant A inputs only", async () => {
  const { repo } = makeTenantRepo();
  const service = new LogisticsService(repo);

  const suggestion = await service.suggestRoute(
    { newPoint: { lat: -23.55, lng: -46.63 }, date: "2026-09-14" },
    actorA,
  );
  assert.equal(suggestion.routesAnalyzed, 1);

  const simulation = await service.simulateDay(
    { date: "2026-09-14" },
    actorA,
  );
  assert.equal(simulation.totalDeliveries, 1);
  assert.equal(simulation.ordersBridged.length, 0);

  const report = await service.deliveriesReport(
    { companyId: 2, driverId: 22, status: "pendente" },
    actorA,
  );
  assert.equal(report.summary.total, 0);
  assert.equal(report.deliveries.length, 0);
});

test("MASTER without a tenant preserves explicit global analytics access", async () => {
  const { repo } = makeTenantRepo();
  const service = new LogisticsService(repo);
  const result = await service.smartSearch("Tenant", {
    id: 1,
    role: "MASTER",
    empresaId: null,
  });
  assert.deepEqual(result.map((item) => item.company.id), [1, 2]);
});

test("unbound ADMIN fails closed instead of receiving global analytics", async () => {
  const { repo } = makeTenantRepo();
  const service = new LogisticsService(repo);
  await assert.rejects(
    service.smartSearch("Tenant", {
      id: 2,
      role: "ADMIN",
      empresaId: null,
    }),
    /precisa estar vinculado/i,
  );
});