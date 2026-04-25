import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
} from "../../shared/errors/AppError";
import { usersRepository, UsersRepository } from "./users.repository";
import type {
  ChangePasswordInput,
  InsertUser,
  SafeUser,
  User,
} from "./users.types";

/** Roles allowed to change another user's password. Mirrors legacy gate. */
const PASSWORD_CHANGE_ROLES = [
  "MASTER",
  "ADMIN",
  "DIRECTOR",
  "DEVELOPER",
] as const;

/** Mask the bcrypt hash before sending a User over the wire. */
function toSafe(user: User): SafeUser {
  return { ...user, password: "***" };
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
      const user = await this.repo.create(input);
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
    if (updates.password === "***" || updates.password === "") {
      delete updates.password;
    }

    const user = await this.repo.update(id, updates);
    if (!user) throw new NotFoundError("Usuário não encontrado");
    return toSafe(user);
  }

  // ── Delete ─────────────────────────────────────────────────────────────
  async delete(id: number): Promise<void> {
    await this.repo.delete(id);
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

    await this.repo.update(targetUserId, { password: newPassword });
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
}

export const usersService = new UsersService();
