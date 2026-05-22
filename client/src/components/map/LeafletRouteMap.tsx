import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import { MapContainer, TileLayer, Marker, Popup, Polyline } from 'react-leaflet';

L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
});

type RouteCompanyLite = {
  id: number;
  companyName: string;
  latitude: string | null;
  longitude: string | null;
  deliveryWindow: { startTime: string; endTime: string } | null;
  hasOrderForDate: boolean | null;
};

export default function LeafletRouteMap({ companies }: { companies: RouteCompanyLite[] }) {
  const withCoords = companies.filter(c => c.latitude && c.longitude);
  if (withCoords.length === 0) return null;
  const avgLat = withCoords.reduce((s, c) => s + Number(c.latitude), 0) / withCoords.length;
  const avgLon = withCoords.reduce((s, c) => s + Number(c.longitude), 0) / withCoords.length;
  const positions: [number, number][] = withCoords.map(c => [Number(c.latitude), Number(c.longitude)]);
  return (
    <MapContainer center={[avgLat, avgLon]} zoom={11} style={{ height: '380px', width: '100%' }} scrollWheelZoom={false}>
      <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' />
      {withCoords.map((c, i) => (
        <Marker key={c.id} position={[Number(c.latitude), Number(c.longitude)]}>
          <Popup>
            <div className="text-sm">
              <p className="font-bold">{i + 1}. {c.companyName}</p>
              {c.deliveryWindow && <p className="text-xs text-gray-600">🕐 {c.deliveryWindow.startTime} – {c.deliveryWindow.endTime}</p>}
              {c.hasOrderForDate && <p className="text-xs text-green-700 font-bold">✔ Pedido confirmado</p>}
            </div>
          </Popup>
        </Marker>
      ))}
      {positions.length > 1 && <Polyline positions={positions} color="#15803d" weight={2} dashArray="6 4" />}
    </MapContainer>
  );
}
