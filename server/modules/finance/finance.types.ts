/**
 * Finance module — public type contracts.
 *
 * Architecture decision: each module re-exports the shared (Drizzle) types
 * it needs and adds its own DTOs/filters. Consumers (controller, other
 * modules) import only from this barrel, never from `@shared/schema`
 * directly. This keeps the module's surface area explicit and makes future
 * extraction (microservice, separate package) straightforward.
 */
export type {
  AccountReceivable,
  InsertAccountReceivable,
  AccountPayable,
  InsertAccountPayable,
  FinancialTransaction,
  InsertFinancialTransaction,
} from "@shared/schema";

export interface AccountsReceivableFilter {
  status?: string;
  companyId?: number;
}

export interface AccountsPayableFilter {
  status?: string;
}

export interface CashflowFilter {
  from?: string;
  to?: string;
}

export interface FinancialDashboard {
  totalReceber: number;
  totalPagar: number;
  saldoProjetado: number;
  vencidasReceber: number;
  vencidasPagar: number;
  // Plus whatever else storage.getFinancialDashboard returns; we keep the
  // type permissive for now and tighten it as the legacy storage shrinks.
  [key: string]: unknown;
}
