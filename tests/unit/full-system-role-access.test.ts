import assert from "node:assert/strict";
import test from "node:test";
import { FISCAL_ROLES } from "../../server/modules/orders/orders.service";
import {
  actionPermissionAllows,
  FULL_SYSTEM_ACCESS_ROLES,
  GLOBAL_USER_MANAGEMENT_ROLES,
  roleCanViewGps,
  roleActionAllows,
  tabPermissionAllows,
  USER_MANAGEMENT_ROLES,
} from "../../shared/user-roles";

test("MASTER, ADMIN, DIRECTOR e DEVELOPER mantêm acesso às operações fiscais", () => {
  for (const role of ["MASTER", "ADMIN", "DIRECTOR", "DEVELOPER"]) {
    assert.ok((FISCAL_ROLES as readonly string[]).includes(role), `${role} deve preservar acesso fiscal global`);
  }
});

test("MASTER, ADMIN, DIRECTOR e DEVELOPER preservam acesso completo a módulos e ações", () => {
  for (const role of ["MASTER", "ADMIN", "DIRECTOR", "DEVELOPER"]) {
    assert.ok((FULL_SYSTEM_ACCESS_ROLES as readonly string[]).includes(role));
    assert.equal(tabPermissionAllows(["__deny_all_tabs__"], "finance", role), true);
    assert.equal(actionPermissionAllows({ actionOverridesV1: { orders: { read: false, delete: false } } }, "orders", "delete", role), true);
  }
});

test("DEVELOPER tem acesso à tela administrativa de usuários", () => {
  assert.ok((USER_MANAGEMENT_ROLES as readonly string[]).includes("DEVELOPER"));
});

test("ADMIN também tem gerenciamento global de usuários e permissões", () => {
  assert.ok((GLOBAL_USER_MANAGEMENT_ROLES as readonly string[]).includes("ADMIN"));
  assert.ok((USER_MANAGEMENT_ROLES as readonly string[]).includes("ADMIN"));
});

test("GPS é visível a perfis internos e vedado a Vigilância e Motoristas", () => {
  for (const role of ["MASTER", "ADMIN", "DIRECTOR", "DEVELOPER", "COMERCIAL", "LOGISTICS", "FINANCEIRO", "PURCHASE_MANAGER", "OPERATIONS_MANAGER"]) {
    assert.equal(roleCanViewGps(role), true, `${role} deve ver GPS`);
  }
  for (const role of ["NUTRICIONISTA", "MOTORISTA", "DRIVER"]) {
    assert.equal(roleCanViewGps(role), false, `${role} não deve ver GPS`);
  }
});

test("matriz limita escrita cruzada sem alterar o perfil base de FINANCEIRO", () => {
  assert.equal(roleActionAllows("COMERCIAL", "logistics", "read"), true);
  assert.equal(roleActionAllows("COMERCIAL", "logistics", "edit"), false);
  assert.equal(roleActionAllows("LOGISTICS", "orders", "read"), true);
  assert.equal(roleActionAllows("LOGISTICS", "orders", "create"), false);
  assert.equal(roleActionAllows("LOGISTICS", "finance", "read"), true);
  assert.equal(roleActionAllows("LOGISTICS", "finance", "edit"), false);
  assert.equal(roleActionAllows("FINANCEIRO", "logistics", "read"), true);
  assert.equal(roleActionAllows("FINANCEIRO", "logistics", "delete"), false);
  assert.equal(roleActionAllows("FINANCEIRO", "finance", "create"), true);
  assert.equal(roleActionAllows("PURCHASE_MANAGER", "orders", "create"), undefined);
});

test("permissões de aba não podem ampliar o perfil e podem restringir GPS", () => {
  assert.equal(tabPermissionAllows(["finance"], "finance", "COMERCIAL"), false);
  assert.equal(tabPermissionAllows(["users"], "users", "LOGISTICS"), false);
  assert.equal(tabPermissionAllows(["__deny_all_tabs__"], "gps-tracking", "FINANCEIRO"), false);
  assert.equal(tabPermissionAllows(["logistics"], "gps-tracking", "FINANCEIRO"), false);
  assert.equal(tabPermissionAllows(["gps-tracking"], "gps-tracking", "NUTRICIONISTA"), false);
});
