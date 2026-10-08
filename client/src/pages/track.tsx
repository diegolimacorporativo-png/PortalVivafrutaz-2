import { useRoute } from "wouter";
import { useQuery } from "@tanstack/react-query";
import {
  AlertCircle,
  CheckCircle2,
  Clock3,
  MapPin,
  Navigation,
  PackageCheck,
  RefreshCw,
  Truck,
} from "lucide-react";
import { CircleMarker, MapContainer, Popup, TileLayer } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import { fetchWithAuth } from "@/lib/fetchWithAuth";

type TrackingData = {
  status: "scheduled" | "in_transit" | "driver_nearby" | "delayed" | "delivered" | "cancelled";
  deliveryStatus: "scheduled" | "in_transit" | "delivered" | "cancelled";
  trackingAvailable: boolean;
  scheduledDate: string | null;
  deliveryWindow: { startTime: string; endTime: string } | null;
  deliveredAt: string | null;
  lastUpdatedAt: string | null;
  etaRange: { from: string; to: string } | null;
  stopsBefore: number | null;
  isNextStop: boolean;
  isDriverNearby: boolean;
  delayed: boolean;
  delayMinutes: number;
  message: string;
  deliveryLocation: { lat: string | null; lng: string | null } | null;
  driverPosition: { lat: string | null; lng: string | null; updatedAt: string | null } | null;
};

const STATUS_PRESENTATION: Record<string, {
  title: string;
  description: string;
  icon: typeof Clock3;
  color: string;
  border: string;
}> = {
  scheduled: {
    title: "Entrega programada",
    description: "Sua entrega está prevista para a data e janela abaixo.",
    icon: Clock3,
    color: "text-amber-700",
    border: "border-amber-300",
  },
  in_transit: {
    title: "Entrega em rota",
    description: "A rota foi iniciada. A previsão pode mudar conforme o andamento.",
    icon: Truck,
    color: "text-blue-700",
    border: "border-blue-300",
  },
  driver_nearby: {
    title: "Motorista nas proximidades",
    description: "O motorista está perto do endereço desta entrega.",
    icon: MapPin,
    color: "text-emerald-700",
    border: "border-emerald-300",
  },
  delayed: {
    title: "Previsão atualizada",
    description: "A entrega está fora da janela prevista.",
    icon: AlertCircle,
    color: "text-orange-700",
    border: "border-orange-300",
  },
  delivered: {
    title: "Entrega concluída",
    description: "Sua entrega foi concluída com sucesso.",
    icon: CheckCircle2,
    color: "text-green-700",
    border: "border-green-300",
  },
  cancelled: {
    title: "Pedido cancelado",
    description: "Este pedido não será entregue.",
    icon: AlertCircle,
    color: "text-red-700",
    border: "border-red-300",
  },
};

function formatTime(value: string | null | undefined): string {
  if (!value) return "—";
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(`${value.slice(0, 10)}T12:00:00-03:00`);
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    dateStyle: "long",
  }).format(date);
}

function TrackingMap({ data }: { data: TrackingData }) {
  const destination = data.deliveryLocation;
  const driver = data.trackingAvailable ? data.driverPosition : null;
  const destinationLat = Number(destination?.lat);
  const destinationLng = Number(destination?.lng);
  const driverLat = Number(driver?.lat);
  const driverLng = Number(driver?.lng);
  const hasDestination = Number.isFinite(destinationLat) && Number.isFinite(destinationLng);
  const hasDriver = Number.isFinite(driverLat) && Number.isFinite(driverLng);

  if (!hasDestination && !hasDriver) return null;
  const points: [number, number][] = [];
  if (hasDestination) points.push([destinationLat, destinationLng]);
  if (hasDriver) points.push([driverLat, driverLng]);
  const center: [number, number] = [
    points.reduce((total, point) => total + point[0], 0) / points.length,
    points.reduce((total, point) => total + point[1], 0) / points.length,
  ];

  return (
    <section className="overflow-hidden rounded-2xl border bg-white shadow-sm" aria-label="Mapa da entrega">
      <div className="border-b px-5 py-4">
        <h2 className="flex items-center gap-2 font-semibold text-gray-900">
          <MapPin className="h-4 w-4 text-blue-600" />
          {hasDriver ? "Mapa da sua entrega" : "Endereço da entrega"}
        </h2>
        {hasDriver && <p className="mt-1 text-xs text-gray-500">A posição do motorista é aproximada.</p>}
      </div>
      <MapContainer center={center} zoom={hasDriver ? 12 : 14} style={{ height: 280, width: "100%" }} scrollWheelZoom={false}>
        <TileLayer
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        />
        {hasDestination && (
          <CircleMarker center={[destinationLat, destinationLng]} radius={9} pathOptions={{ color: "#1d4ed8", fillColor: "#3b82f6", fillOpacity: 0.9 }}>
            <Popup>Endereço desta entrega</Popup>
          </CircleMarker>
        )}
        {hasDriver && (
          <CircleMarker center={[driverLat, driverLng]} radius={8} pathOptions={{ color: "#047857", fillColor: "#10b981", fillOpacity: 0.9 }}>
            <Popup>Posição aproximada do motorista</Popup>
          </CircleMarker>
        )}
      </MapContainer>
    </section>
  );
}

export default function TrackDelivery() {
  const [, publicParams] = useRoute("/track/:token");
  const [, clientParams] = useRoute("/client/tracking/:orderId");
  const token = publicParams?.token;
  const orderId = clientParams?.orderId;
  const queryKey = token
    ? ["/api/track", token]
    : ["/api/orders", orderId, "tracking"];

  const { data, isLoading, error, refetch } = useQuery<TrackingData>({
    queryKey,
    queryFn: async () => {
      const path = token
        ? `/api/track/${encodeURIComponent(token)}`
        : `/api/orders/${encodeURIComponent(orderId || "")}/tracking`;
      const response = await fetchWithAuth(path);
      if (!response.ok) {
        throw new Error(response.status === 410
          ? "Este link de rastreamento não está mais disponível."
          : "Não foi possível localizar o acompanhamento deste pedido.");
      }
      return response.json();
    },
    enabled: Boolean(token || orderId),
    refetchInterval: (query) => query.state.data?.trackingAvailable ? 12_000 : false,
    refetchIntervalInBackground: false,
  });

  const status = data ? (STATUS_PRESENTATION[data.status] ?? STATUS_PRESENTATION.scheduled) : null;
  const StatusIcon = status?.icon ?? PackageCheck;

  return (
    <main className="min-h-screen bg-gradient-to-br from-blue-50 via-slate-50 to-indigo-50">
      <header className="bg-gradient-to-r from-blue-700 to-indigo-900 px-4 py-6 text-center text-white">
        <div className="mb-1 flex items-center justify-center gap-2">
          <Truck className="h-6 w-6" />
          <h1 className="text-xl font-bold">Acompanhamento da entrega</h1>
        </div>
        <p className="text-sm text-blue-100">VivaFrutaz</p>
      </header>

      <div className="mx-auto max-w-xl space-y-4 px-4 py-6">
        {isLoading && (
          <div className="rounded-2xl border bg-white p-12 text-center shadow-sm">
            <RefreshCw className="mx-auto mb-3 h-9 w-9 animate-spin text-blue-600" />
            <p className="text-sm text-gray-600">Carregando as informações da entrega...</p>
          </div>
        )}

        {error && (
          <div className="rounded-2xl border bg-white p-10 text-center shadow-sm">
            <AlertCircle className="mx-auto mb-3 h-10 w-10 text-red-500" />
            <h2 className="font-semibold text-gray-900">Acompanhamento indisponível</h2>
            <p className="mt-1 text-sm text-gray-600">{(error as Error).message}</p>
          </div>
        )}

        {data && status && (
          <>
            <section className={`rounded-2xl border-2 bg-white p-5 shadow-sm ${status.border}`}>
              <div className="flex items-start gap-4">
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-slate-100">
                  <StatusIcon className={`h-6 w-6 ${status.color}`} />
                </div>
                <div className="min-w-0 flex-1">
                  <h2 className={`text-lg font-bold ${status.color}`}>{status.title}</h2>
                  <p className="mt-1 text-sm text-gray-600">{data.message || status.description}</p>
                </div>
              </div>

              {data.scheduledDate && (
                <div className="mt-4 flex justify-between border-t pt-4 text-sm">
                  <span className="text-gray-500">Data prevista</span>
                  <span className="font-medium text-gray-900">{formatDate(data.scheduledDate)}</span>
                </div>
              )}
              {data.deliveryWindow && (
                <div className="mt-2 flex justify-between text-sm">
                  <span className="text-gray-500">Janela de entrega</span>
                  <span className="font-medium text-gray-900">
                    {data.deliveryWindow.startTime}–{data.deliveryWindow.endTime}
                  </span>
                </div>
              )}
              {data.deliveredAt && (
                <div className="mt-2 flex justify-between text-sm">
                  <span className="text-gray-500">Entregue às</span>
                  <span className="font-medium text-green-700">{formatTime(data.deliveredAt)}</span>
                </div>
              )}
            </section>

            {data.delayed && (
              <section role="status" className="rounded-2xl border border-orange-200 bg-orange-50 p-4 text-sm text-orange-900">
                <p className="font-semibold">A entrega está atrasada em relação à janela prevista.</p>
                <p className="mt-1 text-orange-800">
                  {data.delayMinutes > 0
                    ? `A janela terminou há aproximadamente ${data.delayMinutes} minutos.`
                    : "A previsão atual ultrapassa o fim da janela."}
                </p>
              </section>
            )}

            {data.trackingAvailable && (
              <section className="rounded-2xl border bg-white p-5 shadow-sm">
                <h2 className="mb-3 flex items-center gap-2 font-semibold text-gray-900">
                  <Navigation className="h-4 w-4 text-blue-600" />
                  Progresso da rota
                </h2>
                {data.isNextStop ? (
                  <p className="text-sm font-medium text-emerald-700">Sua entrega é a próxima parada.</p>
                ) : (
                  <p className="text-sm text-gray-700">
                    {data.stopsBefore ?? 0} parada{data.stopsBefore === 1 ? "" : "s"} antes da sua entrega.
                  </p>
                )}
                {data.etaRange && (
                  <div className="mt-4 flex items-start gap-2 rounded-xl bg-blue-50 p-3">
                    <Clock3 className="mt-0.5 h-4 w-4 shrink-0 text-blue-700" />
                    <div>
                      <p className="text-xs text-blue-800">Previsão estimada de chegada</p>
                      <p className="font-semibold text-blue-900">
                        {formatTime(data.etaRange.from)}–{formatTime(data.etaRange.to)}
                      </p>
                    </div>
                  </div>
                )}
                {data.lastUpdatedAt && (
                  <p className="mt-3 text-xs text-gray-500">
                    Posição atualizada às {formatTime(data.lastUpdatedAt)}
                  </p>
                )}
              </section>
            )}

            <TrackingMap data={data} />

            {data.deliveryStatus === "delivered" && (
              <div className="rounded-2xl border border-green-200 bg-green-50 p-5 text-center">
                <CheckCircle2 className="mx-auto mb-2 h-10 w-10 text-green-600" />
                <h2 className="font-bold text-green-900">Entrega concluída</h2>
                <p className="mt-1 text-sm text-green-800">Obrigado pela confiança.</p>
              </div>
            )}

            <button
              type="button"
              onClick={() => refetch()}
              className="flex w-full items-center justify-center gap-2 py-3 text-sm font-medium text-gray-600 transition-colors hover:text-gray-900"
              data-testid="button-refresh-tracking"
            >
              <RefreshCw className="h-4 w-4" />
              Atualizar acompanhamento
            </button>
          </>
        )}
      </div>
    </main>
  );
}
