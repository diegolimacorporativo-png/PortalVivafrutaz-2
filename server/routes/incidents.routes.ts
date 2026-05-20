import type { Express } from "express";
import { storage } from "../services/storage.ts";
import { requireAuth as requireAuthCore } from "../core/http/requireAuth";
import { requireSessionOrCompany } from "../core/http/requireSessionOrCompany";

export function register(app: Express) {
  // ─── CLIENT INCIDENTS ─────────────────────────────────────────────────────
  // POST — hybrid: company portal or admin user
  app.post('/api/client-incidents', requireSessionOrCompany, async (req, res) => {
    try {
      const { companyId, companyName, type, description, contactPhone, contactEmail, photoBase64, photoMime, photosJson } = req.body;
      if (!companyId || !type || !description) return res.status(400).json({ message: 'Campos obrigatórios: tipo e descrição são necessários.' });
      const incident = await storage.createClientIncident({ companyId, companyName, type, description, contactPhone, contactEmail, photoBase64, photoMime, photosJson });
      await storage.createLog({ action: 'CLIENT_INCIDENT_CREATED', description: `Ocorrência de cliente criada: ${type} por empresa ${companyName}`, companyId, level: 'WARN' });
      res.json(incident);
    } catch (e) { res.status(500).json({ message: 'Error creating incident' }); }
  });

  // GET — hybrid: company portal sees own; admin sees all
  app.get('/api/client-incidents', requireSessionOrCompany, async (req, res) => {
    try {
      if (req.session?.companyId) {
        const incidents = await storage.getClientIncidentsByCompany(req.session.companyId);
        return res.json(incidents);
      }
      const user = await storage.getUser(req.session.userId!);
      if (!user || !['MASTER', 'ADMIN', 'DIRECTOR', 'DEVELOPER', 'OPERATIONS_MANAGER', 'LOGISTICS'].includes(user.role)) {
        return res.status(403).json({ message: 'Sem permissão' });
      }
      const incidents = await storage.getClientIncidents();
      res.json(incidents);
    } catch (e) { res.status(500).json({ message: 'Error fetching incidents' }); }
  });

  // PATCH — admin users only
  app.patch('/api/client-incidents/:id', requireAuthCore, async (req, res) => {
    const user = await storage.getUser(req.session.userId!);
    if (!user || !['MASTER', 'ADMIN', 'DIRECTOR', 'DEVELOPER', 'OPERATIONS_MANAGER', 'LOGISTICS'].includes(user.role)) {
      return res.status(403).json({ message: 'Sem permissão' });
    }
    try {
      const id = parseInt(String(req.params.id));
      const { status, adminNote } = req.body;
      const resolvedAt = status === 'RESOLVED' ? new Date() : undefined;
      const updated = await storage.updateClientIncident(id, { status, adminNote, ...(resolvedAt !== undefined ? { resolvedAt } : {}) });
      await storage.createLog({ action: 'CLIENT_INCIDENT_UPDATED', description: `Ocorrência #${id} atualizada → ${status}`, userId: user.id, userEmail: user.email, userRole: user.role });
      res.json(updated);
    } catch (e) { res.status(500).json({ message: 'Error updating incident' }); }
  });

  // DELETE — admin users only
  app.delete('/api/client-incidents/:id', requireAuthCore, async (req, res) => {
    const user = await storage.getUser(req.session.userId!);
    if (!user || !['MASTER', 'ADMIN', 'DIRECTOR', 'DEVELOPER'].includes(user.role)) {
      return res.status(403).json({ message: 'Sem permissão - apenas administradores podem excluir ocorrências' });
    }
    try {
      const id = parseInt(String(req.params.id));
      const incident = await storage.getClientIncident(id);
      if (!incident) return res.status(404).json({ message: 'Ocorrência não encontrada' });
      await storage.deleteClientIncident(id);
      await storage.createLog({ action: 'CLIENT_INCIDENT_DELETED', description: `Ocorrência #${id} (${incident.type}) foi excluída por ${user.name}`, userId: user.id, userEmail: user.email, userRole: user.role });
      res.status(204).end();
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  // POST respond — admin users only
  app.post('/api/client-incidents/:id/respond', requireAuthCore, async (req, res) => {
    const user = await storage.getUser(req.session.userId!);
    if (!user || !['MASTER', 'ADMIN', 'DIRECTOR', 'DEVELOPER', 'OPERATIONS_MANAGER', 'LOGISTICS'].includes(user.role)) {
      return res.status(403).json({ message: 'Sem permissão' });
    }
    try {
      const id = parseInt(String(req.params.id));
      const { responseMessage } = req.body;
      if (!responseMessage || !responseMessage.trim()) return res.status(400).json({ message: 'Mensagem de resposta obrigatória' });
      const updated = await storage.respondToClientIncident(id, responseMessage.trim(), user.name);
      await storage.createIncidentMessage({ incidentId: id, senderType: 'ADMIN', senderName: user.name, message: responseMessage.trim() });
      await storage.createLog({ action: 'CLIENT_INCIDENT_RESPONDED', description: `Ocorrência #${id} recebeu resposta de ${user.name}`, userId: user.id, userEmail: user.email, userRole: user.role });
      res.json(updated);
    } catch (e) { res.status(500).json({ message: 'Error responding to incident' }); }
  });

  // ─── MENSAGENS DE OCORRÊNCIAS ─────────────────────────────────
  // GET messages — hybrid (company portal or admin)
  app.get('/api/client-incidents/:id/messages', requireSessionOrCompany, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const messages = await storage.getIncidentMessages(id);
      if (req.session?.companyId) {
        await storage.markIncidentReadByClient(id);
      }
      res.json(messages);
    } catch (e) { res.status(500).json({ message: 'Erro ao buscar mensagens' }); }
  });

  // POST message — hybrid (company portal or admin)
  app.post('/api/client-incidents/:id/messages', requireSessionOrCompany, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const { message, photosJson } = req.body;
      if (!message || !message.trim()) return res.status(400).json({ message: 'Mensagem não pode estar vazia.' });
      let senderType = 'ADMIN';
      let senderName = 'Equipe VivaFrutaz';
      if (req.session?.companyId) {
        senderType = 'CLIENT';
        const incidents = await storage.getClientIncidentsByCompany(req.session.companyId);
        const inc = incidents.find(i => i.id === id);
        senderName = inc?.companyName || 'Cliente';
      } else {
        const user = await storage.getUser(req.session.userId!);
        if (!user || !['MASTER', 'ADMIN', 'DIRECTOR', 'DEVELOPER', 'OPERATIONS_MANAGER', 'LOGISTICS'].includes(user.role)) {
          return res.status(403).json({ message: 'Sem permissão' });
        }
        senderName = user.name;
      }
      const msg = await storage.createIncidentMessage({ incidentId: id, senderType, senderName, message: message.trim(), photosJson });
      res.json(msg);
    } catch (e) { res.status(500).json({ message: 'Erro ao enviar mensagem' }); }
  });

  // POST mark-read — company portal only (no userId needed)
  app.post('/api/client-incidents/:id/mark-read', async (req, res) => {
    if (!req.session?.companyId) return res.status(401).json({ message: 'Not authenticated' });
    try {
      await storage.markIncidentReadByClient(parseInt(req.params.id));
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ message: 'Erro' }); }
  });

  // ─── OCORRÊNCIAS INTERNAS ─────────────────────────────────────
  app.get('/api/internal-incidents', requireAuthCore, async (req, res) => {
    const user = await storage.getUser(req.session.userId!);
    if (!user || !['MASTER', 'ADMIN', 'DIRECTOR', 'DEVELOPER', 'OPERATIONS_MANAGER', 'LOGISTICS'].includes(user.role)) {
      return res.status(403).json({ message: 'Sem permissão' });
    }
    try {
      const incidents = await storage.getInternalIncidents();
      res.json(incidents);
    } catch (e) { res.status(500).json({ message: 'Error fetching internal incidents' }); }
  });

  app.post('/api/internal-incidents', requireAuthCore, async (req, res) => {
    const user = await storage.getUser(req.session.userId!);
    if (!user) return res.status(401).json({ message: 'Not authenticated' });
    try {
      const { title, description, category, assignedToId, assignedToName, priority } = req.body;
      if (!title || !description || !category || !priority) return res.status(400).json({ message: 'Campos obrigatórios' });
      const incident = await storage.createInternalIncident({ title, description, category, assignedToId, assignedToName, priority, createdById: user.id, createdByName: user.name });
      await storage.createLog({ action: 'INTERNAL_INCIDENT_CREATED', description: `Ocorrência interna criada: ${title}`, userId: user.id, userEmail: user.email, userRole: user.role, level: 'WARN' });
      res.json(incident);
    } catch (e) { res.status(500).json({ message: 'Error creating internal incident' }); }
  });

  app.patch('/api/internal-incidents/:id', requireAuthCore, async (req, res) => {
    const user = await storage.getUser(req.session.userId!);
    if (!user) return res.status(401).json({ message: 'Not authenticated' });
    try {
      const id = parseInt(String(req.params.id));
      const updates = req.body;
      const resolvedAt = updates.status === 'RESOLVED' ? new Date() : null;
      const updated = await storage.updateInternalIncident(id, { ...updates, ...(resolvedAt !== undefined ? { resolvedAt } : {}) });
      await storage.createLog({ action: 'INTERNAL_INCIDENT_UPDATED', description: `Ocorrência interna #${id} → ${updates.status || 'editada'}`, userId: user.id, userEmail: user.email, userRole: user.role });
      res.json(updated);
    } catch (e) { res.status(500).json({ message: 'Error updating internal incident' }); }
  });

  app.delete('/api/internal-incidents/:id', requireAuthCore, async (req, res) => {
    const user = await storage.getUser(req.session.userId!);
    if (!user || !['MASTER', 'ADMIN', 'DIRECTOR', 'DEVELOPER'].includes(user.role)) {
      return res.status(403).json({ message: 'Sem permissão' });
    }
    try {
      await storage.deleteInternalIncident(parseInt(String(req.params.id)));
      await storage.createLog({ action: 'INTERNAL_INCIDENT_DELETED', description: `Ocorrência interna #${req.params.id} excluída`, userId: user.id, userEmail: user.email, userRole: user.role });
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ message: 'Error deleting internal incident' }); }
  });
}
