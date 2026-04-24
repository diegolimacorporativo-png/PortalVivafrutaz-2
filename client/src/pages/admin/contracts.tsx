import { useState } from "react";
import { ContextualTip } from "@/components/ContextualTip";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Layout } from "@/components/Layout";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import {
  Building2, Calendar, AlertTriangle, CheckCircle, Clock, TrendingUp,
  FileText, Send, History, ChevronDown, ChevronRight, Edit3,
  DollarSign, BarChart3, RefreshCw, Plus, Eye, AlertCircle, X, Loader2,
  ArrowUpRight, Printer
} from "lucide-react";

// ─── Types ───────────────────────────────────────────────────────────────
interface Company {
  id: number;
  companyName: string;
  email: string;
  notificationEmail?: string;
  clientType?: string;
  contractModel?: string;
  contractStartDate?: string;
  contractEndDate?: string;
  contractVigencia?: string;
  minWeeklyBilling?: string;
  active: boolean;
  cnpj?: string;
}

interface ContractAdjustment {
  id: number;
  companyId: number;
  adjustmentPercentage: string;
  reason: string;
  appliedAt: string;
  newWeeklyValue?: string;
  responsibleEmail?: string;
  documentContent?: any;
  emailSentAt?: string;
  createdAt: string;
}

interface ContractAlert {
  type: '12_months' | 'expiring';
  companyId: number;
  companyName: string;
  contractStartDate?: string;
  contractEndDate?: string;
  monthsActive?: number;
  monthsSinceLastAdjustment?: number;
  daysLeft?: number;
}

interface ContractScope {
  id: number;
  companyId: number;
  dayOfWeek: string;
  productId: number;
  quantity: number;
  unitPrice?: string;
  averageCost?: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────
function formatDate(d?: string | null) {
  if (!d) return "—";
  return new Date(d + "T00:00:00").toLocaleDateString("pt-BR");
}

function daysUntil(dateStr: string) {
  const end = new Date(dateStr + "T00:00:00");
  const now = new Date();
  return Math.ceil((end.getTime() - now.getTime()) / 86400000);
}

function monthsSince(dateStr: string) {
  const start = new Date(dateStr + "T00:00:00");
  const now = new Date();
  return (now.getFullYear() - start.getFullYear()) * 12 + (now.getMonth() - start.getMonth());
}

function alertColor(type: string, days?: number) {
  if (type === '12_months') return 'bg-amber-50 border-amber-300 text-amber-800';
  if (!days) return 'bg-red-50 border-red-300 text-red-800';
  if (days <= 30) return 'bg-red-50 border-red-300 text-red-800';
  if (days <= 60) return 'bg-orange-50 border-orange-300 text-orange-800';
  return 'bg-yellow-50 border-yellow-300 text-yellow-800';
}

// ─── Alert Banner ─────────────────────────────────────────────────────────
function AlertBanner({ alert, onViewContract }: { alert: ContractAlert; onViewContract: (id: number) => void }) {
  const color = alertColor(alert.type, alert.daysLeft);
  return (
    <div className={`p-4 rounded-xl border-2 ${color} flex items-start gap-3`}>
      <AlertTriangle className="w-5 h-5 flex-shrink-0 mt-0.5" />
      <div className="flex-1 min-w-0">
        <p className="font-bold text-sm">{alert.companyName}</p>
        {alert.type === '12_months' && (
          <p className="text-xs mt-0.5">
            Contrato ativo há <strong>{alert.monthsActive} meses</strong>. 
            Sem reajuste há <strong>{alert.monthsSinceLastAdjustment} meses</strong> — avaliar reajuste por IPCA.
          </p>
        )}
        {alert.type === 'expiring' && (
          <p className="text-xs mt-0.5">
            Vence em <strong>{alert.daysLeft} dias</strong> ({formatDate(alert.contractEndDate)}) — renovar ou editar escopo.
          </p>
        )}
      </div>
      <button type="button" onClick={() => onViewContract(alert.companyId)}
        className="text-xs font-bold underline flex-shrink-0">Ver contrato</button>
    </div>
  );
}

// ─── Profitability Panel ──────────────────────────────────────────────────
function ProfitabilityPanel({ scopes, weeklyBilling }: { scopes: ContractScope[]; weeklyBilling?: string }) {
  const weeklyRevenue = scopes.reduce((sum, s) => sum + (parseFloat(s.unitPrice || '0') * s.quantity), 0);
  const weeklyCost = scopes.reduce((sum, s) => sum + (parseFloat(s.averageCost || '0') * s.quantity), 0);
  const billingValue = weeklyBilling ? parseFloat(weeklyBilling) : 0;
  const effectiveRevenue = weeklyRevenue || billingValue;
  const monthlyRevenue = effectiveRevenue * 4;
  const annualRevenue = monthlyRevenue * 12;
  const weeklyCostTotal = weeklyCost || 0;
  const monthlyEstimatedCost = weeklyCostTotal * 4;
  const margin = effectiveRevenue > 0 && weeklyCostTotal > 0
    ? ((effectiveRevenue - weeklyCostTotal) / effectiveRevenue * 100)
    : null;

  const fmt = (v: number) => `R$ ${v.toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '.')}`;
  const fmtPct = (v: number) => `${v.toFixed(1)}%`;

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
      {[
        { label: 'Semanal (escopo)', value: fmt(effectiveRevenue), icon: DollarSign, color: 'bg-green-50 text-green-700' },
        { label: 'Mensal estimado', value: fmt(monthlyRevenue), icon: BarChart3, color: 'bg-blue-50 text-blue-700' },
        { label: 'Anual estimado', value: fmt(annualRevenue), icon: TrendingUp, color: 'bg-purple-50 text-purple-700' },
        { label: 'Custo médio semanal', value: weeklyCostTotal > 0 ? fmt(weeklyCostTotal) : '—', icon: DollarSign, color: 'bg-orange-50 text-orange-700' },
        { label: 'Custo médio mensal', value: monthlyEstimatedCost > 0 ? fmt(monthlyEstimatedCost) : '—', icon: BarChart3, color: 'bg-orange-50 text-orange-700' },
        { label: 'Margem estimada', value: margin !== null ? fmtPct(margin) : '—', icon: ArrowUpRight, color: margin !== null && margin < 20 ? 'bg-red-50 text-red-700' : 'bg-green-50 text-green-700' },
      ].map(({ label, value, icon: Icon, color }) => (
        <div key={label} className={`p-3 rounded-xl ${color} flex items-start gap-2`}>
          <Icon className="w-4 h-4 mt-0.5 flex-shrink-0" />
          <div>
            <p className="text-xs font-semibold opacity-70">{label}</p>
            <p className="font-bold text-sm">{value}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Document Editor ──────────────────────────────────────────────────────
function DocumentEditor({ company, adjustment, onSave, onClose }: {
  company: Company;
  adjustment: ContractAdjustment;
  onSave: (doc: any) => void;
  onClose: () => void;
}) {
  const pct = parseFloat(adjustment.adjustmentPercentage);
  const [doc, setDoc] = useState<any>(adjustment.documentContent || {
    headerText: 'COMUNICADO DE REAJUSTE CONTRATUAL',
    bodyText: `Prezados,\n\nConforme previsto em contrato, informamos o reajuste anual baseado no índice IPCA.\n\nO percentual de reajuste aplicado é de ${pct}% ao período.\n\nO novo valor contratual entra em vigor a partir de ${formatDate(adjustment.appliedAt)}.\n\nEste ajuste visa manter o equilíbrio financeiro do contrato e a qualidade dos serviços prestados.\n\nAtenciosamente,\nEquipe VivaFrutaz`,
    footerText: 'VivaFrutaz — Soluções em Alimentação Corporativa',
    signatureName: '',
    signatureRole: '',
    signatureDate: new Date().toISOString().slice(0, 10),
    signatureImage: '',
  });

  const set = (k: string, v: string) => setDoc((p: any) => ({ ...p, [k]: v }));

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
      <div className="bg-background rounded-2xl shadow-2xl w-full max-w-3xl max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between p-5 border-b border-border">
          <h2 className="font-bold text-lg flex items-center gap-2"><FileText className="w-5 h-5 text-primary" /> Editor de Documento de Reajuste</h2>
          <button type="button" onClick={onClose} className="p-2 rounded-xl hover:bg-muted"><X className="w-5 h-5" /></button>
        </div>
        <div className="overflow-y-auto p-5 flex-1 space-y-4">
          {/* Header data (auto-filled) */}
          <div className="p-4 bg-muted/30 rounded-xl text-sm space-y-1">
            <p><strong>Empresa:</strong> {company.companyName}</p>
            {company.cnpj && <p><strong>CNPJ:</strong> {company.cnpj}</p>}
            <p><strong>Percentual de Reajuste:</strong> {pct}%</p>
            <p><strong>Data de Aplicação:</strong> {formatDate(adjustment.appliedAt)}</p>
            {adjustment.newWeeklyValue && <p><strong>Novo Valor Semanal:</strong> R$ {parseFloat(adjustment.newWeeklyValue).toFixed(2).replace('.', ',')}</p>}
          </div>

          <div>
            <label className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-1.5 block">Título do Documento</label>
            <input value={doc.headerText} onChange={e => set('headerText', e.target.value)}
              data-testid="input-doc-header"
              className="w-full px-3 py-2 rounded-xl border border-border bg-background text-sm font-bold" />
          </div>

          <div>
            <label className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-1.5 block">Corpo do Documento</label>
            <textarea value={doc.bodyText} onChange={e => set('bodyText', e.target.value)}
              data-testid="textarea-doc-body"
              rows={10}
              className="w-full px-3 py-2 rounded-xl border border-border bg-background text-sm resize-y" />
          </div>

          <div>
            <label className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-1.5 block">Rodapé</label>
            <input value={doc.footerText} onChange={e => set('footerText', e.target.value)}
              data-testid="input-doc-footer"
              className="w-full px-3 py-2 rounded-xl border border-border bg-background text-sm" />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-1.5 block">Nome do Responsável</label>
              <input value={doc.signatureName} onChange={e => set('signatureName', e.target.value)}
                data-testid="input-sig-name"
                className="w-full px-3 py-2 rounded-xl border border-border bg-background text-sm" />
            </div>
            <div>
              <label className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-1.5 block">Cargo</label>
              <input value={doc.signatureRole} onChange={e => set('signatureRole', e.target.value)}
                data-testid="input-sig-role"
                className="w-full px-3 py-2 rounded-xl border border-border bg-background text-sm" />
            </div>
          </div>
          <div>
            <label className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-1.5 block">Data da Assinatura</label>
            <input type="date" value={doc.signatureDate} onChange={e => set('signatureDate', e.target.value)}
              data-testid="input-sig-date"
              className="w-full px-3 py-2 rounded-xl border border-border bg-background text-sm" />
          </div>
          <div>
            <label className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-1.5 block">URL da Assinatura (imagem)</label>
            <input value={doc.signatureImage} onChange={e => set('signatureImage', e.target.value)}
              data-testid="input-sig-image"
              placeholder="https://... ou cole base64"
              className="w-full px-3 py-2 rounded-xl border border-border bg-background text-sm" />
          </div>
        </div>
        <div className="p-5 border-t border-border flex gap-3 justify-end">
          <button type="button" onClick={onClose} className="px-4 py-2 rounded-xl border border-border text-sm font-bold hover:bg-muted">Cancelar</button>
          <button type="button" onClick={() => onSave(doc)} data-testid="button-save-doc"
            className="px-5 py-2 rounded-xl bg-primary text-primary-foreground text-sm font-bold hover:bg-primary/90">
            Salvar Documento
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── PDF Export ───────────────────────────────────────────────────────────
function exportDocumentPDF(company: Company, adjustment: ContractAdjustment, doc: any) {
  const html = `
    <html><head><meta charset="utf-8"><style>
      body { font-family: Arial, sans-serif; padding: 40px; color: #222; }
      h1 { text-align: center; font-size: 18px; margin-bottom: 24px; }
      .info { background: #f5f5f5; padding: 16px; border-radius: 8px; margin-bottom: 24px; }
      .info p { margin: 4px 0; font-size: 14px; }
      .body { white-space: pre-wrap; font-size: 14px; line-height: 1.7; margin-bottom: 40px; }
      .footer { text-align: center; font-size: 12px; color: #666; border-top: 1px solid #ccc; padding-top: 12px; }
      .sig { margin-top: 60px; display: flex; gap: 40px; }
      .sig-block { text-align: center; }
      .sig-line { border-top: 1px solid #222; padding-top: 8px; font-size: 13px; }
    </style></head><body>
    <h1>${doc?.headerText || 'COMUNICADO DE REAJUSTE CONTRATUAL'}</h1>
    <div class="info">
      <p><strong>Empresa:</strong> ${company.companyName}</p>
      ${company.cnpj ? `<p><strong>CNPJ:</strong> ${company.cnpj}</p>` : ''}
      <p><strong>Reajuste:</strong> ${parseFloat(adjustment.adjustmentPercentage)}%</p>
      <p><strong>Data de Aplicação:</strong> ${formatDate(adjustment.appliedAt)}</p>
      ${adjustment.newWeeklyValue ? `<p><strong>Novo Valor Semanal:</strong> R$ ${parseFloat(adjustment.newWeeklyValue).toFixed(2).replace('.', ',')}</p>` : ''}
    </div>
    <div class="body">${doc?.bodyText || ''}</div>
    ${doc?.signatureName ? `
    <div class="sig">
      <div class="sig-block">
        ${doc.signatureImage ? `<img src="${doc.signatureImage}" style="max-height:60px;margin-bottom:8px;" />` : '<div style="height:60px;"></div>'}
        <div class="sig-line">${doc.signatureName}<br/><small>${doc.signatureRole || ''}</small><br/><small>${formatDate(doc.signatureDate)}</small></div>
      </div>
    </div>` : ''}
    <div class="footer">${doc?.footerText || ''}</div>
    </body></html>`;
  const w = window.open('', '_blank');
  if (w) { w.document.write(html); w.document.close(); w.print(); }
}

// ─── Email Modal ──────────────────────────────────────────────────────────
function EmailModal({ company, adjustment, onSend, onClose, sending }: {
  company: Company;
  adjustment: ContractAdjustment;
  onSend: (subject: string, body: string) => void;
  onClose: () => void;
  sending: boolean;
}) {
  const [subject, setSubject] = useState('Atualização Contratual VivaFrutaz');
  const [body, setBody] = useState(`Olá,\n\nConforme previsto em contrato, estamos aplicando o reajuste anual baseado no índice IPCA.\n\nPercentual aplicado: ${parseFloat(adjustment.adjustmentPercentage)}%\nData de vigência: ${formatDate(adjustment.appliedAt)}\n\nSegue documento em anexo.\n\nAtenciosamente\nEquipe VivaFrutaz`);

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
      <div className="bg-background rounded-2xl shadow-2xl w-full max-w-lg">
        <div className="flex items-center justify-between p-5 border-b border-border">
          <h2 className="font-bold text-lg flex items-center gap-2"><Send className="w-5 h-5 text-primary" /> Enviar por E-mail</h2>
          <button type="button" onClick={onClose} className="p-2 rounded-xl hover:bg-muted"><X className="w-5 h-5" /></button>
        </div>
        <div className="p-5 space-y-4">
          <div className="p-3 bg-muted/30 rounded-xl text-sm">
            <p><strong>Para:</strong> {company.notificationEmail || company.email}</p>
          </div>
          <div>
            <label className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-1.5 block">Assunto</label>
            <input value={subject} onChange={e => setSubject(e.target.value)}
              data-testid="input-email-subject"
              className="w-full px-3 py-2 rounded-xl border border-border bg-background text-sm" />
          </div>
          <div>
            <label className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-1.5 block">Corpo do E-mail</label>
            <textarea value={body} onChange={e => setBody(e.target.value)}
              data-testid="textarea-email-body"
              rows={8}
              className="w-full px-3 py-2 rounded-xl border border-border bg-background text-sm resize-y" />
          </div>
        </div>
        <div className="p-5 border-t border-border flex gap-3 justify-end">
          <button type="button" onClick={onClose} className="px-4 py-2 rounded-xl border border-border text-sm font-bold hover:bg-muted">Cancelar</button>
          <button type="button" onClick={() => onSend(subject, body)} disabled={sending}
            data-testid="button-send-email"
            className="px-5 py-2 rounded-xl bg-primary text-primary-foreground text-sm font-bold hover:bg-primary/90 disabled:opacity-50 flex items-center gap-2">
            {sending ? <><Loader2 className="w-4 h-4 animate-spin" /> Enviando...</> : <><Send className="w-4 h-4" /> Enviar</>}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Contract Detail Panel ────────────────────────────────────────────────
function ContractDetail({ company, onBack }: { company: Company; onBack: () => void }) {
  const { toast } = useToast();
  const qc = useQueryClient();

  // Contract form state
  const [vigencia, setVigencia] = useState((company as any).contractVigencia || '');
  const [startDate, setStartDate] = useState((company as any).contractStartDate || '');
  const [endDate, setEndDate] = useState((company as any).contractEndDate || '');
  const [savingInfo, setSavingInfo] = useState(false);

  // Reajuste form
  const [showNewAdj, setShowNewAdj] = useState(false);
  const [adjPct, setAdjPct] = useState('');
  const [adjReason, setAdjReason] = useState('IPCA anual');
  const [adjDate, setAdjDate] = useState(new Date().toISOString().slice(0, 10));
  const [simulatedWeekly, setSimulatedWeekly] = useState<number | null>(null);

  // Document / email modals
  const [docAdj, setDocAdj] = useState<ContractAdjustment | null>(null);
  const [emailAdj, setEmailAdj] = useState<ContractAdjustment | null>(null);
  const [sendingEmail, setSendingEmail] = useState(false);

  const { data: scopes = [] } = useQuery<ContractScope[]>({
    queryKey: ['/api/companies', company.id, 'contract-scopes'],
  });
  const { data: adjustments = [], refetch: refetchAdj } = useQuery<ContractAdjustment[]>({
    queryKey: ['/api/companies', company.id, 'contract-adjustments'],
  });

  const weeklyRevenue = scopes.reduce((sum, s) => sum + (parseFloat(s.unitPrice || '0') * s.quantity), 0);
  const currentWeekly = weeklyRevenue || parseFloat(company.minWeeklyBilling || '0');

  // Simulate reajuste
  const simulateAdjustment = () => {
    const pct = parseFloat(adjPct);
    if (!isNaN(pct) && currentWeekly > 0) {
      setSimulatedWeekly(currentWeekly * (1 + pct / 100));
    }
  };

  const saveContractInfo = async () => {
    setSavingInfo(true);
    try {
      await apiRequest('PATCH', `/api/companies/${company.id}/contract-info`, { contractStartDate: startDate || null, contractEndDate: endDate || null, contractVigencia: vigencia || null });
      qc.invalidateQueries({ queryKey: ['/api/companies'] });
      toast({ title: 'Vigência contratual salva!' });
    } catch {
      toast({ title: 'Erro ao salvar', variant: 'destructive' });
    } finally { setSavingInfo(false); }
  };

  const createAdjustment = async () => {
    if (!adjPct || !adjReason || !adjDate) { toast({ title: 'Preencha todos os campos', variant: 'destructive' }); return; }
    try {
      await apiRequest('POST', `/api/companies/${company.id}/contract-adjustments`, {
        adjustmentPercentage: adjPct,
        reason: adjReason,
        appliedAt: adjDate,
        newWeeklyValue: simulatedWeekly ? simulatedWeekly.toFixed(2) : null,
      });
      refetchAdj();
      qc.invalidateQueries({ queryKey: ['/api/companies'] });
      setShowNewAdj(false);
      setAdjPct(''); setSimulatedWeekly(null);
      toast({ title: 'Reajuste registrado!', description: `${adjPct}% aplicado a partir de ${formatDate(adjDate)}` });
    } catch {
      toast({ title: 'Erro ao criar reajuste', variant: 'destructive' });
    }
  };

  const saveDocument = async (doc: any) => {
    if (!docAdj) return;
    try {
      await apiRequest('PATCH', `/api/companies/${company.id}/contract-adjustments/${docAdj.id}`, { documentContent: doc });
      refetchAdj();
      setDocAdj(null);
      toast({ title: 'Documento salvo!' });
    } catch {
      toast({ title: 'Erro ao salvar documento', variant: 'destructive' });
    }
  };

  const sendEmail = async (subject: string, body: string) => {
    if (!emailAdj) return;
    setSendingEmail(true);
    try {
      await apiRequest('POST', `/api/companies/${company.id}/contract-adjustments/${emailAdj.id}/send-email`, { emailSubject: subject, emailBody: body });
      refetchAdj();
      setEmailAdj(null);
      toast({ title: 'E-mail enviado com sucesso!' });
    } catch (e: any) {
      toast({ title: 'Erro ao enviar e-mail', description: e.message || 'Verifique configuração SMTP', variant: 'destructive' });
    } finally { setSendingEmail(false); }
  };

  // Alerts for this contract
  const now = new Date();
  const alerts: string[] = [];
  if (vigencia === 'prazo_indefinido' && startDate) {
    const months = monthsSince(startDate);
    if (months >= 12) {
      const lastAdj = adjustments[0];
      const lastAdjDate = lastAdj ? lastAdj.createdAt : startDate;
      const monthsSinceAdj = monthsSince(lastAdjDate.slice(0, 10));
      if (monthsSinceAdj >= 12) alerts.push(`Contrato completou ${months} meses. Sem reajuste há ${monthsSinceAdj} meses — avaliar IPCA.`);
    }
  }
  if (vigencia === 'prazo_determinado' && endDate) {
    const days = daysUntil(endDate);
    if (days <= 90 && days >= 0) alerts.push(`Contrato vence em ${days} dias (${formatDate(endDate)}).`);
    if (days < 0) alerts.push(`Contrato vencido em ${formatDate(endDate)}.`);
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <button type="button" onClick={onBack} className="p-2 rounded-xl hover:bg-muted" data-testid="button-back-contracts">
          <ChevronRight className="w-5 h-5 rotate-180" />
        </button>
        <div className="flex-1">
          <h1 className="text-2xl font-display font-extrabold text-foreground">{company.companyName}</h1>
          <p className="text-sm text-muted-foreground">{company.email}</p>
        </div>
        <span className={`px-3 py-1 rounded-full text-xs font-bold ${company.active ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
          {company.active ? 'Ativo' : 'Inativo'}
        </span>
      </div>

      {/* Local alerts */}
      {alerts.map((a, i) => (
        <div key={i} className="p-4 rounded-xl border-2 border-amber-300 bg-amber-50 flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-amber-700 flex-shrink-0 mt-0.5" />
          <p className="text-sm text-amber-800 font-medium">{a}</p>
        </div>
      ))}

      {/* Vigência */}
      <div className="bg-card rounded-2xl border border-border/50 p-6">
        <h2 className="font-bold text-lg mb-4 flex items-center gap-2">
          <Calendar className="w-5 h-5 text-primary" /> Vigência Contratual
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4">
          <div>
            <label className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-1.5 block">Tipo de Vigência</label>
            <select value={vigencia} onChange={e => setVigencia(e.target.value)}
              data-testid="select-vigencia"
              className="w-full px-3 py-2 rounded-xl border border-border bg-background text-sm font-medium">
              <option value="">Não definido</option>
              <option value="prazo_indefinido">Prazo Indefinido</option>
              <option value="prazo_determinado">Prazo Determinado</option>
            </select>
          </div>
          <div>
            <label className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-1.5 block">Data de Início</label>
            <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)}
              data-testid="input-contract-start"
              className="w-full px-3 py-2 rounded-xl border border-border bg-background text-sm" />
          </div>
          <div>
            <label className={`text-xs font-bold uppercase tracking-wider mb-1.5 block ${vigencia !== 'prazo_determinado' ? 'text-muted-foreground/40' : 'text-muted-foreground'}`}>
              Data de Fim {vigencia !== 'prazo_determinado' && '(apenas prazo determinado)'}
            </label>
            <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)}
              disabled={vigencia !== 'prazo_determinado'}
              data-testid="input-contract-end"
              className="w-full px-3 py-2 rounded-xl border border-border bg-background text-sm disabled:opacity-40" />
          </div>
        </div>
        {startDate && vigencia && (
          <div className="flex flex-wrap gap-3 mb-4 text-sm">
            <span className="px-3 py-1 rounded-full bg-primary/10 text-primary font-bold text-xs">
              {monthsSince(startDate)} meses de contrato
            </span>
            {vigencia === 'prazo_determinado' && endDate && (
              <span className={`px-3 py-1 rounded-full font-bold text-xs ${daysUntil(endDate) <= 30 ? 'bg-red-100 text-red-800' : daysUntil(endDate) <= 90 ? 'bg-orange-100 text-orange-800' : 'bg-green-100 text-green-800'}`}>
                {daysUntil(endDate) >= 0 ? `${daysUntil(endDate)} dias restantes` : 'Vencido'}
              </span>
            )}
          </div>
        )}
        <button type="button" onClick={saveContractInfo} disabled={savingInfo}
          data-testid="button-save-vigencia"
          className="px-5 py-2 rounded-xl bg-primary text-primary-foreground text-sm font-bold hover:bg-primary/90 disabled:opacity-50 flex items-center gap-2">
          {savingInfo ? <><Loader2 className="w-4 h-4 animate-spin" /> Salvando...</> : <><CheckCircle className="w-4 h-4" /> Salvar Vigência</>}
        </button>
      </div>

      {/* Rentabilidade */}
      <div className="bg-card rounded-2xl border border-border/50 p-6">
        <h2 className="font-bold text-lg mb-4 flex items-center gap-2">
          <TrendingUp className="w-5 h-5 text-primary" /> Painel de Rentabilidade
        </h2>
        <ProfitabilityPanel scopes={scopes} weeklyBilling={company.minWeeklyBilling} />
      </div>

      {/* Reajuste */}
      <div className="bg-card rounded-2xl border border-border/50 p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-bold text-lg flex items-center gap-2">
            <RefreshCw className="w-5 h-5 text-primary" /> Reajuste / Revisão Contratual
          </h2>
          <button type="button" onClick={() => setShowNewAdj(!showNewAdj)}
            data-testid="button-new-adjustment"
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-primary text-primary-foreground text-sm font-bold hover:bg-primary/90">
            <Plus className="w-4 h-4" /> Novo Reajuste
          </button>
        </div>

        {showNewAdj && (
          <div className="p-4 bg-muted/30 rounded-xl border border-border mb-4 space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <label className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-1.5 block">Percentual (%)</label>
                <input type="number" step="0.01" value={adjPct} onChange={e => { setAdjPct(e.target.value); setSimulatedWeekly(null); }}
                  data-testid="input-adj-percentage"
                  placeholder="Ex: 4.62"
                  className="w-full px-3 py-2 rounded-xl border border-border bg-background text-sm" />
              </div>
              <div>
                <label className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-1.5 block">Motivo</label>
                <input value={adjReason} onChange={e => setAdjReason(e.target.value)}
                  data-testid="input-adj-reason"
                  className="w-full px-3 py-2 rounded-xl border border-border bg-background text-sm" />
              </div>
              <div>
                <label className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-1.5 block">Data de Aplicação</label>
                <input type="date" value={adjDate} onChange={e => setAdjDate(e.target.value)}
                  data-testid="input-adj-date"
                  className="w-full px-3 py-2 rounded-xl border border-border bg-background text-sm" />
              </div>
            </div>

            {/* Simulation */}
            {currentWeekly > 0 && (
              <div className="p-4 bg-background rounded-xl border border-border">
                <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-3">Simulação de Reajuste</p>
                <div className="grid grid-cols-3 gap-4 text-sm mb-3">
                  <div>
                    <p className="text-muted-foreground text-xs">Valor semanal atual</p>
                    <p className="font-bold">R$ {currentWeekly.toFixed(2).replace('.', ',')}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground text-xs">Valor mensal atual</p>
                    <p className="font-bold">R$ {(currentWeekly * 4).toFixed(2).replace('.', ',')}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground text-xs">Percentual</p>
                    <p className="font-bold">{adjPct || '—'}%</p>
                  </div>
                </div>
                {simulatedWeekly && (
                  <div className="grid grid-cols-3 gap-4 text-sm p-3 bg-green-50 rounded-lg">
                    <div>
                      <p className="text-green-600 text-xs">Novo valor semanal</p>
                      <p className="font-bold text-green-800">R$ {simulatedWeekly.toFixed(2).replace('.', ',')}</p>
                    </div>
                    <div>
                      <p className="text-green-600 text-xs">Novo valor mensal</p>
                      <p className="font-bold text-green-800">R$ {(simulatedWeekly * 4).toFixed(2).replace('.', ',')}</p>
                    </div>
                    <div>
                      <p className="text-green-600 text-xs">Diferença mensal</p>
                      <p className="font-bold text-green-800">+ R$ {((simulatedWeekly - currentWeekly) * 4).toFixed(2).replace('.', ',')}</p>
                    </div>
                  </div>
                )}
                <button type="button" onClick={simulateAdjustment}
                  data-testid="button-simulate"
                  className="mt-3 px-4 py-1.5 rounded-lg border border-primary text-primary text-sm font-bold hover:bg-primary/5">
                  Simular
                </button>
              </div>
            )}

            <div className="flex gap-3">
              <button type="button" onClick={() => setShowNewAdj(false)} className="px-4 py-2 rounded-xl border border-border text-sm font-bold hover:bg-muted">Cancelar</button>
              <button type="button" onClick={createAdjustment}
                data-testid="button-confirm-adjustment"
                className="px-5 py-2 rounded-xl bg-primary text-primary-foreground text-sm font-bold hover:bg-primary/90">
                Confirmar Reajuste
              </button>
            </div>
          </div>
        )}

        {/* Adjustment history */}
        <div className="space-y-3">
          {adjustments.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">Nenhum reajuste registrado ainda.</p>
          ) : (
            adjustments.map(adj => (
              <div key={adj.id} className="p-4 border border-border rounded-xl bg-background">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-bold text-sm text-primary">+{parseFloat(adj.adjustmentPercentage)}%</span>
                      <span className="text-muted-foreground text-sm">•</span>
                      <span className="text-sm">{adj.reason}</span>
                      <span className="text-muted-foreground text-sm">•</span>
                      <span className="text-sm text-muted-foreground">Vigência: {formatDate(adj.appliedAt)}</span>
                    </div>
                    {adj.newWeeklyValue && (
                      <p className="text-xs text-muted-foreground mt-1">
                        Novo valor semanal: <strong>R$ {parseFloat(adj.newWeeklyValue).toFixed(2).replace('.', ',')}</strong>
                        {' '}/ Mensal: <strong>R$ {(parseFloat(adj.newWeeklyValue) * 4).toFixed(2).replace('.', ',')}</strong>
                      </p>
                    )}
                    <p className="text-xs text-muted-foreground mt-1">
                      Por: {adj.responsibleEmail || '—'} · Criado em: {new Date(adj.createdAt).toLocaleDateString('pt-BR')}
                    </p>
                    {adj.emailSentAt && (
                      <p className="text-xs text-green-600 mt-1 flex items-center gap-1">
                        <CheckCircle className="w-3 h-3" /> E-mail enviado em {new Date(adj.emailSentAt).toLocaleDateString('pt-BR')}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-1">
                    <button type="button" onClick={() => setDocAdj(adj)}
                      data-testid={`button-edit-doc-${adj.id}`}
                      title="Editar documento"
                      className="p-2 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground">
                      <Edit3 className="w-4 h-4" />
                    </button>
                    {adj.documentContent && (
                      <button type="button" onClick={() => exportDocumentPDF(company, adj, adj.documentContent)}
                        data-testid={`button-print-doc-${adj.id}`}
                        title="Exportar PDF"
                        className="p-2 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground">
                        <Printer className="w-4 h-4" />
                      </button>
                    )}
                    <button type="button" onClick={() => setEmailAdj(adj)}
                      data-testid={`button-send-adj-email-${adj.id}`}
                      title="Enviar por e-mail"
                      className="p-2 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground">
                      <Send className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Document Editor Modal */}
      {docAdj && (
        <DocumentEditor company={company} adjustment={docAdj} onSave={saveDocument} onClose={() => setDocAdj(null)} />
      )}

      {/* Email Modal */}
      {emailAdj && (
        <EmailModal company={company} adjustment={emailAdj} onSend={sendEmail} onClose={() => setEmailAdj(null)} sending={sendingEmail} />
      )}
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────
export default function ContractsPage() {
  const [selectedCompanyId, setSelectedCompanyId] = useState<number | null>(null);
  const [search, setSearch] = useState('');
  const [filterVigencia, setFilterVigencia] = useState('');

  const { data: companies = [] } = useQuery<Company[]>({ queryKey: ['/api/companies'] });
  const { data: alerts = [] } = useQuery<ContractAlert[]>({ queryKey: ['/api/contracts/alerts'] });

  const contractualCompanies = companies.filter(c =>
    (c.clientType === 'contratual' || (c as any).contractStartDate || (c as any).contractVigencia) &&
    (search === '' || c.companyName.toLowerCase().includes(search.toLowerCase())) &&
    (filterVigencia === '' || (c as any).contractVigencia === filterVigencia)
  );

  const allContractualCompanies = companies.filter(c => c.clientType === 'contratual');

  const selectedCompany = companies.find(c => c.id === selectedCompanyId);

  if (selectedCompany) {
    return (
      <Layout>
        <div className="max-w-4xl mx-auto">
          <ContractDetail company={selectedCompany} onBack={() => setSelectedCompanyId(null)} />
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="max-w-4xl mx-auto space-y-6">
        {/* Header */}
        <div className="bg-gradient-to-r from-primary to-primary/80 rounded-3xl p-8 text-primary-foreground shadow-xl shadow-primary/20 relative overflow-hidden">
          <div className="absolute top-0 right-0 w-48 h-48 bg-white/10 rounded-full blur-3xl" />
          <div className="relative z-10">
            <h1 className="text-2xl font-display font-extrabold mb-1 flex items-center gap-3">
              <FileText className="w-7 h-7" /> Gestão de Contratos
            </h1>
            <p className="text-primary-foreground/80 text-sm">
              {allContractualCompanies.length} contratos contratuais · {alerts.length} alerta{alerts.length !== 1 ? 's' : ''} ativos
            </p>
          </div>
        </div>

        <ContextualTip
          tipId="contracts-scope-intro"
          variant="new"
          title="Escopo Contratual"
          message="Você pode configurar o escopo contratual de cada cliente nesta área — definindo produtos, quantidades e dias de entrega fixos. Use 'Gerar Pedidos da Semana' para criar os pedidos automaticamente."
          learnMoreMessage="Como funciona o escopo contratual e a geração automática de pedidos?"
        />

        {/* Alerts */}
        {alerts.length > 0 && (
          <div>
            <h2 className="font-bold text-base text-foreground mb-3 flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-amber-500" /> Alertas de Gestão ({alerts.length})
            </h2>
            <div className="space-y-2">
              {alerts.map((a, i) => (
                <AlertBanner key={i} alert={a} onViewContract={id => setSelectedCompanyId(id)} />
              ))}
            </div>
          </div>
        )}

        {/* Filters */}
        <div className="flex gap-3 flex-wrap">
          <input value={search} onChange={e => setSearch(e.target.value)}
            data-testid="input-search-contracts"
            placeholder="Buscar empresa..."
            className="flex-1 min-w-48 px-4 py-2.5 rounded-xl border border-border bg-background text-sm" />
          <select value={filterVigencia} onChange={e => setFilterVigencia(e.target.value)}
            data-testid="select-filter-vigencia"
            className="px-3 py-2.5 rounded-xl border border-border bg-background text-sm font-medium">
            <option value="">Todos os tipos</option>
            <option value="prazo_indefinido">Prazo Indefinido</option>
            <option value="prazo_determinado">Prazo Determinado</option>
          </select>
        </div>

        {/* Company list */}
        <div className="space-y-3">
          {/* Show all contractual companies (clientType = contratual) + any with contract data */}
          {companies
            .filter(c =>
              (c.clientType === 'contratual') &&
              (search === '' || c.companyName.toLowerCase().includes(search.toLowerCase())) &&
              (filterVigencia === '' || (c as any).contractVigencia === filterVigencia)
            )
            .map(company => {
              const c = company as any;
              const hasAlert = alerts.some(a => a.companyId === company.id);
              const months = c.contractStartDate ? monthsSince(c.contractStartDate) : null;
              const daysLeft = c.contractVigencia === 'prazo_determinado' && c.contractEndDate ? daysUntil(c.contractEndDate) : null;

              return (
                <div key={company.id}
                  className={`p-5 bg-card border rounded-2xl cursor-pointer hover:border-primary/40 hover:shadow-md transition-all ${hasAlert ? 'border-amber-300' : 'border-border/50'}`}
                  onClick={() => setSelectedCompanyId(company.id)}
                  data-testid={`card-contract-${company.id}`}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="font-bold text-foreground">{company.companyName}</h3>
                        {hasAlert && <AlertTriangle className="w-4 h-4 text-amber-500" />}
                      </div>
                      <p className="text-sm text-muted-foreground mt-0.5">{company.email}</p>
                      <div className="flex flex-wrap gap-2 mt-2">
                        <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${company.active ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
                          {company.active ? 'Ativo' : 'Inativo'}
                        </span>
                        {c.contractModel && (
                          <span className="px-2 py-0.5 rounded-full bg-primary/10 text-primary text-xs font-bold capitalize">
                            {c.contractModel}
                          </span>
                        )}
                        {c.contractVigencia && (
                          <span className="px-2 py-0.5 rounded-full bg-blue-100 text-blue-800 text-xs font-bold">
                            {c.contractVigencia === 'prazo_indefinido' ? 'Indefinido' : 'Prazo determinado'}
                          </span>
                        )}
                        {months !== null && (
                          <span className="px-2 py-0.5 rounded-full bg-purple-100 text-purple-800 text-xs font-bold">
                            {months} meses
                          </span>
                        )}
                        {daysLeft !== null && (
                          <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${daysLeft <= 30 ? 'bg-red-100 text-red-800' : daysLeft <= 90 ? 'bg-orange-100 text-orange-800' : 'bg-green-100 text-green-800'}`}>
                            {daysLeft >= 0 ? `${daysLeft} dias restantes` : 'Vencido'}
                          </span>
                        )}
                      </div>
                    </div>
                    <ChevronRight className="w-5 h-5 text-muted-foreground flex-shrink-0 mt-1" />
                  </div>
                </div>
              );
            })}
          {companies.filter(c => c.clientType === 'contratual').length === 0 && (
            <div className="text-center py-12 text-muted-foreground">
              <FileText className="w-12 h-12 mx-auto mb-3 opacity-30" />
              <p className="font-medium">Nenhum cliente contratual cadastrado</p>
              <p className="text-sm mt-1">Cadastre clientes com tipo "contratual" para gestão de contratos</p>
            </div>
          )}
        </div>
      </div>
    </Layout>
  );
}
