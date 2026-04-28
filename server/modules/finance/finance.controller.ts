import type { Request, Response } from "express";
import { financeService, FinanceService } from "./finance.service";
import { ok, created, noContent } from "../../core/http/apiResponse";
import { UnauthorizedError } from "../../shared/errors/AppError";

/**
 * FinanceController — thin HTTP adapter.
 *
 * Architecture decision: controllers do three things and nothing else:
 *   1. Pull pre-validated input out of `req` (validation already happened).
 *   2. Call the service.
 *   3. Shape the response via apiResponse helpers.
 * No business logic, no DB calls, no Zod, no try/catch (asyncHandler does it).
 */
export class FinanceController {
  constructor(private readonly service: FinanceService = financeService) {}

  private getUserId(req: Request): number {
    const userId = (req as any).userId ?? (req as any).session?.userId;
    if (!userId) throw new UnauthorizedError();
    return userId;
  }

  // ── Dashboard ──────────────────────────────────────────────────────────
  getDashboard = async (_req: Request, res: Response) => {
    return ok(res, await this.service.getDashboard());
  };

  // FASE NF.7.5 — handler thin: leitura pura, sem efeitos colaterais.
  getNfeResumoPorUF = async (_req: Request, res: Response) => {
    return ok(res, await this.service.getNfeResumoPorUF());
  };

  // FASE NF.7.6 — handler thin: leitura pura agrupada por status fiscal.
  getNfeResumoPorStatus = async (_req: Request, res: Response) => {
    return ok(res, await this.service.getNfeResumoPorStatus());
  };

  // FASE FISCAL 7.9 — handler thin: motivos de rejeição com vínculo ao pedido.
  getNfeMotivosRejeicao = async (_req: Request, res: Response) => {
    return ok(res, await this.service.getNfeMotivosRejeicao());
  };

  // ── Accounts Receivable ────────────────────────────────────────────────
  listAccountsReceivable = async (req: Request, res: Response) => {
    return ok(res, await this.service.listAccountsReceivable(req.query as any));
  };

  createAccountReceivable = async (req: Request, res: Response) => {
    const userId = this.getUserId(req);
    return created(res, await this.service.createAccountReceivable(req.body, userId));
  };

  updateAccountReceivable = async (req: Request, res: Response) => {
    const id = Number((req.params as any).id);
    return ok(res, await this.service.updateAccountReceivable(id, req.body));
  };

  payAccountReceivable = async (req: Request, res: Response) => {
    const userId = this.getUserId(req);
    const id = Number((req.params as any).id);
    return ok(res, await this.service.payAccountReceivable(id, userId));
  };

  deleteAccountReceivable = async (req: Request, res: Response) => {
    const id = Number((req.params as any).id);
    await this.service.deleteAccountReceivable(id);
    return noContent(res);
  };

  getPixForReceivable = async (req: Request, res: Response) => {
    const id = Number((req.params as any).id);
    return ok(res, await this.service.getPixForReceivable(id));
  };

  // FASE 6.5 — handler thin: id já validado pela validação de rota.
  getReceivableBreakdown = async (req: Request, res: Response) => {
    const id = Number((req.params as any).id);
    return ok(res, await this.service.getReceivableBreakdown(id));
  };

  // ── Accounts Payable ───────────────────────────────────────────────────
  listAccountsPayable = async (req: Request, res: Response) => {
    return ok(res, await this.service.listAccountsPayable(req.query as any));
  };

  createAccountPayable = async (req: Request, res: Response) => {
    const userId = this.getUserId(req);
    return created(res, await this.service.createAccountPayable(req.body, userId));
  };

  updateAccountPayable = async (req: Request, res: Response) => {
    const id = Number((req.params as any).id);
    return ok(res, await this.service.updateAccountPayable(id, req.body));
  };

  payAccountPayable = async (req: Request, res: Response) => {
    const userId = this.getUserId(req);
    const id = Number((req.params as any).id);
    return ok(res, await this.service.payAccountPayable(id, userId));
  };

  deleteAccountPayable = async (req: Request, res: Response) => {
    const id = Number((req.params as any).id);
    await this.service.deleteAccountPayable(id);
    return noContent(res);
  };

  // ── Cashflow ───────────────────────────────────────────────────────────
  listCashflow = async (req: Request, res: Response) => {
    return ok(res, await this.service.listCashflow(req.query as any));
  };

  createCashflowEntry = async (req: Request, res: Response) => {
    return created(res, await this.service.createManualCashflowEntry(req.body));
  };
}

export const financeController = new FinanceController();
