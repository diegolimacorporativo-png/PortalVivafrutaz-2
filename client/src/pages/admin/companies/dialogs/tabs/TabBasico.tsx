import { MapPin, Loader2, CheckCircle2, Lock, KeyRound } from "lucide-react";
import { DAYS_OPTIONS } from "../../constants";
import type { CompanyForm } from "../../types";
import type { Company } from "@shared/schema";

interface TabBasicoProps {
  formData: CompanyForm;
  set: (field: string, value: any) => void;
  toggleDay: (day: string) => void;
  cepFilled: boolean;
  setCepFilled: (v: boolean) => void;
  viaCepUF: string;
  setViaCepUF: (v: string) => void;
  lookingUpCep: boolean;
  geocoding: boolean;
  buscarCep: (cep: string) => Promise<void>;
  buscarCoordenadas: () => Promise<void>;
  editingCompany: Company | null;
  priceGroups: any[];
}

export function TabBasico({
  formData, set, toggleDay, cepFilled, setCepFilled, viaCepUF, setViaCepUF,
  lookingUpCep, geocoding, buscarCep, buscarCoordenadas, editingCompany, priceGroups,
}: TabBasicoProps) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-semibold mb-1">Nome da Empresa *</label>
          <input required value={formData.companyName} onChange={e => set("companyName", e.target.value)}
            data-testid="input-company-name"
            className="w-full px-4 py-2.5 rounded-xl border-2 border-border focus:border-primary outline-none" />
        </div>
        <div>
          <label className="block text-sm font-semibold mb-1">Contato Responsável *</label>
          <input required value={formData.contactName} onChange={e => set("contactName", e.target.value)}
            data-testid="input-company-contact"
            className="w-full px-4 py-2.5 rounded-xl border-2 border-border focus:border-primary outline-none" />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-semibold mb-1">LOGIN (e-mail de acesso) *</label>
          <input required type="email" value={formData.email} onChange={e => set("email", e.target.value)}
            data-testid="input-company-email"
            className="w-full px-4 py-2.5 rounded-xl border-2 border-border focus:border-primary outline-none" />
        </div>
        <div>
          <label className="block text-sm font-semibold mb-1">Telefone</label>
          <input type="tel" value={formData.phone} onChange={e => set("phone", e.target.value)}
            placeholder="(11) 99999-9999"
            className="w-full px-4 py-2.5 rounded-xl border-2 border-border focus:border-primary outline-none" />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-semibold mb-1">E-mail de Notificações</label>
          <input type="email" value={formData.notificationEmail} onChange={e => set("notificationEmail", e.target.value)}
            placeholder="notificacoes@empresa.com.br (opcional)"
            data-testid="input-company-notification-email"
            className="w-full px-4 py-2.5 rounded-xl border-2 border-border focus:border-primary outline-none" />
          <p className="text-xs text-muted-foreground mt-1">E-mail alternativo para receber notificações de pedidos.</p>
        </div>
        <div />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-semibold mb-1">CNPJ</label>
          <input value={formData.cnpj} onChange={e => set("cnpj", e.target.value)}
            placeholder="00.000.000/0000-00"
            className="w-full px-4 py-2.5 rounded-xl border-2 border-border focus:border-primary outline-none" />
        </div>
        <div>
          {editingCompany ? (
            <>
              <label className="block text-sm font-semibold mb-1">Nova Senha (deixe em branco para manter)</label>
              <input type="password" value={formData.password} onChange={e => set("password", e.target.value)}
                data-testid="input-company-password"
                className="w-full px-4 py-2.5 rounded-xl border-2 border-border focus:border-primary outline-none" />
            </>
          ) : (
            <>
              <label className="block text-sm font-semibold mb-1">Senha de acesso</label>
              <div className="flex items-center gap-2 px-4 py-2.5 rounded-xl border-2 border-dashed border-primary/40 bg-primary/5">
                <KeyRound className="w-4 h-4 text-primary shrink-0" />
                <span className="text-sm text-primary font-medium">Senha temporária gerada automaticamente</span>
              </div>
              <p className="text-xs text-muted-foreground mt-1.5">A senha será exibida após a criação para que você possa compartilhá-la.</p>
            </>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div />
        <div>
          <label className="block text-sm font-semibold mb-1">Grupo de Preço</label>
          <select value={formData.priceGroupId} onChange={e => set("priceGroupId", e.target.value)}
            className="w-full px-4 py-2.5 rounded-xl border-2 border-border focus:border-primary outline-none">
            <option value="">Selecionar grupo</option>
            {priceGroups?.map(pg => <option key={pg.id} value={pg.id}>{pg.groupName}</option>)}
          </select>
        </div>
      </div>

      {/* Address section */}
      <div className="p-4 rounded-xl border-2 border-border bg-muted/10">
        <div className="flex items-center justify-between mb-3">
          <p className="text-sm font-semibold text-foreground">Endereço de Entrega</p>
          {cepFilled && (
            <button type="button" onClick={() => { setCepFilled(false); setViaCepUF(""); }}
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors">
              <Lock className="w-3 h-3" /> Editar manualmente
            </button>
          )}
        </div>

        <div className="grid grid-cols-3 gap-3 mb-3">
          <div>
            <label className="block text-xs font-semibold mb-1 text-muted-foreground">
              CEP {lookingUpCep && <span className="text-primary font-normal ml-1">consultando...</span>}
            </label>
            <div className="relative">
              <input
                data-testid="input-cep"
                value={formData.addressZip}
                onChange={e => {
                  const v = e.target.value;
                  set("addressZip", v);
                  const digits = v.replace(/\D/g, "");
                  if (digits.length === 8) buscarCep(v);
                  else if (digits.length < 8) { setCepFilled(false); setViaCepUF(""); }
                }}
                placeholder="00000-000"
                maxLength={9}
                className="w-full px-3 py-2 rounded-xl border-2 border-border focus:border-primary outline-none text-sm pr-8"
              />
              {lookingUpCep && <Loader2 className="w-3.5 h-3.5 animate-spin text-primary absolute right-2.5 top-1/2 -translate-y-1/2" />}
              {cepFilled && !lookingUpCep && <CheckCircle2 className="w-3.5 h-3.5 text-green-500 absolute right-2.5 top-1/2 -translate-y-1/2" />}
            </div>
          </div>
          <div className="col-span-2">
            <label className="block text-xs font-semibold mb-1 text-muted-foreground">
              Rua / Logradouro {cepFilled && <Lock className="w-3 h-3 inline ml-1 text-muted-foreground/60" />}
            </label>
            <input
              data-testid="input-address-street"
              value={formData.addressStreet}
              onChange={e => set("addressStreet", e.target.value)}
              readOnly={cepFilled}
              placeholder="Rua das Flores"
              className={`w-full px-3 py-2 rounded-xl border-2 outline-none text-sm transition-colors ${cepFilled ? "border-border bg-muted/40 text-muted-foreground cursor-not-allowed" : "border-border focus:border-primary"}`}
            />
          </div>
        </div>

        <div className="grid grid-cols-3 gap-3 mb-3">
          <div>
            <label className="block text-xs font-semibold mb-1 text-muted-foreground">Número</label>
            <input data-testid="input-address-number" value={formData.addressNumber}
              onChange={e => set("addressNumber", e.target.value)} placeholder="417"
              className="w-full px-3 py-2 rounded-xl border-2 border-border focus:border-primary outline-none text-sm" />
          </div>
          <div>
            <label className="block text-xs font-semibold mb-1 text-muted-foreground">
              Bairro {cepFilled && <Lock className="w-3 h-3 inline ml-1 text-muted-foreground/60" />}
            </label>
            <input data-testid="input-address-neighborhood" value={formData.addressNeighborhood}
              onChange={e => set("addressNeighborhood", e.target.value)} readOnly={cepFilled}
              placeholder="Centro"
              className={`w-full px-3 py-2 rounded-xl border-2 outline-none text-sm transition-colors ${cepFilled ? "border-border bg-muted/40 text-muted-foreground cursor-not-allowed" : "border-border focus:border-primary"}`} />
          </div>
          <div>
            <label className="block text-xs font-semibold mb-1 text-muted-foreground">
              Cidade {cepFilled && <Lock className="w-3 h-3 inline ml-1 text-muted-foreground/60" />}
            </label>
            <input data-testid="input-address-city" value={formData.addressCity}
              onChange={e => set("addressCity", e.target.value)} readOnly={cepFilled}
              placeholder="São Paulo"
              className={`w-full px-3 py-2 rounded-xl border-2 outline-none text-sm transition-colors ${cepFilled ? "border-border bg-muted/40 text-muted-foreground cursor-not-allowed" : "border-border focus:border-primary"}`} />
          </div>
        </div>

        {cepFilled && viaCepUF && (
          <div className="mb-3">
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-primary/10 text-primary text-xs font-bold border border-primary/20">
              <MapPin className="w-3 h-3" /> Estado: {viaCepUF}
            </span>
          </div>
        )}
        {!cepFilled && (
          <p className="text-xs text-muted-foreground mb-3 flex items-center gap-1">
            <span className="text-primary font-bold">Dica:</span> Digite o CEP para preencher rua, bairro e cidade automaticamente.
          </p>
        )}

        <div className="border-t border-border/50 pt-3">
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Coordenadas GPS</p>
            <button type="button" data-testid="button-buscar-coordenadas" onClick={buscarCoordenadas}
              disabled={geocoding || !formData.addressStreet || !formData.addressCity}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold bg-primary/10 text-primary hover:bg-primary/20 border border-primary/30 transition-all disabled:opacity-50 disabled:cursor-not-allowed">
              {geocoding ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <MapPin className="w-3.5 h-3.5" />}
              {geocoding ? "Buscando..." : "Gerar Coordenadas"}
            </button>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold mb-1 text-muted-foreground">Latitude</label>
              <input type="number" step="0.0000001" value={formData.latitude}
                onChange={e => set("latitude", e.target.value)} placeholder="-23.5505"
                className="w-full px-3 py-2 rounded-xl border-2 border-border focus:border-primary outline-none text-sm" />
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1 text-muted-foreground">Longitude</label>
              <input type="number" step="0.0000001" value={formData.longitude}
                onChange={e => set("longitude", e.target.value)} placeholder="-46.6333"
                className="w-full px-3 py-2 rounded-xl border-2 border-border focus:border-primary outline-none text-sm" />
            </div>
          </div>
          <p className="text-xs text-muted-foreground mt-1.5">
            {cepFilled && formData.addressNumber
              ? `Endereço: ${formData.addressStreet}, ${formData.addressNumber} — ${formData.addressCity}/${viaCepUF}`
              : "Preencha o CEP e o número para gerar as coordenadas automaticamente."}
          </p>
        </div>
      </div>

      <div>
        <label className="block text-sm font-semibold mb-2">Dias de Entrega Permitidos</label>
        <div className="flex flex-wrap gap-2">
          {DAYS_OPTIONS.map(day => (
            <button key={day} type="button" onClick={() => toggleDay(day)}
              className={`px-4 py-2 rounded-xl text-sm font-bold border-2 transition-all ${
                formData.allowedOrderDays.includes(day)
                  ? "bg-primary text-white border-primary"
                  : "border-border text-muted-foreground hover:border-primary/50"
              }`}>
              {day}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
