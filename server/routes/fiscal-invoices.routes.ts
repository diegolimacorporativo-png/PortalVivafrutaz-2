import type { Express } from "express";
import { storage } from "../services/storage.ts";
import { requireAuth, requireRole } from "../core/http/requireAuth";

// Roles allowed to read fiscal invoices
const READ_ROLES = ["ADMIN", "DIRECTOR", "MASTER", "DEVELOPER", "OPERATIONS_MANAGER", "FINANCEIRO", "PURCHASE_MANAGER"];
// Roles allowed to write/delete fiscal invoices
const WRITE_ROLES = ["ADMIN", "DIRECTOR", "MASTER"];

export function register(app: Express) {
  // GET /api/fiscal-invoices — list all imported invoices
  app.get('/api/fiscal-invoices', requireAuth, requireRole(READ_ROLES), async (req, res) => {
    res.json(await storage.getFiscalInvoices());
  });

  // GET /api/fiscal-invoices/check-duplicate — check if invoice number+cnpj already exists
  app.get('/api/fiscal-invoices/check-duplicate', requireAuth, requireRole(READ_ROLES), async (req, res) => {
    const { invoiceNumber, cnpj } = req.query as { invoiceNumber?: string; cnpj?: string };
    if (!invoiceNumber) return res.status(400).json({ message: 'invoiceNumber é obrigatório' });
    const isDuplicate = await storage.checkFiscalInvoiceDuplicate(invoiceNumber, cnpj);
    res.json({ isDuplicate });
  });

  // GET /api/fiscal-invoices/:id
  app.get('/api/fiscal-invoices/:id', requireAuth, requireRole(READ_ROLES), async (req, res) => {
    const invoice = await storage.getFiscalInvoiceById(Number(req.params.id));
    if (!invoice) return res.status(404).json({ message: 'Nota não encontrada' });
    res.json(invoice);
  });

  // POST /api/fiscal-invoices — confirm and save a fiscal invoice + create inventory entry
  app.post('/api/fiscal-invoices', requireAuth, requireRole(WRITE_ROLES), async (req: any, res) => {
    const userId = (req as any).userId ?? req.session?.userId;
    const { invoiceNumber, supplier, supplierCnpj, issueDate, totalValue, items, notes, fileType, fileName } = req.body;
    if (!invoiceNumber || !supplier) return res.status(400).json({ message: 'invoiceNumber e supplier são obrigatórios' });

    try {
      const duplicateKey = `${invoiceNumber}_${supplierCnpj || ''}`;
      // Check duplicate
      const isDupe = await storage.checkFiscalInvoiceDuplicate(invoiceNumber, supplierCnpj);
      if (isDupe) return res.status(409).json({ message: 'Esta nota fiscal já foi registrada no sistema.', duplicate: true });

      const invoice = await storage.createFiscalInvoice({
        invoiceNumber,
        supplier,
        supplierCnpj: supplierCnpj || null,
        issueDate: issueDate || null,
        totalValue: totalValue ? String(totalValue) : null,
        items: items || [],
        status: 'CONFIRMED',
        importedBy: userId,
        notes: notes || null,
        fileType: fileType || null,
        fileName: fileName || null,
        duplicateKey,
      });

      // Auto-create inventory entries for each item
      const itemList = Array.isArray(items) ? items : [];
      for (const item of itemList) {
        if (!item.name || !item.quantity) continue;
        try {
          await storage.createInventoryEntry({
            productId: item.linkedProductId || null,
            productName: item.linkedProductName || item.name,
            category: item.category || 'Outros',
            supplier,
            quantity: String(item.quantity),
            unit: item.unit || 'kg',
            purchasePrice: item.unitPrice ? String(item.unitPrice) : null,
            invoiceNumber,
            invoiceDate: issueDate || null,
            entryDate: new Date().toISOString().substring(0, 10),
            expiryDate: null,
            notes: `Importado da nota fiscal ${invoiceNumber}`,
            createdBy: userId ? String(userId) : 'System',
          });
        } catch (entryErr) {
          console.error('Error creating inventory entry for item:', item.name, entryErr);
        }
      }

      res.status(201).json(invoice);
    } catch (e: any) {
      console.error('Fiscal invoice error:', e);
      res.status(500).json({ message: 'Erro ao salvar nota fiscal', detail: e.message });
    }
  });

  // DELETE /api/fiscal-invoices/:id
  // IDOR note: fiscal_invoices table has no empresa_id column, so ownership cannot
  // be verified at the resource level without a schema migration. Access is restricted
  // to WRITE_ROLES as the available mitigation until a tenant column is added.
  app.delete('/api/fiscal-invoices/:id', requireAuth, requireRole(WRITE_ROLES), async (req, res) => {
    const id = Number(req.params.id);
    const invoice = await storage.getFiscalInvoiceById(id);
    if (!invoice) return res.status(404).json({ message: 'Nota não encontrada' });
    await storage.deleteFiscalInvoice(id);
    res.status(204).send();
  });
}
