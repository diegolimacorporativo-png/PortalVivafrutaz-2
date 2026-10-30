/**
 * UsersRepository — única camada de persistência do domínio Users.
 *
 * Wave 1A: toda a lógica que estava em DatabaseStorage foi movida para cá.
 * DatabaseStorage agora apenas delega para esta classe.
 *
 * Regras de design:
 *  - Sem import de `storage` (evita dependência circular).
 *  - Toda query usa Drizzle diretamente via `db`.
 *  - bcrypt e invalidateUsageCache são responsabilidade desta camada.
 *  - Métodos de conveniência (list, getById, create, update, delete) são
 *    aliases mantidos para compatibilidade com UsersService e UsersController
 *    sem nenhuma mudança de comportamento.
 */
import bcrypt from "bcryptjs";
import { db } from "../../database/db";
import { users as usersTable, systemLogs, logisticsDrivers } from "@shared/schema";
import type { User, InsertUser } from "./users.types";
import type { IUsersRepository, LogEntry } from "./interfaces/IUsersRepository";
import { and, eq, isNull, sql } from "drizzle-orm";
import { currentTenantId, getTenantContext, requireTenantId } from "../../core/tenant/context";
import { invalidateUsageCache } from "../billing/usage-cache";
import { GLOBAL_USER_MANAGEMENT_ROLES } from "@shared/user-roles";
import { userUpdateRequiresSessionRevocation } from "./users.session-policy";

function addSessionVersionInvalidation(
  target: Record<string, unknown>,
  updates: Partial<InsertUser>,
): void {
  if (userUpdateRequiresSessionRevocation(updates)) {
    target.tokenVersion = sql`coalesce(${usersTable.tokenVersion}, 0) + 1`;
  }
}

export class UsersRepository implements IUsersRepository {
  private scopedIdWhere(id: number) {
    const tenantId = currentTenantId();
    return tenantId == null
      ? eq(usersTable.id, id)
      : and(eq(usersTable.id, id), eq(usersTable.empresaId, tenantId));
  }

  // ── 7 métodos canônicos (IStorage contract) ───────────────────────────────

  async getUserByEmail(email: string): Promise<User | undefined> {
    const [user] = await db
      .select()
      .from(usersTable)
      .where(sql`lower(${usersTable.email}) = ${email.toLowerCase()}`);
    return user;
  }

  async getUser(id: number): Promise<User | undefined> {
    const [user] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.id, id));
    return user;
  }

  async createUser(user: InsertUser): Promise<User> {
    const hashedPassword = user.password
      ? await bcrypt.hash(user.password, 10)
      : undefined;
    const toInsert = { ...user, password: hashedPassword ?? user.password };
    const [newUser] = await db
      .insert(usersTable)
      .values(toInsert)
      .returning();
    if (newUser?.empresaId) invalidateUsageCache(newUser.empresaId);
    return newUser!;
  }

  async updateUser(id: number, updates: Partial<InsertUser>): Promise<User> {
    const toUpdate = { ...updates } as any;
    addSessionVersionInvalidation(toUpdate, updates);
    if (updates.password) {
      toUpdate.password = await bcrypt.hash(updates.password, 10);
    }
    const tenantId = currentTenantId();
    if (tenantId != null) {
      toUpdate.empresaId = tenantId;
    }
    const [updated] = await db
      .update(usersTable)
      .set(toUpdate)
      .where(this.scopedIdWhere(id))
      .returning();
    if (updated?.empresaId) invalidateUsageCache(updated.empresaId);
    return updated!;
  }

  /** Update one global-admin target only while it remains in its trusted tenant. */
  async updateUserForTarget(
    id: number,
    expectedEmpresaId: number | null,
    updates: Partial<InsertUser>,
  ): Promise<User | undefined> {
    const toUpdate = { ...updates } as any;
    addSessionVersionInvalidation(toUpdate, updates);
    delete toUpdate.empresaId;
    if (updates.password) {
      toUpdate.password = await bcrypt.hash(updates.password, 10);
    }
    const scope =
      expectedEmpresaId == null
        ? isNull(usersTable.empresaId)
        : eq(usersTable.empresaId, expectedEmpresaId);
    const [updated] = await db
      .update(usersTable)
      .set(toUpdate)
      .where(and(eq(usersTable.id, id), scope))
      .returning();
    if (updated?.empresaId) invalidateUsageCache(updated.empresaId);
    return updated;
  }

  /**
   * Change one user's password while pinning the update to the target's
   * server-resolved company. Global MASTER/DIRECTOR actions have no tenant in
   * AsyncLocalStorage, so the service supplies the company read from that
   * exact target row rather than trusting a client-provided tenant selector.
   */
  async changePasswordForTarget(
    id: number,
    password: string,
    expectedEmpresaId: number | null,
  ): Promise<User | undefined> {
    const hashedPassword = await bcrypt.hash(password, 10);
    const scope =
      expectedEmpresaId == null
        ? isNull(usersTable.empresaId)
        : eq(usersTable.empresaId, expectedEmpresaId);
    const [updated] = await db
      .update(usersTable)
      .set({
        password: hashedPassword,
        tokenVersion: sql`coalesce(${usersTable.tokenVersion}, 0) + 1`,
      } as any)
      .where(and(eq(usersTable.id, id), scope))
      .returning();
    return updated;
  }

  /**
   * Clear a user's lock while pinning the write to the target's server-resolved
   * company. This supports global MASTER/DIRECTOR actions without trusting a
   * client-supplied tenant selector or leaving the update unscoped.
   */
  async unlockUserForTarget(
    id: number,
    expectedEmpresaId: number | null,
  ): Promise<User | undefined> {
    const scope =
      expectedEmpresaId == null
        ? isNull(usersTable.empresaId)
        : eq(usersTable.empresaId, expectedEmpresaId);
    const [updated] = await db
      .update(usersTable)
      .set({
        isLocked: false,
        loginAttempts: 0,
        tokenVersion: sql`coalesce(${usersTable.tokenVersion}, 0) + 1`,
      } as any)
      .where(and(eq(usersTable.id, id), scope))
      .returning();
    return updated;
  }

  async getUsers(limit = 1000): Promise<User[]> {
    // PERF-FIX: bounded LIMIT (default 1000) prevents OOM. All existing callers
    // that omit `limit` get the safe default without any signature change.
    return db.select().from(usersTable).orderBy(usersTable.id).limit(limit);
  }

  // FASE MT-1 — Safe variant: empresaId obrigatório, filtro no SQL, sem fallback global.
  async getUsersSafe(empresaId: number): Promise<User[]> {
    return db
      .select()
      .from(usersTable)
      .where(eq(usersTable.empresaId, empresaId))
      .orderBy(usersTable.id);
  }

  async deleteUser(id: number): Promise<void> {
    const scope = this.scopedIdWhere(id);
    const deleted = await this.deleteUserAndDeactivateDriver(id, scope);
    if (deleted?.empresaId) invalidateUsageCache(deleted.empresaId);
  }

  /**
   * Remove the login and deactivate its matching operational driver record in
   * one transaction. Route/GPS history keeps its foreign keys, while inactive
   * drivers stop being eligible for live tracking and route assignment.
   */
  private async deleteUserAndDeactivateDriver(id: number, scope: any) {
    return db.transaction(async (tx) => {
      const [target] = await tx
        .select({ role: usersTable.role, email: usersTable.email, empresaId: usersTable.empresaId })
        .from(usersTable)
        .where(scope)
        .limit(1);
      if (!target) return undefined;

      if ((target.role === "MOTORISTA" || target.role === "DRIVER") && target.email) {
        const companyScope = target.empresaId == null
          ? isNull(logisticsDrivers.empresaId)
          : eq(logisticsDrivers.empresaId, target.empresaId);
        await tx
          .update(logisticsDrivers)
          .set({ active: false })
          .where(and(
            sql`lower(trim(${logisticsDrivers.email})) = ${target.email.trim().toLowerCase()}`,
            companyScope,
          ));
      }

      const [deleted] = await tx
        .delete(usersTable)
        .where(scope)
        .returning({ id: usersTable.id, empresaId: usersTable.empresaId });
      return deleted;
    });
  }

  /** Delete one explicitly selected target for a global MASTER/DIRECTOR.
   * The expected company comes from the target row read by the service, never
   * from request data, so a tenant move between read and delete fails closed.
   */
  async deleteUserForTarget(
    id: number,
    expectedEmpresaId: number | null,
  ): Promise<boolean> {
    const scope =
      expectedEmpresaId == null
        ? isNull(usersTable.empresaId)
        : eq(usersTable.empresaId, expectedEmpresaId);
    const deleted = await this.deleteUserAndDeactivateDriver(id, and(eq(usersTable.id, id), scope));
    if (deleted?.empresaId) invalidateUsageCache(deleted.empresaId);
    return Boolean(deleted);
  }

  // ── Auditoria ─────────────────────────────────────────────────────────────
  // Implementado diretamente com Drizzle para não importar storage (circular dep).
  // Comportamento idêntico a DatabaseStorage.createLog.
  async log(entry: LogEntry): Promise<void> {
    try {
      await db
        .insert(systemLogs)
        .values({ ...entry, level: entry.level ?? "INFO" });
    } catch (err: any) {
      console.error("[UsersRepository] Failed to write system log:", err);
    }
  }

  // ── Aliases de conveniência (backward compat com UsersService) ────────────
  // Estes métodos não são parte da IUsersRepository; existem para que
  // UsersService continue funcionando sem alteração de comportamento.

  /**
   * Tenant-scoped list.
   *   - tenantId definido → WHERE empresaId = tenantId (escopo, eficiente)
   *   - tenantId null     → sem WHERE (usuários globais autorizados, explicitamente)
   */
  list(): Promise<User[]> {
    const tenantId = currentTenantId();
    if (tenantId != null) {
      return db
        .select()
        .from(usersTable)
        .where(eq(usersTable.empresaId, tenantId)) as unknown as Promise<User[]>;
    }
    const principal = getTenantContext()?.principal;
    if (
      principal?.kind !== "admin" ||
      !GLOBAL_USER_MANAGEMENT_ROLES.some((role) => role === principal.role)
    ) {
      // No context is an authentication bug; a non-global role without a
      // target is an authorization failure. Neither may become a global list.
      requireTenantId();
    }
    // Explicit cross-tenant read: a globally scoped, authorized user manager.
    return db.select().from(usersTable) as unknown as Promise<User[]>;
  }

  getById(id: number): Promise<User | undefined> {
    const principal = getTenantContext()?.principal;
    if (currentTenantId() == null && (
      principal?.kind !== "admin" ||
      !GLOBAL_USER_MANAGEMENT_ROLES.some((role) => role === principal.role)
    )) {
      requireTenantId();
    }
    return db
      .select()
      .from(usersTable)
      .where(this.scopedIdWhere(id))
      .limit(1)
      .then((rows) => rows[0]);
  }

  create(data: InsertUser): Promise<User> {
    return this.createUser(data);
  }

  update(id: number, updates: Partial<InsertUser>): Promise<User> {
    return this.updateUser(id, updates);
  }

  delete(id: number): Promise<void> {
    return this.deleteUser(id);
  }
}

export const usersRepository = new UsersRepository();
