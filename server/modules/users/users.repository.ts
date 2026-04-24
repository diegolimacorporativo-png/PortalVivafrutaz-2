import { storage } from "../../services/storage";
import type { User, InsertUser } from "./users.types";

/**
 * UsersRepository — the only place the users module talks to persistence.
 *
 * Architecture decision: identical to the finance module. We delegate to the
 * legacy `storage` facade today (which already implements bcrypt hashing in
 * createUser/updateUser). When storage is split per-domain this file is the
 * seam — swap each method for direct Drizzle queries without touching the
 * service or controller above it.
 *
 * Repository = data access only. No business rules, no HTTP, no validation.
 */
export class UsersRepository {
  list(): Promise<User[]> {
    return storage.getUsers();
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
