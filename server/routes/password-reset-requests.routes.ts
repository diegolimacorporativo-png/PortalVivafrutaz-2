import type { Express } from "express";
import { storage } from "../services/storage.ts";
import { sendPasswordResetResolved } from "../services/mailer";

export function register(app: Express) {
  // Password Reset Requests — Admin routes
  app.get('/api/password-reset-requests', async (req, res) => {
    try {
      const requests = await storage.getPasswordResetRequests();
      res.json(requests);
    } catch {
      res.status(500).json({ message: "Erro interno" });
    }
  });

  app.put('/api/password-reset-requests/:id', async (req, res) => {
    try {
      const id = Number(req.params.id);
      const { status, newPassword, adminNote } = req.body;
      const updates: any = { status, adminNote, resolvedAt: new Date() };
      const allReqs = await storage.getPasswordResetRequests();
      const pr = allReqs.find(r => r.id === id);
      if (newPassword && status === 'APPROVED' && pr) {
        await storage.updateCompany(pr.companyId, { password: newPassword } as any);
        updates.newPassword = newPassword;
      }
      const updated = await storage.updatePasswordResetRequest(id, updates);
      res.json(updated);

      // Send email (non-blocking)
      if (pr) {
        try {
          const company = await storage.getCompany(pr.companyId);
          if (company) {
            await sendPasswordResetResolved({
              toEmail: company.email,
              companyName: company.companyName,
              approved: status === 'APPROVED',
              adminNote,
            });
          }
        } catch (emailErr) {
          console.error("[EMAIL] Erro ao enviar email de reset:", emailErr);
        }
      }
    } catch {
      res.status(500).json({ message: "Erro interno" });
    }
  });
}
