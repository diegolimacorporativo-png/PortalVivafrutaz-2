import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { useAuth } from '@/hooks/use-auth';
import { queryClient, apiRequest } from '@/lib/queryClient';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Plus, AlertTriangle, Eye, Pencil, Trash2 } from 'lucide-react';
import type { InternalIncident } from '@shared/schema';

const CATEGORY_LABELS: Record<string, string> = { LOGISTICS: 'Logística', QUALITY: 'Qualidade', FINANCIAL: 'Financeiro', SYSTEM: 'Sistema', OTHER: 'Outro' };
const PRIORITY_LABEL: Record<string, string> = { LOW: 'Baixa', MEDIUM: 'Média', HIGH: 'Alta' };
const PRIORITY_COLOR: Record<string, string> = { LOW: 'bg-green-100 text-green-800', MEDIUM: 'bg-yellow-100 text-yellow-800', HIGH: 'bg-red-100 text-red-800' };
const STATUS_LABEL: Record<string, string> = { OPEN: 'Aberta', ANALYZING: 'Em análise', RESOLVED: 'Resolvida' };
const STATUS_COLOR: Record<string, string> = { OPEN: 'bg-red-100 text-red-800', ANALYZING: 'bg-yellow-100 text-yellow-800', RESOLVED: 'bg-green-100 text-green-800' };

function IncidentForm({ onClose, users, editIncident }: { onClose: () => void; users: any[]; editIncident?: InternalIncident }) {
  const { toast } = useToast();
  const [form, setForm] = useState({
    title: editIncident?.title || '',
    description: editIncident?.description || '',
    category: editIncident?.category || '',
    assignedToId: editIncident?.assignedToId?.toString() || '',
    priority: editIncident?.priority || 'MEDIUM',
  });

  const assignUser = users.find(u => u.id.toString() === form.assignedToId);

  const createMut = useMutation({
    mutationFn: (data: any) => apiRequest('POST', '/api/internal-incidents', data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/internal-incidents'] });
      toast({ title: 'Ocorrência interna registrada!' });
      onClose();
    },
    onError: () => toast({ title: 'Erro ao registrar ocorrência', variant: 'destructive' }),
  });

  const editMut = useMutation({
    mutationFn: (data: any) => apiRequest('PATCH', `/api/internal-incidents/${editIncident?.id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/internal-incidents'] });
      toast({ title: 'Ocorrência atualizada!' });
      onClose();
    },
    onError: () => toast({ title: 'Erro ao atualizar ocorrência', variant: 'destructive' }),
  });

  const handleSubmit = () => {
    if (!form.title || !form.description || !form.category || !form.priority) {
      return toast({ title: 'Preencha todos os campos obrigatórios', variant: 'destructive' });
    }
    const data = {
      ...form,
      assignedToId: form.assignedToId ? parseInt(form.assignedToId) : undefined,
      assignedToName: assignUser?.name,
    };
    if (editIncident) editMut.mutate(data);
    else createMut.mutate(data);
  };

  const isPending = createMut.isPending || editMut.isPending;

  return (
    <div className="space-y-4">
      <div>
        <Label>Título *</Label>
        <Input data-testid="input-internal-title" value={form.title} onChange={e => setForm(p => ({ ...p, title: e.target.value }))} placeholder="Título da ocorrência" />
      </div>
      <div>
        <Label>Descrição *</Label>
        <Textarea data-testid="input-internal-description" value={form.description} onChange={e => setForm(p => ({ ...p, description: e.target.value }))} placeholder="Descrição detalhada" rows={3} />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label>Categoria *</Label>
          <Select value={form.category} onValueChange={v => setForm(p => ({ ...p, category: v }))}>
            <SelectTrigger data-testid="select-internal-category">
              <SelectValue placeholder="Selecione" />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(CATEGORY_LABELS).map(([k, v]) => (
                <SelectItem key={k} value={k}>{v}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label>Prioridade *</Label>
          <Select value={form.priority} onValueChange={v => setForm(p => ({ ...p, priority: v }))}>
            <SelectTrigger data-testid="select-internal-priority">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="LOW">Baixa</SelectItem>
              <SelectItem value="MEDIUM">Média</SelectItem>
              <SelectItem value="HIGH">Alta</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      <div>
        <Label>Responsável</Label>
        <Select value={form.assignedToId} onValueChange={v => setForm(p => ({ ...p, assignedToId: v }))}>
          <SelectTrigger data-testid="select-internal-user">
            <SelectValue placeholder="Selecionar responsável" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">Nenhum</SelectItem>
            {users.map(u => (
              <SelectItem key={u.id} value={u.id.toString()}>{u.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>Cancelar</Button>
        <Button data-testid="button-save-internal" onClick={handleSubmit} disabled={isPending}>
          {isPending ? 'Salvando...' : editIncident ? 'Atualizar' : 'Registrar'}
        </Button>
      </DialogFooter>
    </div>
  );
}

function IncidentDetail({ incident, onClose, users }: { incident: InternalIncident; onClose: () => void; users: any[] }) {
  const { toast } = useToast();
  const [status, setStatus] = useState(incident.status);
  const [adminNote, setAdminNote] = useState(incident.adminNote || '');

  const updateMut = useMutation({
    mutationFn: (data: any) => apiRequest('PATCH', `/api/internal-incidents/${incident.id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/internal-incidents'] });
      toast({ title: 'Ocorrência atualizada!' });
      onClose();
    },
    onError: () => toast({ title: 'Erro ao atualizar', variant: 'destructive' }),
  });

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 text-sm">
        <div><span className="font-medium text-muted-foreground">Categoria:</span><p className="font-semibold">{CATEGORY_LABELS[incident.category] || incident.category}</p></div>
        <div><span className="font-medium text-muted-foreground">Prioridade:</span><p><span className={`text-xs px-2 py-0.5 rounded-full font-medium ${PRIORITY_COLOR[incident.priority]}`}>{PRIORITY_LABEL[incident.priority]}</span></p></div>
        <div><span className="font-medium text-muted-foreground">Criado por:</span><p>{incident.createdByName || '—'}</p></div>
        <div><span className="font-medium text-muted-foreground">Responsável:</span><p>{incident.assignedToName || '—'}</p></div>
        <div className="col-span-2"><span className="font-medium text-muted-foreground">Data:</span><p>{new Date(incident.createdAt).toLocaleString('pt-BR')}</p></div>
      </div>
      <div>
        <Label className="text-muted-foreground font-medium text-sm">Descrição</Label>
        <div className="mt-1 p-3 bg-muted/40 rounded-lg text-sm">{incident.description}</div>
      </div>
      <div>
        <Label>Status</Label>
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger data-testid="select-internal-status">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="OPEN">Aberta</SelectItem>
            <SelectItem value="ANALYZING">Em análise</SelectItem>
            <SelectItem value="RESOLVED">Resolvida</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div>
        <Label>Nota interna</Label>
        <Textarea
          data-testid="input-internal-admin-note"
          value={adminNote}
          onChange={e => setAdminNote(e.target.value)}
          placeholder="Observações ou resolução..."
          rows={3}
        />
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>Fechar</Button>
        <Button
          data-testid="button-save-internal-detail"
          onClick={() => updateMut.mutate({ status, adminNote })}
          disabled={updateMut.isPending}
        >
          {updateMut.isPending ? 'Salvando...' : 'Salvar'}
        </Button>
      </DialogFooter>
    </div>
  );
}

export default function InternalIncidentsPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [showForm, setShowForm] = useState(false);
  const [editInc, setEditInc] = useState<InternalIncident | undefined>();
  const [selected, setSelected] = useState<InternalIncident | undefined>();
  const [filterStatus, setFilterStatus] = useState('ALL');
  const canView = ['ADMIN', 'DIRECTOR', 'DEVELOPER', 'OPERATIONS_MANAGER'].includes(user?.role || '');

  const { data: incidents = [], isLoading } = useQuery<InternalIncident[]>({
    queryKey: ['/api/internal-incidents'],
    enabled: canView,
  });

  const { data: users = [] } = useQuery<any[]>({
    queryKey: ['/api/users'],
    enabled: canView,
  });

  const deleteMut = useMutation({
    mutationFn: (id: number) => apiRequest('DELETE', `/api/internal-incidents/${id}`),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['/api/internal-incidents'] }); toast({ title: 'Ocorrência excluída' }); },
    onError: () => toast({ title: 'Erro ao excluir', variant: 'destructive' }),
  });

  const canDelete = ['ADMIN', 'DIRECTOR', 'DEVELOPER'].includes(user?.role || '');
  const filtered = filterStatus === 'ALL' ? incidents : incidents.filter(i => i.status === filterStatus);
  const openCount = incidents.filter(i => i.status === 'OPEN').length;

  if (!canView) {
    return (
      <div className="text-center py-16 text-muted-foreground">
        <AlertTriangle className="w-12 h-12 mx-auto mb-3 opacity-30" />
        <p className="font-medium">Sem permissão para visualizar ocorrências internas</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Ocorrências Internas</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {openCount > 0
              ? <span className="text-red-600 font-medium">{openCount} ocorrência(s) em aberto</span>
              : 'Nenhuma ocorrência em aberto'}
          </p>
        </div>
        <div className="flex gap-2">
          <Select value={filterStatus} onValueChange={setFilterStatus}>
            <SelectTrigger className="w-40" data-testid="select-internal-filter">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">Todas</SelectItem>
              <SelectItem value="OPEN">Abertas</SelectItem>
              <SelectItem value="ANALYZING">Em análise</SelectItem>
              <SelectItem value="RESOLVED">Resolvidas</SelectItem>
            </SelectContent>
          </Select>
          <Button data-testid="button-new-internal" onClick={() => { setEditInc(undefined); setShowForm(true); }} className="gap-2">
            <Plus className="w-4 h-4" /> Nova Ocorrência
          </Button>
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-3">{[1,2,3].map(i => <div key={i} className="h-20 bg-muted rounded-xl animate-pulse" />)}</div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground">
          <AlertTriangle className="w-12 h-12 mx-auto mb-3 opacity-30" />
          <p className="font-medium">Nenhuma ocorrência encontrada</p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map(inc => (
            <Card key={inc.id} data-testid={`card-internal-incident-${inc.id}`} className="premium-shadow hover:shadow-md transition-shadow">
              <CardContent className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-sm">{inc.title}</span>
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_COLOR[inc.status]}`}>
                        {STATUS_LABEL[inc.status]}
                      </span>
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${PRIORITY_COLOR[inc.priority]}`}>
                        {PRIORITY_LABEL[inc.priority]}
                      </span>
                      <span className="text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground">
                        {CATEGORY_LABELS[inc.category] || inc.category}
                      </span>
                    </div>
                    <p className="text-sm text-muted-foreground line-clamp-1">{inc.description}</p>
                    <p className="text-xs text-muted-foreground">
                      Por: {inc.createdByName || '—'}
                      {inc.assignedToName && ` • Responsável: ${inc.assignedToName}`}
                    </p>
                  </div>
                  <div className="shrink-0 flex flex-col items-end gap-1">
                    <p className="text-xs text-muted-foreground">{new Date(inc.createdAt).toLocaleDateString('pt-BR')}</p>
                    <div className="flex gap-1">
                      <Button data-testid={`button-view-internal-${inc.id}`} size="sm" variant="ghost" className="h-7 px-2" onClick={() => setSelected(inc)}>
                        <Eye className="w-3.5 h-3.5" />
                      </Button>
                      <Button data-testid={`button-edit-internal-${inc.id}`} size="sm" variant="ghost" className="h-7 px-2" onClick={() => { setEditInc(inc); setShowForm(true); }}>
                        <Pencil className="w-3.5 h-3.5" />
                      </Button>
                      {canDelete && (
                        <Button data-testid={`button-delete-internal-${inc.id}`} size="sm" variant="ghost" className="h-7 px-2 text-red-600" onClick={() => deleteMut.mutate(inc.id)} disabled={deleteMut.isPending}>
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={showForm} onOpenChange={setShowForm}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editInc ? 'Editar Ocorrência' : 'Nova Ocorrência Interna'}</DialogTitle>
          </DialogHeader>
          <IncidentForm onClose={() => setShowForm(false)} users={users} editIncident={editInc} />
        </DialogContent>
      </Dialog>

      <Dialog open={!!selected} onOpenChange={() => setSelected(undefined)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Ocorrência #{selected?.id?.toString().padStart(4, '0')} — {selected?.title}</DialogTitle>
          </DialogHeader>
          {selected && <IncidentDetail incident={selected} onClose={() => setSelected(undefined)} users={users} />}
        </DialogContent>
      </Dialog>
    </div>
  );
}
