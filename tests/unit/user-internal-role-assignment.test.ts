import assert from "node:assert/strict";
import { test } from "node:test";
import {
  canAssignInternalUserRole,
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

test("an internal profile without user-management authority cannot assign profiles", () => {
  for (const managerRole of USER_ROLE_VALUES.filter(
    (role) => !(GLOBAL_USER_MANAGEMENT_ROLES as readonly string[]).includes(role),
  )) {
    assert.equal(canAssignInternalUserRole(managerRole, "COMERCIAL"), false, managerRole);
  }
});

test("unknown role values are never offered", () => {
  assert.equal(canAssignInternalUserRole("DIRECTOR", "UNKNOWN_ROLE"), false);
});
