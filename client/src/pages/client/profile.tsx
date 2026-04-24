import { useState } from "react";
import { useAuth } from "@/hooks/use-auth";
import { useQueryClient } from "@tanstack/react-query";
import { Layout } from "@/components/Layout";
import { Building2, Phone, Mail, MapPin, Tag, Calendar, CreditCard, AlertCircle, User, Clock, RefreshCw, CheckCircle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

function CompanyMissing() {
  return (
    <div className="flex flex-col items-center justify-center py-24 text-center">
      <div className="w-16 h-16 rounded-2xl bg-orange-100 flex items-center justify-center mb-4">
        <AlertCircle className="w-8 h-8 text-orange-500" />
      </div>
      <h2 className="text-xl font-bold text-foreground mb-2">Dados da empresa não encontrados.</h2>
      <p className="text-muted-foreground text-sm max-w-sm">
        Não foi possível carregar as informações da sua empresa. Entre em contato com a equipe VivaFrutaz.
      </p>
    </div>
  );
}

function InfoRow({ label, value, icon: Icon }: { label: string; value: string | undefined | null; icon: any }) {
  if (!value) return null;
  return (
    <div className="flex items-start gap-3 py-3 border-b border-border/40 last:border-0">
      <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0 mt-0.5">
        <Icon className="w-4 h-4 text-primary" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-0.5">{label}</p>
        <p className="text-sm font-bold text-foreground break-words">{value}</p>
      </div>
    </div>
  );
}

const CLIENT_TYPE_LABEL: Record<string, string> = {
  mensal: "Mensal",
  semanal: "Semanal",
  quinzenal: "Quinzenal",
  pontual: "Pontual",
  contratual: "Contratual",
};

const PREFERRED_ORDER_TYPE_INFO: Record<string, { label: string; description: string }> = {
  semanal: {
    label: "Pedido Semanal",
    description: "Janela de pedidos aberta toda semana nos dias configurados.",
  },
  mensal: {
    label: "Pedido Mensal",
    description: "Um pedido por mês, válido para o período inteiro.",
  },
  pontual: {
    label: "Pedido Pontual",
    description: "Solicite pedidos apenas quando precisar, sem periodicidade fixa.",
  },
};

export default function ClientProfile() {
  const { company } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [saving, setSaving] = useState(false);
  const [selectedPref, setSelectedPref] = useState<string>('');
  const [saved, setSaved] = useState(false);

  if (!company) {
    return (
      <Layout>
        <CompanyMissing />
      </Layout>
    );
  }

  const currentPref = (company as any).preferredOrderType || '';
  const displayPref = selectedPref || currentPref;

  const allowedDays: string[] = Array.isArray(company.allowedOrderDays)
    ? (company.allowedOrderDays as any[]).map(String)
    : [];

  const fullAddress = [
    company.addressStreet && `${company.addressStreet}${company.addressNumber ? ", " + company.addressNumber : ""}`,
    company.addressNeighborhood,
    company.addressCity,
    company.addressZip,
  ].filter(Boolean).join(" — ");

  const handleSavePref = async () => {
    if (!selectedPref || selectedPref === currentPref) return;
    setSaving(true);
    try {
      const res = await fetch('/api/companies/my/preferred-order-type', {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ preferredOrderType: selectedPref }),
      });
      if (!res.ok) throw new Error('Erro ao salvar');
      toast({ title: 'Preferência salva!', description: `Tipo de pedido preferido: ${PREFERRED_ORDER_TYPE_INFO[selectedPref]?.label}` });
      setSaved(true);
      queryClient.invalidateQueries({ queryKey: ['/api/auth/me'] });
      setTimeout(() => setSaved(false), 3000);
    } catch {
      toast({ title: 'Erro ao salvar preferência', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Layout>
      <div className="max-w-2xl mx-auto space-y-6">
        {/* Header */}
        <div className="bg-gradient-to-r from-primary to-primary/80 rounded-3xl p-8 text-primary-foreground shadow-xl shadow-primary/20 relative overflow-hidden">
          <div className="absolute top-0 right-0 w-48 h-48 bg-white/10 rounded-full blur-3xl" />
          <div className="relative z-10 flex items-center gap-5">
            <div className="w-16 h-16 rounded-2xl bg-white/20 flex items-center justify-center flex-shrink-0">
              <Building2 className="w-9 h-9 text-white" />
            </div>
            <div>
              <h1 className="text-2xl font-display font-extrabold">{company.companyName}</h1>
              <p className="text-primary-foreground/80 text-sm font-medium mt-0.5">{company.email}</p>
              <span className={`inline-block mt-2 text-xs px-2.5 py-1 rounded-full font-bold ${company.active ? 'bg-white/20 text-white' : 'bg-red-200/30 text-red-100'}`}>
                {company.active ? "Cliente Ativo" : "Conta Inativa"}
              </span>
            </div>
          </div>
        </div>

        {/* Dados de contato */}
        <div className="bg-card rounded-2xl border border-border/50 premium-shadow p-6">
          <h2 className="font-bold text-lg text-foreground mb-4 flex items-center gap-2">
            <User className="w-5 h-5 text-primary" /> Dados de Contato
          </h2>
          <div className="divide-y divide-border/40">
            <InfoRow label="Responsável" value={company.contactName} icon={User} />
            <InfoRow label="E-mail principal" value={company.email} icon={Mail} />
            {company.notificationEmail && (
              <InfoRow label="E-mail de notificações" value={company.notificationEmail} icon={Mail} />
            )}
            <InfoRow label="Telefone" value={company.phone} icon={Phone} />
            <InfoRow label="CNPJ" value={company.cnpj} icon={CreditCard} />
          </div>
        </div>

        {/* Endereço */}
        {fullAddress && (
          <div className="bg-card rounded-2xl border border-border/50 premium-shadow p-6">
            <h2 className="font-bold text-lg text-foreground mb-4 flex items-center gap-2">
              <MapPin className="w-5 h-5 text-primary" /> Endereço de Entrega
            </h2>
            <div className="flex items-start gap-3 py-2">
              <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
                <MapPin className="w-4 h-4 text-primary" />
              </div>
              <p className="text-sm font-medium text-foreground mt-1">{fullAddress}</p>
            </div>
          </div>
        )}

        {/* Preferência de Frequência de Pedidos */}
        <div className="bg-card rounded-2xl border border-border/50 premium-shadow p-6">
          <h2 className="font-bold text-lg text-foreground mb-2 flex items-center gap-2">
            <RefreshCw className="w-5 h-5 text-primary" /> Frequência de Pedidos
          </h2>
          <p className="text-sm text-muted-foreground mb-4">
            Selecione como prefere realizar seus pedidos. Sua preferência será considerada pela equipe VivaFrutaz.
          </p>

          <div className="grid grid-cols-3 gap-3 mb-4">
            {(['semanal', 'mensal', 'pontual'] as const).map(type => {
              const info = PREFERRED_ORDER_TYPE_INFO[type];
              const isSelected = displayPref === type;
              return (
                <button key={type} type="button" onClick={() => setSelectedPref(type)}
                  data-testid={`pref-order-${type}`}
                  className={`p-3 rounded-xl border-2 text-left transition-all ${isSelected ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/40'}`}>
                  <p className={`font-bold text-sm mb-0.5 ${isSelected ? 'text-primary' : 'text-foreground'}`}>{info.label}</p>
                  <p className="text-xs text-muted-foreground leading-relaxed">{info.description}</p>
                  {isSelected && <div className="mt-2 flex items-center gap-1 text-primary text-xs font-bold"><CheckCircle className="w-3.5 h-3.5" /> Selecionado</div>}
                </button>
              );
            })}
          </div>

          {currentPref && !selectedPref && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground mb-3">
              <CheckCircle className="w-3.5 h-3.5 text-green-500" />
              Preferência atual: <strong className="text-foreground">{PREFERRED_ORDER_TYPE_INFO[currentPref]?.label || currentPref}</strong>
            </div>
          )}

          {selectedPref && selectedPref !== currentPref && (
            <button type="button" onClick={handleSavePref} disabled={saving}
              data-testid="button-save-order-pref"
              className="w-full py-2.5 bg-primary text-primary-foreground rounded-xl font-bold text-sm hover:bg-primary/90 transition-colors disabled:opacity-50 flex items-center justify-center gap-2">
              {saving ? <><RefreshCw className="w-4 h-4 animate-spin" /> Salvando...</> : saved ? <><CheckCircle className="w-4 h-4" /> Salvo!</> : 'Salvar preferência'}
            </button>
          )}
          {(!selectedPref || selectedPref === currentPref) && (
            <p className="text-xs text-center text-muted-foreground mt-1">
              {currentPref ? 'Clique em uma opção para alterar sua preferência.' : 'Selecione sua preferência acima e clique em Salvar.'}
            </p>
          )}
        </div>

        {/* Configuração de pedidos */}
        <div className="bg-card rounded-2xl border border-border/50 premium-shadow p-6">
          <h2 className="font-bold text-lg text-foreground mb-4 flex items-center gap-2">
            <Calendar className="w-5 h-5 text-primary" /> Configuração de Pedidos
          </h2>
          <div className="divide-y divide-border/40">
            <InfoRow
              label="Tipo de cliente"
              value={CLIENT_TYPE_LABEL[company.clientType || ""] || company.clientType || undefined}
              icon={Tag}
            />
            <InfoRow label="Horário de entrega" value={company.deliveryTime} icon={Clock} />
            {allowedDays.length > 0 && (
              <div className="py-3 flex items-start gap-3">
                <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0 mt-0.5">
                  <Calendar className="w-4 h-4 text-primary" />
                </div>
                <div>
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">Dias de entrega</p>
                  <div className="flex flex-wrap gap-1.5">
                    {allowedDays.map(d => (
                      <span key={d} className="px-2.5 py-1 bg-primary/10 text-primary rounded-lg text-xs font-bold">{d}</span>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Financeiro */}
        {(company.billingTerm || company.billingType || company.billingFormat || company.paymentDates) && (
          <div className="bg-card rounded-2xl border border-border/50 premium-shadow p-6">
            <h2 className="font-bold text-lg text-foreground mb-4 flex items-center gap-2">
              <CreditCard className="w-5 h-5 text-primary" /> Informações Financeiras
            </h2>
            <div className="divide-y divide-border/40">
              <InfoRow label="Prazo de pagamento" value={company.billingTerm} icon={Calendar} />
              <InfoRow label="Tipo de cobrança" value={company.billingType} icon={CreditCard} />
              <InfoRow label="Formato de cobrança" value={company.billingFormat} icon={CreditCard} />
              <InfoRow label="Datas de pagamento" value={company.paymentDates} icon={Calendar} />
              {company.financialNotes && (
                <div className="py-3">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">Observações financeiras</p>
                  <p className="text-sm text-foreground">{company.financialNotes}</p>
                </div>
              )}
            </div>
          </div>
        )}

        <div className="p-4 bg-muted/30 rounded-2xl text-center">
          <p className="text-xs text-muted-foreground">
            Para atualizar seus dados cadastrais, entre em contato com a equipe VivaFrutaz.
          </p>
        </div>
      </div>
    </Layout>
  );
}
