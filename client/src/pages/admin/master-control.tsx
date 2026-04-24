import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { useAuth } from '@/hooks/use-auth';
import { queryClient, apiRequest } from '@/lib/queryClient';
import { useToast } from '@/hooks/use-toast';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  AlertTriangle, Users, KeyRound, Shield, Lock, Unlock, Eye, EyeOff,
  Activity, RotateCcw, LayoutDashboard, Package, CreditCard, FileText,
  Building2, TrendingUp, CheckCircle2, XCircle, Clock, AlertCircle,
  Plus, Pencil, Trash2, Star, RefreshCw, Wifi, DollarSign, Zap,
  Brain, Settings2, MapPin, Truck, Route, UserCheck, BarChart3, Plug, Store,
  ShoppingCart, CheckSquare, Square,
} from 'lucide-react';
import type { User, Plano, Assinatura, BillingEvent, Company } from '@shared/schema';

// ─── Constants ─────────────────────────────────────────────────────────────────
const ROLES = ['MASTER', 'ADMIN', 'DIRECTOR', 'DEVELOPER', 'OPERATIONS_MANAGER', 'PURCHASE_MANAGER', 'FINANCEIRO', 'LOGISTICS'];
const ROLE_LABELS: Record<string, string> = {
  MASTER: 'Master', ADMIN: 'Administrador', DIRECTOR: 'Diretor',
  DEVELOPER: 'Desenvolvedor', OPERATIONS_MANAGER: 'Gerente de Operações',
  PURCHASE_MANAGER: 'Gerente de Compras', FINANCEIRO: 'Financeiro', LOGISTICS: 'Logística',
};

const STATUS_STYLES: Record<string, { label: string; className: string; icon: any }> = {
  trial:       { label: 'Trial',       className: 'bg-blue-100 text-blue-800 border-blue-200',     icon: Clock },
  ativa:       { label: 'Ativa',       className: 'bg-green-100 text-green-800 border-green-200',   icon: CheckCircle2 },
  inadimplente:{ label: 'Inadimplente',className: 'bg-red-100 text-red-800 border-red-200',         icon: AlertCircle },
  cancelada:   { label: 'Cancelada',   className: 'bg-gray-100 text-gray-700 border-gray-200',      icon: XCircle },
  suspensa:    { label: 'Suspensa',    className: 'bg-amber-100 text-amber-800 border-amber-200',   icon: AlertTriangle },
};

const BILLING_STATUS: Record<string, { label: string; color: string }> = {
  pendente: { label: 'Pendente', color: 'bg-yellow-100 text-yellow-800' },
  pago:     { label: 'Pago',     color: 'bg-green-100 text-green-800' },
  falhou:   { label: 'Falhou',   color: 'bg-red-100 text-red-800' },
  estornado:{ label: 'Estornado',color: 'bg-gray-100 text-gray-700' },
};

function StatusBadge({ status }: { status: string }) {
  const s = STATUS_STYLES[status] || { label: status, className: 'bg-gray-100 text-gray-700 border-gray-200', icon: Clock };
  const Icon = s.icon;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium border ${s.className}`}>
      <Icon className="w-3 h-3" />
      {s.label}
    </span>
  );
}

function fmt(val?: string | null) { return val ? `R$ ${parseFloat(val).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}` : '—'; }
function fmtDate(d?: string | Date | null) { if (!d) return '—'; return new Date(d).toLocaleDateString('pt-BR'); }

// ─── Constantes de módulos ─────────────────────────────────────────────────────
const TODOS_MODULOS = [
  { chave: 'dashboard',   nome: 'Dashboard',        icone: LayoutDashboard, cat: 'Geral' },
  { chave: 'empresas',    nome: 'Empresas',          icone: Building2,       cat: 'Gestão' },
  { chave: 'clientes',    nome: 'Clientes',          icone: Users,           cat: 'Comercial' },
  { chave: 'produtos',    nome: 'Produtos',          icone: Package,         cat: 'Estoque' },
  { chave: 'pedidos',     nome: 'Pedidos',           icone: ShoppingCart,    cat: 'Comercial' },
  { chave: 'logistica',   nome: 'Logística',         icone: Truck,           cat: 'Logística' },
  { chave: 'rotas',       nome: 'Rotas',             icone: Route,           cat: 'Logística' },
  { chave: 'motoristas',  nome: 'Motoristas',        icone: UserCheck,       cat: 'Logística' },
  { chave: 'gps',         nome: 'GPS',               icone: MapPin,          cat: 'Logística' },
  { chave: 'relatorios',  nome: 'Relatórios',        icone: BarChart3,       cat: 'Financeiro' },
  { chave: 'financeiro',  nome: 'Financeiro',        icone: DollarSign,      cat: 'Financeiro' },
  { chave: 'nota_fiscal', nome: 'Nota Fiscal',       icone: FileText,        cat: 'Fiscal' },
  { chave: 'integracoes', nome: 'Integrações',       icone: Plug,            cat: 'Admin' },
  { chave: 'ia',          nome: 'IA Operacional',    icone: Brain,           cat: 'IA' },
  { chave: 'marketplace', nome: 'Loja de Módulos',   icone: Store,           cat: 'SaaS' },
];

const NIVEIS_IA = [
  { value: 'limitada',   label: 'Limitada',   desc: 'Apenas alertas básicos' },
  { value: 'basica',     label: 'Básica',     desc: 'Análises simples + Clara' },
  { value: 'completa',   label: 'Completa',   desc: 'Auto-fix + diagnósticos avançados' },
  { value: 'ilimitada',  label: 'Ilimitada',  desc: 'Todas as IAs sem restrições' },
];

// ─── Plano Form Modal ──────────────────────────────────────────────────────────
function PlanoModal({ open, onClose, plano }: { open: boolean; onClose: () => void; plano?: Plano | null }) {
  const { toast } = useToast();
  const [tab, setTab] = useState<'info' | 'modulos' | 'limites' | 'ia'>('info');

  const defaultModulos = plano?.modulosHabilitados ?? ['dashboard', 'pedidos', 'produtos'];
  const [modulosSel, setModulosSel] = useState<string[]>(defaultModulos as string[]);

  const [form, setForm] = useState<any>(plano ? {
    nome: plano.nome,
    descricao: plano.descricao || '',
    preco: plano.preco,
    tipoPlano: plano.tipoPlano || 'premium',
    limiteUsuarios: plano.limiteUsuarios ?? 10,
    limiteProdutos: plano.limiteProdutos ?? 100,
    limitePedidos: plano.limitePedidos ?? 500,
    limiteMotoristas: plano.limiteMotoristas ?? 5,
    limiteIA: plano.limiteIA ?? 100,
    nivelIA: plano.nivelIA || 'basica',
    gpsHabilitado: plano.gpsHabilitado ?? false,
    destaque: plano.destaque,
    ativo: plano.ativo,
  } : {
    nome: '', descricao: '', preco: '0', tipoPlano: 'premium',
    limiteUsuarios: 10, limiteProdutos: 100, limitePedidos: 500,
    limiteMotoristas: 5, limiteIA: 100, nivelIA: 'basica',
    gpsHabilitado: false, destaque: false, ativo: true,
  });

  const saveMutation = useMutation({
    mutationFn: () => {
      const payload = { ...form, modulosHabilitados: modulosSel };
      return plano
        ? apiRequest('PUT', `/api/master/planos/${plano.id}`, payload)
        : apiRequest('POST', '/api/master/planos', payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/master/planos'] });
      toast({ title: plano ? 'Plano atualizado!' : 'Plano criado!', description: `${modulosSel.length} módulos configurados` });
      onClose();
    },
    onError: (e: any) => toast({ title: 'Erro', description: e.message, variant: 'destructive' }),
  });

  const toggleModulo = (chave: string) => {
    setModulosSel(prev => prev.includes(chave) ? prev.filter(m => m !== chave) : [...prev, chave]);
  };

  const cats = Array.from(new Set(TODOS_MODULOS.map(m => m.cat)));

  const TABS = [
    { key: 'info',    label: 'Informações', icon: Settings2 },
    { key: 'modulos', label: 'Módulos',     icon: Package },
    { key: 'limites', label: 'Limites',     icon: Shield },
    { key: 'ia',      label: 'IA',          icon: Brain },
  ] as const;

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Settings2 className="w-5 h-5 text-violet-500" />
            {plano ? 'Editar Plano' : 'Novo Plano'}
          </DialogTitle>
        </DialogHeader>

        {/* Tab Nav */}
        <div className="flex gap-1 border-b border-border pb-1">
          {TABS.map(t => {
            const Icon = t.icon;
            return (
              <button
                key={t.key}
                type="button"
                onClick={() => setTab(t.key)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-t text-xs font-medium transition-colors ${
                  tab === t.key
                    ? 'bg-violet-50 text-violet-700 border-b-2 border-violet-500'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
                data-testid={`tab-plano-${t.key}`}
              >
                <Icon className="w-3.5 h-3.5" />
                {t.label}
                {t.key === 'modulos' && (
                  <span className="ml-1 bg-violet-100 text-violet-700 px-1.5 rounded-full text-[10px]">{modulosSel.length}</span>
                )}
              </button>
            );
          })}
        </div>

        <div className="overflow-y-auto flex-1 py-2">
          {/* ── ABA INFORMAÇÕES ── */}
          {tab === 'info' && (
            <div className="space-y-4 px-1">
              <div>
                <Label className="text-xs">Nome do Plano *</Label>
                <Input value={form.nome} onChange={e => setForm({ ...form, nome: e.target.value })} placeholder="Ex: Starter, Pro, Enterprise" data-testid="input-plano-nome" />
              </div>
              <div>
                <Label className="text-xs">Tipo do Plano</Label>
                <Select value={form.tipoPlano} onValueChange={v => setForm({ ...form, tipoPlano: v })}>
                  <SelectTrigger data-testid="select-plano-tipo"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="free">Free</SelectItem>
                    <SelectItem value="starter">Starter</SelectItem>
                    <SelectItem value="premium">Premium</SelectItem>
                    <SelectItem value="enterprise">Enterprise</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Descrição</Label>
                <Textarea value={form.descricao} onChange={e => setForm({ ...form, descricao: e.target.value })} rows={2} placeholder="Descreva o que este plano inclui" data-testid="input-plano-descricao" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs">Preço Mensal (R$)</Label>
                  <Input type="number" value={form.preco} onChange={e => setForm({ ...form, preco: e.target.value })} data-testid="input-plano-preco" />
                </div>
              </div>
              <div className="flex items-center gap-6 pt-1">
                <label className="flex items-center gap-2 cursor-pointer text-sm">
                  <input type="checkbox" checked={form.destaque} onChange={e => setForm({ ...form, destaque: e.target.checked })} data-testid="check-plano-destaque" />
                  <Star className="w-3.5 h-3.5 text-amber-500" />
                  Plano em Destaque
                </label>
                <label className="flex items-center gap-2 cursor-pointer text-sm">
                  <input type="checkbox" checked={form.ativo} onChange={e => setForm({ ...form, ativo: e.target.checked })} data-testid="check-plano-ativo" />
                  <CheckCircle2 className="w-3.5 h-3.5 text-green-500" />
                  Ativo
                </label>
              </div>
            </div>
          )}

          {/* ── ABA MÓDULOS ── */}
          {tab === 'modulos' && (
            <div className="space-y-4 px-1">
              <div className="flex items-center justify-between">
                <p className="text-xs text-muted-foreground">Selecione os módulos disponíveis para empresas com este plano</p>
                <div className="flex gap-2">
                  <button type="button" onClick={() => setModulosSel(TODOS_MODULOS.map(m => m.chave))}
                    className="text-xs text-violet-600 hover:underline flex items-center gap-1">
                    <CheckSquare className="w-3 h-3" /> Todos
                  </button>
                  <button type="button" onClick={() => setModulosSel([])}
                    className="text-xs text-red-500 hover:underline flex items-center gap-1">
                    <Square className="w-3 h-3" /> Nenhum
                  </button>
                </div>
              </div>
              {cats.map(cat => (
                <div key={cat}>
                  <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">{cat}</p>
                  <div className="grid grid-cols-2 gap-2">
                    {TODOS_MODULOS.filter(m => m.cat === cat).map(m => {
                      const Icon = m.icone;
                      const ativo = modulosSel.includes(m.chave);
                      return (
                        <button
                          key={m.chave}
                          type="button"
                          onClick={() => toggleModulo(m.chave)}
                          data-testid={`modulo-${m.chave}`}
                          className={`flex items-center gap-2 p-2.5 rounded-lg border text-left transition-all text-sm ${
                            ativo
                              ? 'border-violet-300 bg-violet-50 text-violet-800'
                              : 'border-border bg-background text-muted-foreground hover:border-violet-200'
                          }`}
                        >
                          <Icon className={`w-4 h-4 shrink-0 ${ativo ? 'text-violet-600' : 'text-muted-foreground'}`} />
                          <span className="font-medium text-xs">{m.nome}</span>
                          {ativo && <CheckCircle2 className="w-3 h-3 text-violet-500 ml-auto" />}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* ── ABA LIMITES ── */}
          {tab === 'limites' && (
            <div className="space-y-4 px-1">
              <p className="text-xs text-muted-foreground">Defina os limites operacionais. O sistema bloqueará automaticamente quando atingidos.</p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs">Máx. Usuários</Label>
                  <Input type="number" value={form.limiteUsuarios} onChange={e => setForm({ ...form, limiteUsuarios: Number(e.target.value) })} data-testid="input-plano-usuarios" />
                </div>
                <div>
                  <Label className="text-xs">Máx. Produtos</Label>
                  <Input type="number" value={form.limiteProdutos} onChange={e => setForm({ ...form, limiteProdutos: Number(e.target.value) })} data-testid="input-plano-produtos" />
                </div>
                <div>
                  <Label className="text-xs">Máx. Pedidos/mês</Label>
                  <Input type="number" value={form.limitePedidos} onChange={e => setForm({ ...form, limitePedidos: Number(e.target.value) })} data-testid="input-plano-pedidos" />
                </div>
                <div>
                  <Label className="text-xs">Máx. Motoristas</Label>
                  <Input type="number" value={form.limiteMotoristas} onChange={e => setForm({ ...form, limiteMotoristas: Number(e.target.value) })} data-testid="input-plano-motoristas" />
                </div>
              </div>
              <div className="flex items-center gap-3 pt-2 p-3 border rounded-lg">
                <MapPin className="w-5 h-5 text-green-600 shrink-0" />
                <div className="flex-1">
                  <p className="text-sm font-medium">GPS Habilitado</p>
                  <p className="text-xs text-muted-foreground">Rastreamento GPS em tempo real para motoristas</p>
                </div>
                <Switch
                  checked={form.gpsHabilitado}
                  onCheckedChange={v => setForm({ ...form, gpsHabilitado: v })}
                  data-testid="switch-plano-gps"
                />
              </div>
            </div>
          )}

          {/* ── ABA IA ── */}
          {tab === 'ia' && (
            <div className="space-y-4 px-1">
              <p className="text-xs text-muted-foreground">Configure o nível de acesso às IAs do sistema para este plano.</p>
              <div>
                <Label className="text-xs mb-2 block">Nível de IA</Label>
                <div className="grid grid-cols-2 gap-2">
                  {NIVEIS_IA.map(n => (
                    <button
                      key={n.value}
                      type="button"
                      onClick={() => setForm({ ...form, nivelIA: n.value })}
                      data-testid={`nivel-ia-${n.value}`}
                      className={`p-3 rounded-lg border text-left transition-all ${
                        form.nivelIA === n.value
                          ? 'border-violet-400 bg-violet-50'
                          : 'border-border hover:border-violet-200'
                      }`}
                    >
                      <div className="flex items-center gap-2 mb-1">
                        <Brain className={`w-4 h-4 ${form.nivelIA === n.value ? 'text-violet-600' : 'text-muted-foreground'}`} />
                        <span className={`font-semibold text-xs ${form.nivelIA === n.value ? 'text-violet-700' : 'text-foreground'}`}>{n.label}</span>
                        {form.nivelIA === n.value && <CheckCircle2 className="w-3 h-3 text-violet-500 ml-auto" />}
                      </div>
                      <p className="text-[11px] text-muted-foreground">{n.desc}</p>
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <Label className="text-xs">Limite de Interações de IA por mês</Label>
                <div className="flex items-center gap-2 mt-1">
                  <Input
                    type="number"
                    value={form.limiteIA}
                    onChange={e => setForm({ ...form, limiteIA: Number(e.target.value) })}
                    data-testid="input-plano-limite-ia"
                    className="w-40"
                  />
                  <span className="text-xs text-muted-foreground">interações/mês (0 = ilimitado)</span>
                </div>
              </div>
              <div className="bg-blue-50 dark:bg-blue-950/20 border border-blue-200 rounded-lg p-3">
                <p className="text-xs font-medium text-blue-800 dark:text-blue-300 mb-1">IAs incluídas por nível:</p>
                <ul className="text-xs text-blue-700 dark:text-blue-400 space-y-1">
                  <li><strong>Limitada:</strong> Alertas básicos de estoque</li>
                  <li><strong>Básica:</strong> Clara IA + análises simples</li>
                  <li><strong>Completa:</strong> Auto-fix + NF-e diagnóstico + IA Developer</li>
                  <li><strong>Ilimitada:</strong> Todas as IAs + Sincronização automática</li>
                </ul>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex gap-2 pt-3 border-t border-border">
          <Button type="button" variant="outline" onClick={onClose} className="flex-1">Cancelar</Button>
          <Button
            type="button"
            onClick={() => saveMutation.mutate()}
            disabled={!form.nome || saveMutation.isPending}
            className="flex-1"
            data-testid="button-save-plano"
          >
            {saveMutation.isPending ? 'Salvando...' : `Salvar (${modulosSel.length} módulos)`}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Assinatura Form Modal ─────────────────────────────────────────────────────
function AssinaturaModal({ open, onClose, assinatura, planos, companies }: {
  open: boolean; onClose: () => void;
  assinatura?: Assinatura | null;
  planos: Plano[]; companies: Company[];
}) {
  const { toast } = useToast();
  const [form, setForm] = useState<any>(assinatura ? {
    companyId: String(assinatura.companyId),
    planoId: assinatura.planoId ? String(assinatura.planoId) : '',
    status: assinatura.status,
    dataExpiracao: assinatura.dataExpiracao ? new Date(assinatura.dataExpiracao).toISOString().split('T')[0] : '',
    gatewayPagamento: assinatura.gatewayPagamento || '',
    valor: assinatura.valor || '',
    observacoes: assinatura.observacoes || '',
  } : { companyId: 'none', planoId: 'none', status: 'trial', dataExpiracao: '', gatewayPagamento: 'none', valor: '', observacoes: '' });

  const saveMutation = useMutation({
    mutationFn: () => {
      const payload = {
        ...form,
        companyId: Number(form.companyId === 'none' ? 0 : form.companyId),
        planoId: (form.planoId && form.planoId !== 'none') ? Number(form.planoId) : null,
        gatewayPagamento: form.gatewayPagamento === 'none' ? null : form.gatewayPagamento,
        dataExpiracao: form.dataExpiracao ? new Date(form.dataExpiracao) : null,
      };
      return assinatura
        ? apiRequest('PUT', `/api/master/assinaturas/${assinatura.id}`, payload)
        : apiRequest('POST', '/api/master/assinaturas', payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/master/assinaturas'] });
      toast({ title: assinatura ? 'Assinatura atualizada!' : 'Assinatura criada!' });
      onClose();
    },
    onError: (e: any) => toast({ title: 'Erro', description: e.message, variant: 'destructive' }),
  });

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{assinatura ? 'Editar Assinatura' : 'Nova Assinatura'}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div>
            <Label className="text-xs">Empresa *</Label>
            <Select value={form.companyId} onValueChange={v => setForm({ ...form, companyId: v })}>
              <SelectTrigger data-testid="select-assinatura-empresa"><SelectValue placeholder="Selecionar empresa" /></SelectTrigger>
              <SelectContent>
                {companies.map(c => <SelectItem key={c.id} value={String(c.id)}>{c.companyName}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Plano</Label>
              <Select value={form.planoId || 'none'} onValueChange={v => setForm({ ...form, planoId: v === 'none' ? '' : v })}>
                <SelectTrigger data-testid="select-assinatura-plano"><SelectValue placeholder="Sem plano" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Sem plano</SelectItem>
                  {planos.map(p => <SelectItem key={p.id} value={String(p.id)}>{p.nome}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Status</Label>
              <Select value={form.status} onValueChange={v => setForm({ ...form, status: v })}>
                <SelectTrigger data-testid="select-assinatura-status"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(STATUS_STYLES).map(([k, v]) => (
                    <SelectItem key={k} value={k}>{v.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Valor (R$)</Label>
              <Input type="number" value={form.valor} onChange={e => setForm({ ...form, valor: e.target.value })} data-testid="input-assinatura-valor" />
            </div>
            <div>
              <Label className="text-xs">Vencimento</Label>
              <Input type="date" value={form.dataExpiracao} onChange={e => setForm({ ...form, dataExpiracao: e.target.value })} data-testid="input-assinatura-vencimento" />
            </div>
          </div>
          <div>
            <Label className="text-xs">Gateway de Pagamento</Label>
            <Select value={form.gatewayPagamento || 'none'} onValueChange={v => setForm({ ...form, gatewayPagamento: v === 'none' ? '' : v })}>
              <SelectTrigger data-testid="select-assinatura-gateway"><SelectValue placeholder="Selecionar gateway" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Nenhum</SelectItem>
                <SelectItem value="mercadopago">MercadoPago</SelectItem>
                <SelectItem value="stripe">Stripe</SelectItem>
                <SelectItem value="pix">PIX Manual</SelectItem>
                <SelectItem value="manual">Manual</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Observações</Label>
            <Textarea value={form.observacoes} onChange={e => setForm({ ...form, observacoes: e.target.value })} rows={2} data-testid="input-assinatura-obs" />
          </div>
          <div className="flex gap-2 pt-2">
            <Button type="button" variant="outline" onClick={onClose} className="flex-1">Cancelar</Button>
            <Button type="button" onClick={() => saveMutation.mutate()} disabled={!form.companyId || saveMutation.isPending} className="flex-1" data-testid="button-save-assinatura">
              {saveMutation.isPending ? 'Salvando...' : 'Salvar'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Billing Event Modal ───────────────────────────────────────────────────────
function BillingEventModal({ open, onClose, companies, assinaturas }: {
  open: boolean; onClose: () => void; companies: Company[]; assinaturas: Assinatura[];
}) {
  const { toast } = useToast();
  const [form, setForm] = useState({ companyId: '', assinaturaId: '', tipo: 'pagamento', valor: '', status: 'pago', gateway: '', descricao: '' });

  const saveMutation = useMutation({
    mutationFn: () => apiRequest('POST', '/api/master/billing-events', {
      ...form,
      companyId: form.companyId ? Number(form.companyId) : null,
      assinaturaId: form.assinaturaId ? Number(form.assinaturaId) : null,
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/master/billing-events'] });
      queryClient.invalidateQueries({ queryKey: ['/api/master/stats'] });
      toast({ title: 'Evento de cobrança registrado!' });
      onClose();
    },
    onError: (e: any) => toast({ title: 'Erro', description: e.message, variant: 'destructive' }),
  });

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Registrar Evento de Cobrança</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Empresa</Label>
              <Select value={form.companyId || 'none'} onValueChange={v => setForm({ ...form, companyId: v === 'none' ? '' : v })}>
                <SelectTrigger data-testid="select-billing-empresa"><SelectValue placeholder="Selecionar" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Nenhuma</SelectItem>
                  {companies.map(c => <SelectItem key={c.id} value={String(c.id)}>{c.companyName}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Tipo do Evento</Label>
              <Select value={form.tipo} onValueChange={v => setForm({ ...form, tipo: v })}>
                <SelectTrigger data-testid="select-billing-tipo"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {['pagamento','reembolso','cancelamento','vencimento','upgrade','downgrade'].map(t => (
                    <SelectItem key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Valor (R$)</Label>
              <Input type="number" value={form.valor} onChange={e => setForm({ ...form, valor: e.target.value })} data-testid="input-billing-valor" />
            </div>
            <div>
              <Label className="text-xs">Status</Label>
              <Select value={form.status} onValueChange={v => setForm({ ...form, status: v })}>
                <SelectTrigger data-testid="select-billing-status"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(BILLING_STATUS).map(([k, v]) => <SelectItem key={k} value={k}>{v.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div>
            <Label className="text-xs">Gateway</Label>
            <Input value={form.gateway} onChange={e => setForm({ ...form, gateway: e.target.value })} placeholder="mercadopago, stripe, pix..." data-testid="input-billing-gateway" />
          </div>
          <div>
            <Label className="text-xs">Descrição</Label>
            <Input value={form.descricao} onChange={e => setForm({ ...form, descricao: e.target.value })} data-testid="input-billing-descricao" />
          </div>
          <div className="flex gap-2 pt-2">
            <Button type="button" variant="outline" onClick={onClose} className="flex-1">Cancelar</Button>
            <Button type="button" onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending} className="flex-1" data-testid="button-save-billing">
              {saveMutation.isPending ? 'Salvando...' : 'Registrar'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Main Component ─────────────────────────────────────────────────────────────
const TABS = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'empresas', label: 'Empresas', icon: Building2 },
  { id: 'planos', label: 'Planos', icon: Package },
  { id: 'assinaturas', label: 'Assinaturas', icon: CreditCard },
  { id: 'faturamento', label: 'Faturamento', icon: DollarSign },
  { id: 'usuarios', label: 'Usuários', icon: Users },
  { id: 'logs', label: 'Logs', icon: FileText },
];

export default function MasterControl() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [tab, setTab] = useState('dashboard');
  const [search, setSearch] = useState('');
  const [resetPasswordId, setResetPasswordId] = useState<number | null>(null);
  const [newPassword, setNewPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [planoModal, setPlanoModal] = useState<{ open: boolean; plano?: Plano | null }>({ open: false });
  const [assinaturaModal, setAssinaturaModal] = useState<{ open: boolean; assinatura?: Assinatura | null }>({ open: false });
  const [billingModal, setBillingModal] = useState(false);

  const { data: stats } = useQuery<any>({ queryKey: ['/api/master/stats'] });
  const { data: users = [], isLoading: loadingUsers } = useQuery<User[]>({ queryKey: ['/api/master/users'] });
  const { data: logs = [] } = useQuery<any[]>({ queryKey: ['/api/master/logs'] });
  const { data: planos = [] } = useQuery<Plano[]>({ queryKey: ['/api/master/planos'] });
  const { data: assinaturas = [] } = useQuery<Assinatura[]>({ queryKey: ['/api/master/assinaturas'] });
  const { data: billingEvents = [] } = useQuery<BillingEvent[]>({ queryKey: ['/api/master/billing-events'] });
  const { data: companies = [] } = useQuery<Company[]>({ queryKey: ['/api/companies'] });

  const updateUserMutation = useMutation({
    mutationFn: ({ id, updates }: { id: number; updates: any }) =>
      apiRequest('PATCH', `/api/master/users/${id}`, updates),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/master/users'] });
      toast({ title: 'Usuário atualizado com sucesso' });
    },
    onError: (e: any) => toast({ title: 'Erro', description: e.message, variant: 'destructive' }),
  });

  const resetPasswordMutation = useMutation({
    mutationFn: ({ userId, newPassword }: { userId: number; newPassword: string }) =>
      apiRequest('POST', '/api/master/reset-password', { userId, newPassword }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/master/users'] });
      toast({ title: 'Senha resetada com sucesso' });
      setResetPasswordId(null);
      setNewPassword('');
    },
    onError: (e: any) => toast({ title: 'Erro', description: e.message, variant: 'destructive' }),
  });

  const unlockMutation = useMutation({
    mutationFn: (userId: number) => apiRequest('POST', '/api/master/unlock-user', { userId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/master/users'] });
      toast({ title: 'Conta desbloqueada' });
    },
    onError: (e: any) => toast({ title: 'Erro', description: e.message, variant: 'destructive' }),
  });

  const deletePlanoMutation = useMutation({
    mutationFn: (id: number) => apiRequest('DELETE', `/api/master/planos/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/master/planos'] });
      toast({ title: 'Plano excluído' });
    },
    onError: (e: any) => toast({ title: 'Erro', description: e.message, variant: 'destructive' }),
  });

  if (user?.role !== 'MASTER') {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <Shield className="w-16 h-16 text-destructive mx-auto mb-4" />
          <p className="text-xl font-bold text-foreground">Acesso Restrito</p>
          <p className="text-muted-foreground mt-1">Esta área é exclusiva para usuários MASTER.</p>
        </div>
      </div>
    );
  }

  const filteredUsers = users.filter(u =>
    u.name.toLowerCase().includes(search.toLowerCase()) ||
    u.email.toLowerCase().includes(search.toLowerCase()) ||
    u.role.toLowerCase().includes(search.toLowerCase())
  );
  const masterLogs = logs.filter((l: any) => l.action?.startsWith('MASTER_'));

  // Map companyId → company name
  const companyMap: Record<number, string> = {};
  companies.forEach((c: Company) => { companyMap[c.id] = c.companyName; });

  // Map planoId → plano nome
  const planoMap: Record<number, string> = {};
  planos.forEach((p: Plano) => { planoMap[p.id] = p.nome; });

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-purple-500 to-purple-700 flex items-center justify-center shadow-lg">
          <Shield className="w-6 h-6 text-white" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-foreground">Painel MASTER — SaaS</h1>
          <p className="text-sm text-muted-foreground">Gestão completa da plataforma VivaFrutaz</p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <Badge className="bg-purple-100 text-purple-800 border-purple-200">MASTER ACCESS</Badge>
          <Button type="button" variant="outline" size="sm" onClick={() => {
            queryClient.invalidateQueries({ queryKey: ['/api/master/stats'] });
            queryClient.invalidateQueries({ queryKey: ['/api/master/planos'] });
            queryClient.invalidateQueries({ queryKey: ['/api/master/assinaturas'] });
            queryClient.invalidateQueries({ queryKey: ['/api/master/billing-events'] });
          }} data-testid="button-refresh-master">
            <RefreshCw className="w-4 h-4" />
          </Button>
        </div>
      </div>

      {/* Warning */}
      <div className="flex items-start gap-3 p-3 bg-amber-50 border border-amber-200 rounded-xl dark:bg-amber-900/20 dark:border-amber-800">
        <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
        <p className="text-xs text-amber-800 dark:text-amber-200">
          <strong>Atenção:</strong> Todas as ações realizadas neste painel são registradas automaticamente no log de auditoria do sistema.
        </p>
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
              data-testid={`tab-master-${t.id}`}
              className={`flex items-center gap-2 px-4 py-2 rounded-t-lg text-sm font-medium whitespace-nowrap transition-colors ${
                tab === t.id
                  ? 'bg-background border border-b-0 border-border text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
              }`}
            >
              <Icon className="w-4 h-4" />
              {t.label}
            </button>
          );
        })}
      </div>

      {/* ── Dashboard ─────────────────────────────────────────────────────────── */}
      {tab === 'dashboard' && (
        <div className="space-y-6">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[
              { label: 'Total de Empresas', value: stats?.totalEmpresas ?? companies.length, icon: Building2, color: 'text-blue-600 bg-blue-50', sub: `${stats?.empresasAtivas ?? 0} ativas` },
              { label: 'Assinaturas Ativas', value: stats?.assinaturasAtivas ?? 0, icon: CheckCircle2, color: 'text-green-600 bg-green-50', sub: `${stats?.assinaturasTrial ?? 0} em trial` },
              { label: 'Inadimplentes', value: stats?.assinaturasInadimplentes ?? 0, icon: AlertCircle, color: 'text-red-600 bg-red-50', sub: `${stats?.totalAssinaturas ?? 0} total` },
              { label: 'Receita Total', value: stats?.receitaTotal ? `R$ ${parseFloat(stats.receitaTotal).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}` : 'R$ 0,00', icon: TrendingUp, color: 'text-emerald-600 bg-emerald-50', sub: `${stats?.eventosCobranca ?? 0} cobranças` },
            ].map(stat => (
              <div key={stat.label} className="bg-card rounded-xl border border-border/50 p-4">
                <div className={`w-9 h-9 rounded-lg flex items-center justify-center mb-2 ${stat.color}`}>
                  <stat.icon className="w-5 h-5" />
                </div>
                <p className="text-xl font-bold text-foreground">{stat.value}</p>
                <p className="text-xs text-muted-foreground">{stat.label}</p>
                {stat.sub && <p className="text-[10px] text-muted-foreground mt-0.5">{stat.sub}</p>}
              </div>
            ))}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Planos ativos */}
            <div className="bg-card rounded-xl border border-border/50 p-5">
              <h3 className="font-semibold text-foreground mb-4 flex items-center gap-2">
                <Package className="w-4 h-4 text-primary" />
                Planos Disponíveis
              </h3>
              <div className="space-y-2">
                {planos.filter(p => p.ativo).map(p => (
                  <div key={p.id} className="flex items-center justify-between text-sm">
                    <div className="flex items-center gap-2">
                      {p.destaque && <Star className="w-3 h-3 text-amber-500" />}
                      <span className="text-foreground">{p.nome}</span>
                    </div>
                    <span className="text-muted-foreground">{fmt(p.preco)}/mês</span>
                  </div>
                ))}
                {planos.filter(p => p.ativo).length === 0 && (
                  <p className="text-sm text-muted-foreground text-center py-4">Nenhum plano cadastrado</p>
                )}
              </div>
              <Button type="button" size="sm" variant="outline" className="w-full mt-4 text-xs" onClick={() => setTab('planos')} data-testid="button-goto-planos">
                Gerenciar Planos
              </Button>
            </div>

            {/* Assinaturas recentes */}
            <div className="bg-card rounded-xl border border-border/50 p-5">
              <h3 className="font-semibold text-foreground mb-4 flex items-center gap-2">
                <CreditCard className="w-4 h-4 text-primary" />
                Assinaturas Recentes
              </h3>
              <div className="space-y-2">
                {assinaturas.slice(0, 5).map(a => (
                  <div key={a.id} className="flex items-center justify-between text-sm">
                    <span className="text-foreground truncate max-w-[140px]">{companyMap[a.companyId] || `Empresa #${a.companyId}`}</span>
                    <StatusBadge status={a.status} />
                  </div>
                ))}
                {assinaturas.length === 0 && (
                  <p className="text-sm text-muted-foreground text-center py-4">Nenhuma assinatura cadastrada</p>
                )}
              </div>
              <Button type="button" size="sm" variant="outline" className="w-full mt-4 text-xs" onClick={() => setTab('assinaturas')} data-testid="button-goto-assinaturas">
                Ver Todas Assinaturas
              </Button>
            </div>
          </div>

          {/* Billing snapshot */}
          <div className="bg-card rounded-xl border border-border/50 p-5">
            <h3 className="font-semibold text-foreground mb-4 flex items-center gap-2">
              <DollarSign className="w-4 h-4 text-primary" />
              Últimos Eventos de Cobrança
            </h3>
            <div className="space-y-2">
              {billingEvents.slice(0, 6).map(b => (
                <div key={b.id} className="flex items-center justify-between text-sm py-1.5 border-b border-border/30 last:border-0">
                  <div>
                    <p className="text-foreground">{b.descricao || b.tipo}</p>
                    <p className="text-[11px] text-muted-foreground">{companyMap[b.companyId!] || '—'} • {fmtDate(b.createdAt)}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-foreground font-medium">{fmt(b.valor)}</span>
                    <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${BILLING_STATUS[b.status]?.color || 'bg-gray-100 text-gray-700'}`}>
                      {BILLING_STATUS[b.status]?.label || b.status}
                    </span>
                  </div>
                </div>
              ))}
              {billingEvents.length === 0 && (
                <p className="text-sm text-muted-foreground text-center py-4">Nenhum evento de cobrança</p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Empresas ─────────────────────────────────────────────────────────── */}
      {tab === 'empresas' && (
        <div className="space-y-4">
          <div className="bg-card rounded-2xl border border-border/50">
            <div className="p-5 border-b border-border/50 flex items-center gap-3">
              <Building2 className="w-5 h-5 text-primary" />
              <h2 className="font-bold text-foreground">Empresas Cadastradas</h2>
              <Badge variant="outline" className="ml-auto">{companies.length} empresa{companies.length !== 1 ? 's' : ''}</Badge>
            </div>
            <div className="divide-y divide-border/50">
              {companies.map((c: Company) => {
                const assinatura = assinaturas.find(a => a.companyId === c.id);
                return (
                  <div key={c.id} className="p-4 flex items-center gap-4 flex-wrap" data-testid={`row-empresa-${c.id}`}>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="font-semibold text-foreground text-sm">{c.companyName}</p>
                        {!c.active && <Badge variant="secondary" className="text-[10px]">Inativa</Badge>}
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5">{c.email} • {c.cnpj || 'Sem CNPJ'}</p>
                    </div>
                    <div className="flex items-center gap-2 flex-wrap">
                      {assinatura ? (
                        <>
                          <StatusBadge status={assinatura.status} />
                          <span className="text-xs text-muted-foreground">{planoMap[assinatura.planoId!] || 'Sem plano'}</span>
                          {assinatura.dataExpiracao && (
                            <span className="text-xs text-muted-foreground">Vence: {fmtDate(assinatura.dataExpiracao)}</span>
                          )}
                        </>
                      ) : (
                        <span className="text-xs text-muted-foreground">Sem assinatura</span>
                      )}
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="h-7 text-xs"
                        onClick={() => setAssinaturaModal({ open: true, assinatura: assinatura || null })}
                        data-testid={`button-manage-assinatura-${c.id}`}
                      >
                        {assinatura ? 'Editar Assinatura' : 'Criar Assinatura'}
                      </Button>
                    </div>
                  </div>
                );
              })}
              {companies.length === 0 && (
                <div className="p-8 text-center text-muted-foreground text-sm">Nenhuma empresa cadastrada</div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Planos ───────────────────────────────────────────────────────────── */}
      {tab === 'planos' && (
        <div className="space-y-4">
          <div className="flex justify-end">
            <Button type="button" onClick={() => setPlanoModal({ open: true })} data-testid="button-new-plano">
              <Plus className="w-4 h-4 mr-2" />
              Novo Plano
            </Button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {planos.map(p => (
              <div key={p.id} className={`bg-card rounded-2xl border p-5 relative ${p.destaque ? 'border-primary shadow-md' : 'border-border/50'}`} data-testid={`card-plano-${p.id}`}>
                {p.destaque && (
                  <div className="absolute -top-2.5 left-1/2 -translate-x-1/2">
                    <span className="bg-primary text-primary-foreground text-[10px] font-bold px-3 py-0.5 rounded-full flex items-center gap-1">
                      <Star className="w-2.5 h-2.5" /> DESTAQUE
                    </span>
                  </div>
                )}
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <h3 className="font-bold text-foreground">{p.nome}</h3>
                    {p.descricao && <p className="text-xs text-muted-foreground mt-1">{p.descricao}</p>}
                  </div>
                  <div className="flex gap-1">
                    <Button type="button" size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => setPlanoModal({ open: true, plano: p })} data-testid={`button-edit-plano-${p.id}`}>
                      <Pencil className="w-3.5 h-3.5" />
                    </Button>
                    <Button type="button" size="sm" variant="ghost" className="h-7 w-7 p-0 text-destructive" onClick={() => {
                      if (confirm(`Excluir plano "${p.nome}"?`)) deletePlanoMutation.mutate(p.id);
                    }} data-testid={`button-delete-plano-${p.id}`}>
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                </div>
                <p className="text-2xl font-bold text-primary mb-4">{fmt(p.preco)}<span className="text-xs font-normal text-muted-foreground">/mês</span></p>
                <div className="space-y-1.5 text-sm mb-3">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Usuários</span>
                    <span className="font-medium text-foreground">{p.limiteUsuarios}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Pedidos/mês</span>
                    <span className="font-medium text-foreground">{p.limitePedidos}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Motoristas</span>
                    <span className="font-medium text-foreground">{p.limiteMotoristas ?? 5}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">IA</span>
                    <span className={`font-medium capitalize text-xs px-1.5 py-0.5 rounded ${
                      p.nivelIA === 'ilimitada' ? 'bg-violet-100 text-violet-700' :
                      p.nivelIA === 'completa'  ? 'bg-blue-100 text-blue-700' :
                      p.nivelIA === 'basica'    ? 'bg-green-100 text-green-700' :
                      'bg-gray-100 text-gray-600'
                    }`}>{p.nivelIA ?? 'básica'}</span>
                  </div>
                </div>
                {/* Módulos habilitados */}
                {p.modulosHabilitados && p.modulosHabilitados.length > 0 && (
                  <div className="mb-3">
                    <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">Módulos ({p.modulosHabilitados.length})</p>
                    <div className="flex flex-wrap gap-1">
                      {(p.modulosHabilitados as string[]).slice(0, 6).map((m: string) => (
                        <span key={m} className="text-[10px] bg-muted text-muted-foreground px-1.5 py-0.5 rounded">{m}</span>
                      ))}
                      {p.modulosHabilitados.length > 6 && (
                        <span className="text-[10px] text-muted-foreground">+{p.modulosHabilitados.length - 6}</span>
                      )}
                    </div>
                  </div>
                )}
                <div className="pt-3 border-t border-border/40 flex items-center gap-2">
                  {p.gpsHabilitado && <span className="text-[10px] text-green-600 bg-green-50 px-1.5 py-0.5 rounded flex items-center gap-1"><MapPin className="w-2.5 h-2.5" />GPS</span>}
                  {p.ativo
                    ? <span className="text-xs text-green-600 font-medium flex items-center gap-1"><CheckCircle2 className="w-3 h-3" /> Ativo</span>
                    : <span className="text-xs text-muted-foreground flex items-center gap-1"><XCircle className="w-3 h-3" /> Inativo</span>
                  }
                </div>
              </div>
            ))}
            {planos.length === 0 && (
              <div className="col-span-3 text-center text-muted-foreground text-sm py-12 bg-card rounded-2xl border border-border/50">
                <Package className="w-10 h-10 mx-auto mb-3 opacity-40" />
                <p>Nenhum plano cadastrado ainda.</p>
                <Button type="button" size="sm" className="mt-3" onClick={() => setPlanoModal({ open: true })}>Criar Primeiro Plano</Button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Assinaturas ──────────────────────────────────────────────────────── */}
      {tab === 'assinaturas' && (
        <div className="space-y-4">
          <div className="flex justify-end">
            <Button type="button" onClick={() => setAssinaturaModal({ open: true })} data-testid="button-new-assinatura">
              <Plus className="w-4 h-4 mr-2" />
              Nova Assinatura
            </Button>
          </div>
          <div className="bg-card rounded-2xl border border-border/50">
            <div className="p-5 border-b border-border/50 flex items-center gap-3">
              <CreditCard className="w-5 h-5 text-primary" />
              <h2 className="font-bold text-foreground">Assinaturas</h2>
              <Badge variant="outline" className="ml-auto">{assinaturas.length} registro{assinaturas.length !== 1 ? 's' : ''}</Badge>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/30">
                  <tr>
                    <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground">Empresa</th>
                    <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground">Plano</th>
                    <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground">Status</th>
                    <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground">Valor</th>
                    <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground">Vencimento</th>
                    <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground">Gateway</th>
                    <th className="px-4 py-2.5 text-right text-xs font-medium text-muted-foreground">Ações</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/40">
                  {assinaturas.map(a => (
                    <tr key={a.id} className="hover:bg-muted/20" data-testid={`row-assinatura-${a.id}`}>
                      <td className="px-4 py-3 font-medium text-foreground">{companyMap[a.companyId] || `#${a.companyId}`}</td>
                      <td className="px-4 py-3 text-muted-foreground">{a.planoId ? (planoMap[a.planoId] || `#${a.planoId}`) : '—'}</td>
                      <td className="px-4 py-3"><StatusBadge status={a.status} /></td>
                      <td className="px-4 py-3 text-foreground">{fmt(a.valor)}</td>
                      <td className="px-4 py-3 text-muted-foreground">{fmtDate(a.dataExpiracao)}</td>
                      <td className="px-4 py-3 text-muted-foreground">{a.gatewayPagamento || '—'}</td>
                      <td className="px-4 py-3 text-right">
                        <Button type="button" size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => setAssinaturaModal({ open: true, assinatura: a })} data-testid={`button-edit-assinatura-${a.id}`}>
                          <Pencil className="w-3.5 h-3.5" />
                        </Button>
                      </td>
                    </tr>
                  ))}
                  {assinaturas.length === 0 && (
                    <tr>
                      <td colSpan={7} className="px-4 py-10 text-center text-muted-foreground text-sm">Nenhuma assinatura cadastrada</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ── Faturamento ──────────────────────────────────────────────────────── */}
      {tab === 'faturamento' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex gap-3">
              {Object.entries(BILLING_STATUS).map(([k, v]) => {
                const count = billingEvents.filter(b => b.status === k).length;
                if (!count) return null;
                return (
                  <div key={k} className={`text-center px-3 py-1.5 rounded-lg text-xs font-medium ${v.color}`}>
                    {count} {v.label}
                  </div>
                );
              })}
            </div>
            <Button type="button" onClick={() => setBillingModal(true)} data-testid="button-new-billing">
              <Plus className="w-4 h-4 mr-2" />
              Registrar Evento
            </Button>
          </div>
          <div className="bg-card rounded-2xl border border-border/50">
            <div className="p-5 border-b border-border/50 flex items-center gap-3">
              <DollarSign className="w-5 h-5 text-primary" />
              <h2 className="font-bold text-foreground">Eventos de Cobrança</h2>
              <Badge variant="outline" className="ml-auto">{billingEvents.length} evento{billingEvents.length !== 1 ? 's' : ''}</Badge>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/30">
                  <tr>
                    <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground">Data</th>
                    <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground">Empresa</th>
                    <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground">Tipo</th>
                    <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground">Descrição</th>
                    <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground">Valor</th>
                    <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground">Status</th>
                    <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground">Gateway</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/40">
                  {billingEvents.map(b => (
                    <tr key={b.id} className="hover:bg-muted/20" data-testid={`row-billing-${b.id}`}>
                      <td className="px-4 py-3 text-muted-foreground">{fmtDate(b.createdAt)}</td>
                      <td className="px-4 py-3 text-foreground">{b.companyId ? (companyMap[b.companyId] || `#${b.companyId}`) : '—'}</td>
                      <td className="px-4 py-3">
                        <span className="capitalize text-foreground">{b.tipo}</span>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground max-w-[200px] truncate">{b.descricao || '—'}</td>
                      <td className="px-4 py-3 font-medium text-foreground">{fmt(b.valor)}</td>
                      <td className="px-4 py-3">
                        <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${BILLING_STATUS[b.status]?.color || 'bg-gray-100 text-gray-700'}`}>
                          {BILLING_STATUS[b.status]?.label || b.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">{b.gateway || '—'}</td>
                    </tr>
                  ))}
                  {billingEvents.length === 0 && (
                    <tr>
                      <td colSpan={7} className="px-4 py-10 text-center text-muted-foreground text-sm">Nenhum evento de cobrança registrado</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ── Usuários ─────────────────────────────────────────────────────────── */}
      {tab === 'usuarios' && (
        <div className="bg-card rounded-2xl border border-border/50">
          <div className="p-5 border-b border-border/50 flex items-center gap-3">
            <Users className="w-5 h-5 text-primary" />
            <h2 className="font-bold text-foreground">Gestão de Usuários</h2>
            <div className="ml-auto">
              <Input
                placeholder="Buscar usuário..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="w-56 h-8 text-sm"
                data-testid="input-master-user-search"
              />
            </div>
          </div>
          {loadingUsers ? (
            <div className="p-8 text-center text-muted-foreground">Carregando usuários...</div>
          ) : (
            <div className="divide-y divide-border/50">
              {filteredUsers.map(u => (
                <div key={u.id} className="p-4 flex items-center gap-4 flex-wrap" data-testid={`row-user-${u.id}`}>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-semibold text-foreground text-sm">{u.name}</p>
                      <Badge variant="outline" className={`text-[10px] ${u.role === 'MASTER' ? 'bg-purple-50 text-purple-700 border-purple-200' : ''}`} data-testid={`badge-role-${u.id}`}>
                        {ROLE_LABELS[u.role] || u.role}
                      </Badge>
                      {u.isLocked && <Badge variant="destructive" className="text-[10px]">Bloqueado</Badge>}
                      {!u.active && <Badge variant="secondary" className="text-[10px]">Inativo</Badge>}
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">{u.email}</p>
                  </div>
                  <div className="flex items-center gap-2 flex-wrap">
                    {!(u.role === 'MASTER' && u.id !== user.id) && (
                      <Select value={u.role} onValueChange={role => updateUserMutation.mutate({ id: u.id, updates: { role } })}>
                        <SelectTrigger className="h-8 text-xs w-44" data-testid={`select-role-${u.id}`}><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {ROLES.map(r => <SelectItem key={r} value={r} data-testid={`option-role-${r}-${u.id}`}>{ROLE_LABELS[r]}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    )}
                    <Button type="button" size="sm" variant={u.active ? 'outline' : 'secondary'} className="h-8 text-xs"
                      onClick={() => updateUserMutation.mutate({ id: u.id, updates: { active: !u.active } })}
                      disabled={u.id === user.id} data-testid={`button-toggle-active-${u.id}`}>
                      {u.active ? 'Desativar' : 'Ativar'}
                    </Button>
                    {u.isLocked && (
                      <Button type="button" size="sm" variant="outline" className="h-8 text-xs" onClick={() => unlockMutation.mutate(u.id)} data-testid={`button-unlock-${u.id}`}>
                        <Unlock className="w-3 h-3 mr-1" /> Desbloquear
                      </Button>
                    )}
                    {resetPasswordId === u.id ? (
                      <div className="flex items-center gap-1">
                        <div className="relative">
                          <Input type={showPassword ? 'text' : 'password'} placeholder="Nova senha" value={newPassword}
                            onChange={e => setNewPassword(e.target.value)} className="h-8 text-xs w-32 pr-7" data-testid={`input-new-password-${u.id}`} />
                          <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground">
                            {showPassword ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                          </button>
                        </div>
                        <Button type="button" size="sm" className="h-8 text-xs"
                          onClick={() => resetPasswordMutation.mutate({ userId: u.id, newPassword })}
                          disabled={!newPassword || resetPasswordMutation.isPending} data-testid={`button-confirm-reset-${u.id}`}>
                          Confirmar
                        </Button>
                        <Button type="button" size="sm" variant="ghost" className="h-8 text-xs"
                          onClick={() => { setResetPasswordId(null); setNewPassword(''); }} data-testid={`button-cancel-reset-${u.id}`}>
                          ✕
                        </Button>
                      </div>
                    ) : (
                      <Button type="button" size="sm" variant="outline" className="h-8 text-xs"
                        onClick={() => { setResetPasswordId(u.id); setNewPassword(''); }} data-testid={`button-reset-password-${u.id}`}>
                        <KeyRound className="w-3 h-3 mr-1" /> Resetar Senha
                      </Button>
                    )}
                  </div>
                </div>
              ))}
              {filteredUsers.length === 0 && (
                <div className="p-8 text-center text-muted-foreground text-sm">Nenhum usuário encontrado</div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── Logs ─────────────────────────────────────────────────────────────── */}
      {tab === 'logs' && (
        <div className="bg-card rounded-2xl border border-border/50">
          <div className="p-5 border-b border-border/50 flex items-center gap-3">
            <Activity className="w-5 h-5 text-purple-500" />
            <h2 className="font-bold text-foreground">Log de Ações Master</h2>
            <Badge variant="outline" className="ml-auto">{masterLogs.length} ação{masterLogs.length !== 1 ? 'ões' : ''}</Badge>
          </div>
          <div className="divide-y divide-border/50 max-h-[500px] overflow-y-auto">
            {masterLogs.slice(0, 100).map((log: any) => (
              <div key={log.id} className="px-5 py-3 flex items-start gap-3">
                <RotateCcw className="w-4 h-4 text-purple-400 shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-foreground">{log.description}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {log.userEmail} • {log.createdAt ? new Date(log.createdAt).toLocaleString('pt-BR') : ''}
                  </p>
                </div>
              </div>
            ))}
            {masterLogs.length === 0 && (
              <div className="p-8 text-center text-muted-foreground text-sm">Nenhuma ação master registrada ainda</div>
            )}
          </div>
        </div>
      )}

      {/* Modals */}
      <PlanoModal
        open={planoModal.open}
        onClose={() => setPlanoModal({ open: false })}
        plano={planoModal.plano}
      />
      <AssinaturaModal
        open={assinaturaModal.open}
        onClose={() => setAssinaturaModal({ open: false })}
        assinatura={assinaturaModal.assinatura}
        planos={planos}
        companies={companies}
      />
      <BillingEventModal
        open={billingModal}
        onClose={() => setBillingModal(false)}
        companies={companies}
        assinaturas={assinaturas}
      />
    </div>
  );
}
