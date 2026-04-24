import { storage } from "../../services/storage";
import type {
  AccountReceivable,
  InsertAccountReceivable,
  AccountPayable,
  InsertAccountPayable,
  FinancialTransaction,
  InsertFinancialTransaction,
  AccountsReceivableFilter,
  AccountsPayableFilter,
  CashflowFilter,
  FinancialDashboard,
} from "./finance.types";

/**
 * FinanceRepository — the only place the finance module talks to persistence.
 *
 * Architecture decision: today we delegate to the legacy `storage` facade
 * because it already implements the Drizzle queries and is heavily used by
 * the rest of the codebase. Tomorrow, when we split storage by domain, this
 * file is the seam: we swap the body of each method for direct Drizzle
 * queries (e.g. `db.select().from(accountsReceivable)`) without touching
 * the service or controller above it.
 *
 * Repository = data access only. No business rules here.
 */
export class FinanceRepository {
  // ── Accounts Receivable ────────────────────────────────────────────────
  listAccountsReceivable(filter: AccountsReceivableFilter): Promise<AccountReceivable[]> {
    return storage.getAccountsReceivable(filter);
  }

  getAccountReceivable(id: number): Promise<AccountReceivable | undefined> {
    return storage.getAccountReceivable(id);
  }

  createAccountReceivable(data: InsertAccountReceivable): Promise<AccountReceivable> {
    return storage.createAccountReceivable(data);
  }

  updateAccountReceivable(
    id: number,
    data: Partial<InsertAccountReceivable>,
  ): Promise<AccountReceivable> {
    return storage.updateAccountReceivable(id, data);
  }

  payAccountReceivable(id: number): Promise<AccountReceivable> {
    return storage.payAccountReceivable(id);
  }

  deleteAccountReceivable(id: number): Promise<void> {
    return storage.deleteAccountReceivable(id);
  }

  // ── Accounts Payable ───────────────────────────────────────────────────
  listAccountsPayable(filter: AccountsPayableFilter): Promise<AccountPayable[]> {
    return storage.getAccountsPayable(filter);
  }

  createAccountPayable(data: InsertAccountPayable): Promise<AccountPayable> {
    return storage.createAccountPayable(data);
  }

  updateAccountPayable(
    id: number,
    data: Partial<InsertAccountPayable>,
  ): Promise<AccountPayable> {
    return storage.updateAccountPayable(id, data);
  }

  payAccountPayable(id: number): Promise<AccountPayable> {
    return storage.payAccountPayable(id);
  }

  deleteAccountPayable(id: number): Promise<void> {
    return storage.deleteAccountPayable(id);
  }

  // ── Cashflow ───────────────────────────────────────────────────────────
  listFinancialTransactions(filter: CashflowFilter): Promise<FinancialTransaction[]> {
    return storage.getFinancialTransactions(filter);
  }

  createFinancialTransaction(
    data: InsertFinancialTransaction,
  ): Promise<FinancialTransaction> {
    return storage.createFinancialTransaction(data);
  }

  // ── Dashboard ──────────────────────────────────────────────────────────
  async getDashboard(): Promise<FinancialDashboard> {
    return (await storage.getFinancialDashboard()) as unknown as FinancialDashboard;
  }

  // ── Logging (cross-cutting) ────────────────────────────────────────────
  /**
   * Audit-log a finance action. Kept inside the repository because logs are
   * a persistence concern; the service stays free of storage knowledge.
   */
  log(params: {
    action: string;
    description: string;
    userId?: number;
    level?: string;
  }): Promise<void> {
    return storage.createLog({
      action: params.action,
      description: params.description,
      userId: params.userId,
      level: params.level ?? "INFO",
    });
  }

  // Used by the service to embed payer/issuer info into the PIX payload.
  getCompanyConfig() {
    return storage.getCompanyConfig();
  }
}

export const financeRepository = new FinanceRepository();
