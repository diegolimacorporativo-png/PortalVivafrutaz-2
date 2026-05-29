import { CalendarDays, FileText } from "lucide-react";
import type { CompanyForm } from "../../types";

interface TabFinanceiroProps {
  formData: CompanyForm;
  set: (field: string, value: any) => void;
}

export function TabFinanceiro({ formData, set }: TabFinanceiroProps) {
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-3 gap-4">
        <div>
          <label className="block text-sm font-semibold mb-2">Prazo de Faturamento</label>
          <div className="flex flex-col gap-2">
            {["15", "30", "45"].map(opt => (
              <button key={opt} type="button" onClick={() => set("billingTerm", opt)}
                className={`px-4 py-2 rounded-xl font-bold text-sm border-2 transition-all text-left ${
                  formData.billingTerm === opt ? "bg-primary text-white border-primary" : "border-border text-muted-foreground hover:border-primary/50"
                }`}>
                {opt} dias
              </button>
            ))}
            <button type="button" onClick={() => set("billingTerm", "")}
              className={`px-4 py-2 rounded-xl font-bold text-sm border-2 transition-all text-left ${
                !formData.billingTerm ? "bg-muted border-border text-foreground" : "border-border text-muted-foreground hover:border-border"
              }`}>
              Não definido
            </button>
          </div>
        </div>

        <div>
          <label className="block text-sm font-semibold mb-2">Tipo de Faturamento</label>
          <div className="flex flex-col gap-2">
            {[
              { value: "boleto", label: "Boleto" },
              { value: "deposito", label: "Depósito" },
              { value: "pix", label: "PIX" },
            ].map(opt => (
              <button key={opt.value} type="button" onClick={() => set("billingType", opt.value)}
                className={`px-4 py-2 rounded-xl font-bold text-sm border-2 transition-all text-left ${
                  formData.billingType === opt.value ? "bg-primary text-white border-primary" : "border-border text-muted-foreground hover:border-primary/50"
                }`}>
                {opt.label}
              </button>
            ))}
            <button type="button" onClick={() => set("billingType", "")}
              className={`px-4 py-2 rounded-xl font-bold text-sm border-2 transition-all text-left ${
                !formData.billingType ? "bg-muted border-border text-foreground" : "border-border text-muted-foreground hover:border-border"
              }`}>
              Não definido
            </button>
          </div>
        </div>

        <div>
          <label className="block text-sm font-semibold mb-2">Formato de Faturamento</label>
          <div className="flex flex-col gap-2">
            {[
              { value: "diario", label: "Diário" },
              { value: "semanal", label: "Semanal" },
              { value: "mensal", label: "Mensal" },
            ].map(opt => (
              <button key={opt.value} type="button" onClick={() => set("billingFormat", opt.value)}
                className={`px-4 py-2 rounded-xl font-bold text-sm border-2 transition-all text-left ${
                  formData.billingFormat === opt.value ? "bg-primary text-white border-primary" : "border-border text-muted-foreground hover:border-primary/50"
                }`}>
                {opt.label}
              </button>
            ))}
            <button type="button" onClick={() => set("billingFormat", "")}
              className={`px-4 py-2 rounded-xl font-bold text-sm border-2 transition-all text-left ${
                !formData.billingFormat ? "bg-muted border-border text-foreground" : "border-border text-muted-foreground hover:border-border"
              }`}>
              Não definido
            </button>
          </div>
        </div>
      </div>

      <div>
        <label className="block text-sm font-semibold mb-1">
          <span className="flex items-center gap-1"><CalendarDays className="w-4 h-4 text-primary" /> Datas de Pagamento</span>
        </label>
        <input type="text" value={formData.paymentDates}
          onChange={e => set("paymentDates", e.target.value)}
          placeholder="Ex: 5, 15, 25 de cada mês"
          className="w-full px-4 py-2.5 rounded-xl border-2 border-border focus:border-primary outline-none" />
      </div>

      <div>
        <label className="block text-sm font-semibold mb-1">
          <span className="flex items-center gap-1"><FileText className="w-4 h-4 text-primary" /> Observação Financeira</span>
        </label>
        <textarea value={formData.financialNotes}
          onChange={e => set("financialNotes", e.target.value)}
          rows={4}
          placeholder="Informações adicionais sobre o faturamento deste cliente..."
          className="w-full px-4 py-2.5 rounded-xl border-2 border-border focus:border-primary outline-none resize-none" />
      </div>
    </div>
  );
}
