import { Clock } from "lucide-react";
import { DAYS_OPTIONS, DEFAULT_DELIVERY_CONFIG } from "../../constants";
import type { CompanyForm } from "../../types";

interface TabEntregaProps {
  formData: CompanyForm;
  set: (field: string, value: any) => void;
}

export function TabEntrega({ formData, set }: TabEntregaProps) {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 mb-2">
        <Clock className="w-5 h-5 text-primary" />
        <h3 className="font-bold text-base">Configuração de Janelas de Entrega</h3>
      </div>
      <p className="text-sm text-muted-foreground mb-4">
        Configure os dias e horários em que esta empresa recebe entregas.
        Essas informações serão usadas automaticamente na criação de cotações.
      </p>
      <div className="space-y-3">
        {DAYS_OPTIONS.map(day => {
          const cfg = (formData.deliveryConfigJson || DEFAULT_DELIVERY_CONFIG)[day] || DEFAULT_DELIVERY_CONFIG[day];
          return (
            <div key={day}
              className={`rounded-xl border-2 p-4 transition-colors ${cfg.enabled ? "border-primary/30 bg-primary/5" : "border-border bg-muted/30"}`}>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => {
                      const current = formData.deliveryConfigJson || { ...DEFAULT_DELIVERY_CONFIG };
                      set("deliveryConfigJson", { ...current, [day]: { ...cfg, enabled: !cfg.enabled } });
                    }}
                    data-testid={`toggle-delivery-${day.replace(/[^a-z]/gi, "-").toLowerCase()}`}
                    className={`relative w-12 h-6 rounded-full transition-colors ${cfg.enabled ? "bg-primary" : "bg-gray-300"}`}
                  >
                    <span className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-transform ${cfg.enabled ? "translate-x-7" : "translate-x-1"}`} />
                  </button>
                  <span className="font-semibold text-sm">{day}</span>
                  {cfg.enabled && (
                    <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full font-medium">Entrega permitida</span>
                  )}
                  {!cfg.enabled && (
                    <span className="text-xs bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full font-medium">Sem entrega</span>
                  )}
                </div>
              </div>
              {cfg.enabled && (
                <div className="mt-3 flex items-center gap-4 pl-15">
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground font-medium w-14">Início:</span>
                    <input
                      type="time"
                      value={cfg.startTime}
                      onChange={e => {
                        const current = formData.deliveryConfigJson || { ...DEFAULT_DELIVERY_CONFIG };
                        set("deliveryConfigJson", { ...current, [day]: { ...cfg, startTime: e.target.value } });
                      }}
                      data-testid={`time-start-${day.replace(/[^a-z]/gi, "-").toLowerCase()}`}
                      className="px-2 py-1 rounded-lg border border-border text-sm focus:border-primary outline-none"
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground font-medium">Fim:</span>
                    <input
                      type="time"
                      value={cfg.endTime}
                      onChange={e => {
                        const current = formData.deliveryConfigJson || { ...DEFAULT_DELIVERY_CONFIG };
                        set("deliveryConfigJson", { ...current, [day]: { ...cfg, endTime: e.target.value } });
                      }}
                      data-testid={`time-end-${day.replace(/[^a-z]/gi, "-").toLowerCase()}`}
                      className="px-2 py-1 rounded-lg border border-border text-sm focus:border-primary outline-none"
                    />
                  </div>
                  <span className="text-sm text-muted-foreground">
                    {cfg.startTime && cfg.endTime ? `Janela: ${cfg.startTime} às ${cfg.endTime}` : ""}
                  </span>
                </div>
              )}
            </div>
          );
        })}
      </div>
      <div className="mt-4 p-3 bg-blue-50 rounded-xl border border-blue-200">
        <p className="text-xs text-blue-700 font-medium">
          💡 Essas informações são exibidas automaticamente na aba de Cotações ao criar uma proposta para esta empresa,
          permitindo sugestões de agrupamento de rotas.
        </p>
      </div>
    </div>
  );
}
