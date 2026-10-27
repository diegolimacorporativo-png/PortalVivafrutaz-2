import {
  BadRequestError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
  UnauthorizedError,
} from "../../shared/errors/AppError";
import { usersRepository, UsersRepository } from "./users.repository";
import type {
  ChangePasswordInput,
  InsertUser,
  SafeUser,
  UnlockUserInput,
  UnlockUserResult,
  User,
} from "./users.types";
import {
  currentTenantId,
  getTenantContext,
  requireTenantId,
} from "../../core/tenant/context";
import {
  GLOBAL_ADMIN_ROLES,
  TENANT_ASSIGNABLE_USER_ROLES,
} from "@shared/user-roles";

/** Roles allowed to change another user's password. Mirrors legacy gate. */
const PASSWORD_CHANGE_ROLES = [
  "MASTER",
  "ADMIN",
  "DIRECTOR",
] as const;

/** Roles allowed to unlock a locked user account. Mirrors legacy gate. */
const ACCOUNT_UNLOCK_ROLES = [
  "MASTER",
  "ADMIN",
  "DIRECTOR",
] as const;

function isGlobalAdminRole(role: string | undefined): boolean {
  return GLOBAL_ADMIN_ROLES.some((candidate) => candidate === role);
}

function currentActorRole(): string | undefined {
  const principal = getTenantContext()?.principal;
  return principal?.kind === "admin" ? principal.role : undefined;
}

function assertCanManageTarget(target: User): void {
  const actorRole = currentActorRole();
  if (isGlobalAdminRole(actorRole)) return;
  if (actorRole === "ADMIN" && ["MASTER", "DIRECTOR", "DEVELOPER"].includes(target.role)) {
    throw new ForbiddenError("Somente MASTER ou DIRECTOR podem administrar este perfil.");
  }
}

function assertCanAssignRole(role: string, currentRole?: string): void {
  const actorRole = currentActorRole();
  if (isGlobalAdminRole(actorRole)) return;
  if (actorRole !== "ADMIN") {
    throw new ForbiddenError("Perfil sem autorização para administrar usuários.");
  }
  if (role === "ADMIN" && currentRole === "ADMIN") return;
  if (!TENANT_ASSIGNABLE_USER_ROLES.some((candidate) => candidate === role)) {
    throw new ForbiddenError("Administradores da empresa só podem atribuir perfis operacionais.");
  }
}

/** Mask the bcrypt hash before sending a User over the wire. */
function toSafe(user: User): SafeUser {
  return { ...user, password: "***" };
}

function isGlobalUserManagementAdmin(): boolean {
  const principal = getTenantContext()?.principal;
  return (
    currentTenantId() == null &&
    principal?.kind === "admin" &&
    principal.empresaId == null &&
    isGlobalAdminRole(principal.role)
  );
}

/**
 * UsersService — business rules of the users module.
 *
 * Architecture decision: same shape as FinanceService. Services own behaviour:
 * they orchestrate the repository, enforce invariants, write audit logs, and
 * never touch req/res. This is what makes the module reusable from a CLI, a
 * worker, or another module — not just HTTP.
 */
export class UsersService {
  constructor(private readonly repo: UsersRepository = usersRepository) {}

  // ── List ───────────────────────────────────────────────────────────────
  async list(): Promise<SafeUser[]> {
    const users = await this.repo.list();
    return users.map(toSafe);
  }

  // ── Create ─────────────────────────────────────────────────────────────
  async create(input: InsertUser): Promise<SafeUser> {
    try {
      assertCanAssignRole(input.role);
      const createsGlobalAdmin = isGlobalAdminRole(input.role);
      if (createsGlobalAdmin && !isGlobalUserManagementAdmin()) {
        throw new ForbiddenError("Perfis MASTER e DIRECTOR só podem ser criados por um administrador global sem empresa selecionada.");
      }
      if (
        !createsGlobalAdmin &&
        currentTenantId() == null &&
        isGlobalAdminRole(currentActorRole())
      ) {
        throw new BadRequestError("Selecione uma empresa de destino antes de criar um usuário.");
      }
      const tenantId = createsGlobalAdmin ? null : requireTenantId();
      const safeInput = { ...input } as any;
      delete safeInput.permissions;
      const scopedInput = { ...safeInput, empresaId: tenantId };
      const user = await this.repo.create(scopedInput);
      return toSafe(user);
    } catch (err: any) {
      // Postgres unique violation on `users.email` (code 23505).
      if (err?.code === "23505") {
        throw new ConflictError("Email já cadastrado");
      }
      throw err;
    }
  }

  // ── Update ─────────────────────────────────────────────────────────────
  async update(id: number, input: Partial<InsertUser>): Promise<SafeUser> {
    // Preserve legacy semantics:
    //   - password === "***" means "no change" (masked placeholder echoed back
    //     by the client). Strip it so storage doesn't re-hash a literal "***".
    //   - tabPermissions === null is meaningful (reset to defaults). Keep it.
    const updates: Partial<InsertUser> = { ...input };
    delete (updates as any).permissions;
    if (updates.password === "***" || updates.password === "") {
      delete updates.password;
    }
    const globalTargeting = isGlobalUserManagementAdmin();
    if (!globalTargeting) requireTenantId();
    const target = await this.repo.getById(id);
    if (!target) throw new NotFoundError("Usuário não encontrado");
    assertCanManageTarget(target);
    if (updates.role) {
      assertCanAssignRole(updates.role, target.role);
      if (isGlobalAdminRole(updates.role) !== isGlobalAdminRole(target.role)) {
        throw new ForbiddenError("A troca entre perfil global e perfil de empresa exige um fluxo de transferência de escopo.");
      }
      const actorId = getTenantContext()?.principal.userId;
      if (isGlobalAdminRole(target.role) && actorId !== target.id && updates.role !== target.role) {
        throw new ForbiddenError("Não é permitido alterar o perfil de outro administrador global.");
      }
    }

    // Tenant-bound writes use the request tenant. A global MASTER/DIRECTOR
    // without a selected tenant pins this update to the target's stored tenant.
    const user = globalTargeting
      ? await this.repo.updateUserForTarget(id, target.empresaId ?? null, updates)
      : await this.repo.update(id, { ...updates, empresaId: requireTenantId() });
    if (!user) throw new NotFoundError("Usuário não encontrado");
    return toSafe(user);
  }

  // ── Delete ─────────────────────────────────────────────────────────────
  async delete(id: number): Promise<void> {
    const globalTargeting = isGlobalUserManagementAdmin();
    if (!globalTargeting) requireTenantId();
    const target = await this.repo.getById(id);
    if (!target) throw new NotFoundError("Usuário não encontrado");
    assertCanManageTarget(target);
    try {
      if (globalTargeting) {
        const deleted = await this.repo.deleteUserForTarget(
          id,
          target.empresaId ?? null,
        );
        if (!deleted) throw new NotFoundError("Usuário não encontrado");
      } else {
        await this.repo.delete(id);
      }
    } catch (err: any) {
      if (err instanceof NotFoundError) throw err;
      // Keep historical records intact: users referenced by operational data
      // cannot be hard-deleted, but return an actionable message to the UI.
      if (err?.code === "23503") {
        throw new ConflictError(
          "Este usuário possui registros vinculados e não pode ser excluído. Desative a conta para bloquear o acesso e preservar o histórico.",
        );
      }
      throw err;
    }
  }

  // ── Privileged password change ─────────────────────────────────────────
  /**
   * Mirrors legacy PUT /api/users/:id/password exactly:
   *   - Only MASTER/ADMIN/DIRECTOR/DEVELOPER may invoke; both unauthenticated
   *     and insufficient-role callers get 403 with the same Portuguese
   *     message and the same PASSWORD_CHANGE_BLOCKED audit log.
   *   - Successful changes write a PASSWORD_CHANGED audit log at WARN level.
   * Auth is handled here (not via requireAuth middleware) so the legacy 403
   * shape is preserved end-to-end.
   */
  async changePassword(input: ChangePasswordInput): Promise<{ ok: true }> {
    const { targetUserId, newPassword, actorUserId, ip } = input;
    const tenantId = currentTenantId();

    if (typeof newPassword !== "string" || newPassword.trim().length < 12) {
      throw new BadRequestError("A senha deve ter pelo menos 12 caracteres.");
    }

    // A global administrator may act on the explicit user ID in this request.
    // The repository then pins the mutation to that user's company as stored
    // in the database. All tenant-bound actors still require their session's
    // resolved tenant.
    if (!isGlobalUserManagementAdmin()) requireTenantId();

    const actor = actorUserId ? await this.repo.getById(actorUserId) : null;

    if (
      !actor ||
      !PASSWORD_CHANGE_ROLES.includes(actor.role as any)
    ) {
      await this.repo.log({
        action: "PASSWORD_CHANGE_BLOCKED",
        description:
          "Tentativa de alteração de senha bloqueada (sem permissão)",
        userEmail: actor?.email || "",
        userRole: actor?.role || "",
        ip,
        level: "WARN",
      });
      throw new ForbiddenError(
        "Acesso restrito. Apenas diretoria ou administração podem alterar esta senha.",
      );
    }

    const target = await this.repo.getById(targetUserId);
    if (!target) throw new NotFoundError("Usuário não encontrado");
    assertCanManageTarget(target);

    const updated = await this.repo.changePasswordForTarget(
      targetUserId,
      newPassword,
      tenantId ?? target.empresaId ?? null,
    );
    if (!updated) throw new NotFoundError("Usuário não encontrado");

    await this.repo.log({
      action: "PASSWORD_CHANGED",
      description: `Senha alterada: usuário "${target.email}" (${target.role}) por "${actor.email}" (${actor.role})`,
      userId: actor.id,
      userEmail: actor.email,
      userRole: actor.role,
      ip,
      level: "WARN",
    });

    return { ok: true };
  }

  // ── Privileged account unlock ──────────────────────────────────────────
  /**
   * Mirrors legacy POST /api/admin/users/:id/unlock exactly:
   *   - 401 (Portuguese: "Not authenticated") when no actor in session.
   *   - 403 (Portuguese: "Sem permissão para desbloquear contas.") when actor
   *     lacks MASTER/ADMIN/DEVELOPER/DIRECTOR role.
   *   - 404 (Portuguese: "Usuário não encontrado.") when target does not exist.
   *   - On success: clears `isLocked` and `loginAttempts`, writes an
   *     ACCOUNT_UNLOCKED audit log at INFO level, and returns the same
   *     localised success message as the legacy handler.
   */
  async unlockUser(input: UnlockUserInput): Promise<UnlockUserResult> {
    const { targetUserId, actorUserId, ip } = input;
    // MASTER/DIRECTOR global accounts may unlock the explicit target ID. The
    // repository pins the update to the target's company as read from storage.
    // Everyone else must have a tenant fixed by the authenticated session.
    if (!isGlobalUserManagementAdmin()) requireTenantId();

    if (actorUserId == null) {
      throw new UnauthorizedError("Not authenticated");
    }

    const actor = await this.repo.getById(actorUserId);
    if (!actor || !ACCOUNT_UNLOCK_ROLES.includes(actor.role as any)) {
      throw new ForbiddenError("Sem permissão para desbloquear contas.");
    }

    const target = await this.repo.getById(targetUserId);
    if (!target) {
      throw new NotFoundError("Usuário não encontrado.");
    }
    assertCanManageTarget(target);

    const updated = await this.repo.unlockUserForTarget(
      targetUserId,
      target.empresaId ?? null,
    );
    if (!updated) {
      throw new NotFoundError("Usuário não encontrado.");
    }

    await this.repo.log({
      action: "ACCOUNT_UNLOCKED",
      description: `Conta desbloqueada por ${actor.name} (${actor.role}): ${target.email}`,
      userId: actor.id,
      userEmail: target.email,
      userRole: actor.role,
      level: "INFO",
      ip,
    });

    return {
      message: `Conta de ${target.name} desbloqueada com sucesso.`,
    };
  }
}

export const usersService = new UsersService();
