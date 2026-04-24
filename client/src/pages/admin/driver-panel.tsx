import { useState, useEffect, useRef } from 'react';
import 'leaflet/dist/leaflet.css';
import { useQuery, useMutation } from '@tanstack/react-query';
import { queryClient, apiRequest } from '@/lib/queryClient';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/use-auth';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import {
  Truck, CheckCircle2, Clock, MapPin, Package,
  User, ChevronDown, ChevronUp, Navigation, RefreshCw,
  ClipboardCheck, AlertCircle, CheckCircle, XCircle, Map, List, FileText,
} from 'lucide-react';

interface DeliveryItem {
  id: number;
  companyId: number;
  companyName: string;
  status: string;
  scheduledDate: string;
  routePosition?: number;
  addressStreet?: string;
  addressCity?: string;
  addressZip?: string;
  deliveryWindowStart?: string;
  deliveryWindowEnd?: string;
  notes?: string;
  latitude?: string;
  longitude?: string;
  totalValue?: string;
  orderCode?: string;
  isOrderBridge?: boolean;
}

const STATUS_CONFIG: Record<string, { label: string; icon: any; color: string; bg: string }> = {
  pendente:  { label: 'Pendente',  icon: Clock,         color: 'text-yellow-700', bg: 'bg-yellow-50 border-yellow-200' },
  em_rota:   { label: 'Em Rota',  icon: Truck,          color: 'text-blue-700',   bg: 'bg-blue-50 border-blue-200' },
  entregue:  { label: 'Entregue', icon: CheckCircle2,   color: 'text-green-700',  bg: 'bg-green-50 border-green-200' },
  cancelado: { label: 'Cancelado',icon: XCircle,        color: 'text-red-700',    bg: 'bg-red-50 border-red-200' },
};

function ChecklistForm({ delivery, onSuccess }: { delivery: DeliveryItem; onSuccess: () => void }) {
  const { toast } = useToast();
  const [obs, setObs] = useState('');

  const mutation = useMutation({
    mutationFn: () => {
      if (delivery.isOrderBridge) {
        // Order-bridge: atualiza status do pedido para DELIVERED
        return apiRequest('PATCH', `/api/orders/${delivery.id}`, {
          status: 'DELIVERED',
          adminNote: obs || 'Entregue pelo motorista via Painel',
        }).then(r => r.json());
      }
      return apiRequest('POST', `/api/deliveries/${delivery.id}/checklist`, {
        observacao: obs,
        entregaConfirmada: true,
      }).then(r => r.json());
    },
    onSuccess: () => {
      toast({ title: 'Entrega confirmada!', description: `${delivery.companyName} marcada como entregue.` });
      queryClient.invalidateQueries({ queryKey: ['/api/driver/route-today'] });
      onSuccess();
    },
    onError: (e: any) => toast({ title: 'Erro', description: e.message, variant: 'destructive' }),
  });

  return (
    <div className="mt-3 pt-3 border-t border-border/50 space-y-3">
      <p className="text-xs font-semibold text-foreground">Confirmar Entrega</p>
      <Textarea
        placeholder="Observação (opcional)..."
        value={obs}
        onChange={e => setObs(e.target.value)}
        className="h-20 text-sm resize-none"
        data-testid={`textarea-checklist-obs-${delivery.id}`}
      />
      <Button
        type="button"
        size="sm"
        className="w-full gap-2"
        onClick={() => mutation.mutate()}
        disabled={mutation.isPending}
        data-testid={`button-confirm-delivery-${delivery.id}`}
      >
        <ClipboardCheck className="w-4 h-4" />
        {mutation.isPending ? 'Confirmando...' : 'Confirmar Entrega'}
      </Button>
    </div>
  );
}

function DeliveryCard({ delivery }: { delivery: DeliveryItem }) {
  const [expanded, setExpanded] = useState(false);
  const cfg = STATUS_CONFIG[delivery.status] || STATUS_CONFIG.pendente;
  const Icon = cfg.icon;
  const canChecklist = delivery.status === 'pendente' || delivery.status === 'em_rota';

  return (
    <div
      className={`border rounded-2xl p-4 transition-shadow hover:shadow-sm ${cfg.bg}`}
      data-testid={`card-delivery-${delivery.id}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            {delivery.routePosition && (
              <span className="text-[10px] font-bold bg-foreground/10 text-foreground rounded-full w-5 h-5 flex items-center justify-center flex-shrink-0">
                {delivery.routePosition}
              </span>
            )}
            <span className="font-semibold text-sm text-foreground truncate">{delivery.companyName}</span>
          </div>
          {delivery.addressStreet && (
            <p className="text-xs text-muted-foreground flex items-center gap-1">
              <MapPin className="w-3 h-3 shrink-0" />
              {delivery.addressStreet}{delivery.addressCity ? `, ${delivery.addressCity}` : ''}
            </p>
          )}
          {delivery.deliveryWindowStart && (
            <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
              <Clock className="w-3 h-3" />
              {delivery.deliveryWindowStart} – {delivery.deliveryWindowEnd}
            </p>
          )}
        </div>
        <div className="flex flex-col items-end gap-2 shrink-0">
          <Badge variant="outline" className={`text-xs ${cfg.color} border-current/30`}>
            <Icon className="w-3 h-3 mr-1" />
            {cfg.label}
          </Badge>
          {canChecklist && (
            <button
              type="button"
              onClick={() => setExpanded(e => !e)}
              className="text-xs text-blue-600 font-medium flex items-center gap-1"
              data-testid={`button-expand-checklist-${delivery.id}`}
            >
              {expanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
              {expanded ? 'Fechar checklist' : 'Confirmar entrega'}
            </button>
          )}
        </div>
      </div>
      {(delivery.orderCode || delivery.totalValue) && (
        <div className="flex gap-3 mt-2 text-xs text-muted-foreground">
          {delivery.orderCode && <span className="font-mono">Pedido: {delivery.orderCode}</span>}
          {delivery.totalValue && <span>R$ {parseFloat(delivery.totalValue).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</span>}
        </div>
      )}
      {delivery.notes && (
        <p className="text-xs text-muted-foreground mt-2 italic bg-white/50 rounded-lg px-2 py-1">{delivery.notes}</p>
      )}
      {expanded && canChecklist && (
        <ChecklistForm delivery={delivery} onSuccess={() => setExpanded(false)} />
      )}
    </div>
  );
}

function GpsMap({ deliveries }: { deliveries: DeliveryItem[] }) {
  const mapRef = useRef<any>(null);
  const mapInstanceRef = useRef<any>(null);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (mapInstanceRef.current) return;

    const initMap = async () => {
      const L = (await import('leaflet')).default;

      delete (L.Icon.Default.prototype as any)._getIconUrl;
      L.Icon.Default.mergeOptions({
        iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png',
        iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png',
        shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png',
      });

      const map = L.map(mapRef.current, { zoomControl: true, attributionControl: false });
      mapInstanceRef.current = map;

      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 18,
      }).addTo(map);

      const deliveriesWithCoords = deliveries.filter(d => d.latitude && d.longitude);

      if (deliveriesWithCoords.length > 0) {
        const bounds: [number, number][] = [];
        deliveriesWithCoords.forEach((d, idx) => {
          const lat = parseFloat(d.latitude!);
          const lng = parseFloat(d.longitude!);
          if (!isNaN(lat) && !isNaN(lng)) {
            bounds.push([lat, lng]);
            const color = d.status === 'entregue' ? '#16a34a' : d.status === 'em_rota' ? '#2563eb' : '#d97706';
            const icon = L.divIcon({
              html: `<div style="background:${color};color:#fff;border-radius:50%;width:28px;height:28px;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:bold;border:2px solid #fff;box-shadow:0 2px 4px rgba(0,0,0,0.3)">${idx + 1}</div>`,
              className: '',
              iconSize: [28, 28],
              iconAnchor: [14, 14],
            });
            L.marker([lat, lng], { icon })
              .addTo(map)
              .bindPopup(`<b>${d.companyName}</b><br>${d.addressStreet || ''}<br><span style="color:${color}">${d.status}</span>`);
          }
        });
        if (bounds.length > 0) {
          map.fitBounds(bounds, { padding: [30, 30] });
        }
      } else {
        map.setView([-23.55, -46.63], 11);
      }

      // Try to get driver location
      if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(pos => {
          const driverIcon = L.divIcon({
            html: `<div style="background:#7c3aed;color:#fff;border-radius:50%;width:32px;height:32px;display:flex;align-items:center;justify-content:center;border:3px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,0.4)">🚛</div>`,
            className: '',
            iconSize: [32, 32],
            iconAnchor: [16, 16],
          });
          L.marker([pos.coords.latitude, pos.coords.longitude], { icon: driverIcon })
            .addTo(map)
            .bindPopup('<b>Sua posição</b>');
        });
      }
    };

    initMap().catch(console.error);

    return () => {
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
      }
    };
  }, []);

  return (
    <div className="rounded-2xl overflow-hidden border border-border shadow-sm">
      <style>{`.leaflet-container { z-index: 0; }`}</style>
      <div ref={mapRef} style={{ height: 380, width: '100%' }} />
      <div className="p-3 bg-card border-t border-border flex items-center gap-4 text-xs text-muted-foreground flex-wrap">
        <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-full bg-amber-500 inline-block" /> Pendente</span>
        <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-full bg-blue-600 inline-block" /> Em Rota</span>
        <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-full bg-green-600 inline-block" /> Entregue</span>
        <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-full bg-violet-600 inline-block" /> 🚛 Motorista</span>
      </div>
    </div>
  );
}

interface NFeItem {
  id: number;
  numero?: string | null;
  status?: string | null;
  destinatarioNome?: string | null;
  valorTotal?: number | null;
  dataEmissao?: string | null;
  chaveAcesso?: string | null;
}

function NFeRoutePanel({ companyIds, companyNames }: { companyIds: number[]; companyNames: string[] }) {
  const { data: nfes = [], isLoading } = useQuery<NFeItem[]>({ queryKey: ['/api/nfe'] });

  const routeNfes = nfes.filter(nf =>
    companyNames.some(name =>
      nf.destinatarioNome && nf.destinatarioNome.toLowerCase().includes(name.toLowerCase().slice(0, 8))
    )
  );

  const statusBadge = (s?: string | null) => {
    if (s === 'autorizada') return 'bg-green-100 text-green-700';
    if (s === 'cancelada') return 'bg-red-100 text-red-700';
    return 'bg-yellow-100 text-yellow-700';
  };

  if (isLoading) return (
    <div className="text-center py-12">
      <RefreshCw className="w-7 h-7 animate-spin mx-auto text-muted-foreground/40 mb-2" />
      <p className="text-sm text-muted-foreground">Carregando notas fiscais...</p>
    </div>
  );

  if (companyIds.length === 0) return (
    <div className="text-center py-12 bg-card rounded-2xl border border-border/50">
      <FileText className="w-10 h-10 mx-auto text-muted-foreground/30 mb-3" />
      <p className="font-medium text-foreground">Sem entregas na rota hoje</p>
      <p className="text-sm text-muted-foreground mt-1">Nenhuma empresa atribuída à rota atual.</p>
    </div>
  );

  if (routeNfes.length === 0) return (
    <div className="text-center py-12 bg-card rounded-2xl border border-border/50">
      <FileText className="w-10 h-10 mx-auto text-muted-foreground/30 mb-3" />
      <p className="font-medium text-foreground">Nenhuma NF-e encontrada</p>
      <p className="text-sm text-muted-foreground mt-1">Não há notas fiscais vinculadas às empresas da sua rota de hoje.</p>
      <div className="mt-4 p-3 bg-muted rounded-xl mx-4 text-left">
        <p className="text-xs font-medium text-foreground mb-1">Empresas na rota ({companyNames.length}):</p>
        {companyNames.map((n, i) => (
          <p key={i} className="text-xs text-muted-foreground">• {n}</p>
        ))}
      </div>
    </div>
  );

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        Exibindo {routeNfes.length} nota(s) fiscal(is) vinculada(s) às {companyNames.length} empresa(s) da sua rota.
      </p>
      {routeNfes.map(nf => (
        <div key={nf.id} className="border border-border/60 rounded-xl p-4 bg-card space-y-2" data-testid={`nfe-route-${nf.id}`}>
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-center gap-2">
              <FileText className="w-4 h-4 text-primary flex-shrink-0" />
              <span className="font-semibold text-sm text-foreground">NF-e #{nf.numero || nf.id}</span>
            </div>
            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${statusBadge(nf.status)}`}>
              {nf.status || 'pendente'}
            </span>
          </div>
          {nf.destinatarioNome && (
            <p className="text-xs text-muted-foreground pl-6">{nf.destinatarioNome}</p>
          )}
          <div className="flex items-center gap-4 pl-6 text-xs text-muted-foreground">
            {nf.valorTotal != null && (
              <span>R$ {Number(nf.valorTotal).toFixed(2)}</span>
            )}
            {nf.dataEmissao && (
              <span>{new Date(nf.dataEmissao).toLocaleDateString('pt-BR')}</span>
            )}
          </div>
          {nf.chaveAcesso && (
            <p className="text-[10px] text-muted-foreground/60 pl-6 font-mono break-all">{nf.chaveAcesso}</p>
          )}
        </div>
      ))}
    </div>
  );
}

export default function DriverPanel() {
  const { user } = useAuth();
  const [view, setView] = useState<'list' | 'map' | 'nfe'>('list');
  const today = new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' });

  const { data, isLoading, refetch } = useQuery<{
    deliveries: DeliveryItem[];
    driver: any;
    date: string;
  }>({
    queryKey: ['/api/driver/route-today'],
  });

  const deliveries = data?.deliveries || [];
  const pendentes = deliveries.filter(d => d.status === 'pendente').length;
  const entregues = deliveries.filter(d => d.status === 'entregue').length;
  const emRota = deliveries.filter(d => d.status === 'em_rota').length;

  const sorted = [...deliveries].sort((a, b) => (a.routePosition || 999) - (b.routePosition || 999));

  return (
    <div className="min-h-screen bg-background">
      <div className="bg-gradient-to-br from-blue-600 to-blue-800 text-white px-4 pt-6 pb-16">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-white/20 flex items-center justify-center">
              <Truck className="w-6 h-6" />
            </div>
            <div>
              <h1 className="font-bold text-lg">Painel do Motorista</h1>
              <p className="text-xs text-blue-100 capitalize">{today}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => refetch()}
            className="p-2 rounded-xl bg-white/20 hover:bg-white/30 transition-colors"
            data-testid="button-refresh-route"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>

        {data?.driver && (
          <div className="flex items-center gap-2 mb-4 bg-white/10 rounded-xl px-3 py-2">
            <User className="w-4 h-4" />
            <span className="text-sm font-medium">{data.driver.name}</span>
            {data.driver.phone && <span className="text-xs text-blue-200">· {data.driver.phone}</span>}
          </div>
        )}
      </div>

      <div className="mx-4 -mt-8 bg-card rounded-2xl border border-border shadow-lg grid grid-cols-3 divide-x divide-border">
        <div className="p-3 text-center" data-testid="stat-total-deliveries">
          <div className="text-2xl font-bold text-foreground">{deliveries.length}</div>
          <div className="text-[10px] text-muted-foreground uppercase tracking-wide">Total</div>
        </div>
        <div className="p-3 text-center">
          <div className="text-2xl font-bold text-yellow-600">{pendentes}</div>
          <div className="text-[10px] text-muted-foreground uppercase tracking-wide">Pendentes</div>
        </div>
        <div className="p-3 text-center">
          <div className="text-2xl font-bold text-green-600">{entregues}</div>
          <div className="text-[10px] text-muted-foreground uppercase tracking-wide">Entregues</div>
        </div>
      </div>

      <div className="p-4 mt-3 space-y-3">
        {/* View toggle */}
        <div className="flex gap-1 bg-muted rounded-xl p-1">
          <button
            type="button"
            onClick={() => setView('list')}
            data-testid="button-view-list"
            className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-medium transition-all ${view === 'list' ? 'bg-card shadow-sm text-foreground' : 'text-muted-foreground'}`}
          >
            <List className="w-3.5 h-3.5" /> Lista
          </button>
          <button
            type="button"
            onClick={() => setView('map')}
            data-testid="button-view-map"
            className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-medium transition-all ${view === 'map' ? 'bg-card shadow-sm text-foreground' : 'text-muted-foreground'}`}
          >
            <Map className="w-3.5 h-3.5" /> Mapa GPS
          </button>
          <button
            type="button"
            onClick={() => setView('nfe')}
            data-testid="button-view-nfe"
            className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-medium transition-all ${view === 'nfe' ? 'bg-card shadow-sm text-foreground' : 'text-muted-foreground'}`}
          >
            <FileText className="w-3.5 h-3.5" /> NF-e da Rota
          </button>
        </div>

        {isLoading && (
          <div className="text-center py-12">
            <RefreshCw className="w-8 h-8 animate-spin mx-auto text-muted-foreground/40 mb-3" />
            <p className="text-sm text-muted-foreground">Carregando rota do dia...</p>
          </div>
        )}

        {!isLoading && deliveries.length === 0 && (
          <div className="text-center py-12 bg-card rounded-2xl border border-border/50">
            <Package className="w-12 h-12 mx-auto text-muted-foreground/30 mb-3" />
            <p className="font-medium text-foreground">Sem entregas hoje</p>
            <p className="text-sm text-muted-foreground mt-1">Nenhuma entrega agendada para hoje.</p>
          </div>
        )}

        {!isLoading && view === 'nfe' && (
          <NFeRoutePanel
            companyIds={deliveries.map(d => d.companyId)}
            companyNames={deliveries.map(d => d.companyName).filter(Boolean)}
          />
        )}

        {!isLoading && deliveries.length > 0 && view !== 'nfe' && (
          <>
            {view === 'map' && <GpsMap deliveries={sorted} />}

            {view === 'list' && (
              <>
                {emRota > 0 && (
                  <div className="flex items-center gap-2 text-sm text-blue-700 bg-blue-50 rounded-xl px-3 py-2 border border-blue-200">
                    <Navigation className="w-4 h-4 animate-pulse" />
                    <span className="font-medium">{emRota} entrega(s) em rota agora</span>
                  </div>
                )}
                {sorted.map(d => <DeliveryCard key={d.id} delivery={d} />)}
              </>
            )}

            {entregues === deliveries.length && deliveries.length > 0 && view === 'list' && (
              <div className="text-center py-6 bg-green-50 rounded-2xl border border-green-200">
                <CheckCircle2 className="w-10 h-10 text-green-600 mx-auto mb-2" />
                <p className="font-bold text-green-700">Todas as entregas concluídas!</p>
                <p className="text-sm text-green-600">Ótimo trabalho hoje.</p>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
