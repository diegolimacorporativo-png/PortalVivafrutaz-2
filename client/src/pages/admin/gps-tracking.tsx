import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { MapContainer, Marker, Popup, TileLayer, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import markerIcon from "leaflet/dist/images/marker-icon.png";
import markerIcon2x from "leaflet/dist/images/marker-icon-2x.png";
import markerShadow from "leaflet/dist/images/marker-shadow.png";
import { AlertCircle, Clock, ExternalLink, MapPin, Navigation, Radio, RefreshCw, Users } from "lucide-react";
import { BackHeader } from "@/components/navigation/BackHeader";

interface LiveDriver {
  driverId: number;
  driverName: string;
  phone: string | null;
  active: boolean;
  latitude: string | null;
  longitude: string | null;
  accuracy: string | null;
  speed: string | null;
  heading: string | null;
  updatedAt: string | null;
}

const defaultCenter: [number, number] = [-23.5505, -46.6333];
const tileZoom = 11;

function tileUrlForCenter([latitude, longitude]: [number, number]) {
  const scale = 2 ** tileZoom;
  const x = Math.floor(((longitude + 180) / 360) * scale);
  const latitudeRadians = (latitude * Math.PI) / 180;
  const y = Math.floor(
    ((1 - Math.log(Math.tan(latitudeRadians) + 1 / Math.cos(latitudeRadians)) / Math.PI) / 2) * scale,
  );
  return `https://a.basemaps.cartocdn.com/light_all/${tileZoom}/${x}/${y}.png`;
}

const diagnosticTileUrl = tileUrlForCenter(defaultCenter);

// Vite does not preserve Leaflet's default image path automatically when the
// app is served behind the Replit preview proxy.
delete (L.Icon.Default.prototype as { _getIconUrl?: unknown })._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: markerIcon2x,
  iconUrl: markerIcon,
  shadowUrl: markerShadow,
});

function InvalidateMapSize() {
  const map = useMap();
  useEffect(() => {
    const invalidate = () => map.invalidateSize({ pan: false });
    const initialTimer = window.setTimeout(invalidate, 0);
    window.addEventListener("resize", invalidate);
    return () => {
      window.clearTimeout(initialTimer);
      window.removeEventListener("resize", invalidate);
    };
  }, [map]);
  return null;
}

function FitDriverBounds({ drivers }: { drivers: LiveDriver[] }) {
  const map = useMap();
  const fittedDriverSet = useRef<string | null>(null);

  useEffect(() => {
    const points = drivers
      .filter(d => d.latitude != null && d.longitude != null)
      .map(d => [Number(d.latitude), Number(d.longitude)] as [number, number])
      .filter(([lat, lng]) => Number.isFinite(lat) && Number.isFinite(lng));

    // Fit on the initial load and when the set of located drivers changes.
    // Position updates must not recenter the map while an administrator is
    // panning or zooming manually.
    const driverSet = drivers
      .map(driver => driver.driverId)
      .sort((a, b) => a - b)
      .join(",");
    if (fittedDriverSet.current === driverSet) return;
    fittedDriverSet.current = driverSet;

    if (points.length === 0) {
      if (driverSet === "") map.setView(defaultCenter, 11);
    } else if (points.length === 1) {
      map.setView(points[0], 14);
    } else {
      map.fitBounds(L.latLngBounds(points), { padding: [40, 40] });
    }
  }, [drivers, map]);
  return null;
}

function driverIcon(name: string, hasLocation: boolean) {
  const initials = name.split(/\s+/).map(part => part[0]).join("").slice(0, 2).toUpperCase() || "M";
  const color = hasLocation ? "#16a34a" : "#94a3b8";
  return L.divIcon({
    className: "",
    html: `<div style="width:38px;height:38px;border-radius:50%;background:${color};border:3px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,.3);display:flex;align-items:center;justify-content:center;color:#fff;font-size:11px;font-weight:700">${initials}</div>`,
    iconSize: [38, 38],
    iconAnchor: [19, 19],
  });
}

function minutesSince(updatedAt: string | null) {
  if (!updatedAt) return null;
  return Math.max(0, Math.round((Date.now() - new Date(updatedAt).getTime()) / 60000));
}

function statusLabel(driver: LiveDriver) {
  const minutes = minutesSince(driver.updatedAt);
  if (!driver.updatedAt) return { text: "Sem localização", className: "text-muted-foreground" };
  if (minutes != null && minutes > 5) return { text: `Última posição há ${minutes} min`, className: "text-amber-600" };
  return { text: "Localização ativa", className: "text-green-600" };
}

function googleMapsUrl(driver: LiveDriver) {
  return `https://www.google.com/maps/search/?api=1&query=${driver.latitude},${driver.longitude}`;
}

export default function GpsTracking() {
  const [tileStatus, setTileStatus] = useState<"loading" | "loaded" | "error">("loading");
  const [tileLoadedCount, setTileLoadedCount] = useState(0);
  const [tileFailedCount, setTileFailedCount] = useState(0);
  const [failedTileUrl, setFailedTileUrl] = useState<string | null>(null);
  const [diagnosticImageSize, setDiagnosticImageSize] = useState<string>("carregando...");
  const { data: drivers = [], isLoading, isFetching, error, refetch } = useQuery<LiveDriver[]>({
    queryKey: ["/api/logistics/drivers/gps"],
    refetchInterval: 10000,
  });

  const activeDrivers = useMemo(() => drivers.filter(driver => driver.active), [drivers]);
  const locatedDrivers = useMemo(
    () => activeDrivers.filter(driver => {
      if (driver.latitude == null || driver.longitude == null) return false;
      const latitude = Number(driver.latitude);
      const longitude = Number(driver.longitude);
      return Number.isFinite(latitude) && Number.isFinite(longitude)
        && latitude >= -90 && latitude <= 90
        && longitude >= -180 && longitude <= 180;
    }),
    [activeDrivers],
  );

  const inspectLeafletTiles = () => {
    const tiles = Array.from(document.querySelectorAll<HTMLImageElement>(".leaflet-tile"));
    const loaded = tiles.filter(tile => tile.complete && tile.naturalWidth > 0).length;
    const failed = tiles.filter(tile => tile.complete && tile.naturalWidth === 0).length;
    console.info("LEAFLET TILE COUNT:", tiles.length);
    console.info("LEAFLET TILE LOADED:", loaded);
    console.info("LEAFLET TILE FAILED:", failed);
  };

  return (
    <div className="min-h-screen bg-background">
      <BackHeader fallback="/admin/logistics" breadcrumb={[{ label: "Logística", href: "/admin/logistics" }, { label: "GPS em Tempo Real" }]} />
      <main className="max-w-7xl mx-auto px-4 pb-8 space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <Navigation className="w-6 h-6 text-primary" />
              <h1 className="text-2xl font-bold text-foreground">GPS em Tempo Real</h1>
            </div>
            <p className="text-sm text-muted-foreground mt-1">
              Localização direta dos motoristas, com ou sem rota atribuída.
            </p>
          </div>
          <button
            type="button"
            onClick={() => refetch()}
            className="inline-flex items-center justify-center gap-2 rounded-xl border border-border bg-card px-3 py-2 text-sm font-medium hover:bg-muted"
            data-testid="button-refresh-gps"
          >
            <RefreshCw className={`w-4 h-4 ${isFetching ? "animate-spin" : ""}`} />
            Atualizar agora
          </button>
        </div>

        {error && (
          <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            Não foi possível carregar as localizações. Verifique sua permissão de acesso.
          </div>
        )}

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <div className="rounded-2xl border border-border bg-card p-4">
            <Users className="w-5 h-5 text-primary mb-2" />
            <p className="text-2xl font-bold">{activeDrivers.length}</p>
            <p className="text-xs text-muted-foreground">Motoristas ativos</p>
          </div>
          <div className="rounded-2xl border border-green-200 bg-green-50 p-4">
            <Radio className="w-5 h-5 text-green-600 mb-2" />
            <p className="text-2xl font-bold text-green-700">{locatedDrivers.length}</p>
            <p className="text-xs text-green-700">Com GPS recebido</p>
          </div>
          <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
            <Clock className="w-5 h-5 text-amber-600 mb-2" />
            <p className="text-2xl font-bold text-amber-700">
              {activeDrivers.filter(driver => {
                const minutes = minutesSince(driver.updatedAt);
                return minutes == null || minutes > 5;
              }).length}
            </p>
            <p className="text-xs text-amber-700">Sem atualização recente</p>
          </div>
          <div className="rounded-2xl border border-blue-200 bg-blue-50 p-4">
            <MapPin className="w-5 h-5 text-blue-600 mb-2" />
            <p className="text-2xl font-bold text-blue-700">{locatedDrivers.length}</p>
            <p className="text-xs text-blue-700">Pontos no mapa</p>
          </div>
        </div>

        <div className="grid lg:grid-cols-[minmax(0,1fr)_360px] gap-5">
          <div className="rounded-2xl overflow-hidden border border-border bg-card shadow-sm">
            <div className="px-4 py-3 border-b border-border flex items-center justify-between">
              <h2 className="font-semibold">Mapa dos motoristas</h2>
              <span className="text-xs text-muted-foreground">Atualiza a cada 10 segundos</span>
            </div>
            <div className="h-[520px]">
              <MapContainer center={defaultCenter} zoom={11} className="h-full w-full" attributionControl>
                <InvalidateMapSize />
                <TileLayer
                  url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png"
                  subdomains={["a", "b", "c"]}
                  maxZoom={19}
                  crossOrigin="anonymous"
                  eventHandlers={{
                    loading: () => {
                      setTileStatus("loading");
                      console.info("MAP TILES LOADING");
                    },
                    tileload: event => {
                      const url = (event.tile as HTMLImageElement).src;
                      setTileLoadedCount(count => count + 1);
                      setTileStatus("loaded");
                      console.info("MAP TILE LOADED:", url);
                      window.setTimeout(inspectLeafletTiles, 0);
                    },
                    tileerror: event => {
                      const url = (event.tile as HTMLImageElement).src;
                      setTileFailedCount(count => count + 1);
                      setFailedTileUrl(url);
                      setTileStatus("error");
                      console.error("MAP TILE ERROR:", url);
                      window.setTimeout(inspectLeafletTiles, 0);
                    },
                    load: () => {
                      setTileStatus("loaded");
                      console.info("MAP TILES LOADED");
                      window.setTimeout(inspectLeafletTiles, 0);
                    },
                  }}
                  attribution='&copy; <a href="https://carto.com/attributions" target="_blank" rel="noopener noreferrer">CARTO</a> &copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> contributors'
                />
                <FitDriverBounds drivers={locatedDrivers} />
                {locatedDrivers.map(driver => (
                  <Marker
                    key={driver.driverId}
                    position={[Number(driver.latitude), Number(driver.longitude)]}
                    icon={driverIcon(driver.driverName, true)}
                  >
                    <Popup>
                      <strong>{driver.driverName}</strong>
                      <br />
                      {statusLabel(driver).text}
                      <br />
                      <span>{Number(driver.latitude).toFixed(6)}, {Number(driver.longitude).toFixed(6)}</span>
                      {driver.speed != null && <><br />Velocidade: {Number(driver.speed).toFixed(1)}</>}
                      <br />
                      <a
                        href={googleMapsUrl(driver)}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{ color: "#2563eb", fontWeight: 600 }}
                      >
                        Abrir local exato no Google Maps
                      </a>
                    </Popup>
                  </Marker>
                ))}
              </MapContainer>
            </div>
            <div className="border-t border-border bg-muted/30 px-4 py-3 text-xs space-y-2" data-testid="map-tile-diagnostics">
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                <strong>
                  Mapa: {tileStatus === "loading" ? "carregando..." : tileStatus === "loaded" ? "tiles carregados" : "erro ao carregar tiles"}
                </strong>
                <span>Carregados: {tileLoadedCount}</span>
                <span>Falhos: {tileFailedCount}</span>
              </div>
              {failedTileUrl && (
                <p className="break-all text-red-700">URL que falhou: {failedTileUrl}</p>
              )}
              <div className="flex items-center gap-3">
                <img
                  src={diagnosticTileUrl}
                  alt="Tile CARTO de diagnóstico"
                  className="h-16 w-16 rounded border border-border object-cover"
                  crossOrigin="anonymous"
                  onLoad={event => {
                    const image = event.currentTarget;
                    setDiagnosticImageSize(`${image.naturalWidth}×${image.naturalHeight}`);
                  }}
                  onError={() => setDiagnosticImageSize("erro ao carregar")}
                />
                <span>Teste direto do tile: {diagnosticImageSize}</span>
              </div>
            </div>
            {!isLoading && locatedDrivers.length === 0 && (
              <div className="px-4 py-3 text-xs text-muted-foreground border-t border-border">
                Nenhum ponto recebido ainda. O motorista precisa estar logado, com o painel aberto e permitir o GPS.
              </div>
            )}
          </div>

          <div className="rounded-2xl border border-border bg-card p-4">
            <h2 className="font-semibold mb-3">Motoristas ativos</h2>
            {isLoading ? (
              <div className="py-8 text-center text-sm text-muted-foreground">Carregando localizações...</div>
            ) : activeDrivers.length === 0 ? (
              <div className="py-8 text-center text-sm text-muted-foreground">Nenhum motorista ativo cadastrado.</div>
            ) : (
              <div className="space-y-2">
                {activeDrivers.map(driver => {
                  const hasLocation = driver.latitude != null && driver.longitude != null;
                  const status = statusLabel(driver);
                  return (
                    <div key={driver.driverId} className="rounded-xl border border-border/60 p-3">
                      <div className="flex items-start gap-3">
                        <span className={`mt-1.5 w-2.5 h-2.5 rounded-full shrink-0 ${hasLocation ? "bg-green-500" : "bg-slate-300"}`} />
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium truncate">{driver.driverName}</p>
                          <p className={`text-xs mt-0.5 ${status.className}`}>{status.text}</p>
                          {hasLocation && (
                            <p className="text-[11px] text-muted-foreground mt-1">
                              {Number(driver.latitude).toFixed(5)}, {Number(driver.longitude).toFixed(5)}
                            </p>
                          )}
                        </div>
                        {hasLocation && (
                          <a
                             href={googleMapsUrl(driver)}
                            target="_blank"
                            rel="noopener noreferrer"
                            title="Abrir no Google Maps"
                            className="text-primary hover:text-primary/80"
                          >
                            <ExternalLink className="w-4 h-4" />
                          </a>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}