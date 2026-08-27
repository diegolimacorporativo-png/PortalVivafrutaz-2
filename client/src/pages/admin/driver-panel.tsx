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
  UserX, Home, ThumbsDown, CalendarClock, TriangleAlert, History, LogOut,
} from 'lucide-react';
import { BackHeader } from '@/components/navigation/BackHeader';

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
  orderId?: number;
  companyCnpj?: string | null;
  companyPhone?: string | null;
  orderDetails?: OrderDetailData | null;
  isOrderBridge?: boolean;
  stopStatusAt?: string;
  stopStatusBy?: string;
  stopObservacao?: string;
  canUpdate?: boolean;
}

type GpsPayload = {
  latitude: number;
  longitude: number;
  accuracy: number | null;
  speed: number | null;
  heading: number | null;
};

type PendingGpsPosition = {
  payload: GpsPayload;
  capturedAt: number;
};

const GPS_QUEUE_STORAGE_KEY = 'vivafrutaz:gps-pending:v1';
const GPS_QUEUE_LIMIT = 20;
const GPS_SEND_INTERVAL_MS = 15000;
const GPS_REQUEST_TIMEOUT_MS = 10000;
const GPS_OPTIONS: PositionOptions = {
  enableHighAccuracy: true,
  maximumAge: 10000,
  timeout: 20000,
};

function readPendingGpsPositions(): PendingGpsPosition[] {
  try {
    const raw = window.localStorage.getItem(GPS_QUEUE_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((entry): entry is PendingGpsPosition => {
        const payload = entry?.payload;
        return Boolean(
          payload &&
          Number.isFinite(Number(payload.latitude)) &&
          Number.isFinite(Number(payload.longitude)) &&
          Number.isFinite(Number(entry.capturedAt)),
        );
      })
      .slice(-GPS_QUEUE_LIMIT)
      .map(entry => ({
        capturedAt: Number(entry.capturedAt),
        payload: {
          latitude: Number(entry.payload.latitude),
          longitude: Number(entry.payload.longitude),
          accuracy: entry.payload.accuracy == null ? null : Number(entry.payload.accuracy),
          speed: entry.payload.speed == null ? null : Number(entry.payload.speed),
          heading: entry.payload.heading == null ? null : Number(entry.payload.heading),
        },
      }));
  } catch {
    return [];
  }
}

function writePendingGpsPositions(queue: PendingGpsPosition[]): void {
  try {
    window.localStorage.setItem(
      GPS_QUEUE_STORAGE_KEY,
      JSON.stringify(queue.slice(-GPS_QUEUE_LIMIT)),
    );
  } catch {
    // Storage can be unavailable in private/restricted browser contexts.
  }
}

function formatGpsTime(timestamp: number | null): string {
  if (!timestamp) return '—';
  return new Date(timestamp).toLocaleTimeString('pt-BR');
}

function DriverGpsReporter({ role }: { role?: string | null }) {
  const [state, setState] = useState<'starting' | 'active' | 'denied' | 'unavailable' | 'error' | 'offline'>('starting');
  const [isOnline, setIsOnline] = useState(() => typeof navigator === 'undefined' || navigator.onLine);
  const [lastCapturedAt, setLastCapturedAt] = useState<number | null>(null);
  const [lastSentAt, setLastSentAt] = useState<number | null>(null);
  const [pendingCount, setPendingCount] = useState(0);
  const [lastError, setLastError] = useState<string | null>(null);
  const lastSentAtRef = useRef(0);
  const pendingRef = useRef<PendingGpsPosition[]>([]);
  const sendingRef = useRef(false);
  const resumeRef = useRef(false);
  const retryTimerRef = useRef<number | null>(null);
  const retryAttemptRef = useRef(0);
  const authBlockedRef = useRef(false);
  const watchIdRef = useRef<number | null>(null);
  const cancelledRef = useRef(false);

  useEffect(() => {
    if (role !== 'DRIVER' && role !== 'MOTORISTA') return;
    if (!navigator.geolocation) {
      setState('unavailable');
      return;
    }

    cancelledRef.current = false;
    pendingRef.current = readPendingGpsPositions();
    setPendingCount(pendingRef.current.length);

    const updateQueueState = () => {
      if (!cancelledRef.current) setPendingCount(pendingRef.current.length);
      writePendingGpsPositions(pendingRef.current);
    };

    const enqueuePosition = (payload: GpsPayload) => {
      pendingRef.current = [
        ...pendingRef.current,
        { payload, capturedAt: Date.now() },
      ].slice(-GPS_QUEUE_LIMIT);
      updateQueueState();
    };

    const handleGeolocationError = (error: GeolocationPositionError) => {
      if (cancelledRef.current) return;
      if (error.code === error.PERMISSION_DENIED) {
        setState('denied');
        setLastError('Permissão de localização negada');
      } else if (!navigator.onLine) {
        setState('offline');
        setLastError('Sem conexão');
      } else {
        setState('error');
        setLastError('Não foi possível obter a posição');
      }
    };

    const postPosition = async (
      payload: GpsPayload,
    ): Promise<{ ok: boolean; retryable: boolean; message?: string }> => {
      if (!navigator.onLine) {
        return { ok: false, retryable: true, message: 'Sem conexão' };
      }

      const controller = new AbortController();
      const timeoutId = window.setTimeout(() => controller.abort(), GPS_REQUEST_TIMEOUT_MS);
      try {
        // Keep the existing endpoint, authentication mode, and payload contract.
        const response = await fetch('/api/driver/gps', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
          signal: controller.signal,
        });
        if (response.ok) return { ok: true, retryable: false };
        if (response.status === 401 || response.status === 403) {
          return { ok: false, retryable: false, message: 'Sessão sem autorização para enviar GPS' };
        }
        return { ok: false, retryable: true, message: `Servidor respondeu ${response.status}` };
      } catch (error) {
        return {
          ok: false,
          retryable: true,
          message: error instanceof DOMException && error.name === 'AbortError'
            ? 'Tempo limite de envio excedido'
            : 'Falha de conexão ao enviar GPS',
        };
      } finally {
        window.clearTimeout(timeoutId);
      }
    };

    const flushQueue = async (): Promise<boolean> => {
      if (sendingRef.current || cancelledRef.current || !navigator.onLine || authBlockedRef.current) {
        return pendingRef.current.length === 0;
      }

      sendingRef.current = true;
      try {
        while (pendingRef.current.length > 0 && navigator.onLine && !authBlockedRef.current) {
          const pending = pendingRef.current[0];
          const result = await postPosition(pending.payload);
          if (!result.ok) {
            if (!cancelledRef.current) {
              setState(result.retryable ? 'error' : 'denied');
              setLastError(result.message || 'Falha ao enviar GPS');
            }
            if (!result.retryable) authBlockedRef.current = true;
            return false;
          }

          pendingRef.current = pendingRef.current.slice(1);
          updateQueueState();
          lastSentAtRef.current = Date.now();
          if (!cancelledRef.current) {
            setLastSentAt(lastSentAtRef.current);
            setState('active');
            setLastError(null);
          }
        }
        return pendingRef.current.length === 0;
      } finally {
        sendingRef.current = false;
      }
    };

    const clearQueueRetry = () => {
      if (retryTimerRef.current !== null) {
        window.clearTimeout(retryTimerRef.current);
        retryTimerRef.current = null;
      }
    };

    const scheduleQueueRetry = () => {
      if (
        cancelledRef.current ||
        retryTimerRef.current !== null ||
        pendingRef.current.length === 0 ||
        !navigator.onLine ||
        authBlockedRef.current
      ) return;

      const delay = Math.min(60000, 15000 * (2 ** retryAttemptRef.current));
      retryAttemptRef.current = Math.min(retryAttemptRef.current + 1, 4);
      retryTimerRef.current = window.setTimeout(async () => {
        retryTimerRef.current = null;
        const flushed = await flushQueue();
        if (flushed) {
          retryAttemptRef.current = 0;
        } else {
          scheduleQueueRetry();
        }
      }, delay);
    };

    const sendPosition = async (position: GeolocationPosition, force = false) => {
      if (cancelledRef.current) return;

      const payload: GpsPayload = {
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        accuracy: position.coords.accuracy,
        speed: position.coords.speed,
        heading: position.coords.heading,
      };
      setLastCapturedAt(Date.now());

      if (!force && Date.now() - lastSentAtRef.current < GPS_SEND_INTERVAL_MS) return;
      if (sendingRef.current) {
        enqueuePosition(payload);
        return;
      }
      if (!navigator.onLine || authBlockedRef.current) {
        enqueuePosition(payload);
        if (!cancelledRef.current) {
          setState(authBlockedRef.current ? 'denied' : 'offline');
          setLastError(authBlockedRef.current ? 'Sessão sem autorização para enviar GPS' : 'Sem conexão');
        }
        if (!authBlockedRef.current) scheduleQueueRetry();
        return;
      }

      sendingRef.current = true;
      let shouldFlushQueue = false;
      try {
        const result = await postPosition(payload);
        if (result.ok) {
          lastSentAtRef.current = Date.now();
          if (!cancelledRef.current) {
            setLastSentAt(lastSentAtRef.current);
            setState('active');
            setLastError(null);
          }
          shouldFlushQueue = pendingRef.current.length > 0;
        } else {
          enqueuePosition(payload);
          if (!cancelledRef.current) {
            setState(result.retryable ? 'error' : 'denied');
            setLastError(result.message || 'Falha ao enviar GPS');
          }
          if (!result.retryable) authBlockedRef.current = true;
          if (result.retryable) scheduleQueueRetry();
        }
      } finally {
        sendingRef.current = false;
      }
      if (shouldFlushQueue) {
        const flushed = await flushQueue();
        if (!flushed) scheduleQueueRetry();
      }
    };

    const startWatch = () => {
      if (cancelledRef.current || watchIdRef.current !== null) return;
      try {
        watchIdRef.current = navigator.geolocation.watchPosition(
          position => { void sendPosition(position); },
          handleGeolocationError,
          GPS_OPTIONS,
        );
      } catch {
        setState('error');
        setLastError('Não foi possível iniciar o monitoramento GPS');
      }
    };

    const requestImmediatePosition = async (): Promise<void> => {
      if (cancelledRef.current || !navigator.onLine || authBlockedRef.current) return;
      await new Promise<void>(resolve => {
        navigator.geolocation.getCurrentPosition(
          position => { void sendPosition(position, true).finally(resolve); },
          error => {
            handleGeolocationError(error);
            resolve();
          },
          GPS_OPTIONS,
        );
      });
    };

    const resumeTracking = async () => {
      if (cancelledRef.current || resumeRef.current) return;
      resumeRef.current = true;
      try {
        startWatch();
        if (!navigator.onLine) {
          setState('offline');
          setLastError('Sem conexão — posições ficarão pendentes');
          return;
        }
        if (authBlockedRef.current) return;
        const queueFlushed = await flushQueue();
        if (queueFlushed) {
          retryAttemptRef.current = 0;
          clearQueueRetry();
          await requestImmediatePosition();
        } else {
          scheduleQueueRetry();
        }
      } finally {
        resumeRef.current = false;
      }
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') void resumeTracking();
    };
    const onPageShow = () => { void resumeTracking(); };
    const onFocus = () => { void resumeTracking(); };
    const onOnline = () => {
      setIsOnline(true);
      void resumeTracking();
    };
    const onOffline = () => {
      setIsOnline(false);
      setState('offline');
      setLastError('Sem conexão — posições ficarão pendentes');
    };

    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    window.addEventListener('pageshow', onPageShow);
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisibilityChange);

    void resumeTracking();

    return () => {
      cancelledRef.current = true;
      clearQueueRetry();
      if (watchIdRef.current !== null) {
        navigator.geolocation.clearWatch(watchIdRef.current);
        watchIdRef.current = null;
      }
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
      window.removeEventListener('pageshow', onPageShow);
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [role]);

  if (role !== 'DRIVER' && role !== 'MOTORISTA') return null;

  const label = state === 'active' ? 'GPS ativo — localização compartilhada'
    : state === 'denied' ? 'GPS bloqueado — permita a localização no navegador'
    : state === 'unavailable' ? 'GPS indisponível neste dispositivo'
    : state === 'offline' ? 'GPS sem conexão — posição será reenviada'
    : state === 'error' ? 'GPS aguardando conexão'
    : 'Solicitando localização GPS...';
  const color = state === 'active' ? 'text-green-700 bg-green-50 border-green-200'
    : state === 'denied' || state === 'unavailable' ? 'text-red-700 bg-red-50 border-red-200'
    : 'text-blue-700 bg-blue-50 border-blue-200';

  return (
    <div className={`mb-3 rounded-xl border px-3 py-2 text-xs flex items-center gap-2 ${color}`} data-testid="driver-gps-status">
      <Navigation className="w-4 h-4 shrink-0" />
      <div className="min-w-0">
        <span>{label}. O rastreio continua mesmo sem rota atribuída.</span>
        <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] opacity-90">
          <span>{isOnline ? 'Conectado' : 'Sem conexão'}</span>
          <span>Última captura: {formatGpsTime(lastCapturedAt)}</span>
          <span>Último envio: {formatGpsTime(lastSentAt)}</span>
          <span>Pendentes: {pendingCount}</span>
        </div>
        {lastError && <div className="mt-0.5 truncate" title={lastError}>{lastError}</div>}
      </div>
    </div>
  );
}

interface LiveDriverLocation {
  driverId: number;
  driverName: string;
  phone: string | null;
  active: boolean;
  latitude: string | null;
  longitude: string | null;
  accuracy: string | null;
  speed: string | null;
  updatedAt: string | null;
}

function LiveDriverLocations({ drivers }: { drivers: LiveDriverLocation[] }) {
  const visibleDrivers = drivers.filter(d => d.active);
  if (visibleDrivers.length === 0) return null;

  return (
    <div className="rounded-2xl border border-border bg-card p-4 shadow-sm" data-testid="live-driver-locations">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <MapPin className="w-4 h-4 text-violet-600" />
          <h2 className="text-sm font-semibold text-foreground">Motoristas localizados</h2>
        </div>
        <span className="text-[10px] text-muted-foreground">Atualização automática</span>
      </div>
      <div className="space-y-2">
        {visibleDrivers.map(driver => {
          const hasLocation = driver.latitude != null && driver.longitude != null;
          return (
            <div key={driver.driverId} className="flex items-center gap-3 rounded-xl border border-border/60 px-3 py-2">
              <div className={`w-2.5 h-2.5 rounded-full shrink-0 ${hasLocation ? 'bg-green-500' : 'bg-muted-foreground/40'}`} />
              <div className="min-w-0 flex-1">
                <p className="text-xs font-medium text-foreground truncate">{driver.driverName}</p>
                {hasLocation ? (
                  <p className="text-[10px] text-muted-foreground">
                    {Number(driver.latitude).toFixed(5)}, {Number(driver.longitude).toFixed(5)}
                    {driver.updatedAt && ` • ${new Date(driver.updatedAt).toLocaleTimeString('pt-BR')}`}
                  </p>
                ) : (
                  <p className="text-[10px] text-muted-foreground">Aguardando primeira localização</p>
                )}
              </div>
              {hasLocation && (
                <a
                  href={`https://www.google.com/maps/search/?api=1&query=${driver.latitude},${driver.longitude}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[10px] font-medium text-primary hover:underline shrink-0"
                >
                  Abrir mapa
                </a>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

interface StopEvent {
  id: number;
  deliveryId: number;
  status: string;
  observacao: string | null;
  registeredAt: string;
  registeredBy: string | null;
  registeredByRole: string | null;
}

// ─── Status config — all 6 stop statuses + legacy values ─────────────────────

const STOP_STATUS_CONFIG: Record<string, {
  label: string; icon: any; color: string; bg: string; btnClass: string;
}> = {
  entregue:           { label: 'Entregue',           icon: CheckCircle2,    color: 'text-green-700',   bg: 'bg-green-50 border-green-200',   btnClass: 'bg-green-600 hover:bg-green-700 text-white' },
  cliente_ausente:    { label: 'Cliente Ausente',    icon: UserX,           color: 'text-orange-700',  bg: 'bg-orange-50 border-orange-200', btnClass: 'bg-orange-500 hover:bg-orange-600 text-white' },
  endereco_incorreto: { label: 'Endereço Incorreto', icon: Home,            color: 'text-yellow-700',  bg: 'bg-yellow-50 border-yellow-200', btnClass: 'bg-yellow-500 hover:bg-yellow-600 text-white' },
  recusado:           { label: 'Recusado',           icon: ThumbsDown,      color: 'text-red-700',     bg: 'bg-red-50 border-red-200',       btnClass: 'bg-red-600 hover:bg-red-700 text-white' },
  reagendado:         { label: 'Reagendado',         icon: CalendarClock,   color: 'text-purple-700',  bg: 'bg-purple-50 border-purple-200', btnClass: 'bg-purple-600 hover:bg-purple-700 text-white' },
  problema:           { label: 'Problema',           icon: TriangleAlert,   color: 'text-rose-700',    bg: 'bg-rose-50 border-rose-200',     btnClass: 'bg-rose-600 hover:bg-rose-700 text-white' },
};

// Legacy statuses still in use
const STATUS_CONFIG: Record<string, { label: string; icon: any; color: string; bg: string }> = {
  pendente:           { label: 'Pendente',           icon: Clock,           color: 'text-yellow-700',  bg: 'bg-yellow-50 border-yellow-200' },
  em_rota:            { label: 'Em Rota',            icon: Truck,           color: 'text-blue-700',    bg: 'bg-blue-50 border-blue-200' },
  cancelado:          { label: 'Cancelado',          icon: XCircle,         color: 'text-red-700',     bg: 'bg-red-50 border-red-200' },
  ...Object.fromEntries(
    Object.entries(STOP_STATUS_CONFIG).map(([k, v]) => [k, { label: v.label, icon: v.icon, color: v.color, bg: v.bg }])
  ),
};

const STOP_STATUS_KEYS = Object.keys(STOP_STATUS_CONFIG) as Array<keyof typeof STOP_STATUS_CONFIG>;

function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}
function fmtDateTime(iso: string) {
  return new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

// ─── Stop Status Form ─────────────────────────────────────────────────────────

function StopStatusForm({ delivery, onSuccess }: { delivery: DeliveryItem; onSuccess: () => void }) {
  const { toast } = useToast();
  const [obs, setObs] = useState('');
  const [selectedStatus, setSelectedStatus] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);

  const historyQuery = useQuery<StopEvent[]>({
    queryKey: [`/api/deliveries/${delivery.id}/stop-events`],
    queryFn: () =>
      fetch(`/api/deliveries/${delivery.id}/stop-events`, { credentials: 'include' })
        .then(r => r.json()),
    enabled: showHistory && !delivery.isOrderBridge,
  });

  const mutation = useMutation({
    mutationFn: (status: string) => {
      if (delivery.isOrderBridge) {
        // Order-bridge: fallback to order status update
        return apiRequest('PATCH', `/api/orders/${delivery.id}`, {
          status: status === 'entregue' ? 'DELIVERED' : 'ACTIVE',
          adminNote: obs || `Status registrado: ${STOP_STATUS_CONFIG[status]?.label ?? status}`,
        }).then(r => r.json());
      }
      return fetch(`/api/deliveries/${delivery.id}/stop-status`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status, observacao: obs }),
      }).then(async r => {
        if (!r.ok) {
          const err = await r.json().catch(() => ({}));
          throw new Error(err.message ?? 'Erro ao registrar status');
        }
        return r.json();
      });
    },
    onSuccess: (_data, status) => {
      const label = STOP_STATUS_CONFIG[status]?.label ?? status;
      toast({ title: `Status registrado: ${label}`, description: delivery.companyName });
      queryClient.invalidateQueries({ queryKey: ['/api/driver/route-today'] });
      queryClient.invalidateQueries({ queryKey: [`/api/deliveries/${delivery.id}/stop-events`] });
      setObs('');
      setSelectedStatus(null);
      onSuccess();
    },
    onError: (e: any) => toast({ title: 'Erro', description: e.message, variant: 'destructive' }),
  });

  return (
    <div className="mt-3 pt-3 border-t border-border/50 space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold text-foreground">Registrar Status da Parada</p>
        {!delivery.isOrderBridge && (
          <button
            type="button"
            onClick={() => setShowHistory(h => !h)}
            className="text-xs text-muted-foreground flex items-center gap-1 hover:text-foreground"
          >
            <History className="w-3 h-3" />
            {showHistory ? 'Ocultar histórico' : 'Ver histórico'}
          </button>
        )}
      </div>

      {/* 6 status buttons in a 2-col grid */}
      <div className="grid grid-cols-2 gap-2">
        {STOP_STATUS_KEYS.map(key => {
          const cfg = STOP_STATUS_CONFIG[key];
          const Icon = cfg.icon;
          const isSelected = selectedStatus === key;
          return (
            <button
              key={key}
              type="button"
              onClick={() => setSelectedStatus(isSelected ? null : key)}
              className={`flex items-center gap-2 rounded-xl px-3 py-2.5 text-xs font-semibold transition-all border-2 ${
                isSelected
                  ? `${cfg.btnClass} border-transparent`
                  : 'bg-white border-border text-foreground hover:border-primary/40'
              }`}
              data-testid={`button-stop-status-${key}-${delivery.id}`}
            >
              <Icon className="w-3.5 h-3.5 shrink-0" />
              {cfg.label}
            </button>
          );
        })}
      </div>

      {selectedStatus && (
        <>
          <Textarea
            placeholder="Observação (opcional)..."
            value={obs}
            onChange={e => setObs(e.target.value)}
            className="h-16 text-sm resize-none"
            data-testid={`textarea-stop-obs-${delivery.id}`}
          />
          <Button
            type="button"
            size="sm"
            className={`w-full gap-2 ${STOP_STATUS_CONFIG[selectedStatus]?.btnClass}`}
            onClick={() => mutation.mutate(selectedStatus)}
            disabled={mutation.isPending}
            data-testid={`button-confirm-stop-status-${delivery.id}`}
          >
            {(() => {
              const Icon = STOP_STATUS_CONFIG[selectedStatus]?.icon ?? ClipboardCheck;
              return <Icon className="w-4 h-4" />;
            })()}
            {mutation.isPending
              ? 'Registrando...'
              : `Confirmar: ${STOP_STATUS_CONFIG[selectedStatus]?.label}`}
          </Button>
        </>
      )}

      {/* History */}
      {showHistory && (
        <div className="bg-muted/40 rounded-xl p-3 space-y-2">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Histórico</p>
          {historyQuery.isPending && <p className="text-xs text-muted-foreground">Carregando...</p>}
          {historyQuery.data?.length === 0 && <p className="text-xs text-muted-foreground">Nenhum evento registrado.</p>}
          {historyQuery.data?.map(ev => {
            const cfg = STOP_STATUS_CONFIG[ev.status];
            const Icon = cfg?.icon ?? AlertCircle;
            return (
              <div key={ev.id} className="flex items-start gap-2 text-xs">
                <Icon className={`w-3.5 h-3.5 shrink-0 mt-0.5 ${cfg?.color ?? 'text-muted-foreground'}`} />
                <div className="flex-1 min-w-0">
                  <span className="font-semibold">{cfg?.label ?? ev.status}</span>
                  {ev.observacao && <span className="text-muted-foreground"> — {ev.observacao}</span>}
                  <div className="text-[10px] text-muted-foreground mt-0.5">
                    {fmtDateTime(ev.registeredAt)}
                    {ev.registeredBy && <span> · {ev.registeredBy}</span>}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

interface OrderDetailData {
  order: {
    orderCode?: string | null;
    companyId?: number;
    orderDate?: string;
    deliveryDate?: string;
    orderNote?: string | null;
    status?: string;
    totalValue?: string | number;
  };
  items: Array<{
    id: number;
    productId: number;
    quantity: number;
    unitPrice?: string | number;
    totalPrice?: string | number;
  }>;
}

function formatOrderDate(value?: string) {
  if (!value) return '—';
  return new Date(value).toLocaleDateString('pt-BR');
}

function normalizeSearchValue(value: unknown) {
  return String(value ?? '')
    .toLocaleLowerCase('pt-BR')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, '');
}

function DeliveryCard({ delivery }: { delivery: DeliveryItem }) {
  const [expanded, setExpanded] = useState(false);
  const cfg = STATUS_CONFIG[delivery.status] ?? STATUS_CONFIG.pendente;
  const Icon = cfg.icon;
  const orderDetail = delivery.orderDetails;

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
          {/* Show current stop status if registered */}
          {delivery.stopStatusAt && (
            <p className="text-[10px] text-muted-foreground mt-1">
              ⏱ {fmtTime(delivery.stopStatusAt)}
              {delivery.stopStatusBy && <span> · {delivery.stopStatusBy}</span>}
              {delivery.stopObservacao && <span> — {delivery.stopObservacao}</span>}
            </p>
          )}
        </div>
        <div className="flex flex-col items-end gap-2 shrink-0">
          <Badge variant="outline" className={`text-xs ${cfg.color} border-current/30`}>
            <Icon className="w-3 h-3 mr-1" />
            {cfg.label}
          </Badge>
          <button
            type="button"
            onClick={() => setExpanded(e => !e)}
            className="text-xs text-blue-600 font-medium flex items-center gap-1"
            data-testid={`button-expand-checklist-${delivery.id}`}
          >
             {expanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
             {expanded ? 'Fechar pedido' : 'Ver pedido'}
          </button>
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
      {expanded && (
        <div className="mt-3 pt-3 border-t border-border/50 space-y-3 text-xs" data-testid={`order-details-${delivery.id}`}>
          <p className="font-semibold text-foreground">Detalhes do pedido</p>
          {orderDetail && (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1 text-muted-foreground">
                <p><strong className="text-foreground">Código:</strong> {orderDetail.order.orderCode || delivery.orderCode || `#${delivery.id}`}</p>
                <p><strong className="text-foreground">Empresa:</strong> {delivery.companyName}</p>
                <p><strong className="text-foreground">Data do pedido:</strong> {formatOrderDate(orderDetail.order.orderDate)}</p>
                <p><strong className="text-foreground">Data de entrega:</strong> {formatOrderDate(orderDetail.order.deliveryDate || delivery.scheduledDate)}</p>
                <p className="sm:col-span-2">
                  <strong className="text-foreground">Endereço:</strong>{' '}
                  {delivery.addressStreet || '—'}{delivery.addressCity ? `, ${delivery.addressCity}` : ''}
                </p>
                {delivery.companyPhone && <p><strong className="text-foreground">Telefone:</strong> {delivery.companyPhone}</p>}
                <p><strong className="text-foreground">Status:</strong> {cfg.label}</p>
              </div>
              {(orderDetail.order.orderNote || delivery.notes) && (
                <p className="rounded-lg bg-blue-50 px-2 py-1 text-blue-900">
                  <strong>Observação:</strong> {orderDetail.order.orderNote || delivery.notes}
                </p>
              )}
              <div>
                <p className="font-semibold text-foreground mb-2 flex items-center gap-1"><Package className="w-3.5 h-3.5" /> Itens do pedido</p>
                {orderDetail.items.length === 0 ? (
                  <p className="text-muted-foreground">Nenhum item informado.</p>
                ) : (
                  <div className="rounded-lg border border-border/60 overflow-hidden">
                    {orderDetail.items.map(item => {
                      const unit = (item as any).productUnit || 'un.';
                      return (
                        <div key={item.id} className="flex items-center justify-between gap-3 px-3 py-2 border-b last:border-b-0 border-border/50 bg-card">
                          <span className="font-medium text-foreground">{(item as any).productName || `Produto #${item.productId}`}</span>
                          <span className="text-muted-foreground whitespace-nowrap">
                            {item.quantity} {unit}
                            {item.totalPrice != null && ` · R$ ${Number(item.totalPrice).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </>
          )}
          {!orderDetail && (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1 text-muted-foreground">
                <p><strong className="text-foreground">Código:</strong> {delivery.orderCode || `#${delivery.id}`}</p>
                <p><strong className="text-foreground">Empresa:</strong> {delivery.companyName}</p>
                <p><strong className="text-foreground">Data de entrega:</strong> {formatOrderDate(delivery.scheduledDate)}</p>
                <p><strong className="text-foreground">Status:</strong> {cfg.label}</p>
                <p className="sm:col-span-2">
                  <strong className="text-foreground">Endereço:</strong>{' '}
                  {delivery.addressStreet || '—'}{delivery.addressCity ? `, ${delivery.addressCity}` : ''}
                </p>
              </div>
              {delivery.notes && <p className="text-muted-foreground"><strong className="text-foreground">Observação:</strong> {delivery.notes}</p>}
              <p className="text-muted-foreground italic">Itens detalhados não estão disponíveis para esta entrega legada.</p>
            </>
          )}
        </div>
      )}
      {expanded && delivery.canUpdate !== false && (
        <StopStatusForm delivery={delivery} onSuccess={() => setExpanded(false)} />
      )}
      {expanded && delivery.canUpdate === false && (
        <p className="mt-3 pt-3 border-t border-border/50 text-xs italic text-muted-foreground">
          Pedido disponível apenas para visualização.
        </p>
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
          const lat = parseFloat(d.latitude ?? '0');
          const lng = parseFloat(d.longitude ?? '0');
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
  const { user, logout } = useAuth();
  const isDriverUser = (user as any)?.role === 'DRIVER' || (user as any)?.role === 'MOTORISTA';
  const [view, setView] = useState<'list' | 'map' | 'nfe'>('list');
  const formatDateInput = (date: Date) => {
    const local = new Date(date);
    local.setMinutes(local.getMinutes() - local.getTimezoneOffset());
    return local.toISOString().slice(0, 10);
  };
  const [dateFrom, setDateFrom] = useState(() => formatDateInput(new Date()));
  const [dateTo, setDateTo] = useState(() => formatDateInput(new Date()));
  const [companyId, setCompanyId] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [appliedFilters, setAppliedFilters] = useState({
    dateFrom: formatDateInput(new Date()),
    dateTo: formatDateInput(new Date()),
    companyId: '',
    search: '',
  });
  const today = new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' });

  const { data, isLoading, refetch } = useQuery<{
    deliveries: DeliveryItem[];
    driver: any;
    companies?: Array<{ id: number; name: string; cnpj?: string | null }>;
    date: string;
  }>({
    queryKey: ['/api/driver/route-today', appliedFilters],
    queryFn: async () => {
      const params = new URLSearchParams({ dateFrom: appliedFilters.dateFrom, dateTo: appliedFilters.dateTo });
      if (appliedFilters.companyId) params.set('companyId', appliedFilters.companyId);
      const response = await fetch(`/api/driver/route-today?${params.toString()}`, { credentials: 'include' });
      if (!response.ok) throw new Error('Não foi possível carregar os pedidos');
      return response.json();
    },
  });
  const { data: liveDrivers = [] } = useQuery<LiveDriverLocation[]>({
    queryKey: ['/api/logistics/drivers/gps'],
    enabled: !isDriverUser,
    refetchInterval: 15000,
  });

  const deliveries = data?.deliveries || [];

  const normalizedSearch = normalizeSearchValue(appliedFilters.search);
  const filteredDeliveries = normalizedSearch
    ? deliveries.filter(delivery => [
        delivery.orderCode,
        delivery.companyName,
        delivery.companyCnpj,
      ].some(value => normalizeSearchValue(value).includes(normalizedSearch)))
    : deliveries;
  const sorted = [...filteredDeliveries].sort((a, b) => (a.routePosition || 999) - (b.routePosition || 999));
  const filteredPendentes = sorted.filter(d => d.status === 'pendente' || d.status === 'em_rota').length;
  const filteredConcluidos = sorted.filter(d => d.status !== 'pendente' && d.status !== 'em_rota').length;
  const filteredEntregues = sorted.filter(d => d.status === 'entregue').length;
  const filteredEmRota = sorted.filter(d => d.status === 'em_rota').length;

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
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => refetch()}
              className="p-2 rounded-xl bg-white/20 hover:bg-white/30 transition-colors"
              data-testid="button-refresh-route"
              aria-label="Atualizar rota"
              title="Atualizar rota"
            >
              <RefreshCw className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={() => logout()}
              className="inline-flex items-center gap-1.5 rounded-xl bg-white/20 hover:bg-white/30 transition-colors px-3 py-2 text-xs font-medium"
              data-testid="button-switch-user"
              aria-label="Sair e trocar de usuário"
              title="Sair e trocar de usuário"
            >
              <LogOut className="w-4 h-4" />
              <span className="hidden sm:inline">Trocar usuário</span>
            </button>
          </div>
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
          <div className="text-2xl font-bold text-foreground">{sorted.length}</div>
          <div className="text-[10px] text-muted-foreground uppercase tracking-wide">Total</div>
        </div>
        <div className="p-3 text-center">
          <div className="text-2xl font-bold text-yellow-600">{filteredPendentes}</div>
          <div className="text-[10px] text-muted-foreground uppercase tracking-wide">Pendentes</div>
        </div>
        <div className="p-3 text-center">
          <div className="text-2xl font-bold text-green-600">{filteredConcluidos}</div>
          <div className="text-[10px] text-muted-foreground uppercase tracking-wide">Concluídos</div>
        </div>
      </div>

      <div className="p-4 mt-3 space-y-3">
        <DriverGpsReporter role={(user as any)?.role} />
        {!isDriverUser && <LiveDriverLocations drivers={liveDrivers} />}
        <div className="rounded-2xl border border-border bg-card p-3 shadow-sm space-y-3" data-testid="driver-order-filters">
          <div className="flex items-center gap-2">
            <CalendarClock className="w-4 h-4 text-blue-600" />
            <p className="text-sm font-semibold text-foreground">Consultar pedidos disponíveis</p>
          </div>
          <label className="block text-xs text-muted-foreground">
            Buscar pedido ou cliente
            <input
              type="search"
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              placeholder="Código, nome da empresa ou CNPJ"
              className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
              data-testid="input-driver-order-search"
            />
          </label>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <label className="text-xs text-muted-foreground">
              De
              <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="mt-1 w-full rounded-lg border border-border bg-background px-2 py-2 text-sm text-foreground" data-testid="input-driver-date-from" />
            </label>
            <label className="text-xs text-muted-foreground">
              Até
              <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className="mt-1 w-full rounded-lg border border-border bg-background px-2 py-2 text-sm text-foreground" data-testid="input-driver-date-to" />
            </label>
            <label className="text-xs text-muted-foreground">
              Empresa
              <select value={companyId} onChange={e => setCompanyId(e.target.value)} className="mt-1 w-full rounded-lg border border-border bg-background px-2 py-2 text-sm text-foreground" data-testid="select-driver-company">
                <option value="">Todas as empresas</option>
                {(data?.companies ?? []).map(company => <option key={company.id} value={company.id}>{company.name}</option>)}
              </select>
            </label>
          </div>
          <div className="flex gap-2">
            <Button
              type="button"
              size="sm"
              onClick={() => {
                if (!dateFrom || !dateTo || dateFrom > dateTo) return;
                setAppliedFilters({ dateFrom, dateTo, companyId, search: searchTerm });
              }}
              className="gap-2"
              data-testid="button-apply-driver-filters"
            >
              <RefreshCw className="w-3.5 h-3.5" /> Buscar pedidos
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => {
                const current = formatDateInput(new Date());
                setDateFrom(current);
                setDateTo(current);
                setCompanyId('');
                setSearchTerm('');
                setAppliedFilters({ dateFrom: current, dateTo: current, companyId: '', search: '' });
              }}
              data-testid="button-clear-driver-filters"
            >
              Hoje
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => {
                setCompanyId('');
                setSearchTerm('');
                setAppliedFilters(current => ({ ...current, companyId: '', search: '' }));
              }}
              data-testid="button-reset-driver-filters"
            >
              Limpar filtros
            </Button>
          </div>
          {dateFrom > dateTo && <p className="text-xs text-red-600">A data inicial deve ser anterior ou igual à data final.</p>}
        </div>
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

        {!isLoading && sorted.length === 0 && (
          <div className="text-center py-12 bg-card rounded-2xl border border-border/50">
            <Package className="w-12 h-12 mx-auto text-muted-foreground/30 mb-3" />
            <p className="font-medium text-foreground">{normalizedSearch ? 'Nenhum pedido encontrado' : 'Sem entregas hoje'}</p>
            <p className="text-sm text-muted-foreground mt-1">
              {normalizedSearch ? 'Tente outro código, cliente ou CNPJ.' : 'Nenhuma entrega agendada para o período selecionado.'}
            </p>
          </div>
        )}

        {!isLoading && view === 'nfe' && (
          <NFeRoutePanel
            companyIds={deliveries.map(d => d.companyId)}
            companyNames={deliveries.map(d => d.companyName).filter(Boolean)}
          />
        )}

        {!isLoading && sorted.length > 0 && view !== 'nfe' && (
          <>
            {view === 'map' && <GpsMap deliveries={sorted} />}

            {view === 'list' && (
              <>
                {filteredEmRota > 0 && (
                  <div className="flex items-center gap-2 text-sm text-blue-700 bg-blue-50 rounded-xl px-3 py-2 border border-blue-200">
                    <Navigation className="w-4 h-4 animate-pulse" />
                    <span className="font-medium">{filteredEmRota} entrega(s) em rota agora</span>
                  </div>
                )}
                {sorted.map(d => <DeliveryCard key={d.id} delivery={d} />)}
              </>
            )}

            {filteredEntregues === sorted.length && sorted.length > 0 && view === 'list' && (
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
