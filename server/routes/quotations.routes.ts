import type { Express } from "express";
import { storage } from "../services/storage.ts";
import { requireAuth as requireAuthCore } from "../core/http/requireAuth";
import {
  canDeleteQuotations,
  hasQuotationTenantOverride,
  resolveQuotationScope,
  sanitizeQuotationCreateBody,
  sanitizeQuotationUpdateBody,
} from "../modules/quotations/quotations.policy";

const QUOTATION_STATUSES = new Set([
  "PENDING",
  "IN_ANALYSIS",
  "APPROVED",
  "REJECTED",
  "HORARIOS_DISPONIVEIS",
]);

function parseQuotationId(value: unknown): number | null {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function parseDate(value: unknown): Date | undefined {
  if (value == null || value === "") return undefined;
  const date = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(date.getTime())) return undefined;
  return date;
}

export function register(app: Express) {
  app.get('/api/quotations', requireAuthCore, async (req, res) => {
    const user = await storage.getUser(req.session.userId!);
    if (!user) return res.status(403).json({ message: 'Sem permissão' });
    const scope = resolveQuotationScope(user);
    if (!scope) return res.status(403).json({ message: 'Sem permissão' });
    try { res.json(await storage.getQuotations(scope)); } catch (e) { res.status(500).json({ message: 'Erro' }); }
  });

  app.post('/api/quotations', requireAuthCore, async (req, res) => {
    const user = await storage.getUser(req.session.userId!);
    if (!user) return res.status(403).json({ message: 'Sem permissão' });
    const scope = resolveQuotationScope(user);
    if (!scope) return res.status(403).json({ message: 'Sem permissão' });
    try {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const data = sanitizeQuotationCreateBody(body);
      if (!data.companyName || !data.contactName) {
        return res.status(400).json({ message: 'Empresa e contato obrigatórios' });
      }
      if (data.status != null && !QUOTATION_STATUSES.has(String(data.status))) {
        return res.status(400).json({ message: 'Status de cotação inválido' });
      }
      if (data.deliveryWindowsRespondedAt !== undefined) {
        const parsedDate = parseDate(data.deliveryWindowsRespondedAt);
        if (data.deliveryWindowsRespondedAt !== "" && !parsedDate) {
          return res.status(400).json({ message: 'Data de resposta inválida' });
        }
        data.deliveryWindowsRespondedAt = parsedDate;
      }
      const q = await storage.createQuotation(data, scope.global ? null : scope.empresaId);
      const hasWindows = !!data.deliveryWindowsJson;
      await storage.createLog({ action: hasWindows ? 'QUOTATION_WINDOWS_SET' : 'QUOTATION_CREATED', description: hasWindows ? `Logística definiu janelas de entrega ao criar cotação: ${String(data.companyName)}` : `Cotação criada: ${String(data.companyName)}`, userId: user.id, userEmail: user.email, userRole: user.role });
      res.json(q);
    } catch (e: any) { res.status(500).json({ message: e?.message || 'Erro' }); }
  });

  app.patch('/api/quotations/:id', requireAuthCore, async (req, res) => {
    const user = await storage.getUser(req.session.userId!);
    if (!user) return res.status(403).json({ message: 'Sem permissão' });
    const scope = resolveQuotationScope(user);
    if (!scope) return res.status(403).json({ message: 'Sem permissão' });
    try {
      const id = parseQuotationId(req.params.id);
      if (id == null) return res.status(400).json({ message: 'ID inválido' });
      const body = (req.body ?? {}) as Record<string, unknown>;
      if (hasQuotationTenantOverride(body)) {
        return res.status(400).json({ message: 'Tenant da cotação não pode ser alterado' });
      }
      const data = sanitizeQuotationUpdateBody(body);
      if (data.status != null && !QUOTATION_STATUSES.has(String(data.status))) {
        return res.status(400).json({ message: 'Status de cotação inválido' });
      }
      if (data.deliveryWindowsRespondedAt !== undefined) {
        const parsedDate = parseDate(data.deliveryWindowsRespondedAt);
        if (data.deliveryWindowsRespondedAt !== "" && !parsedDate) {
          return res.status(400).json({ message: 'Data de resposta inválida' });
        }
        data.deliveryWindowsRespondedAt = parsedDate;
      }
      if (Object.keys(data).length === 0) {
        return res.status(400).json({ message: 'Nenhum campo válido para atualização' });
      }
      const q = await storage.updateQuotation(id, scope, data);
      if (!q) return res.status(404).json({ message: 'Cotação não encontrada' });
      const hasWindows = !!body.deliveryWindowsJson;
      const logDesc = hasWindows
        ? `Logística definiu janelas de entrega na cotação #${id} (${user.name || user.email})`
        : `Cotação #${id} atualizada`;
      await storage.createLog({ action: hasWindows ? 'QUOTATION_WINDOWS_SET' : 'QUOTATION_UPDATED', description: logDesc, userId: user.id, userEmail: user.email, userRole: user.role });
      res.json(q);
    } catch (e) { res.status(500).json({ message: 'Erro' }); }
  });

  app.delete('/api/quotations/:id', requireAuthCore, async (req, res) => {
    const user = await storage.getUser(req.session.userId!);
    if (!user) return res.status(403).json({ message: 'Sem permissão' });
    const scope = resolveQuotationScope(user);
    if (!scope || !canDeleteQuotations(user.role)) {
      return res.status(403).json({ message: 'Sem permissão' });
    }
    try {
      const id = parseQuotationId(req.params.id);
      if (id == null) return res.status(400).json({ message: 'ID inválido' });
      const deleted = await storage.deleteQuotation(id, scope);
      if (!deleted) return res.status(404).json({ message: 'Cotação não encontrada' });
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ message: 'Erro' }); }
  });
}
