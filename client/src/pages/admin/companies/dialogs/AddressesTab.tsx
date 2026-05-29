import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { normalizeList } from "@/lib/normalizeResponse";
import { useToast } from "@/hooks/use-toast";
import { Plus, MapPin, Home, Loader2, Navigation, Save, Star, Edit2, Trash2 } from "lucide-react";
import type { Company } from "@shared/schema";
import type { AddressForm } from "../types";
import { emptyAddr } from "../constants";

export function AddressesTab({ company }: { company: Company | null }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [editingAddr, setEditingAddr] = useState<any | null>(null);
  const [addrForm, setAddrForm] = useState<AddressForm>({ ...emptyAddr });
  const [cepLoading, setCepLoading] = useState(false);

  const companyId = company?.id;

  const { data: addresses = [], isLoading } = useQuery<any[]>({
    queryKey: ["/api/companies", companyId, "addresses"],
    queryFn: async () => {
      if (!companyId) return [];
      const r = await fetchWithAuth(`/api/companies/${companyId}/addresses`);
      return normalizeList(await r.json());
    },
    enabled: !!companyId,
  });

  const saveMut = useMutation({
    mutationFn: async (data: AddressForm) => {
      if (editingAddr) {
        return apiRequest("PUT", `/api/companies/${companyId}/addresses/${editingAddr.id}`, data);
      } else {
        return apiRequest("POST", `/api/companies/${companyId}/addresses`, data);
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/companies", companyId, "addresses"] });
      setShowForm(false);
      setEditingAddr(null);
      setAddrForm({ ...emptyAddr });
      toast({ title: editingAddr ? "Endereço atualizado" : "Endereço adicionado" });
    },
    onError: (e: any) => toast({ title: "Erro ao salvar endereço", description: e.message, variant: "destructive" }),
  });

  const deleteMut = useMutation({
    mutationFn: (addrId: number) =>
      apiRequest("DELETE", `/api/companies/${companyId}/addresses/${addrId}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/companies", companyId, "addresses"] });
      toast({ title: "Endereço removido" });
    },
  });

  const setPrimaryMut = useMutation({
    mutationFn: (addrId: number) =>
      apiRequest("PATCH", `/api/companies/${companyId}/addresses/${addrId}/set-primary`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/companies", companyId, "addresses"] });
      toast({ title: "Endereço principal definido" });
    },
  });

  async function lookupCep(cep: string) {
    const cleaned = cep.replace(/\D/g, "");
    if (cleaned.length !== 8) return;
    setCepLoading(true);
    try {
      const r = await fetch(`https://viacep.com.br/ws/${cleaned}/json/`);
      const d = await r.json();
      if (d.erro) { toast({ title: "CEP não encontrado", variant: "destructive" }); return; }
      setAddrForm(prev => ({
        ...prev,
        logradouro: d.logradouro || prev.logradouro,
        bairro: d.bairro || prev.bairro,
        cidade: d.localidade || prev.cidade,
        estado: d.uf || prev.estado,
      }));
    } catch {
      toast({ title: "Erro ao buscar CEP", variant: "destructive" });
    } finally { setCepLoading(false); }
  }

  function openEdit(addr: any) {
    setEditingAddr(addr);
    setAddrForm({
      label: addr.label || "Sede", logradouro: addr.logradouro || "",
      numero: addr.numero || "", complemento: addr.complemento || "",
      bairro: addr.bairro || "", cidade: addr.cidade || "",
      estado: addr.estado || "", cep: addr.cep || "", isPrimary: !!addr.isPrimary,
    });
    setShowForm(true);
  }

  function cancelForm() {
    setShowForm(false);
    setEditingAddr(null);
    setAddrForm({ ...emptyAddr });
  }

  if (!companyId) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        <MapPin className="w-10 h-10 mx-auto mb-3 opacity-30" />
        <p className="text-sm">Salve a empresa primeiro para gerenciar endereços.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-bold text-base flex items-center gap-2">
            <MapPin className="w-5 h-5 text-primary" /> Múltiplos Endereços
          </h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Filiais, centros de distribuição e pontos de entrega
          </p>
        </div>
        {!showForm && (
          <button
            type="button"
            onClick={() => { setShowForm(true); setEditingAddr(null); setAddrForm({ ...emptyAddr }); }}
            data-testid="button-add-address"
            className="flex items-center gap-2 px-4 py-2 bg-primary text-white rounded-xl text-sm font-bold hover:bg-primary/90 transition-colors"
          >
            <Plus className="w-4 h-4" /> Adicionar CEP
          </button>
        )}
      </div>

      {showForm && (
        <div className="bg-muted/40 border-2 border-primary/30 rounded-2xl p-5 space-y-4">
          <h4 className="font-bold text-sm text-primary">
            {editingAddr ? "Editar Endereço" : "Novo Endereço"}
          </h4>

          <div>
            <label className="block text-xs font-semibold mb-1">Tipo / Rótulo</label>
            <div className="flex flex-wrap gap-2 mb-2">
              {["Sede", "Filial", "Centro de Distribuição", "Ponto de Entrega"].map(lbl => (
                <button key={lbl} type="button"
                  onClick={() => setAddrForm(p => ({ ...p, label: lbl }))}
                  className={`px-3 py-1 rounded-lg text-xs font-bold border-2 transition-all ${addrForm.label === lbl ? "bg-primary text-white border-primary" : "border-border text-muted-foreground hover:border-primary/50"}`}>
                  {lbl}
                </button>
              ))}
            </div>
            <input type="text" value={addrForm.label}
              onChange={e => setAddrForm(p => ({ ...p, label: e.target.value }))}
              placeholder="Outro rótulo..."
              data-testid="input-addr-label"
              className="w-full px-3 py-2 rounded-xl border-2 border-border focus:border-primary outline-none text-sm" />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold mb-1">CEP</label>
              <div className="flex gap-2">
                <input type="text" value={addrForm.cep}
                  onChange={e => setAddrForm(p => ({ ...p, cep: e.target.value }))}
                  onBlur={e => lookupCep(e.target.value)}
                  placeholder="00000-000"
                  data-testid="input-addr-cep"
                  className="flex-1 px-3 py-2 rounded-xl border-2 border-border focus:border-primary outline-none text-sm" />
                <button type="button" onClick={() => lookupCep(addrForm.cep)} disabled={cepLoading}
                  data-testid="button-lookup-cep"
                  className="px-3 py-2 bg-primary/10 text-primary rounded-xl text-xs font-bold hover:bg-primary/20 transition-colors border-2 border-primary/20">
                  {cepLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Navigation className="w-4 h-4" />}
                </button>
              </div>
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1">Estado (UF)</label>
              <input type="text" value={addrForm.estado} maxLength={2}
                onChange={e => setAddrForm(p => ({ ...p, estado: e.target.value.toUpperCase() }))}
                placeholder="SP" data-testid="input-addr-estado"
                className="w-full px-3 py-2 rounded-xl border-2 border-border focus:border-primary outline-none text-sm" />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold mb-1">Logradouro (Rua/Av)</label>
            <input type="text" value={addrForm.logradouro}
              onChange={e => setAddrForm(p => ({ ...p, logradouro: e.target.value }))}
              placeholder="Rua, Avenida, Travessa..." data-testid="input-addr-logradouro"
              className="w-full px-3 py-2 rounded-xl border-2 border-border focus:border-primary outline-none text-sm" />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold mb-1">Número</label>
              <input type="text" value={addrForm.numero}
                onChange={e => setAddrForm(p => ({ ...p, numero: e.target.value }))}
                placeholder="123 ou S/N" data-testid="input-addr-numero"
                className="w-full px-3 py-2 rounded-xl border-2 border-border focus:border-primary outline-none text-sm" />
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1">Complemento</label>
              <input type="text" value={addrForm.complemento}
                onChange={e => setAddrForm(p => ({ ...p, complemento: e.target.value }))}
                placeholder="Apto, Sala, Bloco..." data-testid="input-addr-complemento"
                className="w-full px-3 py-2 rounded-xl border-2 border-border focus:border-primary outline-none text-sm" />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold mb-1">Bairro</label>
              <input type="text" value={addrForm.bairro}
                onChange={e => setAddrForm(p => ({ ...p, bairro: e.target.value }))}
                placeholder="Bairro" data-testid="input-addr-bairro"
                className="w-full px-3 py-2 rounded-xl border-2 border-border focus:border-primary outline-none text-sm" />
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1">Cidade</label>
              <input type="text" value={addrForm.cidade}
                onChange={e => setAddrForm(p => ({ ...p, cidade: e.target.value }))}
                placeholder="Cidade" data-testid="input-addr-cidade"
                className="w-full px-3 py-2 rounded-xl border-2 border-border focus:border-primary outline-none text-sm" />
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button type="button"
              onClick={() => setAddrForm(p => ({ ...p, isPrimary: !p.isPrimary }))}
              className={`flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-bold border-2 transition-all ${addrForm.isPrimary ? "bg-yellow-50 border-yellow-400 text-yellow-700" : "border-border text-muted-foreground hover:border-yellow-300"}`}>
              <Star className={`w-4 h-4 ${addrForm.isPrimary ? "fill-yellow-400 text-yellow-400" : ""}`} />
              Endereço Principal
            </button>
          </div>

          <div className="flex gap-3 pt-2">
            <button type="button" onClick={() => saveMut.mutate(addrForm)}
              disabled={saveMut.isPending || !addrForm.logradouro || !addrForm.cidade}
              data-testid="button-save-address"
              className="flex items-center gap-2 px-5 py-2.5 bg-primary text-white font-bold rounded-xl text-sm hover:bg-primary/90 transition-colors disabled:opacity-50">
              {saveMut.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              {editingAddr ? "Salvar Alterações" : "Adicionar Endereço"}
            </button>
            <button type="button" onClick={cancelForm}
              className="px-5 py-2.5 border-2 border-border text-muted-foreground font-bold rounded-xl text-sm hover:bg-muted transition-colors">
              Cancelar
            </button>
          </div>
        </div>
      )}

      {isLoading ? (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </div>
      ) : addresses.length === 0 && !showForm ? (
        <div className="text-center py-10 border-2 border-dashed border-border rounded-2xl">
          <Home className="w-10 h-10 mx-auto mb-3 text-muted-foreground/40" />
          <p className="text-sm text-muted-foreground font-medium">Nenhum endereço cadastrado</p>
          <p className="text-xs text-muted-foreground mt-1">
            Clique em "Adicionar CEP" para incluir filiais e pontos de entrega
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {addresses.map((addr: any) => (
            <div key={addr.id}
              className={`rounded-xl border-2 p-4 transition-all ${addr.isPrimary ? "border-yellow-300 bg-yellow-50/50" : "border-border bg-card"}`}>
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-bold text-sm text-foreground">{addr.label}</span>
                    {addr.isPrimary && (
                      <span className="flex items-center gap-1 text-xs bg-yellow-100 text-yellow-700 px-2 py-0.5 rounded-full font-medium border border-yellow-300">
                        <Star className="w-3 h-3 fill-yellow-400 text-yellow-400" /> Principal
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {addr.logradouro}{addr.numero ? `, ${addr.numero}` : ""}
                    {addr.complemento ? ` (${addr.complemento})` : ""}
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {[addr.bairro, addr.cidade, addr.estado].filter(Boolean).join(" — ")}
                    {addr.cep && <span className="ml-2 font-mono">CEP: {addr.cep}</span>}
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {!addr.isPrimary && (
                    <button type="button" onClick={() => setPrimaryMut.mutate(addr.id)}
                      data-testid={`button-set-primary-${addr.id}`}
                      title="Definir como principal"
                      className="p-2 rounded-lg hover:bg-yellow-50 text-muted-foreground hover:text-yellow-600 transition-colors border border-border">
                      <Star className="w-4 h-4" />
                    </button>
                  )}
                  <button type="button" onClick={() => openEdit(addr)}
                    data-testid={`button-edit-addr-${addr.id}`}
                    className="p-2 rounded-lg hover:bg-primary/10 text-muted-foreground hover:text-primary transition-colors border border-border">
                    <Edit2 className="w-4 h-4" />
                  </button>
                  <button type="button"
                    onClick={() => { if (confirm("Remover este endereço?")) deleteMut.mutate(addr.id); }}
                    data-testid={`button-delete-addr-${addr.id}`}
                    className="p-2 rounded-lg hover:bg-red-50 text-muted-foreground hover:text-red-600 transition-colors border border-border">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
