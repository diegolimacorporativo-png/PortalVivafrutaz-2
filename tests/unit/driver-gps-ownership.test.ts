import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { requireAuth } from "../../server/core/http/requireAuth";
import {
  canAccessDriverRecord,
  isGlobalLogisticsActor,
  resolveDriverGpsSubmissionId,
} from "../../server/modules/logistics/driver.access";

const driverA = { id: 101, empresaId: 10 };
const driverB = { id: 202, empresaId: 20 };
const adminA = { role: "ADMIN", empresaId: 10 };
const developerA = { role: "DEVELOPER", empresaId: 10 };
const masterGlobal = { role: "MASTER", empresaId: null };
const directorGlobal = { role: "DIRECTOR", empresaId: null };

function fakeGpsWrite(
  actor: { role: string; empresaId: number | null },
  requestedDriverId: number,
  rows: Array<{ id: number; empresaId: number | null }>,
) {
  const target = rows.find((row) => row.id === requestedDriverId);
  return target && canAccessDriverRecord(actor, target) ? target.id : null;
}

describe("GPS de motoristas — ownership multi-tenant", () => {
  test("usuário interno A pode operar o motorista A", () => {
    assert.equal(fakeGpsWrite(adminA, driverA.id, [driverA, driverB]), driverA.id);
  });

  test("usuário interno A não envia posição para motorista B", () => {
    assert.equal(fakeGpsWrite(adminA, driverB.id, [driverA, driverB]), null);
  });

  test("ADMIN tenant-bound A não acessa GPS de B", () => {
    assert.equal(canAccessDriverRecord(adminA, driverB), false);
  });

  test("DEVELOPER tenant-bound A não acessa GPS de B", () => {
    assert.equal(canAccessDriverRecord(developerA, driverB), false);
  });

  test("driverId enviado pelo cliente não troca o tenant autorizado", () => {
    const spoofedPayload = { driverId: driverB.id, latitude: -23.5, longitude: -46.6 };
    assert.equal(fakeGpsWrite(adminA, spoofedPayload.driverId, [driverA, driverB]), null);
    assert.equal(canAccessDriverRecord(adminA, driverA), true);
  });

  test("motorista A envia a própria posição mesmo sem driverId no payload", () => {
    assert.equal(resolveDriverGpsSubmissionId(null, driverA.id), driverA.id);
    assert.equal(resolveDriverGpsSubmissionId(driverA.id, driverA.id), driverA.id);
  });

  test("motorista A não consegue substituir o próprio ID pelo de B", () => {
    assert.equal(resolveDriverGpsSubmissionId(driverB.id, driverA.id), null);
  });

  test("MASTER global preserva acesso aos motoristas", () => {
    assert.equal(isGlobalLogisticsActor(masterGlobal), true);
    assert.equal(canAccessDriverRecord(masterGlobal, driverB), true);
  });

  test("DIRECTOR global preserva acesso aos motoristas", () => {
    assert.equal(isGlobalLogisticsActor(directorGlobal), true);
    assert.equal(canAccessDriverRecord(directorGlobal, driverB), true);
  });

  test("motoristas não recebem acesso interno arbitrário por driverId", () => {
    assert.equal(canAccessDriverRecord({ role: "DRIVER", empresaId: 10 }, driverA), false);
    assert.equal(canAccessDriverRecord({ role: "MOTORISTA", empresaId: 10 }, driverB), false);
  });

  test("sem sessão a proteção de autenticação retorna 401", () => {
    let received: any;
    requireAuth(
      { session: {} } as any,
      {} as any,
      (error?: unknown) => { received = error; },
    );
    assert.equal(received?.status, 401);
  });
});