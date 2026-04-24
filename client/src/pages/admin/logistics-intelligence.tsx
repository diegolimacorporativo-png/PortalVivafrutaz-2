import { useState } from 'react';
import { useLocation } from 'wouter';
import { useQuery, useMutation } from '@tanstack/react-query';
import { useAuth } from '@/hooks/use-auth';
import { queryClient, apiRequest } from '@/lib/queryClient';
import { useToast } from '@/hooks/use-toast';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import {
  Truck, RefreshCw, AlertTriangle, Calendar, CheckCircle, XCircle, BarChart3,
  MapPin, Navigation, Search, Play, Plus, Pencil, Trash2, Route,
  Clock, TrendingUp, Package, User, Car, CheckCircle2, Zap,
} from 'lucide-react';
import type { Delivery } from '@shared/schema';

// ─── Types ─────────────────────────────────────────────────────────────────────
interface DeliveryDay { date: string; count: number; totalValue: number; companies: string[] }
interface RouteCapacity { routeId: number; routeName: string; status: string; hasVehicle: boolean; hasDriver: boolean }
interface LogisticsData {
  activeRoutes: number; totalRoutes: number; unassignedRoutes: number;
  deliverySchedule: DeliveryDay[]; overloadedDays: DeliveryDay[];
  busiestDay: DeliveryDay | null; routeCapacity: RouteCapacity[];
  activeWindow: { weekReference: string } | null;
  totalActiveDeliveries: number; generatedAt: string;
}

interface SimDriver { driverId: number; driverName: string; stops: any[]; totalDistance: number; estimatedMinutes: number }
interface SimResult {
  date: string; drivers: SimDriver[]; unassigned: any[];
  totalDeliveries: number; totalDistance: number; estimatedTotalTime: number; efficiency: number;
  message?: string;
}

interface InsertionSuggestion {
  driverId: number; driverName: string; routeId?: number;
  insertAtPosition: number; extraDistance: number; newTotalDistance: number; reason: string;
}

const STATUS_MAP: Record<string, { label: string; color: string }> = {
  pendente:  { label: 'Pendente',  color: 'bg-yellow-100 text-yellow-800 border-yellow-200' },
  em_rota:   { label: 'Em Rota',   color: 'bg-blue-100 text-blue-800 border-blue-200' },
  entregue:  { label: 'Entregue',  color: 'bg-green-100 text-green-800 border-green-200' },
  cancelado: { label: 'Cancelado', color: 'bg-red-100 text-red-800 border-red-200' },
};

const TABS = [
  { id: 'overview', label: 'Visão Geral', icon: BarChart3 },
  { id: 'simulation', label: 'Simulação de Rota', icon: Route },
  { id: 'cep', label: 'Busca CEP / Geo', icon: MapPin },
  { id: 'deliveries', label: 'Entregas', icon: Package },
  { id: 'smart', label: 'Pesquisa Inteligente', icon: Search },
  { id: 'reports', label: 'Relatórios', icon: TrendingUp },
];

function fmtMin(mins: number): string {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h > 0 ? `${h}h${m > 0 ? ` ${m}min` : ''}` : `${m}min`;
}

// ─── CEP Lookup Panel ──────────────────────────────────────────────────────────
function CepLookupPanel() {
  const { toast } = useToast();
  const [cep, setCep] = useState('');
  const [result, setResult] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [withCoords, setWithCoords] = useState(false);

  async function lookup() {
    if (cep.replace(/\D/g, '').length !== 8) {
      toast({ title: 'CEP inválido', description: 'Informe um CEP com 8 dígitos', variant: 'destructive' });
      return;
    }
    setLoading(true);
    try {
      const endpoint = withCoords ? `/api/geo/cep/${cep}` : `/api/geo/cep-basic/${cep}`;
      const resp = await fetch(endpoint);
      if (!resp.ok) throw new Error('CEP não encontrado');
      setResult(await resp.json());
    } catch (e: any) {
      toast({ title: 'Erro', description: e.message, variant: 'destructive' });
      setResult(null);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="bg-card rounded-2xl border border-border/50 p-6">
        <h2 className="font-bold text-foreground mb-4 flex items-center gap-2">
          <MapPin className="w-5 h-5 text-primary" />
          Busca de Endereço por CEP
        </h2>
        <div className="flex gap-3 flex-wrap">
          <div className="flex-1 min-w-[200px]">
            <Label className="text-xs mb-1 block">CEP</Label>
            <Input
              placeholder="Ex: 01310-100"
              value={cep}
              onChange={e => setCep(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && lookup()}
              data-testid="input-cep-lookup"
            />
          </div>
          <div className="flex items-end gap-2">
            <label className="flex items-center gap-2 cursor-pointer text-sm mb-2">
              <input type="checkbox" checked={withCoords} onChange={e => setWithCoords(e.target.checked)} data-testid="check-with-coords" />
              Buscar coordenadas
            </label>
            <Button type="button" onClick={lookup} disabled={loading} className="mb-0.5" data-testid="button-lookup-cep">
              {loading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
              {loading ? 'Buscando...' : 'Buscar'}
            </Button>
          </div>
        </div>
        {result && (
          <div className="mt-5 p-4 bg-muted/30 rounded-xl border border-border/30 space-y-2">
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-sm">
              <div><p className="text-xs text-muted-foreground">CEP</p><p className="font-medium text-foreground">{result.cep}</p></div>
              <div><p className="text-xs text-muted-foreground">Logradouro</p><p className="font-medium text-foreground">{result.logradouro || '—'}</p></div>
              <div><p className="text-xs text-muted-foreground">Bairro</p><p className="font-medium text-foreground">{result.bairro || '—'}</p></div>
              <div><p className="text-xs text-muted-foreground">Cidade / UF</p><p className="font-medium text-foreground">{result.localidade} / {result.uf}</p></div>
              {result.latitude && (
                <div><p className="text-xs text-muted-foreground">Latitude</p><p className="font-mono text-foreground text-xs">{result.latitude}</p></div>
              )}
              {result.longitude && (
                <div><p className="text-xs text-muted-foreground">Longitude</p><p className="font-mono text-foreground text-xs">{result.longitude}</p></div>
              )}
            </div>
            {result.latitude && result.longitude && (
              <a
                href={`https://www.google.com/maps/search/?api=1&query=${result.latitude},${result.longitude}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-xs text-primary hover:underline mt-2"
                data-testid="link-open-maps"
              >
                <Navigation className="w-3 h-3" />
                Ver no Google Maps
              </a>
            )}
          </div>
        )}
      </div>

      <div className="bg-card rounded-2xl border border-border/50 p-6">
        <h2 className="font-bold text-foreground mb-4 flex items-center gap-2">
          <Navigation className="w-5 h-5 text-primary" />
          Calcular Distância
        </h2>
        <DistanceCalculator />
      </div>
    </div>
  );
}

function DistanceCalculator() {
  const { toast } = useToast();
  const [from, setFrom] = useState({ lat: '', lng: '' });
  const [to, setTo] = useState({ lat: '', lng: '' });
  const [result, setResult] = useState<{ distanceKm: number; distanceM: number } | null>(null);

  async function calculate() {
    try {
      const resp = await fetch('/api/logistics/calculate-distance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: { lat: parseFloat(from.lat), lng: parseFloat(from.lng) },
          to: { lat: parseFloat(to.lat), lng: parseFloat(to.lng) },
        }),
      });
      if (!resp.ok) throw new Error('Erro ao calcular distância');
      setResult(await resp.json());
    } catch (e: any) {
      toast({ title: 'Erro', description: e.message, variant: 'destructive' });
    }
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <p className="text-sm font-medium text-foreground">Ponto A (origem)</p>
          <Input placeholder="Latitude (ex: -23.55)" value={from.lat} onChange={e => setFrom(f => ({ ...f, lat: e.target.value }))} data-testid="input-from-lat" />
          <Input placeholder="Longitude (ex: -46.63)" value={from.lng} onChange={e => setFrom(f => ({ ...f, lng: e.target.value }))} data-testid="input-from-lng" />
        </div>
        <div className="space-y-2">
          <p className="text-sm font-medium text-foreground">Ponto B (destino)</p>
          <Input placeholder="Latitude" value={to.lat} onChange={e => setTo(t => ({ ...t, lat: e.target.value }))} data-testid="input-to-lat" />
          <Input placeholder="Longitude" value={to.lng} onChange={e => setTo(t => ({ ...t, lng: e.target.value }))} data-testid="input-to-lng" />
        </div>
      </div>
      <Button type="button" onClick={calculate} data-testid="button-calc-distance">
        <Navigation className="w-4 h-4 mr-2" />
        Calcular Distância
      </Button>
      {result && (
        <div className="p-4 bg-primary/5 rounded-xl border border-primary/20 flex items-center gap-6">
          <div>
            <p className="text-2xl font-bold text-primary">{result.distanceKm.toFixed(2)} km</p>
            <p className="text-xs text-muted-foreground">{result.distanceM.toLocaleString('pt-BR')} metros</p>
          </div>
          <div className="text-xs text-muted-foreground">
            Tempo estimado: ~{Math.round((result.distanceKm / 35) * 60)} min a 35 km/h médios
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Route Simulation Panel ────────────────────────────────────────────────────
const ORDER_STATUS_COLORS: Record<string, string> = {
  pendente: 'bg-yellow-100 text-yellow-800 border-yellow-200',
  entregue: 'bg-green-100 text-green-800 border-green-200',
  cancelado: 'bg-red-100 text-red-800 border-red-200',
};

function SimulationPanel() {
  const { toast } = useToast();
  const [simDate, setSimDate] = useState(new Date().toISOString().split('T')[0]);
  const [simResult, setSimResult] = useState<SimResult & { ordersBridged?: any[]; withoutCoords?: any[] } | null>(null);
  const [simLoading, setSimLoading] = useState(false);
  const [manualCep, setManualCep] = useState('');
  const [manualLoading, setManualLoading] = useState(false);
  const [manualPoint, setManualPoint] = useState<any>(null);

  const { data: dayData, isLoading: dayLoading, refetch: refetchDay } = useQuery<any>({
    queryKey: ['/api/logistics/day-orders', simDate],
    queryFn: () => fetch(`/api/logistics/day-orders?date=${simDate}`, { credentials: 'include' }).then(r => r.json()),
    enabled: !!simDate,
  });

  async function runSimulation() {
    setSimLoading(true);
    try {
      const resp = await fetch('/api/logistics/simulate-day', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date: simDate }),
      });
      if (!resp.ok) throw new Error('Erro na simulação');
      const data = await resp.json();
      setSimResult(data);
      if (data.message) {
        toast({ title: 'Atenção', description: data.message });
      }
    } catch (e: any) {
      toast({ title: 'Erro na simulação', description: e.message, variant: 'destructive' });
    } finally {
      setSimLoading(false);
    }
  }

  async function addManualPoint() {
    const cleanCep = manualCep.replace(/\D/g, '');
    if (cleanCep.length !== 8) {
      toast({ title: 'CEP inválido', description: 'Informe 8 dígitos', variant: 'destructive' });
      return;
    }
    setManualLoading(true);
    try {
      const resp = await fetch(`/api/geo/cep/${cleanCep}`);
      if (!resp.ok) throw new Error('CEP não encontrado');
      const geo = await resp.json();
      if (!geo.latitude || !geo.longitude) throw new Error('Coordenadas não disponíveis para este CEP');
      setManualPoint({
        cep: cleanCep,
        lat: parseFloat(geo.latitude),
        lng: parseFloat(geo.longitude),
        address: [geo.logradouro, geo.bairro, geo.localidade].filter(Boolean).join(', '),
      });
      toast({ title: 'Ponto adicionado!', description: geo.localidade });
    } catch (e: any) {
      toast({ title: 'Erro', description: e.message, variant: 'destructive' });
    } finally {
      setManualLoading(false);
    }
  }

  const orders: any[] = dayData?.orders || [];
  const activeOrders = orders.filter((o: any) => o.deliveryStatus !== 'cancelado');
  const noOrdersForDate = !dayLoading && orders.length === 0;

  const totalOrders = activeOrders.length;
  const withCoords = activeOrders.filter((o: any) => o.hasCoords).length;
  const withoutCoords = activeOrders.filter((o: any) => !o.hasCoords).length;

  const fmtCurrency = (v: string | number) =>
    Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

  return (
    <div className="space-y-6">

      {/* ─── Seletor de Data + Carregar ─── */}
      <div className="bg-card rounded-2xl border border-border/50 p-6">
        <h2 className="font-bold text-foreground mb-4 flex items-center gap-2">
          <Calendar className="w-5 h-5 text-primary" />
          Pedidos do Dia
        </h2>
        <div className="flex gap-3 flex-wrap items-end">
          <div>
            <Label className="text-xs mb-1 block">Data</Label>
            <Input
              type="date"
              value={simDate}
              onChange={e => { setSimDate(e.target.value); setSimResult(null); }}
              className="w-44"
              data-testid="input-sim-date"
            />
          </div>
          <Button
            type="button"
            variant="outline"
            onClick={() => refetchDay()}
            disabled={dayLoading}
            data-testid="button-refresh-day-orders"
          >
            {dayLoading ? <RefreshCw className="w-4 h-4 mr-2 animate-spin" /> : <RefreshCw className="w-4 h-4 mr-2" />}
            Atualizar
          </Button>
          <Button
            type="button"
            onClick={runSimulation}
            disabled={simLoading || totalOrders === 0}
            data-testid="button-simulate-route"
          >
            {simLoading ? <RefreshCw className="w-4 h-4 mr-2 animate-spin" /> : <Play className="w-4 h-4 mr-2" />}
            {simLoading ? 'Gerando Sugestão...' : 'Gerar Sugestão de Rota'}
          </Button>
        </div>

        {/* ─── Resumo do dia ─── */}
        {!dayLoading && dayData && (
          <div className="mt-5 grid grid-cols-3 gap-3">
            {[
              { label: 'Pedidos no dia', value: totalOrders, icon: Package, color: 'text-blue-600 bg-blue-50' },
              { label: 'Com coordenadas', value: withCoords, icon: MapPin, color: 'text-green-600 bg-green-50' },
              { label: 'Sem coordenadas', value: withoutCoords, icon: AlertTriangle, color: withoutCoords > 0 ? 'text-amber-600 bg-amber-50' : 'text-gray-400 bg-gray-50' },
            ].map(k => (
              <div key={k.label} className="bg-muted/30 rounded-xl p-3 flex items-center gap-3">
                <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${k.color}`}>
                  <k.icon className="w-4 h-4" />
                </div>
                <div>
                  <p className="text-xl font-bold text-foreground">{k.value}</p>
                  <p className="text-[11px] text-muted-foreground">{k.label}</p>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* ─── Empty state ─── */}
        {noOrdersForDate && (
          <div className="mt-6 text-center py-8 text-muted-foreground">
            <Package className="w-10 h-10 mx-auto mb-2 opacity-30" />
            <p className="font-medium">Nenhum pedido encontrado para essa data</p>
            <p className="text-xs mt-1">Selecione outra data ou cadastre pedidos com essa data de entrega</p>
          </div>
        )}
      </div>

      {/* ─── Lista de Pedidos / Paradas ─── */}
      {activeOrders.length > 0 && (
        <div className="bg-card rounded-2xl border border-border/50 p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-bold text-foreground flex items-center gap-2">
              <MapPin className="w-5 h-5 text-primary" />
              Lista de Paradas
            </h2>
            <span className="text-xs text-muted-foreground">
              {activeOrders.length} entrega(s) • {simDate.split('-').reverse().join('/')}
            </span>
          </div>

          {withoutCoords > 0 && (
            <div className="mb-4 p-3 bg-amber-50 border border-amber-200 rounded-lg flex items-start gap-2 text-sm text-amber-800">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>
                <strong>{withoutCoords} pedido(s)</strong> sem coordenadas cadastradas na empresa.
                Para incluir na rota, acesse o cadastro da empresa e preencha o endereço com latitude/longitude.
              </span>
            </div>
          )}

          <div className="space-y-2">
            {activeOrders.map((order: any, idx: number) => (
              <div
                key={order.orderId}
                className={`flex items-start gap-3 p-3 rounded-lg border transition-colors ${
                  order.hasCoords
                    ? 'border-green-200 bg-green-50/50 dark:bg-green-950/10 dark:border-green-900'
                    : 'border-amber-200 bg-amber-50/40 dark:bg-amber-950/10 dark:border-amber-900'
                }`}
                data-testid={`order-stop-${order.orderId}`}
              >
                <div className={`w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-bold shrink-0 mt-0.5 ${
                  order.hasCoords ? 'bg-green-600 text-white' : 'bg-amber-400 text-amber-900'
                }`}>
                  {order.hasCoords ? idx + 1 : '!'}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="font-semibold text-foreground text-sm truncate">{order.companyName}</p>
                    <span className="text-[10px] font-mono text-muted-foreground">{order.orderCode}</span>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded-full border font-medium ${ORDER_STATUS_COLORS[order.deliveryStatus] || ''}`}>
                      {order.deliveryStatus === 'pendente' ? 'Pendente' : order.deliveryStatus === 'entregue' ? 'Entregue' : 'Cancelado'}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5 truncate">
                    {order.address || 'Endereço não cadastrado'}
                    {order.addressZip && ` • CEP: ${order.addressZip}`}
                  </p>
                  <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                    {order.deliveryTime && <span className="flex items-center gap-1"><Clock className="w-3 h-3" />{order.deliveryTime}</span>}
                    {order.totalValue && <span className="font-medium text-foreground">{fmtCurrency(order.totalValue)}</span>}
                    {!order.hasCoords && (
                      <span className="text-amber-600 flex items-center gap-1">
                        <AlertTriangle className="w-3 h-3" />Sem coordenadas
                      </span>
                    )}
                  </div>
                </div>
                {order.latitude && order.longitude && (
                  <a
                    href={`https://www.google.com/maps/search/?api=1&query=${order.latitude},${order.longitude}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="shrink-0 p-1.5 rounded hover:bg-green-100 text-green-700 transition-colors"
                    title="Ver no Google Maps"
                    data-testid={`link-maps-${order.orderId}`}
                  >
                    <Navigation className="w-4 h-4" />
                  </a>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ─── Resultado da Simulação ─── */}
      {simResult && (
        <div className="bg-card rounded-2xl border border-border/50 p-6">
          <h2 className="font-bold text-foreground mb-4 flex items-center gap-2">
            <Route className="w-5 h-5 text-primary" />
            Sugestão de Rota Gerada
          </h2>

          {simResult.message && (
            <div className="mb-4 p-3 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-800 flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{simResult.message}</span>
            </div>
          )}

          {/* KPI Cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
            {[
              { label: 'Total de Entregas', value: simResult.totalDeliveries, icon: Package, color: 'text-blue-600 bg-blue-50' },
              { label: 'Distância Total', value: `${simResult.totalDistance.toFixed(1)} km`, icon: Route, color: 'text-purple-600 bg-purple-50' },
              { label: 'Tempo Estimado', value: fmtMin(simResult.estimatedTotalTime), icon: Clock, color: 'text-orange-600 bg-orange-50' },
              { label: 'Eficiência', value: `${simResult.efficiency}/10`, icon: TrendingUp, color: 'text-green-600 bg-green-50' },
            ].map(k => (
              <div key={k.label} className="bg-muted/30 rounded-xl p-3">
                <div className={`w-8 h-8 rounded-lg flex items-center justify-center mb-2 ${k.color}`}>
                  <k.icon className="w-4 h-4" />
                </div>
                <p className="text-lg font-bold text-foreground">{k.value}</p>
                <p className="text-[11px] text-muted-foreground">{k.label}</p>
              </div>
            ))}
          </div>

          {/* Driver routes */}
          <div className="space-y-3">
            {simResult.drivers.map(d => (
              <div key={d.driverId} className="border border-border/40 rounded-xl p-4">
                <div className="flex items-center gap-3 mb-3">
                  <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
                    <User className="w-4 h-4 text-primary" />
                  </div>
                  <div className="flex-1">
                    <p className="font-semibold text-foreground text-sm">{d.driverName}</p>
                    <p className="text-xs text-muted-foreground">
                      {d.stops.length} paradas • {d.totalDistance.toFixed(1)} km • {fmtMin(d.estimatedMinutes)}
                    </p>
                  </div>
                  <Badge variant="outline" className="text-[10px]">{d.stops.length} entregas</Badge>
                </div>
                {d.stops.length > 0 ? (
                  <div className="space-y-1.5 pl-11">
                    {d.stops.map((s: any, i: number) => (
                      <div key={i} className="flex items-start gap-2 text-xs">
                        <span className="w-5 h-5 rounded-full bg-primary/10 text-primary flex items-center justify-center text-[10px] font-bold shrink-0 mt-0.5">
                          {i + 1}
                        </span>
                        <div className="flex-1">
                          <span className="text-foreground font-medium">{s.label || `Parada ${i + 1}`}</span>
                          {s.address && <p className="text-muted-foreground">{s.address}</p>}
                        </div>
                        {s.distanceFromPrev !== undefined && (
                          <span className="text-muted-foreground ml-auto shrink-0">+{s.distanceFromPrev.toFixed(1)}km</span>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground pl-11">Sem paradas atribuídas</p>
                )}
              </div>
            ))}
            {simResult.drivers.length === 0 && (
              <div className="text-center text-muted-foreground text-sm py-6 border border-dashed border-border rounded-xl">
                <User className="w-8 h-8 mx-auto mb-2 opacity-30" />
                Nenhum motorista ativo encontrado.
                <br />
                <span className="text-xs">Cadastre motoristas na aba Logística para gerar rotas automáticas.</span>
              </div>
            )}
          </div>

          {/* Orders sem coords (sem rota) */}
          {simResult.withoutCoords && simResult.withoutCoords.length > 0 && (
            <div className="mt-4 p-4 bg-amber-50 border border-amber-200 rounded-xl">
              <p className="text-sm font-semibold text-amber-800 mb-2 flex items-center gap-2">
                <AlertTriangle className="w-4 h-4" />
                {simResult.withoutCoords.length} pedido(s) fora da rota (sem coordenadas)
              </p>
              <div className="space-y-1">
                {simResult.withoutCoords.map((o: any) => (
                  <div key={o.orderId} className="text-xs text-amber-700 flex items-center gap-2">
                    <span className="font-mono">{o.orderCode}</span>
                    <span>•</span>
                    <span>{o.companyName}</span>
                    {o.addressZip && <span className="text-amber-500">CEP: {o.addressZip}</span>}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ─── Inserção Manual de Ponto ─── */}
      <div className="bg-card rounded-2xl border border-border/50 p-6">
        <h2 className="font-bold text-foreground mb-2 flex items-center gap-2">
          <Plus className="w-5 h-5 text-primary" />
          Adicionar Ponto Manual por CEP
        </h2>
        <p className="text-sm text-muted-foreground mb-4">
          Adicione um endereço via CEP para incluir na rota do dia
        </p>
        <div className="flex gap-3 items-end flex-wrap">
          <div>
            <Label className="text-xs mb-1 block">CEP</Label>
            <Input
              placeholder="Ex: 04715-005"
              value={manualCep}
              onChange={e => setManualCep(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && addManualPoint()}
              className="w-44"
              data-testid="input-manual-cep"
            />
          </div>
          <Button type="button" onClick={addManualPoint} disabled={manualLoading} variant="outline" data-testid="button-add-manual-point">
            {manualLoading ? <RefreshCw className="w-4 h-4 mr-2 animate-spin" /> : <Navigation className="w-4 h-4 mr-2" />}
            {manualLoading ? 'Buscando...' : 'Buscar e Adicionar'}
          </Button>
        </div>
        {manualPoint && (
          <div className="mt-4 p-3 bg-primary/5 border border-primary/20 rounded-lg flex items-start gap-3">
            <CheckCircle2 className="w-5 h-5 text-primary shrink-0 mt-0.5" />
            <div className="text-sm">
              <p className="font-semibold text-foreground">{manualPoint.address}</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Lat: {manualPoint.lat.toFixed(6)}, Lng: {manualPoint.lng.toFixed(6)}
              </p>
              <a
                href={`https://www.google.com/maps/search/?api=1&query=${manualPoint.lat},${manualPoint.lng}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-xs text-primary hover:underline mt-1"
              >
                <Navigation className="w-3 h-3" /> Ver no Maps
              </a>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Deliveries Panel ─────────────────────────────────────────────────────────
function DeliveriesPanel() {
  const { toast } = useToast();
  const [filterStatus, setFilterStatus] = useState('');
  const [filterDate, setFilterDate] = useState('');
  const [editDelivery, setEditDelivery] = useState<Delivery | null>(null);
  const [newDelivery, setNewDelivery] = useState(false);

  const { data: deliveries = [], isLoading, refetch } = useQuery<Delivery[]>({
    queryKey: ['/api/deliveries', filterStatus, filterDate],
    queryFn: () => {
      const params = new URLSearchParams();
      if (filterStatus) params.set('status', filterStatus);
      if (filterDate) params.set('date', filterDate);
      return fetch(`/api/deliveries?${params}`).then(r => r.json());
    },
  });

  const updateStatusMutation = useMutation({
    mutationFn: ({ id, status }: { id: number; status: string }) =>
      apiRequest('PATCH', `/api/deliveries/${id}/status`, { status }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/deliveries'] });
      toast({ title: 'Status atualizado!' });
    },
    onError: (e: any) => toast({ title: 'Erro', description: e.message, variant: 'destructive' }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiRequest('DELETE', `/api/deliveries/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/deliveries'] });
      toast({ title: 'Entrega removida' });
    },
    onError: (e: any) => toast({ title: 'Erro', description: e.message, variant: 'destructive' }),
  });

  const statusCounts = Object.keys(STATUS_MAP).reduce((acc, s) => {
    acc[s] = deliveries.filter(d => d.status === s).length;
    return acc;
  }, {} as Record<string, number>);

  return (
    <div className="space-y-4">
      {/* Status summary */}
      <div className="flex gap-2 flex-wrap">
        {Object.entries(STATUS_MAP).map(([k, v]) => (
          <button
            key={k}
            type="button"
            onClick={() => setFilterStatus(filterStatus === k ? '' : k)}
            className={`px-3 py-1.5 rounded-full text-[11px] font-medium border transition-opacity ${v.color} ${filterStatus === k ? 'opacity-100 ring-2 ring-offset-1 ring-primary' : 'opacity-80 hover:opacity-100'}`}
            data-testid={`filter-status-${k}`}
          >
            {v.label} ({statusCounts[k] || 0})
          </button>
        ))}
      </div>

      {/* Filters + New */}
      <div className="flex gap-3 items-end flex-wrap justify-between">
        <div className="flex gap-3 items-end flex-wrap">
          <div>
            <Label className="text-xs mb-1 block">Data da Entrega</Label>
            <Input type="date" value={filterDate} onChange={e => setFilterDate(e.target.value)} className="w-44 h-8 text-sm" data-testid="filter-delivery-date" />
          </div>
          <Button type="button" variant="ghost" size="sm" className="h-8" onClick={() => { setFilterStatus(''); setFilterDate(''); }} data-testid="button-clear-filters">
            Limpar Filtros
          </Button>
        </div>
        <Button type="button" size="sm" onClick={() => setNewDelivery(true)} data-testid="button-new-delivery">
          <Plus className="w-4 h-4 mr-1" /> Nova Entrega
        </Button>
      </div>

      {/* Table */}
      <div className="bg-card rounded-2xl border border-border/50">
        <div className="p-4 border-b border-border/50 flex items-center gap-2">
          <Package className="w-4 h-4 text-primary" />
          <h2 className="font-bold text-foreground">Entregas</h2>
          <Badge variant="outline" className="ml-auto">{deliveries.length}</Badge>
          <Button type="button" variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => refetch()} data-testid="button-refresh-deliveries">
            <RefreshCw className="w-3.5 h-3.5" />
          </Button>
        </div>
        {isLoading ? (
          <div className="p-8 text-center text-muted-foreground">Carregando...</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/30">
                <tr>
                  <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground">#ID</th>
                  <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground">Status</th>
                  <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground">Data</th>
                  <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground">Endereço</th>
                  <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground">Coordenadas</th>
                  <th className="px-4 py-2.5 text-right text-xs font-medium text-muted-foreground">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/40">
                {deliveries.map(d => {
                  const s = STATUS_MAP[d.status] || { label: d.status, color: 'bg-gray-100 text-gray-700' };
                  return (
                    <tr key={d.id} className="hover:bg-muted/20" data-testid={`row-delivery-${d.id}`}>
                      <td className="px-4 py-3 text-muted-foreground font-mono text-xs">#{d.id}{d.orderId ? ` / P#${d.orderId}` : ''}</td>
                      <td className="px-4 py-3">
                        <Select value={d.status} onValueChange={status => updateStatusMutation.mutate({ id: d.id, status })}>
                          <SelectTrigger className={`h-7 w-32 text-xs border-0 ${s.color}`} data-testid={`select-status-${d.id}`}><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {Object.entries(STATUS_MAP).map(([k, v]) => <SelectItem key={k} value={k}>{v.label}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground text-xs">{d.scheduledDate || '—'}</td>
                      <td className="px-4 py-3 text-foreground text-xs max-w-[200px]">
                        {[d.addressStreet, d.addressNumber, d.addressCity].filter(Boolean).join(', ') || '—'}
                        {d.addressZip && <span className="text-muted-foreground ml-1">({d.addressZip})</span>}
                      </td>
                      <td className="px-4 py-3 font-mono text-[10px] text-muted-foreground">
                        {d.latitude && d.longitude ? `${parseFloat(d.latitude!).toFixed(4)}, ${parseFloat(d.longitude!).toFixed(4)}` : '—'}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center gap-1 justify-end">
                          <Button type="button" size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => setEditDelivery(d)} data-testid={`button-edit-delivery-${d.id}`}>
                            <Pencil className="w-3.5 h-3.5" />
                          </Button>
                          <Button type="button" size="sm" variant="ghost" className="h-7 w-7 p-0 text-destructive" onClick={() => {
                            if (confirm('Remover esta entrega?')) deleteMutation.mutate(d.id);
                          }} data-testid={`button-delete-delivery-${d.id}`}>
                            <Trash2 className="w-3.5 h-3.5" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {deliveries.length === 0 && (
                  <tr><td colSpan={6} className="px-4 py-10 text-center text-muted-foreground text-sm">Nenhuma entrega encontrada</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Edit/New Delivery Modal */}
      {(editDelivery || newDelivery) && (
        <DeliveryModal
          delivery={editDelivery}
          onClose={() => { setEditDelivery(null); setNewDelivery(false); }}
        />
      )}
    </div>
  );
}

function DeliveryModal({ delivery, onClose }: { delivery?: Delivery | null; onClose: () => void }) {
  const { toast } = useToast();
  const [form, setForm] = useState<any>(delivery ? {
    scheduledDate: delivery.scheduledDate || '',
    status: delivery.status,
    addressStreet: delivery.addressStreet || '',
    addressNumber: delivery.addressNumber || '',
    addressCity: delivery.addressCity || '',
    addressState: delivery.addressState || '',
    addressZip: delivery.addressZip || '',
    latitude: delivery.latitude || '',
    longitude: delivery.longitude || '',
    notes: delivery.notes || '',
  } : { scheduledDate: '', status: 'pendente', addressStreet: '', addressNumber: '', addressCity: '', addressState: '', addressZip: '', latitude: '', longitude: '', notes: '' });

  const [cepLoading, setCepLoading] = useState(false);

  async function fillFromCep() {
    if (!form.addressZip) return;
    setCepLoading(true);
    try {
      const resp = await fetch(`/api/geo/cep/${form.addressZip}`);
      if (!resp.ok) throw new Error('CEP não encontrado');
      const geo = await resp.json();
      setForm((f: any) => ({
        ...f,
        addressStreet: geo.logradouro || f.addressStreet,
        addressCity: geo.localidade || f.addressCity,
        addressState: geo.uf || f.addressState,
        latitude: geo.latitude ? String(geo.latitude) : f.latitude,
        longitude: geo.longitude ? String(geo.longitude) : f.longitude,
      }));
    } catch { toast({ title: 'CEP não encontrado', variant: 'destructive' }); }
    finally { setCepLoading(false); }
  }

  const saveMutation = useMutation({
    mutationFn: () => delivery
      ? apiRequest('PUT', `/api/deliveries/${delivery.id}`, form)
      : apiRequest('POST', '/api/deliveries', form),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/deliveries'] });
      toast({ title: delivery ? 'Entrega atualizada!' : 'Entrega criada!' });
      onClose();
    },
    onError: (e: any) => toast({ title: 'Erro', description: e.message, variant: 'destructive' }),
  });

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{delivery ? 'Editar Entrega' : 'Nova Entrega'}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2 max-h-[70vh] overflow-y-auto pr-1">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Data Agendada</Label>
              <Input type="date" value={form.scheduledDate} onChange={e => setForm((f: any) => ({ ...f, scheduledDate: e.target.value }))} data-testid="input-delivery-date" />
            </div>
            <div>
              <Label className="text-xs">Status</Label>
              <Select value={form.status} onValueChange={v => setForm((f: any) => ({ ...f, status: v }))}>
                <SelectTrigger data-testid="select-delivery-status"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(STATUS_MAP).map(([k, v]) => <SelectItem key={k} value={k}>{v.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div>
            <Label className="text-xs">CEP</Label>
            <div className="flex gap-2">
              <Input value={form.addressZip} onChange={e => setForm((f: any) => ({ ...f, addressZip: e.target.value }))} placeholder="01310-100" data-testid="input-delivery-zip" />
              <Button type="button" variant="outline" size="sm" onClick={fillFromCep} disabled={cepLoading} data-testid="button-fill-cep">
                {cepLoading ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Search className="w-3.5 h-3.5" />}
              </Button>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-2">
              <Label className="text-xs">Logradouro</Label>
              <Input value={form.addressStreet} onChange={e => setForm((f: any) => ({ ...f, addressStreet: e.target.value }))} data-testid="input-delivery-street" />
            </div>
            <div>
              <Label className="text-xs">Número</Label>
              <Input value={form.addressNumber} onChange={e => setForm((f: any) => ({ ...f, addressNumber: e.target.value }))} data-testid="input-delivery-number" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Cidade</Label>
              <Input value={form.addressCity} onChange={e => setForm((f: any) => ({ ...f, addressCity: e.target.value }))} data-testid="input-delivery-city" />
            </div>
            <div>
              <Label className="text-xs">Estado (UF)</Label>
              <Input value={form.addressState} onChange={e => setForm((f: any) => ({ ...f, addressState: e.target.value }))} maxLength={2} data-testid="input-delivery-state" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Latitude</Label>
              <Input type="number" step="any" value={form.latitude} onChange={e => setForm((f: any) => ({ ...f, latitude: e.target.value }))} placeholder="-23.55" data-testid="input-delivery-lat" />
            </div>
            <div>
              <Label className="text-xs">Longitude</Label>
              <Input type="number" step="any" value={form.longitude} onChange={e => setForm((f: any) => ({ ...f, longitude: e.target.value }))} placeholder="-46.63" data-testid="input-delivery-lng" />
            </div>
          </div>
          <div>
            <Label className="text-xs">Observações</Label>
            <Input value={form.notes} onChange={e => setForm((f: any) => ({ ...f, notes: e.target.value }))} data-testid="input-delivery-notes" />
          </div>
          <div className="flex gap-2 pt-2">
            <Button type="button" variant="outline" onClick={onClose} className="flex-1">Cancelar</Button>
            <Button type="button" onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending} className="flex-1" data-testid="button-save-delivery">
              {saveMutation.isPending ? 'Salvando...' : 'Salvar'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Overview Panel (original logistics intelligence) ─────────────────────────
const OVERLOAD_THRESHOLD = 5;

function OverviewPanel() {
  const { data, isLoading, refetch, isFetching } = useQuery<LogisticsData>({
    queryKey: ['/api/logistics-intelligence'],
    refetchInterval: 5 * 60 * 1000,
  });

  const schedule = data?.deliverySchedule || [];
  const maxCount = schedule.length > 0 ? Math.max(...schedule.map(d => d.count), 1) : 1;

  if (isLoading) return <div className="p-8 text-center text-muted-foreground">Carregando...</div>;

  return (
    <div className="space-y-6">
      {/* Stats grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {[
          { label: 'Rotas Ativas', value: data?.activeRoutes ?? 0, icon: Truck, color: 'text-blue-600 bg-blue-50' },
          { label: 'Total de Rotas', value: data?.totalRoutes ?? 0, icon: BarChart3, color: 'text-indigo-600 bg-indigo-50' },
          { label: 'Sem Atribuição', value: data?.unassignedRoutes ?? 0, icon: AlertTriangle, color: 'text-amber-600 bg-amber-50' },
          { label: 'Entregas Ativas', value: data?.totalActiveDeliveries ?? 0, icon: Calendar, color: 'text-green-600 bg-green-50' },
        ].map(s => (
          <div key={s.label} className="bg-card rounded-xl border border-border/50 p-4">
            <div className={`w-9 h-9 rounded-lg flex items-center justify-center mb-2 ${s.color}`}>
              <s.icon className="w-5 h-5" />
            </div>
            <p className="text-2xl font-bold text-foreground">{s.value}</p>
            <p className="text-xs text-muted-foreground">{s.label}</p>
          </div>
        ))}
      </div>

      {/* Delivery schedule bar chart */}
      {schedule.length > 0 && (
        <div className="bg-card rounded-2xl border border-border/50 p-5">
          <h2 className="font-bold text-foreground mb-4 flex items-center gap-2">
            <Calendar className="w-5 h-5 text-primary" />
            Agenda de Entregas — Próximas Semanas
          </h2>
          <div className="space-y-2">
            {schedule.slice(0, 12).map(d => {
              const isOverloaded = d.count >= OVERLOAD_THRESHOLD;
              const pct = maxCount > 0 ? (d.count / maxCount) * 100 : 0;
              return (
                <div key={d.date} className="flex items-center gap-3">
                  <span className="text-xs text-muted-foreground w-24 shrink-0">
                    {new Date(d.date + 'T12:00:00').toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit' })}
                  </span>
                  <div className="flex-1 bg-muted/40 rounded-full h-5 overflow-hidden">
                    <div
                      className={`h-full rounded-full flex items-center px-2 transition-all ${isOverloaded ? 'bg-red-500' : 'bg-primary'}`}
                      style={{ width: `${Math.max(pct, 3)}%` }}
                    />
                  </div>
                  <span className={`text-xs font-bold w-6 text-right ${isOverloaded ? 'text-red-600' : 'text-foreground'}`}>{d.count}</span>
                  {isOverloaded && <AlertTriangle className="w-3.5 h-3.5 text-red-500 shrink-0" />}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Route capacity */}
      {data?.routeCapacity && data.routeCapacity.length > 0 && (
        <div className="bg-card rounded-2xl border border-border/50 p-5">
          <h2 className="font-bold text-foreground mb-4 flex items-center gap-2">
            <Truck className="w-5 h-5 text-primary" />
            Capacidade das Rotas
          </h2>
          <div className="divide-y divide-border/40">
            {data.routeCapacity.map(r => (
              <div key={r.routeId} className="py-3 flex items-center gap-3">
                <div className="flex-1">
                  <p className="font-medium text-foreground text-sm">{r.routeName}</p>
                  <p className="text-xs text-muted-foreground">{r.status}</p>
                </div>
                <div className="flex items-center gap-2">
                  <span title="Motorista" className={`flex items-center gap-1 text-xs ${r.hasDriver ? 'text-green-600' : 'text-red-500'}`}>
                    <User className="w-3 h-3" />
                    {r.hasDriver ? 'OK' : 'Falta'}
                  </span>
                  <span title="Veículo" className={`flex items-center gap-1 text-xs ${r.hasVehicle ? 'text-green-600' : 'text-red-500'}`}>
                    <Car className="w-3 h-3" />
                    {r.hasVehicle ? 'OK' : 'Falta'}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Reports Panel ─────────────────────────────────────────────────────────────
function ReportsPanel() {
  const { toast } = useToast();
  const [filters, setFilters] = useState({ companyId: '', driverId: '', startDate: '', endDate: '', status: '' });
  const [reportData, setReportData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [dayReportDate, setDayReportDate] = useState(new Date().toISOString().split('T')[0]);
  const [dayReport, setDayReport] = useState<any>(null);
  const [dayReportLoading, setDayReportLoading] = useState(false);

  const driversQuery = useQuery<any[]>({ queryKey: ['/api/logistics/drivers'] });
  const drivers = driversQuery.data || [];

  async function loadDayReport() {
    setDayReportLoading(true);
    try {
      const resp = await fetch(`/api/logistics/day-orders?date=${dayReportDate}`, { credentials: 'include' });
      if (!resp.ok) throw new Error('Erro ao carregar pedidos');
      setDayReport(await resp.json());
    } catch (e: any) {
      toast({ title: 'Erro', description: e.message, variant: 'destructive' });
    } finally { setDayReportLoading(false); }
  }

  async function loadReport() {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (filters.companyId) params.set('companyId', filters.companyId);
      if (filters.driverId) params.set('driverId', filters.driverId);
      if (filters.startDate) params.set('startDate', filters.startDate);
      if (filters.endDate) params.set('endDate', filters.endDate);
      if (filters.status) params.set('status', filters.status);

      const resp = await fetch(`/api/logistics/reports/deliveries?${params.toString()}`);
      if (!resp.ok) throw new Error('Erro ao carregar relatório');
      setReportData(await resp.json());
    } catch (e: any) {
      toast({ title: 'Erro', description: e.message, variant: 'destructive' });
    } finally { setLoading(false); }
  }

  const statusColors: Record<string, string> = {
    pendente: 'text-yellow-700 bg-yellow-50',
    em_rota: 'text-blue-700 bg-blue-50',
    entregue: 'text-green-700 bg-green-50',
    cancelado: 'text-red-700 bg-red-50',
  };

  const fmtCurr = (v: any) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  const dayOrders = dayReport?.orders || [];
  const dayActive = dayOrders.filter((o: any) => o.deliveryStatus !== 'cancelado');

  return (
    <div className="space-y-6">

      {/* ─── Relatório de Rota do Dia ─── */}
      <div className="bg-card rounded-2xl border border-border/50 p-6">
        <h2 className="font-bold text-foreground mb-4 flex items-center gap-2">
          <Route className="w-5 h-5 text-primary" />
          Relatório de Rota do Dia
        </h2>
        <div className="flex gap-3 items-end flex-wrap mb-4">
          <div>
            <Label className="text-xs mb-1 block">Data</Label>
            <Input type="date" value={dayReportDate} onChange={e => setDayReportDate(e.target.value)} className="w-44" data-testid="input-day-report-date" />
          </div>
          <Button type="button" onClick={loadDayReport} disabled={dayReportLoading} data-testid="button-load-day-report">
            {dayReportLoading ? <RefreshCw className="w-4 h-4 mr-2 animate-spin" /> : <TrendingUp className="w-4 h-4 mr-2" />}
            Gerar Relatório do Dia
          </Button>
        </div>

        {dayReport && (
          <div className="space-y-4">
            {/* Resumo */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {[
                { label: 'Total de Pedidos', value: dayReport.total, color: 'text-blue-600' },
                { label: 'Pedidos Ativos', value: dayActive.length, color: 'text-green-600' },
                { label: 'Com Coordenadas', value: dayReport.withCoords, color: 'text-purple-600' },
                { label: 'Valor Total', value: fmtCurr(dayActive.reduce((s: number, o: any) => s + Number(o.totalValue || 0), 0)), color: 'text-emerald-600' },
              ].map((s, i) => (
                <div key={i} className="bg-muted/30 rounded-xl p-3 text-center">
                  <div className={`text-xl font-bold ${s.color}`}>{s.value}</div>
                  <div className="text-xs text-muted-foreground mt-1">{s.label}</div>
                </div>
              ))}
            </div>

            {/* Tabela de pedidos do dia */}
            {dayActive.length > 0 ? (
              <div className="overflow-x-auto rounded-xl border border-border/50">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-muted/30 border-b border-border/50">
                      <th className="text-left p-3 text-xs font-medium text-muted-foreground">#</th>
                      <th className="text-left p-3 text-xs font-medium text-muted-foreground">Pedido</th>
                      <th className="text-left p-3 text-xs font-medium text-muted-foreground">Empresa</th>
                      <th className="text-left p-3 text-xs font-medium text-muted-foreground">Endereço</th>
                      <th className="text-left p-3 text-xs font-medium text-muted-foreground">Horário</th>
                      <th className="text-left p-3 text-xs font-medium text-muted-foreground">Valor</th>
                      <th className="text-left p-3 text-xs font-medium text-muted-foreground">Status</th>
                      <th className="text-left p-3 text-xs font-medium text-muted-foreground">GPS</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dayActive.map((o: any, i: number) => (
                      <tr key={o.orderId} className="border-b border-border/30 hover:bg-muted/20" data-testid={`report-row-${o.orderId}`}>
                        <td className="p-3 font-bold text-muted-foreground text-xs">{i + 1}</td>
                        <td className="p-3 font-mono text-xs text-primary">{o.orderCode}</td>
                        <td className="p-3 text-sm font-medium">{o.companyName}</td>
                        <td className="p-3 text-xs text-muted-foreground max-w-[180px] truncate">{o.address || '—'}</td>
                        <td className="p-3 text-xs">{o.deliveryTime || '—'}</td>
                        <td className="p-3 text-xs font-medium">{fmtCurr(o.totalValue)}</td>
                        <td className="p-3">
                          <span className={`text-[10px] px-2 py-0.5 rounded-full border font-medium ${ORDER_STATUS_COLORS[o.deliveryStatus] || ''}`}>
                            {o.deliveryStatus === 'pendente' ? 'Pendente' : o.deliveryStatus === 'entregue' ? 'Entregue' : 'Cancelado'}
                          </span>
                        </td>
                        <td className="p-3">
                          {o.hasCoords ? (
                            <a href={`https://www.google.com/maps/search/?api=1&query=${o.latitude},${o.longitude}`} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline text-xs flex items-center gap-1">
                              <MapPin className="w-3 h-3" />Maps
                            </a>
                          ) : (
                            <span className="text-xs text-amber-500 flex items-center gap-1"><AlertTriangle className="w-3 h-3" />Sem GPS</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="text-center py-8 text-muted-foreground">
                <Package className="w-8 h-8 mx-auto mb-2 opacity-30" />
                <p className="text-sm">Nenhum pedido ativo para {dayReportDate.split('-').reverse().join('/')}</p>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Filters */}
      <div className="bg-card rounded-2xl border border-border/50 p-6">
        <h2 className="font-bold text-foreground mb-4 flex items-center gap-2">
          <TrendingUp className="w-5 h-5 text-primary" />
          Relatório de Entregas
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 mb-4">
          <div>
            <label className="text-xs text-muted-foreground block mb-1">Motorista</label>
            <Select value={filters.driverId || 'none'} onValueChange={v => setFilters(f => ({ ...f, driverId: v === 'none' ? '' : v }))}>
              <SelectTrigger data-testid="select-report-driver">
                <SelectValue placeholder="Todos" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Todos os motoristas</SelectItem>
                {drivers.map((d: any) => (
                  <SelectItem key={d.id} value={String(d.id)}>{d.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-xs text-muted-foreground block mb-1">Status</label>
            <Select value={filters.status || 'none'} onValueChange={v => setFilters(f => ({ ...f, status: v === 'none' ? '' : v }))}>
              <SelectTrigger data-testid="select-report-status">
                <SelectValue placeholder="Todos" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Todos os status</SelectItem>
                <SelectItem value="pendente">Pendente</SelectItem>
                <SelectItem value="em_rota">Em Rota</SelectItem>
                <SelectItem value="entregue">Entregue</SelectItem>
                <SelectItem value="cancelado">Cancelado</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-xs text-muted-foreground block mb-1">Data inicial</label>
            <Input type="date" value={filters.startDate} onChange={e => setFilters(f => ({ ...f, startDate: e.target.value }))} data-testid="input-report-start" />
          </div>
          <div>
            <label className="text-xs text-muted-foreground block mb-1">Data final</label>
            <Input type="date" value={filters.endDate} onChange={e => setFilters(f => ({ ...f, endDate: e.target.value }))} data-testid="input-report-end" />
          </div>
        </div>
        <Button type="button" onClick={loadReport} disabled={loading} data-testid="button-load-report">
          {loading ? <RefreshCw className="w-4 h-4 mr-2 animate-spin" /> : <TrendingUp className="w-4 h-4 mr-2" />}
          Gerar Relatório
        </Button>
      </div>

      {/* Summary Cards */}
      {reportData && (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { label: 'Total', value: reportData.summary.total, color: 'text-foreground' },
              { label: 'Entregues', value: reportData.summary.entregues, color: 'text-green-600' },
              { label: 'Pendentes', value: reportData.summary.pendentes, color: 'text-yellow-600' },
              { label: 'Taxa de Entrega', value: `${reportData.taxaEntrega}%`, color: 'text-blue-600' },
            ].map((s, i) => (
              <div key={i} className="bg-card rounded-xl border border-border/50 p-4 text-center">
                <div className={`text-2xl font-bold ${s.color}`}>{s.value}</div>
                <div className="text-xs text-muted-foreground mt-1">{s.label}</div>
              </div>
            ))}
          </div>

          {/* Driver performance */}
          {Object.keys(reportData.driverStats).length > 0 && (
            <div className="bg-card rounded-2xl border border-border/50 p-5">
              <h3 className="font-semibold text-foreground mb-3 flex items-center gap-2">
                <User className="w-4 h-4 text-primary" />
                Performance por Motorista
              </h3>
              <div className="space-y-2">
                {Object.entries(reportData.driverStats).map(([driverId, stats]: any) => {
                  const driver = drivers.find((d: any) => String(d.id) === driverId);
                  const pct = stats.count > 0 ? Math.round((stats.entregues / stats.count) * 100) : 0;
                  return (
                    <div key={driverId} className="flex items-center gap-3">
                      <div className="w-32 text-xs text-muted-foreground truncate">{driver?.name || `Motorista #${driverId}`}</div>
                      <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
                        <div className="h-full bg-green-500 rounded-full" style={{ width: `${pct}%` }} />
                      </div>
                      <div className="text-xs font-medium w-20 text-right">
                        {stats.entregues}/{stats.count} ({pct}%)
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Delivery table */}
          {reportData.deliveries.length > 0 && (
            <div className="bg-card rounded-2xl border border-border/50 overflow-hidden">
              <div className="p-4 border-b border-border/50">
                <h3 className="font-semibold text-foreground">Detalhes das Entregas ({reportData.deliveries.length})</h3>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border/50 bg-muted/30">
                      <th className="text-left p-3 text-xs font-medium text-muted-foreground">ID</th>
                      <th className="text-left p-3 text-xs font-medium text-muted-foreground">Data</th>
                      <th className="text-left p-3 text-xs font-medium text-muted-foreground">Empresa</th>
                      <th className="text-left p-3 text-xs font-medium text-muted-foreground">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {reportData.deliveries.slice(0, 50).map((d: any) => (
                      <tr key={d.id} className="border-b border-border/30 hover:bg-muted/20">
                        <td className="p-3 font-mono text-xs">#{d.id}</td>
                        <td className="p-3 text-xs">{d.scheduledDate || '—'}</td>
                        <td className="p-3 text-xs">{d.companyId || '—'}</td>
                        <td className="p-3">
                          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${statusColors[d.status] || 'text-muted-foreground bg-muted'}`}>
                            {d.status}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {reportData.deliveries.length === 0 && (
            <div className="bg-card rounded-2xl border border-border/50 p-12 text-center">
              <Package className="w-10 h-10 text-muted-foreground/30 mx-auto mb-3" />
              <p className="text-sm text-muted-foreground">Nenhuma entrega encontrada com os filtros aplicados.</p>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ─── Smart Search Panel ────────────────────────────────────────────────────────
function SmartSearchPanel() {
  const { toast } = useToast();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [routeInsertion, setRouteInsertion] = useState<any>(null);
  const [bestDriver, setBestDriver] = useState<any>(null);
  const [activeCompany, setActiveCompany] = useState<any>(null);

  async function doSearch() {
    const q = query.trim();
    if (!q) return;
    setLoading(true);
    try {
      const resp = await fetch(`/api/logistics/smart-search?q=${encodeURIComponent(q)}`);
      if (!resp.ok) throw new Error(await resp.text());
      const data = await resp.json();
      setResults(data);
      if (data.length === 0) toast({ title: 'Nenhuma empresa encontrada', description: 'Tente outro CNPJ ou CEP' });
    } catch (e: any) {
      toast({ title: 'Erro na busca', description: e.message, variant: 'destructive' });
    } finally { setLoading(false); }
  }

  async function loadRouteInsertion(companyId: number) {
    try {
      const resp = await apiRequest('POST', '/api/logistics/route-insertion', { companyId });
      const data = await resp.json();
      setRouteInsertion(data.suggestion);
    } catch (_) {}
  }

  async function loadBestDriver() {
    try {
      const today = new Date().toISOString().split('T')[0];
      const resp = await fetch(`/api/logistics/best-driver?date=${today}`);
      const data = await resp.json();
      setBestDriver(data.driver);
    } catch (_) {}
  }

  function selectCompany(r: any) {
    setActiveCompany(r);
    loadRouteInsertion(r.company.id);
    loadBestDriver();
  }

  return (
    <div className="space-y-6">
      {/* Search bar */}
      <div className="bg-card rounded-2xl border border-border/50 p-6">
        <h2 className="font-bold text-foreground mb-1 flex items-center gap-2">
          <Search className="w-5 h-5 text-primary" />
          Busca Inteligente por Empresa
        </h2>
        <p className="text-xs text-muted-foreground mb-4">
          Digite o CNPJ ou CEP para encontrar a empresa e receber sugestões de atendimento
        </p>
        <div className="flex gap-3">
          <Input
            placeholder="Ex: 01310-100 ou 12.345.678/0001-00"
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && doSearch()}
            data-testid="input-smart-search"
            className="flex-1"
          />
          <Button type="button" onClick={doSearch} disabled={loading} data-testid="button-smart-search">
            {loading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
            <span className="ml-2">Buscar</span>
          </Button>
        </div>
      </div>

      {/* Results */}
      {results.length > 0 && (
        <div className="space-y-3">
          <h3 className="font-semibold text-sm text-foreground">{results.length} empresa(s) encontrada(s)</h3>
          {results.map((r, i) => (
            <div
              key={i}
              onClick={() => selectCompany(r)}
              className={`bg-card rounded-xl border border-border/50 p-4 cursor-pointer transition-colors hover:border-primary/50 ${
                activeCompany?.company.id === r.company.id ? 'border-primary ring-1 ring-primary/20' : ''
              }`}
              data-testid={`smart-result-${r.company.id}`}
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="font-semibold text-foreground">{r.company.name}</div>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    {r.company.cnpj && <span>CNPJ: {r.company.cnpj} · </span>}
                    CEP: {r.company.zip || '—'} · {r.company.city || '—'}
                  </div>
                </div>
                <Badge variant="outline" className="shrink-0 text-xs">
                  <Clock className="w-3 h-3 mr-1" />
                  {r.suggestion.suggestedDeliveryWindow}
                </Badge>
              </div>

              {activeCompany?.company.id === r.company.id && (
                <div className="mt-4 pt-3 border-t border-border/50 grid grid-cols-1 sm:grid-cols-3 gap-3">
                  {/* Best driver */}
                  <div className="bg-blue-50 dark:bg-blue-950/30 rounded-lg p-3">
                    <div className="flex items-center gap-1.5 mb-1">
                      <User className="w-3.5 h-3.5 text-blue-600" />
                      <span className="text-xs font-semibold text-blue-700 dark:text-blue-400">Motorista Recomendado</span>
                    </div>
                    <div className="text-sm font-medium">
                      {bestDriver ? bestDriver.name : r.suggestion.bestDriver?.name || '—'}
                    </div>
                    {bestDriver && (
                      <div className="text-[10px] text-muted-foreground mt-0.5">Menor carga do dia</div>
                    )}
                  </div>
                  {/* Route */}
                  <div className="bg-green-50 dark:bg-green-950/30 rounded-lg p-3">
                    <div className="flex items-center gap-1.5 mb-1">
                      <Route className="w-3.5 h-3.5 text-green-600" />
                      <span className="text-xs font-semibold text-green-700 dark:text-green-400">Rota Sugerida</span>
                    </div>
                    <div className="text-sm font-medium">
                      {routeInsertion ? routeInsertion.routeName : r.suggestion.suggestedRoute?.name || '—'}
                    </div>
                    {routeInsertion && (
                      <div className="text-[10px] text-muted-foreground mt-0.5">
                        Parada #{routeInsertion.insertAtPosition} · {routeInsertion.reason}
                      </div>
                    )}
                  </div>
                  {/* Time */}
                  <div className="bg-orange-50 dark:bg-orange-950/30 rounded-lg p-3">
                    <div className="flex items-center gap-1.5 mb-1">
                      <Clock className="w-3.5 h-3.5 text-orange-600" />
                      <span className="text-xs font-semibold text-orange-700 dark:text-orange-400">Janela de Entrega</span>
                    </div>
                    <div className="text-sm font-medium">{r.suggestion.suggestedDeliveryWindow}</div>
                    <div className="text-[10px] text-muted-foreground mt-0.5">
                      ~{routeInsertion?.extraTimeEstimateMin || r.suggestion.estimatedTimeMin} min adicionais
                    </div>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Empty state */}
      {results.length === 0 && !loading && (
        <div className="bg-card rounded-2xl border border-border/50 p-12 text-center">
          <Search className="w-12 h-12 text-muted-foreground/40 mx-auto mb-3" />
          <p className="text-sm text-muted-foreground">
            Digite um CNPJ ou CEP acima para buscar uma empresa e receber sugestões automáticas de atendimento.
          </p>
        </div>
      )}
    </div>
  );
}

export default function AdminLogisticsIntelligence() {
  const [tab, setTab] = useState('overview');
  const [, navigate] = useLocation();

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-blue-500 to-blue-700 flex items-center justify-center shadow-lg">
          <Truck className="w-6 h-6 text-white" />
        </div>
        <div className="flex-1">
          <h1 className="text-2xl font-bold text-foreground">Logística Inteligente</h1>
          <p className="text-sm text-muted-foreground">Rotas, simulação, CEP, relatórios e gestão de entregas</p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => navigate('/admin/driver-panel')}
          className="flex items-center gap-2 border-blue-300 text-blue-700 hover:bg-blue-50"
          data-testid="button-driver-panel-link"
        >
          <User className="w-4 h-4" />
          Painel do Motorista
        </Button>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 overflow-x-auto pb-1 border-b border-border/50">
        {TABS.map(t => {
          const Icon = t.icon;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              data-testid={`tab-logistics-${t.id}`}
              className={`flex items-center gap-2 px-4 py-2 rounded-t-lg text-sm font-medium whitespace-nowrap transition-colors ${
                tab === t.id
                  ? 'bg-background border border-b-0 border-border text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
              }`}
            >
              <Icon className="w-4 h-4" />
              {t.label}
            </button>
          );
        })}
      </div>

      {tab === 'overview' && <OverviewPanel />}
      {tab === 'simulation' && <SimulationPanel />}
      {tab === 'cep' && <CepLookupPanel />}
      {tab === 'deliveries' && <DeliveriesPanel />}
      {tab === 'smart' && <SmartSearchPanel />}
      {tab === 'reports' && <ReportsPanel />}
    </div>
  );
}
