/**
 * Companies module — public type contracts.
 *
 * Architecture decision: each module re-exports the shared (Drizzle) types
 * it needs and adds its own DTOs/filters. Consumers (controller, other
 * modules) import only from this barrel, never from `@shared/schema`
 * directly. This keeps the module's surface area explicit and makes future
 * extraction (microservice, separate package) straightforward.
 */
export type {
  Company,
  InsertCompany,
  ContractScope,
  InsertContractScope,
  ContractAdjustment,
  InsertContractAdjustment,
  CompanyAddress,
  InsertCompanyAddress,
} from "@shared/schema";

/** Result of /api/admin/companies/validate — kept here so the controller
 *  can return a typed value without leaking storage internals. */
export interface CompanyValidationIssue {
  id: number;
  companyName: string;
  problems: string[];
}

export interface CompanyValidationReport {
  total: number;
  valid: number;
  withIssues: number;
  issues: CompanyValidationIssue[];
  summary: string;
}

/** A delivery-window suggestion for the GET /delivery-suggestions endpoint. */
export interface DeliverySuggestion {
  id: number;
  companyName: string;
  addressCity: string | null;
  addressStreet: string | null;
  addressNeighborhood: string | null;
  enabledDays: Array<{ day: string; startTime: string; endTime: string }>;
}

/** GPS feature status combining plan-level and manual override. */
export interface GpsStatus {
  companyId: number;
  gpsAtivo: boolean;
  gpsViaPlano: boolean;
  gpsManualOverride: boolean;
  plano: { id: number; nome: string; tipoPlano: string } | null;
}

export interface ContractAdjustmentEmailInput {
  emailSubject?: string;
  emailBody?: string;
}
