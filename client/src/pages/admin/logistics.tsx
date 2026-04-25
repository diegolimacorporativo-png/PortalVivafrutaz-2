import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { useAuth } from '@/hooks/use-auth';
import { queryClient, apiRequest } from '@/lib/queryClient';
import { normalizeList } from '@/lib/normalizeResponse';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Plus, Pencil, Trash2, Truck, User, Wrench, MapPin, Download, CheckCircle2, Clock, XCircle, FileText, Search, Phone, Mail, Building2, RefreshCw, Navigation, ArrowUp, ArrowDown, Printer, Sparkles, CalendarDays, AlertTriangle, Map } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import type { LogisticsDriver, LogisticsVehicle, LogisticsRoute, LogisticsMaintenance, CompanyQuotation } from '@shared/schema';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import { MapContainer, TileLayer, Marker, Popup, Polyline } from 'react-leaflet';

L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
});

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

const STATUS_COLOR: Record<string, string> = {
  SCHEDULED: 'bg-blue-100 text-blue-800',
  IN_PROGRESS: 'bg-yellow-100 text-yellow-800',
  COMPLETED: 'bg-green-100 text-green-800',
  CANCELLED: 'bg-red-100 text-red-800',
};
const STATUS_LABEL: Record<string, string> = { SCHEDULED: 'Agendado', IN_PROGRESS: 'Em andamento', COMPLETED: 'Concluído', CANCELLED: 'Cancelado' };
const MAINT_TYPE: Record<string, string> = { PREVENTIVE: 'Preventiva', CORRECTIVE: 'Corretiva', INSPECTION: 'Inspeção' };
const VEHICLE_TYPE: Record<string, string> = { VAN: 'Van', TRUCK: 'Caminhão', MOTORCYCLE: 'Moto', CAR: 'Carro' };

// ─── CSV/Excel export helper ─────────────────────────────────────────────────
function exportToCSV(rows: any[], filename: string) {
  if (!rows.length) return;
  const headers = Object.keys(rows[0]);
  const csv = [
    headers.join(';'),
    ...rows.map(r => headers.map(h => `"${r[h] ?? ''}"`).join(';'))
  ].join('\n');
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

// ─── Motoristas Tab ──────────────────────────────────────────────────────────
function DriversTab() {
  const { toast } = useToast();
  const [showForm, setShowForm] = useState(false);
  const [editItem, setEditItem] = useState<LogisticsDriver | undefined>();
  const [form, setForm] = useState({ name: '', cpf: '', phone: '', email: '', licenseNumber: '', notes: '' });

  const { data: drivers = [], isLoading } = useQuery<LogisticsDriver[]>({ queryKey: ['/api/logistics/drivers'] });

  const saveMut = useMutation({
    mutationFn: (data: any) => editItem
      ? apiRequest('PATCH', `/api/logistics/drivers/${editItem.id}`, data)
      : apiRequest('POST', '/api/logistics/drivers', data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['/api/logistics/drivers'] }); toast({ title: editItem ? 'Motorista atualizado!' : 'Motorista adicionado!' }); setShowForm(false); },
    onError: (e: any) => toast({ title: e?.message || 'Erro ao salvar', variant: 'destructive' }),
  });

  const delMut = useMutation({
    mutationFn: (id: number) => apiRequest('DELETE', `/api/logistics/drivers/${id}`),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['/api/logistics/drivers'] }); toast({ title: 'Motorista excluído' }); },
    onError: () => toast({ title: 'Erro ao excluir', variant: 'destructive' }),
  });

  const openCreate = () => { setEditItem(undefined); setForm({ name: '', cpf: '', phone: '', email: '', licenseNumber: '', notes: '' }); setShowForm(true); };
  const openEdit = (d: LogisticsDriver) => { setEditItem(d); setForm({ name: d.name, cpf: d.cpf || '', phone: d.phone || '', email: d.email || '', licenseNumber: d.licenseNumber || '', notes: d.notes || '' }); setShowForm(true); };

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <p className="text-sm text-muted-foreground">{drivers.length} motoristas cadastrados</p>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => exportToCSV(drivers.map(d => ({ Nome: d.name, CPF: d.cpf, Telefone: d.phone, Email: d.email, CNH: d.licenseNumber, Ativo: d.active ? 'Sim' : 'Não' })), 'motoristas.csv')}>
            <Download className="w-4 h-4 mr-1" /> Exportar
          </Button>
          <Button size="sm" onClick={openCreate} data-testid="button-new-driver">
            <Plus className="w-4 h-4 mr-1" /> Motorista
          </Button>
        </div>
      </div>
      {isLoading ? <div className="h-32 bg-muted rounded-xl animate-pulse" /> : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {drivers.map(d => (
            <Card key={d.id} data-testid={`card-driver-${d.id}`} className="premium-shadow">
              <CardContent className="p-4 flex items-start justify-between">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <User className="w-4 h-4 text-primary" />
                    <span className="font-semibold text-sm">{d.name}</span>
                    <span className={`text-xs px-2 py-0.5 rounded-full ${d.active ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>{d.active ? 'Ativo' : 'Inativo'}</span>
                  </div>
                  {d.phone && <p className="text-xs text-muted-foreground">📞 {d.phone}</p>}
                  {d.licenseNumber && <p className="text-xs text-muted-foreground">CNH: {d.licenseNumber}</p>}
                  {d.cpf && <p className="text-xs text-muted-foreground">CPF: {d.cpf}</p>}
                </div>
                <div className="flex gap-1">
                  <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => openEdit(d)}><Pencil className="w-3.5 h-3.5" /></Button>
                  <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-red-600" onClick={() => delMut.mutate(d.id)} disabled={delMut.isPending}><Trash2 className="w-3.5 h-3.5" /></Button>
                </div>
              </CardContent>
            </Card>
          ))}
          {!isLoading && drivers.length === 0 && <p className="col-span-3 text-center text-muted-foreground py-8">Nenhum motorista cadastrado</p>}
        </div>
      )}
      <Dialog open={showForm} onOpenChange={setShowForm}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editItem ? 'Editar Motorista' : 'Novo Motorista'}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label>Nome *</Label><Input data-testid="input-driver-name" value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>CPF</Label><Input value={form.cpf} onChange={e => setForm(p => ({ ...p, cpf: e.target.value }))} /></div>
              <div><Label>CNH</Label><Input value={form.licenseNumber} onChange={e => setForm(p => ({ ...p, licenseNumber: e.target.value }))} /></div>
              <div><Label>Telefone</Label><Input value={form.phone} onChange={e => setForm(p => ({ ...p, phone: e.target.value }))} /></div>
              <div><Label>Email</Label><Input type="email" value={form.email} onChange={e => setForm(p => ({ ...p, email: e.target.value }))} /></div>
            </div>
            <div><Label>Observações</Label><Textarea value={form.notes} onChange={e => setForm(p => ({ ...p, notes: e.target.value }))} rows={2} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowForm(false)}>Cancelar</Button>
            <Button data-testid="button-save-driver" onClick={() => { if (!form.name) { toast({ title: 'Nome obrigatório', variant: 'destructive' }); return; } saveMut.mutate(form); }} disabled={saveMut.isPending}>
              {saveMut.isPending ? 'Salvando...' : 'Salvar'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Veículos Tab ────────────────────────────────────────────────────────────
function VehiclesTab() {
  const { toast } = useToast();
  const [showForm, setShowForm] = useState(false);
  const [editItem, setEditItem] = useState<LogisticsVehicle | undefined>();
  const [form, setForm] = useState({ plate: '', model: '', brand: '', year: '', type: 'VAN', capacity: '', notes: '' });

  const { data: vehicles = [], isLoading } = useQuery<LogisticsVehicle[]>({ queryKey: ['/api/logistics/vehicles'] });

  const saveMut = useMutation({
    mutationFn: (data: any) => editItem
      ? apiRequest('PATCH', `/api/logistics/vehicles/${editItem.id}`, data)
      : apiRequest('POST', '/api/logistics/vehicles', data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['/api/logistics/vehicles'] }); toast({ title: editItem ? 'Veículo atualizado!' : 'Veículo adicionado!' }); setShowForm(false); },
    onError: (e: any) => toast({ title: e?.message || 'Erro ao salvar', variant: 'destructive' }),
  });

  const delMut = useMutation({
    mutationFn: (id: number) => apiRequest('DELETE', `/api/logistics/vehicles/${id}`),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['/api/logistics/vehicles'] }); toast({ title: 'Veículo excluído' }); },
    onError: () => toast({ title: 'Erro ao excluir', variant: 'destructive' }),
  });

  const openCreate = () => { setEditItem(undefined); setForm({ plate: '', model: '', brand: '', year: '', type: 'VAN', capacity: '', notes: '' }); setShowForm(true); };
  const openEdit = (v: LogisticsVehicle) => { setEditItem(v); setForm({ plate: v.plate, model: v.model, brand: v.brand, year: v.year?.toString() || '', type: v.type, capacity: v.capacity || '', notes: v.notes || '' }); setShowForm(true); };

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <p className="text-sm text-muted-foreground">{vehicles.length} veículos cadastrados</p>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => exportToCSV(vehicles.map(v => ({ Placa: v.plate, Modelo: v.model, Marca: v.brand, Ano: v.year, Tipo: VEHICLE_TYPE[v.type] || v.type, Capacidade: v.capacity, Ativo: v.active ? 'Sim' : 'Não' })), 'veiculos.csv')}>
            <Download className="w-4 h-4 mr-1" /> Exportar
          </Button>
          <Button size="sm" onClick={openCreate} data-testid="button-new-vehicle">
            <Plus className="w-4 h-4 mr-1" /> Veículo
          </Button>
        </div>
      </div>
      {isLoading ? <div className="h-32 bg-muted rounded-xl animate-pulse" /> : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {vehicles.map(v => (
            <Card key={v.id} data-testid={`card-vehicle-${v.id}`} className="premium-shadow">
              <CardContent className="p-4 flex items-start justify-between">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <Truck className="w-4 h-4 text-primary" />
                    <span className="font-semibold text-sm font-mono">{v.plate}</span>
                    <span className={`text-xs px-2 py-0.5 rounded-full ${v.active ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>{v.active ? 'Ativo' : 'Inativo'}</span>
                  </div>
                  <p className="text-sm">{v.brand} {v.model} {v.year && `(${v.year})`}</p>
                  <p className="text-xs text-muted-foreground">{VEHICLE_TYPE[v.type] || v.type}{v.capacity && ` — ${v.capacity}`}</p>
                </div>
                <div className="flex gap-1">
                  <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => openEdit(v)}><Pencil className="w-3.5 h-3.5" /></Button>
                  <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-red-600" onClick={() => delMut.mutate(v.id)} disabled={delMut.isPending}><Trash2 className="w-3.5 h-3.5" /></Button>
                </div>
              </CardContent>
            </Card>
          ))}
          {!isLoading && vehicles.length === 0 && <p className="col-span-3 text-center text-muted-foreground py-8">Nenhum veículo cadastrado</p>}
        </div>
      )}
      <Dialog open={showForm} onOpenChange={setShowForm}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editItem ? 'Editar Veículo' : 'Novo Veículo'}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Placa *</Label><Input data-testid="input-vehicle-plate" value={form.plate} onChange={e => setForm(p => ({ ...p, plate: e.target.value.toUpperCase() }))} placeholder="ABC-1234" /></div>
              <div>
                <Label>Tipo</Label>
                <Select value={form.type} onValueChange={v => setForm(p => ({ ...p, type: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(VEHICLE_TYPE).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div><Label>Marca *</Label><Input value={form.brand} onChange={e => setForm(p => ({ ...p, brand: e.target.value }))} /></div>
              <div><Label>Modelo *</Label><Input data-testid="input-vehicle-model" value={form.model} onChange={e => setForm(p => ({ ...p, model: e.target.value }))} /></div>
              <div><Label>Ano</Label><Input type="number" value={form.year} onChange={e => setForm(p => ({ ...p, year: e.target.value }))} /></div>
              <div><Label>Capacidade</Label><Input value={form.capacity} onChange={e => setForm(p => ({ ...p, capacity: e.target.value }))} placeholder="ex: 1000kg" /></div>
            </div>
            <div><Label>Observações</Label><Textarea value={form.notes} onChange={e => setForm(p => ({ ...p, notes: e.target.value }))} rows={2} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowForm(false)}>Cancelar</Button>
            <Button data-testid="button-save-vehicle" onClick={() => { if (!form.plate || !form.model || !form.brand) { toast({ title: 'Placa, modelo e marca obrigatórios', variant: 'destructive' }); return; } saveMut.mutate(form); }} disabled={saveMut.isPending}>
              {saveMut.isPending ? 'Salvando...' : 'Salvar'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Rotas Tab ───────────────────────────────────────────────────────────────
function RoutesTab() {
  const { toast } = useToast();
  const [showForm, setShowForm] = useState(false);
  const [editItem, setEditItem] = useState<LogisticsRoute | undefined>();
  const [filterDriver, setFilterDriver] = useState('ALL');
  const [filterDate, setFilterDate] = useState('');
  const [form, setForm] = useState({ name: '', driverId: '', driverName: '', vehicleId: '', vehiclePlate: '', deliveryDate: '', notes: '', companyNames: '', startTime: '', endTime: '' });
  const [companyPickerVal, setCompanyPickerVal] = useState('_none');

  const { data: routes = [], isLoading } = useQuery<LogisticsRoute[]>({ queryKey: ['/api/logistics/routes'] });
  const { data: drivers = [] } = useQuery<LogisticsDriver[]>({ queryKey: ['/api/logistics/drivers'] });
  const { data: vehicles = [] } = useQuery<LogisticsVehicle[]>({ queryKey: ['/api/logistics/vehicles'] });
  const { data: allCompanies = [] } = useQuery<any[]>({ queryKey: ['/api/companies'], select: normalizeList });

  const saveMut = useMutation({
    mutationFn: (data: any) => editItem
      ? apiRequest('PATCH', `/api/logistics/routes/${editItem.id}`, data)
      : apiRequest('POST', '/api/logistics/routes', data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['/api/logistics/routes'] }); toast({ title: editItem ? 'Rota atualizada!' : 'Rota criada!' }); setShowForm(false); },
    onError: (e: any) => toast({ title: e?.message || 'Erro', variant: 'destructive' }),
  });

  const statusMut = useMutation({
    mutationFn: ({ id, status }: { id: number; status: string }) => apiRequest('PATCH', `/api/logistics/routes/${id}`, { status }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['/api/logistics/routes'] }); toast({ title: 'Status atualizado!' }); },
  });

  const delMut = useMutation({
    mutationFn: (id: number) => apiRequest('DELETE', `/api/logistics/routes/${id}`),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['/api/logistics/routes'] }); toast({ title: 'Rota excluída' }); },
  });

  const openCreate = () => { setEditItem(undefined); setForm({ name: '', driverId: '', driverName: '', vehicleId: '', vehiclePlate: '', deliveryDate: '', notes: '', companyNames: '', startTime: '', endTime: '' }); setCompanyPickerVal('_none'); setShowForm(true); };
  const openEdit = (r: LogisticsRoute) => { setEditItem(r); setForm({ name: r.name, driverId: r.driverId?.toString() || '', driverName: r.driverName || '', vehicleId: r.vehicleId?.toString() || '', vehiclePlate: r.vehiclePlate || '', deliveryDate: r.deliveryDate || '', notes: r.notes || '', companyNames: r.companyNames || '', startTime: r.startTime || '', endTime: r.endTime || '' }); setCompanyPickerVal('_none'); setShowForm(true); };

  const filtered = routes.filter(r => {
    if (filterDriver !== 'ALL' && r.driverId?.toString() !== filterDriver) return false;
    if (filterDate && r.deliveryDate !== filterDate) return false;
    return true;
  });

  const exportRoutes = () => exportToCSV(filtered.map(r => ({ Rota: r.name, Motorista: r.driverName, Veículo: r.vehiclePlate, 'Data Entrega': r.deliveryDate, Status: STATUS_LABEL[r.status], Empresas: r.companyNames, Início: r.startTime, Fim: r.endTime })), 'rotas.csv');

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-3 justify-between items-end">
        <div className="flex gap-3 flex-wrap items-end">
          <div>
            <Label className="text-xs">Motorista</Label>
            <Select value={filterDriver} onValueChange={setFilterDriver}>
              <SelectTrigger className="w-40 h-8" data-testid="select-filter-driver">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">Todos</SelectItem>
                {drivers.map(d => <SelectItem key={d.id} value={d.id.toString()}>{d.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Data</Label>
            <Input type="date" className="h-8 w-40" value={filterDate} onChange={e => setFilterDate(e.target.value)} data-testid="input-filter-date" />
          </div>
          {(filterDriver !== 'ALL' || filterDate) && <Button variant="ghost" size="sm" className="h-8" onClick={() => { setFilterDriver('ALL'); setFilterDate(''); }}>Limpar</Button>}
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={exportRoutes}><Download className="w-4 h-4 mr-1" /> Exportar</Button>
          <Button size="sm" onClick={openCreate} data-testid="button-new-route"><Plus className="w-4 h-4 mr-1" /> Rota</Button>
        </div>
      </div>
      {isLoading ? <div className="h-32 bg-muted rounded-xl animate-pulse" /> : filtered.length === 0 ? (
        <div className="text-center py-10 text-muted-foreground"><MapPin className="w-10 h-10 mx-auto mb-2 opacity-30" /><p>Nenhuma rota encontrada</p></div>
      ) : (
        <div className="space-y-3">
          {filtered.map(r => (
            <Card key={r.id} data-testid={`card-route-${r.id}`} className="premium-shadow">
              <CardContent className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <MapPin className="w-4 h-4 text-primary" />
                      <span className="font-semibold text-sm">{r.name}</span>
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_COLOR[r.status]}`}>{STATUS_LABEL[r.status]}</span>
                    </div>
                    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                      {r.driverName && <span>👤 {r.driverName}</span>}
                      {r.vehiclePlate && <span>🚛 {r.vehiclePlate}</span>}
                      {r.deliveryDate && <span>📅 {new Date(r.deliveryDate).toLocaleDateString('pt-BR')}</span>}
                      {r.startTime && <span>⏰ {r.startTime}{r.endTime && ` – ${r.endTime}`}</span>}
                    </div>
                    {r.companyNames && <p className="text-xs text-muted-foreground">🏢 {r.companyNames}</p>}
                  </div>
                  <div className="flex flex-col gap-1">
                    <div className="flex gap-1">
                      <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-blue-600" title="Imprimir manifesto" data-testid={`button-print-route-${r.id}`} onClick={() => {
                        const companies = (r.companyNames || '').split(',').map((n: string, i: number) => `<div class="item"><span class="num">${i+1}</span><div class="name">${n.trim()}</div><div class="clear"></div></div>`).join('');
                        const w = window.open('', '_blank');
                        if (!w) return;
                        w.document.write(`<html><head><title>Manifesto – ${r.name}</title><style>body{font-family:Arial,sans-serif;padding:20px;color:#111}h1{color:#15803d;font-size:20px;border-bottom:2px solid #15803d;padding-bottom:8px}h2{font-size:13px;color:#666;margin-bottom:16px}.item{border:1px solid #ddd;border-radius:8px;padding:12px;margin-bottom:10px;page-break-inside:avoid}.num{font-size:22px;font-weight:bold;color:#15803d;float:left;margin-right:12px}.name{font-weight:bold;font-size:15px;padding-top:4px}.clear{clear:both}.footer{margin-top:30px;font-size:11px;color:#999;border-top:1px solid #eee;padding-top:8px}</style></head><body><h1>🚚 Manifesto – ${r.name}</h1><h2>Motorista: ${r.driverName || '—'} | Veículo: ${r.vehiclePlate || '—'} | Data: ${r.deliveryDate ? new Date(r.deliveryDate + 'T12:00:00').toLocaleDateString('pt-BR') : '—'} | ${r.startTime ? r.startTime + (r.endTime ? ' – ' + r.endTime : '') : ''}</h2>${companies}<div class="footer">VivaFrutaz – Gerado em ${new Date().toLocaleString('pt-BR')}</div></body></html>`);
                        w.document.close(); w.print();
                      }}><Printer className="w-3.5 h-3.5" /></Button>
                      <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => openEdit(r)}><Pencil className="w-3.5 h-3.5" /></Button>
                      <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-red-600" onClick={() => delMut.mutate(r.id)}><Trash2 className="w-3.5 h-3.5" /></Button>
                    </div>
                    {r.status !== 'COMPLETED' && r.status !== 'CANCELLED' && (
                      <Select value={r.status} onValueChange={s => statusMut.mutate({ id: r.id, status: s })}>
                        <SelectTrigger className="h-7 text-xs w-32"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {Object.entries(STATUS_LABEL).map(([k, v]) => <SelectItem key={k} value={k} className="text-xs">{v}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
      <Dialog open={showForm} onOpenChange={setShowForm}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>{editItem ? 'Editar Rota' : 'Nova Rota'}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label>Nome da rota *</Label><Input data-testid="input-route-name" value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} /></div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Motorista</Label>
                <Select value={form.driverId} onValueChange={v => { const d = drivers.find(d => d.id.toString() === v); setForm(p => ({ ...p, driverId: v, driverName: d?.name || '' })); }}>
                  <SelectTrigger><SelectValue placeholder="Selecionar" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Nenhum</SelectItem>
                    {drivers.map(d => <SelectItem key={d.id} value={d.id.toString()}>{d.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Veículo</Label>
                <Select value={form.vehicleId} onValueChange={v => { const vh = vehicles.find(vh => vh.id.toString() === v); setForm(p => ({ ...p, vehicleId: v, vehiclePlate: vh?.plate || '' })); }}>
                  <SelectTrigger><SelectValue placeholder="Selecionar" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Nenhum</SelectItem>
                    {vehicles.map(v => <SelectItem key={v.id} value={v.id.toString()}>{v.plate} — {v.model}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div><Label>Data Entrega</Label><Input type="date" value={form.deliveryDate} onChange={e => setForm(p => ({ ...p, deliveryDate: e.target.value }))} /></div>
              <div>
                <Label>Horário Início</Label>
                <Input type="time" value={form.startTime} onChange={e => setForm(p => ({ ...p, startTime: e.target.value }))} />
              </div>
            </div>
            <div>
              <Label>Empresas na rota</Label>
              <div className="space-y-2 mt-1">
                <Select value={companyPickerVal} onValueChange={v => {
                  if (v === '_none') return;
                  const co = allCompanies.find((c: any) => c.id.toString() === v);
                  if (!co) return;
                  const addr = [co.addressStreet, co.addressNumber, co.addressNeighborhood, co.addressCity].filter(Boolean).join(', ');
                  toast({ title: `${co.companyName} adicionada${addr ? ` — ${addr}` : ''}` });
                  setForm(p => ({ ...p, companyNames: p.companyNames ? p.companyNames + ', ' + co.companyName : co.companyName }));
                  setCompanyPickerVal('_none');
                }}>
                  <SelectTrigger data-testid="select-add-company-to-route">
                    <SelectValue placeholder="+ Adicionar empresa da lista..." />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="_none">Selecionar empresa...</SelectItem>
                    {(allCompanies as any[]).filter(c => c.active).map(c => {
                      const addr = [c.addressStreet, c.addressNumber, c.addressCity].filter(Boolean).join(', ');
                      return <SelectItem key={c.id} value={c.id.toString()}>{c.companyName}{addr ? ` — ${addr}` : ''}</SelectItem>;
                    })}
                  </SelectContent>
                </Select>
                <Input value={form.companyNames} onChange={e => setForm(p => ({ ...p, companyNames: e.target.value }))} placeholder="ex: Empresa A, Empresa B" data-testid="input-route-companies" />
              </div>
            </div>
            <div><Label>Observações</Label><Textarea value={form.notes} onChange={e => setForm(p => ({ ...p, notes: e.target.value }))} rows={2} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowForm(false)}>Cancelar</Button>
            <Button data-testid="button-save-route" onClick={() => { if (!form.name) { toast({ title: 'Nome obrigatório', variant: 'destructive' }); return; } saveMut.mutate({ ...form, driverId: form.driverId && form.driverId !== 'none' ? parseInt(form.driverId) : undefined, vehicleId: form.vehicleId && form.vehicleId !== 'none' ? parseInt(form.vehicleId) : undefined, deliveryDate: form.deliveryDate || undefined }); }} disabled={saveMut.isPending}>
              {saveMut.isPending ? 'Salvando...' : 'Salvar'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Manutenção Tab ──────────────────────────────────────────────────────────
function MaintenanceTab() {
  const { toast } = useToast();
  const [showForm, setShowForm] = useState(false);
  const [editItem, setEditItem] = useState<LogisticsMaintenance | undefined>();
  const [form, setForm] = useState({ vehicleId: '', vehiclePlate: '', type: 'PREVENTIVE', description: '', cost: '', scheduledDate: '', notes: '' });

  const { data: maintenances = [], isLoading } = useQuery<LogisticsMaintenance[]>({ queryKey: ['/api/logistics/maintenance'] });
  const { data: vehicles = [] } = useQuery<LogisticsVehicle[]>({ queryKey: ['/api/logistics/vehicles'] });

  const saveMut = useMutation({
    mutationFn: (data: any) => editItem
      ? apiRequest('PATCH', `/api/logistics/maintenance/${editItem.id}`, data)
      : apiRequest('POST', '/api/logistics/maintenance', data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['/api/logistics/maintenance'] }); toast({ title: editItem ? 'Manutenção atualizada!' : 'Manutenção criada!' }); setShowForm(false); },
    onError: (e: any) => toast({ title: e?.message || 'Erro', variant: 'destructive' }),
  });

  const statusMut = useMutation({
    mutationFn: ({ id, status }: { id: number; status: string }) => apiRequest('PATCH', `/api/logistics/maintenance/${id}`, { status }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['/api/logistics/maintenance'] }); toast({ title: 'Status atualizado!' }); },
  });

  const delMut = useMutation({
    mutationFn: (id: number) => apiRequest('DELETE', `/api/logistics/maintenance/${id}`),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['/api/logistics/maintenance'] }); toast({ title: 'Manutenção excluída' }); },
  });

  const openCreate = () => { setEditItem(undefined); setForm({ vehicleId: '', vehiclePlate: '', type: 'PREVENTIVE', description: '', cost: '', scheduledDate: '', notes: '' }); setShowForm(true); };
  const openEdit = (m: LogisticsMaintenance) => { setEditItem(m); setForm({ vehicleId: m.vehicleId?.toString() || '', vehiclePlate: m.vehiclePlate || '', type: m.type, description: m.description, cost: m.cost?.toString() || '', scheduledDate: m.scheduledDate || '', notes: m.notes || '' }); setShowForm(true); };

  const exportMaint = () => exportToCSV(maintenances.map(m => ({ Veículo: m.vehiclePlate, Tipo: MAINT_TYPE[m.type] || m.type, Descrição: m.description, Custo: m.cost, 'Data Agendada': m.scheduledDate, Status: STATUS_LABEL[m.status] })), 'manutencao.csv');

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <p className="text-sm text-muted-foreground">{maintenances.length} registros de manutenção</p>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={exportMaint}><Download className="w-4 h-4 mr-1" /> Exportar</Button>
          <Button size="sm" onClick={openCreate} data-testid="button-new-maintenance"><Plus className="w-4 h-4 mr-1" /> Manutenção</Button>
        </div>
      </div>
      {isLoading ? <div className="h-32 bg-muted rounded-xl animate-pulse" /> : maintenances.length === 0 ? (
        <div className="text-center py-10 text-muted-foreground"><Wrench className="w-10 h-10 mx-auto mb-2 opacity-30" /><p>Nenhuma manutenção registrada</p></div>
      ) : (
        <div className="space-y-3">
          {maintenances.map(m => (
            <Card key={m.id} data-testid={`card-maintenance-${m.id}`} className="premium-shadow">
              <CardContent className="p-4 flex items-start justify-between gap-3">
                <div className="flex-1 space-y-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Wrench className="w-4 h-4 text-primary" />
                    <span className="font-semibold text-sm">{MAINT_TYPE[m.type] || m.type}</span>
                    {m.vehiclePlate && <span className="text-xs font-mono bg-muted px-2 py-0.5 rounded">{m.vehiclePlate}</span>}
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_COLOR[m.status]}`}>{STATUS_LABEL[m.status]}</span>
                  </div>
                  <p className="text-sm text-muted-foreground">{m.description}</p>
                  <div className="flex gap-4 text-xs text-muted-foreground">
                    {m.scheduledDate && <span>📅 {new Date(m.scheduledDate).toLocaleDateString('pt-BR')}</span>}
                    {m.cost && <span>💰 R$ {parseFloat(m.cost).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</span>}
                  </div>
                </div>
                <div className="flex flex-col gap-1 items-end">
                  <div className="flex gap-1">
                    <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => openEdit(m)}><Pencil className="w-3.5 h-3.5" /></Button>
                    <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-red-600" onClick={() => delMut.mutate(m.id)}><Trash2 className="w-3.5 h-3.5" /></Button>
                  </div>
                  {m.status !== 'COMPLETED' && (
                    <Select value={m.status} onValueChange={s => statusMut.mutate({ id: m.id, status: s })}>
                      <SelectTrigger className="h-7 text-xs w-32"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="SCHEDULED" className="text-xs">Agendado</SelectItem>
                        <SelectItem value="IN_PROGRESS" className="text-xs">Em andamento</SelectItem>
                        <SelectItem value="COMPLETED" className="text-xs">Concluído</SelectItem>
                      </SelectContent>
                    </Select>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
      <Dialog open={showForm} onOpenChange={setShowForm}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editItem ? 'Editar Manutenção' : 'Nova Manutenção'}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Veículo</Label>
                <Select value={form.vehicleId} onValueChange={v => { const vh = vehicles.find(x => x.id.toString() === v); setForm(p => ({ ...p, vehicleId: v, vehiclePlate: vh?.plate || '' })); }}>
                  <SelectTrigger><SelectValue placeholder="Selecionar" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Nenhum</SelectItem>
                    {vehicles.map(v => <SelectItem key={v.id} value={v.id.toString()}>{v.plate}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Tipo *</Label>
                <Select value={form.type} onValueChange={v => setForm(p => ({ ...p, type: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(MAINT_TYPE).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div><Label>Data Agendada</Label><Input type="date" value={form.scheduledDate} onChange={e => setForm(p => ({ ...p, scheduledDate: e.target.value }))} /></div>
              <div><Label>Custo (R$)</Label><Input type="number" step="0.01" value={form.cost} onChange={e => setForm(p => ({ ...p, cost: e.target.value }))} placeholder="0,00" /></div>
            </div>
            <div><Label>Descrição *</Label><Textarea data-testid="input-maintenance-desc" value={form.description} onChange={e => setForm(p => ({ ...p, description: e.target.value }))} rows={2} /></div>
            <div><Label>Observações</Label><Textarea value={form.notes} onChange={e => setForm(p => ({ ...p, notes: e.target.value }))} rows={2} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowForm(false)}>Cancelar</Button>
            <Button data-testid="button-save-maintenance" onClick={() => { if (!form.type || !form.description) { toast({ title: 'Tipo e descrição obrigatórios', variant: 'destructive' }); return; } saveMut.mutate({ ...form, vehicleId: form.vehicleId && form.vehicleId !== 'none' ? parseInt(form.vehicleId) : undefined, cost: form.cost || undefined, scheduledDate: form.scheduledDate || undefined }); }} disabled={saveMut.isPending}>
              {saveMut.isPending ? 'Salvando...' : 'Salvar'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Cotações Tab ────────────────────────────────────────────────────────────
const QUOT_STATUS_COLOR: Record<string, string> = {
  PENDING: 'bg-gray-100 text-gray-700',
  IN_ANALYSIS: 'bg-blue-100 text-blue-800',
  APPROVED: 'bg-green-100 text-green-800',
  REJECTED: 'bg-red-100 text-red-800',
  HORARIOS_DISPONIVEIS: 'bg-purple-100 text-purple-800',
};
const QUOT_STATUS_LABEL: Record<string, string> = {
  PENDING: 'Pendente',
  IN_ANALYSIS: 'Em análise',
  APPROVED: 'Aprovado',
  REJECTED: 'Rejeitado',
  HORARIOS_DISPONIVEIS: 'Horários Disponíveis',
};

type DeliveryWindow = { startTime: string; endTime: string };

function parseWindows(json: string | null | undefined): DeliveryWindow[] {
  try { return json ? JSON.parse(json) : []; } catch { return []; }
}

function CotacoesTab() {
  const { toast } = useToast();
  const { user } = useAuth();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [showForm, setShowForm] = useState(false);
  const [editItem, setEditItem] = useState<CompanyQuotation | null>(null);
  const [updateModal, setUpdateModal] = useState<CompanyQuotation | null>(null);
  const [updateStatus, setUpdateStatus] = useState('');
  const [updateNote, setUpdateNote] = useState('');
  const [deliveryWindows, setDeliveryWindows] = useState<DeliveryWindow[]>([]);
  const [form, setForm] = useState({ companyName: '', contactName: '', contactPhone: '', email: '', cnpj: '', city: '', state: '', estimatedVolume: '', productInterest: '', logisticsNote: '' });

  const { data: quotations = [], isLoading } = useQuery<CompanyQuotation[]>({ queryKey: ['/api/quotations'] });

  const canDelete = ['ADMIN', 'DIRECTOR', 'DEVELOPER'].includes(user?.role || '');
  const canEditWindows = ['ADMIN', 'DIRECTOR', 'DEVELOPER', 'LOGISTICS'].includes(user?.role || '');

  const resetForm = () => setForm({ companyName: '', contactName: '', contactPhone: '', email: '', cnpj: '', city: '', state: '', estimatedVolume: '', productInterest: '', logisticsNote: '' });

  const createMut = useMutation({
    mutationFn: (data: any) => apiRequest('POST', '/api/quotations', data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['/api/quotations'] }); toast({ title: 'Cotação registrada!' }); setShowForm(false); resetForm(); setDeliveryWindows([]); },
    onError: () => toast({ title: 'Erro ao registrar cotação', variant: 'destructive' }),
  });

  const updateMut = useMutation({
    mutationFn: ({ id, data }: { id: number; data: any }) => apiRequest('PATCH', `/api/quotations/${id}`, data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['/api/quotations'] }); toast({ title: 'Cotação atualizada!' }); setUpdateModal(null); setEditItem(null); setDeliveryWindows([]); },
    onError: () => toast({ title: 'Erro ao atualizar', variant: 'destructive' }),
  });

  const deleteMut = useMutation({
    mutationFn: (id: number) => apiRequest('DELETE', `/api/quotations/${id}`),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['/api/quotations'] }); toast({ title: 'Cotação excluída' }); },
    onError: () => toast({ title: 'Erro ao excluir', variant: 'destructive' }),
  });

  const openUpdate = (q: CompanyQuotation) => {
    setUpdateModal(q);
    setUpdateStatus(q.status);
    setUpdateNote(q.logisticsNote || '');
    setDeliveryWindows(parseWindows(q.deliveryWindowsJson));
  };

  const openEdit = (q: CompanyQuotation) => {
    setEditItem(q);
    setForm({ companyName: q.companyName, contactName: q.contactName, contactPhone: q.contactPhone || '', email: q.email || '', cnpj: q.cnpj || '', city: q.city || '', state: q.state || '', estimatedVolume: q.estimatedVolume || '', productInterest: q.productInterest || '', logisticsNote: q.logisticsNote || '' });
    setDeliveryWindows(parseWindows(q.deliveryWindowsJson));
    setShowForm(true);
  };

  const addWindow = () => setDeliveryWindows(w => [...w, { startTime: '08:00', endTime: '08:30' }]);
  const removeWindow = (i: number) => setDeliveryWindows(w => w.filter((_, idx) => idx !== i));
  const updateWindow = (i: number, field: 'startTime' | 'endTime', value: string) =>
    setDeliveryWindows(w => w.map((win, idx) => idx === i ? { ...win, [field]: value } : win));

  const filtered = quotations.filter(q => {
    const matchSearch = !search || q.companyName.toLowerCase().includes(search.toLowerCase()) || q.contactName.toLowerCase().includes(search.toLowerCase());
    const matchStatus = statusFilter === 'ALL' || q.status === statusFilter;
    return matchSearch && matchStatus;
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center justify-between">
        <div className="flex gap-2 flex-1 flex-wrap">
          <div className="relative flex-1 min-w-48">
            <Search className="absolute left-2 top-2.5 w-4 h-4 text-muted-foreground" />
            <Input placeholder="Buscar empresa ou contato..." className="pl-8" value={search} onChange={e => setSearch(e.target.value)} data-testid="input-search-quotation" />
          </div>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-44" data-testid="select-status-filter"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">Todos</SelectItem>
              <SelectItem value="PENDING">Pendente</SelectItem>
              <SelectItem value="IN_ANALYSIS">Em análise</SelectItem>
              <SelectItem value="HORARIOS_DISPONIVEIS">Horários Disponíveis</SelectItem>
              <SelectItem value="APPROVED">Aprovado</SelectItem>
              <SelectItem value="REJECTED">Rejeitado</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => exportToCSV(filtered.map(q => ({ Empresa: q.companyName, Contato: q.contactName, Telefone: q.contactPhone || '', Email: q.email || '', Cidade: q.city || '', Estado: q.state || '', Produtos: q.productInterest || '', Volume: q.estimatedVolume || '', Status: QUOT_STATUS_LABEL[q.status] || q.status, 'Nota Logística': q.logisticsNote || '', 'Janelas de Entrega': parseWindows(q.deliveryWindowsJson).map(w => `${w.startTime}–${w.endTime}`).join(' | ') })), 'cotacoes.csv')} data-testid="button-export-quotations">
            <Download className="w-4 h-4 mr-1" />Exportar
          </Button>
          <Button size="sm" onClick={() => { setShowForm(true); setEditItem(null); resetForm(); setDeliveryWindows([]); }} data-testid="button-new-quotation">
            <Plus className="w-4 h-4 mr-1" />Nova Cotação
          </Button>
        </div>
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Carregando...</p>
      ) : filtered.length === 0 ? (
        <Card className="premium-shadow"><CardContent className="p-8 text-center text-muted-foreground">Nenhuma cotação encontrada.</CardContent></Card>
      ) : (
        <div className="space-y-3">
          {filtered.map(q => {
            const windows = parseWindows(q.deliveryWindowsJson);
            return (
              <Card key={q.id} className="premium-shadow" data-testid={`card-quotation-${q.id}`}>
                <CardContent className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-sm" data-testid={`text-quotation-company-${q.id}`}>{q.companyName}</span>
                        <Badge className={`text-xs ${QUOT_STATUS_COLOR[q.status] || 'bg-gray-100 text-gray-700'}`} data-testid={`badge-quotation-status-${q.id}`}>{QUOT_STATUS_LABEL[q.status] || q.status}</Badge>
                      </div>
                      <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                        <span className="flex items-center gap-1"><User className="w-3 h-3" />{q.contactName}</span>
                        {q.contactPhone && <span className="flex items-center gap-1"><Phone className="w-3 h-3" />{q.contactPhone}</span>}
                        {q.email && <span className="flex items-center gap-1"><Mail className="w-3 h-3" />{q.email}</span>}
                        {(q.city || q.state) && <span className="flex items-center gap-1"><MapPin className="w-3 h-3" />{[q.city, q.state].filter(Boolean).join(' – ')}</span>}
                      </div>
                      {q.productInterest && <p className="mt-1 text-xs text-muted-foreground"><span className="font-medium">Produtos:</span> {q.productInterest}</p>}
                      {q.estimatedVolume && <p className="text-xs text-muted-foreground"><span className="font-medium">Volume estimado:</span> {q.estimatedVolume}</p>}
                      {q.logisticsNote && <p className="text-xs mt-1 p-2 bg-muted rounded"><span className="font-medium">Nota logística:</span> {q.logisticsNote}</p>}
                      {windows.length > 0 && (
                        <div className="mt-2 p-2 bg-purple-50 dark:bg-purple-950/30 rounded border border-purple-200 dark:border-purple-800">
                          <p className="text-xs font-medium text-purple-800 dark:text-purple-300 mb-1 flex items-center gap-1">
                            <Clock className="w-3 h-3" /> Janelas de Entrega
                          </p>
                          <div className="flex flex-wrap gap-1">
                            {windows.map((w, i) => (
                              <span key={i} className="text-xs bg-purple-100 dark:bg-purple-900 text-purple-800 dark:text-purple-200 px-2 py-0.5 rounded-full" data-testid={`window-badge-${q.id}-${i}`}>
                                {w.startTime} – {w.endTime}
                              </span>
                            ))}
                          </div>
                          {q.deliveryWindowsRespondedBy && (
                            <p className="text-xs text-muted-foreground mt-1">
                              Definido por {q.deliveryWindowsRespondedBy}
                              {q.deliveryWindowsRespondedAt ? ` em ${new Date(q.deliveryWindowsRespondedAt).toLocaleDateString('pt-BR')}` : ''}
                            </p>
                          )}
                        </div>
                      )}
                      <p className="text-xs text-muted-foreground mt-1">Registrado em {new Date(q.createdAt).toLocaleDateString('pt-BR')}</p>
                    </div>
                    <div className="flex gap-1 shrink-0">
                      <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => openUpdate(q)} data-testid={`button-update-quotation-${q.id}`} title="Atualizar status"><RefreshCw className="w-3.5 h-3.5" /></Button>
                      <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => openEdit(q)} data-testid={`button-edit-quotation-${q.id}`} title="Editar"><Pencil className="w-3.5 h-3.5" /></Button>
                      {canDelete && <Button size="icon" variant="ghost" className="h-7 w-7 text-red-600 hover:text-red-700" onClick={() => { if (confirm('Excluir esta cotação?')) deleteMut.mutate(q.id); }} data-testid={`button-delete-quotation-${q.id}`} title="Excluir"><Trash2 className="w-3.5 h-3.5" /></Button>}
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Create / Edit Form Dialog */}
      <Dialog open={showForm} onOpenChange={v => { setShowForm(v); if (!v) { setEditItem(null); setDeliveryWindows([]); } }}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>{editItem ? 'Editar Cotação' : 'Nova Cotação'}</DialogTitle></DialogHeader>
          <div className="grid gap-3 py-2 max-h-[65vh] overflow-y-auto pr-1">
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Empresa *</Label><Input value={form.companyName} onChange={e => setForm(f => ({ ...f, companyName: e.target.value }))} data-testid="input-quotation-company" /></div>
              <div><Label>Contato *</Label><Input value={form.contactName} onChange={e => setForm(f => ({ ...f, contactName: e.target.value }))} data-testid="input-quotation-contact" /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Telefone</Label><Input value={form.contactPhone} onChange={e => setForm(f => ({ ...f, contactPhone: e.target.value }))} data-testid="input-quotation-phone" /></div>
              <div><Label>E-mail</Label><Input value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} data-testid="input-quotation-email" /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>CNPJ</Label><Input value={form.cnpj} onChange={e => setForm(f => ({ ...f, cnpj: e.target.value }))} data-testid="input-quotation-cnpj" /></div>
              <div><Label>Cidade</Label><Input value={form.city} onChange={e => setForm(f => ({ ...f, city: e.target.value }))} data-testid="input-quotation-city" /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Estado</Label><Input value={form.state} onChange={e => setForm(f => ({ ...f, state: e.target.value }))} data-testid="input-quotation-state" /></div>
              <div><Label>Volume Estimado</Label><Input value={form.estimatedVolume} onChange={e => setForm(f => ({ ...f, estimatedVolume: e.target.value }))} placeholder="ex: 200kg/semana" data-testid="input-quotation-volume" /></div>
            </div>
            <div><Label>Produtos de Interesse</Label><Textarea rows={2} value={form.productInterest} onChange={e => setForm(f => ({ ...f, productInterest: e.target.value }))} data-testid="input-quotation-products" /></div>
            <div><Label>Nota de Logística</Label><Textarea rows={2} value={form.logisticsNote} onChange={e => setForm(f => ({ ...f, logisticsNote: e.target.value }))} placeholder="Informações de entrega, horários, observações..." data-testid="input-quotation-note" /></div>

            {/* Delivery Windows Section */}
            {(canEditWindows || deliveryWindows.length > 0) && (
              <div className="border-t pt-3 space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="text-sm font-semibold flex items-center gap-1"><Clock className="w-4 h-4 text-purple-600" />Janelas de Entrega da Logística</Label>
                  {canEditWindows && (
                    <Button type="button" size="sm" variant="outline" className="h-7 text-xs" onClick={addWindow} data-testid="button-add-window">
                      <Plus className="w-3 h-3 mr-1" />Adicionar janela
                    </Button>
                  )}
                </div>
                {deliveryWindows.length === 0 ? (
                  <p className="text-xs text-muted-foreground">Nenhuma janela definida ainda.</p>
                ) : (
                  <div className="space-y-2">
                    {deliveryWindows.map((w, i) => (
                      <div key={i} className="flex items-center gap-2 p-2 bg-purple-50 dark:bg-purple-950/30 rounded border border-purple-200 dark:border-purple-800" data-testid={`window-row-${i}`}>
                        <span className="text-xs font-medium text-purple-700 dark:text-purple-300 w-16 shrink-0">Janela {i + 1}</span>
                        {canEditWindows ? (
                          <>
                            <Input type="time" value={w.startTime} onChange={e => updateWindow(i, 'startTime', e.target.value)} className="h-7 text-xs flex-1" data-testid={`input-window-start-${i}`} />
                            <span className="text-xs text-muted-foreground">até</span>
                            <Input type="time" value={w.endTime} onChange={e => updateWindow(i, 'endTime', e.target.value)} className="h-7 text-xs flex-1" data-testid={`input-window-end-${i}`} />
                            <Button type="button" size="icon" variant="ghost" className="h-6 w-6 text-red-500 hover:text-red-700 shrink-0" onClick={() => removeWindow(i)} data-testid={`button-remove-window-${i}`}><XCircle className="w-3.5 h-3.5" /></Button>
                          </>
                        ) : (
                          <span className="text-xs text-purple-800 dark:text-purple-200">{w.startTime} – {w.endTime}</span>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setShowForm(false); setEditItem(null); setDeliveryWindows([]); }}>Cancelar</Button>
            <Button data-testid="button-save-quotation" disabled={createMut.isPending || updateMut.isPending} onClick={() => {
              if (!form.companyName.trim() || !form.contactName.trim()) { toast({ title: 'Empresa e contato são obrigatórios', variant: 'destructive' }); return; }
              const windowsJson = deliveryWindows.length > 0 ? JSON.stringify(deliveryWindows) : undefined;
              const windowsPayload = canEditWindows && deliveryWindows.length > 0 ? {
                deliveryWindowsJson: windowsJson,
                deliveryWindowsRespondedBy: user?.name || '',
                deliveryWindowsRespondedAt: new Date().toISOString(),
                status: 'HORARIOS_DISPONIVEIS',
              } : {};
              if (editItem) {
                updateMut.mutate({ id: editItem.id, data: { ...form, ...windowsPayload } });
              } else {
                createMut.mutate({ ...form, ...windowsPayload });
              }
            }}>
              {(createMut.isPending || updateMut.isPending) ? 'Salvando...' : 'Salvar'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Update Status Dialog */}
      <Dialog open={!!updateModal} onOpenChange={v => { if (!v) { setUpdateModal(null); setDeliveryWindows([]); } }}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Atualizar Status — Cotação</DialogTitle></DialogHeader>
          <div className="space-y-3 py-2 max-h-[70vh] overflow-y-auto">
            <div>
              <Label>Empresa</Label>
              <p className="text-sm font-medium">{updateModal?.companyName}</p>
            </div>
            <div>
              <Label>Status</Label>
              <Select value={updateStatus} onValueChange={setUpdateStatus}>
                <SelectTrigger data-testid="select-update-status"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="PENDING">Pendente</SelectItem>
                  <SelectItem value="IN_ANALYSIS">Em análise</SelectItem>
                  <SelectItem value="HORARIOS_DISPONIVEIS">Horários Disponíveis</SelectItem>
                  <SelectItem value="APPROVED">Aprovado</SelectItem>
                  <SelectItem value="REJECTED">Rejeitado</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Nota de Logística</Label>
              <Textarea rows={2} value={updateNote} onChange={e => setUpdateNote(e.target.value)} placeholder="Registre retorno de fornecedor, observações..." data-testid="input-update-note" />
            </div>

            {/* Delivery Windows in Update Dialog */}
            <div className="border-t pt-3 space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-sm font-semibold flex items-center gap-1"><Clock className="w-4 h-4 text-purple-600" />Janelas de Entrega</Label>
                {canEditWindows && (
                  <Button type="button" size="sm" variant="outline" className="h-7 text-xs" onClick={addWindow} data-testid="button-add-window-update">
                    <Plus className="w-3 h-3 mr-1" />Adicionar
                  </Button>
                )}
              </div>
              {deliveryWindows.length === 0 ? (
                <p className="text-xs text-muted-foreground">Nenhuma janela definida.</p>
              ) : (
                <div className="space-y-2">
                  {deliveryWindows.map((w, i) => (
                    <div key={i} className="flex items-center gap-2 p-2 bg-purple-50 dark:bg-purple-950/30 rounded border border-purple-200 dark:border-purple-800" data-testid={`update-window-row-${i}`}>
                      <span className="text-xs font-medium text-purple-700 dark:text-purple-300 w-16 shrink-0">Janela {i + 1}</span>
                      {canEditWindows ? (
                        <>
                          <Input type="time" value={w.startTime} onChange={e => updateWindow(i, 'startTime', e.target.value)} className="h-7 text-xs flex-1" data-testid={`update-window-start-${i}`} />
                          <span className="text-xs text-muted-foreground">até</span>
                          <Input type="time" value={w.endTime} onChange={e => updateWindow(i, 'endTime', e.target.value)} className="h-7 text-xs flex-1" data-testid={`update-window-end-${i}`} />
                          <Button type="button" size="icon" variant="ghost" className="h-6 w-6 text-red-500 hover:text-red-700 shrink-0" onClick={() => removeWindow(i)} data-testid={`button-remove-update-window-${i}`}><XCircle className="w-3.5 h-3.5" /></Button>
                        </>
                      ) : (
                        <span className="text-xs text-purple-800 dark:text-purple-200">{w.startTime} – {w.endTime}</span>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setUpdateModal(null); setDeliveryWindows([]); }}>Cancelar</Button>
            <Button data-testid="button-confirm-update" disabled={updateMut.isPending} onClick={() => {
              if (!updateModal) return;
              const windowsPayload = canEditWindows && deliveryWindows.length > 0 ? {
                deliveryWindowsJson: JSON.stringify(deliveryWindows),
                deliveryWindowsRespondedBy: user?.name || '',
                deliveryWindowsRespondedAt: new Date().toISOString(),
              } : {};
              const autoStatus = canEditWindows && deliveryWindows.length > 0 && updateStatus === (updateModal.status) && updateStatus !== 'HORARIOS_DISPONIVEIS'
                ? 'HORARIOS_DISPONIVEIS'
                : updateStatus;
              updateMut.mutate({ id: updateModal.id, data: { status: autoStatus, logisticsNote: updateNote, ...windowsPayload } });
            }}>
              {updateMut.isPending ? 'Salvando...' : 'Atualizar'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Leaflet Map Component ────────────────────────────────────────────────────
type RouteCompanyLite = { id: number; companyName: string; latitude: string | null; longitude: string | null; deliveryWindow: { startTime: string; endTime: string } | null; hasOrderForDate: boolean | null };

function LeafletMap({ companies }: { companies: RouteCompanyLite[] }) {
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

// ─── Assistente de Rota ──────────────────────────────────────────────────────
const WEEK_DAYS_ASSIST = ['Segunda-feira', 'Terça-feira', 'Quarta-feira', 'Quinta-feira', 'Sexta-feira', 'Sábado'];
type RouteCompany = {
  id: number; companyName: string; addressStreet: string; addressNumber: string;
  addressNeighborhood: string; addressCity: string; addressZip: string;
  latitude: string | null; longitude: string | null; clientType: string;
  deliveryWindow: { startTime: string; endTime: string } | null;
  hasOrderForDate: boolean | null;
};

function RouteAssistantTab() {
  const { toast } = useToast();
  const [selectedDay, setSelectedDay] = useState('');
  const [selectedDate, setSelectedDate] = useState('');
  const [companies, setCompanies] = useState<RouteCompany[]>([]);
  const [loading, setLoading] = useState(false);
  const [showCreateRoute, setShowCreateRoute] = useState(false);
  const [routeName, setRouteName] = useState('');
  const [showMap, setShowMap] = useState(false);
  const { data: drivers = [] } = useQuery<LogisticsDriver[]>({ queryKey: ['/api/logistics/drivers'] });
  const { data: vehicles = [] } = useQuery<LogisticsVehicle[]>({ queryKey: ['/api/logistics/vehicles'] });
  const [routeDriver, setRouteDriver] = useState('');
  const [routeVehicle, setRouteVehicle] = useState('');

  const routeConflicts = (() => {
    const conflicts: { a: RouteCompany; b: RouteCompany; distKm: number }[] = [];
    for (let i = 0; i < companies.length; i++) {
      for (let j = i + 1; j < companies.length; j++) {
        const a = companies[i]; const b = companies[j];
        if (!a.deliveryWindow || !b.deliveryWindow) continue;
        if (a.deliveryWindow.startTime !== b.deliveryWindow.startTime) continue;
        if (!a.latitude || !a.longitude || !b.latitude || !b.longitude) continue;
        const dist = haversineKm(Number(a.latitude), Number(a.longitude), Number(b.latitude), Number(b.longitude));
        if (dist > 8) conflicts.push({ a, b, distKm: dist });
      }
    }
    return conflicts;
  })();

  const timeEstimate = (() => {
    if (companies.length === 0) return null;
    const UNLOAD_MIN = 15;
    const AVG_SPEED_KMH = 30;
    let totalMin = 0;
    let totalKm = 0;
    for (let i = 0; i < companies.length - 1; i++) {
      const a = companies[i]; const b = companies[i + 1];
      if (a.latitude && a.longitude && b.latitude && b.longitude) {
        const dist = haversineKm(Number(a.latitude), Number(a.longitude), Number(b.latitude), Number(b.longitude));
        totalKm += dist;
        totalMin += (dist / AVG_SPEED_KMH) * 60;
      } else {
        totalMin += 15;
      }
      totalMin += UNLOAD_MIN;
    }
    totalMin += UNLOAD_MIN;
    const hours = Math.floor(totalMin / 60);
    const mins = Math.round(totalMin % 60);
    return { totalMin: Math.round(totalMin), totalKm: Math.round(totalKm * 10) / 10, hours, mins };
  })();

  const fetchAssistant = async () => {
    if (!selectedDay) { toast({ title: 'Selecione um dia', variant: 'destructive' }); return; }
    setLoading(true);
    try {
      const params = new URLSearchParams({ day: selectedDay });
      if (selectedDate) params.set('date', selectedDate);
      const res = await fetch(`/api/logistics/route-assistant?${params}`, { credentials: 'include' });
      const data = await res.json();
      setCompanies(Array.isArray(data) ? data : []);
    } catch { toast({ title: 'Erro ao buscar dados', variant: 'destructive' }); }
    finally { setLoading(false); }
  };

  const moveUp = (idx: number) => {
    if (idx === 0) return;
    const arr = [...companies];
    [arr[idx - 1], arr[idx]] = [arr[idx], arr[idx - 1]];
    setCompanies(arr);
  };
  const moveDown = (idx: number) => {
    if (idx === companies.length - 1) return;
    const arr = [...companies];
    [arr[idx], arr[idx + 1]] = [arr[idx + 1], arr[idx]];
    setCompanies(arr);
  };

  const printManifesto = () => {
    const content = `
      <html><head><title>Manifesto de Rota – ${selectedDay}</title>
      <style>
        body { font-family: Arial, sans-serif; padding: 20px; color: #111; }
        h1 { color: #15803d; font-size: 20px; border-bottom: 2px solid #15803d; padding-bottom: 8px; }
        h2 { font-size: 13px; color: #666; margin-bottom: 16px; }
        .item { border: 1px solid #ddd; border-radius: 8px; padding: 12px; margin-bottom: 10px; page-break-inside: avoid; }
        .num { font-size: 22px; font-weight: bold; color: #15803d; float: left; margin-right: 12px; }
        .name { font-weight: bold; font-size: 15px; }
        .sub { font-size: 12px; color: #555; margin-top: 2px; }
        .window { display: inline-block; background: #f0fdf4; border: 1px solid #86efac; color: #15803d; padding: 2px 8px; border-radius: 12px; font-size: 12px; font-weight: bold; float: right; }
        .clear { clear: both; }
        .footer { margin-top: 30px; font-size: 11px; color: #999; border-top: 1px solid #eee; padding-top: 8px; }
      </style></head><body>
      <h1>🚚 Manifesto de Rota – ${selectedDay}</h1>
      <h2>${selectedDate ? `Data de entrega: ${new Date(selectedDate + 'T12:00:00').toLocaleDateString('pt-BR')}` : 'Rota sugerida pelo sistema'} | ${companies.length} empresa(s)</h2>
      ${companies.map((c, i) => `
        <div class="item">
          <span class="num">${i + 1}</span>
          ${c.deliveryWindow ? `<span class="window">🕐 ${c.deliveryWindow.startTime} – ${c.deliveryWindow.endTime}</span>` : ''}
          <div class="name">${c.companyName}</div>
          <div class="sub">${[c.addressStreet, c.addressNumber, c.addressNeighborhood, c.addressCity].filter(Boolean).join(', ')}</div>
          ${c.hasOrderForDate ? '<div class="sub" style="color:#15803d">✔ Pedido confirmado para esta data</div>' : ''}
          <div class="clear"></div>
        </div>`).join('')}
      <div class="footer">VivaFrutaz – Gerado em ${new Date().toLocaleString('pt-BR')}</div>
      </body></html>`;
    const w = window.open('', '_blank');
    if (!w) return;
    w.document.write(content);
    w.document.close();
    w.print();
  };

  const createRouteMut = useMutation({
    mutationFn: () => {
      const driver = drivers.find(d => d.id.toString() === routeDriver);
      const vehicle = vehicles.find(v => v.id.toString() === routeVehicle);
      return apiRequest('POST', '/api/logistics/routes', {
        name: routeName || `Rota ${selectedDay}`,
        driverId: routeDriver ? Number(routeDriver) : null,
        driverName: driver?.name || '',
        vehicleId: routeVehicle ? Number(routeVehicle) : null,
        vehiclePlate: vehicle?.plate || '',
        deliveryDate: selectedDate || new Date().toISOString().split('T')[0],
        status: 'SCHEDULED',
        companyIds: companies.map(c => c.id),
        companyNames: companies.map(c => c.companyName).join(', '),
        startTime: companies[0]?.deliveryWindow?.startTime || '08:00',
        endTime: companies[companies.length - 1]?.deliveryWindow?.endTime || '18:00',
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/logistics/routes'] });
      toast({ title: 'Rota criada com sucesso!' });
      setShowCreateRoute(false);
    },
    onError: (e: any) => toast({ title: e?.message || 'Erro ao criar rota', variant: 'destructive' }),
  });

  const withOrders = companies.filter(c => c.hasOrderForDate === true);
  const withoutOrders = companies.filter(c => c.hasOrderForDate === false);

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2 flex-wrap">
        <Sparkles className="w-5 h-5 text-primary" />
        <div>
          <p className="font-semibold">Assistente de Rota Inteligente</p>
          <p className="text-xs text-muted-foreground">Agrupa empresas por dia de entrega, ordenadas por janela horária</p>
        </div>
      </div>

      <div className="flex flex-wrap gap-3 items-end">
        <div>
          <Label className="text-xs mb-1 block">Dia da semana *</Label>
          <Select value={selectedDay} onValueChange={setSelectedDay}>
            <SelectTrigger className="w-44" data-testid="select-assistant-day"><SelectValue placeholder="Selecionar dia" /></SelectTrigger>
            <SelectContent>
              {WEEK_DAYS_ASSIST.map(d => <SelectItem key={d} value={d}>{d}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-xs mb-1 block">Data de entrega (opcional)</Label>
          <Input type="date" value={selectedDate} onChange={e => setSelectedDate(e.target.value)} className="w-44" data-testid="input-assistant-date" />
        </div>
        <Button onClick={fetchAssistant} disabled={loading || !selectedDay} data-testid="button-fetch-assistant">
          {loading ? <RefreshCw className="w-4 h-4 mr-1 animate-spin" /> : <Navigation className="w-4 h-4 mr-1" />}
          Gerar Sugestão
        </Button>
      </div>

      {companies.length > 0 && (
        <>
          {routeConflicts.length > 0 && (
            <div className="bg-orange-50 border border-orange-200 rounded-xl p-3 space-y-1">
              <div className="flex items-center gap-2 font-bold text-orange-800 text-sm">
                <AlertTriangle className="w-4 h-4" /> {routeConflicts.length} Conflito(s) de Janela de Horário Detectado(s)
              </div>
              {routeConflicts.map((c, i) => (
                <p key={i} className="text-xs text-orange-700">
                  ⚠ <strong>{c.a.companyName}</strong> e <strong>{c.b.companyName}</strong> têm a mesma janela de início ({c.a.deliveryWindow?.startTime}) mas estão a <strong>{c.distKm.toFixed(1)} km</strong> de distância — atenção ao planejamento.
                </p>
              ))}
            </div>
          )}

          {timeEstimate && (
            <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 flex flex-wrap gap-4 text-sm">
              <div className="flex items-center gap-1.5 text-blue-800">
                <Clock className="w-4 h-4" />
                <span className="font-bold">Tempo estimado:</span>
                <span>{timeEstimate.hours}h {timeEstimate.mins}min</span>
              </div>
              {timeEstimate.totalKm > 0 && (
                <div className="flex items-center gap-1.5 text-blue-800">
                  <Navigation className="w-4 h-4" />
                  <span className="font-bold">Distância total:</span>
                  <span>≈ {timeEstimate.totalKm} km</span>
                </div>
              )}
              <div className="flex items-center gap-1.5 text-blue-700 text-xs">
                <span>(15 min/parada + tempo de deslocamento estimado a 30 km/h)</span>
              </div>
            </div>
          )}

          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="flex gap-2 text-xs text-muted-foreground">
              <span className="bg-green-100 text-green-800 px-2 py-0.5 rounded-full font-medium">{withOrders.length} com pedido</span>
              <span className="bg-muted px-2 py-0.5 rounded-full">{withoutOrders.length} sem pedido</span>
              <span className="font-medium">{companies.length} total</span>
            </div>
            <div className="flex gap-2 flex-wrap">
              <Button size="sm" variant="outline" onClick={() => setShowMap(v => !v)} data-testid="button-toggle-map">
                <Map className="w-4 h-4 mr-1" /> {showMap ? 'Ocultar Mapa' : 'Ver no Mapa'}
              </Button>
              <Button size="sm" variant="outline" onClick={printManifesto} data-testid="button-print-manifesto">
                <Printer className="w-4 h-4 mr-1" /> Imprimir Manifesto
              </Button>
              <Button size="sm" onClick={() => { setShowCreateRoute(true); setRouteName(`Rota ${selectedDay}`); }} data-testid="button-create-from-assistant">
                <Plus className="w-4 h-4 mr-1" /> Criar Rota
              </Button>
            </div>
          </div>

          {showMap && (() => {
            const withCoords = companies.filter(c => c.latitude && c.longitude);
            if (withCoords.length === 0) return (
              <div className="bg-muted/30 rounded-xl p-6 text-center text-muted-foreground text-sm border border-border/50">
                <Map className="w-8 h-8 mx-auto mb-2 opacity-40" />
                <p>Nenhuma empresa possui coordenadas GPS cadastradas.</p>
                <p className="text-xs mt-1">Adicione latitude/longitude nas configurações de cada empresa.</p>
              </div>
            );
            const mapUrl = `https://www.openstreetmap.org/export/embed.html?bbox=${Math.min(...withCoords.map(c=>Number(c.longitude)))-0.02},${Math.min(...withCoords.map(c=>Number(c.latitude)))-0.02},${Math.max(...withCoords.map(c=>Number(c.longitude)))+0.02},${Math.max(...withCoords.map(c=>Number(c.latitude)))+0.02}&layer=mapnik&marker=${withCoords[0].latitude},${withCoords[0].longitude}`;
            const avgLat = withCoords.reduce((s, c) => s + Number(c.latitude), 0) / withCoords.length;
            const avgLon = withCoords.reduce((s, c) => s + Number(c.longitude), 0) / withCoords.length;
            const zoom = withCoords.length === 1 ? 14 : 11;
            const markers = withCoords.map((c, i) => `&marker=${c.latitude},${c.longitude}`).join('');
            const googleUrl = `https://www.google.com/maps/dir/${withCoords.map(c => `${c.latitude},${c.longitude}`).join('/')}`;
            const osmUrl = `https://www.openstreetmap.org/#map=${zoom}/${avgLat}/${avgLon}`;
            return (
              <div className="rounded-xl border border-border/50 overflow-hidden">
                <div className="bg-muted/20 px-4 py-2.5 flex items-center justify-between border-b border-border/50">
                  <div>
                    <p className="font-bold text-sm text-foreground">{withCoords.length} empresa(s) com GPS cadastrado</p>
                    {withCoords.length < companies.length && <p className="text-xs text-muted-foreground">{companies.length - withCoords.length} sem coordenadas (não exibidas)</p>}
                  </div>
                  <div className="flex gap-2">
                    <a href={googleUrl} target="_blank" rel="noreferrer"
                      className="text-xs px-3 py-1.5 bg-blue-600 text-white rounded-lg font-bold hover:bg-blue-700 transition-colors">
                      Google Maps
                    </a>
                    <a href={osmUrl} target="_blank" rel="noreferrer"
                      className="text-xs px-3 py-1.5 border border-border rounded-lg font-bold hover:bg-muted/40 transition-colors">
                      OpenStreetMap
                    </a>
                  </div>
                </div>
                <div className="relative bg-muted/10" style={{ height: 380 }}>
                  <LeafletMap companies={withCoords} />
                </div>
              </div>
            );
          })()}

          <div className="space-y-2">
            {companies.map((c, i) => (
              <Card key={c.id} data-testid={`card-assistant-company-${c.id}`} className={`premium-shadow transition-all ${c.hasOrderForDate === true ? 'border-green-300 bg-green-50/30 dark:bg-green-950/10' : ''}`}>
                <CardContent className="p-3 flex items-center gap-3">
                  <div className="flex flex-col gap-0.5">
                    <button className="p-0.5 text-muted-foreground hover:text-foreground disabled:opacity-30" onClick={() => moveUp(i)} disabled={i === 0}><ArrowUp className="w-3.5 h-3.5" /></button>
                    <span className="text-sm font-bold text-primary text-center leading-none">{i + 1}</span>
                    <button className="p-0.5 text-muted-foreground hover:text-foreground disabled:opacity-30" onClick={() => moveDown(i)} disabled={i === companies.length - 1}><ArrowDown className="w-3.5 h-3.5" /></button>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-sm">{c.companyName}</span>
                      {c.hasOrderForDate === true && <span className="text-xs bg-green-100 text-green-800 px-1.5 py-0.5 rounded-full font-medium">✔ Pedido</span>}
                      <span className="text-xs bg-muted text-muted-foreground px-1.5 py-0.5 rounded-full">{c.clientType}</span>
                    </div>
                    <p className="text-xs text-muted-foreground truncate">{[c.addressStreet, c.addressNumber, c.addressNeighborhood, c.addressCity].filter(Boolean).join(', ')}</p>
                    {c.latitude && c.longitude && (
                      <p className="text-xs text-blue-500">📍 {Number(c.latitude).toFixed(4)}, {Number(c.longitude).toFixed(4)}</p>
                    )}
                  </div>
                  {c.deliveryWindow && (
                    <div className="shrink-0 text-right">
                      <div className="text-xs font-bold text-primary bg-primary/10 px-2 py-1 rounded-lg">
                        {c.deliveryWindow.startTime}
                        <br />
                        <span className="text-muted-foreground font-normal">{c.deliveryWindow.endTime}</span>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        </>
      )}

      {companies.length === 0 && !loading && selectedDay && (
        <div className="text-center py-12 text-muted-foreground">
          <Navigation className="w-10 h-10 mx-auto mb-2 opacity-30" />
          <p>Nenhuma empresa com entrega configurada para <strong>{selectedDay}</strong></p>
          <p className="text-xs mt-1">Configure a janela de entrega nas empresas para incluí-las na sugestão</p>
        </div>
      )}

      {companies.length === 0 && !loading && !selectedDay && (
        <div className="text-center py-12 text-muted-foreground">
          <CalendarDays className="w-12 h-12 mx-auto mb-3 opacity-20" />
          <p className="font-medium">Selecione um dia para gerar a sugestão de rota</p>
          <p className="text-xs mt-1">O sistema irá agrupar as empresas por janela de entrega automaticamente</p>
        </div>
      )}

      <Dialog open={showCreateRoute} onOpenChange={setShowCreateRoute}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Criar Rota a partir da Sugestão</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Nome da Rota *</Label>
              <Input value={routeName} onChange={e => setRouteName(e.target.value)} data-testid="input-route-name" />
            </div>
            <div>
              <Label>Motorista</Label>
              <Select value={routeDriver} onValueChange={setRouteDriver}>
                <SelectTrigger><SelectValue placeholder="Selecionar motorista" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Nenhum</SelectItem>
                  {drivers.filter(d => d.active).map(d => <SelectItem key={d.id} value={d.id.toString()}>{d.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Veículo</Label>
              <Select value={routeVehicle} onValueChange={setRouteVehicle}>
                <SelectTrigger><SelectValue placeholder="Selecionar veículo" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Nenhum</SelectItem>
                  {vehicles.filter(v => v.active).map(v => <SelectItem key={v.id} value={v.id.toString()}>{v.plate} – {v.model}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="bg-muted/40 rounded-lg p-3 text-xs text-muted-foreground">
              <p className="font-medium mb-1 text-foreground">{companies.length} empresas incluídas:</p>
              {companies.slice(0, 5).map((c, i) => <p key={c.id}>{i + 1}. {c.companyName}{c.deliveryWindow ? ` – ${c.deliveryWindow.startTime}` : ''}</p>)}
              {companies.length > 5 && <p>+ {companies.length - 5} mais...</p>}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreateRoute(false)}>Cancelar</Button>
            <Button onClick={() => createRouteMut.mutate()} disabled={createRouteMut.isPending || !routeName}>
              {createRouteMut.isPending ? 'Criando...' : 'Criar Rota'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Smart Intelligence Tab ──────────────────────────────────────────────────
function SmartIntelligenceTab() {
  const { toast } = useToast();
  const [selectedDate, setSelectedDate] = useState('');

  const { data: plan, isLoading, refetch, isFetching } = useQuery<any>({
    queryKey: ['/api/logistics/smart-route-plan', selectedDate],
    queryFn: () => {
      const params = new URLSearchParams();
      if (selectedDate) params.set('date', selectedDate);
      return fetch(`/api/logistics/smart-route-plan?${params}`, { credentials: 'include' }).then(r => r.json());
    },
  });

  const applyMut = useMutation({
    mutationFn: async (suggestion: any) => {
      const res = await fetch('/api/logistics/route-insertion', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ companyId: suggestion.companyId, date: selectedDate }),
      });
      return res.json();
    },
    onSuccess: () => { toast({ title: 'Sugestão aplicada!' }); refetch(); },
    onError: () => toast({ title: 'Erro ao aplicar sugestão', variant: 'destructive' }),
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <Sparkles className="w-5 h-5 text-purple-600 shrink-0" />
          <div>
            <p className="font-semibold text-foreground">Inteligência de Rotas</p>
            <p className="text-xs text-muted-foreground">Análise automática de carga, regiões e sugestões de distribuição</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Input
            type="date"
            data-testid="input-smart-date"
            value={selectedDate}
            onChange={e => setSelectedDate(e.target.value)}
            className="h-8 text-xs w-36"
          />
          <Button type="button" size="sm" variant="outline" onClick={() => refetch()} disabled={isFetching} className="h-8">
            <RefreshCw className={`w-3.5 h-3.5 mr-1 ${isFetching ? 'animate-spin' : ''}`} />
            Analisar
          </Button>
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-3">{[1,2,3].map(i => <div key={i} className="h-16 bg-muted/50 rounded-xl animate-pulse" />)}</div>
      ) : plan ? (
        <div className="space-y-4">
          {/* Summary */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { label: 'Total Entregas', value: plan.totalDeliveries, icon: Truck, color: 'text-blue-600' },
              { label: 'Com Coordenadas', value: plan.deliveriesWithCoords, icon: MapPin, color: 'text-green-600' },
              { label: 'Regiões', value: plan.clusters?.length || 0, icon: Map, color: 'text-purple-600' },
              { label: 'KM Estimado', value: `${plan.estimatedTotalKm} km`, icon: Navigation, color: 'text-orange-600' },
            ].map(({ label, value, icon: Icon, color }) => (
              <Card key={label} className="premium-shadow">
                <CardContent className="p-3 flex items-center gap-2">
                  <Icon className={`w-6 h-6 ${color} shrink-0`} />
                  <div>
                    <p className="text-lg font-bold">{value}</p>
                    <p className="text-[10px] text-muted-foreground">{label}</p>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          {/* Overload Warnings */}
          {plan.overloadedDrivers?.length > 0 && (
            <div className="p-4 rounded-xl bg-red-50 dark:bg-red-900/10 border border-red-200/60">
              <div className="flex items-center gap-2 mb-3">
                <AlertTriangle className="w-4 h-4 text-red-600" />
                <p className="text-sm font-semibold text-red-800 dark:text-red-300">Sobrecarga Detectada</p>
              </div>
              <div className="space-y-2">
                {plan.overloadedDrivers.map((d: any) => (
                  <div key={d.id} className="flex items-center gap-3 p-2 bg-white dark:bg-card rounded-lg border border-red-200/40">
                    <User className="w-4 h-4 text-red-500 shrink-0" />
                    <div className="flex-1">
                      <p className="text-xs font-medium text-foreground">{d.name}</p>
                      <p className="text-[10px] text-red-600">{d.deliveryCount} entregas — {d.excess} acima do limite (8)</p>
                    </div>
                    <div className="w-24 h-1.5 bg-red-100 rounded-full overflow-hidden">
                      <div className="h-full bg-red-500 rounded-full" style={{ width: `${Math.min(100, (d.deliveryCount / 12) * 100)}%` }} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Driver Load */}
          {plan.driverLoad?.length > 0 && (
            <Card>
              <CardHeader className="pb-2 pt-4 px-4">
                <CardTitle className="text-sm flex items-center gap-2">
                  <User className="w-4 h-4 text-blue-600" />
                  Carga por Motorista
                </CardTitle>
              </CardHeader>
              <CardContent className="px-4 pb-4">
                <div className="space-y-2">
                  {plan.driverLoad.map((d: any) => (
                    <div key={d.driverId} className="flex items-center gap-3">
                      <span className="text-xs text-foreground w-32 truncate">{d.name}</span>
                      <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full ${d.overloaded ? 'bg-red-500' : d.count >= 5 ? 'bg-yellow-500' : 'bg-green-500'}`}
                          style={{ width: `${Math.min(100, (d.count / 10) * 100)}%` }}
                        />
                      </div>
                      <span className={`text-xs font-semibold w-12 text-right ${d.overloaded ? 'text-red-600' : 'text-foreground'}`}>
                        {d.count} entrega{d.count !== 1 ? 's' : ''}
                      </span>
                      {d.overloaded && <AlertTriangle className="w-3.5 h-3.5 text-red-500 shrink-0" />}
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Regional Clusters */}
          {plan.clusters?.length > 0 && (
            <Card>
              <CardHeader className="pb-2 pt-4 px-4">
                <CardTitle className="text-sm flex items-center gap-2">
                  <MapPin className="w-4 h-4 text-purple-600" />
                  Agrupamento por Região
                </CardTitle>
              </CardHeader>
              <CardContent className="px-4 pb-4">
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {plan.clusters.map((c: any, i: number) => (
                    <div key={i} className="p-3 rounded-xl bg-muted/30 border border-border/40">
                      <p className="text-xs font-semibold text-foreground truncate">{c.label}</p>
                      <p className="text-lg font-bold mt-1">{c.count}</p>
                      <p className="text-[10px] text-muted-foreground">
                        entrega{c.count !== 1 ? 's' : ''} · {c.assignedDrivers} motorista{c.assignedDrivers !== 1 ? 's' : ''}
                      </p>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Suggestions */}
          {plan.suggestions?.length > 0 && (
            <Card>
              <CardHeader className="pb-2 pt-4 px-4">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-emerald-600" />
                  Sugestões de Redistribuição
                </CardTitle>
              </CardHeader>
              <CardContent className="px-4 pb-4 space-y-2">
                {plan.suggestions.map((s: any, i: number) => (
                  <div key={i} className="flex items-start gap-3 p-3 rounded-xl bg-emerald-50/50 dark:bg-emerald-900/10 border border-emerald-200/40">
                    <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                    <div className="flex-1">
                      <p className="text-xs font-semibold text-foreground">{s.region}</p>
                      <p className="text-[11px] text-muted-foreground mt-0.5">
                        {s.deliveryCount} entrega{s.deliveryCount !== 1 ? 's' : ''} sem motorista · {s.estimatedKm} km estimado
                      </p>
                      {s.suggestedDriver && (
                        <p className="text-[11px] text-emerald-700 dark:text-emerald-400 mt-1">
                          Motorista sugerido: <strong>{s.suggestedDriver.name}</strong> ({s.suggestedDriver.currentLoad} entregas atuais)
                        </p>
                      )}
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          {/* Empty state */}
          {plan.totalDeliveries === 0 && (
            <div className="text-center py-12 text-muted-foreground">
              <Truck className="w-10 h-10 mx-auto mb-3 opacity-40" />
              <p className="text-sm">Nenhuma entrega encontrada{selectedDate ? ` para ${selectedDate}` : ''}.</p>
              <p className="text-xs mt-1">Selecione uma data ou aguarde o cadastro de pedidos.</p>
            </div>
          )}
        </div>
      ) : (
        <div className="text-center py-12 text-muted-foreground">
          <Sparkles className="w-10 h-10 mx-auto mb-3 opacity-40" />
          <p className="text-sm">Clique em "Analisar" para gerar o plano inteligente de rotas.</p>
        </div>
      )}
    </div>
  );
}

// ─── Main Page ───────────────────────────────────────────────────────────────
export default function LogisticsPage() {
  const { data: drivers = [] } = useQuery<LogisticsDriver[]>({ queryKey: ['/api/logistics/drivers'] });
  const { data: vehicles = [] } = useQuery<LogisticsVehicle[]>({ queryKey: ['/api/logistics/vehicles'] });
  const { data: routes = [] } = useQuery<LogisticsRoute[]>({ queryKey: ['/api/logistics/routes'] });
  const { data: quotations = [] } = useQuery<CompanyQuotation[]>({ queryKey: ['/api/quotations'] });

  const activeRoutes = routes.filter(r => r.status === 'IN_PROGRESS').length;
  const pendingQuotations = quotations.filter(q => q.status === 'PENDING' || q.status === 'IN_ANALYSIS').length;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Logística</h1>
        <p className="text-sm text-muted-foreground mt-1">Gerencie motoristas, veículos, rotas, manutenção e cotações</p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {[
          { label: 'Motoristas', value: drivers.filter(d => d.active).length, icon: User, color: 'text-blue-600' },
          { label: 'Veículos Ativos', value: vehicles.filter(v => v.active).length, icon: Truck, color: 'text-green-600' },
          { label: 'Rotas Hoje', value: routes.length, icon: MapPin, color: 'text-orange-600' },
          { label: 'Em Andamento', value: activeRoutes, icon: Clock, color: 'text-purple-600' },
          { label: 'Cotações Abertas', value: pendingQuotations, icon: FileText, color: 'text-indigo-600' },
        ].map(({ label, value, icon: Icon, color }) => (
          <Card key={label} className="premium-shadow">
            <CardContent className="p-4 flex items-center gap-3">
              <Icon className={`w-8 h-8 ${color}`} />
              <div>
                <p className="text-2xl font-bold">{value}</p>
                <p className="text-xs text-muted-foreground">{label}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Tabs defaultValue="routes">
        <TabsList className="flex-wrap">
          <TabsTrigger value="intelligence" data-testid="tab-intelligence">⚡ Inteligência</TabsTrigger>
          <TabsTrigger value="assistant" data-testid="tab-assistant">🧠 Assistente</TabsTrigger>
          <TabsTrigger value="routes" data-testid="tab-routes">Rotas</TabsTrigger>
          <TabsTrigger value="drivers" data-testid="tab-drivers">Motoristas</TabsTrigger>
          <TabsTrigger value="vehicles" data-testid="tab-vehicles">Veículos</TabsTrigger>
          <TabsTrigger value="maintenance" data-testid="tab-maintenance">Manutenção</TabsTrigger>
          <TabsTrigger value="quotations" data-testid="tab-quotations">Cotações</TabsTrigger>
        </TabsList>
        <TabsContent value="intelligence" className="mt-4"><SmartIntelligenceTab /></TabsContent>
        <TabsContent value="assistant" className="mt-4"><RouteAssistantTab /></TabsContent>
        <TabsContent value="routes" className="mt-4"><RoutesTab /></TabsContent>
        <TabsContent value="drivers" className="mt-4"><DriversTab /></TabsContent>
        <TabsContent value="vehicles" className="mt-4"><VehiclesTab /></TabsContent>
        <TabsContent value="maintenance" className="mt-4"><MaintenanceTab /></TabsContent>
        <TabsContent value="quotations" className="mt-4"><CotacoesTab /></TabsContent>
      </Tabs>
    </div>
  );
}
