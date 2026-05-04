import type { Request, Response } from "express";
import {
  companiesService,
  CompaniesService,
} from "./companies.service";
import { ok, created, noContent } from "../../core/http/apiResponse";
import { UnauthorizedError } from "../../shared/errors/AppError";

/**
 * CompaniesController — thin HTTP adapter.
 *
 * Architecture decision: controllers do three things and nothing else:
 *   1. Pull pre-validated input out of `req` (validation already happened).
 *   2. Call the service.
 *   3. Shape the response via apiResponse helpers.
 * No business logic, no DB calls, no Zod, no try/catch (asyncHandler does it).
 */
export class CompaniesController {
  constructor(
    private readonly service: CompaniesService = companiesService,
  ) {}

  private getUserId(req: Request): number {
    const userId = (req as any).userId ?? (req as any).session?.userId;
    if (!userId) throw new UnauthorizedError();
    return userId;
  }

  // ── Companies CRUD ─────────────────────────────────────────────────────
  list = async (req: Request, res: Response) => {
    const result = await this.service.list();
    console.log("[COMPANIES_LIST]", {
      userId: (req as any).session?.userId,
      role: (req as any).session?.role ?? (req as any).user?.role,
      tenant: (req as any).empresaId ?? null,
      total: result.length,
    });
    return ok(res, result);
  };

  get = async (req: Request, res: Response) => {
    const id = Number((req.params as any).id);
    return ok(res, await this.service.get(id));
  };

  create = async (req: Request, res: Response) => {
    console.warn("[CREATE_COMPANY_BACKEND]", {
      userId: (req as any).session?.userId,
      role: (req as any).session?.role ?? (req as any).user?.role,
      body: req.body,
    });
    return created(res, await this.service.create(req.body));
  };

  update = async (req: Request, res: Response) => {
    const id = Number((req.params as any).id);
    return ok(res, await this.service.update(id, req.body));
  };

  remove = async (req: Request, res: Response) => {
    const id = Number((req.params as any).id);
    await this.service.delete(id);
    return noContent(res);
  };

  // ── /my/preferred-order-type ───────────────────────────────────────────
  updatePreferredOrderType = async (req: Request, res: Response) => {
    const companyId = (req as any).session?.companyId;
    if (!companyId) throw new UnauthorizedError();
    const out = await this.service.updatePreferredOrderType(
      companyId,
      (req.body as any).preferredOrderType,
    );
    return ok(res, out);
  };

  // ── /delivery-suggestions ──────────────────────────────────────────────
  deliverySuggestions = async (req: Request, res: Response) => {
    const city = (req.query as any).city as string | undefined;
    return ok(res, await this.service.deliverySuggestions(city));
  };

  // ── Contract scopes ────────────────────────────────────────────────────
  listScopes = async (req: Request, res: Response) => {
    const id = Number((req.params as any).id);
    return ok(res, await this.service.listScopes(id));
  };

  createScope = async (req: Request, res: Response) => {
    const id = Number((req.params as any).id);
    return created(res, await this.service.createScope(id, req.body));
  };

  updateScope = async (req: Request, res: Response) => {
    const id = Number((req.params as any).id);
    const scopeId = Number((req.params as any).scopeId);
    return ok(res, await this.service.updateScope(scopeId, id, req.body));
  };

  deleteScope = async (req: Request, res: Response) => {
    const id = Number((req.params as any).id);
    const scopeId = Number((req.params as any).scopeId);
    await this.service.deleteScope(scopeId, id);
    return noContent(res);
  };

  // ── Contract management ────────────────────────────────────────────────
  updateContractInfo = async (req: Request, res: Response) => {
    const id = Number((req.params as any).id);
    const userId = this.getUserId(req);
    return ok(res, await this.service.updateContractInfo(id, req.body, userId));
  };

  listAdjustments = async (req: Request, res: Response) => {
    const id = Number((req.params as any).id);
    return ok(res, await this.service.listAdjustments(id));
  };

  createAdjustment = async (req: Request, res: Response) => {
    const id = Number((req.params as any).id);
    const userId = this.getUserId(req);
    return created(
      res,
      await this.service.createAdjustment(id, req.body, userId),
    );
  };

  updateAdjustment = async (req: Request, res: Response) => {
    const id = Number((req.params as any).id);
    const adjId = Number((req.params as any).adjId);
    return ok(res, await this.service.updateAdjustment(adjId, id, req.body));
  };

  sendAdjustmentEmail = async (req: Request, res: Response) => {
    const id = Number((req.params as any).id);
    const adjId = Number((req.params as any).adjId);
    const userId = this.getUserId(req);
    return ok(
      res,
      await this.service.sendAdjustmentEmail(id, adjId, req.body, userId),
    );
  };

  // ── generate-orders-from-scope ─────────────────────────────────────────
  generateOrdersFromScope = async (req: Request, res: Response) => {
    const id = Number((req.params as any).id);
    return ok(res, await this.service.generateOrdersFromScope(id));
  };

  // ── Company addresses ──────────────────────────────────────────────────
  listAddresses = async (req: Request, res: Response) => {
    const id = Number((req.params as any).id);
    return ok(res, await this.service.listAddresses(id));
  };

  createAddress = async (req: Request, res: Response) => {
    const id = Number((req.params as any).id);
    return created(res, await this.service.createAddress(id, req.body));
  };

  updateAddress = async (req: Request, res: Response) => {
    const companyId = Number((req.params as any).companyId);
    const addrId = Number((req.params as any).addrId);
    return ok(
      res,
      await this.service.updateAddress(addrId, companyId, req.body),
    );
  };

  deleteAddress = async (req: Request, res: Response) => {
    const companyId = Number((req.params as any).companyId);
    const addrId = Number((req.params as any).addrId);
    await this.service.deleteAddress(addrId, companyId);
    return noContent(res);
  };

  setPrimaryAddress = async (req: Request, res: Response) => {
    const companyId = Number((req.params as any).companyId);
    const addrId = Number((req.params as any).addrId);
    return ok(res, await this.service.setPrimaryAddress(companyId, addrId));
  };

  // ── GPS ────────────────────────────────────────────────────────────────
  gpsStatus = async (req: Request, res: Response) => {
    const id = Number((req.params as any).id);
    return ok(res, await this.service.gpsStatus(id));
  };

  gpsToggle = async (req: Request, res: Response) => {
    const id = Number((req.params as any).id);
    const userId = this.getUserId(req);
    return ok(
      res,
      await this.service.gpsToggle(id, (req.body as any).enabled, userId),
    );
  };
}

export const companiesController = new CompaniesController();
