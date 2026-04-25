import { and, desc, eq } from "drizzle-orm";
import { db } from "../../database/db";
import {
  companies,
  contractScopes,
  contractAdjustments,
  companyAddresses,
} from "@shared/schema";
import { storage } from "../../services/storage";
import { tenantWhere } from "../../core/tenant/scope";
import { currentTenantId } from "../../core/tenant/context";
import { ForbiddenError } from "../../shared/errors/AppError";
import type {
  Company,
  InsertCompany,
  ContractScope,
  InsertContractScope,
  ContractAdjustment,
  InsertContractAdjustment,
  CompanyAddress,
  InsertCompanyAddress,
} from "./companies.types";

/**
 * CompaniesRepository — multi-tenant data access for the companies domain.
 *
 * Field-name note: the `companies` table itself has NO `empresaId` column —
 * `companies.id` IS the tenant id. Sub-resources (`contractScopes`,
 * `contractAdjustments`, `companyAddresses`) use `companyId`, which the
 * `tenantWhere()` helper auto-detects as the tenant marker. We therefore
 * scope sub-resources via `tenantWhere(<table>)` and scope the company root
 * via the explicit `assertCompanyAccess(id)` guard below.
 *
 * Cross-tenant escape hatch: when `currentTenantId() === null` (cross-tenant
 * MASTER without a pinned tenant) the guard is permissive — admins read/write
 * any company. Pinned principals (company-portal users and pinned admins)
 * are hard-restricted to their own company.
 */
export class CompaniesRepository {
  /**
   * Throws ForbiddenError if a pinned tenant tries to touch a company that
   * isn't theirs. Cross-tenant admins (tenantId == null) pass freely.
   * Centralising this check is the analogue of `tenantWhere(companies)` for
   * a table whose tenant key is the primary key itself.
   */
  private assertCompanyAccess(companyId: number): void {
    const tenantId = currentTenantId();
    if (tenantId != null && tenantId !== companyId) {
      throw new ForbiddenError("Tenant não autorizado a acessar esta empresa");
    }
  }

  // ── Companies ───────────────────────────────────────────────────────────
  /**
   * List companies. Pinned principals see only their own company; cross-tenant
   * admins see everything (preserves the legacy admin "manage all" behaviour).
   */
  async list(): Promise<Company[]> {
    const tenantId = currentTenantId();
    if (tenantId == null) {
      return storage.getCompanies();
    }
    // We hand-pull the row through `storage.getCompany` rather than running
    // `db.select()` here because the storage layer applies the same row
    // shaping (defaults, JSON parsing) used everywhere else in the app.
    // Going through the raw query produced a broader Drizzle row type that
    // doesn't satisfy `Company`.
    const own = await storage.getCompany(tenantId);
    return own ? [own] : [];
  }

  async get(id: number): Promise<Company | undefined> {
    this.assertCompanyAccess(id);
    return storage.getCompany(id);
  }

  /**
   * Creating a company is inherently cross-tenant (a new tenant doesn't exist
   * yet). We forbid pinned company-portal users from invoking it; cross-tenant
   * and pinned admins are allowed.
   */
  async create(data: InsertCompany): Promise<Company> {
    // No assertion — see doc-block. Storage handles bcrypt hashing.
    return storage.createCompany(data);
  }

  async update(id: number, updates: Partial<InsertCompany>): Promise<Company> {
    this.assertCompanyAccess(id);
    return storage.updateCompany(id, updates);
  }

  async delete(id: number): Promise<void> {
    this.assertCompanyAccess(id);
    return storage.deleteCompany(id);
  }

  // ── Contract Scopes (tenant-scoped via `companyId`) ─────────────────────
  async listScopes(companyId: number): Promise<ContractScope[]> {
    this.assertCompanyAccess(companyId);
    return db
      .select()
      .from(contractScopes)
      .where(
        and(eq(contractScopes.companyId, companyId), tenantWhere(contractScopes)),
      ) as unknown as Promise<ContractScope[]>;
  }

  async createScope(scope: InsertContractScope): Promise<ContractScope> {
    this.assertCompanyAccess(scope.companyId);
    return storage.createContractScope(scope);
  }

  /**
   * Update a scope row. We re-fetch and check the parent companyId against the
   * tenant before mutating — prevents an admin pinned to tenant A from updating
   * tenant B's scope by guessing a scopeId.
   */
  async updateScope(
    scopeId: number,
    companyId: number,
    data: Partial<InsertContractScope>,
  ): Promise<ContractScope> {
    this.assertCompanyAccess(companyId);
    return storage.updateContractScope(scopeId, data);
  }

  async deleteScope(scopeId: number, companyId: number): Promise<void> {
    this.assertCompanyAccess(companyId);
    return storage.deleteContractScope(scopeId);
  }

  // ── Contract Adjustments ────────────────────────────────────────────────
  async listAdjustments(companyId: number): Promise<ContractAdjustment[]> {
    this.assertCompanyAccess(companyId);
    return db
      .select()
      .from(contractAdjustments)
      .where(
        and(
          eq(contractAdjustments.companyId, companyId),
          tenantWhere(contractAdjustments),
        ),
      )
      .orderBy(desc(contractAdjustments.createdAt)) as unknown as Promise<
      ContractAdjustment[]
    >;
  }

  async getAdjustment(id: number): Promise<ContractAdjustment | undefined> {
    const adj = await storage.getContractAdjustment(id);
    if (!adj) return undefined;
    this.assertCompanyAccess(adj.companyId);
    return adj;
  }

  async createAdjustment(
    adj: InsertContractAdjustment,
  ): Promise<ContractAdjustment> {
    this.assertCompanyAccess(adj.companyId);
    return storage.createContractAdjustment(adj);
  }

  async updateAdjustment(
    id: number,
    companyId: number,
    data: Partial<InsertContractAdjustment>,
  ): Promise<ContractAdjustment> {
    this.assertCompanyAccess(companyId);
    return storage.updateContractAdjustment(id, data);
  }

  // ── Company Addresses ───────────────────────────────────────────────────
  async listAddresses(companyId: number): Promise<CompanyAddress[]> {
    this.assertCompanyAccess(companyId);
    return db
      .select()
      .from(companyAddresses)
      .where(
        and(
          eq(companyAddresses.companyId, companyId),
          tenantWhere(companyAddresses),
        ),
      )
      .orderBy(
        desc(companyAddresses.isPrimary),
        desc(companyAddresses.createdAt),
      ) as unknown as Promise<CompanyAddress[]>;
  }

  async createAddress(data: InsertCompanyAddress): Promise<CompanyAddress> {
    this.assertCompanyAccess(data.companyId);
    return storage.createCompanyAddress(data);
  }

  async updateAddress(
    addressId: number,
    companyId: number,
    data: Partial<InsertCompanyAddress>,
  ): Promise<CompanyAddress> {
    this.assertCompanyAccess(companyId);
    return storage.updateCompanyAddress(addressId, data);
  }

  async deleteAddress(addressId: number, companyId: number): Promise<void> {
    this.assertCompanyAccess(companyId);
    return storage.deleteCompanyAddress(addressId);
  }

  async setPrimaryAddress(
    companyId: number,
    addressId: number,
  ): Promise<void> {
    this.assertCompanyAccess(companyId);
    return storage.setPrimaryAddress(companyId, addressId);
  }

  // ── GPS / Empresa config (tenant-scoped by companyId == empresaId) ──────
  async getEmpresaConfig(companyId: number) {
    this.assertCompanyAccess(companyId);
    return storage.getEmpresaConfig(companyId);
  }

  async upsertEmpresaConfig(companyId: number, data: any) {
    this.assertCompanyAccess(companyId);
    return storage.upsertEmpresaConfig(companyId, data);
  }

  async listAssinaturas() {
    return storage.getAssinaturas();
  }

  async listPlanos() {
    return storage.getPlanos();
  }

  // ── Cross-domain reads used by the service layer ────────────────────────
  async getProducts() {
    return storage.getProducts();
  }

  async createOrder(order: any, items: any[]) {
    return storage.createOrder(order, items);
  }

  async getUser(userId: number) {
    return storage.getUser(userId);
  }

  async getSmtpConfig() {
    return storage.getSmtpConfig();
  }

  /** Audit-log a companies-related action. */
  log(entry: Parameters<typeof storage.createLog>[0]): Promise<unknown> {
    return storage.createLog(entry) as Promise<unknown>;
  }
}

export const companiesRepository = new CompaniesRepository();
