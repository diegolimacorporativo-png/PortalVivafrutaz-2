import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { LogisticsService } from "../../server/modules/logistics/logistics.service";

function makeRepo(overrides: Record<string, any> = {}) {
  const calls: Record<string, any[]> = {};
  const track = (name: string, result: (...args: any[]) => any) =>
    async (...args: any[]) => {
      (calls[name] ||= []).push(args);
      return result(...args);
    };

  return {
    _calls: calls,
    getDrivers: track("getDrivers", () => []),
    getDriversSafe: track("getDriversSafe", () => []),
    getVehicles: track("getVehicles", () => []),
    getVehiclesSafe: track("getVehiclesSafe", () => []),
    getCompanies: track("getCompanies", () => []),
    getCompany: track("getCompany", () => undefined),
    getUser: track("getUser", () => undefined),
    createDriver: track("createDriver", (data) => ({ id: 1, ...data })),
    createVehicle: track("createVehicle", (data) => ({ id: 1, ...data })),
    createRoute: track("createRoute", (data) => ({ id: 1, ...data })),
    createMaintenance: track("createMaintenance", (data) => ({ id: 1, ...data })),
    updateDriver: track("updateDriver", (id, data) => ({ id, ...data })),
    updateDriverOwned: track("updateDriverOwned", (id, _tenantId, data) => ({ id, ...data })),
    updateVehicle: track("updateVehicle", (id, data) => ({ id, ...data })),
    updateVehicleOwned: track("updateVehicleOwned", (id, _tenantId, data) => ({ id, ...data })),
    updateRoute: track("updateRoute", (id, data) => ({ id, ...data })),
    updateRouteOwned: track("updateRouteOwned", (id, _tenantId, data) => ({ id, ...data })),
    updateRouteCompanyScope: track("updateRouteCompanyScope", (id, empresaId, data, companyIds) => ({ id, empresaId, ...data, companyIds })),
    updateMaintenance: track("updateMaintenance", (id, data) => ({ id, ...data })),
    updateMaintenanceOwned: track("updateMaintenanceOwned", (id, _tenantId, data) => ({ id, ...data })),
    log: track("log", () => undefined),
    ...overrides,
  } as any;
}

const tenantActor = {
  id: 10,
  role: "ADMIN",
  email: "admin@example.test",
  empresaId: 10,
};

describe("logistics — mass assignment and ownership", () => {
  test("driver update uses an allowlist and never accepts ownership fields", async () => {
    const repo = makeRepo();
    const service = new LogisticsService(repo);

    await service.updateDriver(
      7,
      {
        name: "Motorista atualizado",
        active: false,
        empresaId: 999,
        companyId: 999,
        createdAt: "2099-01-01",
        role: "MASTER",
      },
      tenantActor,
    );

    assert.deepEqual(repo._calls.updateDriverOwned[0], [
      7,
      10,
      { name: "Motorista atualizado", active: false },
    ]);
    assert.equal(repo._calls.updateDriver, undefined);
  });

  test("route update rejects a driver from another tenant", async () => {
    const repo = makeRepo({
      getDriversSafe: async () => [{ id: 21, empresaId: 99 }],
    });
    const service = new LogisticsService(repo);

    await assert.rejects(
      service.updateRoute(5, { driverId: 21 }, tenantActor),
      /Motorista não pertence ao tenant autorizado/,
    );
    assert.equal(repo._calls.updateRouteOwned, undefined);
  });

  test("route update keeps legitimate fields and strips spoofed ownership", async () => {
    const repo = makeRepo({
      getDriversSafe: async () => [{ id: 21, empresaId: 10 }],
      getVehiclesSafe: async () => [{ id: 31, empresaId: 10 }],
      getCompany: async () => ({ id: 10 }),
    });
    const service = new LogisticsService(repo);

    await service.updateRoute(
      5,
      {
        name: "Rota A",
        status: "IN_PROGRESS",
        driverId: "21",
        vehicleId: "31",
        companyIds: [10],
        companyId: 999,
        tenantId: 999,
        empresaId: 999,
        createdAt: "2099-01-01",
      },
      tenantActor,
    );

    assert.deepEqual(repo._calls.updateRouteCompanyScope[0], [
      5,
      10,
      {
        name: "Rota A",
        status: "IN_PROGRESS",
        driverId: 21,
        vehicleId: 31,
        companyIds: [10],
      },
      [10],
    ]);
    assert.equal(repo._calls.updateRouteOwned, undefined);
  });

  test("maintenance update rejects a vehicle from another tenant", async () => {
    const repo = makeRepo({
      getVehiclesSafe: async () => [{ id: 31, empresaId: 99 }],
    });
    const service = new LogisticsService(repo);

    await assert.rejects(
      service.updateMaintenance(4, { vehicleId: 31 }, tenantActor),
      /Veículo não pertence ao tenant autorizado/,
    );
    assert.equal(repo._calls.updateMaintenanceOwned, undefined);
  });

  test("tenant-bound vehicle creation derives empresaId from the actor", async () => {
    const repo = makeRepo();
    const service = new LogisticsService(repo);

    await service.createVehicle(
      {
        plate: "abc-1234",
        model: "Van",
        brand: "Marca",
        empresaId: 999,
        createdAt: "2099-01-01",
      },
      tenantActor,
    );

    assert.deepEqual(repo._calls.createVehicle[0][0], {
      empresaId: 10,
      plate: "ABC-1234",
      model: "Van",
      brand: "Marca",
      year: undefined,
      type: undefined,
      capacity: undefined,
      notes: undefined,
      active: true,
    });
  });

  test("tenant-bound maintenance creation derives empresaId and validates vehicle ownership", async () => {
    const repo = makeRepo({
      getVehiclesSafe: async () => [{ id: 31, empresaId: 10 }],
    });
    const service = new LogisticsService(repo);

    await service.createMaintenance(
      {
        vehicleId: 31,
        vehiclePlate: "ABC-1234",
        type: "PREVENTIVE",
        description: "Revisão",
        empresaId: 999,
        tenantId: 999,
        createdAt: "2099-01-01",
      },
      tenantActor,
    );

    assert.equal(repo._calls.createMaintenance[0][0].empresaId, 10);
    assert.equal(repo._calls.createMaintenance[0][0].vehicleId, 31);
    assert.equal(repo._calls.createMaintenance[0][0].type, "PREVENTIVE");
    assert.equal(repo._calls.createMaintenance[0][0].createdAt, undefined);
  });

  test("internal logistics actor can create a route for multiple active companies while empresaId stays the selected context", async () => {
    const checkedIds: number[] = [];
    const repo = makeRepo({ getCompany: async (id: number) => { checkedIds.push(id); return { id, active: true }; } });
    const service = new LogisticsService(repo);

    const route = await service.createRoute(
      { name: "Rota multiempresa", companyIds: [10, 20, 30] },
      { ...tenantActor, role: "LOGISTICS", identityType: "internal" },
    );

    assert.deepEqual(repo._calls.createRoute[0][0].companyIds, [10, 20, 30]);
    assert.equal(repo._calls.createRoute[0][0].empresaId, 10);
    assert.deepEqual(route.companyIds, [10, 20, 30]);
    assert.deepEqual(checkedIds, [10, 20, 30]);
  });

  test("tenant-bound single-company route keeps backward-compatible default scope", async () => {
    const repo = makeRepo({ getCompany: async (id: number) => ({ id, active: true }) });
    const service = new LogisticsService(repo);

    await service.createRoute({ name: "Rota antiga" }, tenantActor);

    assert.deepEqual(repo._calls.createRoute[0][0].companyIds, [10]);
    assert.equal(repo._calls.createRoute[0][0].empresaId, 10);
  });

  test("rejects a company outside a non-cross-company actor scope", async () => {
    const repo = makeRepo({ getCompany: async (id: number) => ({ id, active: true }) });
    const service = new LogisticsService(repo);

    await assert.rejects(
      service.createRoute({ name: "Rota", companyIds: [10, 20] }, tenantActor),
      /não está autorizado para todas as empresas/,
    );
    assert.equal(repo._calls.createRoute, undefined);
  });

  test("rejects nonexistent or inactive companies in a cross-company route", async () => {
    const repo = makeRepo({
      getCompany: async (id: number) => id === 20 ? undefined : ({ id, active: id !== 30 }),
    });
    const service = new LogisticsService(repo);
    const actor = { ...tenantActor, role: "LOGISTICS", identityType: "internal" as const };

    await assert.rejects(service.createRoute({ name: "Rota", companyIds: [10, 20] }, actor), /inexistente ou inativa/);
    await assert.rejects(service.createRoute({ name: "Rota", companyIds: [10, 30] }, actor), /inexistente ou inativa/);
    assert.equal(repo._calls.createRoute, undefined);
  });

  test("route company scope edits use the transactional repository guard", async () => {
    const repo = makeRepo({
      getCompany: async (id: number) => ({ id, active: true }),
    });
    const service = new LogisticsService(repo);

    const result = await service.updateRoute(5, { companyIds: [10, 20], notes: "Atualizada" }, { ...tenantActor, role: "LOGISTICS", identityType: "internal" });

    assert.deepEqual(repo._calls.updateRouteCompanyScope[0], [
      5,
      10,
      { companyIds: [10, 20], notes: "Atualizada" },
      [10, 20],
    ]);
    assert.equal((result as any).empresaId, 10);
    assert.equal(repo._calls.updateRouteOwned, undefined);
  });

  test("route date and driver edits also use the transactional route guard", async () => {
    const repo = makeRepo({
      getDriversSafe: async () => [{ id: 21, empresaId: 10 }],
    });
    const service = new LogisticsService(repo);

    await service.updateRoute(5, { driverId: 21, deliveryDate: "2026-11-12" }, tenantActor);

    assert.deepEqual(repo._calls.updateRouteCompanyScope[0], [
      5,
      10,
      { driverId: 21, deliveryDate: "2026-11-12" },
      undefined,
    ]);
  });

  test("route completion uses the transactional scope guard", async () => {
    const repo = makeRepo();
    const service = new LogisticsService(repo);

    await service.updateRoute(5, { status: "COMPLETED" }, tenantActor);

    assert.deepEqual(repo._calls.updateRouteCompanyScope[0], [
      5,
      10,
      { status: "COMPLETED" },
      undefined,
    ]);
    assert.equal(repo._calls.updateRouteOwned, undefined);
  });
});
