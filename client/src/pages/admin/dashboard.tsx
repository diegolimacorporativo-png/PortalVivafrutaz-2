import { useState, useMemo } from "react";
import { useAuth } from "@/hooks/use-auth";
import { useOrders } from "@/hooks/use-ordering";
import { useCompanies } from "@/hooks/use-admin";
import { Layout } from "@/components/Layout";
import { ShoppingCart, Users, TrendingUp, Package, Wrench, CheckCircle2, AlertTriangle, FlaskConical, Shield, CalendarDays, Filter, ScrollText } from "lucide-react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";

/* ── Reusable visual toggle switch ──────────────────────────── */
function ToggleSwitch({
  enabled,
  onChange,
  disabled,
  colorOn = "bg-red-500",
}: {
  enabled: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
  colorOn?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={enabled}
      disabled={disabled}
      onClick={() => onChange(!enabled)}
      className={`relative inline-flex h-7 w-14 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed ${
        enabled ? colorOn : "bg-muted"
      }`}
    >
      <span
        className={`pointer-events-none inline-block h-6 w-6 transform rounded-full bg-white shadow-lg ring-0 transition duration-200 ease-in-out ${
          enabled ? "translate-x-7" : "translate-x-0"
        }`}
      />
    </button>
  );
}

/* ── Maintenance toggle card ─────────────────────────────────── */
function MaintenanceToggle() {
  const { data, isLoading } = useQuery<{ enabled: boolean }>({
    queryKey: ["/api/settings/maintenance"],
    staleTime: 0,
    refetchOnMount: true,
  });
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const toggle = useMutation({
    mutationFn: async (enable: boolean) => {
      const res = await fetch("/api/settings/maintenance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: enable }),
        credentials: "include",
      });
      if (!res.ok) throw new Error("Sem permissão");
      return res.json() as Promise<{ enabled: boolean }>;
    },
    onMutate: async (enable) => {
      await queryClient.cancelQueries({ queryKey: ["/api/settings/maintenance"] });
      const previous = queryClient.getQueryData(["/api/settings/maintenance"]);
      queryClient.setQueryData(["/api/settings/maintenance"], { enabled: enable });
      return { previous };
    },
    onError: (_err, _enable, context) => {
      if (context?.previous)
        queryClient.setQueryData(["/api/settings/maintenance"], context.previous);
      toast({ title: "Erro ao alterar modo manutenção", variant: "destructive" });
    },
    onSuccess: (data) => {
      queryClient.setQueryData(["/api/settings/maintenance"], data);
      queryClient.invalidateQueries({ queryKey: ["/api/settings/maintenance"] });
      toast({
        title: data.enabled
          ? "Modo manutenção ativado."
          : "Modo manutenção desativado.",
        variant: data.enabled ? "destructive" : "default",
      });
    },
  });

  const enabled = data?.enabled ?? false;

  return (
    <div
      className={`rounded-2xl border-2 p-5 transition-all premium-shadow ${
        enabled ? "bg-red-50 border-red-300 dark:bg-red-950/30 dark:border-red-700" : "bg-card border-border/50"
      }`}
    >
      {enabled && (
        <div className="mb-4 flex items-center gap-2 p-3 rounded-xl bg-red-100 border border-red-300 text-red-700 text-sm font-bold dark:bg-red-900/40 dark:border-red-700 dark:text-red-300">
          <AlertTriangle className="w-4 h-4 flex-shrink-0 animate-pulse" />
          Modo manutenção ativado — clientes não podem acessar o sistema.
        </div>
      )}

      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${enabled ? "bg-red-100 dark:bg-red-900/40" : "bg-muted"}`}>
            <Wrench className={`w-5 h-5 ${enabled ? "text-red-600" : "text-muted-foreground"}`} />
          </div>
          <div>
            <p className="font-bold text-sm text-foreground">Modo Manutenção</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              {enabled
                ? "Clientes bloqueados — sistema em manutenção"
                : "Sistema operando normalmente"}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-4">
          <span className={`text-xs font-bold ${enabled ? "text-red-600" : "text-muted-foreground"}`}>
            {enabled ? "LIGADO" : "DESLIGADO"}
          </span>
          <ToggleSwitch
            enabled={enabled}
            onChange={(v) => toggle.mutate(v)}
            disabled={toggle.isPending || isLoading}
            colorOn="bg-red-500"
          />
        </div>
      </div>

      <p className="mt-3 text-xs text-muted-foreground">
        {enabled
          ? "Para restaurar o acesso dos clientes, desligue este modo."
          : "Ao ligar, clientes perderão acesso temporariamente até a manutenção ser concluída."}
      </p>
    </div>
  );
}

/* ── Test mode toggle card ───────────────────────────────────── */
function TestModeToggle() {
  const { data, isLoading } = useQuery<{ enabled: boolean }>({
    queryKey: ["/api/settings/test-mode"],
    staleTime: 0,
    refetchOnMount: true,
  });
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const toggle = useMutation({
    mutationFn: async (enable: boolean) => {
      const res = await fetch("/api/settings/test-mode", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: enable }),
        credentials: "include",
      });
      if (!res.ok) throw new Error("Sem permissão");
      return res.json() as Promise<{ enabled: boolean }>;
    },
    onMutate: async (enable) => {
      await queryClient.cancelQueries({ queryKey: ["/api/settings/test-mode"] });
      const previous = queryClient.getQueryData(["/api/settings/test-mode"]);
      queryClient.setQueryData(["/api/settings/test-mode"], { enabled: enable });
      return { previous };
    },
    onError: (_err, _enable, context) => {
      if (context?.previous)
        queryClient.setQueryData(["/api/settings/test-mode"], context.previous);
      toast({ title: "Erro ao alterar modo teste", variant: "destructive" });
    },
    onSuccess: (data) => {
      queryClient.setQueryData(["/api/settings/test-mode"], data);
      queryClient.invalidateQueries({ queryKey: ["/api/settings/test-mode"] });
      toast({
        title: data.enabled
          ? "Modo Teste ativado."
          : "Modo Teste desativado.",
        variant: data.enabled ? "default" : "default",
      });
    },
  });

  const enabled = data?.enabled ?? false;

  return (
    <div
      className={`rounded-2xl border-2 p-5 transition-all premium-shadow ${
        enabled ? "bg-amber-50 border-amber-300 dark:bg-amber-950/30 dark:border-amber-700" : "bg-card border-border/50"
      }`}
    >
      {enabled && (
        <div className="mb-4 flex items-center gap-2 p-3 rounded-xl bg-amber-100 border border-amber-300 text-amber-800 text-sm font-bold dark:bg-amber-900/40 dark:border-amber-700 dark:text-amber-300">
          <FlaskConical className="w-4 h-4 flex-shrink-0 animate-pulse" />
          Modo Teste ativado — pedidos são salvos como TESTE e não afetam dados reais.
        </div>
      )}

      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${enabled ? "bg-amber-100 dark:bg-amber-900/40" : "bg-muted"}`}>
            <FlaskConical className={`w-5 h-5 ${enabled ? "text-amber-700" : "text-muted-foreground"}`} />
          </div>
          <div>
            <p className="font-bold text-sm text-foreground">Modo Teste</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              {enabled
                ? "Pedidos são salvos como TESTE — não afetam dados reais"
                : "Pedidos são processados normalmente"}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-4">
          <span className={`text-xs font-bold ${enabled ? "text-amber-700" : "text-muted-foreground"}`}>
            {enabled ? "LIGADO" : "DESLIGADO"}
          </span>
          <ToggleSwitch
            enabled={enabled}
            onChange={(v) => toggle.mutate(v)}
            disabled={toggle.isPending || isLoading}
            colorOn="bg-amber-500"
          />
        </div>
      </div>

      <p className="mt-3 text-xs text-muted-foreground">
        {enabled
          ? "Para retornar ao fluxo normal, desligue este modo."
          : "Ao ligar, todos os pedidos criados serão marcados como TESTE e não entrarão no fluxo real."}
      </p>
    </div>
  );
}

/* ── System status banner ────────────────────────────────────── */
function SystemStatusBanner() {
  const { data: maintData } = useQuery<{ enabled: boolean }>({
    queryKey: ["/api/settings/maintenance"],
    staleTime: 0,
    refetchOnMount: true,
  });
  const { data: testData } = useQuery<{ enabled: boolean }>({
    queryKey: ["/api/settings/test-mode"],
    staleTime: 0,
    refetchOnMount: true,
  });

  const maintActive = maintData?.enabled === true;
  const testActive = testData?.enabled === true;

  if (maintActive) {
    return (
      <div className="flex items-center gap-3 px-5 py-3.5 rounded-2xl bg-red-100 border-2 border-red-300 text-red-700 font-bold text-sm premium-shadow dark:bg-red-950/40 dark:border-red-700 dark:text-red-300">
        <div className="w-3 h-3 rounded-full bg-red-500 animate-pulse flex-shrink-0" />
        <AlertTriangle className="w-4 h-4 flex-shrink-0" />
        Modo Manutenção Ativo — clientes sem acesso ao sistema
      </div>
    );
  }
  if (testActive) {
    return (
      <div className="flex items-center gap-3 px-5 py-3.5 rounded-2xl bg-amber-100 border-2 border-amber-300 text-amber-800 font-bold text-sm premium-shadow dark:bg-amber-950/40 dark:border-amber-700 dark:text-amber-300">
        <div className="w-3 h-3 rounded-full bg-amber-500 animate-pulse flex-shrink-0" />
        <FlaskConical className="w-4 h-4 flex-shrink-0" />
        Modo Teste Ativo — pedidos criados são marcados como TESTE
      </div>
    );
  }
  return (
    <div className="flex items-center gap-3 px-5 py-3.5 rounded-2xl bg-green-50 border-2 border-green-200 text-green-700 font-bold text-sm premium-shadow dark:bg-green-950/40 dark:border-green-700 dark:text-green-300">
      <div className="w-3 h-3 rounded-full bg-green-500 flex-shrink-0" />
      <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
      Sistema Operando Normalmente
    </div>
  );
}

/* ── Date helpers ────────────────────────────────────────────── */
function toDateStr(d: Date) { return d.toISOString().split('T')[0]; }
function getPreset(preset: string): { start: string; end: string } {
  const now = new Date();
  const today = toDateStr(now);
  switch (preset) {
    case 'today': return { start: today, end: today };
    case 'week': {
      const day = now.getDay();
      const diff = (day === 0 ? -6 : 1 - day);
      const mon = new Date(now); mon.setDate(now.getDate() + diff);
      const fri = new Date(mon); fri.setDate(mon.getDate() + 6);
      return { start: toDateStr(mon), end: toDateStr(fri) };
    }
    case 'month': {
      const start = new Date(now.getFullYear(), now.getMonth(), 1);
      const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
      return { start: toDateStr(start), end: toDateStr(end) };
    }
    case 'year': {
      return { start: `${now.getFullYear()}-01-01`, end: `${now.getFullYear()}-12-31` };
    }
    default: return { start: toDateStr(new Date(now.getFullYear(), now.getMonth(), 1)), end: today };
  }
}

/* ── Main dashboard ──────────────────────────────────────────── */
export default function AdminDashboard() {
  const { user } = useAuth();
  const { data: orders } = useOrders();
  const { data: companies } = useCompanies();
  const { data: contractAlerts = [] } = useQuery<any[]>({ queryKey: ['/api/contracts/alerts'], staleTime: 60000 });
  const today = toDateStr(new Date());

  const [preset, setPreset] = useState<string>('month');
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');
  const [showCustom, setShowCustom] = useState(false);

  const dateRange = useMemo(() => {
    if (preset === 'custom' && customStart && customEnd) return { start: customStart, end: customEnd };
    return getPreset(preset);
  }, [preset, customStart, customEnd]);

  const filteredOrders = useMemo(() => {
    if (!orders) return [];
    return orders.filter(o => {
      const d = new Date(o.deliveryDate).toISOString().split('T')[0];
      return d >= dateRange.start && d <= dateRange.end && o.status !== 'CANCELLED';
    });
  }, [orders, dateRange]);

  const pendingDeliveries = useMemo(() =>
    filteredOrders.filter(o => {
      const d = new Date(o.deliveryDate).toISOString().split('T')[0];
      return d >= today && ['CONFIRMED', 'OPEN_FOR_EDITING', 'ACTIVE'].includes(o.status);
    }).length, [filteredOrders, today]);

  const totalValue = filteredOrders.reduce((acc, o) => acc + Number(o.totalValue), 0);
  const activeCompanies = companies?.filter((c) => c.active).length || 0;
  const uniqueClients = new Set(filteredOrders.map(o => o.companyId)).size;

  const presets = [
    { key: 'today', label: 'Hoje' },
    { key: 'week', label: 'Esta Semana' },
    { key: 'month', label: 'Este Mês' },
    { key: 'year', label: 'Este Ano' },
    { key: 'custom', label: 'Período' },
  ];

  const stats = [
    { label: "Pedidos no Período", value: filteredOrders.length, icon: ShoppingCart, color: "text-blue-500", bg: "bg-blue-500/10" },
    { label: "Receita no Período", value: `R$ ${totalValue.toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '.')}`, icon: TrendingUp, color: "text-green-500", bg: "bg-green-500/10" },
    { label: "Clientes Ativos", value: activeCompanies, icon: Users, color: "text-orange-500", bg: "bg-orange-500/10" },
    { label: "Entregas Pendentes", value: pendingDeliveries, icon: Package, color: "text-purple-500", bg: "bg-purple-500/10" },
  ];

  const canToggleMaintenance = ["ADMIN", "DIRECTOR", "DEVELOPER"].includes(user?.role || "");

  return (
    <Layout>
      <div className="space-y-8">
        <div>
          <h1 className="text-3xl font-display font-bold text-foreground">Olá, {user?.name}!</h1>
          <p className="text-muted-foreground mt-1 text-lg">Veja o resumo do VivaFrutaz.</p>
        </div>

        {/* System status banner — always visible for allowed roles */}
        {canToggleMaintenance && <SystemStatusBanner />}

        {/* Analytics Filter Bar */}
        <div className="bg-card rounded-2xl border border-border/50 premium-shadow p-5">
          <div className="flex items-center gap-2 mb-3">
            <Filter className="w-4 h-4 text-primary" />
            <span className="text-sm font-semibold text-foreground">Filtro Analítico</span>
            <span className="text-xs text-muted-foreground ml-auto">{new Date(dateRange.start + 'T12:00').toLocaleDateString('pt-BR')} – {new Date(dateRange.end + 'T12:00').toLocaleDateString('pt-BR')}</span>
          </div>
          <div className="flex flex-wrap gap-2">
            {presets.map(p => (
              <Button key={p.key} size="sm" variant={preset === p.key ? "default" : "outline"}
                className={`h-8 text-xs ${preset === p.key ? 'bg-primary text-white' : ''}`}
                onClick={() => { setPreset(p.key); if (p.key === 'custom') setShowCustom(true); else setShowCustom(false); }}
                data-testid={`btn-preset-${p.key}`}>
                <CalendarDays className="w-3 h-3 mr-1" />{p.label}
              </Button>
            ))}
          </div>
          {showCustom && (
            <div className="flex gap-3 mt-3 items-center">
              <div className="flex flex-col gap-1">
                <span className="text-xs text-muted-foreground">De</span>
                <Input type="date" value={customStart} onChange={e => setCustomStart(e.target.value)} className="h-8 text-xs w-36" data-testid="input-custom-start" />
              </div>
              <div className="flex flex-col gap-1">
                <span className="text-xs text-muted-foreground">Até</span>
                <Input type="date" value={customEnd} onChange={e => setCustomEnd(e.target.value)} className="h-8 text-xs w-36" data-testid="input-custom-end" />
              </div>
            </div>
          )}
        </div>

        {/* Stats */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
          {stats.map((stat, i) => (
            <div key={i} className="bg-card rounded-2xl p-6 border border-border/50 premium-shadow">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-semibold text-muted-foreground">{stat.label}</p>
                  <p className="text-3xl font-display font-bold mt-2 text-foreground">{stat.value}</p>
                  {stat.label === "Pedidos no Período" && uniqueClients > 0 && (
                    <p className="text-xs text-muted-foreground mt-1">{uniqueClients} cliente(s) distintos</p>
                  )}
                </div>
                <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${stat.bg}`}>
                  <stat.icon className={`w-6 h-6 ${stat.color}`} />
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Contract Alerts */}
        {contractAlerts.length > 0 && (
          <div className="bg-card rounded-2xl border border-amber-200 premium-shadow p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-base font-bold text-foreground flex items-center gap-2">
                <ScrollText className="w-5 h-5 text-amber-600" />
                Alertas de Contratos ({contractAlerts.length})
              </h2>
              <Link href="/admin/contracts">
                <span className="text-xs font-bold text-primary hover:underline cursor-pointer">Ver gestão de contratos →</span>
              </Link>
            </div>
            <div className="space-y-2">
              {contractAlerts.slice(0, 5).map((a: any, i: number) => (
                <div key={i} className={`p-3 rounded-xl border flex items-start gap-3 ${a.type === 'expiring' && a.daysLeft <= 30 ? 'bg-red-50 border-red-200' : a.type === 'expiring' && a.daysLeft <= 60 ? 'bg-orange-50 border-orange-200' : 'bg-amber-50 border-amber-200'}`}>
                  <AlertTriangle className={`w-4 h-4 flex-shrink-0 mt-0.5 ${a.type === 'expiring' && a.daysLeft <= 30 ? 'text-red-600' : 'text-amber-600'}`} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-bold text-foreground">{a.companyName}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {a.type === '12_months'
                        ? `Contrato completou ${a.monthsActive} meses. Sem reajuste há ${a.monthsSinceLastAdjustment} meses — avaliar IPCA.`
                        : `Vence em ${a.daysLeft} dias (${new Date(a.contractEndDate + 'T00:00:00').toLocaleDateString('pt-BR')})`}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Mode controls */}
        {canToggleMaintenance && (
          <div className="space-y-4">
            <h2 className="text-lg font-bold text-foreground flex items-center gap-2">
              <Shield className="w-5 h-5 text-primary" />
              Controle de Modos do Sistema
            </h2>
            <MaintenanceToggle />
            <TestModeToggle />
          </div>
        )}

        {/* Recent pending deliveries */}
        {filteredOrders.length > 0 && (
          <div className="bg-card rounded-2xl border border-border/50 premium-shadow p-6">
            <h2 className="text-base font-bold text-foreground mb-4 flex items-center gap-2">
              <Package className="w-5 h-5 text-primary" /> Pedidos no Período ({filteredOrders.length})
            </h2>
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {filteredOrders.slice(0, 10).map(o => (
                <div key={o.id} className="flex items-center justify-between py-2 border-b border-border/30 last:border-0">
                  <div>
                    <p className="text-sm font-semibold">{o.orderCode || `#${o.id}`}</p>
                    <p className="text-xs text-muted-foreground">Empresa #{o.companyId} — {new Date(o.deliveryDate).toLocaleDateString('pt-BR')}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-bold text-green-600">R$ {Number(o.totalValue).toFixed(2).replace('.', ',')}</p>
                    <span className={`text-xs px-2 py-0.5 rounded-full ${o.status === 'CONFIRMED' ? 'bg-green-100 text-green-800' : o.status === 'CANCELLED' ? 'bg-red-100 text-red-800' : 'bg-yellow-100 text-yellow-800'}`}>{o.status}</span>
                  </div>
                </div>
              ))}
              {filteredOrders.length > 10 && <p className="text-xs text-center text-muted-foreground pt-2">+ {filteredOrders.length - 10} outros pedidos</p>}
            </div>
          </div>
        )}
      </div>
    </Layout>
  );
}
