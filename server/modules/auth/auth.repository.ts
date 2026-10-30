import { storage } from "../../services/storage";
import bcrypt from "bcryptjs";
import type { Company, User, InsertUser } from "./auth.types";
import type { InsertCompany } from "@shared/schema";
import { db } from "../../database/db";
import { authAttempts, companies as companiesTable, passwordResetTokens, users as usersTable } from "@shared/schema";
import { eq, gt, and, inArray, sql } from "drizzle-orm";
import { currentTenantId } from "../../core/tenant/context";
import { hashRecoveryToken } from "./recovery-token";

/**
 * AuthRepository — the only place the auth module talks to persistence.
 *
 * FASE MT-1: listUsers() now uses Drizzle with a SQL tenant filter instead of
 * the legacy storage.getUsers() full-table scan.
 *
 * - tenantId set   → WHERE empresaId = tenantId (scoped)
 * - tenantId null  → [] (fail-safe: no tenant context during login flow means
 *                    we cannot safely identify which tenant's admins to notify)
 *
 * All other methods delegate to the storage facade or use Drizzle directly
 * for token operations.
 */
export class AuthRepository {
  // ── Lookups ────────────────────────────────────────────────────────────
  getUserByEmail(email: string): Promise<User | undefined> {
    return storage.getUserByEmail(email);
  }

  getCompanyByEmail(email: string): Promise<Company | undefined> {
    return storage.getCompanyByEmail(email);
  }

  getUserById(id: number): Promise<User | undefined> {
    return storage.getUser(id);
  }

  getCompanyById(id: number): Promise<Company | undefined> {
    return storage.getCompany(id);
  }

  listUsers(): Promise<User[]> {
    const tenantId = currentTenantId();
    if (tenantId == null) {
      // No tenant context (e.g. pre-authentication login flow).
      // Return empty to fail safe — lockout notifications silently skip
      // rather than scanning across all tenants.
      return Promise.resolve([]);
    }
    return db
      .select()
      .from(usersTable)
      .where(eq(usersTable.empresaId, tenantId)) as unknown as Promise<User[]>;
  }

  // ── Mutations on identity ──────────────────────────────────────────────
  updateUser(id: number, updates: Partial<InsertUser>): Promise<User> {
    return storage.updateUser(id, updates);
  }

  /** Change an internal user's password and revoke all existing sessions atomically. */
  async changeUserPasswordAndRevokeSessions(
    id: number,
    updates: Partial<InsertUser>,
  ): Promise<User> {
    const values = { ...updates } as any;
    if (typeof updates.password === "string") {
      values.password = await bcrypt.hash(updates.password, 10);
    }
    values.tokenVersion = sql`coalesce(${usersTable.tokenVersion}, 0) + 1`;
    const [updated] = await db
      .update(usersTable)
      .set(values)
      .where(eq(usersTable.id, id))
      .returning();
    return updated!;
  }

  /** Upgrade a legacy plaintext hash during login without invalidating that new login. */
  async upgradeLegacyUserPassword(id: number, password: string): Promise<User> {
    const [updated] = await db
      .update(usersTable)
      .set({ password: await bcrypt.hash(password, 10) })
      .where(eq(usersTable.id, id))
      .returning();
    return updated!;
  }

  /** Upgrade a legacy customer password during login without revoking that new session. */
  async upgradeLegacyCompanyPassword(id: number, password: string): Promise<Company> {
    const [updated] = await db
      .update(companiesTable)
      .set({ password: await bcrypt.hash(password, 10) })
      .where(eq(companiesTable.id, id))
      .returning();
    return updated!;
  }

  listStrategicUsersForUnlock(roles: readonly string[]) {
    return db
      .select({
        id: usersTable.id,
        email: usersTable.email,
        role: usersTable.role,
        isLocked: usersTable.isLocked,
        loginAttempts: usersTable.loginAttempts,
        active: usersTable.active,
      })
      .from(usersTable)
      .where(inArray(usersTable.role, [...roles]));
  }

  clearAuthAttemptsForUser(userId: number): Promise<unknown> {
    return db.delete(authAttempts).where(eq(authAttempts.userId, userId));
  }

  updateCompany(id: number, updates: Partial<InsertCompany>): Promise<Company> {
    return storage.updateCompany(id, updates);
  }

  // ── Settings ───────────────────────────────────────────────────────────
  async getMaintenanceMode(): Promise<boolean> {
    const value = await storage.getSetting("maintenance_mode");
    return value === "true";
  }

  // ── Manual password reset request (admin-reviewed flow) ───────────────
  createPasswordResetRequest(companyId: number) {
    return storage.createPasswordResetRequest(companyId);
  }

  // ── Token-based password reset (self-service flow) ─────────────────────
  async createResetToken(params: {
    userId?: number;
    companyId?: number;
    token: string;
    expiresAt: Date;
  }) {
    const { token, ...account } = params;
    const [row] = await db
      .insert(passwordResetTokens)
      .values({
        ...account,
        tokenHash: hashRecoveryToken(token),
      })
      .returning();
    return row;
  }

  async consumeValidResetToken(token: string) {
    const [row] = await db
      .delete(passwordResetTokens)
      .where(
        and(
          eq(passwordResetTokens.tokenHash, hashRecoveryToken(token)),
          gt(passwordResetTokens.expiresAt, new Date()),
        ),
      )
      .returning();
    return row ?? null;
  }

  // ── Audit log ──────────────────────────────────────────────────────────
  log(entry: Parameters<typeof storage.createLog>[0]): Promise<unknown> {
    return storage.createLog(entry) as Promise<unknown>;
  }
}

export const authRepository = new AuthRepository();
