import {
  NotFoundError,
  BadRequestError,
  ForbiddenError,
} from "../../shared/errors/AppError";
import { storage } from "../../services/storage";
import { runRecurringOrdersCron } from "../../jobs/recurring-orders.cron";
import {
  companiesRepository,
  CompaniesRepository,
} from "./companies.repository";
import type {
  Company,
  InsertCompany,
  ContractScope,
  InsertContractScope,
  ContractAdjustment,
  InsertContractAdjustment,
  CompanyAddress,
  InsertCompanyAddress,
  DeliverySuggestion,
  GpsStatus,
} from "./companies.types";

/**
 * CompaniesService — orchestration & business rules.
 *
 * Architecture decision: services own behaviour. They sequence repository
 * calls, enforce invariants, and never touch req/res. The companies domain
 * has a few cross-cutting flows that justify a dedicated service:
 *  - generate-orders-from-scope: composes contract scopes + product catalog
 *    into orders (calls into the orders persistence boundary via the repo).
 *  - send adjustment email: orchestrates SMTP config + nodemailer + audit log.
 *  - GPS status: composes empresa_config + assinaturas + planos.
 */
export class CompaniesService {
  constructor(private readonly repo: CompaniesRepository = companiesRepository) {}

  // ── Companies CRUD ─────────────────────────────────────────────────────
  list(): Promise<Company[]> {
    return this.repo.list();
  }

  listPaginated(params: {
    page?: number; limit?: number; search?: string; status?: string; clientType?: string;
  }): Promise<{ data: Company[]; total: number; page: number; limit: number; totalPages: number }> {
    return this.repo.getCompaniesPaginated(params);
  }

  async get(id: number): Promise<Company> {
    const company = await this.repo.get(id);
    if (!company) throw new NotFoundError("Empresa não encontrada");
    return company;
  }

  create(data: InsertCompany): Promise<Company> {
    return this.repo.create(data);
  }

  update(id: number, updates: Partial<InsertCompany>): Promise<Company> {
    return this.repo.update(id, updates);
  }

  delete(id: number): Promise<void> {
    return this.repo.delete(id);
  }

  // ── Self-service: portal user updates own preferred order type ─────────
  async updatePreferredOrderType(
    companyId: number,
    preferredOrderType: string,
  ): Promise<{ preferredOrderType: string | null }> {
    // Cast via `unknown` because `InsertCompany` (generated from
    // drizzle-zod) types every column as an array literal — a known quirk of
    // the project's schema generator that the legacy code worked around with
    // bare `as any`. We preserve type-safety at the call site here.
    const updated = await this.repo.update(
      companyId,
      { preferredOrderType } as unknown as Partial<InsertCompany>,
    );
    return { preferredOrderType: updated.preferredOrderType ?? null };
  }

  // ── Delivery window suggestions ────────────────────────────────────────
  async deliverySuggestions(city?: string): Promise<DeliverySuggestion[]> {
    const allCompanies = await this.repo.list();
    const filtered = allCompanies.filter((c) => {
      const ca = c as any;
      if (!ca.deliveryConfigJson) return false;
      try {
        const cfg = JSON.parse(ca.deliveryConfigJson);
        const hasEnabledDay = Object.values(cfg).some((v: any) => v?.enabled);
        if (!hasEnabledDay) return false;
      } catch {
        return false;
      }
      if (city) {
        const cityNorm = city.trim().toLowerCase();
        const compCity = (ca.addressCity || "").toLowerCase();
        if (!compCity.includes(cityNorm) && !cityNorm.includes(compCity))
          return false;
      }
      return true;
    });

    return filtered.map((c) => {
      const ca = c as any;
      let deliveryConfig: any = {};
      try {
        deliveryConfig = JSON.parse(ca.deliveryConfigJson);
      } catch {
        deliveryConfig = {};
      }
      const enabledDays = Object.entries(deliveryConfig)
        .filter(([, v]: any) => v?.enabled)
        .map(([day, v]: any) => ({
          day,
          startTime: v.startTime,
          endTime: v.endTime,
        }));
      return {
        id: c.id,
        companyName: c.companyName,
        addressCity: ca.addressCity ?? null,
        addressStreet: ca.addressStreet ?? null,
        addressNeighborhood: ca.addressNeighborhood ?? null,
        enabledDays,
      };
    });
  }

  // ── Contract Scopes ────────────────────────────────────────────────────
  listScopes(companyId: number): Promise<ContractScope[]> {
    return this.repo.listScopes(companyId);
  }

  createScope(
    companyId: number,
    body: any,
  ): Promise<ContractScope> {
    const payload = {
      companyId,
      dayOfWeek: body.dayOfWeek,
      weekNumber: body.weekNumber ?? null,
      scopeCategory: body.scopeCategory ?? null,
      productId: Number(body.productId),
      quantity: String(Number(body.quantity) || 1),
      unitPrice:
        body.unitPrice != null && body.unitPrice !== ""
          ? String(body.unitPrice)
          : null,
      averageCost:
        body.averageCost != null && body.averageCost !== ""
          ? String(body.averageCost)
          : null,
      observation: body.observation ?? null,
    } as unknown as InsertContractScope;
    return this.repo.createScope(payload);
  }

  updateScope(
    scopeId: number,
    companyId: number,
    body: any,
  ): Promise<ContractScope> {
    const updates: any = {};
    if (body.dayOfWeek !== undefined) updates.dayOfWeek = body.dayOfWeek;
    if (body.weekNumber !== undefined) updates.weekNumber = body.weekNumber ?? null;
    if (body.scopeCategory !== undefined)
      updates.scopeCategory = body.scopeCategory ?? null;
    if (body.productId !== undefined) updates.productId = Number(body.productId);
    if (body.quantity !== undefined) updates.quantity = String(Number(body.quantity) || 1);
    if (body.unitPrice !== undefined)
      updates.unitPrice = body.unitPrice != null ? String(body.unitPrice) : null;
    if (body.averageCost !== undefined)
      updates.averageCost = body.averageCost != null ? String(body.averageCost) : null;
    if (body.observation !== undefined)
      updates.observation = body.observation ?? null;
    return this.repo.updateScope(scopeId, companyId, updates);
  }

  deleteScope(scopeId: number, companyId: number): Promise<void> {
    return this.repo.deleteScope(scopeId, companyId);
  }

  // ── Contract Management ────────────────────────────────────────────────
  async updateContractInfo(
    companyId: number,
    body: {
      contractStartDate?: string | null;
      contractEndDate?: string | null;
      contractVigencia?: string | null;
    },
    userId: number,
  ): Promise<Company> {
    const updated = await this.repo.update(companyId, body as Partial<InsertCompany>);
    await this.repo.log({
      action: "CONTRACT_INFO_UPDATED",
      description: `Vigência contratual atualizada para empresa ID ${companyId}`,
      userId,
      userRole: "ADMIN",
      level: "INFO",
    } as any);
    return updated;
  }

  listAdjustments(companyId: number): Promise<ContractAdjustment[]> {
    return this.repo.listAdjustments(companyId);
  }

  async createAdjustment(
    companyId: number,
    body: any,
    userId: number,
  ): Promise<ContractAdjustment> {
    const user = await storage.getUser(userId);
    const adj = await this.repo.createAdjustment({
      ...body,
      companyId,
      responsibleUserId: userId,
      responsibleEmail: user?.email ?? null,
    } as InsertContractAdjustment);

    if (body.newWeeklyValue) {
      await this.repo.update(companyId, {
        minWeeklyBilling: body.newWeeklyValue,
      } as Partial<InsertCompany>);
    }

    await this.repo.log({
      action: "CONTRACT_ADJUSTMENT_CREATED",
      description: `Reajuste de ${body.adjustmentPercentage}% criado para empresa ID ${companyId} por ${user?.email}`,
      userId,
      userEmail: user?.email ?? undefined,
      userRole: "ADMIN",
      level: "INFO",
    } as any);

    return adj;
  }

  updateAdjustment(
    adjId: number,
    companyId: number,
    body: Partial<InsertContractAdjustment>,
  ): Promise<ContractAdjustment> {
    return this.repo.updateAdjustment(adjId, companyId, body);
  }

  /**
   * Sends the contract-adjustment email and stamps `emailSentAt`.
   * Mirrors the legacy implementation 1:1 (subject/body fallback included).
   */
  async sendAdjustmentEmail(
    companyId: number,
    adjId: number,
    body: { emailSubject?: string; emailBody?: string },
    userId: number,
  ): Promise<{ sent: true }> {
    const company = await this.repo.get(companyId);
    if (!company) throw new NotFoundError("Empresa não encontrada");
    const adj = await this.repo.getAdjustment(adjId);
    if (!adj) throw new NotFoundError("Reajuste não encontrado");

    const smtpConfig = await storage.getSmtpConfig();
    if (!smtpConfig?.host) throw new BadRequestError("SMTP não configurado");

    const targetEmail = (company as any).notificationEmail || company.email;

    const nodemailer = await import("nodemailer");
    const transporter = nodemailer.createTransport({
      host: smtpConfig.host,
      port: smtpConfig.port || 587,
      secure: smtpConfig.port === 465,
      auth: { user: smtpConfig.user, pass: smtpConfig.password },
    });

    await transporter.sendMail({
      from: `"${smtpConfig.senderName || "VivaFrutaz"}" <${
        smtpConfig.senderEmail || smtpConfig.user
      }>`,
      to: targetEmail,
      subject: body.emailSubject || "Atualização Contratual VivaFrutaz",
      text:
        body.emailBody ||
        `Olá,\n\nConforme previsto em contrato, estamos aplicando o reajuste anual baseado no índice IPCA.\n\nAtenciosamente\nEquipe VivaFrutaz`,
    });

    await this.repo.updateAdjustment(adj.id, companyId, {
      emailSentAt: new Date(),
    } as any);

    const user = await storage.getUser(userId);
    await this.repo.log({
      action: "CONTRACT_EMAIL_SENT",
      description: `Email de reajuste contratual enviado para ${targetEmail} (empresa ${company.companyName})`,
      userId,
      userEmail: user?.email ?? undefined,
      userRole: "ADMIN",
      level: "INFO",
    } as any);

    return { sent: true };
  }

  /**
   * Reuse the idempotent recurring occurrence pipeline. The administrative
   * endpoint must not materialize a second, untracked copy from contract scopes.
   */
  async generateOrdersFromScope(companyId: number) {
    const company = await this.repo.get(companyId);
    if (!company) throw new NotFoundError("Empresa não encontrada");
    if ((company as any).clientType !== "contratual") {
      throw new BadRequestError("Empresa não é do tipo contratual");
    }
    const scopes = await this.repo.listScopes(companyId);
    if (!scopes.length) {
      throw new BadRequestError(
        "Escopo contratual vazio. Adicione itens ao escopo primeiro.",
      );
    }
    const result = await runRecurringOrdersCron({ companyId });
    if (result.errors > 0) {
      throw new BadRequestError("Uma ou mais ocorrências não puderam ser materializadas. Revise os logs de pendência.");
    }
    return { created: result.created, orders: result.orders, weekLabel: result.weekLabel };
  }

  // ── Company Addresses ──────────────────────────────────────────────────
  listAddresses(companyId: number): Promise<CompanyAddress[]> {
    return this.repo.listAddresses(companyId);
  }

  createAddress(
    companyId: number,
    body: Omit<InsertCompanyAddress, "companyId">,
  ): Promise<CompanyAddress> {
    return this.repo.createAddress({ ...body, companyId } as InsertCompanyAddress);
  }

  updateAddress(
    addressId: number,
    companyId: number,
    body: Partial<InsertCompanyAddress>,
  ): Promise<CompanyAddress> {
    return this.repo.updateAddress(addressId, companyId, body);
  }

  deleteAddress(addressId: number, companyId: number): Promise<void> {
    return this.repo.deleteAddress(addressId, companyId);
  }

  setPrimaryAddress(
    companyId: number,
    addressId: number,
  ): Promise<{ primary: true }> {
    return this.repo.setPrimaryAddress(companyId, addressId).then(() => ({
      primary: true as const,
    }));
  }

  // ── GPS ────────────────────────────────────────────────────────────────
  async gpsStatus(companyId: number): Promise<GpsStatus> {
    const [cfg, assinaturas, planos] = await Promise.all([
      this.repo.getEmpresaConfig(companyId),
      storage.getAssinaturas(),
      storage.getPlanos(),
    ]);
    const assinatura = assinaturas.find(
      (a: any) => a.companyId === companyId && a.status === "ativa",
    );
    const plano = assinatura
      ? planos.find((p: any) => p.id === assinatura.planoId)
      : null;
    const gpsViaPlano = (plano as any)?.gpsHabilitado ?? false;
    const gpsManualOverride = (cfg as any)?.gpsManualOverride ?? false;
    const gpsAtivo = gpsViaPlano || gpsManualOverride;
    return {
      companyId,
      gpsAtivo,
      gpsViaPlano,
      gpsManualOverride,
      plano: plano
        ? {
            id: (plano as any).id,
            nome: (plano as any).nome,
            tipoPlano: (plano as any).tipoPlano,
          }
        : null,
    };
  }

  async gpsToggle(
    companyId: number,
    enabled: boolean,
    actingUserId: number,
  ): Promise<{ gpsManualOverride: boolean }> {
    // Role gate preserved from the legacy handler: GPS override is reserved
    // for top-level operators. Pinned tenants (company portal) cannot toggle
    // their own GPS override — a paid plan must be purchased instead.
    const actor = await storage.getUser(actingUserId);
    if (!actor || !["MASTER", "ADMIN", "DIRECTOR"].includes(actor.role)) {
      throw new ForbiddenError("Acesso negado");
    }
    const cfg = await this.repo.upsertEmpresaConfig(companyId, {
      gpsManualOverride: enabled,
    });
    return { gpsManualOverride: (cfg as any).gpsManualOverride ?? false };
  }
}

export const companiesService = new CompaniesService();
