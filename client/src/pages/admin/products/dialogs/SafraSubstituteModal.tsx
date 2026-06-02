import { useState } from "react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Modal } from "@/components/Modal";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeftRight, XCircle, Percent, StickyNote, Loader2 } from "lucide-react";

interface SafraSubstituteModalProps {
  alert: { product: any; affectedOrders: any[] };
  products: any[];
  onClose: () => void;
  onDone: () => void;
}

export function SafraSubstituteModal({ alert, products, onClose, onDone }: SafraSubstituteModalProps) {
  const { toast } = useToast();
  const [action, setAction] = useState<'replace' | 'remove' | 'discount' | 'note'>('replace');
  const [newProductId, setNewProductId] = useState('');
  const [discountPct, setDiscountPct] = useState('');
  const [nfNote, setNfNote] = useState('');
  const [loading, setLoading] = useState(false);

  const availableProducts = products.filter(p => p.id !== alert.product.id && p.active && !p.outOfSeason);

  const handleApply = async () => {
    if (action === 'replace' && !newProductId) { toast({ title: 'Selecione o produto substituto', variant: 'destructive' }); return; }
    if (action === 'discount' && (!discountPct || Number(discountPct) <= 0 || Number(discountPct) > 100)) {
      toast({ title: 'Informe um percentual válido (1-100)', variant: 'destructive' }); return;
    }
    if (action === 'note' && !nfNote.trim()) { toast({ title: 'Informe a observação', variant: 'destructive' }); return; }
    setLoading(true);
    let errors = 0;
    for (const o of alert.affectedOrders) {
      try {
        const body: any = { action, itemId: o.itemId };
        if (action === 'replace') body.newProductId = Number(newProductId);
        if (action === 'discount') body.discountPct = Number(discountPct);
        if (action === 'note') body.nfNote = nfNote;
        const res = await fetchWithAuth(`/api/orders/${o.orderId}/substitute-item`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        if (!res.ok) errors++;
      } catch { errors++; }
    }
    setLoading(false);
    if (errors > 0) {
      toast({ title: `${errors} erro(s) ao processar`, variant: 'destructive' });
    } else {
      toast({ title: 'Alterações aplicadas!', description: `${alert.affectedOrders.length} pedido(s) atualizado(s)` });
    }
    onDone();
  };

  return (
    <Modal isOpen onClose={onClose} title={`Gerenciar Substituição — ${alert.product.name}`} maxWidth="max-w-lg">
      <div className="space-y-4">
        <div className="p-3 bg-orange-50 border border-orange-200 rounded-xl text-xs text-orange-700 font-medium">
          <strong>{alert.affectedOrders.length}</strong> pedido(s) ativo(s) contém este produto. Escolha como proceder:
        </div>

        <div className="max-h-32 overflow-y-auto rounded-xl border border-border/50 divide-y">
          {alert.affectedOrders.map(o => (
            <div key={o.orderId} className="flex justify-between items-center px-3 py-2 text-xs">
              <span className="font-mono font-bold text-primary">{o.orderCode}</span>
              <span className="text-muted-foreground">{o.companyName}</span>
              <span className="font-bold">{o.quantity}x</span>
              <span className="text-muted-foreground">{o.deliveryDate ? format(new Date(o.deliveryDate), 'd MMM', { locale: ptBR }) : '—'}</span>
            </div>
          ))}
        </div>

        <div className="grid grid-cols-2 gap-2">
          {([
            { key: 'replace', icon: ArrowLeftRight, label: 'Substituir produto', color: 'blue' },
            { key: 'remove', icon: XCircle, label: 'Remover item', color: 'red' },
            { key: 'discount', icon: Percent, label: 'Dar desconto', color: 'green' },
            { key: 'note', icon: StickyNote, label: 'Obs. nota fiscal', color: 'purple' },
          ] as const).map(a => (
            <button key={a.key} type="button" onClick={() => setAction(a.key)}
              className={`flex items-center gap-2 p-2.5 rounded-xl border-2 text-xs font-bold transition-all ${action === a.key ? `bg-${a.color}-100 border-${a.color}-400 text-${a.color}-700` : 'border-border text-muted-foreground hover:border-border/80'}`}>
              <a.icon className="w-3.5 h-3.5" /> {a.label}
            </button>
          ))}
        </div>

        {action === 'replace' && (
          <div>
            <label className="block text-xs font-semibold mb-1.5">Produto substituto</label>
            <select value={newProductId} onChange={e => setNewProductId(e.target.value)}
              className="w-full px-3 py-2.5 rounded-xl border-2 border-border text-sm focus:border-primary outline-none">
              <option value="">Selecione...</option>
              {availableProducts.map(p => <option key={p.id} value={p.id}>{p.name} ({p.category})</option>)}
            </select>
          </div>
        )}
        {action === 'discount' && (
          <div>
            <label className="block text-xs font-semibold mb-1.5">Percentual de desconto (%)</label>
            <input type="number" min="1" max="100" value={discountPct} onChange={e => setDiscountPct(e.target.value)}
              className="w-full px-3 py-2.5 rounded-xl border-2 border-border text-sm focus:border-primary outline-none"
              placeholder="ex: 10" />
          </div>
        )}
        {action === 'note' && (
          <div>
            <label className="block text-xs font-semibold mb-1.5">Observação para a nota fiscal</label>
            <textarea value={nfNote} onChange={e => setNfNote(e.target.value)} rows={2}
              className="w-full px-3 py-2.5 rounded-xl border-2 border-border text-sm focus:border-primary outline-none resize-none"
              placeholder="ex: Produto substituído por indisponibilidade de safra..." />
          </div>
        )}
        {action === 'remove' && (
          <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-xs text-red-700">
            O item será removido dos pedidos listados e o valor total será recalculado automaticamente.
          </div>
        )}

        <div className="flex gap-2 pt-1">
          <button type="button" onClick={onClose} className="flex-1 py-2.5 rounded-xl border border-border text-sm text-muted-foreground hover:bg-muted/50 transition-colors">Cancelar</button>
          <button type="button" onClick={handleApply} disabled={loading}
            className="flex-1 py-2.5 rounded-xl bg-primary text-primary-foreground text-sm font-bold hover:bg-primary/90 transition-colors disabled:opacity-50 flex items-center justify-center gap-2">
            {loading && <Loader2 className="w-4 h-4 animate-spin" />}
            Aplicar em {alert.affectedOrders.length} pedido(s)
          </button>
        </div>
      </div>
    </Modal>
  );
}
