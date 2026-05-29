import { Info, Receipt, MapPin, FileText, CheckCircle2, XCircle } from "lucide-react";
import type { CompanyForm } from "../../types";
import type { Company } from "@shared/schema";

interface TabFiscalProps {
  formData: CompanyForm;
  set: (field: string, value: any) => void;
  editingCompany: Company | null;
}

export function TabFiscal({ formData, set, editingCompany }: TabFiscalProps) {
  return (
    <div className="space-y-5">
      <div className="flex items-start gap-3 p-4 bg-blue-50 border border-blue-200 rounded-xl">
        <Info className="w-4 h-4 text-blue-600 mt-0.5 flex-shrink-0" />
        <div>
          <p className="text-sm font-semibold text-blue-800">Dados do Destinatário (NF-e)</p>
          <p className="text-xs text-blue-700 mt-0.5">
            Essas informações são usadas automaticamente na emissão de NF-e como dados do destinatário.
            O CNPJ e Razão Social são editados na aba <strong>Dados Básicos</strong>.
          </p>
        </div>
      </div>

      <div>
        <h3 className="text-sm font-bold text-foreground mb-3 flex items-center gap-2">
          <Receipt className="w-4 h-4 text-emerald-600" /> Identificação Fiscal
        </h3>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">CNPJ</label>
            <div className="px-4 py-2.5 rounded-xl border-2 border-border bg-muted/30 text-sm text-muted-foreground">
              {formData.cnpj || <span className="italic">Não informado — editar em Dados Básicos</span>}
            </div>
          </div>
          <div>
            <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">Razão Social</label>
            <div className="px-4 py-2.5 rounded-xl border-2 border-border bg-muted/30 text-sm text-muted-foreground">
              {formData.companyName || <span className="italic">Não informado</span>}
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">Inscrição Estadual</label>
          <input value={formData.stateRegistration}
            onChange={e => set("stateRegistration", e.target.value)}
            placeholder="000.000.000.000" data-testid="input-company-state-reg"
            className="w-full px-4 py-2.5 rounded-xl border-2 border-border focus:border-primary outline-none text-sm" />
        </div>
        <div>
          <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">UF (Estado)</label>
          <input value={formData.addressState}
            onChange={e => set("addressState", e.target.value.toUpperCase())}
            placeholder="SP" maxLength={2} data-testid="input-company-uf"
            className="w-full px-4 py-2.5 rounded-xl border-2 border-border focus:border-primary outline-none text-sm uppercase" />
        </div>
      </div>

      <div>
        <h3 className="text-sm font-bold text-foreground mb-3 flex items-center gap-2">
          <MapPin className="w-4 h-4 text-emerald-600" /> Endereço do Destinatário
        </h3>
        <div className="grid grid-cols-3 gap-4 mb-3">
          <div className="col-span-2">
            <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">Logradouro</label>
            <div className="px-4 py-2.5 rounded-xl border-2 border-border bg-muted/30 text-sm text-muted-foreground">
              {formData.addressStreet || <span className="italic">Ver aba Endereços</span>}
            </div>
          </div>
          <div>
            <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">Número</label>
            <div className="px-4 py-2.5 rounded-xl border-2 border-border bg-muted/30 text-sm text-muted-foreground">
              {formData.addressNumber || "S/N"}
            </div>
          </div>
        </div>
        <div className="grid grid-cols-3 gap-4">
          <div>
            <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">Bairro</label>
            <div className="px-4 py-2.5 rounded-xl border-2 border-border bg-muted/30 text-sm text-muted-foreground">
              {formData.addressNeighborhood || "—"}
            </div>
          </div>
          <div>
            <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">Cidade</label>
            <div className="px-4 py-2.5 rounded-xl border-2 border-border bg-muted/30 text-sm text-muted-foreground">
              {formData.addressCity || "—"}
            </div>
          </div>
          <div>
            <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">
              Código IBGE <span className="text-red-500">*</span>
            </label>
            <input value={formData.addressIbge}
              onChange={e => set("addressIbge", e.target.value.replace(/\D/g, "").slice(0, 7))}
              placeholder="3550308" maxLength={7} data-testid="input-company-ibge"
              className="w-full px-4 py-2.5 rounded-xl border-2 border-border focus:border-primary outline-none text-sm" />
            <p className="text-xs text-muted-foreground mt-1">7 dígitos — ex: 3550308 (São Paulo)</p>
          </div>
        </div>
      </div>

      <div>
        <h3 className="text-sm font-bold text-foreground mb-3 flex items-center gap-2">
          <FileText className="w-4 h-4 text-emerald-600" /> Configuração Fiscal (por empresa)
        </h3>
        <p className="text-xs text-muted-foreground mb-3">
          Deixe em branco para usar as configurações globais do painel fiscal.
        </p>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">Regime Tributário</label>
            <select value={formData.regimeTributario}
              onChange={e => set("regimeTributario", e.target.value)}
              data-testid="select-company-regime"
              className="w-full px-4 py-2.5 rounded-xl border-2 border-border focus:border-primary outline-none text-sm bg-background">
              <option value="">Usar configuração global</option>
              <option value="simples_nacional">Simples Nacional</option>
              <option value="lucro_presumido">Lucro Presumido</option>
              <option value="lucro_real">Lucro Real</option>
              <option value="mei">MEI</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">CFOP Padrão</label>
            <input value={formData.defaultCfop}
              onChange={e => set("defaultCfop", e.target.value.replace(/\D/g, "").slice(0, 4))}
              placeholder="5102 (global)" maxLength={4} data-testid="input-company-cfop"
              className="w-full px-4 py-2.5 rounded-xl border-2 border-border focus:border-primary outline-none text-sm" />
            <p className="text-xs text-muted-foreground mt-1">Ex: 5102 = Venda merc. adquirida p/ industrialização</p>
          </div>
        </div>
      </div>

      {editingCompany && (
        <div className="pt-4 border-t border-border/50">
          <h3 className="text-sm font-bold text-foreground mb-2 flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-600" /> Dados Completos para NF-e
          </h3>
          <div className="grid grid-cols-2 gap-2 text-xs">
            {[
              { label: "CNPJ",               ok: !!formData.cnpj },
              { label: "Razão Social",        ok: !!formData.companyName },
              { label: "Inscrição Estadual",  ok: !!formData.stateRegistration },
              { label: "Logradouro",          ok: !!formData.addressStreet },
              { label: "Bairro",             ok: !!formData.addressNeighborhood },
              { label: "Cidade",             ok: !!formData.addressCity },
              { label: "UF",                 ok: !!formData.addressState },
              { label: "Código IBGE",         ok: formData.addressIbge.length === 7 },
            ].map(({ label, ok }) => (
              <div key={label}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-lg ${ok ? "bg-emerald-50 text-emerald-700" : "bg-orange-50 text-orange-600"}`}>
                {ok ? <CheckCircle2 className="w-3.5 h-3.5 flex-shrink-0" /> : <XCircle className="w-3.5 h-3.5 flex-shrink-0" />}
                {label}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
