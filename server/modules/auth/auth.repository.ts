import { storage } from "../../services/storage";
import type { Company, User, InsertUser } from "./auth.types";
import type { InsertCompany } from "@shared/schema";
import { db } from "../../database/db";
import { passwordResetTokens } from "@shared/schema";
import { eq, gt, and } from "drizzle-orm";

/**
 * AuthRepository — the only place the auth module talks to persistence.
 *
 * Architecture decision: identical to the finance and users modules. We
 * delegate to the legacy `storage` facade today (which already implements
 * bcrypt hashing inside `createUser`/`updateUser`). When storage is split
 * per-domain, this file is the seam: swap each method body for direct
 * Drizzle queries without touching the service or controller above it.
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
    return storage.getUsers();
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
