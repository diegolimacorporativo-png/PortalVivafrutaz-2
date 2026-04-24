import { useRoute } from 'wouter';
import { useQuery } from '@tanstack/react-query';
import {
  Truck, CheckCircle2, Clock, MapPin, Package,
  Navigation, RefreshCw, AlertCircle, ArrowRight,
} from 'lucide-react';

const STATUS_LABELS: Record<string, { label: string; icon: any; color: string; description: string }> = {
  pendente:  {
    label: 'Aguardando',
    icon: Clock,
    color: 'text-yellow-600',
    description: 'Sua entrega está agendada e aguardando saída.',
  },
  em_rota: {
    label: 'A Caminho',
    icon: Truck,
    color: 'text-blue-600',
    description: 'O motorista está em rota e sua entrega está próxima!',
  },
  entregue: {
    label: 'Entregue',
    icon: CheckCircle2,
    color: 'text-green-600',
    description: 'Sua entrega foi concluída com sucesso.',
  },
  cancelado: {
    label: 'Cancelado',
    icon: AlertCircle,
    color: 'text-red-600',
    description: 'Esta entrega foi cancelada.',
  },
};

interface TrackingData {
  id: number;
  status: string;
  companyId: number;
  scheduledDate: string;
  deliveredAt?: string;
  routePosition?: number;
  totalStopsInRoute: number;
  stopsAhead: number;
  etaMinutes: number;
  etaTime: string;
  driverPosition?: { lat: string; lng: string; updatedAt: string } | null;
}

function formatEta(minutes: number): string {
  if (minutes <= 0) return 'Já deve estar chegando!';
  if (minutes < 60) return `${Math.round(minutes)} minutos`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h}h${m > 0 ? ` ${m}min` : ''}`;
}

export default function TrackDelivery() {
  const [, params] = useRoute('/track/:id');
  const deliveryId = params?.id;

  const { data, isLoading, error, refetch } = useQuery<TrackingData>({
    queryKey: ['/api/track', deliveryId],
    queryFn: async () => {
      const r = await fetch(`/api/track/${deliveryId}`);
      if (!r.ok) throw new Error('Entrega não encontrada');
      return r.json();
    },
    enabled: !!deliveryId,
    refetchInterval: 60000, // Auto-refresh every minute
  });

  const statusCfg = data ? (STATUS_LABELS[data.status] || STATUS_LABELS.pendente) : null;
  const StatusIcon = statusCfg?.icon || Package;

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-50">
      {/* Header */}
      <div className="bg-gradient-to-r from-blue-600 to-blue-800 text-white px-4 py-6 text-center">
        <div className="flex items-center justify-center gap-2 mb-1">
          <Truck className="w-6 h-6" />
          <h1 className="text-xl font-bold">Rastreamento de Entrega</h1>
        </div>
        <p className="text-sm text-blue-200">VivaFrutaz — Acompanhe sua entrega</p>
      </div>

      <div className="max-w-md mx-auto px-4 py-6 space-y-4">
        {/* Loading */}
        {isLoading && (
          <div className="bg-white rounded-2xl shadow-sm border p-12 text-center">
            <RefreshCw className="w-10 h-10 animate-spin mx-auto text-blue-500 mb-3" />
            <p className="text-sm text-gray-500">Buscando sua entrega...</p>
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="bg-white rounded-2xl shadow-sm border p-10 text-center">
            <AlertCircle className="w-10 h-10 text-red-400 mx-auto mb-3" />
            <h2 className="font-semibold text-gray-800 mb-1">Entrega não encontrada</h2>
            <p className="text-sm text-gray-500">Verifique o código e tente novamente.</p>
          </div>
        )}

        {/* Tracking info */}
        {data && statusCfg && (
          <>
            {/* Status card */}
            <div className={`bg-white rounded-2xl shadow-sm border-2 p-6 ${
              data.status === 'entregue' ? 'border-green-300' :
              data.status === 'em_rota' ? 'border-blue-300' :
              data.status === 'cancelado' ? 'border-red-300' : 'border-yellow-300'
            }`}>
              <div className="flex items-center gap-4">
                <div className={`w-14 h-14 rounded-2xl flex items-center justify-center ${
                  data.status === 'entregue' ? 'bg-green-100' :
                  data.status === 'em_rota' ? 'bg-blue-100' :
                  data.status === 'cancelado' ? 'bg-red-100' : 'bg-yellow-100'
                }`}>
                  <StatusIcon className={`w-7 h-7 ${statusCfg.color}`} />
                </div>
                <div>
                  <div className={`text-lg font-bold ${statusCfg.color}`}>{statusCfg.label}</div>
                  <div className="text-sm text-gray-500 mt-0.5">{statusCfg.description}</div>
                </div>
              </div>

              {/* Delivery ID */}
              <div className="mt-4 pt-4 border-t border-gray-100 flex justify-between text-sm">
                <span className="text-gray-500">Código da entrega</span>
                <span className="font-mono font-semibold text-gray-800">#{String(data.id).padStart(6, '0')}</span>
              </div>
              {data.scheduledDate && (
                <div className="flex justify-between text-sm mt-2">
                  <span className="text-gray-500">Data agendada</span>
                  <span className="font-medium text-gray-800">
                    {new Date(data.scheduledDate + 'T12:00:00').toLocaleDateString('pt-BR')}
                  </span>
                </div>
              )}
              {data.deliveredAt && (
                <div className="flex justify-between text-sm mt-2">
                  <span className="text-gray-500">Entregue às</span>
                  <span className="font-medium text-green-700">
                    {new Date(data.deliveredAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                  </span>
                </div>
              )}
            </div>

            {/* Route progress (only if in_route or pending) */}
            {(data.status === 'em_rota' || data.status === 'pendente') && data.totalStopsInRoute > 0 && (
              <div className="bg-white rounded-2xl shadow-sm border p-5">
                <h2 className="font-semibold text-gray-800 mb-4 flex items-center gap-2">
                  <Navigation className="w-4 h-4 text-blue-500" />
                  Posição na Rota
                </h2>

                {/* Progress bar */}
                <div className="mb-3">
                  <div className="flex justify-between text-xs text-gray-500 mb-1">
                    <span>Início</span>
                    <span>Sua entrega #{data.routePosition || '?'} de {data.totalStopsInRoute}</span>
                  </div>
                  <div className="h-3 bg-gray-100 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-blue-500 rounded-full transition-all duration-500"
                      style={{
                        width: data.totalStopsInRoute > 0
                          ? `${Math.round(((data.totalStopsInRoute - data.stopsAhead) / data.totalStopsInRoute) * 100)}%`
                          : '0%'
                      }}
                    />
                  </div>
                </div>

                <div className="flex items-center gap-2 text-sm">
                  <Clock className="w-4 h-4 text-blue-500 shrink-0" />
                  <div>
                    <span className="text-gray-500">Previsão de chegada: </span>
                    <span className="font-semibold text-blue-700">{formatEta(data.etaMinutes)}</span>
                  </div>
                </div>

                {data.stopsAhead > 0 && (
                  <p className="text-xs text-gray-500 mt-2">
                    {data.stopsAhead} parada{data.stopsAhead !== 1 ? 's' : ''} antes da sua entrega.
                  </p>
                )}
              </div>
            )}

            {/* GPS position */}
            {data.driverPosition && (
              <div className="bg-white rounded-2xl shadow-sm border p-5">
                <h2 className="font-semibold text-gray-800 mb-3 flex items-center gap-2">
                  <MapPin className="w-4 h-4 text-green-500" />
                  Localização do Motorista
                </h2>
                <div className="bg-green-50 rounded-xl p-3 text-sm">
                  <p className="text-green-700 font-medium">GPS Ativo</p>
                  <p className="text-green-600 text-xs mt-1">
                    Última atualização: {new Date(data.driverPosition.updatedAt).toLocaleTimeString('pt-BR')}
                  </p>
                  <a
                    href={`https://www.google.com/maps/search/?api=1&query=${data.driverPosition.lat},${data.driverPosition.lng}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1 text-blue-600 hover:text-blue-700 mt-2 text-xs font-medium"
                  >
                    Ver no mapa
                    <ArrowRight className="w-3 h-3" />
                  </a>
                </div>
              </div>
            )}

            {/* Delivered success */}
            {data.status === 'entregue' && (
              <div className="bg-green-50 rounded-2xl border border-green-200 p-6 text-center">
                <CheckCircle2 className="w-12 h-12 text-green-600 mx-auto mb-3" />
                <h2 className="font-bold text-green-800 text-lg">Entrega Concluída!</h2>
                <p className="text-sm text-green-600 mt-1">
                  Obrigado pela confiança. Até a próxima!
                </p>
              </div>
            )}

            {/* Refresh button */}
            <button
              type="button"
              onClick={() => refetch()}
              className="w-full flex items-center justify-center gap-2 text-sm text-gray-500 hover:text-gray-700 py-3 transition-colors"
              data-testid="button-refresh-tracking"
            >
              <RefreshCw className="w-4 h-4" />
              Atualizar status
            </button>
          </>
        )}
      </div>
    </div>
  );
}
