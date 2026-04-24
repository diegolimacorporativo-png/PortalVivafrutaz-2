import { useState } from "react";
import { useAuth } from "@/hooks/use-auth";
import { useActiveOrderWindow, useCompanyOrders } from "@/hooks/use-ordering";
import { Layout } from "@/components/Layout";
import { Link, useLocation } from "wouter";
import { ShoppingCart, History, AlertCircle, CheckCircle2, Info, Clock, AlertTriangle, Wrench, FlaskConical, Megaphone, X, Truck, FileText } from "lucide-react";
import { FruitCuriosities } from "@/components/FruitCuriosities";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { useQuery } from "@tanstack/react-query";

const DAY_MAP: Record<string, string> = {
  "Segunda-feira": "Segunda-feira", "Terça-feira": "Terça-feira",
  "Quarta-feira": "Quarta-feira", "Quinta-feira": "Quinta-feira",
  "Sexta-feira": "Sexta-feira",
  "Monday": "Segunda-feira", "Tuesday": "Terça-feira", "Wednesday": "Quarta-feira",
  "Thursday": "Quinta-feira", "Friday": "Sexta-feira",
};

type Announcement = {
  id: number;
  title: string;
  message: string;
  type: string;
  priority: string;
  startDate: string;
  endDate: string;
};

const TYPE_STYLE: Record<string, { border: string; bg: string; icon: typeof Info; iconColor: string; titleColor: string; msgColor: string }> = {
  info: {
    border: "border-blue-200", bg: "bg-blue-50",
    icon: Info, iconColor: "text-blue-600", titleColor: "text-blue-800", msgColor: "text-blue-700",
  },
  important: {
    border: "border-orange-200", bg: "bg-orange-50",
    icon: AlertTriangle, iconColor: "text-orange-600", titleColor: "text-orange-800", msgColor: "text-orange-700",
  },
  maintenance: {
    border: "border-red-200", bg: "bg-red-50",
    icon: Wrench, iconColor: "text-red-600", titleColor: "text-red-800", msgColor: "text-red-700",
  },
  logistics: {
    border: "border-purple-200", bg: "bg-purple-50",
    icon: Truck, iconColor: "text-purple-600", titleColor: "text-purple-800", msgColor: "text-purple-700",
  },
};

const TYPE_LABELS: Record<string, string> = {
  info: "Informativo", important: "Importante", maintenance: "Manutenção", logistics: "Comunicado Logístico",
};

function AnnouncementBanners({ companyId }: { companyId: number }) {
  const [dismissed, setDismissed] = useState<Set<number>>(() => {
    try {
      const stored = localStorage.getItem('vf_dismissed_announcements');
      return new Set(stored ? JSON.parse(stored) : []);
    } catch { return new Set(); }
  });

  const { data: announcements = [] } = useQuery<Announcement[]>({
    queryKey: ['/api/announcements/active', companyId],
    queryFn: async () => {
      const res = await fetch('/api/announcements/active', { credentials: 'include' });
      if (!res.ok) return [];
      return res.json();
    },
    staleTime: 60000,
  });

  const visible = announcements.filter(a => !dismissed.has(a.id));
  if (visible.length === 0) return null;

  const dismiss = (id: number) => {
    const next = new Set(dismissed).add(id);
    setDismissed(next);
    localStorage.setItem('vf_dismissed_announcements', JSON.stringify([...next]));
  };

  return (
    <div className="space-y-3">
      {visible.map(a => {
        const s = TYPE_STYLE[a.type] || TYPE_STYLE.info;
        const Icon = s.icon;
        const isHigh = a.priority === 'high';
        return (
          <div key={a.id} data-testid={`announcement-banner-${a.id}`}
            className={`relative rounded-2xl border-2 p-4 sm:p-5 ${s.bg} ${isHigh ? 'border-orange-400' : s.border}`}>
            {isHigh && (
              <div className="absolute -top-2 left-4">
                <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-red-600 text-white shadow-sm">
                  🔴 Alta Prioridade
                </span>
              </div>
            )}
            <div className="flex items-start gap-3.5">
              <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 mt-0.5 ${s.bg} border ${s.border}`}>
                <Icon className={`w-5 h-5 ${s.iconColor}`} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center flex-wrap gap-2 mb-1">
                  <span className={`text-xs font-bold uppercase tracking-wider ${s.titleColor} opacity-70`}>
                    Aviso VivaFrutaz · {TYPE_LABELS[a.type] || a.type}
                  </span>
                </div>
                <p className={`font-bold text-base ${s.titleColor} mb-1`}>{a.title}</p>
                <p className={`text-sm leading-relaxed ${s.msgColor}`}>{a.message}</p>
              </div>
              <button
                data-testid={`button-dismiss-announcement-${a.id}`}
                onClick={() => dismiss(a.id)}
                className={`p-1.5 rounded-lg hover:bg-black/10 transition-colors flex-shrink-0 ${s.iconColor}`}
                title="Dispensar aviso">
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function CompanyMissing() {
  return (
    <Layout>
      <div className="flex flex-col items-center justify-center py-24 text-center">
        <div className="w-16 h-16 rounded-2xl bg-orange-100 flex items-center justify-center mb-4">
          <AlertCircle className="w-8 h-8 text-orange-500" />
        </div>
        <h2 className="text-xl font-bold text-foreground mb-2">Dados da empresa não encontrados.</h2>
        <p className="text-muted-foreground text-sm max-w-sm">Não foi possível carregar as informações da sua empresa. Entre em contato com a equipe VivaFrutaz.</p>
      </div>
    </Layout>
  );
}

export default function ClientDashboard() {
  const { company, isLoading } = useAuth();
  const { data: activeWindow } = useActiveOrderWindow();
  const { data: orders } = useCompanyOrders(company?.id);
  const [, setLocation] = useLocation();

  const { data: testModeData } = useQuery<{ enabled: boolean }>({
    queryKey: ['/api/settings/test-mode'],
    staleTime: 0,
    refetchOnMount: true,
  });
  const testModeActive = testModeData?.enabled === true;

  if (!isLoading && !company) return <CompanyMissing />;

  const isFirstOrder = !orders || orders.length === 0;

  const getAllowedDays = (): string[] => {
    const days = company?.allowedOrderDays;
    if (!days) return [];
    if (Array.isArray(days)) return (days as any[]).map(d => DAY_MAP[String(d)] || String(d));
    return [];
  };

  const allowedDays = getAllowedDays();
  const handleDayClick = (day: string) => setLocation(`/client/order?day=${encodeURIComponent(day)}`);

  return (
    <Layout>
      <div className="space-y-6">
        {/* Welcome header */}
        <div className="bg-gradient-to-r from-primary to-primary/80 rounded-3xl p-8 sm:p-10 text-primary-foreground shadow-xl shadow-primary/20 relative overflow-hidden">
          <div className="absolute top-0 right-0 w-64 h-64 bg-white/10 rounded-full blur-3xl" />
          <div className="absolute bottom-[-10%] left-[10%] w-48 h-48 bg-black/10 rounded-full blur-2xl" />

          <div className="relative z-10">
            <h1 className="text-3xl sm:text-4xl font-display font-extrabold tracking-tight">
              Olá, {company?.contactName}!
            </h1>
            <p className="mt-2 text-lg text-primary-foreground/90 font-medium">
              Bem-vindo ao portal da VivaFrutaz.
              {isFirstOrder ? " Vamos criar seu primeiro pedido de frutas!" : " Vamos reabastecer seu estoque de frutas."}
            </p>

            <div className="mt-6 flex flex-col sm:flex-row gap-3">
              {company?.clientType === 'contratual' ? (
                <Link href="/client/contract-scope"
                  data-testid="link-contract-scope"
                  className="inline-flex items-center justify-center gap-2 px-6 py-3.5 bg-white text-primary font-bold rounded-xl shadow-lg hover:shadow-xl hover:-translate-y-1 transition-all">
                  <FileText className="w-5 h-5" /> Meu Escopo Contratual
                </Link>
              ) : testModeActive ? (
                <div className="inline-flex items-center gap-2 px-6 py-3.5 bg-amber-100/80 text-amber-800 font-bold rounded-xl border-2 border-amber-300 cursor-not-allowed opacity-80"
                  data-testid="button-new-order-blocked-test">
                  <FlaskConical className="w-5 h-5" /> Pedidos Bloqueados (Modo Teste)
                </div>
              ) : (
                <Link href="/client/order"
                  data-testid="link-new-order"
                  className="inline-flex items-center justify-center gap-2 px-6 py-3.5 bg-white text-primary font-bold rounded-xl shadow-lg hover:shadow-xl hover:-translate-y-1 transition-all">
                  <ShoppingCart className="w-5 h-5" /> Novo Pedido
                </Link>
              )}
              {company?.clientType !== 'contratual' && (
                <Link href="/client/history" className="inline-flex items-center justify-center gap-2 px-6 py-3.5 bg-primary-foreground/10 hover:bg-primary-foreground/20 text-white font-bold rounded-xl transition-all">
                  <History className="w-5 h-5" /> Meus Pedidos
                </Link>
              )}
              {company?.clientType === 'contratual' && (
                <Link href="/client/history" className="inline-flex items-center justify-center gap-2 px-6 py-3.5 bg-primary-foreground/10 hover:bg-primary-foreground/20 text-white font-bold rounded-xl transition-all">
                  <History className="w-5 h-5" /> Histórico
                </Link>
              )}
            </div>

            {testModeActive && company?.clientType !== 'contratual' && (
              <div className="mt-3 flex items-center gap-2 text-amber-200 text-xs font-medium">
                <FlaskConical className="w-3.5 h-3.5 flex-shrink-0" />
                Sistema em modo teste. Criação de pedidos temporariamente bloqueada.
              </div>
            )}
            {company?.clientType === 'contratual' && (
              <div className="mt-3 flex items-center gap-2 text-primary-foreground/70 text-xs font-medium">
                <FileText className="w-3.5 h-3.5 flex-shrink-0" />
                Seus pedidos são gerados automaticamente conforme o escopo contratual.
              </div>
            )}
          </div>
        </div>

        {/* ── Announcements banners ── */}
        {company?.id && <AnnouncementBanners companyId={company.id} />}

        {/* Institutional message — MISSÃO VIVAFRUTAZ */}
        <div className="bg-gradient-to-br from-green-50 via-emerald-50 to-green-50 border border-green-100 rounded-2xl p-6 flex items-start gap-4">
          <div className="w-12 h-12 rounded-2xl bg-primary/10 flex items-center justify-center flex-shrink-0 mt-0.5 text-2xl">🍊</div>
          <div>
            <p className="font-bold text-green-800 text-base mb-2 tracking-wide uppercase text-sm">Missão VivaFrutaz</p>
            <p className="text-sm text-green-800 font-medium leading-relaxed mb-2">
              Garantir a total satisfação de nossos clientes, prestando um serviço de altíssimo nível e oferecendo produtos de qualidade.
            </p>
            <p className="text-sm text-green-700 leading-relaxed">
              Na VivaFrutaz acreditamos que frutas frescas fazem parte de um ambiente de trabalho saudável e produtivo.
            </p>
          </div>
        </div>

        {/* Fruit Curiosities */}
        <FruitCuriosities />

        {/* Operational notices */}
        <div className="bg-card rounded-2xl border border-border/50 premium-shadow p-5">
          <div className="flex items-center gap-2 mb-3">
            <Info className="w-5 h-5 text-primary flex-shrink-0" />
            <h2 className="font-bold text-foreground">Informações Operacionais</h2>
          </div>
          <div className="space-y-2">
            <div className="flex items-start gap-2 p-3 bg-muted/40 rounded-xl">
              <CheckCircle2 className="w-4 h-4 text-primary flex-shrink-0 mt-0.5" />
              <p className="text-sm text-foreground">
                Pedido será fornecido conforme planilha preenchida. Favor atenção aos tipos de embalagens.
              </p>
            </div>
            <div className="flex items-start gap-2 p-3 bg-orange-50 border border-orange-100 rounded-xl">
              <AlertTriangle className="w-4 h-4 text-orange-600 flex-shrink-0 mt-0.5" />
              <p className="text-sm text-orange-800">
                <strong>Prazo para cancelamento ou redução de pedido:</strong> 2 dias úteis de antecedência, até às 09:00.
              </p>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          {/* Order window status */}
          <div className="bg-card rounded-2xl p-6 border border-border/50 premium-shadow">
            <h2 className="text-lg font-bold text-foreground mb-4 flex items-center gap-2">
              <Clock className="w-5 h-5 text-primary" /> Status do Pedido
            </h2>

            {activeWindow ? (
              <div className="space-y-3">
                <div className="p-3 rounded-xl bg-green-50 border border-green-200">
                  <p className="text-green-800 font-bold flex items-center gap-2 text-sm">
                    <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
                    Pedidos ABERTOS — {activeWindow.weekReference}
                  </p>
                </div>
                <div>
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-0.5">Prazo para Pedidos</p>
                  <p className="text-base font-bold text-foreground">{format(new Date(activeWindow.orderCloseDate), "EEEE, d 'de' MMMM 'às' HH:mm", { locale: ptBR })}</p>
                </div>
                <div>
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-0.5">Período de Entregas</p>
                  <p className="text-base font-bold text-foreground">
                    {format(new Date(activeWindow.deliveryStartDate), "d 'de' MMM", { locale: ptBR })} – {format(new Date(activeWindow.deliveryEndDate), "d 'de' MMM", { locale: ptBR })}
                  </p>
                </div>
              </div>
            ) : (
              <div className="p-5 rounded-xl bg-muted/50 border border-border/50 text-center">
                <AlertCircle className="w-8 h-8 text-muted-foreground mx-auto mb-2" />
                <p className="font-bold text-muted-foreground">Prazo de pedidos encerrado.</p>
                <p className="text-sm text-muted-foreground mt-1">Aguarde a abertura da próxima janela.</p>
              </div>
            )}
          </div>

          {/* Delivery day buttons */}
          <div className="bg-card rounded-2xl p-6 border border-border/50 premium-shadow">
            <h2 className="text-lg font-bold text-foreground mb-1 flex items-center gap-2">
              <ShoppingCart className="w-5 h-5 text-primary" /> Seus Dias de Entrega
            </h2>
            <p className="text-xs text-muted-foreground mb-4">Clique em um dia para iniciar o pedido.</p>

            {allowedDays.length === 0 ? (
              <p className="text-muted-foreground text-sm">Nenhum dia de entrega configurado. Contate o administrador.</p>
            ) : (
              <>
                {testModeActive && (
                  <div className="mb-3 flex items-center gap-2 p-3 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-700 font-medium">
                    <FlaskConical className="w-4 h-4 flex-shrink-0" />
                    Sistema em modo teste. Criação de pedidos bloqueada.
                  </div>
                )}
                <div className="flex flex-col gap-2.5">
                  {allowedDays.map(day => (
                    <button
                      key={day}
                      data-testid={`button-day-${day}`}
                      onClick={() => !testModeActive && handleDayClick(day)}
                      disabled={!activeWindow || testModeActive}
                      className="w-full flex items-center justify-between px-5 py-3.5 bg-primary/10 hover:bg-primary text-primary hover:text-white font-bold rounded-xl transition-all duration-200 group disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <span>{day}</span>
                      {testModeActive
                        ? <FlaskConical className="w-4 h-4 opacity-60" />
                        : <ShoppingCart className="w-4 h-4 opacity-60 group-hover:opacity-100 transition-opacity" />
                      }
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </Layout>
  );
}
