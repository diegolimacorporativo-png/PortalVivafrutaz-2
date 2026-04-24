import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import {
  Mail, Clock, Send, History, Plus, Trash2, Edit2, CheckCircle2,
  AlertTriangle, Loader2, RefreshCw, Users, User, Building2,
  Calendar, Bell, Settings, X, ChevronDown, Eye
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";

type EmailSchedule = {
  id: number;
  type: string;
  label: string;
  dayOfWeek: number | null;
  timeOfDay: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
};

type EmailLog = {
  id: number;
  type: string;
  toEmail: string;
  toName: string | null;
  companyId: number | null;
  orderId: number | null;
  subject: string;
  status: string;
  errorMessage: string | null;
  sentAt: string;
  metadata: any;
};

const DAYS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
const DAYS_FULL = ['Domingo', 'Segunda-feira', 'Terça-feira', 'Quarta-feira', 'Quinta-feira', 'Sexta-feira', 'Sábado'];

const EMAIL_TYPES = [
  { value: 'window_open_reminder', label: 'Lembrete de Abertura de Janela', color: 'bg-blue-100 text-blue-700' },
  { value: 'unfinalised_reminder', label: 'Cobrança de Pedido Não Finalizado', color: 'bg-orange-100 text-orange-700' },
  { value: 'order_confirmed', label: 'Pedido Confirmado', color: 'bg-green-100 text-green-700' },
  { value: 'order_rejected', label: 'Pedido Cancelado', color: 'bg-red-100 text-red-700' },
  { value: 'admin_broadcast', label: 'Comunicado Administrativo', color: 'bg-purple-100 text-purple-700' },
  { value: 'test', label: 'Teste de E-mail', color: 'bg-gray-100 text-gray-700' },
];

function typeInfo(type: string) {
  return EMAIL_TYPES.find(t => t.value === type) || { label: type, color: 'bg-gray-100 text-gray-700' };
}

function statusBadge(status: string) {
  if (status === 'sent') return <Badge className="bg-green-100 text-green-700 border-0 text-xs">✓ Enviado</Badge>;
  if (status === 'failed') return <Badge className="bg-red-100 text-red-700 border-0 text-xs">✗ Falhou</Badge>;
  return <Badge className="bg-gray-100 text-gray-700 border-0 text-xs">{status}</Badge>;
}

export default function EmailManagement() {
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState('schedules');
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [editSchedule, setEditSchedule] = useState<EmailSchedule | null>(null);
  const [scheduleForm, setScheduleForm] = useState({
    type: 'unfinalised_reminder',
    label: '',
    dayOfWeek: '' as string | number,
    timeOfDay: '15:00',
    enabled: true,
  });

  // Broadcast form
  const [broadcastSubject, setBroadcastSubject] = useState('');
  const [broadcastMessage, setBroadcastMessage] = useState('');
  const [broadcastTarget, setBroadcastTarget] = useState<'all' | 'specific'>('all');
  const [selectedCompanies, setSelectedCompanies] = useState<number[]>([]);
  const [logFilter, setLogFilter] = useState('');
  const [viewLog, setViewLog] = useState<EmailLog | null>(null);

  // ── Queries ────────────────────────────────────────────────
  const { data: schedules = [], isLoading: loadingSchedules } = useQuery<EmailSchedule[]>({
    queryKey: ['/api/email/schedules'],
  });

  const { data: logs = [], isLoading: loadingLogs, refetch: refetchLogs } = useQuery<EmailLog[]>({
    queryKey: ['/api/email/logs'],
  });

  const { data: companies = [] } = useQuery<any[]>({
    queryKey: ['/api/companies'],
  });

  const { data: activeWindow } = useQuery<any>({
    queryKey: ['/api/order-windows/active'],
  });

  // ── Mutations ──────────────────────────────────────────────
  const createSchedule = useMutation({
    mutationFn: (data: any) => apiRequest('POST', '/api/email/schedules', data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/email/schedules'] });
      setScheduleOpen(false);
      resetForm();
      toast({ title: 'Agendamento criado com sucesso!' });
    },
    onError: () => toast({ title: 'Erro ao criar agendamento', variant: 'destructive' }),
  });

  const updateSchedule = useMutation({
    mutationFn: ({ id, data }: { id: number; data: any }) => apiRequest('PUT', `/api/email/schedules/${id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/email/schedules'] });
      setScheduleOpen(false);
      setEditSchedule(null);
      resetForm();
      toast({ title: 'Agendamento atualizado!' });
    },
    onError: () => toast({ title: 'Erro ao atualizar', variant: 'destructive' }),
  });

  const toggleSchedule = useMutation({
    mutationFn: ({ id, enabled, data }: { id: number; enabled: boolean; data: any }) =>
      apiRequest('PUT', `/api/email/schedules/${id}`, { ...data, enabled }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['/api/email/schedules'] }),
  });

  const deleteSchedule = useMutation({
    mutationFn: (id: number) => apiRequest('DELETE', `/api/email/schedules/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/email/schedules'] });
      toast({ title: 'Agendamento removido.' });
    },
  });

  const broadcast = useMutation({
    mutationFn: (data: any) => apiRequest('POST', '/api/email/broadcast', data),
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ['/api/email/logs'] });
      setBroadcastSubject('');
      setBroadcastMessage('');
      setBroadcastTarget('all');
      setSelectedCompanies([]);
      toast({ title: `E-mail enviado para ${data.recipients || 0} destinatário(s)!` });
    },
    onError: (err: any) => toast({ title: err?.message || 'Erro ao enviar', variant: 'destructive' }),
  });

  // ── Helpers ────────────────────────────────────────────────
  const resetForm = () => setScheduleForm({ type: 'unfinalised_reminder', label: '', dayOfWeek: '', timeOfDay: '15:00', enabled: true });

  const openCreate = () => {
    setEditSchedule(null);
    resetForm();
    setScheduleOpen(true);
  };

  const openEdit = (s: EmailSchedule) => {
    setEditSchedule(s);
    setScheduleForm({
      type: s.type,
      label: s.label,
      dayOfWeek: s.dayOfWeek !== null ? s.dayOfWeek : '',
      timeOfDay: s.timeOfDay,
      enabled: s.enabled,
    });
    setScheduleOpen(true);
  };

  const handleSaveSchedule = () => {
    const data = {
      ...scheduleForm,
      dayOfWeek: scheduleForm.dayOfWeek !== '' ? Number(scheduleForm.dayOfWeek) : null,
    };
    if (editSchedule) {
      updateSchedule.mutate({ id: editSchedule.id, data });
    } else {
      createSchedule.mutate(data);
    }
  };

  const handleBroadcast = () => {
    if (!broadcastSubject.trim() || !broadcastMessage.trim()) {
      toast({ title: 'Preencha assunto e mensagem', variant: 'destructive' });
      return;
    }
    broadcast.mutate({
      subject: broadcastSubject,
      message: broadcastMessage,
      targetType: broadcastTarget,
      companyIds: broadcastTarget === 'specific' ? selectedCompanies : undefined,
    });
  };

  const filteredLogs = (logs as EmailLog[]).filter(log => {
    if (!logFilter) return true;
    const s = logFilter.toLowerCase();
    return log.toEmail.toLowerCase().includes(s) ||
      (log.toName || '').toLowerCase().includes(s) ||
      log.type.toLowerCase().includes(s) ||
      log.subject.toLowerCase().includes(s);
  });

  const logStats = {
    total: logs.length,
    sent: logs.filter(l => l.status === 'sent').length,
    failed: logs.filter(l => l.status === 'failed').length,
  };

  // ── Render ─────────────────────────────────────────────────
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl bg-primary/10 flex items-center justify-center">
            <Mail className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-display font-bold text-foreground">Central de E-mails</h1>
            <p className="text-sm text-muted-foreground">Agendamentos automáticos, envios manuais e histórico</p>
          </div>
        </div>

        {/* Window status badge */}
        <div className={`flex items-center gap-2 px-3 py-2 rounded-xl border text-sm font-medium ${activeWindow ? 'bg-green-50 border-green-200 text-green-700' : 'bg-muted/50 border-border text-muted-foreground'}`}>
          <div className={`w-2 h-2 rounded-full ${activeWindow ? 'bg-green-500 animate-pulse' : 'bg-gray-400'}`} />
          {activeWindow ? `Janela aberta: ${activeWindow.weekReference}` : 'Janela fechada'}
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-4">
        {[
          { label: 'Agendamentos Ativos', value: (schedules as EmailSchedule[]).filter(s => s.enabled).length, icon: Clock, color: 'text-primary', bg: 'bg-primary/10' },
          { label: 'E-mails Enviados', value: logStats.sent, icon: CheckCircle2, color: 'text-green-600', bg: 'bg-green-100' },
          { label: 'Falhas de Envio', value: logStats.failed, icon: AlertTriangle, color: 'text-red-600', bg: 'bg-red-100' },
          { label: 'Total no Histórico', value: logStats.total, icon: History, color: 'text-blue-600', bg: 'bg-blue-100' },
        ].map(({ label, value, icon: Icon, color, bg }) => (
          <div key={label} className="bg-card rounded-2xl p-5 border border-border/50 premium-shadow flex items-center gap-4">
            <div className={`w-11 h-11 rounded-xl ${bg} flex items-center justify-center flex-shrink-0`}>
              <Icon className={`w-6 h-6 ${color}`} />
            </div>
            <div>
              <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider">{label}</p>
              <p className="text-2xl font-display font-bold text-foreground">{value}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="grid grid-cols-3 w-full max-w-lg">
          <TabsTrigger value="schedules" data-testid="tab-email-schedules">
            <Clock className="w-4 h-4 mr-1.5" /> Agendamentos
          </TabsTrigger>
          <TabsTrigger value="broadcast" data-testid="tab-email-broadcast">
            <Send className="w-4 h-4 mr-1.5" /> Envio Manual
          </TabsTrigger>
          <TabsTrigger value="history" data-testid="tab-email-history">
            <History className="w-4 h-4 mr-1.5" /> Histórico
          </TabsTrigger>
        </TabsList>

        {/* ── AGENDAMENTOS ── */}
        <TabsContent value="schedules" className="space-y-4 mt-4">
          <div className="bg-card rounded-2xl border border-border/50 premium-shadow overflow-hidden">
            <div className="p-5 border-b border-border/50 bg-muted/20 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Clock className="w-5 h-5 text-primary" />
                <h3 className="font-bold text-foreground">Agendamentos de E-mail</h3>
                <Badge variant="outline" className="text-xs">{(schedules as EmailSchedule[]).length}</Badge>
              </div>
              <Button onClick={openCreate} data-testid="button-add-schedule" size="sm"
                className="flex items-center gap-1.5">
                <Plus className="w-4 h-4" /> Novo Agendamento
              </Button>
            </div>

            {/* Info box */}
            <div className="px-5 py-3 bg-blue-50 border-b border-blue-100">
              <p className="text-xs text-blue-700 flex items-start gap-1.5">
                <Bell className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
                O sistema verifica automaticamente a cada minuto se há e-mails para disparar. Condições: janela de pedidos aberta + cliente ativo + pedido não finalizado (para lembretes de cobrança).
              </p>
            </div>

            {loadingSchedules ? (
              <div className="p-10 flex justify-center"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
            ) : (schedules as EmailSchedule[]).length === 0 ? (
              <div className="p-10 text-center text-muted-foreground">
                <Clock className="w-10 h-10 text-muted-foreground/30 mx-auto mb-2" />
                <p>Nenhum agendamento configurado.</p>
                <p className="text-xs mt-1">Crie um agendamento para enviar lembretes automáticos.</p>
              </div>
            ) : (
              <div className="divide-y divide-border/50">
                {(schedules as EmailSchedule[]).map(s => {
                  const info = typeInfo(s.type);
                  return (
                    <div key={s.id} data-testid={`schedule-row-${s.id}`}
                      className="flex items-center gap-4 px-5 py-4 hover:bg-muted/10 transition-colors">
                      <div className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${s.enabled ? 'bg-green-500' : 'bg-gray-300'}`} />
                      <div className="flex-1 min-w-0">
                        <p className="font-bold text-foreground text-sm truncate">{s.label}</p>
                        <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                          <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${info.color}`}>{info.label}</span>
                          <span className="text-xs text-muted-foreground flex items-center gap-1">
                            <Calendar className="w-3 h-3" />
                            {s.dayOfWeek !== null ? DAYS_FULL[s.dayOfWeek] : 'Todos os dias'} às <strong>{s.timeOfDay}</strong>
                          </span>
                        </div>
                      </div>
                      <div className="flex items-center gap-3 flex-shrink-0">
                        <Switch
                          checked={s.enabled}
                          data-testid={`toggle-schedule-${s.id}`}
                          onCheckedChange={(checked) => toggleSchedule.mutate({ id: s.id, enabled: checked, data: s })}
                        />
                        <button onClick={() => openEdit(s)} data-testid={`button-edit-schedule-${s.id}`}
                          className="p-1.5 rounded-lg text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors">
                          <Edit2 className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => { if (confirm('Remover este agendamento?')) deleteSchedule.mutate(s.id); }}
                          data-testid={`button-delete-schedule-${s.id}`}
                          className="p-1.5 rounded-lg text-muted-foreground hover:text-red-500 hover:bg-red-50 transition-colors">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Conditions reminder */}
          <div className="bg-card rounded-2xl border border-border/50 p-5">
            <h4 className="font-bold text-sm text-foreground mb-3 flex items-center gap-2">
              <Settings className="w-4 h-4 text-primary" /> Condições de Envio
            </h4>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {[
                { icon: '🔔', title: 'Lembrete de Janela', desc: 'Enviado automaticamente quando uma janela de pedidos abre. Vai para todos os clientes ativos com e-mail cadastrado.' },
                { icon: '⏰', title: 'Cobrança de Pedido', desc: 'Enviado no dia e horário configurado se a janela estiver aberta e o cliente não tiver pedido confirmado.' },
                { icon: '✅', title: 'Confirmado / Cancelado', desc: 'Disparado automaticamente quando o admin altera o status do pedido. Inclui resumo e observações.' },
              ].map(({ icon, title, desc }) => (
                <div key={title} className="p-3 bg-muted/20 rounded-xl border border-border/50">
                  <p className="font-bold text-sm text-foreground mb-1">{icon} {title}</p>
                  <p className="text-xs text-muted-foreground leading-relaxed">{desc}</p>
                </div>
              ))}
            </div>
          </div>
        </TabsContent>

        {/* ── ENVIO MANUAL ── */}
        <TabsContent value="broadcast" className="space-y-4 mt-4">
          <div className="bg-card rounded-2xl border border-border/50 premium-shadow overflow-hidden">
            <div className="p-5 border-b border-border/50 bg-muted/20 flex items-center gap-3">
              <Send className="w-5 h-5 text-primary" />
              <div>
                <h3 className="font-bold text-foreground">Comunicado Administrativo</h3>
                <p className="text-xs text-muted-foreground">Envio em cópia oculta (BCC) para proteger a privacidade dos clientes</p>
              </div>
            </div>
            <div className="p-5 space-y-4">
              {/* Target selection */}
              <div>
                <label className="block text-xs font-bold text-muted-foreground mb-2 uppercase tracking-wider">Destinatários</label>
                <div className="grid grid-cols-2 gap-3">
                  <button
                    onClick={() => setBroadcastTarget('all')}
                    data-testid="button-target-all"
                    className={`flex items-center gap-3 p-3.5 rounded-xl border-2 transition-all ${broadcastTarget === 'all' ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/30'}`}
                  >
                    <div className={`w-9 h-9 rounded-xl flex items-center justify-center ${broadcastTarget === 'all' ? 'bg-primary/10' : 'bg-muted'}`}>
                      <Users className={`w-5 h-5 ${broadcastTarget === 'all' ? 'text-primary' : 'text-muted-foreground'}`} />
                    </div>
                    <div className="text-left">
                      <p className={`font-bold text-sm ${broadcastTarget === 'all' ? 'text-primary' : 'text-foreground'}`}>Todos os Clientes</p>
                      <p className="text-xs text-muted-foreground">Clientes ativos com e-mail</p>
                    </div>
                  </button>
                  <button
                    onClick={() => setBroadcastTarget('specific')}
                    data-testid="button-target-specific"
                    className={`flex items-center gap-3 p-3.5 rounded-xl border-2 transition-all ${broadcastTarget === 'specific' ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/30'}`}
                  >
                    <div className={`w-9 h-9 rounded-xl flex items-center justify-center ${broadcastTarget === 'specific' ? 'bg-primary/10' : 'bg-muted'}`}>
                      <Building2 className={`w-5 h-5 ${broadcastTarget === 'specific' ? 'text-primary' : 'text-muted-foreground'}`} />
                    </div>
                    <div className="text-left">
                      <p className={`font-bold text-sm ${broadcastTarget === 'specific' ? 'text-primary' : 'text-foreground'}`}>Empresas Específicas</p>
                      <p className="text-xs text-muted-foreground">Selecionar clientes</p>
                    </div>
                  </button>
                </div>
              </div>

              {/* Company selector */}
              {broadcastTarget === 'specific' && (
                <div>
                  <label className="block text-xs font-bold text-muted-foreground mb-2 uppercase tracking-wider">Selecionar Empresas</label>
                  <div className="border border-border rounded-xl overflow-hidden max-h-48 overflow-y-auto">
                    {(companies as any[]).filter(c => c.active).map((c: any) => (
                      <label key={c.id} className="flex items-center gap-3 px-4 py-2.5 hover:bg-muted/20 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={selectedCompanies.includes(c.id)}
                          data-testid={`checkbox-company-${c.id}`}
                          onChange={e => {
                            if (e.target.checked) setSelectedCompanies(prev => [...prev, c.id]);
                            else setSelectedCompanies(prev => prev.filter(id => id !== c.id));
                          }}
                          className="rounded border-border"
                        />
                        <span className="text-sm font-medium">{c.companyName}</span>
                      </label>
                    ))}
                  </div>
                  {selectedCompanies.length > 0 && (
                    <p className="text-xs text-muted-foreground mt-1">{selectedCompanies.length} empresa(s) selecionada(s)</p>
                  )}
                </div>
              )}

              {/* Subject */}
              <div>
                <label className="block text-xs font-bold text-muted-foreground mb-2 uppercase tracking-wider">Assunto *</label>
                <Input
                  data-testid="input-broadcast-subject"
                  value={broadcastSubject}
                  onChange={e => setBroadcastSubject(e.target.value)}
                  placeholder="Ex.: Aviso importante sobre entregas da semana"
                  className="h-10"
                />
              </div>

              {/* Message */}
              <div>
                <label className="block text-xs font-bold text-muted-foreground mb-2 uppercase tracking-wider">Mensagem *</label>
                <Textarea
                  data-testid="input-broadcast-message"
                  value={broadcastMessage}
                  onChange={e => setBroadcastMessage(e.target.value)}
                  placeholder="Digite a mensagem que será enviada aos clientes..."
                  rows={6}
                  className="resize-none"
                />
                <p className="text-xs text-muted-foreground mt-1">O texto será formatado automaticamente no template VivaFrutaz.</p>
              </div>

              {/* BCC notice */}
              <div className="p-3 bg-blue-50 border border-blue-200 rounded-xl flex items-start gap-2">
                <Mail className="w-4 h-4 text-blue-600 flex-shrink-0 mt-0.5" />
                <p className="text-xs text-blue-700">
                  <strong>Privacidade:</strong> Todos os destinatários receberão o e-mail em <strong>cópia oculta (BCC)</strong>.
                  Os clientes não verão os endereços uns dos outros.
                </p>
              </div>

              {/* Send button */}
              <Button
                data-testid="button-send-broadcast"
                onClick={handleBroadcast}
                disabled={broadcast.isPending || !broadcastSubject || !broadcastMessage}
                className="w-full h-11 font-bold"
              >
                {broadcast.isPending ? (
                  <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Enviando...</>
                ) : (
                  <><Send className="w-4 h-4 mr-2" /> Enviar Comunicado em BCC</>
                )}
              </Button>
            </div>
          </div>
        </TabsContent>

        {/* ── HISTÓRICO ── */}
        <TabsContent value="history" className="space-y-4 mt-4">
          <div className="bg-card rounded-2xl border border-border/50 premium-shadow overflow-hidden">
            <div className="p-5 border-b border-border/50 bg-muted/20 flex items-center gap-3 flex-wrap">
              <div className="flex items-center gap-2 flex-1">
                <History className="w-5 h-5 text-primary" />
                <h3 className="font-bold text-foreground">Histórico de E-mails</h3>
                <Badge variant="outline" className="text-xs">{filteredLogs.length}</Badge>
              </div>
              <div className="flex items-center gap-2">
                <Input
                  value={logFilter}
                  onChange={e => setLogFilter(e.target.value)}
                  placeholder="Filtrar..."
                  className="h-8 w-44 text-xs"
                />
                <button onClick={() => refetchLogs()}
                  className="p-2 rounded-lg border border-border hover:bg-muted transition-colors"
                  data-testid="button-refresh-logs">
                  <RefreshCw className="w-3.5 h-3.5 text-muted-foreground" />
                </button>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm text-left">
                <thead>
                  <tr className="bg-muted/30 text-xs text-muted-foreground uppercase tracking-wider">
                    <th className="px-5 py-3 font-semibold">Tipo</th>
                    <th className="px-5 py-3 font-semibold">Destinatário</th>
                    <th className="px-5 py-3 font-semibold">Assunto</th>
                    <th className="px-5 py-3 font-semibold">Status</th>
                    <th className="px-5 py-3 font-semibold">Enviado em</th>
                    <th className="px-5 py-3"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/50">
                  {loadingLogs ? (
                    <tr><td colSpan={6} className="px-5 py-8 text-center text-muted-foreground">
                      <Loader2 className="w-5 h-5 animate-spin mx-auto mb-2" /> Carregando...
                    </td></tr>
                  ) : filteredLogs.length === 0 ? (
                    <tr><td colSpan={6} className="px-5 py-10 text-center text-muted-foreground">
                      <History className="w-10 h-10 text-muted-foreground/30 mx-auto mb-2" />
                      <p>Nenhum e-mail no histórico.</p>
                    </td></tr>
                  ) : filteredLogs.map(log => {
                    const info = typeInfo(log.type);
                    return (
                      <tr key={log.id} data-testid={`log-row-${log.id}`} className="hover:bg-muted/10">
                        <td className="px-5 py-3">
                          <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${info.color}`}>{info.label}</span>
                        </td>
                        <td className="px-5 py-3">
                          <div>
                            <p className="font-medium text-foreground text-sm">{log.toName || log.toEmail}</p>
                            <p className="text-xs text-muted-foreground">{log.toEmail}</p>
                          </div>
                        </td>
                        <td className="px-5 py-3 max-w-xs">
                          <p className="text-sm text-foreground truncate">{log.subject}</p>
                        </td>
                        <td className="px-5 py-3">{statusBadge(log.status)}</td>
                        <td className="px-5 py-3 text-xs text-muted-foreground">
                          {format(new Date(log.sentAt), 'dd/MM/yyyy HH:mm', { locale: ptBR })}
                        </td>
                        <td className="px-5 py-3">
                          <button onClick={() => setViewLog(log)} data-testid={`button-view-log-${log.id}`}
                            className="p-1.5 rounded-lg text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors">
                            <Eye className="w-4 h-4" />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </TabsContent>
      </Tabs>

      {/* ── Schedule Dialog ── */}
      <Dialog open={scheduleOpen} onOpenChange={v => { setScheduleOpen(v); if (!v) { setEditSchedule(null); resetForm(); } }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Clock className="w-5 h-5 text-primary" />
              {editSchedule ? 'Editar Agendamento' : 'Novo Agendamento'}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <label className="block text-xs font-bold text-muted-foreground mb-2 uppercase tracking-wider">Tipo de E-mail *</label>
              <Select value={scheduleForm.type} onValueChange={v => setScheduleForm(p => ({ ...p, type: v }))}>
                <SelectTrigger data-testid="select-schedule-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="unfinalised_reminder">⏰ Cobrança de Pedido Não Finalizado</SelectItem>
                  <SelectItem value="window_open_reminder">🔔 Lembrete de Abertura de Janela</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground mt-1">
                {scheduleForm.type === 'window_open_reminder'
                  ? 'Enviado automaticamente quando a janela de pedidos abre. Não precisa configurar horário específico — dispara imediatamente.'
                  : 'Enviado no dia e horário configurados, para clientes sem pedido confirmado na janela atual.'}
              </p>
            </div>

            <div>
              <label className="block text-xs font-bold text-muted-foreground mb-2 uppercase tracking-wider">Descrição *</label>
              <Input data-testid="input-schedule-label" value={scheduleForm.label}
                onChange={e => setScheduleForm(p => ({ ...p, label: e.target.value }))}
                placeholder="Ex.: Cobrança de pedido — Segunda 15h" className="h-9" />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-bold text-muted-foreground mb-2 uppercase tracking-wider">Dia da Semana</label>
                <Select
                  value={scheduleForm.dayOfWeek === '' ? 'all' : String(scheduleForm.dayOfWeek)}
                  onValueChange={v => setScheduleForm(p => ({ ...p, dayOfWeek: v === 'all' ? '' : Number(v) }))}
                >
                  <SelectTrigger data-testid="select-schedule-day">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todos os dias</SelectItem>
                    {DAYS_FULL.map((d, i) => <SelectItem key={i} value={String(i)}>{d}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="block text-xs font-bold text-muted-foreground mb-2 uppercase tracking-wider">Horário *</label>
                <Input data-testid="input-schedule-time" type="time" value={scheduleForm.timeOfDay}
                  onChange={e => setScheduleForm(p => ({ ...p, timeOfDay: e.target.value }))}
                  className="h-9" />
              </div>
            </div>

            <div className="flex items-center justify-between p-3 bg-muted/20 rounded-xl border border-border/50">
              <div>
                <p className="font-semibold text-sm text-foreground">Habilitado</p>
                <p className="text-xs text-muted-foreground">Ativar envio automático</p>
              </div>
              <Switch checked={scheduleForm.enabled}
                onCheckedChange={v => setScheduleForm(p => ({ ...p, enabled: v }))} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setScheduleOpen(false)}>Cancelar</Button>
            <Button
              onClick={handleSaveSchedule}
              disabled={!scheduleForm.label || !scheduleForm.timeOfDay || createSchedule.isPending || updateSchedule.isPending}
              data-testid="button-save-schedule"
            >
              {(createSchedule.isPending || updateSchedule.isPending) ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
              {editSchedule ? 'Salvar Alterações' : 'Criar Agendamento'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Log detail modal ── */}
      <Dialog open={!!viewLog} onOpenChange={() => setViewLog(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Mail className="w-5 h-5 text-primary" /> Detalhes do E-mail
            </DialogTitle>
          </DialogHeader>
          {viewLog && (
            <div className="space-y-3 text-sm">
              {[
                { label: 'Tipo', value: typeInfo(viewLog.type).label },
                { label: 'Para', value: `${viewLog.toName || ''} <${viewLog.toEmail}>` },
                { label: 'Assunto', value: viewLog.subject },
                { label: 'Status', value: viewLog.status === 'sent' ? '✓ Enviado' : '✗ Falhou' },
                { label: 'Enviado em', value: format(new Date(viewLog.sentAt), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR }) },
              ].map(({ label, value }) => (
                <div key={label} className="flex gap-3">
                  <span className="text-xs font-bold text-muted-foreground uppercase w-20 flex-shrink-0 pt-0.5">{label}</span>
                  <span className="text-foreground">{value}</span>
                </div>
              ))}
              {viewLog.errorMessage && (
                <div className="p-3 bg-red-50 border border-red-200 rounded-lg">
                  <p className="text-xs font-bold text-red-700 mb-1">Erro</p>
                  <p className="text-xs text-red-600">{viewLog.errorMessage}</p>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
