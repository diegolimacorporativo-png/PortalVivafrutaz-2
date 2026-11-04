import assert from "node:assert/strict";
import { test } from "node:test";
import {
  canAssignInternalUserRole,
  canSelectInternalUserRole,
  GLOBAL_USER_MANAGEMENT_ROLES,
  USER_ROLE_VALUES,
} from "../../shared/user-roles";

test("a authorized user manager sees every supported internal profile regardless of company context", () => {
  for (const managerRole of GLOBAL_USER_MANAGEMENT_ROLES) {
    for (const candidateRole of USER_ROLE_VALUES) {
      assert.equal(
        canAssignInternalUserRole(managerRole, candidateRole),
        true,
        `${managerRole} deve poder selecionar ${candidateRole}`,
      );
    }
  }
});

test("the new-user selector enables every existing profile for authorized user managers", () => {
  for (const managerRole of GLOBAL_USER_MANAGEMENT_ROLES) {
    for (const candidateRole of USER_ROLE_VALUES) {
      assert.equal(
        canSelectInternalUserRole(managerRole, candidateRole),
        true,
        `${managerRole} deve poder selecionar ${candidateRole} ao criar usuário`,
      );
    }
  }
});

test("an internal profile without user-management authority cannot assign profiles", () => {
  for (const managerRole of USER_ROLE_VALUES.filter(
    (role) => !(GLOBAL_USER_MANAGEMENT_ROLES as readonly string[]).includes(role),
  )) {
    assert.equal(canAssignInternalUserRole(managerRole, "COMERCIAL"), false, managerRole);
  }
});

test("unknown role values are never offered", () => {
  assert.equal(canAssignInternalUserRole("DIRECTOR", "UNKNOWN_ROLE"), false);
  assert.equal(canSelectInternalUserRole("DIRECTOR", "UNKNOWN_ROLE"), false);
});

test("editing another global account cannot change its global profile", () => {
  const target = { id: 22, role: "DIRECTOR", empresaId: null };
  assert.equal(canSelectInternalUserRole("MASTER", "DIRECTOR", target, 11), true);
  assert.equal(canSelectInternalUserRole("MASTER", "MASTER", target, 11), false);
  assert.equal(canSelectInternalUserRole("MASTER", "COMERCIAL", target, 11), false);
});

test("editing own global account only offers global profiles", () => {
  const target = { id: 11, role: "DIRECTOR", empresaId: null };
  assert.equal(canSelectInternalUserRole("DIRECTOR", "MASTER", target, 11), true);
  assert.equal(canSelectInternalUserRole("DIRECTOR", "COMERCIAL", target, 11), false);
});

test("editing a tenant-bound user does not allow promotion to a global profile", () => {
  const target = { id: 22, role: "COMERCIAL", empresaId: 7 };
  assert.equal(canSelectInternalUserRole("DIRECTOR", "LOGISTICS", target, 11), true);
  assert.equal(canSelectInternalUserRole("DIRECTOR", "MASTER", target, 11), false);
});
