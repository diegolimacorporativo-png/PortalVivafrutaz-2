import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { useAuth } from '@/hooks/use-auth';
import { queryClient, apiRequest } from '@/lib/queryClient';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Plus, CheckCircle2, Clock, AlertCircle, Trash2, Pencil, ChevronDown } from 'lucide-react';
import type { Task } from '@shared/schema';

const PRIORITY_LABEL: Record<string, string> = { LOW: 'Baixa', MEDIUM: 'Média', HIGH: 'Alta' };
const PRIORITY_COLOR: Record<string, string> = { LOW: 'bg-green-100 text-green-800', MEDIUM: 'bg-yellow-100 text-yellow-800', HIGH: 'bg-red-100 text-red-800' };
const STATUS_LABEL: Record<string, string> = { PENDING: 'Pendente', IN_PROGRESS: 'Em andamento', DONE: 'Concluída' };
const STATUS_ICON: Record<string, any> = { PENDING: Clock, IN_PROGRESS: AlertCircle, DONE: CheckCircle2 };
const STATUS_COLOR: Record<string, string> = { PENDING: 'text-yellow-600', IN_PROGRESS: 'text-blue-600', DONE: 'text-green-600' };

function TaskForm({ onClose, users, editTask }: { onClose: () => void; users: any[]; editTask?: Task }) {
  const { toast } = useToast();
  const { user } = useAuth();
  const [form, setForm] = useState({
    title: editTask?.title || '',
    description: editTask?.description || '',
    assignedToId: editTask?.assignedToId?.toString() || '',
    deadline: editTask?.deadline || '',
    priority: editTask?.priority || 'MEDIUM',
  });

  const assignUser = users.find(u => u.id.toString() === form.assignedToId);

  const createMut = useMutation({
    mutationFn: (data: any) => apiRequest('POST', '/api/tasks', data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/tasks'] });
      toast({ title: 'Tarefa criada com sucesso!' });
      onClose();
    },
    onError: () => toast({ title: 'Erro ao criar tarefa', variant: 'destructive' }),
  });

  const editMut = useMutation({
    mutationFn: (data: any) => apiRequest('PATCH', `/api/tasks/${editTask?.id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/tasks'] });
      toast({ title: 'Tarefa atualizada!' });
      onClose();
    },
    onError: () => toast({ title: 'Erro ao atualizar tarefa', variant: 'destructive' }),
  });

  const handleSubmit = () => {
    if (!form.title || !form.description || !form.priority) {
      return toast({ title: 'Preencha todos os campos obrigatórios', variant: 'destructive' });
    }
    const data = {
      ...form,
      assignedToId: form.assignedToId ? parseInt(form.assignedToId) : undefined,
      assignedToName: assignUser?.name,
    };
    if (editTask) editMut.mutate(data);
    else createMut.mutate(data);
  };

  const isPending = createMut.isPending || editMut.isPending;

  return (
    <div className="space-y-4">
      <div>
        <Label>Título *</Label>
        <Input data-testid="input-task-title" value={form.title} onChange={e => setForm(p => ({ ...p, title: e.target.value }))} placeholder="Título da tarefa" />
      </div>
      <div>
        <Label>Descrição *</Label>
        <Textarea data-testid="input-task-description" value={form.description} onChange={e => setForm(p => ({ ...p, description: e.target.value }))} placeholder="Descrição detalhada" rows={3} />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label>Responsável</Label>
          <Select value={form.assignedToId} onValueChange={v => setForm(p => ({ ...p, assignedToId: v }))}>
            <SelectTrigger data-testid="select-task-user">
              <SelectValue placeholder="Selecionar usuário" />
            </SelectTrigger>
            <SelectContent>
              {users.map(u => (
                <SelectItem key={u.id} value={u.id.toString()}>{u.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label>Data Limite</Label>
          <Input data-testid="input-task-deadline" type="date" value={form.deadline || ''} onChange={e => setForm(p => ({ ...p, deadline: e.target.value }))} />
        </div>
      </div>
      <div>
        <Label>Prioridade *</Label>
        <Select value={form.priority} onValueChange={v => setForm(p => ({ ...p, priority: v }))}>
          <SelectTrigger data-testid="select-task-priority">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="LOW">Baixa</SelectItem>
            <SelectItem value="MEDIUM">Média</SelectItem>
            <SelectItem value="HIGH">Alta</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>Cancelar</Button>
        <Button data-testid="button-save-task" onClick={handleSubmit} disabled={isPending}>
          {isPending ? 'Salvando...' : editTask ? 'Atualizar' : 'Criar Tarefa'}
        </Button>
      </DialogFooter>
    </div>
  );
}

export default function TasksPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [showForm, setShowForm] = useState(false);
  const [editTask, setEditTask] = useState<Task | undefined>();
  const canManage = ['ADMIN', 'DIRECTOR', 'DEVELOPER'].includes(user?.role || '');

  const { data: tasks = [], isLoading } = useQuery<Task[]>({ queryKey: ['/api/tasks'] });
  const { data: users = [] } = useQuery<any[]>({ queryKey: ['/api/users'], enabled: canManage });

  const deleteMut = useMutation({
    mutationFn: (id: number) => apiRequest('DELETE', `/api/tasks/${id}`),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['/api/tasks'] }); toast({ title: 'Tarefa excluída' }); },
    onError: () => toast({ title: 'Erro ao excluir tarefa', variant: 'destructive' }),
  });

  const statusMut = useMutation({
    mutationFn: ({ id, status }: { id: number; status: string }) => apiRequest('PATCH', `/api/tasks/${id}`, { status }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['/api/tasks'] }); toast({ title: 'Status atualizado!' }); },
    onError: () => toast({ title: 'Erro ao atualizar status', variant: 'destructive' }),
  });

  const openCreate = () => { setEditTask(undefined); setShowForm(true); };
  const openEdit = (t: Task) => { setEditTask(t); setShowForm(true); };

  const STATUS_ORDER = ['PENDING', 'IN_PROGRESS', 'DONE'];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Tarefas</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {canManage ? 'Todas as tarefas do sistema' : 'Tarefas atribuídas a você'}
          </p>
        </div>
        {canManage && (
          <Button data-testid="button-new-task" onClick={openCreate} className="gap-2">
            <Plus className="w-4 h-4" /> Nova Tarefa
          </Button>
        )}
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {[1,2,3].map(i => <div key={i} className="h-64 bg-muted rounded-xl animate-pulse" />)}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {STATUS_ORDER.map(status => {
            const Icon = STATUS_ICON[status];
            const filtered = tasks.filter(t => t.status === status);
            return (
              <div key={status} className="space-y-3">
                <div className={`flex items-center gap-2 font-semibold text-sm ${STATUS_COLOR[status]}`}>
                  <Icon className="w-4 h-4" />
                  {STATUS_LABEL[status]}
                  <span className="ml-auto bg-muted text-muted-foreground rounded-full px-2 py-0.5 text-xs">{filtered.length}</span>
                </div>
                {filtered.length === 0 && (
                  <div className="text-center text-muted-foreground text-sm py-8 border-2 border-dashed rounded-xl">
                    Nenhuma tarefa
                  </div>
                )}
                {filtered.map(task => {
                  const deadlineDate = task.deadline ? new Date(task.deadline) : null;
                  const isOverdue = deadlineDate && deadlineDate < new Date() && task.status !== 'DONE';
                  return (
                    <Card key={task.id} data-testid={`card-task-${task.id}`} className="premium-shadow hover:shadow-md transition-shadow">
                      <CardContent className="p-4 space-y-3">
                        <div className="flex items-start justify-between gap-2">
                          <h3 className="font-semibold text-sm text-foreground leading-tight">{task.title}</h3>
                          <span className={`text-xs px-2 py-0.5 rounded-full font-medium shrink-0 ${PRIORITY_COLOR[task.priority]}`}>
                            {PRIORITY_LABEL[task.priority]}
                          </span>
                        </div>
                        <p className="text-xs text-muted-foreground line-clamp-2">{task.description}</p>
                        {task.assignedToName && (
                          <p className="text-xs text-muted-foreground">👤 {task.assignedToName}</p>
                        )}
                        {deadlineDate && (
                          <p className={`text-xs font-medium ${isOverdue ? 'text-red-600' : 'text-muted-foreground'}`}>
                            📅 {deadlineDate.toLocaleDateString('pt-BR')} {isOverdue && '— Atrasada!'}
                          </p>
                        )}
                        <div className="flex gap-2 flex-wrap">
                          {STATUS_ORDER.filter(s => s !== task.status).map(s => (
                            <Button
                              key={s}
                              data-testid={`button-status-${task.id}-${s}`}
                              size="sm"
                              variant="outline"
                              className="text-xs h-7 px-2"
                              disabled={statusMut.isPending}
                              onClick={() => statusMut.mutate({ id: task.id, status: s })}
                            >
                              → {STATUS_LABEL[s]}
                            </Button>
                          ))}
                          {canManage && (
                            <>
                              <Button data-testid={`button-edit-task-${task.id}`} size="sm" variant="ghost" className="text-xs h-7 px-2" onClick={() => openEdit(task)}>
                                <Pencil className="w-3 h-3" />
                              </Button>
                              <Button data-testid={`button-delete-task-${task.id}`} size="sm" variant="ghost" className="text-xs h-7 px-2 text-red-600" onClick={() => deleteMut.mutate(task.id)} disabled={deleteMut.isPending}>
                                <Trash2 className="w-3 h-3" />
                              </Button>
                            </>
                          )}
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            );
          })}
        </div>
      )}

      <Dialog open={showForm} onOpenChange={setShowForm}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editTask ? 'Editar Tarefa' : 'Nova Tarefa'}</DialogTitle>
          </DialogHeader>
          <TaskForm onClose={() => setShowForm(false)} users={users} editTask={editTask} />
        </DialogContent>
      </Dialog>
    </div>
  );
}
