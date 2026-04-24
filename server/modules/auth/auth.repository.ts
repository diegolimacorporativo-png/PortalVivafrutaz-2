import { storage } from "../../services/storage";
import type { Company, User, InsertUser } from "./auth.types";
import type { InsertCompany } from "@shared/schema";

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

  // ── Password reset ─────────────────────────────────────────────────────
  createPasswordResetRequest(companyId: number) {
    return storage.createPasswordResetRequest(companyId);
  }

  // ── Audit log ──────────────────────────────────────────────────────────
  log(entry: Parameters<typeof storage.createLog>[0]): Promise<unknown> {
    return storage.createLog(entry) as Promise<unknown>;
  }
}

export const authRepository = new AuthRepository();
