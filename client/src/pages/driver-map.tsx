import { useEffect, useMemo, useState } from "react";
import { useRoute } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { MapContainer, TileLayer, Marker, Polyline, Popup, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { Truck, MapPin, Navigation, RefreshCw, AlertCircle, CheckCircle2, Clock } from "lucide-react";

// Leaflet's default marker icons break under bundlers because the URLs are
// resolved relative to the CSS file. Re-pin them to the CDN so the markers
// always render. (No new package — uses the leaflet that's already installed.)
const DefaultIcon = L.icon({
  iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41],
});
L.Marker.prototype.options.icon = DefaultIcon;

// Truck icon for the live driver marker — inline SVG so we don't ship assets.
const truckIcon = L.divIcon({
  className: "",
  html: `
    <div style="width:40px;height:40px;display:flex;align-items:center;justify-content:center;
                background:#2563eb;border-radius:50%;border:3px solid #fff;
                box-shadow:0 2px 8px rgba(0,0,0,0.3);">
      <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24"
           fill="none" stroke="#fff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
        <path d="M14 18V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v11a1 1 0 0 0 1 1h2"/>
        <path d="M15 18H9"/>
        <path d="M19 18h2a1 1 0 0 0 1-1v-3.65a1 1 0 0 0-.22-.624l-3.48-4.35A1 1 0 0 0 17.52 8H14"/>
        <circle cx="17" cy="18" r="2"/>
        <circle cx="7" cy="18" r="2"/>
      </svg>
    </div>`,
  iconSize: [40, 40],
  iconAnchor: [20, 20],
});

const stopIcon = (status: string, position?: number | null) => {
  const color =
    status === "entregue" ? "#16a34a" :
    status === "em_rota" ? "#2563eb" :
    status === "cancelado" ? "#dc2626" : "#eab308";
  return L.divIcon({
    className: "",
    html: `
      <div style="width:28px;height:28px;display:flex;align-items:center;justify-content:center;
                  background:${color};color:#fff;border-radius:50%;border:2px solid #fff;
                  box-shadow:0 2px 4px rgba(0,0,0,0.25);font-weight:700;font-size:12px;">
        ${position ?? "•"}
      </div>`,
    iconSize: [28, 28],
    iconAnchor: [14, 14],
  });
};

interface TrackingResponse {
  route: { id: number; name: string | null; status: string; deliveryDate: string | null; driverId: number | null; vehicleId: number | null };
  driver: { id: number; name: string | null; phone: string | null } | null;
  stops: Array<{
    id: number; ordem: number | null; companyId: number | null;
    cep: string | null; endereco: string | null; numero: string | null;
    cidade: string | null; estado: string | null;
    latitude: string | null; longitude: string | null;
    janelaInicio: string | null; janelaFim: string | null; tempoEstimadoMin: number | null;
  }>;
  deliveries: Array<{
    id: number; orderId: number | null; companyId: number | null; companyName: string | null;
    status: string; routePosition: number | null;
    latitude: string | null; longitude: string | null;
    scheduledDate: string | null; deliveredAt: string | null;
  }>;
  driverPosition: { lat: string; lng: string; accuracy: string | null; speed: string | null; heading: string | null; updatedAt: string } | null;
}

// Re-fits the map whenever the set of points changes (driver or stops).
function FitBounds({ points }: { points: Array<[number, number]> }) {
  const map = useMap();
  useEffect(() => {
    if (points.length === 0) return;
    if (points.length === 1) {
      map.setView(points[0], 14);
      return;
    }
    const bounds = L.latLngBounds(points.map((p) => L.latLng(p[0], p[1])));
    map.fitBounds(bounds, { padding: [40, 40] });
  }, [map, JSON.stringify(points)]);
  return null;
}

export default function DriverMap() {
  const [, params] = useRoute("/driver-map/:routeId");
  const routeId = params?.routeId;
  const [autoRefresh, setAutoRefresh] = useState(true);

  const { data, isLoading, error, refetch, isFetching } = useQuery<TrackingResponse>({
    queryKey: ["/api/logistics/track", routeId],
    queryFn: async () => {
      const r = await fetch(`/api/logistics/track/${routeId}`);
      if (!r.ok) {
        const body = await r.json().catch(() => ({}));
        throw new Error(body?.error || "Rota não encontrada");
      }
      return r.json();
    },
    enabled: !!routeId,
    refetchInterval: autoRefresh ? 5000 : false,
  });

  // Build map points: stops first (use route_stops if present, else fall back to deliveries).
  const stopMarkers = useMemo(() => {
    if (!data) return [];
    if (data.stops.length > 0) {
      return data.stops
        .filter((s) => s.latitude && s.longitude)
        .map((s) => {
          // Match status from corresponding delivery (by companyId) if any.
          const matched = data.deliveries.find((d) => d.companyId === s.companyId);
          return {
            id: `stop-${s.id}`,
            lat: parseFloat(s.latitude as string),
            lng: parseFloat(s.longitude as string),
            position: s.ordem ?? matched?.routePosition ?? null,
            title: matched?.companyName || s.endereco || `Parada #${s.ordem ?? s.id}`,
            subtitle: [s.cidade, s.estado].filter(Boolean).join(" / "),
            status: matched?.status || "pendente",
            window: s.janelaInicio && s.janelaFim ? `${s.janelaInicio} – ${s.janelaFim}` : null,
          };
        });
    }
    return data.deliveries
      .filter((d) => d.latitude && d.longitude)
      .map((d) => ({
        id: `del-${d.id}`,
        lat: parseFloat(d.latitude as string),
        lng: parseFloat(d.longitude as string),
        position: d.routePosition,
        title: d.companyName || `Entrega #${d.id}`,
        subtitle: d.scheduledDate ?? "",
        status: d.status,
        window: null,
      }));
  }, [data]);

  const driverPoint = useMemo(() => {
    if (!data?.driverPosition) return null;
    const lat = parseFloat(data.driverPosition.lat);
    const lng = parseFloat(data.driverPosition.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    return { lat, lng };
  }, [data]);

  const fitPoints: Array<[number, number]> = useMemo(() => {
    const pts: Array<[number, number]> = stopMarkers.map((s) => [s.lat, s.lng]);
    if (driverPoint) pts.push([driverPoint.lat, driverPoint.lng]);
    return pts;
  }, [stopMarkers, driverPoint]);

  const polyline: Array<[number, number]> = useMemo(
    () => stopMarkers.map((s) => [s.lat, s.lng]),
    [stopMarkers],
  );

  const completed = data?.deliveries.filter((d) => d.status === "entregue").length ?? 0;
  const total = data?.deliveries.length ?? 0;
  const progressPct = total > 0 ? Math.round((completed / total) * 100) : 0;

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col" data-testid="page-driver-map">
      {/* Header */}
      <div className="bg-white border-b shadow-sm px-4 py-3 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-10 h-10 rounded-xl bg-blue-600 flex items-center justify-center shrink-0">
            <Truck className="w-5 h-5 text-white" />
          </div>
          <div className="min-w-0">
            <h1 className="font-bold text-gray-900 truncate" data-testid="text-route-title">
              {data?.route?.name || `Rota #${routeId}`}
            </h1>
            <p className="text-xs text-gray-500 truncate" data-testid="text-driver-name">
              {data?.driver?.name ? `Motorista: ${data.driver.name}` : "Sem motorista atribuído"}
              {data?.route?.deliveryDate ? ` • ${data.route.deliveryDate}` : ""}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => setAutoRefresh((v) => !v)}
            className={`text-xs px-2 py-1 rounded border ${autoRefresh ? "bg-green-50 text-green-700 border-green-300" : "bg-gray-50 text-gray-600 border-gray-300"}`}
            data-testid="button-toggle-autorefresh"
          >
            {autoRefresh ? "Auto 5s" : "Pausado"}
          </button>
          <button
            type="button"
            onClick={() => refetch()}
            disabled={isFetching}
            className="p-2 rounded-lg hover:bg-gray-100 disabled:opacity-50"
            data-testid="button-refresh-map"
            title="Atualizar agora"
          >
            <RefreshCw className={`w-4 h-4 text-gray-600 ${isFetching ? "animate-spin" : ""}`} />
          </button>
        </div>
      </div>

      {/* Status strip */}
      {data && (
        <div className="bg-white border-b px-4 py-2 flex items-center gap-4 text-xs flex-wrap">
          <span className="flex items-center gap-1 text-gray-600">
            <Navigation className="w-3.5 h-3.5 text-blue-500" />
            <span data-testid="text-route-status">Status: <strong>{data.route.status}</strong></span>
          </span>
          <span className="flex items-center gap-1 text-gray-600" data-testid="text-progress">
            <CheckCircle2 className="w-3.5 h-3.5 text-green-500" />
            {completed}/{total} entregues ({progressPct}%)
          </span>
          {data.driverPosition && (
            <span className="flex items-center gap-1 text-gray-600" data-testid="text-gps-updated">
              <Clock className="w-3.5 h-3.5 text-emerald-500" />
              GPS: {new Date(data.driverPosition.updatedAt).toLocaleTimeString("pt-BR")}
            </span>
          )}
          {!data.driverPosition && (
            <span className="flex items-center gap-1 text-gray-500" data-testid="text-no-gps">
              <MapPin className="w-3.5 h-3.5" />
              GPS ainda não recebido
            </span>
          )}
        </div>
      )}

      {/* Map */}
      <div className="flex-1 relative">
        {isLoading && (
          <div className="absolute inset-0 flex items-center justify-center bg-gray-50 z-[400]">
            <div className="text-center">
              <RefreshCw className="w-8 h-8 animate-spin mx-auto text-blue-500 mb-2" />
              <p className="text-sm text-gray-500">Carregando rota...</p>
            </div>
          </div>
        )}
        {error && (
          <div className="absolute inset-0 flex items-center justify-center bg-gray-50 z-[400] p-6">
            <div className="text-center max-w-sm">
              <AlertCircle className="w-10 h-10 text-red-400 mx-auto mb-2" />
              <h2 className="font-semibold text-gray-800">Não foi possível carregar a rota</h2>
              <p className="text-sm text-gray-500 mt-1">{(error as Error).message}</p>
            </div>
          </div>
        )}

        <MapContainer
          center={fitPoints[0] || [-23.5505, -46.6333]}
          zoom={12}
          scrollWheelZoom
          style={{ height: "100%", width: "100%" }}
        >
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          <FitBounds points={fitPoints} />

          {polyline.length >= 2 && (
            <Polyline positions={polyline} pathOptions={{ color: "#2563eb", weight: 4, opacity: 0.6 }} />
          )}

          {stopMarkers.map((s) => (
            <Marker key={s.id} position={[s.lat, s.lng]} icon={stopIcon(s.status, s.position)}>
              <Popup>
                <div className="text-sm">
                  <div className="font-semibold text-gray-900">{s.title}</div>
                  {s.subtitle && <div className="text-gray-500 text-xs">{s.subtitle}</div>}
                  <div className="mt-1 text-xs">
                    Status: <strong>{s.status}</strong>
                    {s.position != null && <> &middot; #{s.position}</>}
                  </div>
                  {s.window && <div className="text-xs text-gray-500">Janela: {s.window}</div>}
                </div>
              </Popup>
            </Marker>
          ))}

          {driverPoint && (
            <Marker position={[driverPoint.lat, driverPoint.lng]} icon={truckIcon} zIndexOffset={1000}>
              <Popup>
                <div className="text-sm">
                  <div className="font-semibold text-blue-700">
                    {data?.driver?.name || "Motorista"}
                  </div>
                  {data?.driverPosition && (
                    <div className="text-xs text-gray-500">
                      Atualizado às {new Date(data.driverPosition.updatedAt).toLocaleTimeString("pt-BR")}
                    </div>
                  )}
                </div>
              </Popup>
            </Marker>
          )}
        </MapContainer>
      </div>
    </div>
  );
}
