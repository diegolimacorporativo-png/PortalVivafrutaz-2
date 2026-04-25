/**
 * InventoryController — thin HTTP adapter over InventoryService.
 *
 * BACKWARD-COMPAT NOTE — auth model:
 * The legacy `/api/inventory/*` endpoints in `server/routes/routes.ts` all
 * use the SAME, simplest gate: `if (!session.userId) return 401 { message:
 * "Não autorizado" }`. We reproduce that here per-handler (no router-wide
 * middleware) so the response shape and message stay bit-for-bit identical
 * with the legacy implementation.
 *
 * Error mapping mirrors the legacy try/catch blocks verbatim:
 *   - BadRequestError    → 400 { message }
 *   - NotFoundError      → 404 { message }
 *   - any other throw    → 500 { message: "<legacy fallback string>" }
 */
import type { Request, Response } from "express";
import { AppError } from "../../shared/errors/AppError";
import { InventoryService, inventoryService } from "./inventory.service";
import type { InventorySession } from "./inventory.types";

export class InventoryController {
  constructor(
    private readonly service: InventoryService = inventoryService,
  ) {}

  /** Mirrors the inline `if (!session.userId)` check used by every legacy handler. */
  private requireSession(req: Request, res: Response): InventorySession | null {
    const session = (req as any).session;
    if (!session?.userId) {
      res.status(401).json({ message: "Não autorizado" });
      return null;
    }
    return { userId: session.userId, userName: session.userName };
  }

  // ── GET /api/inventory/settings ────────────────────────────────────────
  listSettings = async (req: Request, res: Response) => {
    if (!this.requireSession(req, res)) return;
    const settings = await this.service.listSettings();
    res.json(settings);
  };

  // ── PUT /api/inventory/settings/:id ────────────────────────────────────
  updateSetting = async (req: Request, res: Response) => {
    if (!this.requireSession(req, res)) return;
    try {
      const id = parseInt(req.params.id as string);
      const updated = await this.service.updateSetting(id, req.body);
      res.json(updated);
    } catch (e) {
      if (e instanceof AppError) {
        return res.status(e.status).json({ message: e.message });
      }
      throw e;
    }
  };

  // ── POST /api/inventory/settings ───────────────────────────────────────
  createSetting = async (req: Request, res: Response) => {
    if (!this.requireSession(req, res)) return;
    try {
      const result = await this.service.createSetting(req.body);
      res.json(result);
    } catch (e) {
      if (e instanceof AppError) {
        return res.status(e.status).json({ message: e.message });
      }
      throw e;
    }
  };

  // ── GET /api/inventory/entries ─────────────────────────────────────────
  listEntries = async (req: Request, res: Response) => {
    if (!this.requireSession(req, res)) return;
    const { from, to } = req.query as Record<string, string>;
    const entries = await this.service.listEntries({ from, to });
    res.json(entries);
  };

  // ── POST /api/inventory/entries ────────────────────────────────────────
  createEntry = async (req: Request, res: Response) => {
    const session = this.requireSession(req, res);
    if (!session) return;
    try {
      const entry = await this.service.createEntry(req.body, session);
      res.json(entry);
    } catch (e: any) {
      if (e instanceof AppError) {
        return res.status(e.status).json({ message: e.message });
      }
      // Legacy fallback — see routes.ts line ~3343.
      console.warn('[inventory.controller] createEntry failed', e);
      res.status(500).json({ message: "Erro ao registrar entrada" });
    }
  };

  // ── DELETE /api/inventory/entries/:id ──────────────────────────────────
  deleteEntry = async (req: Request, res: Response) => {
    if (!this.requireSession(req, res)) return;
    await this.service.deleteEntry(parseInt(req.params.id as string));
    res.json({ ok: true });
  };

  // ── GET /api/inventory/movements ───────────────────────────────────────
  listMovements = async (req: Request, res: Response) => {
    if (!this.requireSession(req, res)) return;
    const { from, to, productId } = req.query as Record<string, string>;
    const movements = await this.service.listMovements({
      from,
      to,
      productId: productId ? parseInt(productId) : undefined,
    });
    res.json(movements);
  };

  // ── GET /api/inventory/physical-counts ─────────────────────────────────
  listPhysicalCounts = async (req: Request, res: Response) => {
    if (!this.requireSession(req, res)) return;
    res.json(await this.service.listPhysicalCounts());
  };

  // ── POST /api/inventory/physical-counts ────────────────────────────────
  createPhysicalCount = async (req: Request, res: Response) => {
    const session = this.requireSession(req, res);
    if (!session) return;
    try {
      const count = await this.service.createPhysicalCount(req.body, session);
      res.json(count);
    } catch (e: any) {
      if (e instanceof AppError) {
        return res.status(e.status).json({ message: e.message });
      }
      // Legacy fallback — see routes.ts line ~3414.
      console.warn('[inventory.controller] createPhysicalCount failed', e);
      res.status(500).json({ message: "Erro ao registrar contagem física" });
    }
  };
}

export const inventoryController = new InventoryController();
