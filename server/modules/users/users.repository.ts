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
import { users as usersTable, systemLogs } from "@shared/schema";
import type { User, InsertUser } from "./users.types";
import type { IUsersRepository, LogEntry } from "./interfaces/IUsersRepository";
import { eq, sql } from "drizzle-orm";
import { currentTenantId } from "../../core/tenant/context";
import { invalidateUsageCache } from "../billing/usage-cache";

export class UsersRepository implements IUsersRepository {
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
    if (updates.password) {
      toUpdate.password = await bcrypt.hash(updates.password, 10);
    }
    const [updated] = await db
      .update(usersTable)
      .set(toUpdate)
      .where(eq(usersTable.id, id))
      .returning();
    if (updated?.empresaId) invalidateUsageCache(updated.empresaId);
    return updated!;
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
    const [deleted] = await db
      .delete(usersTable)
      .where(eq(usersTable.id, id))
      .returning();
    if (deleted?.empresaId) invalidateUsageCache(deleted.empresaId);
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
   *   - tenantId null     → sem WHERE (MASTER cross-tenant, explícito por design)
   */
  list(): Promise<User[]> {
    const tenantId = currentTenantId();
    if (tenantId != null) {
      return db
        .select()
        .from(usersTable)
        .where(eq(usersTable.empresaId, tenantId)) as unknown as Promise<User[]>;
    }
    // Cross-tenant: MASTER admin sem tenant alvo.
    // Intencional — grep neste comentário localiza todos os cross-tenant reads.
    return db.select().from(usersTable) as unknown as Promise<User[]>;
  }

  getById(id: number): Promise<User | undefined> {
    return this.getUser(id);
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
