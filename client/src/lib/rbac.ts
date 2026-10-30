import { actionPermissionAllows, type ActionPermissionAction, type ActionPermissionModule } from "@shared/user-roles";

export function canPerformAction(
  user: { role?: string | null; permissions?: unknown } | null | undefined,
  module: ActionPermissionModule,
  action: ActionPermissionAction,
): boolean {
  return actionPermissionAllows(user?.permissions, module, action, user?.role);
}
