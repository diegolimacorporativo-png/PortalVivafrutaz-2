import { storage } from "../../services/storage";
import type { User, InsertUser } from "./users.types";
import { db } from "../../database/db";
import { users as usersTable } from "@shared/schema";
import { eq } from "drizzle-orm";
import { currentTenantId } from "../../core/tenant/context";

/**
 * UsersRepository — the only place the users module talks to persistence.
 *
 * FASE MT-1: list() now uses Drizzle with a SQL tenant filter instead of the
 * legacy storage.getUsers() full-table scan. No in-memory filter for isolation.
 *
 * - tenantId set   → WHERE empresaId = tenantId  (scoped, fast)
 * - tenantId null  → no WHERE (MASTER cross-tenant admin, explicit by design)
 *
 * Every other method delegates to the storage facade which handles bcrypt
 * hashing. When storage is split per-domain, swap each method for a direct
 * Drizzle call here without touching the service or controller above it.
 */
export class UsersRepository {
  list(): Promise<User[]> {
    const tenantId = currentTenantId();
    if (tenantId != null) {
      return db
        .select()
        .from(usersTable)
        .where(eq(usersTable.empresaId, tenantId)) as unknown as Promise<User[]>;
    }
    // Cross-tenant: MASTER admin without a scoped target.
    // Intentional — tracked here so a grep for this comment surfaces every
    // cross-tenant user read. Not using storage.getUsers() (banned call).
    return db.select().from(usersTable) as unknown as Promise<User[]>;
  }

  getById(id: number): Promise<User | undefined> {
    return storage.getUser(id);
  }

  create(data: InsertUser): Promise<User> {
    // storage.createUser already hashes the password with bcrypt.
    return storage.createUser(data);
  }

  update(id: number, updates: Partial<InsertUser>): Promise<User> {
    // storage.updateUser hashes `password` if present; safe to pass through.
    return storage.updateUser(id, updates);
  }

  delete(id: number): Promise<void> {
    return storage.deleteUser(id);
  }

  /** Audit-log a user-related action. Kept here because logs are persistence. */
  log(entry: Parameters<typeof storage.createLog>[0]): Promise<unknown> {
    return storage.createLog(entry) as Promise<unknown>;
  }
}

export const usersRepository = new UsersRepository();
