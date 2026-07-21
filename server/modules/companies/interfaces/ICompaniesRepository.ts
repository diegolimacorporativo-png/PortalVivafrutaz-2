/**
 * ICompaniesRepository — contrato do repositório do domínio Companies.
 *
 * Wave 1B: extração do domínio Companies de DatabaseStorage.
 *
 * Duas camadas de métodos:
 *  1. Métodos service-facing (com tenant-guard embutido) — usados por CompaniesService.
 *  2. Métodos IStorage-compatíveis (raw, sem tenant-guard) — usados por DatabaseStorage
 *     para delegação 1:1. Assinaturas idênticas às de IStorage.
 *
 * Regras do REPOSITORY_STANDARD.md:
 *  - Sem import de `storage` — jamais.
 *  - `LogEntry` vem de `@shared/types/log.types`.
 *  - `log()` implementado com Drizzle direto.
 */

import type { LogEntry } from "../../../shared/types/log.types";
import type {
  Company,
  InsertCompany,
  ContractScope,
  InsertContractScope,
  ContractAdjustment,
  InsertContractAdjustment,
  CompanyAddress,
  InsertCompanyAddress,
} from "../companies.types";
import type {
  CompanyConfig,
  InsertCompanyConfig,
  CompanySettings,
  InsertCompanySettings,
  EmpresaConfig,
  InsertEmpresaConfig,
  EmpresaModulo,
  InsertEmpresaModulo,
} from "@shared/schema";

// ── Tipos de retorno paginados ─────────────────────────────────────────────────
export interface PaginatedCompanies {
  data: Company[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface CompaniesPaginatedParams {
  page?: number;
  limit?: number;
  search?: string;
  status?: string;
  clientType?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Interface pública
// ─────────────────────────────────────────────────────────────────────────────

export interface ICompaniesRepository {
  // ── Service-facing (com tenant-guard) ──────────────────────────────────────

  /** Lista empresas respeitando o contexto de tenant. */
  list(): Promise<Company[]>;
  /** Busca empresa por id com tenant-guard. */
  get(id: number): Promise<Company | undefined>;
  /** Cria empresa (cross-tenant por natureza). */
  create(data: InsertCompany): Promise<Company>;
  /** Atualiza empresa com tenant-guard. */
  update(id: number, updates: Partial<InsertCompany>): Promise<Company>;
  /** Remove empresa com tenant-guard. */
  delete(id: number): Promise<void>;

  // Contract Scopes
  listScopes(companyId: number): Promise<ContractScope[]>;
  createScope(scope: InsertContractScope): Promise<ContractScope>;
  updateScope(scopeId: number, companyId: number, data: Partial<InsertContractScope>): Promise<ContractScope>;
  deleteScope(scopeId: number, companyId: number): Promise<void>;

  // Contract Adjustments
  listAdjustments(companyId: number): Promise<ContractAdjustment[]>;
  getAdjustment(id: number): Promise<ContractAdjustment | undefined>;
  createAdjustment(adj: InsertContractAdjustment): Promise<ContractAdjustment>;
  updateAdjustment(id: number, companyId: number, data: Partial<InsertContractAdjustment>): Promise<ContractAdjustment>;

  // Company Addresses
  listAddresses(companyId: number): Promise<CompanyAddress[]>;
  createAddress(data: InsertCompanyAddress): Promise<CompanyAddress>;
  updateAddress(addressId: number, companyId: number, data: Partial<InsertCompanyAddress>): Promise<CompanyAddress>;
  deleteAddress(addressId: number, companyId: number): Promise<void>;
  setPrimaryAddress(companyId: number, addressId: number): Promise<void>;

  // Empresa Config / GPS
  getEmpresaConfig(companyId: number): Promise<EmpresaConfig | undefined>;
  upsertEmpresaConfig(companyId: number, data: Partial<InsertEmpresaConfig>): Promise<EmpresaConfig>;

  // ── IStorage-compatíveis (raw, sem tenant-guard) — para DatabaseStorage ──

  getCompanyByEmail(email: string): Promise<Company | undefined>;
  getCompany(id: number): Promise<Company | undefined>;
  getCompanies(limit?: number, offset?: number): Promise<Company[]>;
  createCompany(company: InsertCompany): Promise<Company>;
  updateCompany(id: number, updates: Partial<InsertCompany>): Promise<Company>;
  deleteCompany(id: number): Promise<void>;

  getContractScopes(companyId: number): Promise<ContractScope[]>;
  getContractScope(companyId: number, productId: number): Promise<ContractScope | null>;
  createContractScope(scope: InsertContractScope): Promise<ContractScope>;
  updateContractScope(id: number, data: Partial<InsertContractScope>): Promise<ContractScope>;
  deleteContractScope(id: number): Promise<void>;

  getContractAdjustments(companyId: number): Promise<ContractAdjustment[]>;
  getContractAdjustment(id: number): Promise<ContractAdjustment | undefined>;
  createContractAdjustment(adj: InsertContractAdjustment): Promise<ContractAdjustment>;
  updateContractAdjustment(id: number, data: Partial<InsertContractAdjustment>): Promise<ContractAdjustment>;

  getCompanyAddresses(companyId: number): Promise<CompanyAddress[]>;
  createCompanyAddress(data: InsertCompanyAddress): Promise<CompanyAddress>;
  updateCompanyAddress(id: number, data: Partial<InsertCompanyAddress>): Promise<CompanyAddress>;
  deleteCompanyAddress(id: number): Promise<void>;

  getEmpresaModulos(empresaId: number): Promise<EmpresaModulo[]>;
  getEmpresaModulo(id: number): Promise<EmpresaModulo | undefined>;
  installModuloEmpresa(empresaId: number, moduloId: number): Promise<EmpresaModulo>;
  updateEmpresaModulo(id: number, data: Partial<InsertEmpresaModulo>): Promise<EmpresaModulo>;
  removeModuloEmpresa(id: number): Promise<void>;

  getCompanyConfig(): Promise<CompanyConfig | undefined>;
  updateCompanyConfig(updates: Partial<InsertCompanyConfig>): Promise<CompanyConfig>;

  getCompanySettings(empresaId: number): Promise<CompanySettings | undefined>;
  updateCompanySettings(empresaId: number, updates: Partial<InsertCompanySettings>): Promise<CompanySettings>;

  getCompaniesPaginated(params: CompaniesPaginatedParams): Promise<PaginatedCompanies>;

  // Auditoria
  log(entry: LogEntry): Promise<void>;
}
