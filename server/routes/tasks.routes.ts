import type { Express } from "express";
import { storage } from "../services/storage.ts";

export function register(app: Express) {
  app.get('/api/tasks', async (req, res) => {
    if (!req.session?.userId) return res.status(401).json({ message: 'Not authenticated' });
    const user = await storage.getUser(req.session.userId);
    if (!user) return res.status(401).json({ message: 'Not authenticated' });
    try {
      let result;
      if (['ADMIN', 'DIRECTOR', 'DEVELOPER'].includes(user.role)) {
        result = await storage.getTasks();
      } else {
        result = await storage.getTasksByUser(user.id);
      }
      res.json(result);
    } catch (e) { res.status(500).json({ message: 'Error fetching tasks' }); }
  });

  app.post('/api/tasks', async (req, res) => {
    if (!req.session?.userId) return res.status(401).json({ message: 'Not authenticated' });
    const user = await storage.getUser(req.session.userId);
    if (!user || !['MASTER', 'ADMIN', 'DIRECTOR', 'DEVELOPER'].includes(user.role)) {
      return res.status(403).json({ message: 'Sem permissão' });
    }
    try {
      const { title, description, assignedToId, assignedToName, priority } = req.body;
      const deadline = req.body.deadline || undefined;
      if (!title || !description || !priority) return res.status(400).json({ message: 'Campos obrigatórios' });
      const assignedToIdNum = assignedToId ? parseInt(assignedToId) : undefined;
      const task = await storage.createTask({ title, description, assignedToId: assignedToIdNum, assignedToName, deadline, priority, createdById: user.id, createdByName: user.name });
      await storage.createLog({ action: 'TASK_CREATED', description: `Tarefa criada: ${title}`, userId: user.id, userEmail: user.email, userRole: user.role });
      res.json(task);
    } catch (e: any) { console.error('[TASKS] createTask error:', e?.message); res.status(500).json({ message: 'Error creating task' }); }
  });

  app.patch('/api/tasks/:id', async (req, res) => {
    if (!req.session?.userId) return res.status(401).json({ message: 'Not authenticated' });
    const user = await storage.getUser(req.session.userId);
    if (!user) return res.status(401).json({ message: 'Not authenticated' });
    try {
      const id = parseInt(req.params.id);
      const raw = req.body;
      const updates: Record<string, any> = {};
      if (raw.title !== undefined) updates.title = raw.title;
      if (raw.description !== undefined) updates.description = raw.description;
      if (raw.priority !== undefined) updates.priority = raw.priority;
      if (raw.status !== undefined) updates.status = raw.status;
      if (raw.assignedToId !== undefined) updates.assignedToId = raw.assignedToId ? Number(raw.assignedToId) : null;
      if (raw.assignedToName !== undefined) updates.assignedToName = raw.assignedToName || null;
      // sanitize date: empty string → null to avoid DB type error
      if (raw.deadline !== undefined) updates.deadline = raw.deadline && raw.deadline !== '' ? raw.deadline : null;
      const task = await storage.updateTask(id, updates);
      await storage.createLog({ action: 'TASK_UPDATED', description: `Tarefa atualizada: ${task.title} → status: ${updates.status || task.status}`, userId: user.id, userEmail: user.email, userRole: user.role });
      res.json(task);
    } catch (e: any) { console.error('Error updating task:', e); res.status(500).json({ message: 'Error updating task', detail: e?.message }); }
  });

  app.delete('/api/tasks/:id', async (req, res) => {
    if (!req.session?.userId) return res.status(401).json({ message: 'Not authenticated' });
    const user = await storage.getUser(req.session.userId);
    if (!user || !['MASTER', 'ADMIN', 'DIRECTOR', 'DEVELOPER'].includes(user.role)) {
      return res.status(403).json({ message: 'Sem permissão' });
    }
    try {
      await storage.deleteTask(parseInt(req.params.id));
      await storage.createLog({ action: 'TASK_DELETED', description: `Tarefa #${req.params.id} excluída`, userId: user.id, userEmail: user.email, userRole: user.role });
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ message: 'Error deleting task' }); }
  });
}
