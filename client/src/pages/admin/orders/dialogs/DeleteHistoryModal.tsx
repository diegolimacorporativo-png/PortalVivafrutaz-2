import { useState } from "react";
import { Modal } from "@/components/Modal";
import { useToast } from "@/hooks/use-toast";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { normalizeOne, normalizeError } from "@/lib/normalizeResponse";
import { handleIfPeriodoFechado } from "@/lib/periodo-fechado";
import { AlertTriangle, Trash2 } from "lucide-react";
import type { Order } from "../types";

interface DeleteHistoryModalProps {
  orders: any[];
  companies: any[];
  onClose: () => void;
  onDeleted: () => void;
}

export function DeleteHistoryModal({ orders, companies, onClose, onDeleted }: DeleteHistoryModalProps) {
  const { toast } = useToast();
  const [tab, setTab] = useState<'especifico' | 'periodo' | 'cliente'>('especifico');
  const [motivo, setMotivo] = useState('');
  const [specificCode, setSpecificCode] = useState('');
  const [periodoInicio, setPeriodoInicio] = useState('');
  const [periodoFim, setPeriodoFim] = useState('');
  const [clienteId, setClienteId] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [step, setStep] = useState<'form' | 'review' | 'confirm-fiscal'>('form');
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [fiscalConflict, setFiscalConflict] = useState<{ count: number; codes: string[] } | null>(null);

  const getTargetOrders = () => {
    if (tab === 'especifico') {
      return orders.filter(o =>
        (o.orderCode || '').toLowerCase().includes(specificCode.toLowerCase()) ||
        String(o.id) === specificCode
      );
    }
    if (tab === 'periodo') {
      const inicio = periodoInicio ? new Date(periodoInicio) : null;
      const fim = periodoFim ? new Date(periodoFim + 'T23:59:59') : null;
      return orders.filter(o => {
        const d = new Date(o.deliveryDate || o.orderDate);
        if (inicio && d < inicio) return false;
        if (fim && d > fim) return false;
        return true;
      });
    }
    if (tab === 'cliente') {
      if (!clienteId) return [];
      return orders.filter(o => String(o.companyId) === clienteId);
    }
    return [];
  };

  const handleReview = () => {
    const targets = getTargetOrders();
    if (targets.length === 0) {
      toast({ title: 'Nenhum pedido encontrado com esses critérios.', variant: 'destructive' });
      return;
    }
    if (!motivo.trim()) {
      toast({ title: 'Informe o motivo da exclusão.', variant: 'destructive' });
      return;
    }
    setSelectedIds(targets.map(o => o.id));
    setStep('review');
  };

  const handleDelete = async (forceConfirm = false) => {
    setLoading(true);
    try {
      const res = await fetchWithAuth('/api/orders/bulk', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderIds: selectedIds, motivo, confirmar: forceConfirm }),
      });
      const body = await res.json().catch(() => ({}));
      const err = normalizeError(body);
      const conflictDetails = err.details || body;
      if (res.status === 409 && conflictDetails?.requiresConfirmation) {
        setFiscalConflict({
          count: conflictDetails.billedCount,
          codes: conflictDetails.billedCodes || [],
        });
        setStep('confirm-fiscal');
        return;
      }
      if (!res.ok) {
        if (handleIfPeriodoFechado(err, toast)) return;
        toast({ title: err.message || 'Erro ao excluir pedidos', variant: 'destructive' });
        return;
      }
      const ok = normalizeOne<{ deleted: number }>(body) ?? body;
      toast({ title: `${ok.deleted} pedido(s) excluído(s) com sucesso!` });
      onDeleted();
      onClose();
    } catch {
      toast({ title: 'Erro de conexão. Tente novamente.', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  if (step === 'review') {
    const targets = orders.filter(o => selectedIds.includes(o.id));
    return (
      <Modal isOpen onClose={() => setStep('form')} title="Confirmar Exclusão" maxWidth="max-w-lg">
        <div className="space-y-4">
          <div className="p-3 bg-red-50 border border-red-200 rounded-xl">
            <p className="text-sm font-bold text-red-800">{targets.length} pedido(s) serão excluídos permanentemente.</p>
            <p className="text-xs text-red-600 mt-1">Motivo registrado: {motivo}</p>
          </div>
          <div className="max-h-48 overflow-y-auto space-y-1">
            {targets.map(o => {
              const co = companies.find(c => c.id === o.companyId);
              return (
                <div key={o.id} className="flex items-center justify-between px-3 py-2 bg-muted/30 rounded-lg text-sm">
                  <span className="font-mono font-bold">{o.orderCode || `#${o.id}`}</span>
                  <span className="text-muted-foreground text-xs">{co?.companyName || `Empresa #${o.companyId}`}</span>
                  {['nota_emitida', 'nota_exportada'].includes(o.fiscalStatus || '') && (
                    <span className="text-xs font-bold text-orange-600 bg-orange-100 px-2 py-0.5 rounded-full">NF</span>
                  )}
                </div>
              );
            })}
          </div>
          <div className="flex gap-3">
            <button type="button" onClick={() => setStep('form')} className="flex-1 py-2.5 border-2 border-border rounded-xl font-bold text-muted-foreground hover:bg-muted transition-colors">
              Voltar
            </button>
            <button type="button" onClick={() => handleDelete(false)} disabled={loading}
              className="flex-1 py-2.5 bg-red-600 text-white font-bold rounded-xl hover:-translate-y-0.5 transition-all disabled:opacity-50 flex items-center justify-center gap-2">
              <Trash2 className="w-4 h-4" /> {loading ? 'Excluindo...' : 'Confirmar Exclusão'}
            </button>
          </div>
        </div>
      </Modal>
    );
  }

  if (step === 'confirm-fiscal' && fiscalConflict) {
    return (
      <Modal isOpen onClose={() => setStep('review')} title="Atenção — Pedidos Faturados" maxWidth="max-w-lg">
        <div className="space-y-4">
          <div className="p-4 bg-orange-50 border-2 border-orange-300 rounded-xl">
            <AlertTriangle className="w-8 h-8 text-orange-600 mb-2" />
            <p className="font-bold text-orange-800">
              {fiscalConflict.count} pedido(s) já possuem Nota Fiscal emitida ou exportada:
            </p>
            <p className="text-xs text-orange-700 mt-1">{fiscalConflict.codes.join(', ')}</p>
            <p className="text-sm text-orange-700 mt-2">Deseja excluir mesmo assim? Esta ação é irreversível.</p>
          </div>
          <div className="flex gap-3">
            <button type="button" onClick={() => setStep('review')} className="flex-1 py-2.5 border-2 border-border rounded-xl font-bold text-muted-foreground hover:bg-muted transition-colors">
              Cancelar
            </button>
            <button type="button" onClick={() => handleDelete(true)} disabled={loading}
              className="flex-1 py-2.5 bg-red-600 text-white font-bold rounded-xl hover:-translate-y-0.5 transition-all disabled:opacity-50">
              {loading ? 'Excluindo...' : 'Excluir mesmo assim'}
            </button>
          </div>
        </div>
      </Modal>
    );
  }

  return (
    <Modal isOpen onClose={onClose} title="Excluir Histórico de Pedidos" maxWidth="max-w-lg">
      <div className="space-y-4">
        <div className="p-3 bg-yellow-50 border border-yellow-200 rounded-xl flex gap-2">
          <AlertTriangle className="w-5 h-5 text-yellow-600 flex-shrink-0 mt-0.5" />
          <p className="text-sm text-yellow-800">Esta operação é permanente e irreversível. Toda exclusão é registrada no log de auditoria.</p>
        </div>

        <div className="flex p-1 gap-1 bg-muted/40 rounded-xl">
          {(['especifico', 'periodo', 'cliente'] as const).map(t => (
            <button key={t} type="button" onClick={() => setTab(t)}
              data-testid={`delete-tab-${t}`}
              className={`flex-1 py-2 text-xs font-bold rounded-lg transition-all ${tab === t ? 'bg-white text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}>
              {t === 'especifico' ? 'Pedido Específico' : t === 'periodo' ? 'Por Período' : 'Por Cliente'}
            </button>
          ))}
        </div>

        {tab === 'especifico' && (
          <div>
            <label className="block text-sm font-semibold mb-1.5">Código ou número do pedido</label>
            <input value={specificCode} onChange={e => setSpecificCode(e.target.value)}
              data-testid="input-delete-specific"
              className="w-full px-4 py-2.5 rounded-xl border-2 border-border focus:border-primary outline-none"
              placeholder="Ex: VF-2026-001234" />
            {specificCode && (
              <p className="text-xs text-muted-foreground mt-1">{getTargetOrders().length} pedido(s) encontrado(s)</p>
            )}
          </div>
        )}

        {tab === 'periodo' && (
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-semibold mb-1.5">Data inicial</label>
              <input type="date" value={periodoInicio} onChange={e => setPeriodoInicio(e.target.value)}
                data-testid="input-delete-inicio"
                className="w-full px-4 py-2.5 rounded-xl border-2 border-border focus:border-primary outline-none" />
            </div>
            <div>
              <label className="block text-sm font-semibold mb-1.5">Data final</label>
              <input type="date" value={periodoFim} onChange={e => setPeriodoFim(e.target.value)}
                data-testid="input-delete-fim"
                className="w-full px-4 py-2.5 rounded-xl border-2 border-border focus:border-primary outline-none" />
            </div>
            {(periodoInicio || periodoFim) && (
              <p className="col-span-2 text-xs text-muted-foreground">{getTargetOrders().length} pedido(s) no período</p>
            )}
          </div>
        )}

        {tab === 'cliente' && (
          <div>
            <label className="block text-sm font-semibold mb-1.5">Empresa</label>
            <select value={clienteId} onChange={e => setClienteId(e.target.value)}
              data-testid="select-delete-client"
              className="w-full px-4 py-2.5 rounded-xl border-2 border-border focus:border-primary outline-none bg-background">
              <option value="">Selecione a empresa...</option>
              {companies.map(c => <option key={c.id} value={String(c.id)}>{c.companyName}</option>)}
            </select>
            {clienteId && (
              <p className="text-xs text-muted-foreground mt-1">{getTargetOrders().length} pedido(s) desta empresa</p>
            )}
          </div>
        )}

        <div>
          <label className="block text-sm font-semibold mb-1.5">Motivo da exclusão *</label>
          <textarea value={motivo} onChange={e => setMotivo(e.target.value)}
            data-testid="input-delete-motivo"
            rows={2}
            placeholder="Informe o motivo para registro no log de auditoria..."
            className="w-full px-4 py-2.5 rounded-xl border-2 border-border focus:border-primary outline-none resize-none" />
        </div>

        <div className="flex gap-3">
          <button type="button" onClick={onClose} className="flex-1 py-2.5 border-2 border-border rounded-xl font-bold text-muted-foreground hover:bg-muted transition-colors">
            Cancelar
          </button>
          <button type="button" onClick={handleReview}
            data-testid="button-delete-review"
            className="flex-1 py-2.5 bg-red-600 text-white font-bold rounded-xl hover:-translate-y-0.5 transition-all flex items-center justify-center gap-2">
            <Trash2 className="w-4 h-4" /> Revisar e Excluir
          </button>
        </div>
      </div>
    </Modal>
  );
}
