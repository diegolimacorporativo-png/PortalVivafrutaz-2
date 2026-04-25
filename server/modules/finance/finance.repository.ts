import { and, desc, eq, gte, lte, sql } from "drizzle-orm";
import { db } from "../../database/db";
import {
  accountsReceivable,
  accountsPayable,
  financialTransactions,
  systemLogs,
} from "@shared/schema";
import {
  tenantWhere,
  tenantAnd,
  withTenant,
  stripTenantFields,
} from "../../core/tenant/scope";
import { requireTenantId } from "../../core/tenant/context";
import { storage } from "../../services/storage";
import { NotFoundError } from "../../shared/errors/AppError";
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
 * FinanceRepository — multi-tenant data access.
 *
 * Architecture decision: this repository OWNS its Drizzle queries (no longer
 * delegates to the legacy storage facade). That ownership is what lets us
 * enforce tenant scoping at the repository boundary: every read uses
 * `tenantWhere(table)`, every write uses `withTenant(payload)`. Both helpers
 * pull the empresaId from AsyncLocalStorage — there is no parameter the caller
 * could forget to pass.
 *
 * If a request reaches one of these methods with no tenant context installed,
 * `requireTenantId()` throws a 403 before any SQL is sent. That is the safety
 * net the user asked for: cross-tenant access is impossible by construction,
 * not by code review.
 */
export class FinanceRepository {
  // ── Accounts Receivable ────────────────────────────────────────────────
  async listAccountsReceivable(
    filter: AccountsReceivableFilter,
  ): Promise<AccountReceivable[]> {
    const conds = [];
    if (filter.status && filter.status !== "todos") {
      conds.push(eq(accountsReceivable.status, filter.status));
    }
    if (filter.companyId) {
      conds.push(eq(accountsReceivable.companyId, filter.companyId));
    }
    return db
      .select()
      .from(accountsReceivable)
      .where(tenantAnd(accountsReceivable, ...conds))
      .orderBy(desc(accountsReceivable.dataVencimento));
  }

  async getAccountReceivable(id: number): Promise<AccountReceivable | undefined> {
    const [row] = await db
      .select()
      .from(accountsReceivable)
      .where(
        and(eq(accountsReceivable.id, id), tenantWhere(accountsReceivable)),
      );
    return row;
  }

  async createAccountReceivable(
    data: InsertAccountReceivable,
  ): Promise<AccountReceivable> {
    const [row] = await db
      .insert(accountsReceivable)
      .values(withTenant(data))
      .returning();
    if (!row) {
      // INSERT … RETURNING with no row back is effectively impossible — the
      // DB would have raised already. Defensive guard to satisfy the type.
      throw new NotFoundError("Falha ao criar conta a receber.");
    }
    return row;
  }

  async updateAccountReceivable(
    id: number,
    data: Partial<InsertAccountReceivable>,
  ): Promise<AccountReceivable> {
    // Strip any tenant field from the patch so a malicious payload can't
    // reassign tenancy. Tenant migration is a separate, privileged operation.
    const safe = stripTenantFields(data as Record<string, unknown>);
    const [row] = await db
      .update(accountsReceivable)
      .set(safe)
      .where(
        and(eq(accountsReceivable.id, id), tenantWhere(accountsReceivable)),
      )
      .returning();
    if (!row) {
      throw new NotFoundError(
        `Conta a receber #${id} não encontrada no tenant atual.`,
      );
    }
    return row;
  }

  async payAccountReceivable(id: number): Promise<AccountReceivable> {
    return db.transaction(async (tx) => {
      const [row] = await tx
        .update(accountsReceivable)
        .set({ status: "pago", pagoEm: new Date() })
        .where(
          and(eq(accountsReceivable.id, id), tenantWhere(accountsReceivable)),
        )
        .returning();
      if (!row) {
        throw new NotFoundError(
          `Conta a receber #${id} não encontrada no tenant atual.`,
        );
      }
      const today = new Date().toISOString().substring(0, 10);
      await tx.insert(financialTransactions).values(
        withTenant({
          tipo: "entrada",
          valor: row.valor,
          descricao: `Recebimento: ${row.descricao}`,
          data: today,
          referenciaTipo: "receivable",
          referenciaId: id,
        }),
      );
      return row;
    });
  }

  async deleteAccountReceivable(id: number): Promise<void> {
    await db
      .update(accountsReceivable)
      .set({ status: "cancelado" })
      .where(
        and(eq(accountsReceivable.id, id), tenantWhere(accountsReceivable)),
      );
  }

  // ── Accounts Payable ───────────────────────────────────────────────────
  async listAccountsPayable(
    filter: AccountsPayableFilter,
  ): Promise<AccountPayable[]> {
    const conds = [];
    if (filter.status && filter.status !== "todos") {
      conds.push(eq(accountsPayable.status, filter.status));
    }
    return db
      .select()
      .from(accountsPayable)
      .where(tenantAnd(accountsPayable, ...conds))
      .orderBy(desc(accountsPayable.dataVencimento));
  }

  async createAccountPayable(
    data: InsertAccountPayable,
  ): Promise<AccountPayable> {
    const [row] = await db
      .insert(accountsPayable)
      .values(withTenant(data))
      .returning();
    if (!row) {
      throw new NotFoundError("Falha ao criar conta a pagar.");
    }
    return row;
  }

  async updateAccountPayable(
    id: number,
    data: Partial<InsertAccountPayable>,
  ): Promise<AccountPayable> {
    const safe = stripTenantFields(data as Record<string, unknown>);
    const [row] = await db
      .update(accountsPayable)
      .set(safe)
      .where(and(eq(accountsPayable.id, id), tenantWhere(accountsPayable)))
      .returning();
    if (!row) {
      throw new NotFoundError(
        `Conta a pagar #${id} não encontrada no tenant atual.`,
      );
    }
    return row;
  }

  async payAccountPayable(id: number): Promise<AccountPayable> {
    return db.transaction(async (tx) => {
      const [row] = await tx
        .update(accountsPayable)
        .set({ status: "pago", pagoEm: new Date() })
        .where(and(eq(accountsPayable.id, id), tenantWhere(accountsPayable)))
        .returning();
      if (!row) {
        throw new NotFoundError(
          `Conta a pagar #${id} não encontrada no tenant atual.`,
        );
      }
      const today = new Date().toISOString().substring(0, 10);
      await tx.insert(financialTransactions).values(
        withTenant({
          tipo: "saida",
          valor: row.valor,
          descricao: `Pagamento: ${row.descricao} (${row.fornecedor})`,
          data: today,
          referenciaTipo: "payable",
          referenciaId: id,
        }),
      );
      return row;
    });
  }

  async deleteAccountPayable(id: number): Promise<void> {
    await db
      .update(accountsPayable)
      .set({ status: "cancelado" })
      .where(and(eq(accountsPayable.id, id), tenantWhere(accountsPayable)));
  }

  // ── Cashflow ───────────────────────────────────────────────────────────
  listFinancialTransactions(
    filter: CashflowFilter,
  ): Promise<FinancialTransaction[]> {
    const conds = [];
    if (filter.from) conds.push(gte(financialTransactions.data, filter.from));
    if (filter.to) conds.push(lte(financialTransactions.data, filter.to));
    return db
      .select()
      .from(financialTransactions)
      .where(tenantAnd(financialTransactions, ...conds))
      .orderBy(desc(financialTransactions.data));
  }

  async createFinancialTransaction(
    data: InsertFinancialTransaction,
  ): Promise<FinancialTransaction> {
    const [row] = await db
      .insert(financialTransactions)
      .values(withTenant(data))
      .returning();
    if (!row) {
      throw new NotFoundError("Falha ao criar lançamento financeiro.");
    }
    return row;
  }

  // ── Dashboard ──────────────────────────────────────────────────────────
  async getDashboard(): Promise<FinancialDashboard> {
    // .substring(0,10) preserves the "YYYY-MM-DD" prefix and returns string
    // (split("T")[0] is string | undefined under noUncheckedIndexedAccess).
    const today = new Date().toISOString().substring(0, 10);
    const now = new Date();
    const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
    const sumExpr = sql<string>`coalesce(sum(valor::numeric), 0)`;

    const [arTotal] = await db
      .select({ sum: sumExpr })
      .from(accountsReceivable)
      .where(
        tenantAnd(
          accountsReceivable,
          eq(accountsReceivable.status, "pendente"),
        ),
      );

    const [apTotal] = await db
      .select({ sum: sumExpr })
      .from(accountsPayable)
      .where(
        tenantAnd(accountsPayable, eq(accountsPayable.status, "pendente")),
      );

    const [arVencidos] = await db
      .select({ sum: sumExpr })
      .from(accountsReceivable)
      .where(
        tenantAnd(
          accountsReceivable,
          eq(accountsReceivable.status, "pendente"),
          lte(accountsReceivable.dataVencimento, today),
        ),
      );

    const [apVencidos] = await db
      .select({ sum: sumExpr })
      .from(accountsPayable)
      .where(
        tenantAnd(
          accountsPayable,
          eq(accountsPayable.status, "pendente"),
          lte(accountsPayable.dataVencimento, today),
        ),
      );

    const [entradas] = await db
      .select({ sum: sumExpr })
      .from(financialTransactions)
      .where(
        tenantAnd(
          financialTransactions,
          eq(financialTransactions.tipo, "entrada"),
          gte(financialTransactions.data, monthStart),
        ),
      );

    const [saidas] = await db
      .select({ sum: sumExpr })
      .from(financialTransactions)
      .where(
        tenantAnd(
          financialTransactions,
          eq(financialTransactions.tipo, "saida"),
          gte(financialTransactions.data, monthStart),
        ),
      );

    // SQL aggregates without GROUP BY always return exactly one row, but TS
    // can't see that. The "0" fallback is unreachable at runtime; it only
    // satisfies noUncheckedIndexedAccess. parseFloat("0") === 0.
    const arTotalSum = parseFloat(arTotal?.sum ?? "0");
    const apTotalSum = parseFloat(apTotal?.sum ?? "0");
    const arVencidosSum = parseFloat(arVencidos?.sum ?? "0");
    const apVencidosSum = parseFloat(apVencidos?.sum ?? "0");
    const recebidoMes = parseFloat(entradas?.sum ?? "0");
    const pagoMes = parseFloat(saidas?.sum ?? "0");

    return {
      totalReceber: arTotalSum,
      totalPagar: apTotalSum,
      saldoProjetado: arTotalSum - apTotalSum,
      vencidasReceber: arVencidosSum,
      vencidasPagar: apVencidosSum,
      // Legacy-compatible aliases for existing frontend consumers.
      totalReceivable: arTotalSum,
      totalPayable: apTotalSum,
      vencidosAR: arVencidosSum,
      vencidosAP: apVencidosSum,
      recebidoMes,
      pagoMes,
      balanceMes: recebidoMes - pagoMes,
    };
  }

  // ── Logging ─────────────────────────────────────────────────────────────
  async log(params: {
    action: string;
    description: string;
    userId?: number;
    level?: string;
  }): Promise<void> {
    // Audit trail is tenant-scoped too — system_logs already carries
    // `companyId`, so we reuse it as the tenant marker.
    await db.insert(systemLogs).values({
      action: params.action,
      description: params.description,
      userId: params.userId,
      level: params.level ?? "INFO",
      companyId: requireTenantId(),
    } as any);
  }

  // Cross-cutting: company config is per-tenant; the underlying storage method
  // already filters by the company in scope (or returns the global default).
  getCompanyConfig() {
    return storage.getCompanyConfig();
  }
}

export const financeRepository = new FinanceRepository();
