import { CheckCircle, XCircle, CalendarDays, DollarSign, Clock, Percent, Lock } from "lucide-react";
import { DEFAULT_DELIVERY_CONFIG } from "../../constants";
import type { CompanyForm, TabKey } from "../../types";

interface TabConfigProps {
  formData: CompanyForm;
  set: (field: string, value: any) => void;
  activeTab: TabKey;
  setActiveTab: (tab: TabKey) => void;
}

export function TabConfig({ formData, set, activeTab, setActiveTab }: TabConfigProps) {
  return (
    <div className="space-y-5">
      {/* Status */}
      <div className="p-4 rounded-xl border-2 border-border bg-muted/20">
        <p className="text-sm font-semibold mb-3 text-foreground">Status da Empresa</p>
        <div className="flex gap-3">
          <button type="button" onClick={() => set("active", true)}
            className={`flex items-center gap-2 px-5 py-2.5 rounded-xl font-bold text-sm border-2 transition-all ${formData.active ? "bg-green-600 text-white border-green-600" : "border-border text-muted-foreground hover:border-green-400"}`}>
            <CheckCircle className="w-4 h-4" /> Ativa
          </button>
          <button type="button" onClick={() => set("active", false)}
            className={`flex items-center gap-2 px-5 py-2.5 rounded-xl font-bold text-sm border-2 transition-all ${!formData.active ? "bg-red-600 text-white border-red-600" : "border-border text-muted-foreground hover:border-red-400"}`}>
            <XCircle className="w-4 h-4" /> Inativa
          </button>
        </div>
      </div>

      {/* Client type */}
      <div className="p-4 rounded-xl border-2 border-border bg-muted/20">
        <p className="text-sm font-semibold mb-1 text-foreground">Tipo de Empresa</p>
        <p className="text-xs text-muted-foreground mb-3">Define o perfil e frequência de pedidos do cliente.</p>
        <div className="flex gap-3 flex-wrap">
          {[
            { value: "semanal",    label: "Cliente Semanal",     desc: "Pedidos manuais toda semana" },
            { value: "mensal",     label: "Mensal",               desc: "Programação mensal de pedidos" },
            { value: "pontual",    label: "Pontual",              desc: "Esporádico, sem notificações" },
            { value: "contratual", label: "Cliente Contratual",  desc: "Escopo fixo definido em contrato" },
          ].map(opt => (
            <button key={opt.value} type="button" data-testid={`button-clienttype-${opt.value}`}
              onClick={() => {
                set("clientType", opt.value);
                if (opt.value !== "contratual") {
                  set("contractModel", "");
                  if ((activeTab as string) === "contrato") setActiveTab("config");
                }
              }}
              className={`flex-1 min-w-[100px] px-4 py-3 rounded-xl font-bold text-sm border-2 transition-all text-left ${
                formData.clientType === opt.value
                  ? "bg-primary text-white border-primary"
                  : "border-border text-muted-foreground hover:border-primary/50"
              }`}>
              <p>{opt.label}</p>
              <p className={`text-xs font-normal mt-0.5 ${formData.clientType === opt.value ? "text-white/80" : "text-muted-foreground"}`}>
                {opt.desc}
              </p>
            </button>
          ))}
        </div>

        {formData.clientType === "contratual" && (
          <div className="mt-4 pt-4 border-t border-border/50">
            <p className="text-sm font-semibold mb-1 text-foreground">Modelo de Contrato</p>
            <p className="text-xs text-muted-foreground mb-3">Define como o escopo de produtos é gerenciado.</p>
            <div className="flex gap-3 flex-wrap">
              {[
                { value: "fixo",      label: "Contrato Fixo",        desc: "Escopo fixo, pedidos automáticos" },
                { value: "variavel",  label: "Contrato Variável",    desc: "Escopo base com ajustes permitidos" },
                { value: "alternado", label: "Contrato Alternado",   desc: "Rotação quinzenal (Lista A / Lista B)" },
                { value: "rotacao4",  label: "Rotação 4 Semanas",    desc: "Ciclo mensal (Listas A-D)" },
              ].map(opt => (
                <button key={opt.value} type="button" data-testid={`button-contractmodel-${opt.value}`}
                  onClick={() => set("contractModel", opt.value)}
                  className={`flex-1 min-w-[120px] px-4 py-3 rounded-xl font-bold text-sm border-2 transition-all text-left ${
                    formData.contractModel === opt.value
                      ? "bg-secondary text-secondary-foreground border-secondary"
                      : "border-border text-muted-foreground hover:border-secondary/50"
                  }`}>
                  <p>{opt.label}</p>
                  <p className={`text-xs font-normal mt-0.5 ${formData.contractModel === opt.value ? "text-secondary-foreground/80" : "text-muted-foreground"}`}>
                    {opt.desc}
                  </p>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Vigência Contratual */}
        <div className="mt-4 pt-4 border-t border-border/50">
          <p className="text-sm font-semibold mb-1 text-foreground flex items-center gap-1">
            <CalendarDays className="w-4 h-4 text-primary" /> Vigência Contratual
          </p>
          <p className="text-xs text-muted-foreground mb-3">
            Controle de prazo e datas. Gera alertas automáticos quando o contrato se aproxima do vencimento ou completa 12 meses.
          </p>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="text-xs font-bold text-muted-foreground mb-1 block">Tipo de Vigência</label>
              <select value={formData.contractVigencia || ""} onChange={e => set("contractVigencia", e.target.value)}
                data-testid="select-company-vigencia"
                className="w-full px-3 py-2 rounded-xl border-2 border-border focus:border-primary outline-none text-sm">
                <option value="">Não definido</option>
                <option value="prazo_indefinido">Prazo Indefinido</option>
                <option value="prazo_determinado">Prazo Determinado</option>
              </select>
            </div>
            <div>
              <label className="text-xs font-bold text-muted-foreground mb-1 block">Data de Início</label>
              <input type="date" value={formData.contractStartDate || ""}
                onChange={e => set("contractStartDate", e.target.value)}
                data-testid="input-company-contract-start"
                className="w-full px-3 py-2 rounded-xl border-2 border-border focus:border-primary outline-none text-sm" />
            </div>
            <div>
              <label className={`text-xs font-bold mb-1 block ${formData.contractVigencia !== "prazo_determinado" ? "text-muted-foreground/40" : "text-muted-foreground"}`}>
                Data de Fim
              </label>
              <input type="date" value={formData.contractEndDate || ""}
                disabled={formData.contractVigencia !== "prazo_determinado"}
                onChange={e => set("contractEndDate", e.target.value)}
                data-testid="input-company-contract-end"
                className="w-full px-3 py-2 rounded-xl border-2 border-border focus:border-primary outline-none text-sm disabled:opacity-40" />
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-semibold mb-1">
            <span className="flex items-center gap-1"><DollarSign className="w-4 h-4 text-primary" /> Faturamento Mínimo Semanal (R$)</span>
          </label>
          <input type="number" step="0.01" min="0" value={formData.minWeeklyBilling}
            onChange={e => set("minWeeklyBilling", e.target.value)} placeholder="0,00"
            className="w-full px-4 py-2.5 rounded-xl border-2 border-border focus:border-primary outline-none" />
          <p className="text-xs text-muted-foreground mt-1">Mínimo esperado por semana. Pode ter exceções por cliente.</p>
        </div>
        <div>
          <label className="block text-sm font-semibold mb-1">
            <span className="flex items-center gap-1"><Clock className="w-4 h-4 text-primary" /> Janela de Entrega</span>
          </label>
          {(() => {
            const cfg = formData.deliveryConfigJson || DEFAULT_DELIVERY_CONFIG;
            const enabled = Object.entries(cfg).filter(([, v]) => v.enabled);
            if (enabled.length === 0) {
              return <p className="text-xs text-muted-foreground py-2">Configure os dias de entrega na aba <strong>Configuração de Entrega</strong> para ver as janelas aqui.</p>;
            }
            return (
              <div className="space-y-1.5">
                {enabled.map(([day, v]) => (
                  <div key={day} className="flex items-center gap-3 px-3 py-2 bg-primary/5 border border-primary/20 rounded-xl">
                    <Clock className="w-3.5 h-3.5 text-primary flex-shrink-0" />
                    <span className="text-sm font-semibold text-foreground">{day}</span>
                    <span className="text-sm text-muted-foreground ml-auto">{v.startTime} – {v.endTime}</span>
                  </div>
                ))}
              </div>
            );
          })()}
          <p className="text-xs text-muted-foreground mt-1">Janelas configuradas na aba Configuração de Entrega.</p>
        </div>
      </div>

      {/* Admin fee */}
      <div className="p-4 rounded-xl border-2 border-secondary/30 bg-secondary/5">
        <label className="flex items-center gap-2 text-sm font-bold text-secondary mb-3">
          <Percent className="w-4 h-4" /> Taxa Administrativa (%)
        </label>
        <div className="flex gap-2 mb-3 flex-wrap">
          <span className="text-xs text-muted-foreground self-center font-medium">Seleção rápida:</span>
          {[{ label: "GRSA", value: "27" }, { label: "SODEXO", value: "18" }].map(op => (
            <button key={op.label} type="button" onClick={() => set("adminFee", op.value)}
              className={`px-4 py-1.5 rounded-xl text-sm font-bold border-2 transition-all ${
                formData.adminFee === op.value
                  ? "bg-secondary text-white border-secondary shadow-md"
                  : "border-secondary/40 text-secondary hover:bg-secondary/10"
              }`}>
              {op.label} — {op.value}%
            </button>
          ))}
        </div>
        <div className="flex items-center gap-4">
          <input type="number" step="0.1" min="0" max="100" value={formData.adminFee}
            onChange={e => set("adminFee", e.target.value)}
            className="w-32 px-4 py-2.5 rounded-xl border-2 border-border focus:border-secondary outline-none text-xl font-bold text-center"
            placeholder="0" />
          <div className="flex gap-2 flex-wrap">
            {["0", "5", "10", "12", "15", "20"].map(v => (
              <button key={v} type="button" onClick={() => set("adminFee", v)}
                className={`px-3 py-1.5 rounded-lg text-sm font-bold border-2 transition-all ${
                  formData.adminFee === v ? "bg-secondary text-white border-secondary" : "border-border text-muted-foreground hover:border-secondary/50"
                }`}>
                {v}%
              </button>
            ))}
          </div>
        </div>
        <p className="text-xs text-muted-foreground mt-2">
          Aplicada automaticamente sobre o preço base. Clientes <strong>não visualizam</strong> esta taxa.
        </p>
        {formData.adminFee && Number(formData.adminFee) > 0 && (
          <div className="mt-2 p-2 bg-secondary/10 rounded-lg">
            <p className="text-xs font-bold text-secondary">
              Exemplo: produto R$ 10,00 → cliente vê R$ {(10 * (1 + Number(formData.adminFee) / 100)).toFixed(2)}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
