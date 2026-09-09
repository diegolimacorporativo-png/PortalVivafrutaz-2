import type { Express } from "express";
import { storage } from "../services/storage.ts";
import { sendSpecialOrderResolved } from "../services/mailer";
import { requireAuth as requireAuthCore } from "../core/http/requireAuth";
import { requireRole } from "../core/http/requireAuth";
import { requireSessionOrCompany } from "../core/http/requireSessionOrCompany";
import { tenantContext } from "../middleware/tenant";
import { currentTenantId, runWithTenant } from "../core/tenant/context";
import { ordersService } from "../modules/orders/orders.service";
import { productService } from "../modules/products/products.service";
import { resolveProductPrice } from "../modules/products/utils/priceResolver";
import {
  SPECIAL_ORDER_MANAGE_ROLES,
  SPECIAL_ORDER_VIEW_ROLES,
  resolveSpecialOrderCreationCompanyId,
  resolveSpecialOrderScope,
} from "../modules/special-orders/special-order-requests.policy";

const SPECIAL_ORDER_SESSION_MIDDLEWARE = [requireSessionOrCompany, tenantContext] as const;
const SPECIAL_ORDER_ADMIN_MIDDLEWARE = [
  requireAuthCore,
  requireRole([...SPECIAL_ORDER_VIEW_ROLES], { strict: true }),
  tenantContext,
] as const;
const SPECIAL_ORDER_MANAGER_MIDDLEWARE = [
  requireAuthCore,
  requireRole([...SPECIAL_ORDER_MANAGE_ROLES], { strict: true }),
  tenantContext,
] as const;

function isoWeekReference(dateValue: string): string {
  const date = new Date(`${dateValue}T12:00:00Z`);
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((date.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

function parseSpecialOrderId(value: unknown): number | null {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

async function resolveSpecialOrderRequest(
  req: any,
  res: any,
  allowedRoles: readonly string[] = SPECIAL_ORDER_VIEW_ROLES,
) {
  const session = req.session;
  const user = session?.userId ? await storage.getUser(session.userId) : null;

  if (session?.companyId) {
    const scope = resolveSpecialOrderScope(
      { sessionCompanyId: session.companyId, tenantId: currentTenantId() },
      allowedRoles,
    );
    if (scope) return { scope, user: null };
    res.status(403).json({ message: "Empresa não definida para esta sessão" });
    return null;
  }

  if (!user || !allowedRoles.includes(user.role)) {
    res.status(403).json({ message: "Sem permissão" });
    return null;
  }

  const scope = resolveSpecialOrderScope(
    {
      tenantId: currentTenantId(),
      userEmpresaId: user.empresaId,
      role: user.role,
    },
    allowedRoles,
  );
  if (!scope) {
    res.status(403).json({ message: "Empresa não definida para este usuário" });
    return null;
  }

  return { scope, user };
}

export function register(app: Express) {
  // Client: submit special order — an authenticated company session is required.
  app.post('/api/special-order-requests', ...SPECIAL_ORDER_SESSION_MIDDLEWARE, async (req, res) => {
    try {
      if (!req.session?.companyId) return res.status(403).json({ message: "Apenas sessões de empresa podem criar solicitações." });
      const { companyId: requestedCompanyId, requestedDay, requestedDate, description, quantity, observations, items } = req.body ?? {};
      const companyId = resolveSpecialOrderCreationCompanyId(req.session.companyId, requestedCompanyId);
      if (!companyId) return res.status(403).json({ message: "Empresa da sessão não encontrada." });
      if (!requestedDay) return res.status(400).json({ message: "Dia desejado é obrigatório." });
      if (Array.isArray(items) && items.length > 0) {
        for (const it of items) {
          if (!it.productName?.trim()) return res.status(400).json({ message: "Nome do produto é obrigatório." });
          if (!it.quantity?.trim()) return res.status(400).json({ message: "Quantidade do produto é obrigatória." });
          if (!it.category) return res.status(400).json({ message: "Categoria do produto é obrigatória." });
        }
      }
      const descFinal = description || (Array.isArray(items) && items.length ? items.map((i: any) => i.productName).join(', ') : 'Pedido pontual');
      const qtyFinal = quantity || (Array.isArray(items) && items.length ? items.map((i: any) => i.quantity).join(', ') : '1');
      const req2 = await storage.createSpecialOrderRequest({
        companyId: Number(companyId), requestedDay,
        requestedDate: requestedDate || null,
        description: descFinal, quantity: qtyFinal,
        observations: observations || null,
        items: Array.isArray(items) && items.length ? items : null,
        estimatedDeliveryDate: null,
      });
      res.status(201).json(req2);
    } catch (e: any) {
      console.error('[POST /api/special-order-requests]', e);
      res.status(500).json({ message: e?.message || "Erro interno ao salvar pedido pontual." });
    }
  });

  // Client: list own requests — company portal session only
  app.get('/api/special-order-requests/company/:companyId', ...SPECIAL_ORDER_SESSION_MIDDLEWARE, async (req, res) => {
    try {
      if (!req.session?.companyId) return res.status(403).json({ message: "Apenas sessões de empresa podem consultar solicitações." });
      const companyId = parseSpecialOrderId(req.params.companyId);
      if (!companyId || companyId !== Number(currentTenantId())) {
        return res.status(404).json({ message: 'Solicitações não encontradas' });
      }
      const items = await storage.getSpecialOrderRequestsByCompany(companyId);
      res.json(items);
    } catch { res.status(500).json({ message: "Erro interno" }); }
  });

  // Admin: list own tenant or all for an explicitly global role.
  app.get('/api/special-order-requests', ...SPECIAL_ORDER_ADMIN_MIDDLEWARE, async (req, res) => {
    try {
      const request = await resolveSpecialOrderRequest(req, res);
      if (!request) return;
      const items = request.scope.companyId == null
        ? await storage.getSpecialOrderRequests()
        : await storage.getSpecialOrderRequestsByCompany(request.scope.companyId);
      res.json(items);
    } catch { res.status(500).json({ message: "Erro interno" }); }
  });

  // Admin: approve/reject — admin users only
  app.put('/api/special-order-requests/:id', ...SPECIAL_ORDER_MANAGER_MIDDLEWARE, async (req, res) => {
    try {
      const request = await resolveSpecialOrderRequest(req, res, SPECIAL_ORDER_MANAGE_ROLES);
      if (!request) return;
      const actingUser = request.user!;
      const id = parseSpecialOrderId(req.params.id);
      if (!id) return res.status(404).json({ message: 'Solicitação não encontrada' });
      const { status, adminNote, items, estimatedDeliveryDate } = req.body ?? {};
      if (!status || !['APPROVED', 'REJECTED'].includes(status)) return res.status(400).json({ message: 'Status inválido.' });
      if (status === 'REJECTED' && !adminNote?.trim()) return res.status(400).json({ message: 'Informe o motivo da recusa.' });
      const sr = request.scope.companyId == null
        ? await storage.getSpecialOrderRequest(id)
        : await storage.getSpecialOrderRequestForCompany(id, request.scope.companyId);
      if (!sr) return res.status(404).json({ message: 'Solicitação não encontrada' });
      let generatedOrder: any = null;
      let finalAdminNote = adminNote;

      // Catalog items become a regular order only after the administrator
      // approves the special request. This makes them visible to the normal
      // programming/production flow while keeping external products manual.
      if (status === "APPROVED") {
         const approvedItems: any[] = Array.isArray(items) ? items : (Array.isArray(sr?.items) ? sr.items : []);
         const catalogItems = approvedItems.filter((item) => item.productType === "catalog");
         if (catalogItems.length > 0) {
           const requestedDate = sr?.requestedDate;
           if (!requestedDate) {
             return res.status(400).json({ message: "A data solicitada é obrigatória para enviar o produto à programação." });
           }

           const company = await storage.getCompany(sr.companyId);
           const companyProducts = await productService.listProductsForCompany(company?.priceGroupId);
           const orderItems = catalogItems.map((item) => {
             const product = companyProducts.find((candidate: any) => Number(candidate.id) === Number(item.productId));
             if (!product || product.active === false) {
               throw new Error(`Produto do catálogo não encontrado ou inativo: ${item.productName || item.productId}`);
             }

             const subCategory = item.subCategoryId
               ? (product as any).subCategories?.find((candidate: any) => Number(candidate.id) === Number(item.subCategoryId))
               : undefined;
             const quantity = Number(item.approvedQuantity ?? item.quantity);
             if (!Number.isInteger(quantity) || quantity <= 0) {
               throw new Error(`Quantidade inválida para ${product.name}. Informe um número inteiro maior que zero.`);
             }

             const unitPrice = resolveProductPrice({
               basePrice: Number((product as any).basePrice ?? 0),
               subCategoryPrice: subCategory ? Number(subCategory.price) : null,
               contractPrice: (product as any).contractPrice != null ? Number((product as any).contractPrice) : null,
               adminFee: company?.useNewPricing ? Number(company.adminFee ?? 0) : 0,
             });
             if (unitPrice <= 0) throw new Error(`O produto ${product.name} não possui preço válido.`);

             return {
               productId: product.id,
               quantity,
               unitPrice: unitPrice.toFixed(2),
               totalPrice: (unitPrice * quantity).toFixed(2),
               subCategoryId: subCategory?.id ?? null,
               subCategoryName: subCategory?.categoryName ?? null,
             };
           });

           generatedOrder = await runWithTenant(
             {
               principal: { kind: "admin", empresaId: sr.companyId, userId: req.session.userId!, role: actingUser.role },
               empresaId: sr.companyId,
             },
             () => ordersService.createInternal(
               {
                 companyId: sr.companyId,
                 deliveryDate: new Date(`${requestedDate}T12:00:00`),
                 weekReference: isoWeekReference(requestedDate),
                 workflowStatus: "CREATED",
                 status: "CONFIRMED",
                 orderNote: `Gerado a partir do Pedido Pontual PP-${String(sr.id).padStart(6, "0")}${sr.observations ? ` — ${sr.observations}` : ""}`,
                 allowReplication: false,
                 isRecurring: false,
               },
               orderItems,
               { source: "special-order-approval", actorRole: actingUser.role },
             ),
           );
           finalAdminNote = `${adminNote || "Pedido pontual aprovado!"} Pedido encaminhado à programação (${generatedOrder.orderCode}).`;
         }
       }

      const updated = request.scope.companyId == null
        ? await storage.updateSpecialOrderRequest(id, {
            status, adminNote: finalAdminNote, resolvedAt: new Date(),
            ...(items !== undefined ? { items } : {}),
            ...(estimatedDeliveryDate !== undefined ? { estimatedDeliveryDate } : {}),
          } as any)
        : await storage.updateSpecialOrderRequestForCompany(id, request.scope.companyId, {
            status, adminNote: finalAdminNote, resolvedAt: new Date(),
            ...(items !== undefined ? { items } : {}),
            ...(estimatedDeliveryDate !== undefined ? { estimatedDeliveryDate } : {}),
          } as any);
      if (!updated) return res.status(404).json({ message: 'Solicitação não encontrada' });
      res.json({ ...updated, generatedOrder });

      // Send email (non-blocking)
      if (sr && (status === 'APPROVED' || status === 'REJECTED')) {
        try {
          const company = await storage.getCompany(sr.companyId);
          if (company) {
            await sendSpecialOrderResolved({
              toEmail: company.email,
              companyName: company.companyName,
              requestedDay: sr.requestedDay || "—",
              status,
              adminNote: finalAdminNote,
            });
          }
        } catch (emailErr) {
          console.error("[EMAIL] Erro ao enviar email de pedido pontual:", emailErr);
        }
      }
    } catch { res.status(500).json({ message: "Erro interno" }); }
  });
}
