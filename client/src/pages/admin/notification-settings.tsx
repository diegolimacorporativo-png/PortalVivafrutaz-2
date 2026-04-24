import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Bell, BellOff, Smartphone, Send, CheckCircle2, XCircle, Loader2, Users, Info } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { usePushNotifications } from "@/hooks/use-push-notifications";
import { apiRequest } from "@/lib/queryClient";

interface NotificationSetting {
  id: number;
  event: string;
  enabled: boolean;
  title: string;
  body: string;
  targetAudience: string;
  updatedAt: string;
}

const EVENT_LABELS: Record<string, { label: string; description: string; icon: string }> = {
  order_created:   { label: "Novo pedido recebido",      description: "Quando um cliente cria um novo pedido",                  icon: "🛒" },
  order_cancelled: { label: "Pedido cancelado",           description: "Quando um pedido é cancelado",                          icon: "❌" },
  order_updated:   { label: "Pedido atualizado",          description: "Quando o status de um pedido muda",                     icon: "📝" },
  client_inactive: { label: "Cliente sem pedidos",        description: "Quando um cliente fica sem pedidos por muitos dias",    icon: "⚠️" },
  low_stock:       { label: "Estoque baixo",              description: "Quando o estoque de um produto fica crítico",           icon: "📦" },
  clara_task:      { label: "Nova tarefa da Clara IA",    description: "Quando a Clara cria uma tarefa automaticamente",        icon: "🌿" },
  clara_alert:     { label: "Alerta inteligente da Clara", description: "Alertas gerados pela Clara IA sobre o negócio",       icon: "🤖" },
};

export default function AdminNotificationSettings() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const push = usePushNotifications();
  const [testLoading, setTestLoading] = useState(false);

  const { data, isLoading } = useQuery<{ settings: NotificationSetting[]; subscriberCount: number }>({
    queryKey: ["/api/push/settings"],
  });

  const toggleMutation = useMutation({
    mutationFn: ({ event, enabled }: { event: string; enabled: boolean }) =>
      apiRequest("PATCH", `/api/push/settings/${event}`, { enabled }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/api/push/settings"] }),
    onError: () => toast({ title: "Erro ao salvar configuração", variant: "destructive" }),
  });

  const handleSubscribe = async () => {
    const ok = await push.subscribe();
    if (ok) {
      toast({ title: "✅ Notificações ativadas!", description: "Você receberá alertas neste dispositivo." });
    } else if (push.permission === "denied") {
      toast({ title: "Permissão negada", description: "Ative as notificações nas configurações do navegador.", variant: "destructive" });
    }
  };

  const handleUnsubscribe = async () => {
    await push.unsubscribe();
    toast({ title: "Notificações desativadas", description: "Este dispositivo não receberá mais alertas." });
  };

  const handleTest = async () => {
    setTestLoading(true);
    try {
      await apiRequest("POST", "/api/push/test", {});
      toast({ title: "🔔 Notificação de teste enviada!", description: "Verifique os dispositivos cadastrados." });
    } catch {
      toast({ title: "Erro ao enviar teste", variant: "destructive" });
    } finally {
      setTestLoading(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const settings = data?.settings || [];
  const subscriberCount = data?.subscriberCount || 0;

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-foreground">Notificações Push</h1>
        <p className="text-muted-foreground mt-1">Configure alertas em tempo real para celular e desktop.</p>
      </div>

      {/* Device subscription card */}
      <div className="bg-card rounded-2xl border border-border p-6 space-y-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
            <Smartphone className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h2 className="font-bold text-foreground">Este Dispositivo</h2>
            <p className="text-sm text-muted-foreground">Receba notificações neste navegador/celular</p>
          </div>
        </div>

        {!push.isSupported ? (
          <div className="flex items-center gap-2 text-sm text-amber-600 bg-amber-50 dark:bg-amber-900/20 rounded-xl p-3">
            <Info className="w-4 h-4 flex-shrink-0" />
            <span>Notificações push não são suportadas neste navegador. No iPhone, instale o app na tela inicial primeiro.</span>
          </div>
        ) : push.permission === "denied" ? (
          <div className="flex items-center gap-2 text-sm text-red-600 bg-red-50 dark:bg-red-900/20 rounded-xl p-3">
            <XCircle className="w-4 h-4 flex-shrink-0" />
            <span>Permissão negada. Para ativar, acesse as configurações do seu navegador e permita notificações para este site.</span>
          </div>
        ) : push.isSubscribed ? (
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm text-green-700 bg-green-50 dark:bg-green-900/20 rounded-xl px-3 py-2">
              <CheckCircle2 className="w-4 h-4" />
              <span>Notificações ativas neste dispositivo</span>
            </div>
            <button
              onClick={handleUnsubscribe}
              disabled={push.isLoading}
              data-testid="button-unsubscribe-push"
              className="px-4 py-2 text-sm font-medium text-destructive border border-destructive/30 rounded-xl hover:bg-destructive/10 transition-colors"
            >
              Desativar
            </button>
          </div>
        ) : (
          <button
            onClick={handleSubscribe}
            disabled={push.isLoading}
            data-testid="button-subscribe-push"
            className="flex items-center gap-2 px-5 py-2.5 bg-primary text-primary-foreground rounded-xl text-sm font-semibold hover:bg-primary/90 transition-colors disabled:opacity-50"
          >
            {push.isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Bell className="w-4 h-4" />}
            Ativar Notificações Neste Dispositivo
          </button>
        )}
      </div>

      {/* Stats + test */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="bg-card rounded-2xl border border-border p-5 flex items-center gap-4">
          <div className="w-12 h-12 rounded-xl bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center">
            <Users className="w-6 h-6 text-blue-600" />
          </div>
          <div>
            <p className="text-2xl font-bold text-foreground">{subscriberCount}</p>
            <p className="text-sm text-muted-foreground">Dispositivos cadastrados</p>
          </div>
        </div>
        <div className="bg-card rounded-2xl border border-border p-5 flex items-center justify-between">
          <div>
            <p className="font-semibold text-foreground">Teste de Notificação</p>
            <p className="text-sm text-muted-foreground">Envia alerta para todos os dispositivos</p>
          </div>
          <button
            onClick={handleTest}
            disabled={testLoading}
            data-testid="button-test-push"
            className="flex items-center gap-2 px-4 py-2.5 bg-primary text-primary-foreground rounded-xl text-sm font-semibold hover:bg-primary/90 transition-colors disabled:opacity-50"
          >
            {testLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            Enviar Teste
          </button>
        </div>
      </div>

      {/* Event settings */}
      <div>
        <h2 className="font-bold text-foreground mb-3">Eventos de Notificação</h2>
        <div className="space-y-3">
          {settings.map((setting) => {
            const meta = EVENT_LABELS[setting.event];
            if (!meta) return null;
            return (
              <div
                key={setting.event}
                className="bg-card rounded-2xl border border-border p-4 flex items-center gap-4"
                data-testid={`card-notif-${setting.event}`}
              >
                <span className="text-2xl flex-shrink-0">{meta.icon}</span>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-foreground text-sm">{meta.label}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{meta.description}</p>
                  <div className="mt-2 space-y-0.5">
                    <p className="text-xs text-muted-foreground/70 font-mono truncate">
                      <span className="font-semibold not-italic text-foreground/50">Título:</span> {setting.title}
                    </p>
                    <p className="text-xs text-muted-foreground/70 font-mono truncate">
                      <span className="font-semibold not-italic text-foreground/50">Mensagem:</span> {setting.body}
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => toggleMutation.mutate({ event: setting.event, enabled: !setting.enabled })}
                  disabled={toggleMutation.isPending}
                  data-testid={`toggle-notif-${setting.event}`}
                  className={`relative w-12 h-6 rounded-full transition-colors flex-shrink-0 ${
                    setting.enabled ? "bg-primary" : "bg-muted"
                  }`}
                >
                  <span
                    className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${
                      setting.enabled ? "translate-x-6" : "translate-x-0"
                    }`}
                  />
                </button>
              </div>
            );
          })}
        </div>
      </div>

      {/* iOS note */}
      <div className="rounded-2xl bg-muted/40 border border-border p-4 flex gap-3">
        <Info className="w-5 h-5 text-muted-foreground flex-shrink-0 mt-0.5" />
        <div className="text-sm text-muted-foreground space-y-1">
          <p className="font-semibold text-foreground">Compatibilidade</p>
          <p><strong>Android:</strong> Funciona em todos os navegadores modernos (Chrome, Firefox, Edge).</p>
          <p><strong>iPhone/iPad:</strong> Exige iOS 16.4+ e o app deve estar instalado na tela inicial via Safari.</p>
          <p><strong>Desktop:</strong> Funciona em Chrome, Edge e Firefox com notificações do sistema operacional.</p>
        </div>
      </div>
    </div>
  );
}
