import { useAuth } from "@/hooks/use-auth";
import { useQuery } from "@tanstack/react-query";
import { Layout } from "@/components/Layout";
import { AlertCircle, FileText, Tag, Calendar, CheckCircle2, Info, Package } from "lucide-react";

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

const STATUS_LABEL: Record<string, string> = {
  PENDING: "Aguardando análise",
  IN_ANALYSIS: "Em análise",
  APPROVED: "Aprovada",
  REJECTED: "Não aprovada",
};

const STATUS_STYLE: Record<string, string> = {
  PENDING: "bg-yellow-100 text-yellow-800",
  IN_ANALYSIS: "bg-blue-100 text-blue-800",
  APPROVED: "bg-green-100 text-green-800",
  REJECTED: "bg-red-100 text-red-800",
};

type PriceGroup = { id: number; name: string; description?: string };

export default function ClientQuotations() {
  const { company } = useAuth();

  const { data: priceGroups } = useQuery<PriceGroup[]>({
    queryKey: ['/api/price-groups'],
    enabled: !!company,
  });

  const { data: orderWindows } = useQuery<any[]>({
    queryKey: ['/api/order-windows'],
    enabled: !!company,
  });

  if (!company) {
    return (
      <Layout>
        <CompanyMissing />
      </Layout>
    );
  }

  const myPriceGroup = priceGroups?.find(g => g.id === company.priceGroupId);
  const allowedDays: string[] = Array.isArray(company.allowedOrderDays)
    ? (company.allowedOrderDays as any[]).map(String)
    : [];

  const activeWindow = orderWindows?.find((w: any) => w.active);

  return (
    <Layout>
      <div className="max-w-2xl mx-auto space-y-6">

        {/* Header */}
        <div className="bg-gradient-to-r from-primary to-primary/80 rounded-3xl p-8 text-primary-foreground shadow-xl shadow-primary/20 relative overflow-hidden">
          <div className="absolute top-0 right-0 w-48 h-48 bg-white/10 rounded-full blur-3xl" />
          <div className="relative z-10">
            <div className="flex items-center gap-3 mb-3">
              <FileText className="w-7 h-7 text-white/80" />
              <h1 className="text-2xl font-display font-extrabold">Cotações e Preços</h1>
            </div>
            <p className="text-primary-foreground/80 text-sm leading-relaxed">
              Informações sobre sua política de preços e condições comerciais com a VivaFrutaz.
            </p>
          </div>
        </div>

        {/* Política de preços */}
        <div className="bg-card rounded-2xl border border-border/50 premium-shadow p-6">
          <h2 className="font-bold text-lg text-foreground mb-5 flex items-center gap-2">
            <Tag className="w-5 h-5 text-primary" /> Sua Política de Preços
          </h2>

          <div className="space-y-4">
            <div className="p-4 rounded-xl bg-primary/5 border border-primary/20 flex items-start gap-3">
              <CheckCircle2 className="w-5 h-5 text-primary flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-0.5">Grupo de preço</p>
                <p className="font-bold text-foreground text-base">
                  {myPriceGroup?.name || "Sem grupo de preço atribuído"}
                </p>
                {myPriceGroup?.description && (
                  <p className="text-sm text-muted-foreground mt-1">{myPriceGroup.description}</p>
                )}
              </div>
            </div>

            <div className="p-4 rounded-xl bg-muted/30 border border-border/50 flex items-start gap-3">
              <Package className="w-5 h-5 text-muted-foreground flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-0.5">Tipo de cliente</p>
                <p className="font-bold text-foreground capitalize">{company.clientType || "Padrão"}</p>
              </div>
            </div>

            {allowedDays.length > 0 && (
              <div className="p-4 rounded-xl bg-muted/30 border border-border/50 flex items-start gap-3">
                <Calendar className="w-5 h-5 text-muted-foreground flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Dias de entrega contratados</p>
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

        {/* Janela de pedido ativa */}
        <div className="bg-card rounded-2xl border border-border/50 premium-shadow p-6">
          <h2 className="font-bold text-lg text-foreground mb-4 flex items-center gap-2">
            <Calendar className="w-5 h-5 text-primary" /> Janela de Pedido Atual
          </h2>
          {activeWindow ? (
            <div className="space-y-3">
              <div className="flex items-center justify-between p-3 bg-green-50 border border-green-200 rounded-xl">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-green-600" />
                  <span className="text-sm font-bold text-green-800">Janela aberta</span>
                </div>
                <span className="text-xs font-semibold text-green-700 bg-green-100 px-2 py-0.5 rounded-full">Ativa</span>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="p-3 rounded-xl bg-muted/30 border border-border/40">
                  <p className="text-xs text-muted-foreground font-semibold mb-1">Abertura</p>
                  <p className="text-sm font-bold">{new Date(activeWindow.orderOpenDate).toLocaleDateString("pt-BR")}</p>
                </div>
                <div className="p-3 rounded-xl bg-muted/30 border border-border/40">
                  <p className="text-xs text-muted-foreground font-semibold mb-1">Fechamento</p>
                  <p className="text-sm font-bold">{new Date(activeWindow.orderCloseDate).toLocaleDateString("pt-BR")}</p>
                </div>
                <div className="p-3 rounded-xl bg-muted/30 border border-border/40">
                  <p className="text-xs text-muted-foreground font-semibold mb-1">Início das entregas</p>
                  <p className="text-sm font-bold">{new Date(activeWindow.deliveryStartDate).toLocaleDateString("pt-BR")}</p>
                </div>
                <div className="p-3 rounded-xl bg-muted/30 border border-border/40">
                  <p className="text-xs text-muted-foreground font-semibold mb-1">Fim das entregas</p>
                  <p className="text-sm font-bold">{new Date(activeWindow.deliveryEndDate).toLocaleDateString("pt-BR")}</p>
                </div>
              </div>
            </div>
          ) : (
            <div className="p-5 rounded-xl bg-muted/30 border border-border/50 text-center">
              <AlertCircle className="w-8 h-8 text-muted-foreground mx-auto mb-2" />
              <p className="text-sm font-bold text-muted-foreground">Nenhuma janela de pedido ativa no momento.</p>
              <p className="text-xs text-muted-foreground mt-1">Aguarde a abertura da próxima janela ou contate a VivaFrutaz.</p>
            </div>
          )}
        </div>

        {/* Info sobre revisão de preços */}
        <div className="p-5 bg-blue-50 border border-blue-200 rounded-2xl flex items-start gap-3">
          <Info className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />
          <div>
            <p className="font-bold text-blue-900 text-sm mb-1">Solicitar revisão de preços</p>
            <p className="text-sm text-blue-800 leading-relaxed">
              Para solicitar uma revisão de preços, renegociação de contrato ou inclusão de novos produtos, entre em contato com nossa equipe comercial diretamente pelo portal de ocorrências ou pelo assistente virtual.
            </p>
          </div>
        </div>

      </div>
    </Layout>
  );
}
