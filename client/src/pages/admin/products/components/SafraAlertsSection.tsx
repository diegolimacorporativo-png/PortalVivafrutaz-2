import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { Leaf, ArrowLeftRight, ChevronUp, ChevronDown } from "lucide-react";
import { SafraSubstituteModal } from "../dialogs/SafraSubstituteModal";

interface SafraAlertsSectionProps {
  allProducts: any[];
}

export function SafraAlertsSection({ allProducts }: SafraAlertsSectionProps) {
  const queryClient = useQueryClient();
  const [expanded, setExpanded] = useState(true);
  const [substituteAlert, setSubstituteAlert] = useState<any | null>(null);

  const { data: alerts, isLoading } = useQuery({
    queryKey: ['/api/products/safra-alerts'],
    queryFn: async () => {
      const res = await fetchWithAuth('/api/products/safra-alerts');
      return res.json();
    },
    refetchInterval: 30000,
  });

  if (isLoading || !alerts || alerts.length === 0) return null;

  return (
    <>
      {substituteAlert && (
        <SafraSubstituteModal
          alert={substituteAlert}
          products={allProducts}
          onClose={() => setSubstituteAlert(null)}
          onDone={() => {
            setSubstituteAlert(null);
            queryClient.invalidateQueries({ queryKey: ['/api/products/safra-alerts'] });
          }}
        />
      )}
      <div className="mb-6 bg-orange-50 border-2 border-orange-200 rounded-2xl overflow-hidden" data-testid="safra-alerts-panel">
        <div className="p-4 flex items-center gap-3 cursor-pointer" onClick={() => setExpanded(e => !e)}>
          <div className="w-9 h-9 bg-orange-500 rounded-xl flex items-center justify-center flex-shrink-0">
            <Leaf className="w-4 h-4 text-white" />
          </div>
          <div className="flex-1">
            <h2 className="font-display font-bold text-orange-900 text-base">Alertas de Safra</h2>
            <p className="text-xs text-orange-700 mt-0.5">
              {alerts.length} produto(s) fora de safra com pedidos ativos — ação necessária
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span className="px-2 py-0.5 bg-orange-500 text-white text-xs font-bold rounded-full">{alerts.length}</span>
            {expanded ? <ChevronUp className="w-4 h-4 text-orange-700" /> : <ChevronDown className="w-4 h-4 text-orange-700" />}
          </div>
        </div>
        {expanded && (
          <div className="border-t border-orange-200 divide-y divide-orange-100">
            {alerts.map((a: any) => (
              <div key={a.product.id} className="p-4 flex items-start gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-bold text-orange-900 text-sm">{a.product.name}</span>
                    <span className="text-xs bg-orange-200 text-orange-800 px-2 py-0.5 rounded-full font-bold">{a.product.category}</span>
                    <span className="px-2 py-0.5 bg-red-100 text-red-700 text-[11px] font-bold rounded-full border border-red-200">Fora de safra</span>
                  </div>
                  <p className="text-xs text-orange-700 mb-2">{a.affectedOrders.length} pedido(s) ativo(s) contém este produto:</p>
                  <div className="flex flex-wrap gap-1.5">
                    {a.affectedOrders.map((o: any) => (
                      <span key={o.orderId} className="inline-flex items-center gap-1 text-[11px] bg-white border border-orange-200 rounded-lg px-2 py-0.5 font-mono text-orange-800">
                        {o.orderCode} · {o.companyName} · {o.quantity}x
                      </span>
                    ))}
                  </div>
                </div>
                <button type="button" onClick={() => setSubstituteAlert(a)}
                  data-testid={`button-safra-manage-${a.product.id}`}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-orange-500 text-white rounded-xl text-xs font-bold hover:bg-orange-600 transition-colors flex-shrink-0 whitespace-nowrap">
                  <ArrowLeftRight className="w-3.5 h-3.5" /> Gerenciar substituição
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
