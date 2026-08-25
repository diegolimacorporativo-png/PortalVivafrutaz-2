import { useState, useCallback, useEffect } from "react";
import { useToast } from "@/hooks/use-toast";
import {
  useCreateCompany, useUpdateCompany, usePriceGroups,
} from "@/hooks/use-admin";
import { Modal } from "@/components/Modal";
import { Lock } from "lucide-react";
import type { Company } from "@shared/schema";
import { TABS, emptyForm, companyToForm } from "../constants";
import type { TabKey, CompanyForm } from "../types";

import { TabBasico }    from "./tabs/TabBasico";
import { TabConfig }    from "./tabs/TabConfig";
import { TabFinanceiro } from "./tabs/TabFinanceiro";
import { TabFiscal }    from "./tabs/TabFiscal";
import { TabEntrega }   from "./tabs/TabEntrega";
import { AddressesTab }          from "./AddressesTab";
import { ContractScopeManager }  from "./ContractScopeManager";

interface CompanyModalProps {
  isOpen: boolean;
  editingCompany: Company | null;
  onClose: () => void;
  onSuccess: (result?: { companyName: string; email: string; password: string }) => void;
}

export function CompanyModal({ isOpen, editingCompany, onClose, onSuccess }: CompanyModalProps) {
  const { toast } = useToast();
  const { data: priceGroups = [] } = usePriceGroups();

  const [activeTab, setActiveTab]     = useState<TabKey>("basico");
  const [formData, setFormData]       = useState<CompanyForm>(() => emptyForm);
  const [geocoding, setGeocoding]     = useState(false);
  const [lookingUpCep, setLookingUpCep] = useState(false);
  const [cepFilled, setCepFilled]     = useState(false);
  const [viaCepUF, setViaCepUF]       = useState("");
  const [pendingDeletes, setPendingDeletes] = useState<number[]>([]);

  const createCompany = useCreateCompany();
  const updateCompany = useUpdateCompany();
  const isPending = createCompany.isPending || updateCompany.isPending;

  // Reset form state when modal opens or switches between create/edit
  useEffect(() => {
    if (!isOpen) return;
    if (editingCompany) {
      setFormData(companyToForm(editingCompany));
      setCepFilled(false);
      setViaCepUF((editingCompany as any).addressState || "");
    } else {
      setFormData({ ...emptyForm });
      setCepFilled(false);
      setViaCepUF("");
    }
    setActiveTab("basico");
    setPendingDeletes([]);
  }, [isOpen, editingCompany]);

  function set(field: string, value: any) {
    setFormData(prev => ({ ...prev, [field]: value }));
  }

  function toggleDay(day: string) {
    setFormData(prev => {
      const cur = prev.allowedOrderDays;
      return {
        ...prev,
        allowedOrderDays: cur.includes(day) ? cur.filter(d => d !== day) : [...cur, day],
      };
    });
  }

  const buscarCep = useCallback(async (cep: string) => {
    const digits = cep.replace(/\D/g, "");
    if (digits.length !== 8) return;
    setLookingUpCep(true);
    try {
      const r = await fetch(`/api/geo/cep-basic/${digits}`, { credentials: "include" });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        toast({ title: r.status === 404 ? "CEP não encontrado" : "Erro ao consultar CEP", variant: "destructive" });
        return;
      }
      if (d.erro) { toast({ title: "CEP não encontrado", variant: "destructive" }); return; }
      setFormData(prev => ({
        ...prev,
        addressStreet:      d.logradouro || prev.addressStreet,
        addressNeighborhood: d.bairro     || prev.addressNeighborhood,
        addressCity:        d.localidade  || prev.addressCity,
        addressState:       d.uf          || prev.addressState,
        addressIbge:        d.ibge        || prev.addressIbge,
      }));
      setCepFilled(true);
      setViaCepUF(d.uf || "");
    } catch {
      toast({ title: "Erro ao consultar CEP", variant: "destructive" });
    } finally {
      setLookingUpCep(false);
    }
  }, [toast]);

  const buscarCoordenadas = useCallback(async () => {
    const { addressStreet, addressNumber, addressCity, addressState } = formData;
    if (!addressStreet || !addressCity) return;
    setGeocoding(true);
    try {
      const query = encodeURIComponent(`${addressStreet}, ${addressNumber || ""}, ${addressCity}, ${addressState}, Brasil`);
      const r = await fetch(`/api/geocode?q=${query}`);
      const d = await r.json();
      if (d.length > 0) {
        setFormData(prev => ({ ...prev, latitude: d[0].lat, longitude: d[0].lon }));
        toast({ title: "Coordenadas obtidas", description: `Lat: ${d[0].lat}, Lon: ${d[0].lon}` });
      } else {
        toast({ title: "Endereço não encontrado no mapa", variant: "destructive" });
      }
    } catch {
      toast({ title: "Erro ao buscar coordenadas", variant: "destructive" });
    } finally {
      setGeocoding(false);
    }
  }, [formData, toast]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const payload: any = {
      companyName: formData.companyName,
      contactName: formData.contactName,
      email: formData.email,
      notificationEmail: formData.notificationEmail || null,
      phone: formData.phone || null,
      cnpj: formData.cnpj || null,
      addressStreet: formData.addressStreet || null,
      addressNumber: formData.addressNumber || null,
      addressNeighborhood: formData.addressNeighborhood || null,
      addressCity: formData.addressCity || null,
      addressZip: formData.addressZip || null,
      latitude: formData.latitude ? Number(formData.latitude) : null,
      longitude: formData.longitude ? Number(formData.longitude) : null,
      priceGroupId: formData.priceGroupId ? Number(formData.priceGroupId) : null,
      allowedOrderDays: formData.allowedOrderDays,
      active: formData.active,
      clientType: formData.clientType,
      contractModel: formData.contractModel || null,
      minWeeklyBilling: formData.minWeeklyBilling ? Number(formData.minWeeklyBilling) : null,
      deliveryTime: formData.deliveryTime || null,
      adminFee: formData.adminFee ? Number(formData.adminFee) : 0,
      billingTerm: formData.billingTerm || null,
      billingType: formData.billingType || null,
      billingFormat: formData.billingFormat || null,
      paymentDates: formData.paymentDates || null,
      financialNotes: formData.financialNotes || null,
      deliveryConfigJson: formData.deliveryConfigJson
        ? JSON.stringify(formData.deliveryConfigJson)
        : null,
      autoCalcCost: formData.autoCalcCost,
      autoPriceFromCatalog: formData.autoPriceFromCatalog,
      manualAvgCost: formData.manualAvgCost ? Number(formData.manualAvgCost) : null,
      contractStartDate: formData.contractStartDate || null,
      contractEndDate: formData.contractEndDate || null,
      contractVigencia: formData.contractVigencia || null,
      stateRegistration: formData.stateRegistration || null,
      addressState: formData.addressState || null,
      addressIbge: formData.addressIbge || null,
      regimeTributario: formData.regimeTributario || null,
      defaultCfop: formData.defaultCfop || null,
    };
    if (formData.password) payload.password = formData.password;

    // Delete pending scope items
    for (const id of pendingDeletes) {
      try {
        const res = await fetch(`/api/companies/${editingCompany!.id}/contract-scopes/${id}`, {
          method: "DELETE",
          credentials: "include",
        });
        if (!res.ok) console.warn(`Failed to delete scope item ${id}`);
      } catch (e) { console.error(e); }
    }

    if (editingCompany) {
      updateCompany.mutate(
        { id: editingCompany.id, data: payload },
        {
          onSuccess: () => {
            toast({ title: "Empresa atualizada com sucesso!" });
            onSuccess();
            onClose();
          },
          onError: (e: any) =>
            toast({ title: "Erro ao atualizar empresa", description: e.message, variant: "destructive" }),
        }
      );
    } else {
      createCompany.mutate(payload, {
        onSuccess: (res: any) => {
          const data = res?.data ?? res;
          onClose();
          if (data?.tempPassword) {
            onSuccess({
              companyName: formData.companyName,
              email: formData.email,
              password: data.tempPassword,
            });
          } else {
            toast({ title: "Empresa criada com sucesso!" });
            onSuccess();
          }
        },
        onError: (e: any) =>
          toast({ title: "Erro ao criar empresa", description: e.message, variant: "destructive" }),
      });
    }
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={editingCompany ? `Editar: ${editingCompany.companyName}` : "Nova Empresa"}
      maxWidth="max-w-4xl"
    >
      {/* Tab navigation */}
      <div className="flex gap-1 p-1 bg-muted/30 rounded-xl mb-6 overflow-x-auto">
        {TABS.map(tab => {
          const Icon = tab.icon;
          const isContratualLocked = tab.key === "contrato" && formData.clientType !== "contratual";
          return (
            <button
              key={tab.key}
              type="button"
              onClick={() => !isContratualLocked && setActiveTab(tab.key)}
              disabled={isContratualLocked}
              title={isContratualLocked ? "Disponível apenas para Cliente Contratual" : tab.label}
              data-testid={`tab-${tab.key}`}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-semibold whitespace-nowrap transition-all relative flex-shrink-0 ${
                isContratualLocked
                  ? "text-muted-foreground/30 cursor-not-allowed"
                  : activeTab === tab.key
                    ? "bg-white text-primary shadow-sm"
                    : "text-muted-foreground hover:text-foreground hover:bg-white/50"
              }`}
            >
              <Icon className="w-4 h-4" />
              {tab.label}
              {isContratualLocked && <Lock className="w-2.5 h-2.5 absolute -top-0.5 -right-0.5 opacity-40" />}
            </button>
          );
        })}
      </div>

      {/* Tab content */}
      <form onSubmit={handleSubmit}>
        {activeTab === "basico" && (
          <TabBasico
            formData={formData}
            set={set}
            toggleDay={toggleDay}
            cepFilled={cepFilled}
            setCepFilled={setCepFilled}
            viaCepUF={viaCepUF}
            setViaCepUF={setViaCepUF}
            lookingUpCep={lookingUpCep}
            geocoding={geocoding}
            buscarCep={buscarCep}
            buscarCoordenadas={buscarCoordenadas}
            editingCompany={editingCompany}
            priceGroups={priceGroups}
          />
        )}

        {activeTab === "config" && (
          <TabConfig
            formData={formData}
            set={set}
            activeTab={activeTab}
            setActiveTab={setActiveTab}
          />
        )}

        {activeTab === "financeiro" && (
          <TabFinanceiro formData={formData} set={set} />
        )}

        {activeTab === "fiscal" && (
          <TabFiscal formData={formData} set={set} editingCompany={editingCompany} />
        )}

        {activeTab === "contrato" && (
          <ContractScopeManager
            company={editingCompany}
            contractModel={formData.contractModel}
            hiddenIds={pendingDeletes}
            onDelete={(id) => setPendingDeletes(prev => [...prev, id])}
            autoCalcCost={formData.autoCalcCost}
            autoPriceFromCatalog={formData.autoPriceFromCatalog}
            manualAvgCost={formData.manualAvgCost}
            priceGroupId={formData.priceGroupId ? Number(formData.priceGroupId) : null}
            onFlagChange={(flag, val) => set(flag, val)}
            clientType={formData.clientType}
          />
        )}

        {activeTab === "entrega" && (
          <TabEntrega formData={formData} set={set} />
        )}

        {activeTab === "enderecos" && (
          <AddressesTab company={editingCompany} />
        )}

        {/* Footer */}
        <div className="flex items-center justify-between mt-8 pt-6 border-t border-border/50">
          <div className="flex gap-2">
            {TABS.map(tab => {
              const Icon = tab.icon;
              const isContratualLocked = tab.key === "contrato" && formData.clientType !== "contratual";
              return (
                <button
                  key={tab.key}
                  type="button"
                  onClick={() => !isContratualLocked && setActiveTab(tab.key)}
                  title={isContratualLocked ? "Disponível apenas para Cliente Contratual" : tab.label}
                  className={`p-2 rounded-lg transition-colors relative ${
                    isContratualLocked
                      ? "text-muted-foreground/30 cursor-not-allowed"
                      : activeTab === tab.key
                        ? "bg-primary/10 text-primary"
                        : "text-muted-foreground hover:bg-muted"
                  }`}
                >
                  <Icon className="w-4 h-4" />
                  {isContratualLocked && <Lock className="w-2.5 h-2.5 absolute bottom-0.5 right-0.5 opacity-50" />}
                </button>
              );
            })}
          </div>
          <div className="flex gap-3">
            <button type="button" onClick={onClose}
              className="px-5 py-2.5 rounded-xl border-2 border-border font-bold text-muted-foreground hover:bg-muted transition-colors">
              Cancelar
            </button>
            <button type="submit" disabled={isPending}
              className="px-6 py-2.5 bg-primary text-white font-bold rounded-xl shadow-lg hover:-translate-y-0.5 transition-transform disabled:opacity-50">
              {isPending ? "Salvando..." : editingCompany ? "Salvar Alterações" : "Criar Empresa"}
            </button>
          </div>
        </div>
      </form>
    </Modal>
  );
}
