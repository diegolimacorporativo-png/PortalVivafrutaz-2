import { storage } from "../../services/storage";
import type { Company, User, InsertUser } from "./auth.types";
import type { InsertCompany } from "@shared/schema";
import { db } from "../../database/db";
import { passwordResetTokens, users as usersTable } from "@shared/schema";
import { eq, gt, and } from "drizzle-orm";
import { currentTenantId } from "../../core/tenant/context";

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
    const [row] = await db
      .insert(passwordResetTokens)
      .values(params)
      .returning();
    return row;
  }

  async getValidResetToken(token: string) {
    const [row] = await db
      .select()
      .from(passwordResetTokens)
      .where(
        and(
          eq(passwordResetTokens.token, token),
          gt(passwordResetTokens.expiresAt, new Date()),
        ),
      );
    return row ?? null;
  }

  async deleteResetToken(token: string) {
    await db
      .delete(passwordResetTokens)
      .where(eq(passwordResetTokens.token, token));
  }

  // ── Audit log ──────────────────────────────────────────────────────────
  log(entry: Parameters<typeof storage.createLog>[0]): Promise<unknown> {
    return storage.createLog(entry) as Promise<unknown>;
  }
}

export const authRepository = new AuthRepository();
