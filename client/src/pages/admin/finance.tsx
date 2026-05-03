import { useState } from 'react';
import { useLocation } from 'wouter';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '@/lib/queryClient';
import { fetchWithAuth } from '@/lib/fetchWithAuth';
import { normalizeList } from '@/lib/normalizeResponse';
import { useToast } from '@/hooks/use-toast';
import {
  DollarSign, TrendingUp, TrendingDown, AlertTriangle, Plus, CheckCircle2,
  Clock, XCircle, Copy, Check, ChevronDown, ChevronUp, Wallet, CreditCard,
  ArrowUpCircle, ArrowDownCircle, RefreshCw, Receipt, ExternalLink, Wand2, History
} from 'lucide-react';
import { ImportarRetornoCnab } from '@/components/banking/ImportarRetornoCnab';

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
// FASE 6.6 — payload do GET /api/finance/accounts-receivable/:id/breakdown
type Breakdown = {
  principal: number; juros: number; multa: number; desconto: number;
  totalRecebido: number; totalLiquido: number;
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

/**
 * FASE 6.6 — indicador inline minúsculo. Roda só para AR `pago`. React Query
 * deduplica automaticamente o request entre indicador + modal (mesma queryKey).
 * Mostra texto somente quando há diferença real (silenciosamente vazio para
 * pagamentos manuais sem juros/multa/desconto).
 */
function BreakdownIndicator({ arId }: { arId: number }) {
  const { data } = useQuery<Breakdown>({
    queryKey: ['/api/finance/accounts-receivable', arId, 'breakdown'],
    queryFn: () =>
      fetchWithAuth(`/api/finance/accounts-receivable/${arId}/breakdown`).then(r => r.json()),
  });
  if (!data) return null;
  if (data.totalLiquido === data.principal) return null;
  const tem = data.totalLiquido > data.principal;
  return (
    <span
      className="text-[10px] text-muted-foreground ml-1"
      data-testid={`text-breakdown-indicator-${arId}`}
    >
      {tem ? '(+ encargos)' : '(- desconto)'}
    </span>
  );
}

/**
 * FASE 6.6 — modal de composição. Reutiliza a mesma queryKey do indicador,
 * então quando o usuário abre o modal os dados já estão em cache (instantâneo).
 */
function BreakdownModal({ ar, onClose }: { ar: AR; onClose: () => void }) {
  const { data, isLoading, error } = useQuery<Breakdown>({
    queryKey: ['/api/finance/accounts-receivable', ar.id, 'breakdown'],
    queryFn: () =>
      fetchWithAuth(`/api/finance/accounts-receivable/${ar.id}/breakdown`).then(r => r.json()),
  });
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
      data-testid="modal-breakdown"
    >
      <div
        className="bg-white dark:bg-gray-900 rounded-2xl shadow-xl max-w-md w-full p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between mb-4">
          <div>
            <h3 className="text-lg font-semibold">Composição do pagamento</h3>
            <p className="text-xs text-muted-foreground">{ar.descricao}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            data-testid="button-close-breakdown"
            className="text-muted-foreground hover:text-foreground transition-colors"
          >
            <XCircle className="w-5 h-5" />
          </button>
        </div>
        {isLoading && (
          <div className="text-center py-6 text-sm text-muted-foreground">Carregando…</div>
        )}
        {error && (
          <div className="text-center py-6 text-sm text-red-600">Erro ao carregar composição.</div>
        )}
        {data && (
          <div className="space-y-2 text-sm">
            <div className="flex justify-between" data-testid="text-breakdown-principal">
              <span className="text-muted-foreground">Principal</span>
              <span className="font-medium">{fmt(data.principal)}</span>
            </div>
            <div className="flex justify-between" data-testid="text-breakdown-juros">
              <span className="text-muted-foreground">Juros</span>
              <span className="font-medium text-green-700 dark:text-green-400">{fmt(data.juros)}</span>
            </div>
            <div className="flex justify-between" data-testid="text-breakdown-multa">
              <span className="text-muted-foreground">Multa</span>
              <span className="font-medium text-green-700 dark:text-green-400">{fmt(data.multa)}</span>
            </div>
            <div className="flex justify-between" data-testid="text-breakdown-desconto">
              <span className="text-muted-foreground">Desconto</span>
              <span className="font-medium text-red-600">{fmt(data.desconto)}</span>
            </div>
            <hr className="my-3 border-muted" />
            <div className="flex justify-between" data-testid="text-breakdown-totalrecebido">
              <span className="text-muted-foreground">Total recebido (bruto)</span>
              <span className="font-semibold">{fmt(data.totalRecebido)}</span>
            </div>
            <div className="flex justify-between" data-testid="text-breakdown-totalliquido">
              <span className="text-muted-foreground">Total líquido</span>
              <span className="font-semibold text-green-700 dark:text-green-400">{fmt(data.totalLiquido)}</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

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
  const { data: companies = [] } = useQuery<any[]>({ queryKey: ['/api/companies'], select: normalizeList });
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

// FASE FISCAL 8.0 — botão de reemissão manual controlada.
//
// Encapsulado em componente próprio para isolar o `useMutation` (cache
// invalidation, estado de loading, toast) sem inflar o componente pai. O
// fluxo é estritamente manual: clicar dispara `POST /api/nfe/:orderId/reenviar`
// e, em sucesso, atualiza o card de motivos e o resumo por status.
function ReenviarNfeButton({ orderId }: { orderId: number }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const mutation = useMutation({
    mutationFn: () => apiRequest('POST', `/api/nfe/${orderId}/reenviar`),
    onSuccess: () => {
      toast({
        title: 'NF-e reemitida',
        description: `Nova tentativa enviada para o pedido #${orderId}.`,
      });
      qc.invalidateQueries({ queryKey: ['/api/finance/nfe/motivos-rejeicao'] });
      qc.invalidateQueries({ queryKey: ['/api/finance/nfe/resumo-por-status'] });
      qc.invalidateQueries({ queryKey: ['/api/finance/nfe/resumo-por-uf'] });
    },
    onError: (e: any) => {
      toast({
        title: 'Falha ao reemitir',
        description: e?.message ?? 'Erro desconhecido — verifique o pedido e tente novamente.',
        variant: 'destructive',
      });
    },
  });
  return (
    <button
      type="button"
      onClick={() => mutation.mutate()}
      disabled={mutation.isPending}
      data-testid={`button-reenviar-nfe-${orderId}`}
      className="inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-xl border border-red-300 bg-white dark:bg-red-950/40 text-red-700 dark:text-red-300 text-xs font-semibold hover:bg-red-50 dark:hover:bg-red-900/40 transition-colors disabled:opacity-50"
      title="Reenviar NF-e ao SEFAZ"
    >
      <RefreshCw className={`w-3.5 h-3.5 ${mutation.isPending ? 'animate-spin' : ''}`} />
      {mutation.isPending ? 'Reenviando...' : 'Reenviar NF-e'}
    </button>
  );
}

// FASE FISCAL 8.1 — botão de correção semi-automática.
//
// Aparece SÓ quando o `nfeErrorHandler` classificou o cStat da última NF-e
// rejeitada como `RECALCULAR` ou `REEMITIR` (códigos 533 e 539). Para
// `VALIDAR_XML` (215) ou `MANUAL` (110 / desconhecidos) o botão fica oculto
// e o operador deve usar "Abrir Pedido" + "Reenviar NF-e" no fluxo padrão.
//
// Reaproveita exatamente o pipeline de emissão do backend — não há cálculo
// novo no cliente.
function CorrigirReenviarButton({
  orderId,
  tipo,
}: {
  orderId: number;
  tipo: 'RECALCULAR' | 'REEMITIR';
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const mutation = useMutation({
    mutationFn: () => apiRequest('POST', `/api/nfe/${orderId}/corrigir-reenviar`),
    onSuccess: () => {
      toast({
        title: 'NF-e corrigida e reemitida',
        description: `Correção aplicada (${tipo}) ao pedido #${orderId}.`,
      });
      qc.invalidateQueries({ queryKey: ['/api/finance/nfe/motivos-rejeicao'] });
      qc.invalidateQueries({ queryKey: ['/api/finance/nfe/resumo-por-status'] });
      qc.invalidateQueries({ queryKey: ['/api/finance/nfe/resumo-por-uf'] });
    },
    onError: (e: any) => {
      toast({
        title: 'Falha na correção',
        description: e?.message ?? 'Não foi possível aplicar a correção semi-automática.',
        variant: 'destructive',
      });
    },
  });
  return (
    <button
      type="button"
      onClick={() => mutation.mutate()}
      disabled={mutation.isPending}
      data-testid={`button-corrigir-reenviar-${orderId}`}
      className="inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-xl bg-amber-500 text-white text-xs font-semibold hover:bg-amber-600 transition-colors disabled:opacity-50"
      title={`Correção semi-automática (${tipo}) e reemissão da NF-e`}
    >
      <Wand2 className={`w-3.5 h-3.5 ${mutation.isPending ? 'animate-pulse' : ''}`} />
      {mutation.isPending ? 'Corrigindo...' : 'Corrigir e Reenviar'}
    </button>
  );
}

// FASE FISCAL 8.2 — painel inline de histórico de tentativas de NF-e.
//
// Read-only. Carrega `GET /api/nfe/:orderId/historico` SOMENTE quando
// expandido (lazy via `enabled`), assim o card principal não dispara N+1
// queries quando há muitos pedidos rejeitados. Tenant scope é garantido
// no backend (JOIN orders + companyId no repository).
function NfeHistoricoPanel({ orderId, open }: { orderId: number; open: boolean }) {
  const { data, isLoading, error } = useQuery<{
    orderId: number;
    total: number;
    tentativas: {
      id: number;
      status: string;
      cStat: string;
      xMotivo: string;
      numero: string | null;
      createdAt: string | null;
    }[];
  }>({
    queryKey: ['/api/nfe', orderId, 'historico'],
    enabled: open,
  });
  if (!open) return null;
  if (isLoading) {
    return (
      <div
        className="mt-2 text-[11px] text-muted-foreground"
        data-testid={`text-historico-loading-${orderId}`}
      >
        Carregando histórico...
      </div>
    );
  }
  if (error) {
    return (
      <div
        className="mt-2 text-[11px] text-red-600 dark:text-red-400"
        data-testid={`text-historico-error-${orderId}`}
      >
        Falha ao carregar histórico de NF-e.
      </div>
    );
  }
  const tentativas = data?.tentativas ?? [];
  if (tentativas.length === 0) {
    return (
      <div
        className="mt-2 text-[11px] text-muted-foreground"
        data-testid={`text-historico-empty-${orderId}`}
      >
        Nenhuma tentativa registrada para este pedido.
      </div>
    );
  }
  // Mapa de status → cor para tornar a auditoria escaneável de relance.
  const statusClass: Record<string, string> = {
    autorizada: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300',
    enviada: 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300',
    assinada: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900/40 dark:text-indigo-300',
    gerada: 'bg-slate-100 text-slate-800 dark:bg-slate-800/60 dark:text-slate-300',
    rejeitada: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300',
    erro: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300',
    denegada: 'bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-300',
    cancelada: 'bg-zinc-100 text-zinc-800 dark:bg-zinc-800/60 dark:text-zinc-300',
  };
  const fmt = (iso: string | null) => {
    if (!iso) return '—';
    const d = new Date(iso);
    return isNaN(d.getTime())
      ? '—'
      : d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  };
  return (
    <div
      className="mt-2 rounded-lg border border-red-200/70 dark:border-red-900/50 bg-white/60 dark:bg-black/20 p-2"
      data-testid={`panel-historico-${orderId}`}
    >
      <div className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground mb-1">
        Histórico de tentativas ({tentativas.length})
      </div>
      <ol className="space-y-1">
        {tentativas.map((t, idx) => {
          const ordinal = tentativas.length - idx;
          return (
            <li
              key={t.id}
              data-testid={`row-historico-${orderId}-${t.id}`}
              className="flex items-start gap-2 text-[11px]"
            >
              <span className="font-mono text-muted-foreground shrink-0 w-7 text-right">
                #{ordinal}
              </span>
              <span className="font-mono text-muted-foreground shrink-0 w-28">
                {fmt(t.createdAt)}
              </span>
              <span
                className={`shrink-0 px-1.5 py-0.5 rounded text-[10px] font-bold uppercase ${statusClass[t.status] ?? 'bg-muted text-foreground'}`}
                data-testid={`badge-historico-status-${t.id}`}
              >
                {t.status}
              </span>
              {t.cStat && (
                <span className="shrink-0 text-muted-foreground font-mono">
                  cStat {t.cStat}
                </span>
              )}
              {t.numero && (
                <span className="shrink-0 text-muted-foreground">
                  nº {t.numero}
                </span>
              )}
              <span
                className="text-foreground/80 break-words min-w-0"
                data-testid={`text-historico-motivo-${t.id}`}
              >
                {t.xMotivo || '—'}
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

export default function FinancePage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [, navigate] = useLocation();
  // FASE FISCAL 8.2 — controla qual card de rejeição tem o painel de
  // histórico expandido. Mantemos um Set para permitir múltiplos abertos.
  const [historicoAberto, setHistoricoAberto] = useState<Set<number>>(new Set());
  const toggleHistorico = (orderId: number) => {
    setHistoricoAberto((prev) => {
      const next = new Set(prev);
      if (next.has(orderId)) next.delete(orderId);
      else next.add(orderId);
      return next;
    });
  };
  const [tab, setTab] = useState<'ar' | 'ap' | 'cashflow'>('ar');
  const [pixModal, setPixModal] = useState<AR | null>(null);
  // FASE 6.6 — controle do modal de composição de pagamento.
  const [breakdownModal, setBreakdownModal] = useState<AR | null>(null);
  const [filterAR, setFilterAR] = useState('todos');
  const [filterAP, setFilterAP] = useState('todos');
  const [cfFrom, setCfFrom] = useState('');
  const [cfTo, setCfTo] = useState('');

  const { data: dash, isLoading: dashLoading } = useQuery<Dashboard>({
    queryKey: ['/api/finance/dashboard'],
    refetchInterval: 60000,
  });
  // FASE NF.7.5 — resumo de NF-e por UF do emitente (read-only).
  const { data: nfeUfRaw, isLoading: nfeUfLoading } = useQuery<unknown>({
    queryKey: ['/api/finance/nfe/resumo-por-uf'],
    refetchInterval: 60000,
  });
  const nfeUfList: { uf: string; total: number; usaFallback: boolean }[] = Array.isArray(nfeUfRaw)
    ? (nfeUfRaw as any)
    : Array.isArray((nfeUfRaw as any)?.data)
      ? ((nfeUfRaw as any).data)
      : [];
  // FASE NF.7.6 — resumo de NF-e por status fiscal (read-only).
  const { data: nfeStatusRaw, isLoading: nfeStatusLoading } = useQuery<unknown>({
    queryKey: ['/api/finance/nfe/resumo-por-status'],
    refetchInterval: 60000,
  });
  const nfeStatusList: { status: string; total: number }[] = Array.isArray(nfeStatusRaw)
    ? (nfeStatusRaw as any)
    : Array.isArray((nfeStatusRaw as any)?.data)
      ? ((nfeStatusRaw as any).data)
      : [];
  // FASE FISCAL 7.9 — motivos de rejeição com vínculo ao pedido (ação rápida).
  const { data: nfeMotivosRaw, isLoading: nfeMotivosLoading } = useQuery<unknown>({
    queryKey: ['/api/finance/nfe/motivos-rejeicao'],
    refetchInterval: 60000,
  });
  // FASE FISCAL 8.1 — sugestao agora é estruturada ({tipo, mensagem}) e
  // controla a visibilidade do botão "Corrigir e Reenviar".
  type NfeMotivo = {
    status: string; cStat: string; xMotivo: string;
    total: number; orderId: number;
    sugestao: { tipo: 'RECALCULAR' | 'VALIDAR_XML' | 'REEMITIR' | 'MANUAL'; mensagem: string };
  };
  const nfeMotivos: NfeMotivo[] = Array.isArray(nfeMotivosRaw)
    ? (nfeMotivosRaw as NfeMotivo[])
    : Array.isArray((nfeMotivosRaw as any)?.data)
      ? ((nfeMotivosRaw as any).data as NfeMotivo[])
      : [];
  const { data: arRaw, isLoading: arLoading, refetch: refetchAR } = useQuery<unknown>({
    queryKey: ['/api/finance/accounts-receivable', filterAR],
    queryFn: () => fetchWithAuth(`/api/finance/accounts-receivable?status=${filterAR}`).then(r => r.json()),
  });
  console.log('[finance] AR response shape:', arRaw);
  const arList: AR[] = Array.isArray(arRaw)
    ? (arRaw as AR[])
    : Array.isArray((arRaw as any)?.data)
      ? ((arRaw as any).data as AR[])
      : [];
  const { data: apRaw, isLoading: apLoading, refetch: refetchAP } = useQuery<unknown>({
    queryKey: ['/api/finance/accounts-payable', filterAP],
    queryFn: () => fetchWithAuth(`/api/finance/accounts-payable?status=${filterAP}`).then(r => r.json()),
  });
  console.log('[finance] AP response shape:', apRaw);
  const apList: AP[] = Array.isArray(apRaw)
    ? (apRaw as AP[])
    : Array.isArray((apRaw as any)?.data)
      ? ((apRaw as any).data as AP[])
      : [];
  const { data: cfRaw, isLoading: cfLoading, refetch: refetchCF } = useQuery<unknown>({
    queryKey: ['/api/finance/cashflow', cfFrom, cfTo],
    queryFn: () => fetchWithAuth(`/api/finance/cashflow?from=${cfFrom}&to=${cfTo}`).then(r => r.json()),
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
      {breakdownModal && <BreakdownModal ar={breakdownModal} onClose={() => setBreakdownModal(null)} />}

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

      {/* FASE NF.7.5 — Monitoramento de NF-e por UF do emitente */}
      <div className="rounded-2xl border bg-card p-4" data-testid="card-nfe-resumo-uf">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Receipt className="w-4 h-4 text-purple-600" />
            <h3 className="text-sm font-bold text-foreground">Emissão de NF-e por UF</h3>
          </div>
          <span className="text-xs text-muted-foreground">
            {nfeUfList.length > 0 && `${nfeUfList.reduce((s, u) => s + u.total, 0)} notas no total`}
          </span>
        </div>
        {nfeUfLoading ? (
          <div className="text-center py-4 text-muted-foreground text-xs">Carregando...</div>
        ) : nfeUfList.length === 0 ? (
          <div className="text-center py-4 text-muted-foreground text-xs">Nenhuma NF-e emitida ainda nesta empresa.</div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-2">
            {nfeUfList.map((u) => (
              <div
                key={u.uf}
                data-testid={`nfe-uf-${u.uf.toLowerCase()}`}
                className={`rounded-xl border px-3 py-2 ${
                  u.usaFallback
                    ? 'border-amber-300 bg-amber-50 dark:bg-amber-900/20'
                    : 'border-emerald-200 bg-emerald-50 dark:bg-emerald-900/20'
                }`}
                title={u.usaFallback ? 'UF não mapeada — usando fallback (GO/SVRS)' : 'UF com webservice próprio mapeado'}
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-foreground">{u.uf}</span>
                  {u.usaFallback && (
                    <span className="text-[10px] uppercase font-semibold text-amber-700 dark:text-amber-400">fallback</span>
                  )}
                </div>
                <p className={`text-base font-bold ${u.usaFallback ? 'text-amber-700 dark:text-amber-400' : 'text-emerald-700 dark:text-emerald-400'}`}>
                  {u.total}
                </p>
              </div>
            ))}
          </div>
        )}
        {nfeUfList.some((u) => u.usaFallback) && (
          <p className="mt-3 text-[11px] text-amber-700 dark:text-amber-400">
            UFs em âmbar usam o webservice de fallback (GO/SVRS). Mapear o webservice próprio dessas UFs aumenta a confiabilidade da transmissão.
          </p>
        )}
      </div>

      {/* FASE NF.7.6 — Monitoramento de NF-e por status fiscal */}
      <div className="rounded-2xl border bg-card p-4" data-testid="card-nfe-status">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-blue-600" />
            <h3 className="text-sm font-bold text-foreground">Status das NF-e</h3>
          </div>
          <span className="text-xs text-muted-foreground">
            {nfeStatusList.length > 0 && `${nfeStatusList.reduce((s, x) => s + x.total, 0)} notas no total`}
          </span>
        </div>
        {nfeStatusLoading ? (
          <div className="text-center py-4 text-muted-foreground text-xs">Carregando...</div>
        ) : nfeStatusList.length === 0 ? (
          <div className="text-center py-4 text-muted-foreground text-xs" data-testid="text-nfe-status-empty">Nenhuma NF-e encontrada</div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2">
            {nfeStatusList.map((s) => {
              const ok = s.status === 'autorizada';
              const warn = s.status === 'pendente' || s.status === 'gerada' || s.status === 'assinada' || s.status === 'enviada';
              const bad = s.status === 'rejeitada' || s.status === 'erro' || s.status === 'denegada';
              const grey = s.status === 'cancelada' || s.status === 'N/D';
              const tone = ok
                ? 'border-emerald-200 bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-400'
                : bad
                  ? 'border-red-300 bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400'
                  : warn
                    ? 'border-amber-300 bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-400'
                    : grey
                      ? 'border-muted bg-muted/40 text-muted-foreground'
                      : 'border-muted bg-muted/40 text-muted-foreground';
              return (
                <div
                  key={s.status}
                  data-testid={`nfe-status-${s.status}`}
                  className={`rounded-xl border px-3 py-2 ${tone}`}
                  title={`${s.total} NF-e com status "${s.status}"`}
                >
                  <span className="block text-[11px] font-bold uppercase tracking-wide opacity-80">{s.status}</span>
                  <p className="text-base font-bold">{s.total}</p>
                </div>
              );
            })}
          </div>
        )}
        {nfeStatusList.some((s) => s.status === 'rejeitada' || s.status === 'erro' || s.status === 'denegada') && (
          <p className="mt-3 text-[11px] text-red-700 dark:text-red-400">
            Há NF-e com falha de transmissão. Acesse a tela Fiscal para revisar o motivo (xMotivo) e reprocessar.
          </p>
        )}
      </div>

      {/* FASE FISCAL 7.9 — Motivos de rejeição com ação rápida (abrir pedido) */}
      <div className="rounded-2xl border bg-card p-4" data-testid="card-nfe-motivos">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-red-600" />
            <h3 className="text-sm font-bold text-foreground">Motivos de rejeição</h3>
          </div>
          <span className="text-xs text-muted-foreground">
            {nfeMotivos.length > 0 && `${nfeMotivos.length} ${nfeMotivos.length === 1 ? 'pedido' : 'pedidos'} para corrigir`}
          </span>
        </div>
        {nfeMotivosLoading ? (
          <div className="text-center py-4 text-muted-foreground text-xs">Carregando...</div>
        ) : nfeMotivos.length === 0 ? (
          <div
            className="text-center py-4 text-muted-foreground text-xs"
            data-testid="text-nfe-motivos-empty"
          >
            Nenhuma rejeição encontrada
          </div>
        ) : (
          <div className="space-y-2">
            {nfeMotivos.map((m, i) => (
              // FASE FISCAL 8.2 — wrapper para acomodar card + painel inline
              // de histórico no mesmo nó iterado.
              <div key={`${m.orderId}-${m.cStat}-${i}`}>
              <div
                data-testid={`row-nfe-motivo-${m.orderId}-${m.cStat || 'na'}`}
                className="rounded-xl border border-red-200 bg-red-50 dark:bg-red-900/20 dark:border-red-900/40 p-3 flex items-start justify-between gap-3"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span
                      className="text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-md bg-red-200/60 text-red-800 dark:bg-red-900/40 dark:text-red-300"
                      data-testid={`badge-nfe-status-${m.orderId}`}
                    >
                      {m.status}
                    </span>
                    {m.cStat && (
                      <span
                        className="text-[11px] font-bold text-red-800 dark:text-red-300"
                        data-testid={`text-nfe-cstat-${m.orderId}`}
                      >
                        cStat {m.cStat}
                      </span>
                    )}
                    <span className="text-[11px] text-muted-foreground">
                      Pedido #{m.orderId}
                    </span>
                    {m.total > 1 && (
                      <span className="text-[10px] text-muted-foreground">
                        ({m.total}× tentativas)
                      </span>
                    )}
                  </div>
                  <p
                    className="mt-1 text-xs text-foreground break-words"
                    data-testid={`text-nfe-xmotivo-${m.orderId}`}
                  >
                    {m.xMotivo || 'Motivo não informado pela SEFAZ.'}
                  </p>
                  <p
                    className="mt-1 text-[11px] text-amber-800 dark:text-amber-300 flex items-center gap-1.5 flex-wrap"
                    data-testid={`text-nfe-sugestao-${m.orderId}`}
                  >
                    <span
                      className="text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded bg-amber-200/60 text-amber-900 dark:bg-amber-900/40 dark:text-amber-200"
                      data-testid={`badge-sugestao-tipo-${m.orderId}`}
                    >
                      {m.sugestao?.tipo ?? 'MANUAL'}
                    </span>
                    <span>💡 {m.sugestao?.mensagem ?? 'Revisar pedido manualmente.'}</span>
                  </p>
                </div>
                <div className="shrink-0 flex flex-col gap-1.5">
                  <button
                    type="button"
                    onClick={() => navigate(`/admin/orders?orderId=${m.orderId}`)}
                    data-testid={`button-abrir-pedido-${m.orderId}`}
                    className="inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-xl bg-red-600 text-white text-xs font-semibold hover:bg-red-700 transition-colors"
                    title={`Abrir pedido #${m.orderId} para corrigir`}
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                    Abrir Pedido
                  </button>
                  {/* FASE FISCAL 8.1 — botão semi-automático aparece SÓ quando o
                      tipo da sugestão é acionável (RECALCULAR/REEMITIR). */}
                  {(m.sugestao?.tipo === 'RECALCULAR' || m.sugestao?.tipo === 'REEMITIR') && (
                    <CorrigirReenviarButton orderId={m.orderId} tipo={m.sugestao.tipo} />
                  )}
                  <ReenviarNfeButton orderId={m.orderId} />
                  {/* FASE FISCAL 8.2 — toggle do painel de histórico (read-only). */}
                  <button
                    type="button"
                    onClick={() => toggleHistorico(m.orderId)}
                    aria-expanded={historicoAberto.has(m.orderId)}
                    data-testid={`button-ver-historico-${m.orderId}`}
                    className="inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 text-xs font-semibold hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
                    title="Ver histórico de tentativas de NF-e"
                  >
                    <History className="w-3.5 h-3.5" />
                    {historicoAberto.has(m.orderId) ? 'Ocultar histórico' : 'Ver histórico'}
                  </button>
                </div>
              </div>
              {/* FASE FISCAL 8.2 — painel inline de auditoria das tentativas. */}
              <NfeHistoricoPanel orderId={m.orderId} open={historicoAberto.has(m.orderId)} />
              </div>
            ))}
          </div>
        )}
      </div>

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
                          <td className="px-4 py-3 font-semibold text-green-700 dark:text-green-400">
                            {fmt(ar.valor)}
                            {ar.status === 'pago' && <BreakdownIndicator arId={ar.id} />}
                          </td>
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
                              {ar.status === 'pago' && (
                                <button
                                  type="button"
                                  onClick={() => setBreakdownModal(ar)}
                                  data-testid={`button-breakdown-ar-${ar.id}`}
                                  className="px-2 py-1 rounded-lg bg-purple-100 hover:bg-purple-200 text-purple-700 text-xs font-semibold transition-colors"
                                >
                                  Composição
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

          {/* BANCO.4 — Importar retorno bancário (consome /api/bank/retorno/itau) */}
          <ImportarRetornoCnab />
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
