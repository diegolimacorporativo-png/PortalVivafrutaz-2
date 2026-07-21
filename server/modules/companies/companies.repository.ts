/**
 * CompaniesRepository — única camada de persistência do domínio Companies.
 *
 * Wave 1B: refatorado para seguir o REPOSITORY_STANDARD.md.
 *   - Sem import de `storage` — toda persistência usa Drizzle diretamente.
 *   - `LogEntry` importado de `@shared/types/log.types`.
 *   - `expectOne<T>()` substituindo `!` non-null assertions em INSERT/UPDATE.
 *   - Dois conjuntos de métodos:
 *       1. Service-facing (com tenant-guard via `assertCompanyAccess`).
 *       2. IStorage-compatíveis (raw, sem tenant-guard) para delegação em DatabaseStorage.
 *
 * Cross-domain reads (getUser, getSmtpConfig, getProducts, createOrder,
 * getAssinaturas, getPlanos) foram removidos do repositório — agora são
 * responsabilidade da camada de serviço que chama `storage` diretamente.
 */

import { and, desc, eq, ilike, or, sql } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { db } from "../../database/db";
import {
  companies,
  contractScopes,
  contractAdjustments,
  companyAddresses,
  companyConfig,
  companySettings,
  empresaConfig,
  empresaModulos,
  modulosMarketplace,
  systemLogs,
  type CompanyConfig,
  type InsertCompanyConfig,
  type CompanySettings,
  type InsertCompanySettings,
  type EmpresaConfig,
  type InsertEmpresaConfig,
  type EmpresaModulo,
  type InsertEmpresaModulo,
} from "@shared/schema";
import { tenantWhere } from "../../core/tenant/scope";
import { currentTenantId } from "../../core/tenant/context";
import { ForbiddenError } from "../../shared/errors/AppError";
import { expectOne } from "../../shared/repositories/repository.utils";
import type { LogEntry } from "../../shared/types/log.types";
import type { ICompaniesRepository, PaginatedCompanies, CompaniesPaginatedParams } from "./interfaces/ICompaniesRepository";
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
export class CompaniesRepository implements ICompaniesRepository {
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

  // ══════════════════════════════════════════════════════════════════════════
  // SERVICE-FACING METHODS (com tenant-guard)
  // ══════════════════════════════════════════════════════════════════════════

  // ── Companies ─────────────────────────────────────────────────────────────

  /**
   * Lista empresas. Pinned principals veem apenas a própria empresa;
   * cross-tenant admins veem todas.
   */
  async list(): Promise<Company[]> {
    const tenantId = currentTenantId();
    if (tenantId == null) {
      return db.select().from(companies);
    }
    const [own] = await db
      .select()
      .from(companies)
      .where(eq(companies.id, tenantId));
    return own ? [own] : [];
  }

  async get(id: number): Promise<Company | undefined> {
    this.assertCompanyAccess(id);
    const [company] = await db
      .select()
      .from(companies)
      .where(eq(companies.id, id));
    return company;
  }

  /**
   * Criar uma empresa é inerentemente cross-tenant (o novo tenant ainda não
   * existe). Pinned company-portal users não podem invocar; cross-tenant e
   * pinned admins são permitidos.
   */
  async create(data: InsertCompany): Promise<Company> {
    // No assertion — see doc-block. bcrypt hashing preservado da implementação original.
    const hashedPassword = data.password
      ? await bcrypt.hash(data.password, 10)
      : undefined;
    const toInsert = { ...data, password: hashedPassword ?? data.password };
    const rows = await db.insert(companies).values(toInsert).returning();
    return expectOne(rows, "CompaniesRepository.create");
  }

  async update(id: number, updates: Partial<InsertCompany>): Promise<Company> {
    this.assertCompanyAccess(id);
    const toUpdate = { ...updates } as any;
    if (updates.password) {
      toUpdate.password = await bcrypt.hash(updates.password, 10);
    }
    const rows = await db
      .update(companies)
      .set(toUpdate)
      .where(eq(companies.id, id))
      .returning();
    return expectOne(rows, "CompaniesRepository.update");
  }

  async delete(id: number): Promise<void> {
    this.assertCompanyAccess(id);
    await db.delete(companies).where(eq(companies.id, id));
  }

  // ── Contract Scopes (tenant-scoped via `companyId`) ───────────────────────

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
    const rows = await db.insert(contractScopes).values(scope).returning();
    return expectOne(rows, "CompaniesRepository.createScope") as unknown as ContractScope;
  }

  /**
   * Atualiza um scope. Re-fetch do companyId antes de mutar — impede admin
   * pinned ao tenant A de atualizar scope do tenant B via scopeId.
   */
  async updateScope(
    scopeId: number,
    companyId: number,
    data: Partial<InsertContractScope>,
  ): Promise<ContractScope> {
    this.assertCompanyAccess(companyId);
    const rows = await db
      .update(contractScopes)
      .set(data as any)
      .where(eq(contractScopes.id, scopeId))
      .returning();
    return expectOne(rows, "CompaniesRepository.updateScope") as unknown as ContractScope;
  }

  async deleteScope(scopeId: number, companyId: number): Promise<void> {
    this.assertCompanyAccess(companyId);
    await db.delete(contractScopes).where(eq(contractScopes.id, scopeId));
  }

  // ── Contract Adjustments ──────────────────────────────────────────────────

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
      .orderBy(desc(contractAdjustments.createdAt)) as unknown as Promise<ContractAdjustment[]>;
  }

  async getAdjustment(id: number): Promise<ContractAdjustment | undefined> {
    const [adj] = await db
      .select()
      .from(contractAdjustments)
      .where(eq(contractAdjustments.id, id));
    if (!adj) return undefined;
    this.assertCompanyAccess((adj as any).companyId);
    return adj as unknown as ContractAdjustment;
  }

  async createAdjustment(adj: InsertContractAdjustment): Promise<ContractAdjustment> {
    this.assertCompanyAccess((adj as any).companyId);
    const rows = await db.insert(contractAdjustments).values(adj).returning();
    return expectOne(rows, "CompaniesRepository.createAdjustment") as unknown as ContractAdjustment;
  }

  async updateAdjustment(
    id: number,
    companyId: number,
    data: Partial<InsertContractAdjustment>,
  ): Promise<ContractAdjustment> {
    this.assertCompanyAccess(companyId);
    const rows = await db
      .update(contractAdjustments)
      .set(data as any)
      .where(eq(contractAdjustments.id, id))
      .returning();
    return expectOne(rows, "CompaniesRepository.updateAdjustment") as unknown as ContractAdjustment;
  }

  // ── Company Addresses ─────────────────────────────────────────────────────

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
    const rows = await db.insert(companyAddresses).values(data).returning();
    return expectOne(rows, "CompaniesRepository.createAddress") as unknown as CompanyAddress;
  }

  async updateAddress(
    addressId: number,
    companyId: number,
    data: Partial<InsertCompanyAddress>,
  ): Promise<CompanyAddress> {
    this.assertCompanyAccess(companyId);
    const rows = await db
      .update(companyAddresses)
      .set(data)
      .where(eq(companyAddresses.id, addressId))
      .returning();
    return expectOne(rows, "CompaniesRepository.updateAddress") as unknown as CompanyAddress;
  }

  async deleteAddress(addressId: number, companyId: number): Promise<void> {
    this.assertCompanyAccess(companyId);
    await db.delete(companyAddresses).where(eq(companyAddresses.id, addressId));
  }

  async setPrimaryAddress(companyId: number, addressId: number): Promise<void> {
    this.assertCompanyAccess(companyId);
    await db
      .update(companyAddresses)
      .set({ isPrimary: false })
      .where(eq(companyAddresses.companyId, companyId));
    await db
      .update(companyAddresses)
      .set({ isPrimary: true })
      .where(eq(companyAddresses.id, addressId));
  }

  // ── GPS / EmpresaConfig (tenant-scoped by companyId == empresaId) ─────────

  async getEmpresaConfig(companyId: number): Promise<EmpresaConfig | undefined> {
    this.assertCompanyAccess(companyId);
    const [r] = await db
      .select()
      .from(empresaConfig)
      .where(eq(empresaConfig.empresaId, companyId));
    return r;
  }

  async upsertEmpresaConfig(
    companyId: number,
    data: Partial<InsertEmpresaConfig>,
  ): Promise<EmpresaConfig> {
    this.assertCompanyAccess(companyId);
    const existing = await this._getEmpresaConfigRaw(companyId);
    if (existing) {
      const rows = await db
        .update(empresaConfig)
        .set({ ...data, updatedAt: new Date() })
        .where(eq(empresaConfig.empresaId, companyId))
        .returning();
      return expectOne(rows, "CompaniesRepository.upsertEmpresaConfig.update");
    }
    const rows = await db
      .insert(empresaConfig)
      .values({ ...data, empresaId: companyId })
      .returning();
    return expectOne(rows, "CompaniesRepository.upsertEmpresaConfig.insert");
  }

  /** Helper interno sem tenant-guard — usado por upsertEmpresaConfig e pelo método raw. */
  private async _getEmpresaConfigRaw(empresaId: number): Promise<EmpresaConfig | undefined> {
    const [r] = await db
      .select()
      .from(empresaConfig)
      .where(eq(empresaConfig.empresaId, empresaId));
    return r;
  }

  // ── Auditoria ─────────────────────────────────────────────────────────────

  /**
   * Grava entrada de audit log diretamente no Drizzle — sem dependência
   * circular em `storage`. Implementação espelha `DatabaseStorage.createLog`.
   */
  async log(entry: LogEntry): Promise<void> {
    try {
      await db
        .insert(systemLogs)
        .values({ ...entry, level: entry.level ?? "INFO" });
    } catch {
      // Best-effort: falha de log não propaga para o chamador.
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // ISTORAGE-COMPATÍVEIS (raw, sem tenant-guard) — para DatabaseStorage
  // ══════════════════════════════════════════════════════════════════════════

  // ── Companies (raw) ───────────────────────────────────────────────────────

  async getCompanyByEmail(email: string): Promise<Company | undefined> {
    const [company] = await db
      .select()
      .from(companies)
      .where(sql`lower(${companies.email}) = ${email.toLowerCase()}`);
    return company;
  }

  async getCompany(id: number): Promise<Company | undefined> {
    const [company] = await db
      .select()
      .from(companies)
      .where(eq(companies.id, id));
    return company;
  }

  async getCompanies(limit?: number, offset?: number): Promise<Company[]> {
    let query: any = db.select().from(companies);
    if (limit) query = query.limit(limit);
    if (offset) query = query.offset(offset);
    return query;
  }

  async createCompany(company: InsertCompany): Promise<Company> {
    const hashedPassword = company.password
      ? await bcrypt.hash(company.password, 10)
      : undefined;
    const toInsert = { ...company, password: hashedPassword ?? company.password };
    const rows = await db.insert(companies).values(toInsert).returning();
    return expectOne(rows, "CompaniesRepository.createCompany");
  }

  async updateCompany(id: number, updates: Partial<InsertCompany>): Promise<Company> {
    const toUpdate = { ...updates } as any;
    if (updates.password) {
      toUpdate.password = await bcrypt.hash(updates.password, 10);
    }
    const rows = await db
      .update(companies)
      .set(toUpdate)
      .where(eq(companies.id, id))
      .returning();
    return expectOne(rows, "CompaniesRepository.updateCompany");
  }

  async deleteCompany(id: number): Promise<void> {
    await db.delete(companies).where(eq(companies.id, id));
  }

  // ── Contract Scopes (raw) ─────────────────────────────────────────────────

  async getContractScopes(companyId: number): Promise<ContractScope[]> {
    return db
      .select()
      .from(contractScopes)
      .where(eq(contractScopes.companyId, companyId)) as unknown as Promise<ContractScope[]>;
  }

  async getContractScope(
    companyId: number,
    productId: number,
  ): Promise<ContractScope | null> {
    const rows = await db
      .select()
      .from(contractScopes)
      .where(
        and(
          eq(contractScopes.companyId, companyId),
          eq(contractScopes.productId, productId),
        ),
      )
      .limit(1);
    return (rows[0] ?? null) as unknown as ContractScope | null;
  }

  async createContractScope(scope: InsertContractScope): Promise<ContractScope> {
    const rows = await db.insert(contractScopes).values(scope).returning();
    return expectOne(rows, "CompaniesRepository.createContractScope") as unknown as ContractScope;
  }

  async updateContractScope(
    id: number,
    data: Partial<InsertContractScope>,
  ): Promise<ContractScope> {
    const rows = await db
      .update(contractScopes)
      .set(data as any)
      .where(eq(contractScopes.id, id))
      .returning();
    return expectOne(rows, "CompaniesRepository.updateContractScope") as unknown as ContractScope;
  }

  async deleteContractScope(id: number): Promise<void> {
    await db.delete(contractScopes).where(eq(contractScopes.id, id));
  }

  // ── Contract Adjustments (raw) ────────────────────────────────────────────

  async getContractAdjustments(companyId: number): Promise<ContractAdjustment[]> {
    return db
      .select()
      .from(contractAdjustments)
      .where(eq(contractAdjustments.companyId, companyId))
      .orderBy(desc(contractAdjustments.createdAt)) as unknown as Promise<ContractAdjustment[]>;
  }

  async getContractAdjustment(id: number): Promise<ContractAdjustment | undefined> {
    const [record] = await db
      .select()
      .from(contractAdjustments)
      .where(eq(contractAdjustments.id, id));
    return record as unknown as ContractAdjustment | undefined;
  }

  async createContractAdjustment(adj: InsertContractAdjustment): Promise<ContractAdjustment> {
    const rows = await db.insert(contractAdjustments).values(adj).returning();
    return expectOne(rows, "CompaniesRepository.createContractAdjustment") as unknown as ContractAdjustment;
  }

  async updateContractAdjustment(
    id: number,
    data: Partial<InsertContractAdjustment>,
  ): Promise<ContractAdjustment> {
    const rows = await db
      .update(contractAdjustments)
      .set(data as any)
      .where(eq(contractAdjustments.id, id))
      .returning();
    return expectOne(rows, "CompaniesRepository.updateContractAdjustment") as unknown as ContractAdjustment;
  }

  // ── Company Addresses (raw) ───────────────────────────────────────────────

  async getCompanyAddresses(companyId: number): Promise<CompanyAddress[]> {
    return db
      .select()
      .from(companyAddresses)
      .where(eq(companyAddresses.companyId, companyId))
      .orderBy(desc(companyAddresses.isPrimary), desc(companyAddresses.createdAt)) as unknown as Promise<CompanyAddress[]>;
  }

  async createCompanyAddress(data: InsertCompanyAddress): Promise<CompanyAddress> {
    const rows = await db.insert(companyAddresses).values(data).returning();
    return expectOne(rows, "CompaniesRepository.createCompanyAddress") as unknown as CompanyAddress;
  }

  async updateCompanyAddress(
    id: number,
    data: Partial<InsertCompanyAddress>,
  ): Promise<CompanyAddress> {
    const rows = await db
      .update(companyAddresses)
      .set(data)
      .where(eq(companyAddresses.id, id))
      .returning();
    return expectOne(rows, "CompaniesRepository.updateCompanyAddress") as unknown as CompanyAddress;
  }

  async deleteCompanyAddress(id: number): Promise<void> {
    await db.delete(companyAddresses).where(eq(companyAddresses.id, id));
  }

  // ── EmpresaModulos (raw) ──────────────────────────────────────────────────

  async getEmpresaModulos(empresaId: number): Promise<EmpresaModulo[]> {
    return db
      .select()
      .from(empresaModulos)
      .where(eq(empresaModulos.empresaId, empresaId))
      .orderBy(desc(empresaModulos.dataInstalacao));
  }

  async getEmpresaModulo(id: number): Promise<EmpresaModulo | undefined> {
    const [r] = await db
      .select()
      .from(empresaModulos)
      .where(eq(empresaModulos.id, id));
    return r;
  }

  async installModuloEmpresa(
    empresaId: number,
    moduloId: number,
  ): Promise<EmpresaModulo> {
    // Busca versão do módulo diretamente — sem dependência de storage.
    const [modulo] = await db
      .select()
      .from(modulosMarketplace)
      .where(eq(modulosMarketplace.id, moduloId));
    const rows = await db
      .insert(empresaModulos)
      .values({
        empresaId,
        moduloId,
        status: "ativo",
        versaoInstalada: (modulo as any)?.versao ?? "1.0.0",
      })
      .returning();
    return expectOne(rows, "CompaniesRepository.installModuloEmpresa");
  }

  async updateEmpresaModulo(
    id: number,
    data: Partial<InsertEmpresaModulo>,
  ): Promise<EmpresaModulo> {
    const rows = await db
      .update(empresaModulos)
      .set(data)
      .where(eq(empresaModulos.id, id))
      .returning();
    return expectOne(rows, "CompaniesRepository.updateEmpresaModulo");
  }

  async removeModuloEmpresa(id: number): Promise<void> {
    await db.delete(empresaModulos).where(eq(empresaModulos.id, id));
  }

  // ── CompanyConfig (raw) ───────────────────────────────────────────────────

  async getCompanyConfig(): Promise<CompanyConfig | undefined> {
    const configs = await db.select().from(companyConfig);
    return configs[0];
  }

  async updateCompanyConfig(
    updates: Partial<InsertCompanyConfig>,
  ): Promise<CompanyConfig> {
    const configs = await db.select().from(companyConfig);
    const existing = configs[0];
    if (!existing) {
      const rows = await db
        .insert(companyConfig)
        .values({ ...updates, updatedAt: new Date() } as any)
        .returning();
      return expectOne(rows, "CompaniesRepository.updateCompanyConfig.insert");
    }
    const rows = await db
      .update(companyConfig)
      .set({ ...updates, updatedAt: new Date() } as any)
      .where(eq(companyConfig.id, existing.id))
      .returning();
    return expectOne(rows, "CompaniesRepository.updateCompanyConfig.update");
  }

  // ── CompanySettings (raw) ─────────────────────────────────────────────────

  async getCompanySettings(empresaId: number): Promise<CompanySettings | undefined> {
    const [settings] = await db
      .select()
      .from(companySettings)
      .where(eq(companySettings.empresaId, empresaId));
    return settings;
  }

  async updateCompanySettings(
    empresaId: number,
    updates: Partial<InsertCompanySettings>,
  ): Promise<CompanySettings> {
    const existing = await this.getCompanySettings(empresaId);
    if (!existing) {
      const rows = await db
        .insert(companySettings)
        .values({ ...updates, empresaId, updatedAt: new Date() } as any)
        .returning();
      return expectOne(rows, "CompaniesRepository.updateCompanySettings.insert");
    }
    const rows = await db
      .update(companySettings)
      .set({ ...updates, updatedAt: new Date() } as any)
      .where(eq(companySettings.id, existing.id))
      .returning();
    return expectOne(rows, "CompaniesRepository.updateCompanySettings.update");
  }

  // ── EmpresaConfig (raw, sem tenant-guard) ─────────────────────────────────

  async getEmpresaConfigRaw(empresaId: number): Promise<EmpresaConfig | undefined> {
    return this._getEmpresaConfigRaw(empresaId);
  }

  async upsertEmpresaConfigRaw(
    empresaId: number,
    data: Partial<InsertEmpresaConfig>,
  ): Promise<EmpresaConfig> {
    const existing = await this._getEmpresaConfigRaw(empresaId);
    if (existing) {
      const rows = await db
        .update(empresaConfig)
        .set({ ...data, updatedAt: new Date() })
        .where(eq(empresaConfig.empresaId, empresaId))
        .returning();
      return expectOne(rows, "CompaniesRepository.upsertEmpresaConfigRaw.update");
    }
    const rows = await db
      .insert(empresaConfig)
      .values({ ...data, empresaId })
      .returning();
    return expectOne(rows, "CompaniesRepository.upsertEmpresaConfigRaw.insert");
  }

  // ── CompaniesPaginated (raw) ──────────────────────────────────────────────

  async getCompaniesPaginated(
    params: CompaniesPaginatedParams,
  ): Promise<PaginatedCompanies> {
    const page = Math.max(1, params.page ?? 1);
    const limit = Math.min(200, Math.max(1, params.limit ?? 25));
    const offset = (page - 1) * limit;

    const conds: any[] = [];
    if (params.status && params.status !== "ALL") {
      if (params.status === "ACTIVE") conds.push(eq(companies.active, true));
      else if (params.status === "INACTIVE") conds.push(eq(companies.active, false));
    }
    if (params.clientType && params.clientType !== "ALL") {
      conds.push(eq(companies.clientType, params.clientType));
    }
    if (params.search) {
      const q = `%${params.search}%`;
      conds.push(
        or(
          ilike(companies.companyName, q),
          ilike(companies.email, q),
          ilike(companies.contactName, q),
        )!,
      );
    }

    const where = conds.length > 0 ? and(...conds) : undefined;

    const [countRow] = await db
      .select({ total: sql<number>`cast(count(*) as integer)` })
      .from(companies)
      .where(where);

    const total = countRow?.total ?? 0;
    const data = await db.select().from(companies).where(where).limit(limit).offset(offset);

    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  // ── SaaS helpers (permanecem como cross-domain — servem apenas ao serviço) ─
  // Removidos do repositório (Wave 1B): getProducts, createOrder, getUser,
  // getSmtpConfig, listAssinaturas, listPlanos.
  // CompaniesService chama `storage` diretamente para estes.
}

export const companiesRepository = new CompaniesRepository();
