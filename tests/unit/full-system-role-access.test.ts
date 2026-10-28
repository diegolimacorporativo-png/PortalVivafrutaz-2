import assert from "node:assert/strict";
import test from "node:test";
import {
  actionPermissionAllows,
  FULL_SYSTEM_ACCESS_ROLES,
  tabPermissionAllows,
  USER_MANAGEMENT_ROLES,
} from "../../shared/user-roles";

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
