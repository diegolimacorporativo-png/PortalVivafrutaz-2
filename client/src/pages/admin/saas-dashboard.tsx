import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { queryClient, apiRequest } from '@/lib/queryClient';
import { normalizeList, normalizeOne } from '@/lib/normalizeResponse';
import { useToast } from '@/hooks/use-toast';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Building2, TrendingUp, FileText, AlertTriangle, CheckCircle2, XCircle,
  Banknote, CreditCard, Plus, Pencil, Trash2, RefreshCw, BarChart3,
  Users, Package, Truck, Route, Shield, Puzzle, Star, Zap, QrCode, Copy, MapPin, ToggleLeft, ToggleRight,
} from 'lucide-react';
import { Switch } from '@/components/ui/switch';

const TABS = [
  { id: 'dashboard', label: 'Dashboard', icon: BarChart3 },
  { id: 'assinaturas', label: 'Assinaturas', icon: Star },
  { id: 'contratos', label: 'Contratos', icon: FileText },
  { id: 'faturas', label: 'Faturas', icon: CreditCard },
  { id: 'modulos', label: 'Módulos', icon: Puzzle },
  { id: 'bancos', label: 'Bancos', icon: Banknote },
  { id: 'gps', label: 'Controle GPS', icon: MapPin },
];

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; className: string }> = {
    ativo: { label: 'Ativo', className: 'bg-green-100 text-green-800 border-green-200' },
    suspenso: { label: 'Suspenso', className: 'bg-yellow-100 text-yellow-800 border-yellow-200' },
    cancelado: { label: 'Cancelado', className: 'bg-red-100 text-red-800 border-red-200' },
    pendente: { label: 'Pendente', className: 'bg-blue-100 text-blue-800 border-blue-200' },
    pago: { label: 'Pago', className: 'bg-green-100 text-green-800 border-green-200' },
    atrasado: { label: 'Atrasado', className: 'bg-red-100 text-red-800 border-red-200' },
    mensal: { label: 'Mensal', className: 'bg-purple-100 text-purple-800 border-purple-200' },
    anual: { label: 'Anual', className: 'bg-indigo-100 text-indigo-800 border-indigo-200' },
  };
  const s = map[status] ?? { label: status, className: 'bg-gray-100 text-gray-700 border-gray-200' };
  return <Badge className={`text-xs border ${s.className}`}>{s.label}</Badge>;
}

function DashboardTab() {
  const { data: stats, isLoading } = useQuery<any>({ queryKey: ['/api/saas/dashboard'] });
  const { data: companies } = useQuery<any[]>({ queryKey: ['/api/companies'], select: normalizeList });
  const { toast } = useToast();

  const inadimplenciaMut = useMutation({
    mutationFn: () => apiRequest('POST', '/api/saas/verificar-inadimplencia', {}),
    onSuccess: async (res) => {
      const data = await res.json();
      toast({ title: 'Verificação concluída', description: data.message });
      queryClient.invalidateQueries({ queryKey: ['/api/saas/dashboard'] });
    },
  });

  const ipcaMut = useMutation({
    mutationFn: (indice: number) => apiRequest('POST', '/api/saas/reajuste-ipca', { indiceIpca: indice }),
    onSuccess: async (res) => {
      const data = await res.json();
      toast({ title: 'Reajuste aplicado', description: data.message });
    },
  });

  const [ipca, setIpca] = useState('4.62');

  if (isLoading) return <div className="text-center py-12 text-muted-foreground">Carregando dashboard...</div>;

  return (
    <div className="space-y-6">
      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: 'Empresas Ativas', value: stats?.empresasAtivas ?? 0, icon: CheckCircle2, color: 'text-green-600', bg: 'bg-green-50' },
          { label: 'Inadimplentes', value: stats?.empresasInadimplentes ?? 0, icon: AlertTriangle, color: 'text-red-600', bg: 'bg-red-50' },
          { label: 'Faturamento Mês', value: `R$ ${(stats?.faturamentoMensal ?? 0).toFixed(2).replace('.', ',')}`, icon: TrendingUp, color: 'text-blue-600', bg: 'bg-blue-50' },
          { label: 'Faturamento Anual', value: `R$ ${(stats?.faturamentoAnual ?? 0).toFixed(2).replace('.', ',')}`, icon: BarChart3, color: 'text-purple-600', bg: 'bg-purple-50' },
        ].map(k => (
          <Card key={k.label} className="border border-border/50">
            <CardContent className="pt-4 pb-4">
              <div className="flex items-center gap-3">
                <div className={`w-10 h-10 rounded-xl ${k.bg} flex items-center justify-center`}>
                  <k.icon className={`w-5 h-5 ${k.color}`} />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">{k.label}</p>
                  <p className="text-xl font-bold text-foreground">{k.value}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Empresas por Plano */}
        <Card className="border border-border/50">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold">Empresas por Plano</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {(stats?.empresasPorPlano ?? []).map((p: any) => (
              <div key={p.plano} className="flex items-center gap-3">
                <div className="flex-1">
                  <div className="flex justify-between mb-1">
                    <span className="text-sm font-medium">{p.plano}</span>
                    <span className="text-xs text-muted-foreground">{p.ativas}/{p.total}</span>
                  </div>
                  <div className="h-2 bg-muted rounded-full overflow-hidden">
                    <div
                      className="h-full bg-blue-500 rounded-full transition-all"
                      style={{ width: p.total ? `${(p.ativas / p.total) * 100}%` : '0%' }}
                    />
                  </div>
                </div>
              </div>
            ))}
            {(!stats?.empresasPorPlano?.length) && (
              <p className="text-sm text-muted-foreground text-center py-4">Nenhum plano ativo ainda</p>
            )}
          </CardContent>
        </Card>

        {/* Ações Automatizadas */}
        <Card className="border border-border/50">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold">Automações SaaS</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <p className="text-xs text-muted-foreground mb-2">Verificar faturas em atraso (+15 dias) e marcar inadimplência</p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="w-full border-red-200 text-red-700 hover:bg-red-50"
                onClick={() => inadimplenciaMut.mutate()}
                disabled={inadimplenciaMut.isPending}
                data-testid="button-check-inadimplencia"
              >
                <AlertTriangle className="w-4 h-4 mr-2" />
                {inadimplenciaMut.isPending ? 'Verificando...' : 'Verificar Inadimplência'}
              </Button>
            </div>
            <div className="border-t border-border/30 pt-4">
              <p className="text-xs text-muted-foreground mb-2">Aplicar reajuste IPCA em contratos ativos</p>
              <div className="flex gap-2">
                <div className="flex-1">
                  <Input
                    type="number"
                    step="0.01"
                    value={ipca}
                    onChange={e => setIpca(e.target.value)}
                    placeholder="Ex: 4.62"
                    className="text-sm h-8"
                    data-testid="input-ipca"
                  />
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="border-purple-200 text-purple-700 hover:bg-purple-50"
                  onClick={() => ipcaMut.mutate(parseFloat(ipca))}
                  disabled={ipcaMut.isPending || !ipca}
                  data-testid="button-apply-ipca"
                >
                  <RefreshCw className="w-4 h-4 mr-1" />
                  Aplicar IPCA
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Resumo de Empresas */}
      <Card className="border border-border/50">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-semibold">Empresas Clientes ({companies?.length ?? 0})</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border/30">
                  <th className="text-left py-2 pr-4 font-medium text-muted-foreground">Empresa</th>
                  <th className="text-left py-2 pr-4 font-medium text-muted-foreground">CNPJ</th>
                  <th className="text-left py-2 pr-4 font-medium text-muted-foreground">Status</th>
                </tr>
              </thead>
              <tbody>
                {(companies ?? []).map((c: any) => (
                  <tr key={c.id} className="border-b border-border/20 hover:bg-muted/30" data-testid={`row-empresa-${c.id}`}>
                    <td className="py-2 pr-4 font-medium">{c.companyName ?? c.name}</td>
                    <td className="py-2 pr-4 text-muted-foreground">{c.cnpj ?? '—'}</td>
                    <td className="py-2"><StatusBadge status={c.status ?? 'ativo'} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function ContratosTab() {
  const { toast } = useToast();
  const { data: contratos = [], isLoading } = useQuery<any[]>({ queryKey: ['/api/saas/contratos'] });
  const { data: companies = [] } = useQuery<any[]>({ queryKey: ['/api/companies'], select: normalizeList });
  const { data: planos = [] } = useQuery<any[]>({ queryKey: ['/api/master/planos'] });
  const { data: bancos = [] } = useQuery<any[]>({ queryKey: ['/api/saas/bancos'] });
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [form, setForm] = useState({
    empresaId: '', planoId: '', valorContrato: '', tipoContrato: 'mensal',
    status: 'ativo', dataFim: '', observacoes: '', bancoDestinoId: '', indiceReajuste: '0',
  });

  const createMut = useMutation({
    mutationFn: (data: any) => apiRequest('POST', '/api/saas/contratos', data),
    onSuccess: () => {
      toast({ title: 'Contrato criado com sucesso' });
      queryClient.invalidateQueries({ queryKey: ['/api/saas/contratos'] });
      setShowForm(false);
    },
  });

  const updateMut = useMutation({
    mutationFn: ({ id, data }: any) => apiRequest('PATCH', `/api/saas/contratos/${id}`, data),
    onSuccess: () => {
      toast({ title: 'Contrato atualizado' });
      queryClient.invalidateQueries({ queryKey: ['/api/saas/contratos'] });
      setShowForm(false);
      setEditing(null);
    },
  });

  const deleteMut = useMutation({
    mutationFn: (id: number) => apiRequest('DELETE', `/api/saas/contratos/${id}`, {}),
    onSuccess: () => {
      toast({ title: 'Contrato removido' });
      queryClient.invalidateQueries({ queryKey: ['/api/saas/contratos'] });
    },
  });

  function openNew() {
    setEditing(null);
    setForm({ empresaId: '', planoId: '', valorContrato: '', tipoContrato: 'mensal', status: 'ativo', dataFim: '', observacoes: '', bancoDestinoId: '', indiceReajuste: '0' });
    setShowForm(true);
  }

  function openEdit(c: any) {
    setEditing(c);
    setForm({
      empresaId: String(c.empresaId), planoId: String(c.planoId ?? ''), valorContrato: c.valorContrato,
      tipoContrato: c.tipoContrato, status: c.status, dataFim: c.dataFim ? c.dataFim.split('T')[0] : '',
      observacoes: c.observacoes ?? '', bancoDestinoId: String(c.bancoDestinoId ?? ''), indiceReajuste: c.indiceReajuste ?? '0',
    });
    setShowForm(true);
  }

  function handleSubmit() {
    const data: any = {
      empresaId: parseInt(form.empresaId),
      valorContrato: form.valorContrato,
      tipoContrato: form.tipoContrato,
      status: form.status,
      observacoes: form.observacoes || null,
      indiceReajuste: form.indiceReajuste,
    };
    if (form.planoId) data.planoId = parseInt(form.planoId);
    if (form.dataFim) data.dataFim = new Date(form.dataFim);
    if (form.bancoDestinoId) data.bancoDestinoId = parseInt(form.bancoDestinoId);

    if (editing) updateMut.mutate({ id: editing.id, data });
    else createMut.mutate(data);
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h2 className="text-sm font-semibold text-muted-foreground">{contratos.length} contrato(s)</h2>
        <Button type="button" size="sm" onClick={openNew} data-testid="button-new-contrato">
          <Plus className="w-4 h-4 mr-1" /> Novo Contrato
        </Button>
      </div>

      {isLoading ? (
        <div className="text-center py-8 text-muted-foreground">Carregando contratos...</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border/30">
                <th className="text-left py-2 pr-4 font-medium text-muted-foreground">Empresa</th>
                <th className="text-left py-2 pr-4 font-medium text-muted-foreground">Plano</th>
                <th className="text-left py-2 pr-4 font-medium text-muted-foreground">Valor</th>
                <th className="text-left py-2 pr-4 font-medium text-muted-foreground">Tipo</th>
                <th className="text-left py-2 pr-4 font-medium text-muted-foreground">Status</th>
                <th className="text-left py-2 font-medium text-muted-foreground">Ações</th>
              </tr>
            </thead>
            <tbody>
              {contratos.map((c: any) => {
                const emp = (companies as any[]).find(e => e.id === c.empresaId);
                const plano = (planos as any[]).find(p => p.id === c.planoId);
                return (
                  <tr key={c.id} className="border-b border-border/20 hover:bg-muted/30" data-testid={`row-contrato-${c.id}`}>
                    <td className="py-2 pr-4 font-medium">{emp?.companyName ?? emp?.name ?? `Empresa #${c.empresaId}`}</td>
                    <td className="py-2 pr-4 text-muted-foreground">{plano?.nome ?? '—'}</td>
                    <td className="py-2 pr-4">R$ {parseFloat(c.valorContrato).toFixed(2).replace('.', ',')}</td>
                    <td className="py-2 pr-4"><StatusBadge status={c.tipoContrato} /></td>
                    <td className="py-2 pr-4"><StatusBadge status={c.status} /></td>
                    <td className="py-2">
                      <div className="flex gap-1">
                        <Button type="button" variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => openEdit(c)} data-testid={`button-edit-contrato-${c.id}`}>
                          <Pencil className="w-3 h-3" />
                        </Button>
                        <Button type="button" variant="ghost" size="sm" className="h-7 w-7 p-0 text-red-500 hover:text-red-700" onClick={() => deleteMut.mutate(c.id)} data-testid={`button-delete-contrato-${c.id}`}>
                          <Trash2 className="w-3 h-3" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {contratos.length === 0 && (
            <div className="text-center py-8 text-muted-foreground">Nenhum contrato cadastrado</div>
          )}
        </div>
      )}

      <Dialog open={showForm} onOpenChange={setShowForm}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editing ? 'Editar Contrato' : 'Novo Contrato'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Empresa *</Label>
              <Select value={form.empresaId} onValueChange={v => setForm(f => ({ ...f, empresaId: v }))}>
                <SelectTrigger data-testid="select-empresa"><SelectValue placeholder="Selecionar empresa" /></SelectTrigger>
                <SelectContent>
                  {(companies as any[]).map(e => <SelectItem key={e.id} value={String(e.id)}>{e.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Plano</Label>
              <Select value={form.planoId} onValueChange={v => setForm(f => ({ ...f, planoId: v }))}>
                <SelectTrigger data-testid="select-plano"><SelectValue placeholder="Selecionar plano" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Sem plano específico</SelectItem>
                  {(planos as any[]).map(p => <SelectItem key={p.id} value={String(p.id)}>{p.nome}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Valor do Contrato *</Label>
                <Input value={form.valorContrato} onChange={e => setForm(f => ({ ...f, valorContrato: e.target.value }))} placeholder="0.00" data-testid="input-valor-contrato" />
              </div>
              <div>
                <Label>Tipo</Label>
                <Select value={form.tipoContrato} onValueChange={v => setForm(f => ({ ...f, tipoContrato: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="mensal">Mensal</SelectItem>
                    <SelectItem value="anual">Anual</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Status</Label>
                <Select value={form.status} onValueChange={v => setForm(f => ({ ...f, status: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ativo">Ativo</SelectItem>
                    <SelectItem value="suspenso">Suspenso</SelectItem>
                    <SelectItem value="cancelado">Cancelado</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Data de Encerramento</Label>
                <Input type="date" value={form.dataFim} onChange={e => setForm(f => ({ ...f, dataFim: e.target.value }))} data-testid="input-data-fim" />
              </div>
            </div>
            <div>
              <Label>Banco de Destino</Label>
              <Select value={form.bancoDestinoId} onValueChange={v => setForm(f => ({ ...f, bancoDestinoId: v }))}>
                <SelectTrigger><SelectValue placeholder="Selecionar banco" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Nenhum banco</SelectItem>
                  {(bancos as any[]).map((b: any) => <SelectItem key={b.id} value={String(b.id)}>{b.nomeBanco}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Observações</Label>
              <Input value={form.observacoes} onChange={e => setForm(f => ({ ...f, observacoes: e.target.value }))} placeholder="Opcional" data-testid="input-obs-contrato" />
            </div>
            <div className="flex gap-2 pt-2">
              <Button type="button" variant="outline" className="flex-1" onClick={() => setShowForm(false)}>Cancelar</Button>
              <Button type="button" className="flex-1" onClick={handleSubmit} disabled={createMut.isPending || updateMut.isPending} data-testid="button-save-contrato">
                {(createMut.isPending || updateMut.isPending) ? 'Salvando...' : 'Salvar'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function FaturasTab() {
  const { toast } = useToast();
  const { data: faturas = [], isLoading } = useQuery<any[]>({ queryKey: ['/api/saas/faturas'] });
  const { data: companies = [] } = useQuery<any[]>({ queryKey: ['/api/companies'], select: normalizeList });
  const { data: contratos = [] } = useQuery<any[]>({ queryKey: ['/api/saas/contratos'] });
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ empresaId: '', contratoId: '', valor: '', dataVencimento: '', status: 'pendente', metodoPagamento: '', observacoes: '' });

  const createMut = useMutation({
    mutationFn: (data: any) => apiRequest('POST', '/api/saas/faturas', data),
    onSuccess: () => {
      toast({ title: 'Fatura criada' });
      queryClient.invalidateQueries({ queryKey: ['/api/saas/faturas'] });
      setShowForm(false);
    },
  });

  const updateStatusMut = useMutation({
    mutationFn: ({ id, status }: any) => apiRequest('PATCH', `/api/saas/faturas/${id}`, { status, dataPagamento: status === 'pago' ? new Date() : undefined }),
    onSuccess: () => {
      toast({ title: 'Fatura atualizada' });
      queryClient.invalidateQueries({ queryKey: ['/api/saas/faturas'] });
    },
  });

  const deleteMut = useMutation({
    mutationFn: (id: number) => apiRequest('DELETE', `/api/saas/faturas/${id}`, {}),
    onSuccess: () => {
      toast({ title: 'Fatura removida' });
      queryClient.invalidateQueries({ queryKey: ['/api/saas/faturas'] });
    },
  });

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h2 className="text-sm font-semibold text-muted-foreground">{faturas.length} fatura(s)</h2>
        <Button type="button" size="sm" onClick={() => setShowForm(true)} data-testid="button-new-fatura">
          <Plus className="w-4 h-4 mr-1" /> Nova Fatura
        </Button>
      </div>

      {isLoading ? (
        <div className="text-center py-8 text-muted-foreground">Carregando faturas...</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border/30">
                <th className="text-left py-2 pr-4 font-medium text-muted-foreground">Empresa</th>
                <th className="text-left py-2 pr-4 font-medium text-muted-foreground">Valor</th>
                <th className="text-left py-2 pr-4 font-medium text-muted-foreground">Vencimento</th>
                <th className="text-left py-2 pr-4 font-medium text-muted-foreground">Método</th>
                <th className="text-left py-2 pr-4 font-medium text-muted-foreground">Status</th>
                <th className="text-left py-2 font-medium text-muted-foreground">Ações</th>
              </tr>
            </thead>
            <tbody>
              {faturas.map((f: any) => {
                const emp = (companies as any[]).find(e => e.id === f.empresaId);
                return (
                  <tr key={f.id} className="border-b border-border/20 hover:bg-muted/30" data-testid={`row-fatura-${f.id}`}>
                    <td className="py-2 pr-4 font-medium">{emp?.companyName ?? emp?.name ?? `Empresa #${f.empresaId}`}</td>
                    <td className="py-2 pr-4">R$ {parseFloat(f.valor).toFixed(2).replace('.', ',')}</td>
                    <td className="py-2 pr-4 text-muted-foreground">{new Date(f.dataVencimento).toLocaleDateString('pt-BR')}</td>
                    <td className="py-2 pr-4 text-muted-foreground">{f.metodoPagamento ?? '—'}</td>
                    <td className="py-2 pr-4"><StatusBadge status={f.status} /></td>
                    <td className="py-2">
                      <div className="flex gap-1">
                        {f.status === 'pendente' && (
                          <Button type="button" variant="outline" size="sm" className="h-7 text-xs border-green-200 text-green-700 hover:bg-green-50" onClick={() => updateStatusMut.mutate({ id: f.id, status: 'pago' })} data-testid={`button-pagar-fatura-${f.id}`}>
                            Pagar
                          </Button>
                        )}
                        <Button type="button" variant="ghost" size="sm" className="h-7 w-7 p-0 text-red-500 hover:text-red-700" onClick={() => deleteMut.mutate(f.id)} data-testid={`button-delete-fatura-${f.id}`}>
                          <Trash2 className="w-3 h-3" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {faturas.length === 0 && <div className="text-center py-8 text-muted-foreground">Nenhuma fatura cadastrada</div>}
        </div>
      )}

      <Dialog open={showForm} onOpenChange={setShowForm}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Nova Fatura SaaS</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Empresa *</Label>
              <Select value={form.empresaId} onValueChange={v => setForm(f => ({ ...f, empresaId: v }))}>
                <SelectTrigger data-testid="select-empresa-fatura"><SelectValue placeholder="Selecionar empresa" /></SelectTrigger>
                <SelectContent>
                  {(companies as any[]).map(e => <SelectItem key={e.id} value={String(e.id)}>{e.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Valor *</Label>
                <Input value={form.valor} onChange={e => setForm(f => ({ ...f, valor: e.target.value }))} placeholder="0.00" data-testid="input-valor-fatura" />
              </div>
              <div>
                <Label>Vencimento *</Label>
                <Input type="date" value={form.dataVencimento} onChange={e => setForm(f => ({ ...f, dataVencimento: e.target.value }))} data-testid="input-vencimento-fatura" />
              </div>
            </div>
            <div>
              <Label>Método de Pagamento</Label>
              <Select value={form.metodoPagamento} onValueChange={v => setForm(f => ({ ...f, metodoPagamento: v }))}>
                <SelectTrigger><SelectValue placeholder="Selecionar método" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="pix">PIX</SelectItem>
                  <SelectItem value="boleto">Boleto</SelectItem>
                  <SelectItem value="cartao">Cartão</SelectItem>
                  <SelectItem value="transferencia">Transferência</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Observações</Label>
              <Input value={form.observacoes} onChange={e => setForm(f => ({ ...f, observacoes: e.target.value }))} placeholder="Opcional" />
            </div>
            <div className="flex gap-2 pt-2">
              <Button type="button" variant="outline" className="flex-1" onClick={() => setShowForm(false)}>Cancelar</Button>
              <Button type="button" className="flex-1" onClick={() => createMut.mutate({
                empresaId: parseInt(form.empresaId),
                valor: form.valor,
                dataVencimento: new Date(form.dataVencimento),
                status: 'pendente',
                metodoPagamento: form.metodoPagamento || null,
                observacoes: form.observacoes || null,
              })} disabled={createMut.isPending || !form.empresaId || !form.valor || !form.dataVencimento} data-testid="button-save-fatura">
                {createMut.isPending ? 'Salvando...' : 'Salvar'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function BancosTab() {
  const { toast } = useToast();
  const { data: bancos = [], isLoading } = useQuery<any[]>({ queryKey: ['/api/saas/bancos'] });
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [form, setForm] = useState({ nomeBanco: '', tipoIntegracao: 'manual', agencia: '', conta: '', chavePix: '', status: 'ativo' });

  const createMut = useMutation({
    mutationFn: (data: any) => apiRequest('POST', '/api/saas/bancos', data),
    onSuccess: () => {
      toast({ title: 'Banco cadastrado' });
      queryClient.invalidateQueries({ queryKey: ['/api/saas/bancos'] });
      setShowForm(false);
    },
  });

  const updateMut = useMutation({
    mutationFn: ({ id, data }: any) => apiRequest('PATCH', `/api/saas/bancos/${id}`, data),
    onSuccess: () => {
      toast({ title: 'Banco atualizado' });
      queryClient.invalidateQueries({ queryKey: ['/api/saas/bancos'] });
      setShowForm(false);
      setEditing(null);
    },
  });

  const deleteMut = useMutation({
    mutationFn: (id: number) => apiRequest('DELETE', `/api/saas/bancos/${id}`, {}),
    onSuccess: () => {
      toast({ title: 'Banco removido' });
      queryClient.invalidateQueries({ queryKey: ['/api/saas/bancos'] });
    },
  });

  function openNew() {
    setEditing(null);
    setForm({ nomeBanco: '', tipoIntegracao: 'manual', agencia: '', conta: '', chavePix: '', status: 'ativo' });
    setShowForm(true);
  }

  function openEdit(b: any) {
    setEditing(b);
    setForm({ nomeBanco: b.nomeBanco, tipoIntegracao: b.tipoIntegracao, agencia: b.agencia ?? '', conta: b.conta ?? '', chavePix: b.chavePix ?? '', status: b.status });
    setShowForm(true);
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h2 className="text-sm font-semibold text-muted-foreground">{bancos.length} banco(s) configurado(s)</h2>
        <Button type="button" size="sm" onClick={openNew} data-testid="button-new-banco">
          <Plus className="w-4 h-4 mr-1" /> Novo Banco
        </Button>
      </div>

      {isLoading ? (
        <div className="text-center py-8 text-muted-foreground">Carregando bancos...</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {bancos.map((b: any) => (
            <Card key={b.id} className="border border-border/50" data-testid={`card-banco-${b.id}`}>
              <CardContent className="pt-4 pb-4">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center">
                      <Banknote className="w-5 h-5 text-blue-600" />
                    </div>
                    <div>
                      <p className="font-semibold text-sm">{b.nomeBanco}</p>
                      <p className="text-xs text-muted-foreground capitalize">{b.tipoIntegracao}</p>
                      {b.agencia && <p className="text-xs text-muted-foreground">Ag: {b.agencia} | CC: {b.conta}</p>}
                      {b.chavePix && <p className="text-xs text-muted-foreground">PIX: {b.chavePix}</p>}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <StatusBadge status={b.status} />
                    <Button type="button" variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => openEdit(b)} data-testid={`button-edit-banco-${b.id}`}>
                      <Pencil className="w-3 h-3" />
                    </Button>
                    <Button type="button" variant="ghost" size="sm" className="h-7 w-7 p-0 text-red-500" onClick={() => deleteMut.mutate(b.id)} data-testid={`button-delete-banco-${b.id}`}>
                      <Trash2 className="w-3 h-3" />
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
          {bancos.length === 0 && <div className="col-span-2 text-center py-8 text-muted-foreground">Nenhum banco configurado</div>}
        </div>
      )}

      <Dialog open={showForm} onOpenChange={setShowForm}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>{editing ? 'Editar Banco' : 'Novo Banco de Recebimento'}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Nome do Banco *</Label>
              <Input value={form.nomeBanco} onChange={e => setForm(f => ({ ...f, nomeBanco: e.target.value }))} placeholder="Ex: Itaú, Bradesco, Caixa" data-testid="input-nome-banco" />
            </div>
            <div>
              <Label>Tipo de Integração</Label>
              <Select value={form.tipoIntegracao} onValueChange={v => setForm(f => ({ ...f, tipoIntegracao: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="manual">Manual</SelectItem>
                  <SelectItem value="pix">PIX</SelectItem>
                  <SelectItem value="itau">Itaú API</SelectItem>
                  <SelectItem value="bradesco">Bradesco</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Agência</Label>
                <Input value={form.agencia} onChange={e => setForm(f => ({ ...f, agencia: e.target.value }))} placeholder="0001" data-testid="input-agencia" />
              </div>
              <div>
                <Label>Conta</Label>
                <Input value={form.conta} onChange={e => setForm(f => ({ ...f, conta: e.target.value }))} placeholder="12345-6" data-testid="input-conta" />
              </div>
            </div>
            <div>
              <Label>Chave PIX</Label>
              <Input value={form.chavePix} onChange={e => setForm(f => ({ ...f, chavePix: e.target.value }))} placeholder="CNPJ, e-mail ou telefone" data-testid="input-chave-pix" />
            </div>
            <div>
              <Label>Status</Label>
              <Select value={form.status} onValueChange={v => setForm(f => ({ ...f, status: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="ativo">Ativo</SelectItem>
                  <SelectItem value="inativo">Inativo</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex gap-2 pt-2">
              <Button type="button" variant="outline" className="flex-1" onClick={() => setShowForm(false)}>Cancelar</Button>
              <Button type="button" className="flex-1" onClick={() => {
                const data = { nomeBanco: form.nomeBanco, tipoIntegracao: form.tipoIntegracao, agencia: form.agencia || null, conta: form.conta || null, chavePix: form.chavePix || null, status: form.status };
                if (editing) updateMut.mutate({ id: editing.id, data });
                else createMut.mutate(data);
              }} disabled={createMut.isPending || updateMut.isPending || !form.nomeBanco} data-testid="button-save-banco">
                {(createMut.isPending || updateMut.isPending) ? 'Salvando...' : 'Salvar'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ModulosTab() {
  const { toast } = useToast();
  const { data: modulos = [], isLoading } = useQuery<any[]>({ queryKey: ['/api/saas/modulos'] });
  const { data: planos = [] } = useQuery<any[]>({ queryKey: ['/api/master/planos'] });
  const [selectedPlano, setSelectedPlano] = useState<string>('none');
  const { data: planoModulos = [], refetch: refetchPlanoModulos } = useQuery<any[]>({
    queryKey: ['/api/saas/planos', selectedPlano, 'modulos'],
    enabled: selectedPlano !== 'none',
  });
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [form, setForm] = useState({ chave: '', nomeModulo: '', rota: '', descricao: '', icone: '', categoria: 'geral' });
  const [checkedModulos, setCheckedModulos] = useState<Set<number>>(new Set());

  const planoModuloIds = new Set((planoModulos as any[]).map((m: any) => m.id));

  const createMut = useMutation({
    mutationFn: (data: any) => apiRequest('POST', '/api/saas/modulos', data),
    onSuccess: () => { toast({ title: 'Módulo criado' }); queryClient.invalidateQueries({ queryKey: ['/api/saas/modulos'] }); setShowForm(false); },
  });
  const updateMut = useMutation({
    mutationFn: ({ id, data }: any) => apiRequest('PATCH', `/api/saas/modulos/${id}`, data),
    onSuccess: () => { toast({ title: 'Módulo atualizado' }); queryClient.invalidateQueries({ queryKey: ['/api/saas/modulos'] }); setShowForm(false); setEditing(null); },
  });
  const deleteMut = useMutation({
    mutationFn: (id: number) => apiRequest('DELETE', `/api/saas/modulos/${id}`, {}),
    onSuccess: () => { toast({ title: 'Módulo removido' }); queryClient.invalidateQueries({ queryKey: ['/api/saas/modulos'] }); },
  });
  const seedMut = useMutation({
    mutationFn: () => apiRequest('POST', '/api/saas/seed-modulos', {}),
    onSuccess: async (res) => { const d = await res.json(); toast({ title: d.message }); queryClient.invalidateQueries({ queryKey: ['/api/saas/modulos'] }); },
  });
  const savePlanoModulosMut = useMutation({
    mutationFn: ({ planoId, ids }: any) => apiRequest('POST', `/api/saas/planos/${planoId}/modulos`, { moduloIds: ids }),
    onSuccess: () => { toast({ title: 'Módulos do plano salvos' }); refetchPlanoModulos(); },
  });

  function openNew() { setEditing(null); setForm({ chave: '', nomeModulo: '', rota: '', descricao: '', icone: '', categoria: 'geral' }); setShowForm(true); }
  function openEdit(m: any) { setEditing(m); setForm({ chave: m.chave, nomeModulo: m.nomeModulo, rota: m.rota ?? '', descricao: m.descricao ?? '', icone: m.icone ?? '', categoria: m.categoria ?? 'geral' }); setShowForm(true); }

  function handleSave() {
    const data = { chave: form.chave, nomeModulo: form.nomeModulo, rota: form.rota || null, descricao: form.descricao || null, icone: form.icone || null, categoria: form.categoria };
    if (editing) updateMut.mutate({ id: editing.id, data });
    else createMut.mutate(data);
  }

  function toggleModulo(id: number) {
    setCheckedModulos(prev => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  }

  function initPlanoChecks() {
    setCheckedModulos(new Set((planoModulos as any[]).map((m: any) => m.id)));
  }

  return (
    <div className="space-y-6">
      {/* Módulos do Sistema */}
      <div className="flex justify-between items-center">
        <h2 className="text-sm font-semibold text-muted-foreground">{(modulos as any[]).length} módulo(s) cadastrado(s)</h2>
        <div className="flex gap-2">
          {(modulos as any[]).length === 0 && (
            <Button type="button" variant="outline" size="sm" onClick={() => seedMut.mutate()} disabled={seedMut.isPending} data-testid="button-seed-modulos">
              <Zap className="w-4 h-4 mr-1" />
              {seedMut.isPending ? 'Criando...' : 'Criar Módulos Padrão'}
            </Button>
          )}
          <Button type="button" size="sm" onClick={openNew} data-testid="button-new-modulo">
            <Plus className="w-4 h-4 mr-1" /> Novo Módulo
          </Button>
        </div>
      </div>

      {isLoading ? (
        <div className="text-center py-8 text-muted-foreground">Carregando...</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {(modulos as any[]).map((m: any) => (
            <Card key={m.id} className="border border-border/50" data-testid={`card-modulo-${m.id}`}>
              <CardContent className="pt-3 pb-3">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="font-semibold text-sm">{m.nomeModulo}</p>
                    <p className="text-xs text-muted-foreground font-mono">{m.chave}</p>
                    {m.rota && <p className="text-xs text-blue-600">{m.rota}</p>}
                    <Badge className="text-xs mt-1 bg-gray-100 text-gray-700 border-gray-200">{m.categoria}</Badge>
                  </div>
                  <div className="flex gap-1">
                    <Button type="button" variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => openEdit(m)} data-testid={`button-edit-modulo-${m.id}`}>
                      <Pencil className="w-3 h-3" />
                    </Button>
                    <Button type="button" variant="ghost" size="sm" className="h-7 w-7 p-0 text-red-500" onClick={() => deleteMut.mutate(m.id)} data-testid={`button-delete-modulo-${m.id}`}>
                      <Trash2 className="w-3 h-3" />
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
          {(modulos as any[]).length === 0 && (
            <div className="col-span-3 text-center py-8 text-muted-foreground">
              <Puzzle className="w-8 h-8 mx-auto mb-2 opacity-40" />
              Nenhum módulo cadastrado. Clique em "Criar Módulos Padrão" para adicionar os módulos do sistema.
            </div>
          )}
        </div>
      )}

      {/* Configurar Módulos por Plano */}
      {(modulos as any[]).length > 0 && (
        <Card className="border border-border/50">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <Shield className="w-4 h-4 text-violet-600" />
              Configurar Módulos por Plano
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label>Selecionar Plano</Label>
              <Select value={selectedPlano} onValueChange={(v) => { setSelectedPlano(v); setCheckedModulos(new Set()); }} >
                <SelectTrigger data-testid="select-plano-modulos"><SelectValue placeholder="Selecione um plano" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">— Selecione —</SelectItem>
                  {(planos as any[]).map((p: any) => (
                    <SelectItem key={p.id} value={String(p.id)}>{p.nome} ({p.tipoPlano ?? 'premium'})</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {selectedPlano !== 'none' && (
              <>
                <div className="flex justify-between items-center">
                  <p className="text-xs text-muted-foreground">Selecione os módulos incluídos neste plano:</p>
                  <Button type="button" variant="outline" size="sm" onClick={initPlanoChecks} data-testid="button-load-modulos-plano">
                    <RefreshCw className="w-3 h-3 mr-1" /> Carregar Atuais
                  </Button>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                  {(modulos as any[]).map((m: any) => (
                    <label key={m.id} className="flex items-center gap-2 p-2 rounded-lg hover:bg-muted/50 cursor-pointer" data-testid={`check-modulo-${m.chave}`}>
                      <Checkbox
                        checked={checkedModulos.size > 0 ? checkedModulos.has(m.id) : planoModuloIds.has(m.id)}
                        onCheckedChange={() => { if (checkedModulos.size === 0) initPlanoChecks(); toggleModulo(m.id); }}
                      />
                      <span className="text-sm">{m.nomeModulo}</span>
                    </label>
                  ))}
                </div>
                <Button
                  type="button"
                  className="w-full"
                  onClick={() => savePlanoModulosMut.mutate({ planoId: selectedPlano, ids: checkedModulos.size > 0 ? Array.from(checkedModulos) : Array.from(planoModuloIds) })}
                  disabled={savePlanoModulosMut.isPending}
                  data-testid="button-save-plano-modulos"
                >
                  {savePlanoModulosMut.isPending ? 'Salvando...' : 'Salvar Módulos do Plano'}
                </Button>
              </>
            )}
          </CardContent>
        </Card>
      )}

      {/* Form Modal */}
      <Dialog open={showForm} onOpenChange={setShowForm}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>{editing ? 'Editar Módulo' : 'Novo Módulo do Sistema'}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Chave única *</Label>
                <Input value={form.chave} onChange={e => setForm(f => ({ ...f, chave: e.target.value.toLowerCase().replace(/\s/g,'_') }))} placeholder="ex: logistica_ia" data-testid="input-chave-modulo" />
              </div>
              <div>
                <Label>Categoria</Label>
                <Select value={form.categoria} onValueChange={v => setForm(f => ({ ...f, categoria: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="geral">Geral</SelectItem>
                    <SelectItem value="logistica">Logística</SelectItem>
                    <SelectItem value="financeiro">Financeiro</SelectItem>
                    <SelectItem value="admin">Admin</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <Label>Nome do Módulo *</Label>
              <Input value={form.nomeModulo} onChange={e => setForm(f => ({ ...f, nomeModulo: e.target.value }))} placeholder="Ex: Logística Inteligente" data-testid="input-nome-modulo" />
            </div>
            <div>
              <Label>Rota no frontend</Label>
              <Input value={form.rota} onChange={e => setForm(f => ({ ...f, rota: e.target.value }))} placeholder="/admin/logistics-intelligence" data-testid="input-rota-modulo" />
            </div>
            <div>
              <Label>Descrição</Label>
              <Input value={form.descricao} onChange={e => setForm(f => ({ ...f, descricao: e.target.value }))} placeholder="Breve descrição" data-testid="input-descricao-modulo" />
            </div>
            <div className="flex gap-2 pt-2">
              <Button type="button" variant="outline" className="flex-1" onClick={() => setShowForm(false)}>Cancelar</Button>
              <Button type="button" className="flex-1" onClick={handleSave} disabled={createMut.isPending || updateMut.isPending || !form.chave || !form.nomeModulo} data-testid="button-save-modulo">
                {(createMut.isPending || updateMut.isPending) ? 'Salvando...' : 'Salvar'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function AssinaturasTab() {
  const { toast } = useToast();
  const { data: assinaturas = [], isLoading, refetch } = useQuery<any[]>({ queryKey: ['/api/master/assinaturas'] });
  const { data: planos = [] } = useQuery<any[]>({ queryKey: ['/api/master/planos'] });
  const { data: companies = [] } = useQuery<any[]>({ queryKey: ['/api/companies'], select: normalizeList });
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [showPagamento, setShowPagamento] = useState<any>(null);
  const [showUpgrade, setShowUpgrade] = useState<any>(null);
  const [pagResult, setPagResult] = useState<any>(null);
  const [metodo, setMetodo] = useState('pix');
  const [novoPlanoId, setNovoPlanoId] = useState('none');
  const [form, setForm] = useState({ companyId: 'none', planoId: 'none', status: 'trial', valor: '', observacoes: '' });

  const createMut = useMutation({
    mutationFn: (data: any) => apiRequest('POST', '/api/master/assinaturas', data),
    onSuccess: () => { toast({ title: 'Assinatura criada' }); queryClient.invalidateQueries({ queryKey: ['/api/master/assinaturas'] }); setShowForm(false); },
  });
  const updateMut = useMutation({
    mutationFn: ({ id, data }: any) => apiRequest('PUT', `/api/master/assinaturas/${id}`, data),
    onSuccess: () => { toast({ title: 'Assinatura atualizada' }); queryClient.invalidateQueries({ queryKey: ['/api/master/assinaturas'] }); setShowForm(false); setEditing(null); },
  });
  const pagarMut = useMutation({
    mutationFn: ({ id, metodo }: any) => apiRequest('POST', `/api/saas/assinaturas/${id}/pagar`, { metodo }),
    onSuccess: async (res) => {
      const data = await res.json();
      setPagResult(data);
      queryClient.invalidateQueries({ queryKey: ['/api/master/assinaturas'] });
      toast({ title: 'Pagamento processado', description: data.mensagem ?? data.instrucao });
    },
  });
  const upgradeMut = useMutation({
    mutationFn: ({ id, novoPlanoId, metodo }: any) => apiRequest('POST', `/api/saas/assinaturas/${id}/upgrade`, { novoPlanoId: parseInt(novoPlanoId), metodo }),
    onSuccess: async (res) => {
      const data = await res.json();
      toast({ title: `Upgrade para ${data.plano?.nome} realizado!` });
      queryClient.invalidateQueries({ queryKey: ['/api/master/assinaturas'] });
      setShowUpgrade(null);
    },
  });
  const checkBoletosMut = useMutation({
    mutationFn: () => apiRequest('POST', '/api/saas/check-boletos', {}),
    onSuccess: async (res) => { const d = await res.json(); toast({ title: `Checker executado`, description: `${d.atrasadas} atrasadas, ${d.downgrades} downgrades` }); refetch(); },
  });
  const confirmarPixMut = useMutation({
    mutationFn: (id: number) => apiRequest('POST', `/api/saas/assinaturas/${id}/confirmar-pix`, {}),
    onSuccess: () => { toast({ title: 'PIX confirmado' }); queryClient.invalidateQueries({ queryKey: ['/api/master/assinaturas'] }); setPagResult(null); },
  });

  function openNew() { setEditing(null); setForm({ companyId: 'none', planoId: 'none', status: 'trial', valor: '', observacoes: '' }); setShowForm(true); }
  function openEdit(a: any) { setEditing(a); setForm({ companyId: String(a.companyId), planoId: String(a.planoId ?? 'none'), status: a.status, valor: a.valor ?? '', observacoes: a.observacoes ?? '' }); setShowForm(true); }

  const statusColor: Record<string, string> = {
    ativa: 'bg-green-100 text-green-800 border-green-200',
    trial: 'bg-blue-100 text-blue-800 border-blue-200',
    inadimplente: 'bg-red-100 text-red-800 border-red-200',
    atrasada: 'bg-orange-100 text-orange-800 border-orange-200',
    cancelada: 'bg-gray-100 text-gray-700 border-gray-200',
    suspensa: 'bg-yellow-100 text-yellow-800 border-yellow-200',
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h2 className="text-sm font-semibold text-muted-foreground">{(assinaturas as any[]).length} assinatura(s)</h2>
        <div className="flex gap-2">
          <Button type="button" variant="outline" size="sm" onClick={() => checkBoletosMut.mutate()} disabled={checkBoletosMut.isPending} data-testid="button-check-boletos">
            <RefreshCw className="w-4 h-4 mr-1" />
            {checkBoletosMut.isPending ? 'Verificando...' : 'Verificar Vencimentos'}
          </Button>
          <Button type="button" size="sm" onClick={openNew} data-testid="button-new-assinatura">
            <Plus className="w-4 h-4 mr-1" /> Nova Assinatura
          </Button>
        </div>
      </div>

      {isLoading ? (
        <div className="text-center py-8 text-muted-foreground">Carregando...</div>
      ) : (
        <div className="space-y-3">
          {(assinaturas as any[]).map((a: any) => {
            const empresa = (companies as any[]).find(c => c.id === a.companyId);
            const plano = (planos as any[]).find(p => p.id === a.planoId);
            return (
              <Card key={a.id} className="border border-border/50" data-testid={`card-assinatura-${a.id}`}>
                <CardContent className="pt-4 pb-4">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="font-semibold text-sm">{empresa?.companyName ?? empresa?.name ?? `Empresa #${a.companyId}`}</p>
                        <Badge className={`text-xs border ${statusColor[a.status] ?? 'bg-gray-100 text-gray-700 border-gray-200'}`}>{a.status}</Badge>
                        {plano && <Badge className="text-xs border bg-violet-100 text-violet-800 border-violet-200">{plano.nome}</Badge>}
                        {a.metodoPagamento && <Badge className="text-xs border bg-blue-100 text-blue-800 border-blue-200">{a.metodoPagamento}</Badge>}
                      </div>
                      <div className="mt-1 text-xs text-muted-foreground flex flex-wrap gap-3">
                        {a.valor && <span>R$ {parseFloat(a.valor).toFixed(2).replace('.', ',')}/mês</span>}
                        {a.dataVencimento && <span>Vence: {new Date(a.dataVencimento).toLocaleDateString('pt-BR')}</span>}
                        {a.dataPagamento && <span>Pago: {new Date(a.dataPagamento).toLocaleDateString('pt-BR')}</span>}
                        {a.linhaDigitavel && <span className="font-mono text-xs truncate max-w-[200px]" title={a.linhaDigitavel}>Boleto: {a.linhaDigitavel.slice(0,20)}…</span>}
                      </div>
                      {a.pixQrCode && (
                        <div className="mt-2 text-xs">
                          <span className="text-green-700 font-medium">PIX aguardando confirmação</span>
                          {' · '}
                          <button type="button" className="text-blue-600 underline" onClick={() => navigator.clipboard.writeText(a.pixQrCode)}>Copiar QR Code</button>
                        </div>
                      )}
                    </div>
                    <div className="flex gap-1 flex-wrap justify-end">
                      <Button type="button" variant="outline" size="sm" className="h-7 text-xs" onClick={() => { setShowPagamento(a); setPagResult(null); setMetodo('pix'); }} data-testid={`button-pagar-${a.id}`}>
                        <CreditCard className="w-3 h-3 mr-1" /> Pagar
                      </Button>
                      <Button type="button" variant="outline" size="sm" className="h-7 text-xs border-violet-200 text-violet-700" onClick={() => { setShowUpgrade(a); setNovoPlanoId('none'); }} data-testid={`button-upgrade-${a.id}`}>
                        <TrendingUp className="w-3 h-3 mr-1" /> Upgrade
                      </Button>
                      <Button type="button" variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => openEdit(a)} data-testid={`button-edit-assinatura-${a.id}`}>
                        <Pencil className="w-3 h-3" />
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
          {(assinaturas as any[]).length === 0 && <div className="text-center py-8 text-muted-foreground">Nenhuma assinatura cadastrada</div>}
        </div>
      )}

      {/* Modal Pagamento */}
      <Dialog open={!!showPagamento} onOpenChange={(o) => { if (!o) { setShowPagamento(null); setPagResult(null); } }}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Processar Pagamento</DialogTitle></DialogHeader>
          {!pagResult ? (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Assinatura de <strong>{(companies as any[]).find(c => c.id === showPagamento?.companyId)?.companyName ?? `Empresa #${showPagamento?.companyId}`}</strong>
                {showPagamento?.valor && ` — R$ ${parseFloat(showPagamento.valor).toFixed(2).replace('.', ',')}`}
              </p>
              <div>
                <Label>Método de Pagamento</Label>
                <Select value={metodo} onValueChange={setMetodo}>
                  <SelectTrigger data-testid="select-metodo-pagamento"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="pix">PIX</SelectItem>
                    <SelectItem value="cartao">Cartão de Crédito</SelectItem>
                    <SelectItem value="boleto">Boleto Bancário</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {metodo === 'pix' && <p className="text-xs text-muted-foreground bg-green-50 border border-green-200 rounded-lg p-3">Um QR Code PIX será gerado. O acesso será liberado após confirmação manual do pagamento.</p>}
              {metodo === 'cartao' && <p className="text-xs text-muted-foreground bg-blue-50 border border-blue-200 rounded-lg p-3">O pagamento via cartão é processado imediatamente e a assinatura é ativada automaticamente.</p>}
              {metodo === 'boleto' && <p className="text-xs text-muted-foreground bg-yellow-50 border border-yellow-200 rounded-lg p-3">Um boleto será gerado com vencimento em 30 dias. O acesso temporário é liberado até o vencimento.</p>}
              <div className="flex gap-2">
                <Button type="button" variant="outline" className="flex-1" onClick={() => setShowPagamento(null)}>Cancelar</Button>
                <Button type="button" className="flex-1" onClick={() => pagarMut.mutate({ id: showPagamento.id, metodo })} disabled={pagarMut.isPending} data-testid="button-confirmar-pagamento">
                  {pagarMut.isPending ? 'Processando...' : 'Confirmar Pagamento'}
                </Button>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                <p className="font-semibold text-green-800 mb-1">{pagResult.mensagem ?? 'Pagamento processado'}</p>
                {pagResult.instrucao && <p className="text-sm text-green-700">{pagResult.instrucao}</p>}
                {pagResult.linhaDigitavel && (
                  <div className="mt-3">
                    <p className="text-xs font-medium text-gray-700 mb-1">Linha Digitável:</p>
                    <div className="flex items-center gap-2">
                      <code className="text-xs bg-white border rounded px-2 py-1 flex-1 break-all">{pagResult.linhaDigitavel}</code>
                      <Button type="button" variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => navigator.clipboard.writeText(pagResult.linhaDigitavel)}>
                        <Copy className="w-3 h-3" />
                      </Button>
                    </div>
                  </div>
                )}
                {pagResult.pixQrCode && (
                  <div className="mt-3">
                    <p className="text-xs font-medium text-gray-700 mb-1">Payload PIX:</p>
                    <div className="flex items-center gap-2">
                      <code className="text-xs bg-white border rounded px-2 py-1 flex-1 break-all">{pagResult.pixQrCode.slice(0,60)}…</code>
                      <Button type="button" variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => navigator.clipboard.writeText(pagResult.pixQrCode)}>
                        <Copy className="w-3 h-3" />
                      </Button>
                    </div>
                    <Button type="button" className="mt-2 w-full" variant="outline" size="sm" onClick={() => confirmarPixMut.mutate(showPagamento.id)} disabled={confirmarPixMut.isPending} data-testid="button-confirmar-pix">
                      {confirmarPixMut.isPending ? 'Confirmando...' : 'Confirmar PIX Recebido'}
                    </Button>
                  </div>
                )}
              </div>
              <Button type="button" className="w-full" onClick={() => { setShowPagamento(null); setPagResult(null); }}>Fechar</Button>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Modal Upgrade */}
      <Dialog open={!!showUpgrade} onOpenChange={(o) => { if (!o) setShowUpgrade(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Upgrade de Plano</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Empresa: <strong>{(companies as any[]).find(c => c.id === showUpgrade?.companyId)?.companyName ?? `#${showUpgrade?.companyId}`}</strong>
              {showUpgrade?.planoId && ` · Plano atual: ${(planos as any[]).find(p => p.id === showUpgrade.planoId)?.nome ?? '—'}`}
            </p>
            <div>
              <Label>Novo Plano</Label>
              <Select value={novoPlanoId} onValueChange={setNovoPlanoId}>
                <SelectTrigger data-testid="select-novo-plano"><SelectValue placeholder="Selecione o novo plano" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">— Selecione —</SelectItem>
                  {(planos as any[]).filter(p => p.id !== showUpgrade?.planoId).map((p: any) => (
                    <SelectItem key={p.id} value={String(p.id)}>{p.nome} — R$ {parseFloat(p.preco).toFixed(2).replace('.', ',')}/mês</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Método de Pagamento do Upgrade</Label>
              <Select value={metodo} onValueChange={setMetodo}>
                <SelectTrigger data-testid="select-metodo-upgrade"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="pix">PIX</SelectItem>
                  <SelectItem value="cartao">Cartão (imediato)</SelectItem>
                  <SelectItem value="boleto">Boleto</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex gap-2">
              <Button type="button" variant="outline" className="flex-1" onClick={() => setShowUpgrade(null)}>Cancelar</Button>
              <Button type="button" className="flex-1" onClick={() => upgradeMut.mutate({ id: showUpgrade.id, novoPlanoId, metodo })} disabled={upgradeMut.isPending || novoPlanoId === 'none'} data-testid="button-confirmar-upgrade">
                {upgradeMut.isPending ? 'Processando...' : 'Confirmar Upgrade'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Form Modal */}
      <Dialog open={showForm} onOpenChange={setShowForm}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>{editing ? 'Editar Assinatura' : 'Nova Assinatura'}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Empresa *</Label>
              <Select value={form.companyId} onValueChange={v => setForm(f => ({ ...f, companyId: v }))}>
                <SelectTrigger data-testid="select-empresa-assinatura"><SelectValue placeholder="Selecione a empresa" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">— Selecione —</SelectItem>
                  {(companies as any[]).map((c: any) => (
                    <SelectItem key={c.id} value={String(c.id)}>{c.companyName ?? c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Plano</Label>
              <Select value={form.planoId} onValueChange={v => {
                const plano = (planos as any[]).find(p => String(p.id) === v);
                setForm(f => ({ ...f, planoId: v, valor: plano?.preco ?? f.valor }));
              }}>
                <SelectTrigger data-testid="select-plano-assinatura"><SelectValue placeholder="Selecione o plano" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">— Nenhum —</SelectItem>
                  {(planos as any[]).map((p: any) => (
                    <SelectItem key={p.id} value={String(p.id)}>{p.nome} — R$ {parseFloat(p.preco).toFixed(2).replace('.', ',')}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Status</Label>
                <Select value={form.status} onValueChange={v => setForm(f => ({ ...f, status: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="trial">Trial</SelectItem>
                    <SelectItem value="ativa">Ativa</SelectItem>
                    <SelectItem value="atrasada">Atrasada</SelectItem>
                    <SelectItem value="inadimplente">Inadimplente</SelectItem>
                    <SelectItem value="cancelada">Cancelada</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Valor (R$)</Label>
                <Input type="number" step="0.01" value={form.valor} onChange={e => setForm(f => ({ ...f, valor: e.target.value }))} placeholder="199.00" data-testid="input-valor-assinatura" />
              </div>
            </div>
            <div>
              <Label>Observações</Label>
              <Input value={form.observacoes} onChange={e => setForm(f => ({ ...f, observacoes: e.target.value }))} placeholder="Observações internas" data-testid="input-obs-assinatura" />
            </div>
            <div className="flex gap-2 pt-2">
              <Button type="button" variant="outline" className="flex-1" onClick={() => setShowForm(false)}>Cancelar</Button>
              <Button type="button" className="flex-1" onClick={() => {
                const data: any = {
                  companyId: parseInt(form.companyId),
                  planoId: form.planoId !== 'none' ? parseInt(form.planoId) : null,
                  status: form.status,
                  valor: form.valor || null,
                  observacoes: form.observacoes || null,
                };
                if (editing) updateMut.mutate({ id: editing.id, data });
                else createMut.mutate(data);
              }} disabled={createMut.isPending || updateMut.isPending || form.companyId === 'none'} data-testid="button-save-assinatura">
                {(createMut.isPending || updateMut.isPending) ? 'Salvando...' : 'Salvar'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function GpsTab() {
  const { toast } = useToast();
  const { data: companies = [], isLoading } = useQuery<any[]>({ queryKey: ['/api/companies'], select: normalizeList });
  const { data: assinaturas = [] } = useQuery<any[]>({ queryKey: ['/api/master/assinaturas'] });
  const { data: planos = [] } = useQuery<any[]>({ queryKey: ['/api/master/planos'] });
  const [overrides, setOverrides] = useState<Record<number, boolean>>({});

  const toggleGps = useMutation({
    mutationFn: ({ companyId, enabled }: { companyId: number; enabled: boolean }) =>
      apiRequest('POST', `/api/companies/${companyId}/gps-toggle`, { enabled }),
    onSuccess: (_, vars) => {
      toast({ title: `GPS ${vars.enabled ? 'ativado' : 'desativado'} para a empresa!` });
      setOverrides(prev => ({ ...prev, [vars.companyId]: vars.enabled }));
    },
    onError: (e: any) => toast({ title: 'Erro', description: e.message, variant: 'destructive' }),
  });

  const getCompanyGpsInfo = (companyId: number) => {
    const assinatura = assinaturas.find((a: any) => a.companyId === companyId && a.status === 'ativa');
    const plano = assinatura ? planos.find((p: any) => p.id === assinatura.planoId) : null;
    return { plano, gpsViaPlano: plano?.gpsHabilitado ?? false };
  };

  return (
    <div className="space-y-4">
      <div className="bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-800 rounded-xl p-4">
        <p className="text-sm text-blue-700 dark:text-blue-300 font-medium flex items-center gap-2">
          <MapPin className="w-4 h-4" /> Controle GPS por Empresa
        </p>
        <p className="text-xs text-blue-600 dark:text-blue-400 mt-1">
          Planos Pro e Enterprise incluem GPS automaticamente. Use o toggle para liberar GPS manualmente para empresas em planos inferiores.
        </p>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border/30">
              <th className="text-left py-2 pr-4 font-medium text-muted-foreground">Empresa</th>
              <th className="text-left py-2 pr-4 font-medium text-muted-foreground">Plano</th>
              <th className="text-left py-2 pr-4 font-medium text-muted-foreground">GPS via Plano</th>
              <th className="text-left py-2 pr-4 font-medium text-muted-foreground">Override Manual</th>
              <th className="text-left py-2 font-medium text-muted-foreground">Status GPS</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr><td colSpan={5} className="py-8 text-center text-muted-foreground">Carregando...</td></tr>
            ) : (companies ?? []).map((c: any) => {
              const { plano, gpsViaPlano } = getCompanyGpsInfo(c.id);
              return (
                <tr key={c.id} className="border-b border-border/20 hover:bg-muted/20" data-testid={`row-gps-${c.id}`}>
                  <td className="py-3 pr-4 font-medium">{c.companyName ?? c.name}</td>
                  <td className="py-3 pr-4">
                    {plano ? (
                      <Badge variant="outline" className="text-xs">{plano.nome}</Badge>
                    ) : (
                      <span className="text-muted-foreground text-xs">Sem plano</span>
                    )}
                  </td>
                  <td className="py-3 pr-4">
                    {gpsViaPlano ? (
                      <Badge className="bg-green-100 text-green-800 border-green-200 text-xs">Incluído</Badge>
                    ) : (
                      <Badge variant="outline" className="text-xs text-muted-foreground">Não incluído</Badge>
                    )}
                  </td>
                  <td className="py-3 pr-4">
                    <Switch
                      checked={overrides[c.id] ?? false}
                      onCheckedChange={(checked) => toggleGps.mutate({ companyId: c.id, enabled: checked })}
                      disabled={gpsViaPlano || toggleGps.isPending}
                      data-testid={`switch-gps-${c.id}`}
                    />
                  </td>
                  <td className="py-3">
                    <span className={`text-xs font-medium ${(gpsViaPlano || overrides[c.id]) ? 'text-green-600' : 'text-muted-foreground'}`}>
                      {(gpsViaPlano || overrides[c.id]) ? '✓ Ativo' : '— Inativo'}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function SaasDashboard() {
  const [tab, setTab] = useState('dashboard');

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-violet-500 to-purple-700 flex items-center justify-center shadow-lg">
          <Shield className="w-6 h-6 text-white" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-foreground">Gestão SaaS</h1>
          <p className="text-sm text-muted-foreground">Contratos, faturamento e bancos de recebimento</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 overflow-x-auto pb-1 border-b border-border/50">
        {TABS.map(t => {
          const Icon = t.icon;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={`flex items-center gap-2 px-4 py-2 rounded-t-lg text-sm font-medium whitespace-nowrap transition-colors ${
                tab === t.id
                  ? 'bg-background border border-b-background border-border/50 text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
              }`}
              data-testid={`tab-${t.id}`}
            >
              <Icon className="w-4 h-4" />
              {t.label}
            </button>
          );
        })}
      </div>

      {/* Content */}
      <div>
        {tab === 'dashboard' && <DashboardTab />}
        {tab === 'assinaturas' && <AssinaturasTab />}
        {tab === 'contratos' && <ContratosTab />}
        {tab === 'faturas' && <FaturasTab />}
        {tab === 'modulos' && <ModulosTab />}
        {tab === 'bancos' && <BancosTab />}
        {tab === 'gps' && <GpsTab />}
      </div>
    </div>
  );
}
