import type { Express } from "express";
import { storage } from "../services/storage.ts";
import { sendSpecialOrderResolved } from "../services/mailer";
import { validateCompanyTenant } from "../core/security/orderSecurity";
import { requireAuth as requireAuthCore } from "../core/http/requireAuth";
import { requireSessionOrCompany } from "../core/http/requireSessionOrCompany";
import { ordersService } from "../modules/orders/orders.service";
import { productService } from "../modules/products/products.service";
import { resolveProductPrice } from "../modules/products/utils/priceResolver";
import { runWithTenant } from "../core/tenant/context";

function isoWeekReference(dateValue: string): string {
  const date = new Date(`${dateValue}T12:00:00Z`);
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((date.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

export function register(app: Express) {
  // Client: submit special order — an authenticated company session is required.
  app.post('/api/special-order-requests', requireSessionOrCompany, async (req, res) => {
    try {
      const { companyId, requestedDay, requestedDate, description, quantity, observations, items } = req.body;
      if (!companyId) return res.status(400).json({ message: "ID da empresa é obrigatório." });
      if (req.session?.companyId && Number(req.session.companyId) !== Number(companyId)) {
        return res.status(403).json({ message: "A empresa da sessão não corresponde ao pedido." });
      }
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

  // Client: list own requests — accessible by userId OR companyId
  app.get('/api/special-order-requests/company/:companyId', requireSessionOrCompany, async (req, res) => {
    try {
      const companyId = Number(req.params.companyId);
      try {
        validateCompanyTenant(companyId, req);
      } catch {
        return res.status(403).json({ message: 'Acesso negado' });
      }
      const items = await storage.getSpecialOrderRequestsByCompany(companyId);
      res.json(items);
    } catch { res.status(500).json({ message: "Erro interno" }); }
  });

  // Admin: list all — public (no auth check, as per original)
  app.get('/api/special-order-requests', async (req, res) => {
    try {
      const items = await storage.getSpecialOrderRequests();
      res.json(items);
    } catch { res.status(500).json({ message: "Erro interno" }); }
  });

  // Admin: approve/reject — admin users only
  app.put('/api/special-order-requests/:id', requireAuthCore, async (req, res) => {
    try {
      const actingUser = await storage.getUser(req.session.userId!);
      if (!actingUser || !['MASTER', 'ADMIN', 'DIRECTOR', 'DEVELOPER'].includes(actingUser.role)) {
        return res.status(403).json({ message: 'Apenas Administrador, Diretor ou Desenvolvedor podem aprovar/recusar pedidos pontuais.' });
      }
      const id = Number(req.params.id);
      const { status, adminNote, items, estimatedDeliveryDate } = req.body;
      if (!status || !['APPROVED', 'REJECTED'].includes(status)) return res.status(400).json({ message: 'Status inválido.' });
      if (status === 'REJECTED' && !adminNote?.trim()) return res.status(400).json({ message: 'Informe o motivo da recusa.' });
      const allSpecial = await storage.getSpecialOrderRequests();
      const sr = allSpecial.find(r => r.id === id);
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

       const updated = await storage.updateSpecialOrderRequest(id, {
         status, adminNote: finalAdminNote, resolvedAt: new Date(),
        ...(items !== undefined ? { items } : {}),
        ...(estimatedDeliveryDate !== undefined ? { estimatedDeliveryDate } : {}),
      } as any);
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
