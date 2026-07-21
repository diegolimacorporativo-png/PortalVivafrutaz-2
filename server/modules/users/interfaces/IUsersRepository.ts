/**
 * IUsersRepository — contrato do repositório de usuários.
 *
 * As 7 assinaturas canônicas correspondem 1:1 às assinaturas em IStorage
 * para o domínio Users. DatabaseStorage delega para esta interface;
 * futuros mocks e testes de unidade podem usar qualquer implementação.
 *
 * Wave 1A — Users Repository extraction.
 */
import type { User, InsertUser } from "../users.types";

/** Entrada de log de auditoria. Espelha o contrato de storage.createLog. */
export type LogEntry = {
  action: string;
  description: string;
  userId?: number;
  companyId?: number;
  userEmail?: string;
  userRole?: string;
  ip?: string;
  level?: string;
};

export interface IUsersRepository {
  // ── 7 métodos canônicos do domínio Users ─────────────────────────────────
  getUserByEmail(email: string): Promise<User | undefined>;
  getUser(id: number): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
  updateUser(id: number, updates: Partial<InsertUser>): Promise<User>;
  getUsers(limit?: number): Promise<User[]>;
  getUsersSafe(empresaId: number): Promise<User[]>;
  deleteUser(id: number): Promise<void>;

  // ── Auditoria ─────────────────────────────────────────────────────────────
  // Implementado com Drizzle direto para evitar dependência circular em
  // storage.ts. Será movido para SettingsRepository na Wave correspondente.
  log(entry: LogEntry): Promise<void>;
}
