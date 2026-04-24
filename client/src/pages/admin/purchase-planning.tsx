import { useState, useMemo } from "react";
import { ContextualTip } from "@/components/ContextualTip";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import {
  ShoppingCart, Package, ChevronDown, ChevronRight, TrendingUp, TrendingDown,
  Minus, Calendar, CheckCircle, Clock, XCircle, Loader2, RefreshCw, Star,
  Filter, X, BarChart3, ListChecks, Zap, AlertCircle, ChevronLeft, ChevronRight as CR
} from "lucide-react";
import type { PurchasePlanStatus } from "@shared/schema";

// ─── Types ─────────────────────────────────────────────────────────────────

type PlanCompany = { companyId: number; companyName: string; quantity: number; deliveryDate: string; orderId: number; orderCode: string };

type PlanItem = {
  productId: number | null; productName: string; totalQty: number; unit: string;
  category?: string; productType?: string; source: 'regular' | 'special';
  companies: PlanCompany[]; planStatus: PurchasePlanStatus | null;
};

type DayGroup = { date: string; dayName: string; shortDate: string; items: PlanItem[] };

type PlanResult = {
  items: PlanItem[]; byDay: DayGroup[];
  totalOrders: number; period: { startDate: string; endDate: string }; weekRef: string;
};

type ForecastItem = { productName: string; avgWeekly: number; suggestion: number; weeksActive: number; trend: 'up' | 'down' | 'stable'; recentAvg: number };
type ForecastResult = { forecast: ForecastItem[]; analyzedWeeks: number; generatedAt: string };

// ─── Constants ─────────────────────────────────────────────────────────────

const STATUSES: Record<string, { label: string; color: string; bg: string; icon: any }> = {
  PENDING: { label: "Pendente", color: "text-gray-600", bg: "bg-gray-100 border-gray-200", icon: Clock },
  BUYING: { label: "Comprando", color: "text-blue-600", bg: "bg-blue-100 border-blue-200", icon: ShoppingCart },
  BOUGHT: { label: "Comprado", color: "text-green-600", bg: "bg-green-100 border-green-200", icon: CheckCircle },
  UNAVAILABLE: { label: "Indisponível", color: "text-red-600", bg: "bg-red-100 border-red-200", icon: XCircle },
};

const CATEGORY_COLORS: Record<string, string> = {
  "Frutas": "bg-orange-100 text-orange-700 border-orange-200",
  "Hortifruti / Verduras": "bg-green-100 text-green-700 border-green-200",
  "Industrializados": "bg-blue-100 text-blue-700 border-blue-200",
};

type TabKey = 'day' | 'list' | 'forecast' | 'panel';

// ─── Helpers ───────────────────────────────────────────────────────────────

function getThisMonday(): string {
  const today = new Date();
  const day = today.getDay() || 7;
  const mon = new Date(today);
  mon.setDate(today.getDate() - (day - 1));
  return mon.toISOString().split('T')[0];
}

function addDays(date: string, n: number): string {
  const d = new Date(date + 'T12:00:00');
  d.setDate(d.getDate() + n);
  return d.toISOString().split('T')[0];
}

function fmtDate(date: string): string {
  return new Date(date + 'T12:00:00').toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit' });
}

function isToday(date: string): boolean {
  return date === new Date().toISOString().split('T')[0];
}

function isTomorrow(date: string): boolean {
  const tom = new Date(); tom.setDate(tom.getDate() + 1);
  return date === tom.toISOString().split('T')[0];
}

// ─── Product Row ────────────────────────────────────────────────────────────

function ProductRow({ item, onStatus }: { item: PlanItem; onStatus: (item: PlanItem) => void }) {
  const [expanded, setExpanded] = useState(false);
  const status = item.planStatus?.status || 'PENDING';
  const { label, bg, color, icon: SIcon } = STATUSES[status] || STATUSES.PENDING;

  return (
    <div className={`${item.source === 'special' ? 'border-l-2 border-secondary' : ''}`}>
      <div className="flex items-center gap-2 px-4 py-2.5 hover:bg-muted/20 transition-colors cursor-pointer"
        onClick={() => setExpanded(!expanded)}>
        <button className="text-muted-foreground flex-shrink-0 w-4">
          {expanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
        </button>
        <div className="flex-1 min-w-0 flex items-center gap-2 flex-wrap">
          <span className="font-medium text-sm truncate">{item.productName}</span>
          {item.source === 'special' && (
            <span className="px-1.5 py-0.5 text-xs font-bold bg-secondary/10 text-secondary border border-secondary/20 rounded">Pontual</span>
          )}
          {item.category && (
            <span className={`px-1.5 py-0.5 text-xs font-bold border rounded ${CATEGORY_COLORS[item.category] || 'bg-muted text-muted-foreground border-border'}`}>
              {item.category}
            </span>
          )}
          {item.productType === 'external' && (
            <span className="px-1.5 py-0.5 text-xs font-bold bg-purple-100 text-purple-700 border border-purple-200 rounded">Fora catálogo</span>
          )}
          <span className="text-xs text-muted-foreground">
            {item.companies.length} empresa{item.companies.length !== 1 ? 's' : ''} · <strong>{item.totalQty % 1 === 0 ? item.totalQty : item.totalQty.toFixed(2)} {item.unit}</strong>
          </span>
        </div>
        <span className={`flex-shrink-0 inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium border ${bg} ${color}`}>
          <SIcon className="w-3 h-3" /> {label}
        </span>
        <Button size="sm" variant="outline" className="flex-shrink-0 h-6 text-xs px-2"
          onClick={e => { e.stopPropagation(); onStatus(item); }}
          data-testid={`button-status-${item.productName}`}>
          Atualizar
        </Button>
      </div>
      {expanded && (
        <div className="bg-muted/20 px-8 pb-3 pt-1 text-xs">
          <table className="w-full">
            <thead><tr className="text-muted-foreground">
              <th className="text-left py-1">Empresa</th>
              <th className="text-right py-1">Qtd.</th>
              <th className="text-left pl-4 py-1">Pedido</th>
            </tr></thead>
            <tbody>{item.companies.map((c, i) => (
              <tr key={i} className="border-t border-border/40">
                <td className="py-1">{c.companyName}</td>
                <td className="py-1 text-right font-mono">{c.quantity % 1 === 0 ? c.quantity : c.quantity.toFixed(2)} {item.unit}</td>
                <td className="py-1 pl-4 font-mono text-muted-foreground">{c.orderCode}</td>
              </tr>
            ))}</tbody>
          </table>
          {item.planStatus?.supplier && <p className="mt-1 text-muted-foreground">Fornecedor: <strong>{item.planStatus.supplier}</strong></p>}
          {item.planStatus?.notes && <p className="text-muted-foreground italic">Obs: {item.planStatus.notes}</p>}
        </div>
      )}
    </div>
  );
}

// ─── Main Component ─────────────────────────────────────────────────────────

export default function PurchasePlanningPage() {
  const { toast } = useToast();
  const [startDate, setStartDate] = useState(getThisMonday());
  const [tab, setTab] = useState<TabKey>('day');
  const [sourceFilter, setSourceFilter] = useState('all');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [urgencyFilter, setUrgencyFilter] = useState('all'); // all | today | tomorrow | week
  const [statusDialog, setStatusDialog] = useState<{ item: PlanItem } | null>(null);
  const [statusForm, setStatusForm] = useState({ status: 'PENDING', supplier: '', expectedArrival: '', notes: '' });

  const endDate = addDays(startDate, 4);

  const { data, isLoading, refetch, isFetching } = useQuery<PlanResult>({
    queryKey: ['/api/purchase-planning', startDate, sourceFilter, categoryFilter],
    queryFn: async () => {
      const p = new URLSearchParams({ startDate, sourceFilter, categoryFilter });
      const res = await fetch(`/api/purchase-planning?${p}`, { credentials: 'include' });
      if (!res.ok) throw new Error('Erro ao carregar dados');
      return res.json();
    },
  });

  const { data: forecastData, isLoading: forecastLoading } = useQuery<ForecastResult>({
    queryKey: ['/api/purchase-planning/forecast'],
    queryFn: async () => {
      const res = await fetch('/api/purchase-planning/forecast', { credentials: 'include' });
      if (!res.ok) throw new Error('Erro ao carregar previsão');
      return res.json();
    },
    staleTime: 10 * 60 * 1000,
  });

  const { data: inventorySettings = [] } = useQuery<any[]>({
    queryKey: ['/api/inventory/settings'],
    queryFn: async () => {
      const res = await fetch('/api/inventory/settings', { credentials: 'include' });
      if (!res.ok) return [];
      return res.json();
    },
    staleTime: 5 * 60 * 1000,
  });

  // Stock deficit alerts — compare demand vs current inventory
  const stockAlerts = useMemo(() => {
    if (!data?.items.length || !inventorySettings.length) return [];
    const alerts: { productName: string; demand: number; currentStock: number; unit: string }[] = [];
    for (const item of data.items) {
      const inv = inventorySettings.find((s: any) =>
        s.productName?.toLowerCase() === item.productName.toLowerCase() ||
        s.productId === item.productId
      );
      if (!inv) continue;
      const stock = parseFloat(inv.currentStock ?? inv.current_stock ?? '0');
      if (stock < item.totalQty) {
        alerts.push({ productName: item.productName, demand: item.totalQty, currentStock: stock, unit: item.unit });
      }
    }
    return alerts;
  }, [data, inventorySettings]);

  const variationAlerts = useMemo(() => {
    if (!data || !forecastData?.forecast.length) return [];
    const alerts: { productName: string; currentTotal: number; avgWeekly: number; pct: number }[] = [];
    for (const item of data.items) {
      const fc = forecastData.forecast.find(f => f.productName === item.productName);
      if (!fc || fc.avgWeekly <= 0) continue;
      const pct = ((item.totalQty - fc.avgWeekly) / fc.avgWeekly) * 100;
      if (Math.abs(pct) >= 80) {
        alerts.push({ productName: item.productName, currentTotal: item.totalQty, avgWeekly: fc.avgWeekly, pct: Math.round(pct) });
      }
    }
    return alerts.sort((a, b) => Math.abs(b.pct) - Math.abs(a.pct)).slice(0, 10);
  }, [data, forecastData]);

  const upsertMutation = useMutation({
    mutationFn: (payload: any) => apiRequest('POST', '/api/purchase-planning/status', payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/purchase-planning', startDate] });
      toast({ title: 'Status atualizado com sucesso!' });
      setStatusDialog(null);
    },
    onError: () => toast({ title: 'Erro ao atualizar status', variant: 'destructive' }),
  });

  function openStatus(item: PlanItem) {
    setStatusDialog({ item });
    setStatusForm({
      status: item.planStatus?.status || 'PENDING',
      supplier: item.planStatus?.supplier || '',
      expectedArrival: item.planStatus?.expectedArrival || '',
      notes: item.planStatus?.notes || '',
    });
  }

  function submitStatus() {
    if (!statusDialog) return;
    const weekRef = data?.weekRef || startDate;
    upsertMutation.mutate({ weekRef, productName: statusDialog.item.productName, ...statusForm });
  }

  function prevWeek() { setStartDate(addDays(startDate, -7)); }
  function nextWeek() { setStartDate(addDays(startDate, 7)); }
  function thisWeek() { setStartDate(getThisMonday()); }

  // Urgency filter applied to byDay
  const byDay = useMemo(() => {
    if (!data?.byDay) return [];
    const today = new Date().toISOString().split('T')[0];
    const tom = addDays(today, 1);
    return data.byDay.map(day => {
      let items = day.items;
      if (urgencyFilter === 'today') items = items.filter(i => i.companies.some(c => c.deliveryDate === today) || day.date === today);
      if (urgencyFilter === 'tomorrow') items = items.filter(i => i.companies.some(c => c.deliveryDate === tom) || day.date === tom);
      return { ...day, items };
    }).filter(day => {
      if (urgencyFilter === 'today') return day.date === today;
      if (urgencyFilter === 'tomorrow') return day.date === tom;
      return true;
    });
  }, [data?.byDay, urgencyFilter]);

  const allItems = data?.items || [];
  const statusCounts = useMemo(() => {
    const c: Record<string, number> = { PENDING: 0, BUYING: 0, BOUGHT: 0, UNAVAILABLE: 0 };
    for (const it of allItems) c[it.planStatus?.status || 'PENDING'] = (c[it.planStatus?.status || 'PENDING'] || 0) + 1;
    return c;
  }, [allItems]);

  const todayItems = allItems.filter(i => i.companies.some(c => isToday(c.deliveryDate)));
  const tomorrowItems = allItems.filter(i => i.companies.some(c => isTomorrow(c.deliveryDate)));
  const specialItems = allItems.filter(i => i.source === 'special');
  const hasFilters = sourceFilter !== 'all' || categoryFilter !== 'all';

  // Consolidated list grouped by category
  const consolidatedByCat = useMemo(() => {
    const map: Record<string, PlanItem[]> = { 'Frutas': [], 'Hortifruti / Verduras': [], 'Industrializados': [], 'Outros': [] };
    for (const it of allItems) {
      const cat = it.category && map[it.category] ? it.category : 'Outros';
      map[cat].push(it);
    }
    return map;
  }, [allItems]);

  const tabs: { key: TabKey; label: string; icon: any }[] = [
    { key: 'day', label: 'Por Dia', icon: Calendar },
    { key: 'list', label: 'Lista Consolidada', icon: ListChecks },
    { key: 'forecast', label: 'Previsão Inteligente', icon: BarChart3 },
    { key: 'panel', label: 'Painel de Compras', icon: Zap },
  ];

  return (
    <div className="p-5 space-y-5 max-w-6xl mx-auto">
      <ContextualTip
        tipId="purchase-planning-intro"
        variant="help"
        title="Planejamento de Compras"
        message="Os pedidos gerados a partir de escopos contratuais aparecem automaticamente aqui, já consolidados por produto. Use os filtros para visualizar por origem, categoria e urgência."
        learnMoreMessage="Como os pedidos do escopo contratual chegam no planejamento de compras?"
      />
      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <ShoppingCart className="w-6 h-6 text-green-600" /> Planejamento de Compras
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Semana de compras: <strong>{new Date(startDate + 'T12:00:00').toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })}</strong> até <strong>{new Date(endDate + 'T12:00:00').toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })}</strong>
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon" onClick={prevWeek} data-testid="button-prev-week"><ChevronLeft className="w-4 h-4" /></Button>
          <div>
            <Label className="text-xs text-muted-foreground">Início da semana</Label>
            <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)}
              data-testid="input-start-date"
              className="block px-3 py-1.5 text-sm rounded-xl border-2 border-border focus:border-primary outline-none" />
          </div>
          <Button variant="outline" size="icon" onClick={nextWeek} data-testid="button-next-week"><CR className="w-4 h-4" /></Button>
          <Button variant="outline" size="sm" onClick={thisWeek} data-testid="button-this-week">Esta semana</Button>
          <Button variant="outline" size="icon" onClick={() => refetch()} data-testid="button-refresh">
            <RefreshCw className={`w-4 h-4 ${isFetching ? 'animate-spin' : ''}`} />
          </Button>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { key: 'PENDING', label: 'Pendente', count: statusCounts.PENDING },
          { key: 'BUYING', label: 'Comprando', count: statusCounts.BUYING },
          { key: 'BOUGHT', label: 'Comprado', count: statusCounts.BOUGHT },
          { key: 'UNAVAILABLE', label: 'Indisponível', count: statusCounts.UNAVAILABLE },
        ].map(({ key, label, count }) => {
          const { bg, color, icon: SIcon } = STATUSES[key];
          return (
            <div key={key} className="bg-card rounded-2xl border border-border/50 p-4 flex items-center gap-3">
              <div className={`w-9 h-9 rounded-xl flex items-center justify-center ${bg}`}>
                <SIcon className={`w-4 h-4 ${color}`} />
              </div>
              <div>
                <p className="text-2xl font-bold text-foreground">{count}</p>
                <p className="text-xs text-muted-foreground">{label}</p>
              </div>
            </div>
          );
        })}
      </div>

      {/* Stock Deficit Alerts */}
      {stockAlerts.length > 0 && (
        <div className="bg-red-50 border border-red-200 rounded-2xl p-4 space-y-2" data-testid="stock-alerts-banner">
          <div className="flex items-center gap-2 font-bold text-red-800 text-sm">
            <AlertCircle className="w-4 h-4" /> Estoque Insuficiente para Atender Pedidos da Semana
          </div>
          <p className="text-xs text-red-700">Os produtos abaixo têm demanda superior ao estoque atual cadastrado.</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {stockAlerts.map((a, i) => (
              <div key={i} className="flex items-center justify-between bg-white/70 rounded-lg px-3 py-2 text-sm border border-red-100">
                <span className="font-semibold text-red-900">{a.productName}</span>
                <div className="flex items-center gap-3 text-xs">
                  <span className="text-muted-foreground">Estoque: <strong className="text-red-700">{a.currentStock} {a.unit}</strong></span>
                  <span className="text-muted-foreground">Demanda: <strong>{a.demand} {a.unit}</strong></span>
                  <span className="px-2 py-0.5 rounded-full font-bold bg-red-100 text-red-700">
                    Falta {(a.demand - a.currentStock).toFixed(a.demand % 1 !== 0 ? 2 : 0)} {a.unit}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="bg-card rounded-2xl border border-border/50 p-4 flex flex-wrap gap-3 items-end">
        <Filter className="w-4 h-4 text-muted-foreground self-center" />
        <div>
          <Label className="text-xs text-muted-foreground mb-1 block">Origem</Label>
          <Select value={sourceFilter} onValueChange={setSourceFilter}>
            <SelectTrigger className="w-40 h-8 text-xs" data-testid="select-source-filter"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos</SelectItem>
              <SelectItem value="regular">Regulares</SelectItem>
              <SelectItem value="special">Pontuais</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-xs text-muted-foreground mb-1 block">Categoria</Label>
          <Select value={categoryFilter} onValueChange={setCategoryFilter}>
            <SelectTrigger className="w-48 h-8 text-xs" data-testid="select-category-filter"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas</SelectItem>
              <SelectItem value="Frutas">Frutas</SelectItem>
              <SelectItem value="Hortifruti / Verduras">Hortifruti / Verduras</SelectItem>
              <SelectItem value="Industrializados">Industrializados</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-xs text-muted-foreground mb-1 block">Urgência</Label>
          <Select value={urgencyFilter} onValueChange={setUrgencyFilter}>
            <SelectTrigger className="w-44 h-8 text-xs" data-testid="select-urgency-filter"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Toda a semana</SelectItem>
              <SelectItem value="today">Para hoje</SelectItem>
              <SelectItem value="tomorrow">Para amanhã</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {(hasFilters || urgencyFilter !== 'all') && (
          <button onClick={() => { setSourceFilter('all'); setCategoryFilter('all'); setUrgencyFilter('all'); }}
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground font-medium self-end pb-1">
            <X className="w-3 h-3" /> Limpar
          </button>
        )}
        <span className="ml-auto text-xs text-muted-foreground self-end pb-1 font-medium">
          {allItems.length} produto{allItems.length !== 1 ? 's' : ''} · {data?.totalOrders || 0} pedidos
          {specialItems.length > 0 && <span className="text-secondary ml-1 font-bold">· {specialItems.length} pontual</span>}
        </span>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-muted/40 rounded-2xl p-1">
        {tabs.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            data-testid={`tab-${t.key}`}
            className={`flex-1 flex items-center justify-center gap-2 py-2 px-3 rounded-xl text-sm font-semibold transition-all ${tab === t.key ? 'bg-card shadow text-foreground' : 'text-muted-foreground hover:text-foreground'}`}>
            <t.icon className="w-4 h-4 flex-shrink-0" />
            <span className="hidden sm:inline">{t.label}</span>
          </button>
        ))}
      </div>

      {/* ── Tab: Por Dia ─────────────────────────────────────────── */}
      {tab === 'day' && (
        <div className="space-y-4">
          {isLoading ? (
            <div className="bg-card rounded-2xl p-8 text-center text-muted-foreground">Carregando dados dos pedidos...</div>
          ) : byDay.length === 0 ? (
            <div className="bg-card rounded-2xl p-10 text-center border border-border/50">
              <Package className="w-12 h-12 mx-auto mb-3 text-muted-foreground/30" />
              <p className="text-muted-foreground">Nenhum produto encontrado para esta semana.</p>
              {hasFilters && (
                <button onClick={() => { setSourceFilter('all'); setCategoryFilter('all'); }}
                  className="mt-2 text-primary text-sm font-bold hover:underline">Limpar filtros</button>
              )}
            </div>
          ) : (
            byDay.map(day => {
              const isToday_ = isToday(day.date);
              const isTom_ = isTomorrow(day.date);
              return (
                <div key={day.date} className={`bg-card rounded-2xl border overflow-hidden ${isToday_ ? 'border-primary border-2' : 'border-border/50'}`}>
                  <div className={`px-4 py-3 flex items-center justify-between ${isToday_ ? 'bg-primary/10' : isTom_ ? 'bg-secondary/10' : 'bg-muted/30'}`}>
                    <div className="flex items-center gap-3">
                      <div className={`w-10 h-10 rounded-xl flex items-center justify-center font-bold text-sm ${isToday_ ? 'bg-primary text-white' : isTom_ ? 'bg-secondary text-white' : 'bg-muted text-foreground'}`}>
                        {day.shortDate}
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <p className="font-bold text-foreground capitalize">{day.dayName}</p>
                          {isToday_ && <span className="px-2 py-0.5 text-xs font-bold bg-primary text-white rounded-full">HOJE</span>}
                          {isTom_ && <span className="px-2 py-0.5 text-xs font-bold bg-secondary text-white rounded-full">AMANHÃ</span>}
                        </div>
                        <p className="text-xs text-muted-foreground">{day.items.length} produto{day.items.length !== 1 ? 's' : ''} a comprar</p>
                      </div>
                    </div>
                  </div>
                  <div className="divide-y divide-border/40">
                    {day.items.length === 0 ? (
                      <p className="px-4 py-3 text-sm text-muted-foreground">Sem produtos para este dia.</p>
                    ) : (
                      day.items.map(item => (
                        <ProductRow key={`${item.source}__${item.productName}`} item={item} onStatus={openStatus} />
                      ))
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}

      {/* ── Tab: Lista Consolidada ────────────────────────────────── */}
      {tab === 'list' && (
        <div className="space-y-4">
        {variationAlerts.length > 0 && (
          <div className="bg-orange-50 border border-orange-200 rounded-2xl p-4 space-y-2">
            <div className="flex items-center gap-2 font-bold text-orange-800 text-sm">
              <AlertCircle className="w-4 h-4" /> {variationAlerts.length} Produto(s) com Volume Fora do Padrão Histórico
            </div>
            <p className="text-xs text-orange-700">Comparado à média das últimas 8 semanas (alertas com variação ≥ 80%)</p>
            {variationAlerts.map((a, i) => (
              <div key={i} className="flex items-center justify-between bg-white/70 rounded-lg px-3 py-2 text-sm">
                <span className="font-medium">{a.productName}</span>
                <div className="flex items-center gap-2 text-xs">
                  <span className="text-muted-foreground">Média: <strong>{a.avgWeekly} un</strong></span>
                  <span className="text-muted-foreground">Semana atual: <strong>{a.currentTotal} un</strong></span>
                  <span className={`px-2 py-0.5 rounded-full font-bold ${a.pct > 0 ? 'bg-red-100 text-red-700' : 'bg-blue-100 text-blue-700'}`}>
                    {a.pct > 0 ? '+' : ''}{a.pct}%
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
        <div className="bg-card rounded-2xl border border-border/50 overflow-hidden">
          <div className="px-5 py-4 border-b border-border/50 bg-muted/20 flex items-center justify-between">
            <h2 className="font-bold text-foreground flex items-center gap-2">
              <ListChecks className="w-5 h-5 text-green-600" /> Lista de compras da semana
            </h2>
            <span className="text-sm text-muted-foreground">{allItems.length} produtos · {allItems.reduce((s, i) => s + i.companies.length, 0)} empresas</span>
          </div>
          {isLoading ? (
            <div className="p-8 text-center text-muted-foreground">Calculando lista...</div>
          ) : allItems.length === 0 ? (
            <div className="p-8 text-center text-muted-foreground">Nenhum produto nesta semana.</div>
          ) : (
            Object.entries(consolidatedByCat).map(([cat, items]) => {
              if (items.length === 0) return null;
              return (
                <div key={cat}>
                  <div className={`px-5 py-2 border-b border-border/50 ${CATEGORY_COLORS[cat] ? `bg-${cat === 'Frutas' ? 'orange' : cat === 'Industrializados' ? 'blue' : 'green'}-50` : 'bg-muted/10'}`}>
                    <span className={`text-xs font-bold uppercase tracking-wider ${CATEGORY_COLORS[cat] ? `text-${cat === 'Frutas' ? 'orange' : cat === 'Industrializados' ? 'blue' : 'green'}-700` : 'text-muted-foreground'}`}>{cat}</span>
                  </div>
                  <table className="w-full text-sm">
                    <thead><tr className="text-muted-foreground text-xs bg-muted/10">
                      <th className="text-left px-5 py-2 font-semibold">Produto</th>
                      <th className="text-right px-5 py-2 font-semibold">Qtd. Total</th>
                      <th className="text-left px-4 py-2 font-semibold">Empresas</th>
                      <th className="text-left px-4 py-2 font-semibold">Status Compra</th>
                      <th className="px-4 py-2"></th>
                    </tr></thead>
                    <tbody className="divide-y divide-border/40">
                      {items.sort((a, b) => b.totalQty - a.totalQty).map(item => {
                        const status = item.planStatus?.status || 'PENDING';
                        const { label, bg, color, icon: SIcon } = STATUSES[status] || STATUSES.PENDING;
                        return (
                          <tr key={`${item.source}__${item.productName}`}
                            className={`hover:bg-muted/10 ${item.source === 'special' ? 'border-l-2 border-secondary' : ''}`}
                            data-testid={`list-row-${item.productName}`}>
                            <td className="px-5 py-2.5">
                              <span className="font-semibold">{item.productName}</span>
                              {item.source === 'special' && <span className="ml-2 text-xs font-bold text-secondary">Pontual</span>}
                              {item.productType === 'external' && <span className="ml-1 text-xs text-purple-600 font-bold">Fora catálogo</span>}
                            </td>
                            <td className="px-5 py-2.5 text-right font-bold font-mono">
                              {item.totalQty % 1 === 0 ? item.totalQty : item.totalQty.toFixed(2)} {item.unit}
                            </td>
                            <td className="px-4 py-2.5 text-muted-foreground text-xs">{item.companies.length}</td>
                            <td className="px-4 py-2.5">
                              <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium border ${bg} ${color}`}>
                                <SIcon className="w-3 h-3" /> {label}
                              </span>
                            </td>
                            <td className="px-4 py-2.5">
                              <Button size="sm" variant="outline" className="h-6 text-xs px-2"
                                onClick={() => openStatus(item)}>Atualizar</Button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              );
            })
          )}
        </div>
        </div>
      )}

      {/* ── Tab: Previsão Inteligente ─────────────────────────────── */}
      {tab === 'forecast' && (
        <div className="space-y-4">
          <div className="bg-card rounded-2xl border border-border/50 overflow-hidden">
            <div className="px-5 py-4 border-b border-border/50 bg-muted/20 flex items-center justify-between">
              <div>
                <h2 className="font-bold text-foreground flex items-center gap-2">
                  <BarChart3 className="w-5 h-5 text-purple-600" /> Previsão Inteligente de Compras
                </h2>
                <p className="text-xs text-muted-foreground mt-0.5">Baseado nas últimas 8 semanas de histórico de pedidos</p>
              </div>
              {forecastData && (
                <span className="text-xs text-muted-foreground">Análise de {forecastData.forecast.length} produtos</span>
              )}
            </div>
            {forecastLoading ? (
              <div className="p-8 text-center text-muted-foreground flex items-center justify-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin" /> Analisando histórico de pedidos...
              </div>
            ) : !forecastData?.forecast.length ? (
              <div className="p-8 text-center text-muted-foreground">
                <BarChart3 className="w-12 h-12 mx-auto mb-3 opacity-30" />
                <p>Histórico insuficiente para gerar previsão.</p>
                <p className="text-xs mt-1">São necessários pedidos das últimas 8 semanas.</p>
              </div>
            ) : (
              <table className="w-full text-sm">
                <thead><tr className="text-muted-foreground text-xs bg-muted/10 border-b border-border/50">
                  <th className="text-left px-5 py-3 font-semibold">Produto</th>
                  <th className="text-right px-5 py-3 font-semibold">Média/Semana</th>
                  <th className="text-right px-5 py-3 font-semibold">Sugestão Compra</th>
                  <th className="text-center px-5 py-3 font-semibold">Tendência</th>
                  <th className="text-right px-5 py-3 font-semibold">Semanas ativas</th>
                </tr></thead>
                <tbody className="divide-y divide-border/40">
                  {forecastData.forecast.slice(0, 30).map(f => (
                    <tr key={f.productName} className="hover:bg-muted/10" data-testid={`forecast-row-${f.productName}`}>
                      <td className="px-5 py-2.5 font-medium">{f.productName}</td>
                      <td className="px-5 py-2.5 text-right font-mono">{f.avgWeekly} un</td>
                      <td className="px-5 py-2.5 text-right font-bold font-mono text-green-700">{f.suggestion} un</td>
                      <td className="px-5 py-2.5 text-center">
                        {f.trend === 'up' ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-bold bg-green-100 text-green-700">
                            <TrendingUp className="w-3 h-3" /> Alta
                          </span>
                        ) : f.trend === 'down' ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-bold bg-red-100 text-red-700">
                            <TrendingDown className="w-3 h-3" /> Queda
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-bold bg-gray-100 text-gray-600">
                            <Minus className="w-3 h-3" /> Estável
                          </span>
                        )}
                      </td>
                      <td className="px-5 py-2.5 text-right text-muted-foreground">{f.weeksActive}/8</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
          <div className="p-4 bg-purple-50 border border-purple-200 rounded-2xl flex items-start gap-3">
            <AlertCircle className="w-4 h-4 text-purple-600 flex-shrink-0 mt-0.5" />
            <p className="text-xs text-purple-700">A sugestão de compra é calculada com base na média histórica + 15% de margem de segurança. Ajuste conforme a sazonalidade e eventos especiais.</p>
          </div>
        </div>
      )}

      {/* ── Tab: Painel de Compras ────────────────────────────────── */}
      {tab === 'panel' && (
        <div className="space-y-4">
          {/* Today */}
          <div className={`bg-card rounded-2xl border-2 overflow-hidden ${todayItems.length > 0 ? 'border-primary' : 'border-border/50'}`}>
            <div className={`px-5 py-3 flex items-center justify-between ${todayItems.length > 0 ? 'bg-primary/10' : 'bg-muted/20'}`}>
              <h3 className="font-bold text-foreground flex items-center gap-2">
                <Zap className={`w-5 h-5 ${todayItems.length > 0 ? 'text-primary' : 'text-muted-foreground'}`} />
                Produtos para Comprar HOJE
                {todayItems.length > 0 && <span className="ml-1 px-2 py-0.5 text-xs font-bold bg-primary text-white rounded-full">{todayItems.length}</span>}
              </h3>
            </div>
            <div className="divide-y divide-border/40">
              {isLoading ? (
                <p className="p-4 text-sm text-muted-foreground">Carregando...</p>
              ) : todayItems.length === 0 ? (
                <p className="p-4 text-sm text-muted-foreground">Nenhum produto com entrega hoje.</p>
              ) : (
                todayItems.map(item => <ProductRow key={`t${item.productName}`} item={item} onStatus={openStatus} />)
              )}
            </div>
          </div>

          {/* Tomorrow */}
          <div className={`bg-card rounded-2xl border-2 overflow-hidden ${tomorrowItems.length > 0 ? 'border-secondary' : 'border-border/50'}`}>
            <div className={`px-5 py-3 flex items-center justify-between ${tomorrowItems.length > 0 ? 'bg-secondary/10' : 'bg-muted/20'}`}>
              <h3 className="font-bold text-foreground flex items-center gap-2">
                <Clock className={`w-5 h-5 ${tomorrowItems.length > 0 ? 'text-secondary' : 'text-muted-foreground'}`} />
                Produtos para Comprar AMANHÃ
                {tomorrowItems.length > 0 && <span className="ml-1 px-2 py-0.5 text-xs font-bold bg-secondary text-white rounded-full">{tomorrowItems.length}</span>}
              </h3>
            </div>
            <div className="divide-y divide-border/40">
              {isLoading ? (
                <p className="p-4 text-sm text-muted-foreground">Carregando...</p>
              ) : tomorrowItems.length === 0 ? (
                <p className="p-4 text-sm text-muted-foreground">Nenhum produto com entrega amanhã.</p>
              ) : (
                tomorrowItems.map(item => <ProductRow key={`m${item.productName}`} item={item} onStatus={openStatus} />)
              )}
            </div>
          </div>

          {/* Pontuais */}
          {specialItems.length > 0 && (
            <div className="bg-card rounded-2xl border-2 border-secondary/40 overflow-hidden">
              <div className="px-5 py-3 bg-secondary/10 flex items-center justify-between">
                <h3 className="font-bold text-foreground flex items-center gap-2">
                  <Star className="w-5 h-5 text-secondary" />
                  Pedidos Pontuais da Semana
                  <span className="px-2 py-0.5 text-xs font-bold bg-secondary text-white rounded-full">{specialItems.length}</span>
                </h3>
              </div>
              <div className="divide-y divide-border/40">
                {specialItems.map(item => <ProductRow key={`sp${item.productName}`} item={item} onStatus={openStatus} />)}
              </div>
            </div>
          )}

          {/* Summary */}
          <div className="bg-card rounded-2xl border border-border/50 p-5">
            <h3 className="font-bold text-foreground mb-4 flex items-center gap-2">
              <ListChecks className="w-4 h-4 text-green-600" /> Resumo da Semana
            </h3>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-center">
              {[
                { label: 'Total de Produtos', value: allItems.length, icon: Package, color: 'text-primary' },
                { label: 'Comprados', value: statusCounts.BOUGHT, icon: CheckCircle, color: 'text-green-600' },
                { label: 'Comprando', value: statusCounts.BUYING, icon: ShoppingCart, color: 'text-blue-600' },
                { label: 'Pendentes', value: statusCounts.PENDING, icon: Clock, color: 'text-yellow-600' },
              ].map(({ label, value, icon: Icon, color }) => (
                <div key={label} className="p-3 bg-muted/20 rounded-xl">
                  <Icon className={`w-5 h-5 ${color} mx-auto mb-1`} />
                  <p className="text-2xl font-bold text-foreground">{value}</p>
                  <p className="text-xs text-muted-foreground">{label}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── Status Dialog ────────────────────────────────────────── */}
      <Dialog open={!!statusDialog} onOpenChange={() => setStatusDialog(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Atualizar Status de Compra</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Produto: <span className="font-bold text-foreground">{statusDialog?.item.productName}</span>
          </p>
          <div className="space-y-4 py-2">
            <div>
              <Label>Status</Label>
              <Select value={statusForm.status} onValueChange={v => setStatusForm(f => ({ ...f, status: v }))}>
                <SelectTrigger data-testid="select-status"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(STATUSES).map(([k, v]) => (
                    <SelectItem key={k} value={k}>{v.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Fornecedor</Label>
              <Input value={statusForm.supplier}
                onChange={e => setStatusForm(f => ({ ...f, supplier: e.target.value }))}
                placeholder="Nome do fornecedor" data-testid="input-supplier" />
            </div>
            <div>
              <Label>Previsão de Chegada</Label>
              <Input type="date" value={statusForm.expectedArrival}
                onChange={e => setStatusForm(f => ({ ...f, expectedArrival: e.target.value }))}
                data-testid="input-expected-arrival" />
            </div>
            <div>
              <Label>Observações</Label>
              <Textarea value={statusForm.notes}
                onChange={e => setStatusForm(f => ({ ...f, notes: e.target.value }))}
                rows={2} placeholder="Informações adicionais..." data-testid="textarea-status-notes" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setStatusDialog(null)}>Cancelar</Button>
            <Button onClick={submitStatus} disabled={upsertMutation.isPending}
              className="bg-green-600 hover:bg-green-700" data-testid="button-submit-status">
              {upsertMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : null}
              Salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
