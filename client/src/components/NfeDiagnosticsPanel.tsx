import { useState, useEffect } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { queryClient, apiRequest } from '@/lib/queryClient';
import { fetchWithAuth } from '@/lib/fetchWithAuth';
import { useToast } from '@/hooks/use-toast';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  AlertTriangle, CheckCircle2, XCircle, ArrowRight, RefreshCw,
  ShieldCheck, Lightbulb, BookOpen, TrendingUp, Wrench, Info,
  Building2, User, FileText, MapPin
} from 'lucide-react';
import { useLocation } from 'wouter';
import { useCanEmitNfe } from '@/hooks/use-can-emit-nfe';
import { useForceReleaseNfe } from '@/hooks/use-force-release-nfe';

interface DiagnosticError {
  campo: string;
  mensagem: string;
  prioridade: 'CRITICA' | 'ALTA' | 'MEDIA';
  telaCorrecao: string;
  labelBotao: string;
}

interface FixSuggestion {
  campoAfetado: string;
  titulo: string;
  descricao: string;
  passos: string[];
  telaCorrecao: string;
  labelBotao: string;
  prioridade: 'CRITICA' | 'ALTA' | 'MEDIA';
}

interface DiagnosticResult {
  orderId: number;
  orderCode: string;
  bloqueado: boolean;
  erros: DiagnosticError[];
  avisos: DiagnosticError[];
  sugestoes: FixSuggestion[];
  resumo: { total: number; criticos: number; altos: number; medios: number };
}

interface TrainingPattern {
  campoAfetado: string;
  occurrences: number;
  resolved: number;
  taxaResolucao: number;
  solucao: string;
  telaCorrecao: string;
}

interface FiscalData {
  orderId: number;
  orderCode: string;
  emissora: Record<string, string>;
  destinatario: Record<string, string>;
  checkEmissora: { campo: string; ok: boolean; label: string }[];
  checkDestinatario: { campo: string; ok: boolean; label: string }[];
  completudeEmissora: number;
  completudeDestinatario: number;
}

const PRIORIDADE_CONFIG = {
  CRITICA: { label: 'Crítico', color: 'bg-red-100 text-red-800 border-red-200', icon: XCircle, rowColor: 'border-l-red-500' },
  ALTA:    { label: 'Alto',    color: 'bg-orange-100 text-orange-800 border-orange-200', icon: AlertTriangle, rowColor: 'border-l-orange-400' },
  MEDIA:   { label: 'Médio',  color: 'bg-yellow-100 text-yellow-800 border-yellow-200', icon: Info, rowColor: 'border-l-yellow-400' },
};

const REGIME_LABEL: Record<string, string> = {
  simples_nacional: 'Simples Nacional',
  lucro_presumido: 'Lucro Presumido',
  lucro_real: 'Lucro Real',
  mei: 'MEI',
};

function FiscalDataRow({ label, value, ok }: { label: string; value: string; ok?: boolean }) {
  return (
    <div className="flex items-start gap-2 py-1.5 border-b border-border/20 last:border-0">
      <span className="text-[10px] text-muted-foreground w-24 shrink-0 pt-0.5">{label}</span>
      <span className={`text-xs font-medium flex-1 truncate ${value === '—' ? 'text-muted-foreground italic' : 'text-foreground'}`}>{value}</span>
      {ok !== undefined && (
        ok
          ? <CheckCircle2 className="w-3.5 h-3.5 text-green-500 shrink-0 mt-0.5" />
          : <XCircle className="w-3.5 h-3.5 text-red-400 shrink-0 mt-0.5" />
      )}
    </div>
  );
}

function CompletenessBar({ value, label }: { value: number; label: string }) {
  const color = value >= 90 ? 'bg-green-500' : value >= 60 ? 'bg-yellow-500' : 'bg-red-500';
  return (
    <div className="flex items-center gap-2 mb-2">
      <span className="text-[10px] text-muted-foreground w-20 shrink-0">{label}</span>
      <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
        <div className={`h-full ${color} rounded-full transition-all`} style={{ width: `${value}%` }} />
      </div>
      <span className={`text-[10px] font-semibold w-8 text-right ${value >= 90 ? 'text-green-600' : value >= 60 ? 'text-yellow-600' : 'text-red-500'}`}>{value}%</span>
    </div>
  );
}

export default function NfeDiagnosticsPanel({ orderId, onEmitirClick, className = '' }: {
  orderId: number | null;
  onEmitirClick?: () => void;
  className?: string;
}) {
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const [activeTab, setActiveTab] = useState<'diagnostico' | 'dados_fiscais' | 'sugestoes' | 'treinamento'>('diagnostico');
  const [expandedSuggestion, setExpandedSuggestion] = useState<string | null>(null);

  const { data: diagnostic, isLoading, refetch, isFetching } = useQuery<DiagnosticResult>({
    queryKey: ['/api/nfe/diagnostics', orderId],
    queryFn: () => fetchWithAuth(`/api/nfe/diagnostics/${orderId}`).then(r => r.json()),
    enabled: !!orderId,
  });

  const { data: fiscalData, isLoading: fiscalLoading } = useQuery<FiscalData>({
    queryKey: ['/api/nfe/fiscal-data', orderId],
    queryFn: () => fetchWithAuth(`/api/nfe/fiscal-data/${orderId}`).then(r => r.json()),
    enabled: !!orderId,
  });

  const { data: patterns = [] } = useQuery<TrainingPattern[]>({
    queryKey: ['/api/nfe/diagnostics/training/patterns'],
  });

  const { allowed: canEmit, reason: blockReason, isLoading: checkingEmit, justUnlocked } = useCanEmitNfe(orderId);
  const { canForceRelease, forceRelease, isPending: isReleasing } = useForceReleaseNfe(orderId);
  const emitBlocked = canEmit === false;
  const [isShaking, setIsShaking] = useState(false);

  const resolveMutation = useMutation({
    mutationFn: (id: number) => apiRequest('PATCH', `/api/nfe/diagnostics/training/${id}/resolve`, {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/nfe/diagnostics/training/patterns'] });
      toast({ title: 'Erro marcado como resolvido' });
    },
  });

  useEffect(() => {
    if (!diagnostic || !orderId || !diagnostic.erros.length) return;
    fetchWithAuth('/api/nfe/diagnostics/log-errors', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        orderId,
        errors: diagnostic.erros.map(e => ({ campo: e.campo, mensagem: e.mensagem, codigo: '422' })),
      }),
    }).catch(() => {});
  }, [diagnostic?.orderId]);

  if (!orderId) {
    return (
      <div className={`bg-card rounded-2xl border border-border/50 p-6 ${className}`}>
        <div className="flex items-center gap-3 mb-4">
          <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center">
            <ShieldCheck className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h2 className="font-bold text-foreground">Diagnóstico Fiscal</h2>
            <p className="text-xs text-muted-foreground">Selecione um pedido para analisar</p>
          </div>
        </div>
        <div className="flex items-center justify-center h-24 text-muted-foreground text-sm">
          Selecione um pedido ao lado para iniciar o diagnóstico
        </div>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className={`bg-card rounded-2xl border border-border/50 p-6 ${className}`}>
        <div className="flex items-center gap-3 animate-pulse">
          <div className="w-9 h-9 rounded-xl bg-muted" />
          <div className="space-y-1">
            <div className="h-4 bg-muted rounded w-32" />
            <div className="h-3 bg-muted rounded w-20" />
          </div>
        </div>
        <div className="mt-4 space-y-2">
          {[1, 2, 3].map(i => <div key={i} className="h-12 bg-muted/50 rounded-xl animate-pulse" />)}
        </div>
      </div>
    );
  }

  if (!diagnostic) return null;

  const { erros, avisos, sugestoes, resumo, bloqueado } = diagnostic;
  const totalProblems = resumo.total;
  const allClear = totalProblems === 0;

  const TABS = [
    { id: 'diagnostico', label: 'Diagnóstico', icon: ShieldCheck, badge: totalProblems || undefined },
    { id: 'dados_fiscais', label: 'Dados Fiscais', icon: FileText },
    { id: 'sugestoes', label: 'Correções', icon: Lightbulb, badge: sugestoes.length || undefined },
    { id: 'treinamento', label: 'IA', icon: TrendingUp },
  ] as const;

  return (
    <div className={`bg-card rounded-2xl border border-border/50 overflow-hidden ${className}`}>
      {/* Header */}
      <div className={`p-4 border-b border-border/50 ${allClear ? 'bg-green-50/50' : bloqueado ? 'bg-red-50/50' : 'bg-yellow-50/50'}`}>
        <div className="flex items-center gap-3">
          <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${allClear ? 'bg-green-100' : bloqueado ? 'bg-red-100' : 'bg-yellow-100'}`}>
            {allClear ? <CheckCircle2 className="w-5 h-5 text-green-600" /> : <AlertTriangle className={`w-5 h-5 ${bloqueado ? 'text-red-600' : 'text-yellow-600'}`} />}
          </div>
          <div className="flex-1">
            <h2 className="font-bold text-foreground text-sm">
              Diagnóstico Fiscal — {diagnostic.orderCode}
            </h2>
            <p className="text-xs text-muted-foreground">
              {allClear ? 'Todos os dados estão OK — pronto para emitir!' : `${resumo.criticos} crítico(s), ${resumo.altos} alto(s), ${resumo.medios} aviso(s)`}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button type="button" variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => refetch()} disabled={isFetching} data-testid="button-refresh-diagnostic">
              <RefreshCw className={`w-3.5 h-3.5 ${isFetching ? 'animate-spin' : ''}`} />
            </Button>
            {allClear && onEmitirClick && (
              <Button
                type="button"
                size="sm"
                id={`emit-btn-${orderId}`}
                onClick={() => {
                  if (isShaking) return;
                  if (emitBlocked) {
                    setIsShaking(true);
                    setTimeout(() => setIsShaking(false), 400);
                    toast({ title: 'Faturamento bloqueado', description: blockReason, variant: 'destructive' });
                    return;
                  }
                  onEmitirClick();
                }}
                disabled={checkingEmit}
                title={emitBlocked ? blockReason : 'Emitir NF-e'}
                className={`h-8 text-xs ${justUnlocked ? 'unlock-highlight' : ''} ${isShaking ? 'shake-horizontal' : ''} ${emitBlocked ? 'opacity-70 cursor-not-allowed' : ''}`}
                data-testid="button-emitir-ready"
              >
                <CheckCircle2 className="w-3.5 h-3.5 mr-1" />
                Emitir NF-e
              </Button>
            )}
          </div>
        </div>

        <div className="flex gap-2 mt-3 flex-wrap">
          {emitBlocked && (
            <span
              data-testid="badge-faturamento-blocked"
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-red-100 text-red-800 border border-red-200"
            >
              <XCircle className="w-3 h-3" />
              Faturamento bloqueado: {blockReason}
              {canForceRelease && (
                <button
                  type="button"
                  onClick={forceRelease}
                  disabled={isReleasing}
                  data-testid="button-force-release-diag"
                  className="ml-1 text-[10px] text-blue-700 underline hover:text-blue-800 disabled:opacity-50"
                >
                  {isReleasing ? "Liberando..." : "Liberar agora"}
                </button>
              )}
            </span>
          )}
          {!emitBlocked && justUnlocked && (
            <span
              data-testid="badge-faturamento-unlocked"
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-green-100 text-green-800 border border-green-200"
            >
              <CheckCircle2 className="w-3 h-3" />
              Liberado para emissão
            </span>
          )}
          {resumo.criticos > 0 && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-red-100 text-red-800 border border-red-200">
              <XCircle className="w-3 h-3" />{resumo.criticos} Crítico(s)
            </span>
          )}
          {resumo.altos > 0 && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-orange-100 text-orange-800 border border-orange-200">
              <AlertTriangle className="w-3 h-3" />{resumo.altos} Alto(s)
            </span>
          )}
          {resumo.medios > 0 && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-yellow-100 text-yellow-800 border border-yellow-200">
              <Info className="w-3 h-3" />{resumo.medios} Aviso(s)
            </span>
          )}
          {allClear && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-green-100 text-green-800 border border-green-200">
              <CheckCircle2 className="w-3 h-3" />Sem problemas
            </span>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-border/40 bg-muted/20">
        {TABS.map(t => {
          const Icon = t.icon;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setActiveTab(t.id)}
              data-testid={`tab-diagnostic-${t.id}`}
              className={`flex-1 flex items-center justify-center gap-1 py-2.5 text-[11px] font-medium transition-colors ${activeTab === t.id ? 'bg-background text-foreground border-b-2 border-primary' : 'text-muted-foreground hover:text-foreground'}`}
            >
              <Icon className="w-3 h-3" />
              {t.label}
              {(t as any).badge && <span className="w-4 h-4 rounded-full bg-destructive text-destructive-foreground text-[9px] flex items-center justify-center">{(t as any).badge}</span>}
            </button>
          );
        })}
      </div>

      {/* Tab content */}
      <div className="p-4 space-y-3 max-h-[420px] overflow-y-auto">

        {/* ── Diagnóstico ─────────────────────────────────────────────────── */}
        {activeTab === 'diagnostico' && (
          <>
            {allClear ? (
              <div className="flex flex-col items-center justify-center py-8 text-center">
                <CheckCircle2 className="w-12 h-12 text-green-500 mb-3" />
                <p className="font-semibold text-foreground">Dados fiscais completos!</p>
                <p className="text-xs text-muted-foreground mt-1">Todos os campos obrigatórios estão preenchidos.</p>
              </div>
            ) : (
              <>
                {erros.map((e, i) => {
                  const cfg = PRIORIDADE_CONFIG[e.prioridade];
                  const Icon = cfg.icon;
                  return (
                    <div key={i} className={`flex items-start gap-3 p-3 rounded-xl border-l-4 bg-muted/20 border ${cfg.rowColor}`} data-testid={`diagnostic-error-${i}`}>
                      <Icon className={`w-4 h-4 mt-0.5 shrink-0 ${e.prioridade === 'CRITICA' ? 'text-red-600' : e.prioridade === 'ALTA' ? 'text-orange-500' : 'text-yellow-600'}`} />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-xs font-medium text-foreground">{e.mensagem}</span>
                          <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${cfg.color}`}>{cfg.label}</span>
                        </div>
                        <p className="text-[10px] text-muted-foreground mt-0.5 font-mono">{e.campo}</p>
                      </div>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="h-7 text-[10px] shrink-0"
                        onClick={() => navigate(e.telaCorrecao)}
                        data-testid={`button-fix-${i}`}
                      >
                        <Wrench className="w-3 h-3 mr-1" />
                        Corrigir
                      </Button>
                    </div>
                  );
                })}
                {avisos.map((a, i) => (
                  <div key={`aviso-${i}`} className="flex items-start gap-3 p-3 rounded-xl border-l-4 bg-yellow-50/30 border border-l-yellow-400">
                    <Info className="w-4 h-4 mt-0.5 shrink-0 text-yellow-600" />
                    <div className="flex-1">
                      <p className="text-xs text-foreground">{a.mensagem}</p>
                      <p className="text-[10px] text-muted-foreground font-mono mt-0.5">{a.campo}</p>
                    </div>
                    <Button type="button" size="sm" variant="ghost" className="h-7 text-[10px]" onClick={() => navigate(a.telaCorrecao)}>
                      Ver
                    </Button>
                  </div>
                ))}
              </>
            )}
          </>
        )}

        {/* ── Dados Fiscais ──────────────────────────────────────────────────── */}
        {activeTab === 'dados_fiscais' && (
          <>
            {fiscalLoading ? (
              <div className="space-y-2">
                {[1, 2, 3].map(i => <div key={i} className="h-8 bg-muted/50 rounded animate-pulse" />)}
              </div>
            ) : fiscalData ? (
              <div className="space-y-4">
                {/* Completude visual */}
                <div className="p-3 rounded-xl bg-muted/20 border border-border/30">
                  <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">Completude dos Dados</p>
                  <CompletenessBar value={fiscalData.completudeEmissora} label="Emissora" />
                  <CompletenessBar value={fiscalData.completudeDestinatario} label="Destinatário" />
                </div>

                {/* Emissora */}
                <div className="rounded-xl border border-border/40 overflow-hidden">
                  <div className="flex items-center gap-2 px-3 py-2 bg-blue-50/50 dark:bg-blue-900/10 border-b border-border/30">
                    <Building2 className="w-3.5 h-3.5 text-blue-600" />
                    <p className="text-xs font-semibold text-foreground">Emissora (Sua Empresa)</p>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-5 text-[10px] ml-auto px-2"
                      onClick={() => navigate('/admin/fiscal-config')}
                    >
                      <Wrench className="w-3 h-3 mr-1" />Editar
                    </Button>
                  </div>
                  <div className="px-3 py-2">
                    <FiscalDataRow label="Nome" value={fiscalData.emissora.nome} />
                    <FiscalDataRow label="CNPJ" value={fiscalData.emissora.cnpj} ok={fiscalData.checkEmissora.find(c => c.campo === 'CNPJ')?.ok} />
                    <FiscalDataRow label="IE" value={fiscalData.emissora.ie} ok={fiscalData.checkEmissora.find(c => c.campo === 'IE')?.ok} />
                    <FiscalDataRow label="UF / Município" value={`${fiscalData.emissora.uf} — ${fiscalData.emissora.municipio}`} />
                    <FiscalDataRow label="CEP" value={fiscalData.emissora.cep} ok={fiscalData.checkEmissora.find(c => c.campo === 'CEP')?.ok} />
                    <FiscalDataRow label="Endereço" value={`${fiscalData.emissora.logradouro}, ${fiscalData.emissora.numero}`} />
                    <FiscalDataRow label="Regime" value={REGIME_LABEL[fiscalData.emissora.regimeTributario] || fiscalData.emissora.regimeTributario} />
                    <FiscalDataRow label="CFOP Padrão" value={fiscalData.emissora.cfopPadrao} />
                    <FiscalDataRow label="Certificado" value={fiscalData.checkEmissora.find(c => c.campo === 'Certificado')?.ok ? 'Configurado ✓' : 'Não configurado'} ok={fiscalData.checkEmissora.find(c => c.campo === 'Certificado')?.ok} />
                    <FiscalDataRow label="Ambiente" value={fiscalData.emissora.ambiente === 'producao' ? 'Produção' : 'Homologação (Teste)'} />
                  </div>
                </div>

                {/* Destinatário */}
                <div className="rounded-xl border border-border/40 overflow-hidden">
                  <div className="flex items-center gap-2 px-3 py-2 bg-emerald-50/50 dark:bg-emerald-900/10 border-b border-border/30">
                    <User className="w-3.5 h-3.5 text-emerald-600" />
                    <p className="text-xs font-semibold text-foreground">Destinatário (Cliente)</p>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-5 text-[10px] ml-auto px-2"
                      onClick={() => navigate('/admin/companies')}
                    >
                      <Wrench className="w-3 h-3 mr-1" />Editar
                    </Button>
                  </div>
                  <div className="px-3 py-2">
                    <FiscalDataRow label="Nome" value={fiscalData.destinatario.nome} ok={fiscalData.checkDestinatario.find(c => c.campo === 'Nome')?.ok} />
                    <FiscalDataRow label="CNPJ/CPF" value={fiscalData.destinatario.cnpj} ok={fiscalData.checkDestinatario.find(c => c.campo === 'CNPJ/CPF')?.ok} />
                    <FiscalDataRow label="IE" value={fiscalData.destinatario.ie} />
                    <FiscalDataRow label="UF / Município" value={`${fiscalData.destinatario.uf} — ${fiscalData.destinatario.municipio}`} ok={fiscalData.checkDestinatario.find(c => c.campo === 'UF')?.ok} />
                    <FiscalDataRow label="CEP" value={fiscalData.destinatario.cep} ok={fiscalData.checkDestinatario.find(c => c.campo === 'CEP')?.ok} />
                    <FiscalDataRow label="Endereço" value={`${fiscalData.destinatario.logradouro}, ${fiscalData.destinatario.numero}`} ok={fiscalData.checkDestinatario.find(c => c.campo === 'Endereço')?.ok} />
                    <FiscalDataRow label="Bairro" value={fiscalData.destinatario.bairro} />
                    <FiscalDataRow label="IBGE" value={fiscalData.destinatario.ibge} />
                    {fiscalData.destinatario.cfopOverride && (
                      <FiscalDataRow label="CFOP Override" value={fiscalData.destinatario.cfopOverride} />
                    )}
                  </div>
                </div>
              </div>
            ) : (
              <div className="text-center py-8 text-sm text-muted-foreground">Erro ao carregar dados fiscais.</div>
            )}
          </>
        )}

        {/* ── Sugestões de Correção ────────────────────────────────────────── */}
        {activeTab === 'sugestoes' && (
          <>
            {sugestoes.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-8 text-center">
                <CheckCircle2 className="w-10 h-10 text-green-500 mb-3" />
                <p className="font-semibold text-foreground text-sm">Nenhuma correção necessária!</p>
              </div>
            ) : (
              sugestoes.map((s, i) => {
                const cfg = PRIORIDADE_CONFIG[s.prioridade];
                const isExpanded = expandedSuggestion === s.campoAfetado;
                return (
                  <div key={i} className={`rounded-xl border bg-muted/10 overflow-hidden`} data-testid={`suggestion-${i}`}>
                    <button
                      type="button"
                      className="w-full flex items-center gap-3 p-3 text-left"
                      onClick={() => setExpandedSuggestion(isExpanded ? null : s.campoAfetado)}
                    >
                      <Lightbulb className={`w-4 h-4 shrink-0 ${s.prioridade === 'CRITICA' ? 'text-red-500' : s.prioridade === 'ALTA' ? 'text-orange-500' : 'text-yellow-500'}`} />
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium text-foreground truncate">{s.titulo}</p>
                        <p className="text-[10px] text-muted-foreground font-mono">{s.campoAfetado}</p>
                      </div>
                      <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${cfg.color}`}>{cfg.label}</span>
                    </button>
                    {isExpanded && (
                      <div className="px-4 pb-4 border-t border-border/30">
                        <div className="mt-3 space-y-2">
                          {s.passos.map((passo, j) => (
                            <p key={j} className="text-xs text-foreground">{passo}</p>
                          ))}
                        </div>
                        <Button
                          type="button"
                          className="mt-3 h-8 text-xs"
                          onClick={() => navigate(s.telaCorrecao)}
                          data-testid={`button-suggestion-fix-${i}`}
                        >
                          <ArrowRight className="w-3.5 h-3.5 mr-1.5" />
                          {s.labelBotao}
                        </Button>
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </>
        )}

        {/* ── Treinamento IA ───────────────────────────────────────────────── */}
        {activeTab === 'treinamento' && (
          <>
            <div className="flex items-center gap-2 mb-1">
              <TrendingUp className="w-4 h-4 text-primary" />
              <p className="text-xs font-semibold text-foreground">Padrões Aprendidos</p>
              <span className="text-[10px] text-muted-foreground ml-auto">{patterns.length} campo(s) monitorado(s)</span>
            </div>
            {patterns.length === 0 ? (
              <div className="text-center py-8 text-sm text-muted-foreground">
                Nenhum padrão registrado ainda.<br />Os erros detectados serão aprendidos automaticamente.
              </div>
            ) : (
              <div className="space-y-2">
                {patterns.map((p, i) => (
                  <div key={i} className="flex items-center gap-3 p-3 rounded-xl bg-muted/30 border border-border/30" data-testid={`pattern-${i}`}>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium text-foreground font-mono truncate">{p.campoAfetado}</p>
                      <div className="flex items-center gap-2 mt-1">
                        <span className="text-[10px] text-muted-foreground">{p.occurrences}x detectado</span>
                        <span className="text-[10px] text-green-600">{p.taxaResolucao}% resolvido</span>
                      </div>
                      <div className="mt-1.5 h-1 bg-muted rounded-full overflow-hidden">
                        <div className="h-full bg-green-500 rounded-full" style={{ width: `${p.taxaResolucao}%` }} />
                      </div>
                    </div>
                    <Button type="button" size="sm" variant="ghost" className="h-7 text-[10px] shrink-0" onClick={() => navigate(p.telaCorrecao)}>
                      <ArrowRight className="w-3 h-3" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
