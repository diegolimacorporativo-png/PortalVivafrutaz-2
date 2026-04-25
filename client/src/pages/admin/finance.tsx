import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '@/lib/queryClient';
import { useToast } from '@/hooks/use-toast';
import {
  DollarSign, TrendingUp, TrendingDown, AlertTriangle, Plus, CheckCircle2,
  Clock, XCircle, Copy, Check, ChevronDown, ChevronUp, Wallet, CreditCard,
  ArrowUpCircle, ArrowDownCircle, RefreshCw
} from 'lucide-react';

type AR = {
  id: number; companyId: number | null; orderId: number | null;
  descricao: string; valor: string; dataEmissao: string; dataVencimento: string;
  status: string; formaPagamento: string; pagoEm: string | null;
  pixPayload: string | null; observacoes: string | null; createdAt: string;
};
type AP = {
  id: number; fornecedor: string; descricao: string; valor: string;
  dataVencimento: string; status: string; categoria: string;
  pagoEm: string | null; observacoes: string | null; createdAt: string;
};
type FT = {
  id: number; tipo: string; valor: string; descricao: string;
  data: string; referenciaTipo: string | null; referenciaId: number | null; createdAt: string;
};
type Dashboard = {
  totalReceivable: number; totalPayable: number; vencidosAR: number; vencidosAP: number;
  recebidoMes: number; pagoMes: number; balanceMes: number;
};

function fmt(v: number | string) {
  return Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}
function fmtDate(d: string | null) {
  if (!d) return '—';
  return new Date(d + 'T12:00:00').toLocaleDateString('pt-BR');
}
function isVencido(dataVencimento: string, status: string) {
  return status === 'pendente' && new Date(dataVencimento + 'T23:59:59') < new Date();
}

const STATUS_BADGE: Record<string, string> = {
  pendente: 'bg-yellow-100 text-yellow-700 border border-yellow-300',
  pago: 'bg-green-100 text-green-700 border border-green-300',
  vencido: 'bg-red-100 text-red-700 border border-red-300',
  cancelado: 'bg-gray-100 text-gray-500 border border-gray-200',
};
const STATUS_ICON: Record<string, any> = {
  pendente: Clock, pago: CheckCircle2, vencido: AlertTriangle, cancelado: XCircle,
};
const CATEGORIA_LABELS: Record<string, string> = {
  fornecedor: 'Fornecedor', logistica: 'Logística', operacional: 'Operacional', outros: 'Outros',
};
const PAYMENT_LABELS: Record<string, string> = {
  pix: 'PIX', boleto: 'Boleto', transferencia: 'Transferência', dinheiro: 'Dinheiro',
};

function PixModal({ ar, onClose }: { ar: AR; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    if (ar.pixPayload) {
      navigator.clipboard.writeText(ar.pixPayload);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div className="bg-card rounded-2xl shadow-2xl border p-6 max-w-md w-full mx-4" onClick={e => e.stopPropagation()}>
        <h3 className="font-bold text-lg mb-1">Código PIX — Copia e Cola</h3>
        <p className="text-sm text-muted-foreground mb-4">{ar.descricao} · {fmt(ar.valor)}</p>
        {ar.pixPayload ? (
          <>
            <div className="bg-muted rounded-xl p-3 text-xs font-mono break-all leading-relaxed mb-3 select-all">
              {ar.pixPayload}
            </div>
            <button
              type="button"
              onClick={copy}
              data-testid="button-copy-pix"
              className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-primary text-primary-foreground font-semibold text-sm transition-colors hover:bg-primary/90"
            >
              {copied ? <><Check className="w-4 h-4" /> Copiado!</> : <><Copy className="w-4 h-4" /> Copiar código PIX</>}
            </button>
            <p className="text-xs text-muted-foreground text-center mt-2">
              Cole no aplicativo do banco para pagar
            </p>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">PIX não disponível. Configure o CNPJ em Configurações Fiscais.</p>
        )}
        <button type="button" onClick={onClose} className="w-full mt-3 py-2 text-sm text-muted-foreground hover:text-foreground transition-colors">
          Fechar
        </button>
      </div>
    </div>
  );
}

function ARForm({ onSuccess }: { onSuccess: () => void }) {
  const { toast } = useToast();
  const { data: companies = [] } = useQuery<any[]>({ queryKey: ['/api/companies'] });
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    companyId: '', descricao: '', valor: '', dataEmissao: new Date().toISOString().split('T')[0],
    dataVencimento: '', formaPagamento: 'pix', observacoes: '',
  });
  const mutation = useMutation({
    mutationFn: (data: any) => apiRequest('POST', '/api/finance/accounts-receivable', data),
    onSuccess: () => { toast({ title: 'Conta a receber criada' }); setOpen(false); setForm({ ...form, descricao: '', valor: '', dataVencimento: '', observacoes: '' }); onSuccess(); },
    onError: (e: any) => toast({ title: 'Erro', description: e.message, variant: 'destructive' }),
  });
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    mutation.mutate({ ...form, companyId: form.companyId ? Number(form.companyId) : null });
  };
  return (
    <div className="mb-4">
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        data-testid="button-add-ar"
        className="flex items-center gap-2 px-4 py-2 rounded-xl bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 transition-colors"
      >
        <Plus className="w-4 h-4" />
        Nova conta a receber
        {open ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
      </button>
      {open && (
        <form onSubmit={submit} className="mt-3 bg-muted/40 rounded-2xl border p-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="sm:col-span-2">
            <label className="text-xs font-semibold text-muted-foreground">Empresa/Cliente</label>
            <select
              value={form.companyId}
              onChange={e => setForm(f => ({ ...f, companyId: e.target.value }))}
              data-testid="select-ar-company"
              className="w-full mt-1 px-3 py-2 rounded-xl border bg-background text-sm"
            >
              <option value="">Selecione (opcional)</option>
              {companies.map((c: any) => <option key={c.id} value={c.id}>{c.companyName}</option>)}
            </select>
          </div>
          <div className="sm:col-span-2">
            <label className="text-xs font-semibold text-muted-foreground">Descrição *</label>
            <input required value={form.descricao} onChange={e => setForm(f => ({ ...f, descricao: e.target.value }))} data-testid="input-ar-descricao" className="w-full mt-1 px-3 py-2 rounded-xl border bg-background text-sm" placeholder="Ex: Venda de produtos semana 01" />
          </div>
          <div>
            <label className="text-xs font-semibold text-muted-foreground">Valor (R$) *</label>
            <input required type="number" step="0.01" min="0.01" value={form.valor} onChange={e => setForm(f => ({ ...f, valor: e.target.value }))} data-testid="input-ar-valor" className="w-full mt-1 px-3 py-2 rounded-xl border bg-background text-sm" placeholder="0,00" />
          </div>
          <div>
            <label className="text-xs font-semibold text-muted-foreground">Vencimento *</label>
            <input required type="date" value={form.dataVencimento} onChange={e => setForm(f => ({ ...f, dataVencimento: e.target.value }))} data-testid="input-ar-vencimento" className="w-full mt-1 px-3 py-2 rounded-xl border bg-background text-sm" />
          </div>
          <div>
            <label className="text-xs font-semibold text-muted-foreground">Emissão</label>
            <input type="date" value={form.dataEmissao} onChange={e => setForm(f => ({ ...f, dataEmissao: e.target.value }))} className="w-full mt-1 px-3 py-2 rounded-xl border bg-background text-sm" />
          </div>
          <div>
            <label className="text-xs font-semibold text-muted-foreground">Forma de Pagamento</label>
            <select value={form.formaPagamento} onChange={e => setForm(f => ({ ...f, formaPagamento: e.target.value }))} className="w-full mt-1 px-3 py-2 rounded-xl border bg-background text-sm">
              <option value="pix">PIX</option>
              <option value="boleto">Boleto</option>
              <option value="transferencia">Transferência</option>
              <option value="dinheiro">Dinheiro</option>
            </select>
          </div>
          <div className="sm:col-span-2">
            <label className="text-xs font-semibold text-muted-foreground">Observações</label>
            <input value={form.observacoes} onChange={e => setForm(f => ({ ...f, observacoes: e.target.value }))} className="w-full mt-1 px-3 py-2 rounded-xl border bg-background text-sm" placeholder="Opcional" />
          </div>
          <div className="sm:col-span-2 flex gap-2 justify-end">
            <button type="button" onClick={() => setOpen(false)} className="px-4 py-2 rounded-xl border text-sm font-semibold text-muted-foreground hover:bg-muted transition-colors">Cancelar</button>
            <button type="submit" data-testid="button-submit-ar" disabled={mutation.isPending} className="px-4 py-2 rounded-xl bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 transition-colors disabled:opacity-50">
              {mutation.isPending ? 'Salvando...' : 'Salvar'}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

function APForm({ onSuccess }: { onSuccess: () => void }) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    fornecedor: '', descricao: '', valor: '', dataVencimento: '', categoria: 'outros', observacoes: '',
  });
  const mutation = useMutation({
    mutationFn: (data: any) => apiRequest('POST', '/api/finance/accounts-payable', data),
    onSuccess: () => { toast({ title: 'Conta a pagar criada' }); setOpen(false); setForm({ fornecedor: '', descricao: '', valor: '', dataVencimento: '', categoria: 'outros', observacoes: '' }); onSuccess(); },
    onError: (e: any) => toast({ title: 'Erro', description: e.message, variant: 'destructive' }),
  });
  const submit = (e: React.FormEvent) => { e.preventDefault(); mutation.mutate(form); };
  return (
    <div className="mb-4">
      <button type="button" onClick={() => setOpen(v => !v)} data-testid="button-add-ap" className="flex items-center gap-2 px-4 py-2 rounded-xl bg-destructive text-destructive-foreground text-sm font-semibold hover:bg-destructive/90 transition-colors">
        <Plus className="w-4 h-4" />
        Nova conta a pagar
        {open ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
      </button>
      {open && (
        <form onSubmit={submit} className="mt-3 bg-muted/40 rounded-2xl border p-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="text-xs font-semibold text-muted-foreground">Fornecedor *</label>
            <input required value={form.fornecedor} onChange={e => setForm(f => ({ ...f, fornecedor: e.target.value }))} data-testid="input-ap-fornecedor" className="w-full mt-1 px-3 py-2 rounded-xl border bg-background text-sm" placeholder="Nome do fornecedor" />
          </div>
          <div>
            <label className="text-xs font-semibold text-muted-foreground">Categoria</label>
            <select value={form.categoria} onChange={e => setForm(f => ({ ...f, categoria: e.target.value }))} className="w-full mt-1 px-3 py-2 rounded-xl border bg-background text-sm">
              <option value="fornecedor">Fornecedor</option>
              <option value="logistica">Logística</option>
              <option value="operacional">Operacional</option>
              <option value="outros">Outros</option>
            </select>
          </div>
          <div className="sm:col-span-2">
            <label className="text-xs font-semibold text-muted-foreground">Descrição *</label>
            <input required value={form.descricao} onChange={e => setForm(f => ({ ...f, descricao: e.target.value }))} data-testid="input-ap-descricao" className="w-full mt-1 px-3 py-2 rounded-xl border bg-background text-sm" placeholder="Ex: Compra de frutas — NF 001" />
          </div>
          <div>
            <label className="text-xs font-semibold text-muted-foreground">Valor (R$) *</label>
            <input required type="number" step="0.01" min="0.01" value={form.valor} onChange={e => setForm(f => ({ ...f, valor: e.target.value }))} data-testid="input-ap-valor" className="w-full mt-1 px-3 py-2 rounded-xl border bg-background text-sm" placeholder="0,00" />
          </div>
          <div>
            <label className="text-xs font-semibold text-muted-foreground">Vencimento *</label>
            <input required type="date" value={form.dataVencimento} onChange={e => setForm(f => ({ ...f, dataVencimento: e.target.value }))} data-testid="input-ap-vencimento" className="w-full mt-1 px-3 py-2 rounded-xl border bg-background text-sm" />
          </div>
          <div className="sm:col-span-2">
            <label className="text-xs font-semibold text-muted-foreground">Observações</label>
            <input value={form.observacoes} onChange={e => setForm(f => ({ ...f, observacoes: e.target.value }))} className="w-full mt-1 px-3 py-2 rounded-xl border bg-background text-sm" placeholder="Opcional" />
          </div>
          <div className="sm:col-span-2 flex gap-2 justify-end">
            <button type="button" onClick={() => setOpen(false)} className="px-4 py-2 rounded-xl border text-sm font-semibold text-muted-foreground hover:bg-muted transition-colors">Cancelar</button>
            <button type="submit" data-testid="button-submit-ap" disabled={mutation.isPending} className="px-4 py-2 rounded-xl bg-destructive text-destructive-foreground text-sm font-semibold hover:bg-destructive/90 transition-colors disabled:opacity-50">
              {mutation.isPending ? 'Salvando...' : 'Salvar'}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

export default function FinancePage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<'ar' | 'ap' | 'cashflow'>('ar');
  const [pixModal, setPixModal] = useState<AR | null>(null);
  const [filterAR, setFilterAR] = useState('todos');
  const [filterAP, setFilterAP] = useState('todos');
  const [cfFrom, setCfFrom] = useState('');
  const [cfTo, setCfTo] = useState('');

  const { data: dash, isLoading: dashLoading } = useQuery<Dashboard>({
    queryKey: ['/api/finance/dashboard'],
    refetchInterval: 60000,
  });
  const { data: arRaw, isLoading: arLoading, refetch: refetchAR } = useQuery<unknown>({
    queryKey: ['/api/finance/accounts-receivable', filterAR],
    queryFn: () => fetch(`/api/finance/accounts-receivable?status=${filterAR}`, { credentials: 'include' }).then(r => r.json()),
  });
  console.log('[finance] AR response shape:', arRaw);
  const arList: AR[] = Array.isArray(arRaw)
    ? (arRaw as AR[])
    : Array.isArray((arRaw as any)?.data)
      ? ((arRaw as any).data as AR[])
      : [];
  const { data: apRaw, isLoading: apLoading, refetch: refetchAP } = useQuery<unknown>({
    queryKey: ['/api/finance/accounts-payable', filterAP],
    queryFn: () => fetch(`/api/finance/accounts-payable?status=${filterAP}`, { credentials: 'include' }).then(r => r.json()),
  });
  console.log('[finance] AP response shape:', apRaw);
  const apList: AP[] = Array.isArray(apRaw)
    ? (apRaw as AP[])
    : Array.isArray((apRaw as any)?.data)
      ? ((apRaw as any).data as AP[])
      : [];
  const { data: cfRaw, isLoading: cfLoading, refetch: refetchCF } = useQuery<unknown>({
    queryKey: ['/api/finance/cashflow', cfFrom, cfTo],
    queryFn: () => fetch(`/api/finance/cashflow?from=${cfFrom}&to=${cfTo}`, { credentials: 'include' }).then(r => r.json()),
  });
  console.log('[finance] Cashflow response shape:', cfRaw);
  const cashflow: FT[] = Array.isArray(cfRaw)
    ? (cfRaw as FT[])
    : Array.isArray((cfRaw as any)?.data)
      ? ((cfRaw as any).data as FT[])
      : [];

  const payAR = useMutation({
    mutationFn: (id: number) => apiRequest('PATCH', `/api/finance/accounts-receivable/${id}/pay`, {}),
    onSuccess: () => { toast({ title: 'Pagamento registrado!' }); queryClient.invalidateQueries({ queryKey: ['/api/finance/accounts-receivable'] }); queryClient.invalidateQueries({ queryKey: ['/api/finance/dashboard'] }); queryClient.invalidateQueries({ queryKey: ['/api/finance/cashflow'] }); },
    onError: (e: any) => toast({ title: 'Erro', description: e.message, variant: 'destructive' }),
  });
  const deleteAR = useMutation({
    mutationFn: (id: number) => apiRequest('DELETE', `/api/finance/accounts-receivable/${id}`, {}),
    onSuccess: () => { toast({ title: 'Cancelado' }); queryClient.invalidateQueries({ queryKey: ['/api/finance/accounts-receivable'] }); },
    onError: (e: any) => toast({ title: 'Erro', description: e.message, variant: 'destructive' }),
  });
  const payAP = useMutation({
    mutationFn: (id: number) => apiRequest('PATCH', `/api/finance/accounts-payable/${id}/pay`, {}),
    onSuccess: () => { toast({ title: 'Pagamento registrado!' }); queryClient.invalidateQueries({ queryKey: ['/api/finance/accounts-payable'] }); queryClient.invalidateQueries({ queryKey: ['/api/finance/dashboard'] }); queryClient.invalidateQueries({ queryKey: ['/api/finance/cashflow'] }); },
    onError: (e: any) => toast({ title: 'Erro', description: e.message, variant: 'destructive' }),
  });
  const deleteAP = useMutation({
    mutationFn: (id: number) => apiRequest('DELETE', `/api/finance/accounts-payable/${id}`, {}),
    onSuccess: () => { toast({ title: 'Cancelado' }); queryClient.invalidateQueries({ queryKey: ['/api/finance/accounts-payable'] }); },
    onError: (e: any) => toast({ title: 'Erro', description: e.message, variant: 'destructive' }),
  });

  const cfBalance = cashflow.reduce((sum, t) => t.tipo === 'entrada' ? sum + Number(t.valor) : sum - Number(t.valor), 0);

  return (
    <div className="p-4 sm:p-6 max-w-6xl mx-auto space-y-6">
      {pixModal && <PixModal ar={pixModal} onClose={() => setPixModal(null)} />}

      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-green-100 dark:bg-green-900/30 flex items-center justify-center">
          <DollarSign className="w-5 h-5 text-green-600 dark:text-green-400" />
        </div>
        <div>
          <h1 className="text-xl font-bold text-foreground">Gestão Financeira</h1>
          <p className="text-sm text-muted-foreground">Contas a receber, contas a pagar e fluxo de caixa</p>
        </div>
      </div>

      {/* Dashboard cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'A Receber', value: dash?.totalReceivable ?? 0, icon: TrendingUp, color: 'text-green-600', bg: 'bg-green-50 dark:bg-green-900/20' },
          { label: 'A Pagar', value: dash?.totalPayable ?? 0, icon: TrendingDown, color: 'text-red-600', bg: 'bg-red-50 dark:bg-red-900/20' },
          { label: 'Recebido no mês', value: dash?.recebidoMes ?? 0, icon: ArrowUpCircle, color: 'text-blue-600', bg: 'bg-blue-50 dark:bg-blue-900/20' },
          { label: 'Pago no mês', value: dash?.pagoMes ?? 0, icon: ArrowDownCircle, color: 'text-orange-600', bg: 'bg-orange-50 dark:bg-orange-900/20' },
        ].map(({ label, value, icon: Icon, color, bg }) => (
          <div key={label} className={`rounded-2xl border p-4 ${bg}`} data-testid={`card-finance-${label.toLowerCase().replace(/\s/g, '-')}`}>
            <div className="flex items-center gap-2 mb-1">
              <Icon className={`w-4 h-4 ${color}`} />
              <span className="text-xs text-muted-foreground font-medium">{label}</span>
            </div>
            <p className={`text-lg font-bold ${color}`}>{dashLoading ? '...' : fmt(value)}</p>
          </div>
        ))}
      </div>

      {/* Vencidos alert */}
      {((dash?.vencidosAR ?? 0) > 0 || (dash?.vencidosAP ?? 0) > 0) && (
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl px-4 py-3 flex items-center gap-2 text-sm text-red-700 dark:text-red-400">
          <AlertTriangle className="w-4 h-4 flex-shrink-0" />
          <span>
            {(dash?.vencidosAR ?? 0) > 0 && <><strong>{fmt(dash!.vencidosAR)}</strong> a receber vencido. </>}
            {(dash?.vencidosAP ?? 0) > 0 && <><strong>{fmt(dash!.vencidosAP)}</strong> a pagar vencido.</>}
          </span>
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 bg-muted p-1 rounded-xl w-fit">
        {([['ar', 'Contas a Receber'], ['ap', 'Contas a Pagar'], ['cashflow', 'Fluxo de Caixa']] as const).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            data-testid={`tab-finance-${key}`}
            className={`px-4 py-2 rounded-lg text-sm font-semibold transition-all ${tab === key ? 'bg-background shadow text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* ── Contas a Receber ─────────────────────────────────── */}
      {tab === 'ar' && (
        <div className="space-y-4">
          <div className="flex items-center gap-3 flex-wrap">
            <ARForm onSuccess={() => { queryClient.invalidateQueries({ queryKey: ['/api/finance/accounts-receivable'] }); queryClient.invalidateQueries({ queryKey: ['/api/finance/dashboard'] }); }} />
            <select value={filterAR} onChange={e => setFilterAR(e.target.value)} data-testid="select-filter-ar" className="px-3 py-2 rounded-xl border bg-background text-sm">
              <option value="todos">Todos</option>
              <option value="pendente">Pendente</option>
              <option value="pago">Pago</option>
              <option value="cancelado">Cancelado</option>
            </select>
          </div>
          {arLoading ? (
            <div className="text-center py-8 text-muted-foreground text-sm">Carregando...</div>
          ) : arList.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground text-sm">Nenhuma conta a receber encontrada.</div>
          ) : (
            <div className="rounded-2xl border overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50">
                    <tr>
                      {['Descrição', 'Valor', 'Vencimento', 'Status', 'Pagamento', 'Ações'].map(h => (
                        <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {arList.map((ar) => {
                      const vencido = isVencido(ar.dataVencimento, ar.status);
                      const statusKey = vencido ? 'vencido' : ar.status;
                      const Icon = STATUS_ICON[statusKey] || Clock;
                      return (
                        <tr key={ar.id} className="hover:bg-muted/30 transition-colors" data-testid={`row-ar-${ar.id}`}>
                          <td className="px-4 py-3">
                            <p className="font-medium">{ar.descricao}</p>
                            {ar.orderId && <p className="text-xs text-muted-foreground">Pedido #{ar.orderId}</p>}
                          </td>
                          <td className="px-4 py-3 font-semibold text-green-700 dark:text-green-400">{fmt(ar.valor)}</td>
                          <td className="px-4 py-3">
                            <p className={vencido ? 'text-red-600 font-semibold' : ''}>{fmtDate(ar.dataVencimento)}</p>
                            {ar.pagoEm && <p className="text-xs text-muted-foreground">Pago: {fmtDate(ar.pagoEm)}</p>}
                          </td>
                          <td className="px-4 py-3">
                            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold ${STATUS_BADGE[statusKey] || STATUS_BADGE.pendente}`}>
                              <Icon className="w-3 h-3" />
                              {statusKey.charAt(0).toUpperCase() + statusKey.slice(1)}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-xs text-muted-foreground">{PAYMENT_LABELS[ar.formaPagamento] || ar.formaPagamento}</td>
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-1.5">
                              {ar.status === 'pendente' && (
                                <button
                                  type="button"
                                  onClick={() => payAR.mutate(ar.id)}
                                  disabled={payAR.isPending}
                                  data-testid={`button-pay-ar-${ar.id}`}
                                  className="px-2 py-1 rounded-lg bg-green-100 hover:bg-green-200 text-green-700 text-xs font-semibold transition-colors"
                                >
                                  Pago ✓
                                </button>
                              )}
                              {ar.formaPagamento === 'pix' && ar.pixPayload && (
                                <button
                                  type="button"
                                  onClick={() => setPixModal(ar)}
                                  data-testid={`button-pix-ar-${ar.id}`}
                                  className="px-2 py-1 rounded-lg bg-blue-100 hover:bg-blue-200 text-blue-700 text-xs font-semibold transition-colors"
                                >
                                  PIX
                                </button>
                              )}
                              {ar.status === 'pendente' && (
                                <button
                                  type="button"
                                  onClick={() => { if (confirm('Cancelar esta conta?')) deleteAR.mutate(ar.id); }}
                                  data-testid={`button-cancel-ar-${ar.id}`}
                                  className="px-2 py-1 rounded-lg bg-gray-100 hover:bg-red-100 text-gray-500 hover:text-red-600 text-xs font-semibold transition-colors"
                                >
                                  ✕
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Contas a Pagar ───────────────────────────────────── */}
      {tab === 'ap' && (
        <div className="space-y-4">
          <div className="flex items-center gap-3 flex-wrap">
            <APForm onSuccess={() => { queryClient.invalidateQueries({ queryKey: ['/api/finance/accounts-payable'] }); queryClient.invalidateQueries({ queryKey: ['/api/finance/dashboard'] }); }} />
            <select value={filterAP} onChange={e => setFilterAP(e.target.value)} data-testid="select-filter-ap" className="px-3 py-2 rounded-xl border bg-background text-sm">
              <option value="todos">Todos</option>
              <option value="pendente">Pendente</option>
              <option value="pago">Pago</option>
              <option value="cancelado">Cancelado</option>
            </select>
          </div>
          {apLoading ? (
            <div className="text-center py-8 text-muted-foreground text-sm">Carregando...</div>
          ) : apList.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground text-sm">Nenhuma conta a pagar encontrada.</div>
          ) : (
            <div className="rounded-2xl border overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50">
                    <tr>
                      {['Fornecedor', 'Descrição', 'Valor', 'Vencimento', 'Categoria', 'Status', 'Ações'].map(h => (
                        <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {apList.map((ap) => {
                      const vencido = isVencido(ap.dataVencimento, ap.status);
                      const statusKey = vencido ? 'vencido' : ap.status;
                      const Icon = STATUS_ICON[statusKey] || Clock;
                      return (
                        <tr key={ap.id} className="hover:bg-muted/30 transition-colors" data-testid={`row-ap-${ap.id}`}>
                          <td className="px-4 py-3 font-medium">{ap.fornecedor}</td>
                          <td className="px-4 py-3 text-muted-foreground">{ap.descricao}</td>
                          <td className="px-4 py-3 font-semibold text-red-700 dark:text-red-400">{fmt(ap.valor)}</td>
                          <td className="px-4 py-3">
                            <p className={vencido ? 'text-red-600 font-semibold' : ''}>{fmtDate(ap.dataVencimento)}</p>
                            {ap.pagoEm && <p className="text-xs text-muted-foreground">Pago: {fmtDate(ap.pagoEm)}</p>}
                          </td>
                          <td className="px-4 py-3 text-xs text-muted-foreground">{CATEGORIA_LABELS[ap.categoria] || ap.categoria}</td>
                          <td className="px-4 py-3">
                            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold ${STATUS_BADGE[statusKey] || STATUS_BADGE.pendente}`}>
                              <Icon className="w-3 h-3" />
                              {statusKey.charAt(0).toUpperCase() + statusKey.slice(1)}
                            </span>
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-1.5">
                              {ap.status === 'pendente' && (
                                <button
                                  type="button"
                                  onClick={() => payAP.mutate(ap.id)}
                                  disabled={payAP.isPending}
                                  data-testid={`button-pay-ap-${ap.id}`}
                                  className="px-2 py-1 rounded-lg bg-green-100 hover:bg-green-200 text-green-700 text-xs font-semibold transition-colors"
                                >
                                  Pago ✓
                                </button>
                              )}
                              {ap.status === 'pendente' && (
                                <button
                                  type="button"
                                  onClick={() => { if (confirm('Cancelar esta conta?')) deleteAP.mutate(ap.id); }}
                                  data-testid={`button-cancel-ap-${ap.id}`}
                                  className="px-2 py-1 rounded-lg bg-gray-100 hover:bg-red-100 text-gray-500 hover:text-red-600 text-xs font-semibold transition-colors"
                                >
                                  ✕
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Fluxo de Caixa ───────────────────────────────────── */}
      {tab === 'cashflow' && (
        <div className="space-y-4">
          <div className="flex items-center gap-3 flex-wrap">
            <div className="flex items-center gap-2">
              <input type="date" value={cfFrom} onChange={e => setCfFrom(e.target.value)} data-testid="input-cf-from" className="px-3 py-2 rounded-xl border bg-background text-sm" />
              <span className="text-muted-foreground text-sm">até</span>
              <input type="date" value={cfTo} onChange={e => setCfTo(e.target.value)} data-testid="input-cf-to" className="px-3 py-2 rounded-xl border bg-background text-sm" />
            </div>
            <button type="button" onClick={() => refetchCF()} className="flex items-center gap-1.5 px-3 py-2 rounded-xl border text-sm font-semibold text-muted-foreground hover:bg-muted transition-colors">
              <RefreshCw className="w-3.5 h-3.5" /> Atualizar
            </button>
          </div>

          {/* Saldo */}
          <div className={`rounded-2xl border p-4 ${cfBalance >= 0 ? 'bg-green-50 dark:bg-green-900/20 border-green-200' : 'bg-red-50 dark:bg-red-900/20 border-red-200'}`} data-testid="card-cashflow-balance">
            <p className="text-sm font-semibold text-muted-foreground mb-1">Saldo do período</p>
            <p className={`text-2xl font-bold ${cfBalance >= 0 ? 'text-green-700 dark:text-green-400' : 'text-red-700 dark:text-red-400'}`}>
              {fmt(cfBalance)}
            </p>
            <div className="flex gap-4 mt-2 text-xs text-muted-foreground">
              <span>Entradas: <strong className="text-green-700">{fmt(cashflow.filter(t => t.tipo === 'entrada').reduce((s, t) => s + Number(t.valor), 0))}</strong></span>
              <span>Saídas: <strong className="text-red-700">{fmt(cashflow.filter(t => t.tipo === 'saida').reduce((s, t) => s + Number(t.valor), 0))}</strong></span>
            </div>
          </div>

          {cfLoading ? (
            <div className="text-center py-8 text-muted-foreground text-sm">Carregando...</div>
          ) : cashflow.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground text-sm">Nenhuma movimentação encontrada. Marque contas como pagas para gerar entradas/saídas.</div>
          ) : (
            <div className="rounded-2xl border overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50">
                    <tr>
                      {['Data', 'Tipo', 'Descrição', 'Valor'].map(h => (
                        <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {cashflow.map((t) => (
                      <tr key={t.id} className="hover:bg-muted/30 transition-colors" data-testid={`row-cf-${t.id}`}>
                        <td className="px-4 py-3 text-muted-foreground">{fmtDate(t.data)}</td>
                        <td className="px-4 py-3">
                          <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold border ${t.tipo === 'entrada' ? 'bg-green-100 text-green-700 border-green-300' : 'bg-red-100 text-red-700 border-red-300'}`}>
                            {t.tipo === 'entrada' ? <ArrowUpCircle className="w-3 h-3" /> : <ArrowDownCircle className="w-3 h-3" />}
                            {t.tipo === 'entrada' ? 'Entrada' : 'Saída'}
                          </span>
                        </td>
                        <td className="px-4 py-3">{t.descricao}</td>
                        <td className={`px-4 py-3 font-semibold ${t.tipo === 'entrada' ? 'text-green-700 dark:text-green-400' : 'text-red-700 dark:text-red-400'}`}>
                          {t.tipo === 'entrada' ? '+' : '-'}{fmt(t.valor)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
