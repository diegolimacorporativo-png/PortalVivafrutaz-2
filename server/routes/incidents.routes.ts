import type { Express } from "express";
import { storage } from "../services/storage.ts";
import { requireAuth as requireAuthCore } from "../core/http/requireAuth";
import { requireSessionOrCompany } from "../core/http/requireSessionOrCompany";
import { tenantContext } from "../middleware/tenant";
import { currentTenantId } from "../core/tenant/context";
import {
  CLIENT_INCIDENT_DELETE_ROLES,
  CLIENT_INCIDENT_ROLES,
  resolveClientIncidentScope,
  resolveIncidentCreationCompanyId,
  sanitizeIncidentPatch,
} from "../modules/incidents/client-incidents.policy";
import {
  INTERNAL_INCIDENT_DELETE_ROLES,
  INTERNAL_INCIDENT_ROLES,
  internalIncidentAssigneeBelongsToScope,
  requiresInternalIncidentTenant,
  resolveInternalIncidentScope,
  sanitizeInternalIncidentPatch,
} from "../modules/incidents/internal-incidents.policy";

const INCIDENT_ADMIN_MIDDLEWARE = [requireAuthCore, tenantContext] as const;
const INCIDENT_SESSION_MIDDLEWARE = [requireSessionOrCompany, tenantContext] as const;

function parseIncidentId(value: unknown): number | null {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

async function resolveIncidentRequest(
  req: any,
  res: any,
  allowedRoles: readonly string[] = CLIENT_INCIDENT_ROLES,
) {
  const session = req.session;
  const user = session?.userId ? await storage.getUser(session.userId) : null;

  if (session?.companyId) {
    const scope = resolveClientIncidentScope(
      { sessionCompanyId: session.companyId, tenantId: currentTenantId() },
      allowedRoles,
    );
    if (scope) return { scope, user: null };
    res.status(403).json({ message: 'Empresa não definida para esta sessão' });
    return null;
  }

  if (!user || !allowedRoles.includes(user.role)) {
    res.status(403).json({ message: 'Sem permissão' });
    return null;
  }

  const scope = resolveClientIncidentScope(
    { tenantId: currentTenantId(), role: user.role, userEmpresaId: user.empresaId },
    allowedRoles,
  );
  if (!scope) {
    res.status(403).json({ message: 'Empresa não definida para este usuário' });
    return null;
  }

  return { scope, user };
}

async function getIncidentForScope(
  id: number,
  scope: { companyId: number | null; global: boolean },
) {
  return scope.companyId == null
    ? storage.getClientIncident(id)
    : storage.getClientIncidentForCompany(id, scope.companyId);
}

async function resolveInternalIncidentRequest(
  req: any,
  res: any,
  allowedRoles: readonly string[] = INTERNAL_INCIDENT_ROLES,
) {
  const user = req.session?.userId
    ? await storage.getUser(req.session.userId)
    : null;
  if (!user || !allowedRoles.includes(user.role)) {
    res.status(403).json({ message: 'Sem permissão' });
    return null;
  }

  const scope = resolveInternalIncidentScope(
    { tenantId: currentTenantId(), role: user.role, userEmpresaId: user.empresaId },
    allowedRoles,
  );
  if (!scope) {
    res.status(403).json({ message: 'Empresa não definida para este usuário' });
    return null;
  }

  return { scope, user };
}

async function resolveInternalIncidentAssignee(
  scope: { companyId: number | null; global: boolean },
  assignedToId: number | null | undefined,
) {
  if (assignedToId == null) return { assignedToId: null, assignedToName: null };
  const assignee = await storage.getUser(assignedToId);
  if (
    !assignee ||
    !internalIncidentAssigneeBelongsToScope(scope as any, assignee.empresaId)
  ) {
    return null;
  }
  return { assignedToId: assignee.id, assignedToName: assignee.name };
}

export function register(app: Express) {
  // ─── CLIENT INCIDENTS ─────────────────────────────────────────────────────
  // POST — hybrid: company portal or admin user
  app.post('/api/client-incidents', ...INCIDENT_SESSION_MIDDLEWARE, async (req, res) => {
    try {
      const request = await resolveIncidentRequest(req, res);
      if (!request) return;
      const { companyId: requestedCompanyId, companyName, type, description, contactPhone, contactEmail, photoBase64, photoMime, photosJson } = req.body ?? {};
      if (!type || !description) return res.status(400).json({ message: 'Campos obrigatórios: tipo e descrição são necessários.' });
      const companyId = resolveIncidentCreationCompanyId(request.scope, requestedCompanyId);
      if (!companyId) return res.status(400).json({ message: 'Empresa é obrigatória para criar a ocorrência.' });
      const incident = await storage.createClientIncident({ companyId, companyName, type, description, contactPhone, contactEmail, photoBase64, photoMime, photosJson });
      await storage.createLog({ action: 'CLIENT_INCIDENT_CREATED', description: `Ocorrência de cliente criada: ${type} por empresa ${companyName}`, companyId, level: 'WARN' });
      res.json(incident);
    } catch (e) { res.status(500).json({ message: 'Error creating incident' }); }
  });

  // GET — hybrid: company portal sees own; admin sees all
  app.get('/api/client-incidents', ...INCIDENT_SESSION_MIDDLEWARE, async (req, res) => {
    try {
      const request = await resolveIncidentRequest(req, res);
      if (!request) return;
      const incidents = request.scope.companyId == null
        ? await storage.getClientIncidents()
        : await storage.getClientIncidentsByCompany(request.scope.companyId);
      res.json(incidents);
    } catch (e) { res.status(500).json({ message: 'Error fetching incidents' }); }
  });

  // PATCH — admin users only
  app.patch('/api/client-incidents/:id', ...INCIDENT_ADMIN_MIDDLEWARE, async (req, res) => {
    try {
      const request = await resolveIncidentRequest(req, res);
      if (!request) return;
      const id = parseIncidentId(req.params.id);
      if (!id) return res.status(404).json({ message: 'Ocorrência não encontrada' });
      const { status, adminNote } = sanitizeIncidentPatch(req.body);
      const resolvedAt = status === 'RESOLVED' ? new Date() : undefined;
      const respondedAt = status === 'RESPONDED' ? new Date() : undefined;
      const updates = {
        status,
        adminNote,
        ...(resolvedAt !== undefined ? { resolvedAt } : {}),
        ...(respondedAt !== undefined ? { respondedAt } : {}),
      };
      const updated = request.scope.companyId == null
        ? await storage.updateClientIncident(id, updates)
        : await storage.updateClientIncidentForCompany(id, request.scope.companyId, updates);
      if (!updated) return res.status(404).json({ message: 'Ocorrência não encontrada' });
      const user = request.user!;
      await storage.createLog({ action: 'CLIENT_INCIDENT_UPDATED', description: `Ocorrência #${id} atualizada → ${status}`, userId: user.id, userEmail: user.email, userRole: user.role });
      res.json(updated);
    } catch (e) { res.status(500).json({ message: 'Error updating incident' }); }
  });

  // DELETE — admin users only
  app.delete('/api/client-incidents/:id', ...INCIDENT_ADMIN_MIDDLEWARE, async (req, res) => {
    try {
      const request = await resolveIncidentRequest(req, res, CLIENT_INCIDENT_DELETE_ROLES);
      if (!request) return;
      const id = parseIncidentId(req.params.id);
      if (!id) return res.status(404).json({ message: 'Ocorrência não encontrada' });
      const incident = request.scope.companyId == null
        ? await storage.getClientIncident(id)
        : await storage.deleteClientIncidentForCompany(id, request.scope.companyId);
      if (!incident) return res.status(404).json({ message: 'Ocorrência não encontrada' });
      if (request.scope.companyId == null) await storage.deleteClientIncident(id);
      const user = request.user!;
      await storage.createLog({ action: 'CLIENT_INCIDENT_DELETED', description: `Ocorrência #${id} (${incident.type}) foi excluída por ${user.name}`, userId: user.id, userEmail: user.email, userRole: user.role });
      res.status(204).end();
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  // POST respond — admin users only
  app.post('/api/client-incidents/:id/respond', ...INCIDENT_ADMIN_MIDDLEWARE, async (req, res) => {
    try {
      const request = await resolveIncidentRequest(req, res);
      if (!request) return;
      const id = parseIncidentId(req.params.id);
      if (!id) return res.status(404).json({ message: 'Ocorrência não encontrada' });
      const { responseMessage } = req.body ?? {};
      if (!responseMessage || !responseMessage.trim()) return res.status(400).json({ message: 'Mensagem de resposta obrigatória' });
      const user = request.user!;
      const updated = request.scope.companyId == null
        ? await storage.respondToClientIncident(id, responseMessage.trim(), user.name)
        : await storage.respondToClientIncidentForCompany(id, request.scope.companyId, responseMessage.trim(), user.name);
      if (!updated) return res.status(404).json({ message: 'Ocorrência não encontrada' });
      await storage.createIncidentMessage({ incidentId: id, senderType: 'ADMIN', senderName: user.name, message: responseMessage.trim() });
      await storage.createLog({ action: 'CLIENT_INCIDENT_RESPONDED', description: `Ocorrência #${id} recebeu resposta de ${user.name}`, userId: user.id, userEmail: user.email, userRole: user.role });
      res.json(updated);
    } catch (e) { res.status(500).json({ message: 'Error responding to incident' }); }
  });

  // ─── MENSAGENS DE OCORRÊNCIAS ─────────────────────────────────
  // GET messages — hybrid (company portal or admin)
  app.get('/api/client-incidents/:id/messages', ...INCIDENT_SESSION_MIDDLEWARE, async (req, res) => {
    try {
      const request = await resolveIncidentRequest(req, res);
      if (!request) return;
      const id = parseIncidentId(req.params.id);
      if (!id) return res.status(404).json({ message: 'Ocorrência não encontrada' });
      const incident = await getIncidentForScope(id, request.scope);
      if (!incident) return res.status(404).json({ message: 'Ocorrência não encontrada' });
      const messages = await storage.getIncidentMessages(id);
      if (req.session?.companyId) {
        // B6-FIX: pass companyId to scope the update to the authenticated tenant
        await storage.markIncidentReadByClient(id, Number(req.session.companyId));
      }
      res.json(messages);
    } catch (e) { res.status(500).json({ message: 'Erro ao buscar mensagens' }); }
  });

  // POST message — hybrid (company portal or admin)
  app.post('/api/client-incidents/:id/messages', ...INCIDENT_SESSION_MIDDLEWARE, async (req, res) => {
    try {
      const request = await resolveIncidentRequest(req, res);
      if (!request) return;
      const id = parseIncidentId(req.params.id);
      if (!id) return res.status(404).json({ message: 'Ocorrência não encontrada' });
      const incident = await getIncidentForScope(id, request.scope);
      if (!incident) return res.status(404).json({ message: 'Ocorrência não encontrada' });
      const { message, photosJson } = req.body ?? {};
      if (!message || !message.trim()) return res.status(400).json({ message: 'Mensagem não pode estar vazia.' });
      let senderType = 'ADMIN';
      let senderName = 'Equipe VivaFrutaz';
      if (req.session?.companyId) {
        senderType = 'CLIENT';
        senderName = incident.companyName || 'Cliente';
      } else {
        const user = request.user!;
        senderName = user.name;
      }
      const msg = await storage.createIncidentMessage({ incidentId: id, senderType, senderName, message: message.trim(), photosJson });
      res.json(msg);
    } catch (e) { res.status(500).json({ message: 'Erro ao enviar mensagem' }); }
  });

  // POST mark-read — company portal only (no userId needed)
  app.post('/api/client-incidents/:id/mark-read', ...INCIDENT_SESSION_MIDDLEWARE, async (req, res) => {
    const companyId = req.session?.companyId;
    if (!companyId) return res.status(401).json({ message: 'Not authenticated' });
    try {
      const id = parseIncidentId(req.params.id);
      if (!id) return res.status(404).json({ message: 'Ocorrência não encontrada' });
      const incident = await storage.getClientIncidentForCompany(id, Number(companyId));
      if (!incident) return res.status(404).json({ message: 'Ocorrência não encontrada' });
      // B6-FIX: pass companyId so the update is scoped to the authenticated tenant only
      await storage.markIncidentReadByClient(id, Number(companyId));
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ message: 'Erro' }); }
  });

  // ─── OCORRÊNCIAS INTERNAS ─────────────────────────────────────
  app.get('/api/internal-incidents', ...INCIDENT_ADMIN_MIDDLEWARE, async (req, res) => {
    try {
      const request = await resolveInternalIncidentRequest(req, res);
      if (!request) return;
      const incidents = request.scope.companyId == null
        ? await storage.getInternalIncidents()
        : await storage.getInternalIncidentsForCompany(request.scope.companyId);
      res.json(incidents);
    } catch (e) { res.status(500).json({ message: 'Error fetching internal incidents' }); }
  });

  app.post('/api/internal-incidents', ...INCIDENT_ADMIN_MIDDLEWARE, async (req, res) => {
    try {
      const request = await resolveInternalIncidentRequest(req, res);
      if (!request) return;
      if (!requiresInternalIncidentTenant(request.scope)) {
        return res.status(403).json({ message: 'Este endpoint exige um tenant alvo' });
      }
      const { title, description, category, assignedToId: rawAssignedToId, priority } = req.body ?? {};
      if (!title || !description || !category || !priority) return res.status(400).json({ message: 'Campos obrigatórios' });
      const assignedToId = rawAssignedToId === undefined || rawAssignedToId === null || rawAssignedToId === '' || rawAssignedToId === 'none'
        ? null
        : Number(rawAssignedToId);
      if (assignedToId !== null && (!Number.isInteger(assignedToId) || assignedToId <= 0)) {
        return res.status(400).json({ message: 'Responsável inválido' });
      }
      const assignee = await resolveInternalIncidentAssignee(request.scope, assignedToId);
      if (!assignee) return res.status(400).json({ message: 'Responsável inválido' });
      const incident = await storage.createInternalIncident({
        empresaId: request.scope.companyId,
        title,
        description,
        category,
        ...assignee,
        priority,
        createdById: request.user.id,
        createdByName: request.user.name,
      });
      await storage.createLog({ action: 'INTERNAL_INCIDENT_CREATED', description: `Ocorrência interna criada: ${title}`, userId: request.user.id, userEmail: request.user.email, userRole: request.user.role, level: 'WARN', companyId: request.scope.companyId });
      res.json(incident);
    } catch (e) { res.status(500).json({ message: 'Error creating internal incident' }); }
  });

  app.patch('/api/internal-incidents/:id', ...INCIDENT_ADMIN_MIDDLEWARE, async (req, res) => {
    try {
      const request = await resolveInternalIncidentRequest(req, res);
      if (!request) return;
      if (!requiresInternalIncidentTenant(request.scope)) {
        return res.status(403).json({ message: 'Este endpoint exige um tenant alvo' });
      }
      const id = parseIncidentId(req.params.id);
      if (!id) return res.status(404).json({ message: 'Ocorrência não encontrada' });
      const patch = sanitizeInternalIncidentPatch(req.body);
      const rawPatch = req.body && typeof req.body === 'object'
        ? req.body as Record<string, unknown>
        : {};
      if (
        rawPatch.assignedToId !== undefined &&
        rawPatch.assignedToId !== null &&
        rawPatch.assignedToId !== '' &&
        rawPatch.assignedToId !== 'none' &&
        patch.assignedToId === undefined
      ) {
        return res.status(400).json({ message: 'Responsável inválido' });
      }
      const updates: Record<string, unknown> = { ...patch };
      if (patch.status !== undefined) {
        updates.resolvedAt = patch.status === 'RESOLVED' ? new Date() : null;
      }
      if (patch.assignedToId !== undefined) {
        const assignee = await resolveInternalIncidentAssignee(request.scope, patch.assignedToId);
        if (!assignee) return res.status(400).json({ message: 'Responsável inválido' });
        Object.assign(updates, assignee);
      }
      delete updates.assignedToId;
      const updated = await storage.updateInternalIncidentForCompany(id, request.scope.companyId, updates as any);
      if (!updated) return res.status(404).json({ message: 'Ocorrência não encontrada' });
      await storage.createLog({ action: 'INTERNAL_INCIDENT_UPDATED', description: `Ocorrência interna #${id} → ${patch.status || 'editada'}`, userId: request.user.id, userEmail: request.user.email, userRole: request.user.role, companyId: request.scope.companyId });
      res.json(updated);
    } catch (e) { res.status(500).json({ message: 'Error updating internal incident' }); }
  });

  app.delete('/api/internal-incidents/:id', ...INCIDENT_ADMIN_MIDDLEWARE, async (req, res) => {
    try {
      const request = await resolveInternalIncidentRequest(req, res, INTERNAL_INCIDENT_DELETE_ROLES);
      if (!request) return;
      if (!requiresInternalIncidentTenant(request.scope)) {
        return res.status(403).json({ message: 'Este endpoint exige um tenant alvo' });
      }
      const id = parseIncidentId(req.params.id);
      if (!id) return res.status(404).json({ message: 'Ocorrência não encontrada' });
      const deleted = await storage.deleteInternalIncidentForCompany(id, request.scope.companyId);
      if (!deleted) return res.status(404).json({ message: 'Ocorrência não encontrada' });
      await storage.createLog({ action: 'INTERNAL_INCIDENT_DELETED', description: `Ocorrência interna #${id} excluída`, userId: request.user.id, userEmail: request.user.email, userRole: request.user.role, companyId: request.scope.companyId });
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ message: 'Error deleting internal incident' }); }
  });
}
