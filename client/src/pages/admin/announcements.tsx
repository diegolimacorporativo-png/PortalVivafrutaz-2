import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Layout } from "@/components/Layout";
import { Modal } from "@/components/Modal";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import {
  Megaphone, Plus, Pencil, Trash2, Power, PowerOff,
  Info, AlertTriangle, Wrench, Truck, ChevronDown,
  Users, Building2, Calendar, User, Eye, EyeOff,
  Bell, BellOff, CheckCircle2, Clock, Target, Globe
} from "lucide-react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { apiRequest } from "@/lib/queryClient";

type Announcement = {
  id: number;
  title: string;
  message: string;
  type: string;
  priority: string;
  startDate: string;
  endDate: string;
  active: boolean;
  targetAll: boolean;
  targetClientTypes: string[] | null;
  targetCompanyIds: number[] | null;
  createdBy: number | null;
  createdAt: string;
};

type Company = { id: number; companyName: string; clientType: string };

const TYPE_CONFIG: Record<string, { label: string; color: string; bg: string; icon: typeof Info }> = {
  info: { label: "Informativo", color: "text-blue-700", bg: "bg-blue-100 border-blue-200", icon: Info },
  important: { label: "Importante", color: "text-orange-700", bg: "bg-orange-100 border-orange-200", icon: AlertTriangle },
  maintenance: { label: "Manutenção", color: "text-red-700", bg: "bg-red-100 border-red-200", icon: Wrench },
  logistics: { label: "Logístico", color: "text-purple-700", bg: "bg-purple-100 border-purple-200", icon: Truck },
};

const CLIENT_TYPES = [
  { value: "mensal", label: "Cliente Padrão (Mensal)" },
  { value: "sodexo", label: "Sodexo" },
  { value: "grsa", label: "GRSA" },
  { value: "contratual", label: "Contratual" },
  { value: "outros", label: "Outros Contratos" },
];

const today = new Date().toISOString().split('T')[0];
const in30 = new Date(); in30.setDate(in30.getDate() + 30);
const defaultEndDate = in30.toISOString().split('T')[0];

function emptyForm() {
  return {
    title: "",
    message: "",
    type: "info",
    priority: "normal",
    startDate: today,
    endDate: defaultEndDate,
    active: true,
    targetAll: true,
    targetClientTypes: [] as string[],
    targetCompanyIds: [] as number[],
  };
}

export default function AnnouncementsPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editItem, setEditItem] = useState<Announcement | null>(null);
  const [form, setForm] = useState(emptyForm());
  const [deleteConfirmId, setDeleteConfirmId] = useState<number | null>(null);

  const canManage = ['ADMIN', 'DIRECTOR', 'DEVELOPER'].includes(user?.role || '');

  const { data: list = [], isLoading } = useQuery<Announcement[]>({
    queryKey: ['/api/announcements'],
  });

  const { data: companies = [] } = useQuery<Company[]>({
    queryKey: ['/api/companies'],
  });

  const createMutation = useMutation({
    mutationFn: (data: any) => apiRequest('POST', '/api/announcements', data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/announcements'] });
      toast({ title: "Aviso criado com sucesso!" });
      closeModal();
    },
    onError: (e: any) => toast({ title: e.message || "Erro ao criar aviso", variant: "destructive" }),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: any }) => apiRequest('PUT', `/api/announcements/${id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/announcements'] });
      toast({ title: "Aviso atualizado!" });
      closeModal();
    },
    onError: (e: any) => toast({ title: e.message || "Erro ao atualizar aviso", variant: "destructive" }),
  });

  const toggleMutation = useMutation({
    mutationFn: ({ id, active }: { id: number; active: boolean }) => apiRequest('PATCH', `/api/announcements/${id}/toggle`, { active }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['/api/announcements'] }),
    onError: (e: any) => toast({ title: e.message || "Erro", variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiRequest('DELETE', `/api/announcements/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/announcements'] });
      toast({ title: "Aviso excluído." });
      setDeleteConfirmId(null);
    },
    onError: (e: any) => toast({ title: e.message || "Erro ao excluir", variant: "destructive" }),
  });

  const openCreate = () => {
    setEditItem(null);
    setForm(emptyForm());
    setIsModalOpen(true);
  };

  const openEdit = (a: Announcement) => {
    setEditItem(a);
    setForm({
      title: a.title,
      message: a.message,
      type: a.type,
      priority: a.priority,
      startDate: a.startDate,
      endDate: a.endDate,
      active: a.active,
      targetAll: a.targetAll,
      targetClientTypes: a.targetClientTypes || [],
      targetCompanyIds: a.targetCompanyIds || [],
    });
    setIsModalOpen(true);
  };

  const closeModal = () => {
    setIsModalOpen(false);
    setEditItem(null);
    setForm(emptyForm());
  };

  const handleSubmit = () => {
    if (!form.title.trim() || !form.message.trim()) {
      toast({ title: "Título e mensagem são obrigatórios.", variant: "destructive" });
      return;
    }
    if (!form.startDate || !form.endDate) {
      toast({ title: "Defina as datas de exibição.", variant: "destructive" });
      return;
    }
    const payload = {
      ...form,
      targetClientTypes: form.targetAll ? null : (form.targetClientTypes.length > 0 ? form.targetClientTypes : null),
      targetCompanyIds: form.targetAll ? null : (form.targetCompanyIds.length > 0 ? form.targetCompanyIds : null),
    };
    if (editItem) {
      updateMutation.mutate({ id: editItem.id, data: payload });
    } else {
      createMutation.mutate(payload);
    }
  };

  const toggleClientType = (val: string) => {
    setForm(f => ({
      ...f,
      targetClientTypes: f.targetClientTypes.includes(val)
        ? f.targetClientTypes.filter(v => v !== val)
        : [...f.targetClientTypes, val],
    }));
  };

  const toggleCompany = (id: number) => {
    setForm(f => ({
      ...f,
      targetCompanyIds: f.targetCompanyIds.includes(id)
        ? f.targetCompanyIds.filter(v => v !== id)
        : [...f.targetCompanyIds, id],
    }));
  };

  const isExpired = (a: Announcement) => a.endDate < today;
  const isScheduled = (a: Announcement) => a.startDate > today;
  const isLive = (a: Announcement) => a.active && a.startDate <= today && a.endDate >= today;

  const sorted = useMemo(() => [...list].sort((a, b) => {
    if (a.active !== b.active) return a.active ? -1 : 1;
    if (a.priority !== b.priority) return a.priority === 'high' ? -1 : 1;
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  }), [list]);

  return (
    <Layout>
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-8 gap-4">
        <div>
          <h1 className="text-3xl font-display font-bold text-foreground flex items-center gap-3">
            <Megaphone className="w-8 h-8 text-primary" />
            Painel de Avisos
          </h1>
          <p className="text-muted-foreground mt-1">Gerencie comunicados e avisos exibidos aos clientes.</p>
        </div>
        {canManage && (
          <button onClick={openCreate} data-testid="button-create-announcement"
            className="flex items-center gap-2 px-6 py-3 bg-primary text-primary-foreground font-bold rounded-xl hover:bg-primary/90 transition-colors shadow-lg shadow-primary/25">
            <Plus className="w-4 h-4" /> Novo Aviso
          </button>
        )}
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
        {[
          { label: "Total", value: list.length, icon: Bell, color: "text-primary bg-primary/10" },
          { label: "Ativos", value: list.filter(isLive).length, icon: CheckCircle2, color: "text-green-700 bg-green-100" },
          { label: "Agendados", value: list.filter(isScheduled).length, icon: Clock, color: "text-blue-700 bg-blue-100" },
          { label: "Expirados", value: list.filter(isExpired).length, icon: BellOff, color: "text-muted-foreground bg-muted" },
        ].map(s => (
          <div key={s.label} className="bg-card rounded-2xl border border-border/50 premium-shadow p-4 flex items-center gap-3">
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${s.color}`}>
              <s.icon className="w-5 h-5" />
            </div>
            <div>
              <p className="text-2xl font-bold text-foreground">{s.value}</p>
              <p className="text-xs font-medium text-muted-foreground">{s.label}</p>
            </div>
          </div>
        ))}
      </div>

      {/* List */}
      <div className="grid gap-4">
        {isLoading ? (
          <div className="p-12 text-center text-muted-foreground">Carregando avisos...</div>
        ) : sorted.length === 0 ? (
          <div className="bg-card rounded-2xl border border-border/50 p-16 text-center">
            <Megaphone className="w-16 h-16 text-muted-foreground/30 mx-auto mb-4" />
            <h3 className="text-xl font-bold text-foreground">Nenhum aviso criado</h3>
            <p className="text-muted-foreground mt-2">Clique em "Novo Aviso" para criar um comunicado.</p>
          </div>
        ) : sorted.map(a => {
          const tc = TYPE_CONFIG[a.type] || TYPE_CONFIG.info;
          const live = isLive(a);
          const expired = isExpired(a);
          const scheduled = isScheduled(a);
          return (
            <div key={a.id} data-testid={`announcement-card-${a.id}`}
              className={`bg-card rounded-2xl border premium-shadow p-5 transition-all ${!a.active ? 'opacity-60 border-border/40' : 'border-border/50 hover:border-primary/30'}`}>
              <div className="flex flex-col md:flex-row md:items-start justify-between gap-4">
                <div className="flex gap-4 flex-1 min-w-0">
                  {/* Type icon */}
                  <div className={`w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0 border ${tc.bg}`}>
                    <tc.icon className={`w-5 h-5 ${tc.color}`} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2 mb-1.5">
                      <h3 className="font-bold text-lg text-foreground">{a.title}</h3>
                      <span className={`px-2 py-0.5 rounded-full text-xs font-bold border ${tc.bg} ${tc.color}`}>{tc.label}</span>
                      {a.priority === 'high' && (
                        <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-red-100 text-red-700 border border-red-200">🔴 Alta prioridade</span>
                      )}
                      {live && <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-green-100 text-green-700 border border-green-200">● Ativo</span>}
                      {!a.active && <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-muted text-muted-foreground border border-border">Desativado</span>}
                      {scheduled && a.active && <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-blue-100 text-blue-700 border border-blue-200">⏰ Agendado</span>}
                      {expired && <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-orange-100 text-orange-700 border border-orange-200">Expirado</span>}
                    </div>
                    <p className="text-sm text-muted-foreground mb-2 leading-relaxed">{a.message}</p>
                    <div className="flex flex-wrap gap-3 text-xs text-muted-foreground font-medium">
                      <span className="flex items-center gap-1">
                        <Calendar className="w-3.5 h-3.5" />
                        {format(new Date(a.startDate + 'T12:00:00'), "d MMM yyyy", { locale: ptBR })} → {format(new Date(a.endDate + 'T12:00:00'), "d MMM yyyy", { locale: ptBR })}
                      </span>
                      <span className="flex items-center gap-1">
                        {a.targetAll ? <Globe className="w-3.5 h-3.5 text-green-600" /> : <Target className="w-3.5 h-3.5 text-orange-500" />}
                        {a.targetAll ? 'Todos os clientes' : `Segmentado (${(a.targetClientTypes?.length || 0) + (a.targetCompanyIds?.length || 0)} filtros)`}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Actions */}
                {canManage && (
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <button
                      data-testid={`button-toggle-announcement-${a.id}`}
                      onClick={() => toggleMutation.mutate({ id: a.id, active: !a.active })}
                      title={a.active ? "Desativar" : "Ativar"}
                      className={`p-2.5 rounded-xl border transition-colors ${a.active ? 'bg-green-50 border-green-200 text-green-700 hover:bg-green-100' : 'bg-muted border-border text-muted-foreground hover:bg-muted/80'}`}>
                      {a.active ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
                    </button>
                    <button
                      data-testid={`button-edit-announcement-${a.id}`}
                      onClick={() => openEdit(a)}
                      className="p-2.5 rounded-xl border border-border bg-muted text-foreground hover:bg-muted/80 transition-colors">
                      <Pencil className="w-4 h-4" />
                    </button>
                    <button
                      data-testid={`button-delete-announcement-${a.id}`}
                      onClick={() => setDeleteConfirmId(a.id)}
                      className="p-2.5 rounded-xl border border-red-200 bg-red-50 text-red-600 hover:bg-red-100 transition-colors">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* ── Create / Edit Modal ── */}
      {isModalOpen && (
        <Modal isOpen onClose={closeModal} title={editItem ? "Editar Aviso" : "Novo Aviso"} maxWidth="max-w-2xl">
          <div className="space-y-5">
            {/* Title */}
            <div>
              <label className="block text-sm font-bold mb-1.5">Título do aviso *</label>
              <input
                data-testid="input-announcement-title"
                type="text" value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
                placeholder="Ex: Alteração no horário de entrega"
                className="w-full px-4 py-3 rounded-xl border-2 border-border focus:border-primary outline-none text-sm" />
            </div>

            {/* Message */}
            <div>
              <label className="block text-sm font-bold mb-1.5">Mensagem do aviso *</label>
              <textarea
                data-testid="input-announcement-message"
                value={form.message} onChange={e => setForm(f => ({ ...f, message: e.target.value }))}
                rows={4} placeholder="Digite a mensagem completa do aviso..."
                className="w-full px-4 py-3 rounded-xl border-2 border-border focus:border-primary outline-none resize-none text-sm" />
            </div>

            {/* Type + Priority */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-bold mb-1.5">Tipo de aviso</label>
                <select data-testid="select-announcement-type"
                  value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value }))}
                  className="w-full px-4 py-3 rounded-xl border-2 border-border focus:border-primary outline-none text-sm">
                  <option value="info">Informativo</option>
                  <option value="important">Importante</option>
                  <option value="maintenance">Manutenção</option>
                  <option value="logistics">Comunicado Logístico</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-bold mb-1.5">Prioridade</label>
                <select data-testid="select-announcement-priority"
                  value={form.priority} onChange={e => setForm(f => ({ ...f, priority: e.target.value }))}
                  className="w-full px-4 py-3 rounded-xl border-2 border-border focus:border-primary outline-none text-sm">
                  <option value="normal">Normal</option>
                  <option value="high">Alta 🔴</option>
                </select>
              </div>
            </div>

            {/* Dates */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-bold mb-1.5">Data de início *</label>
                <input data-testid="input-announcement-start"
                  type="date" value={form.startDate} onChange={e => setForm(f => ({ ...f, startDate: e.target.value }))}
                  className="w-full px-4 py-3 rounded-xl border-2 border-border focus:border-primary outline-none text-sm" />
              </div>
              <div>
                <label className="block text-sm font-bold mb-1.5">Data de encerramento *</label>
                <input data-testid="input-announcement-end"
                  type="date" value={form.endDate} onChange={e => setForm(f => ({ ...f, endDate: e.target.value }))}
                  className="w-full px-4 py-3 rounded-xl border-2 border-border focus:border-primary outline-none text-sm" />
              </div>
            </div>

            {/* Targeting */}
            <div className="p-4 rounded-xl border-2 border-border bg-muted/20 space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-bold text-sm">Público-alvo</p>
                  <p className="text-xs text-muted-foreground">Defina quem verá este aviso</p>
                </div>
                <button
                  data-testid="button-toggle-target-all"
                  type="button"
                  onClick={() => setForm(f => ({ ...f, targetAll: !f.targetAll }))}
                  className={`flex items-center gap-2 px-4 py-2 rounded-xl border-2 font-bold text-sm transition-colors ${form.targetAll ? 'bg-green-100 border-green-300 text-green-700' : 'bg-muted border-border text-muted-foreground'}`}>
                  <Globe className="w-4 h-4" />
                  {form.targetAll ? 'Todos os clientes' : 'Segmentado'}
                </button>
              </div>

              {!form.targetAll && (
                <div className="space-y-4 pt-2 border-t border-border">
                  {/* Client types */}
                  <div>
                    <p className="text-sm font-bold mb-2 flex items-center gap-2">
                      <Users className="w-4 h-4 text-muted-foreground" /> Tipo de cliente
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {CLIENT_TYPES.map(ct => (
                        <button key={ct.value} type="button"
                          data-testid={`button-clienttype-${ct.value}`}
                          onClick={() => toggleClientType(ct.value)}
                          className={`px-3 py-1.5 rounded-xl border-2 text-xs font-bold transition-colors ${
                            form.targetClientTypes.includes(ct.value)
                              ? 'bg-primary/10 border-primary text-primary'
                              : 'bg-muted border-border text-muted-foreground hover:bg-muted/80'
                          }`}>
                          {ct.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Specific companies */}
                  <div>
                    <p className="text-sm font-bold mb-2 flex items-center gap-2">
                      <Building2 className="w-4 h-4 text-muted-foreground" /> Empresas específicas
                      {form.targetCompanyIds.length > 0 && (
                        <span className="px-2 py-0.5 rounded-full bg-primary/10 text-primary text-xs font-bold">{form.targetCompanyIds.length} selecionada{form.targetCompanyIds.length > 1 ? 's' : ''}</span>
                      )}
                    </p>
                    <div className="max-h-48 overflow-y-auto rounded-xl border border-border divide-y divide-border/50">
                      {companies.map(c => (
                        <label key={c.id} className="flex items-center gap-3 px-3 py-2.5 hover:bg-muted/40 cursor-pointer transition-colors">
                          <input type="checkbox"
                            data-testid={`checkbox-company-${c.id}`}
                            checked={form.targetCompanyIds.includes(c.id)}
                            onChange={() => toggleCompany(c.id)}
                            className="rounded" />
                          <span className="text-sm font-medium text-foreground">{c.companyName}</span>
                          <span className="text-xs text-muted-foreground ml-auto capitalize">{c.clientType || 'mensal'}</span>
                        </label>
                      ))}
                      {companies.length === 0 && (
                        <div className="p-4 text-center text-sm text-muted-foreground">Nenhuma empresa cadastrada.</div>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Active toggle */}
            <label className="flex items-center gap-3 cursor-pointer">
              <div className="relative">
                <input type="checkbox" className="sr-only" checked={form.active}
                  onChange={e => setForm(f => ({ ...f, active: e.target.checked }))} />
                <div className={`w-12 h-6 rounded-full transition-colors ${form.active ? 'bg-primary' : 'bg-muted'}`} />
                <div className={`absolute top-1 left-1 w-4 h-4 rounded-full bg-white transition-transform ${form.active ? 'translate-x-6' : ''}`} />
              </div>
              <span className="text-sm font-bold">{form.active ? 'Aviso ativo (será exibido aos clientes)' : 'Aviso desativado'}</span>
            </label>

            {/* Footer */}
            <div className="flex gap-3 pt-2 border-t border-border">
              <button onClick={closeModal}
                className="flex-1 py-3 border-2 border-border rounded-xl font-bold text-muted-foreground hover:bg-muted transition-colors">
                Cancelar
              </button>
              <button onClick={handleSubmit}
                data-testid="button-submit-announcement"
                disabled={createMutation.isPending || updateMutation.isPending}
                className="flex-1 py-3 bg-primary text-white font-bold rounded-xl hover:bg-primary/90 transition-colors disabled:opacity-50 flex items-center justify-center gap-2">
                <Megaphone className="w-4 h-4" />
                {editItem ? "Salvar alterações" : "Criar aviso"}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* Delete confirm */}
      {deleteConfirmId !== null && (
        <Modal isOpen onClose={() => setDeleteConfirmId(null)} title="Excluir Aviso" maxWidth="max-w-sm">
          <div className="space-y-4">
            <p className="text-muted-foreground text-sm">Esta ação é permanente. Deseja excluir este aviso?</p>
            <div className="flex gap-3">
              <button onClick={() => setDeleteConfirmId(null)}
                className="flex-1 py-2.5 border-2 border-border rounded-xl font-bold text-muted-foreground hover:bg-muted transition-colors">
                Cancelar
              </button>
              <button onClick={() => deleteMutation.mutate(deleteConfirmId!)}
                data-testid="button-confirm-delete-announcement"
                disabled={deleteMutation.isPending}
                className="flex-1 py-2.5 bg-red-600 text-white font-bold rounded-xl hover:bg-red-700 transition-colors disabled:opacity-50">
                Excluir
              </button>
            </div>
          </div>
        </Modal>
      )}
    </Layout>
  );
}
