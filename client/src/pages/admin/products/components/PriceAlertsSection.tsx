import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { safeArray } from "@/lib/safeArray";
import { TrendingUp, TrendingDown, RefreshCw, ChevronUp, ChevronDown, ChevronRight, Layers, X } from "lucide-react";

export function PriceAlertsSection() {
  const [expanded, setExpanded] = useState(true);
  const [dismissed, setDismissed] = useState<number[]>([]);

  const { data: alerts = [], isLoading, refetch, isFetching } = useQuery<any[]>({
    queryKey: ['/api/products/price-alerts'],
    queryFn: async () => {
      const res = await fetchWithAuth('/api/products/price-alerts');
      return res.json();
    },
    refetchInterval: 60000,
  });

  const visible = safeArray(alerts).filter((a: any) => !dismissed.includes(a.product.id));
  if (isLoading || visible.length === 0) return null;

  return (
    <div className="mb-6 bg-red-50 dark:bg-red-900/10 border-2 border-red-200 dark:border-red-800 rounded-2xl overflow-hidden" data-testid="price-alerts-panel">
      <div className="p-4 flex items-center gap-3 cursor-pointer" onClick={() => setExpanded(e => !e)}>
        <div className="w-9 h-9 bg-red-500 rounded-xl flex items-center justify-center flex-shrink-0">
          <TrendingUp className="w-4 h-4 text-white" />
        </div>
        <div className="flex-1">
          <h2 className="font-display font-bold text-red-900 dark:text-red-300 text-base">Alertas de Variação de Custo</h2>
          <p className="text-xs text-red-700 dark:text-red-400 mt-0.5">
            {visible.length} produto(s) com variação significativa de preço detectada nas notas fiscais
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); refetch(); }}
            className="p-1.5 rounded-lg hover:bg-red-200 transition-colors"
            title="Atualizar"
          >
            <RefreshCw className={`w-3.5 h-3.5 text-red-700 ${isFetching ? 'animate-spin' : ''}`} />
          </button>
          <span className="px-2 py-0.5 bg-red-500 text-white text-xs font-bold rounded-full">{visible.length}</span>
          {expanded ? <ChevronUp className="w-4 h-4 text-red-700" /> : <ChevronDown className="w-4 h-4 text-red-700" />}
        </div>
      </div>
      {expanded && (
        <div className="border-t border-red-200 dark:border-red-800 divide-y divide-red-100 dark:divide-red-900">
          {visible.map((a: any) => (
            <div key={a.product.id} className="p-4 flex items-start gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap mb-1">
                  {a.product.productCode && (
                    <span className="text-xs bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded font-mono">#{a.product.productCode}</span>
                  )}
                  <span className="font-bold text-red-900 dark:text-red-200 text-sm">{a.product.name}</span>
                  <span className="text-xs bg-red-100 text-red-700 px-2 py-0.5 rounded-full font-bold">{a.product.category}</span>
                  <span className={`flex items-center gap-1 text-xs font-bold px-2 py-0.5 rounded-full ${a.direction === 'increase' ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'}`}>
                    {a.direction === 'increase' ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                    {a.direction === 'increase' ? '+' : ''}{a.variation}%
                  </span>
                </div>
                <div className="flex items-center gap-3 text-xs text-muted-foreground mb-1.5">
                  <span>Preço base: <strong className="text-foreground">R$ {Number(a.product.basePrice).toFixed(2)}</strong></span>
                  <ChevronRight className="w-3 h-3" />
                  <span>Custo NF: <strong className={a.direction === 'increase' ? 'text-red-600' : 'text-green-600'}>R$ {Number(a.latestCost).toFixed(2)}</strong></span>
                  <span className="text-muted-foreground">· NF {a.latestInvoice.invoiceNumber} · {a.latestInvoice.supplier}</span>
                </div>
                {a.derivedProducts?.length > 0 && (
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <Layers className="w-3 h-3 text-muted-foreground flex-shrink-0" />
                    <span className="text-xs text-muted-foreground">Produtos derivados impactados:</span>
                    {a.derivedProducts.map((d: any) => (
                      <span key={d.id} className="text-xs bg-slate-100 text-slate-700 px-1.5 py-0.5 rounded font-medium">{d.name}</span>
                    ))}
                  </div>
                )}
              </div>
              <button
                type="button"
                onClick={() => setDismissed(prev => [...prev, a.product.id])}
                data-testid={`button-dismiss-price-alert-${a.product.id}`}
                className="p-1.5 rounded-lg text-muted-foreground hover:bg-red-100 transition-colors flex-shrink-0"
                title="Dispensar alerta"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
