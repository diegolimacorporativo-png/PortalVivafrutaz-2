import { useState, useEffect, useRef } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { queryClient, apiRequest } from '@/lib/queryClient';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Plus, Eye, Pencil, Trash2, Building2, Download, Clock, MapPin, Route, Users, ArrowRight, CheckCircle2 } from 'lucide-react';
import type { CompanyQuotation, PriceGroup } from '@shared/schema';

const STATUS_LABEL: Record<string, string> = { PENDING: 'Pendente', IN_ANALYSIS: 'Em análise', APPROVED: 'Aprovado', REJECTED: 'Rejeitado', HORARIOS_DISPONIVEIS: 'Horários Disponíveis' };
const STATUS_COLOR: Record<string, string> = {
  PENDING: 'bg-yellow-100 text-yellow-800',
  IN_ANALYSIS: 'bg-blue-100 text-blue-800',
  APPROVED: 'bg-green-100 text-green-800',
  REJECTED: 'bg-red-100 text-red-800',
  HORARIOS_DISPONIVEIS: 'bg-purple-100 text-purple-800',
};

type DeliveryWindow = { startTime: string; endTime: string };
function parseWindows(json: string | null | undefined): DeliveryWindow[] {
  try { return json ? JSON.parse(json) : []; } catch { return []; }
}

function exportToCSV(rows: any[], filename: string) {
  if (!rows.length) return;
  const headers = Object.keys(rows[0]);
  const csv = [headers.join(';'), ...rows.map(r => headers.map(h => `"${r[h] ?? ''}"`).join(';'))].join('\n');
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

type SuggestionCompany = {
  id: number;
  companyName: string;
  addressCity: string | null;
  addressStreet: string | null;
  addressNeighborhood: string | null;
  enabledDays: { day: string; startTime: string; endTime: string }[];
};

function DeliverySuggestionsPanel({ city }: { city: string }) {
  const [suggestions, setSuggestions] = useState<SuggestionCompany[]>([]);
  const [loading, setLoading] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    if (!city || city.trim().length < 2) { setSuggestions([]); return; }

    timerRef.current = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/companies/delivery-suggestions?city=${encodeURIComponent(city.trim())}`, { credentials: 'include' });
        if (res.ok) setSuggestions(await res.json());
      } catch {}
      setLoading(false);
    }, 500);

    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, [city]);

  if (!city || city.trim().length < 2) return null;

  if (loading) {
    return (
      <div className="mt-3 p-3 rounded-xl bg-blue-50 border border-blue-200 text-sm text-blue-600 flex items-center gap-2">
        <Clock className="w-4 h-4 animate-spin" />
        Buscando empresas próximas com rota ativa...
      </div>
    );
  }

  if (suggestions.length === 0) {
    return (
      <div className="mt-3 p-3 rounded-xl bg-gray-50 border border-gray-200 text-sm text-gray-500 flex items-center gap-2">
        <MapPin className="w-4 h-4" />
        Nenhuma empresa com rota ativa encontrada em <strong>&nbsp;{city}</strong>.
      </div>
    );
  }

  // Group companies by time window overlap
  const windowGroups: Map<string, SuggestionCompany[]> = new Map();
  suggestions.forEach(co => {
    co.enabledDays.forEach(d => {
      const key = `${d.startTime}-${d.endTime}`;
      if (!windowGroups.has(key)) windowGroups.set(key, []);
      windowGroups.get(key)!.push(co);
    });
  });

  return (
    <div className="mt-3 space-y-2" data-testid="delivery-suggestions-panel">
      <div className="flex items-center gap-2 text-sm font-semibold text-primary">
        <Route className="w-4 h-4" />
        Empresas com rota logística ativa em <span className="font-bold">{city}</span>
      </div>

      <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
        {suggestions.map(co => (
          <div key={co.id} className="p-3 rounded-xl bg-green-50 border border-green-200 text-sm">
            <div className="flex items-center gap-2 mb-1">
              <Building2 className="w-4 h-4 text-green-600" />
              <span className="font-semibold text-green-800">{co.companyName}</span>
              {co.addressNeighborhood && (
                <span className="text-xs text-green-600">• {co.addressNeighborhood}</span>
              )}
            </div>
            <div className="flex flex-wrap gap-1">
              {co.enabledDays.map(d => (
                <span key={d.day} className="text-xs bg-white border border-green-300 text-green-700 px-2 py-0.5 rounded-full">
                  {d.day.split('-')[0]}: {d.startTime}–{d.endTime}
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* Route grouping suggestions */}
      {Array.from(windowGroups.entries()).filter(([, cos]) => cos.length > 1).map(([window, cos]) => {
        const [start, end] = window.split('-');
        return (
          <div key={window} className="p-3 rounded-xl bg-orange-50 border border-orange-200 text-sm">
            <div className="flex items-center gap-2 text-orange-700 font-semibold mb-1">
              <Users className="w-4 h-4" />
              Rota consolidável: {start}–{end}
            </div>
            <p className="text-xs text-orange-600">
              {cos.map(c => c.companyName).join(', ')} — já existe rota logística ativa neste horário.
              A nova empresa pode ser agrupada nessa rota.
            </p>
          </div>
        );
      })}
    </div>
  );
}

function QuotationForm({ onClose, priceGroups, editItem }: { onClose: () => void; priceGroups: PriceGroup[]; editItem?: CompanyQuotation }) {
  const { toast } = useToast();
  const [form, setForm] = useState({
    companyName: editItem?.companyName || '',
    contactName: editItem?.contactName || '',
    contactPhone: editItem?.contactPhone || '',
    email: editItem?.email || '',
    cnpj: editItem?.cnpj || '',
    address: editItem?.address || '',
    city: editItem?.city || '',
    state: editItem?.state || '',
    estimatedVolume: editItem?.estimatedVolume || '',
    productInterest: editItem?.productInterest || '',
    logisticsNote: editItem?.logisticsNote || '',
    priceGroupId: editItem?.priceGroupId?.toString() || 'none',
  });

  const saveMut = useMutation({
    mutationFn: (data: any) => editItem
      ? apiRequest('PATCH', `/api/quotations/${editItem.id}`, data)
      : apiRequest('POST', '/api/quotations', data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/quotations'] });
      toast({ title: editItem ? 'Cotação atualizada!' : 'Cotação criada!' });
      onClose();
    },
    onError: (e: any) => toast({ title: e?.message || 'Erro ao salvar', variant: 'destructive' }),
  });

  const handleSubmit = () => {
    if (!form.companyName || !form.contactName) {
      return toast({ title: 'Empresa e contato obrigatórios', variant: 'destructive' });
    }
    const pg = priceGroups.find(p => p.id.toString() === form.priceGroupId);
    saveMut.mutate({
      ...form,
      priceGroupId: form.priceGroupId && form.priceGroupId !== 'none' ? parseInt(form.priceGroupId) : undefined,
      priceGroupName: pg?.groupName || undefined,
    });
  };

  return (
    <div className="space-y-4 max-h-[75vh] overflow-y-auto pr-1">
      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2">
          <Label>Razão Social / Nome da Empresa *</Label>
          <Input data-testid="input-quotation-company" value={form.companyName} onChange={e => setForm(p => ({ ...p, companyName: e.target.value }))} />
        </div>
        <div><Label>CNPJ</Label><Input value={form.cnpj} onChange={e => setForm(p => ({ ...p, cnpj: e.target.value }))} placeholder="00.000.000/0001-00" /></div>
        <div><Label>Contato *</Label><Input data-testid="input-quotation-contact" value={form.contactName} onChange={e => setForm(p => ({ ...p, contactName: e.target.value }))} /></div>
        <div><Label>Telefone</Label><Input value={form.contactPhone} onChange={e => setForm(p => ({ ...p, contactPhone: e.target.value }))} /></div>
        <div><Label>Email</Label><Input type="email" value={form.email} onChange={e => setForm(p => ({ ...p, email: e.target.value }))} /></div>
        <div className="col-span-2"><Label>Endereço</Label><Input value={form.address} onChange={e => setForm(p => ({ ...p, address: e.target.value }))} /></div>
        <div>
          <Label>Cidade</Label>
          <Input
            value={form.city}
            data-testid="input-quotation-city"
            onChange={e => setForm(p => ({ ...p, city: e.target.value }))}
            placeholder="Ex: São Paulo"
          />
        </div>
        <div><Label>Estado</Label><Input value={form.state} maxLength={2} onChange={e => setForm(p => ({ ...p, state: e.target.value.toUpperCase() }))} placeholder="SP" /></div>
      </div>

      {/* Auto delivery suggestion panel - shows when city has value */}
      <DeliverySuggestionsPanel city={form.city} />

      <div className="grid grid-cols-2 gap-3">
        <div><Label>Volume Estimado</Label><Input value={form.estimatedVolume} onChange={e => setForm(p => ({ ...p, estimatedVolume: e.target.value }))} placeholder="ex: 50 caixas/semana" /></div>
        <div>
          <Label>Grupo de Preço</Label>
          <Select value={form.priceGroupId} onValueChange={v => setForm(p => ({ ...p, priceGroupId: v }))}>
            <SelectTrigger data-testid="select-quotation-pricegroup"><SelectValue placeholder="Selecionar" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="none">Nenhum</SelectItem>
              {priceGroups.map(pg => <SelectItem key={pg.id} value={pg.id.toString()}>{pg.groupName}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="col-span-2"><Label>Interesse em produtos</Label><Textarea value={form.productInterest} onChange={e => setForm(p => ({ ...p, productInterest: e.target.value }))} rows={2} placeholder="Quais produtos tem interesse?" /></div>
        <div className="col-span-2"><Label>Análise Logística</Label><Textarea value={form.logisticsNote} onChange={e => setForm(p => ({ ...p, logisticsNote: e.target.value }))} rows={2} placeholder="Observações sobre entrega, rotas, horários..." /></div>
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>Cancelar</Button>
        <Button data-testid="button-save-quotation" onClick={handleSubmit} disabled={saveMut.isPending}>
          {saveMut.isPending ? 'Salvando...' : editItem ? 'Atualizar' : 'Criar Cotação'}
        </Button>
      </DialogFooter>
    </div>
  );
}

function QuotationDetail({ quotation, onClose, priceGroups }: { quotation: CompanyQuotation; onClose: () => void; priceGroups: PriceGroup[] }) {
  const { toast } = useToast();
  const [status, setStatus] = useState(quotation.status);
  const [adminNote, setAdminNote] = useState(quotation.adminNote || '');
  const [priceGroupId, setPriceGroupId] = useState(quotation.priceGroupId?.toString() || 'none');

  const updateMut = useMutation({
    mutationFn: (data: any) => apiRequest('PATCH', `/api/quotations/${quotation.id}`, data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['/api/quotations'] }); toast({ title: 'Cotação atualizada!' }); onClose(); },
    onError: () => toast({ title: 'Erro', variant: 'destructive' }),
  });

  const pg = priceGroups.find(p => p.id.toString() === priceGroupId);

  return (
    <div className="space-y-4 max-h-[70vh] overflow-y-auto pr-1">
      <div className="grid grid-cols-2 gap-2 text-sm">
        <div><span className="font-medium text-muted-foreground">Empresa:</span><p className="font-semibold">{quotation.companyName}</p></div>
        <div><span className="font-medium text-muted-foreground">CNPJ:</span><p>{quotation.cnpj || '—'}</p></div>
        <div><span className="font-medium text-muted-foreground">Contato:</span><p>{quotation.contactName}</p></div>
        <div><span className="font-medium text-muted-foreground">Telefone:</span><p>{quotation.contactPhone || '—'}</p></div>
        <div><span className="font-medium text-muted-foreground">Email:</span><p>{quotation.email || '—'}</p></div>
        <div><span className="font-medium text-muted-foreground">Cidade/UF:</span><p>{[quotation.city, quotation.state].filter(Boolean).join('/') || '—'}</p></div>
        {quotation.address && <div className="col-span-2"><span className="font-medium text-muted-foreground">Endereço:</span><p>{quotation.address}</p></div>}
        {quotation.estimatedVolume && <div><span className="font-medium text-muted-foreground">Volume:</span><p>{quotation.estimatedVolume}</p></div>}
        {quotation.productInterest && <div className="col-span-2"><span className="font-medium text-muted-foreground">Interesse:</span><p>{quotation.productInterest}</p></div>}
        {quotation.logisticsNote && <div className="col-span-2"><span className="font-medium text-muted-foreground">Logística:</span><p>{quotation.logisticsNote}</p></div>}
        {parseWindows(quotation.deliveryWindowsJson).length > 0 && (
          <div className="col-span-2">
            <span className="font-medium text-muted-foreground flex items-center gap-1"><Clock className="w-3.5 h-3.5 text-purple-600" />Janelas de Entrega:</span>
            <div className="flex flex-wrap gap-1 mt-1">
              {parseWindows(quotation.deliveryWindowsJson).map((w, i) => (
                <span key={i} className="text-xs bg-purple-100 text-purple-800 px-2 py-0.5 rounded-full">{w.startTime} – {w.endTime}</span>
              ))}
            </div>
            {quotation.deliveryWindowsRespondedBy && (
              <p className="text-xs text-muted-foreground mt-1">Definido por {quotation.deliveryWindowsRespondedBy}{quotation.deliveryWindowsRespondedAt ? ` em ${new Date(quotation.deliveryWindowsRespondedAt).toLocaleDateString('pt-BR')}` : ''}</p>
            )}
          </div>
        )}
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label>Status</Label>
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger data-testid="select-quotation-status"><SelectValue /></SelectTrigger>
            <SelectContent>
              {Object.entries(STATUS_LABEL).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label>Grupo de Preço</Label>
          <Select value={priceGroupId} onValueChange={setPriceGroupId}>
            <SelectTrigger><SelectValue placeholder="Definir" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="none">Nenhum</SelectItem>
              {priceGroups.map(p => <SelectItem key={p.id} value={p.id.toString()}>{p.groupName}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>
      <div>
        <Label>Nota / Análise</Label>
        <Textarea data-testid="input-quotation-note" value={adminNote} onChange={e => setAdminNote(e.target.value)} rows={3} placeholder="Observações sobre a cotação..." />
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>Fechar</Button>
        <Button data-testid="button-save-quotation-detail" onClick={() => updateMut.mutate({ status, adminNote, priceGroupId: priceGroupId && priceGroupId !== 'none' ? parseInt(priceGroupId) : undefined, priceGroupName: pg?.groupName })} disabled={updateMut.isPending}>
          {updateMut.isPending ? 'Salvando...' : 'Salvar'}
        </Button>
      </DialogFooter>
    </div>
  );
}

// ─── Converter Cotação em Empresa ────────────────────────────────────────────
function ConvertToCompanyModal({ quotation, onClose }: { quotation: CompanyQuotation; onClose: () => void }) {
  const { toast } = useToast();
  const [form, setForm] = useState({
    companyName: quotation.companyName || '',
    contactName: quotation.contactName || '',
    email: quotation.email || '',
    password: '123456',
    phone: quotation.contactPhone || '',
    cnpj: quotation.cnpj || '',
    addressStreet: quotation.address || '',
    addressNumber: '',
    addressNeighborhood: '',
    addressCity: quotation.city || '',
    clientType: 'mensal',
    active: true,
  });
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  const handleConvert = async () => {
    if (!form.companyName || !form.email) {
      toast({ title: 'Nome e e-mail são obrigatórios', variant: 'destructive' });
      return;
    }
    setLoading(true);
    try {
      const res = await fetch('/api/companies', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message || 'Erro ao criar empresa');
      }
      await fetch(`/api/quotations/${quotation.id}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'APPROVED', adminNote: `Convertida em empresa em ${new Date().toLocaleDateString('pt-BR')}` }),
      });
      queryClient.invalidateQueries({ queryKey: ['/api/companies'] });
      queryClient.invalidateQueries({ queryKey: ['/api/quotations'] });
      setDone(true);
      toast({ title: 'Empresa criada com sucesso!', description: `${form.companyName} cadastrada. Senha padrão: 123456` });
    } catch (e: any) {
      toast({ title: e.message || 'Erro', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  if (done) {
    return (
      <div className="text-center py-8 space-y-3">
        <CheckCircle2 className="w-14 h-14 mx-auto text-green-500" />
        <p className="font-semibold text-lg">Empresa criada com sucesso!</p>
        <p className="text-sm text-muted-foreground">A empresa <strong>{form.companyName}</strong> foi cadastrada no sistema.</p>
        <p className="text-xs text-muted-foreground">Senha padrão: <strong>123456</strong> — altere no cadastro de empresas.</p>
        <Button onClick={onClose} className="mt-2">Fechar</Button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="bg-green-50 border border-green-200 rounded-lg p-3 text-sm text-green-800">
        Essa cotação será convertida em empresa ativa no sistema. Revise os dados abaixo antes de confirmar.
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2">
          <Label>Nome da Empresa *</Label>
          <Input value={form.companyName} onChange={e => setForm(p => ({ ...p, companyName: e.target.value }))} data-testid="input-convert-companyname" />
        </div>
        <div>
          <Label>Contato Responsável</Label>
          <Input value={form.contactName} onChange={e => setForm(p => ({ ...p, contactName: e.target.value }))} />
        </div>
        <div>
          <Label>Telefone</Label>
          <Input value={form.phone} onChange={e => setForm(p => ({ ...p, phone: e.target.value }))} />
        </div>
        <div>
          <Label>E-mail (login) *</Label>
          <Input type="email" value={form.email} onChange={e => setForm(p => ({ ...p, email: e.target.value }))} data-testid="input-convert-email" />
        </div>
        <div>
          <Label>CNPJ</Label>
          <Input value={form.cnpj} onChange={e => setForm(p => ({ ...p, cnpj: e.target.value }))} />
        </div>
        <div className="col-span-2">
          <Label>Endereço</Label>
          <Input value={form.addressStreet} onChange={e => setForm(p => ({ ...p, addressStreet: e.target.value }))} />
        </div>
        <div>
          <Label>Cidade</Label>
          <Input value={form.addressCity} onChange={e => setForm(p => ({ ...p, addressCity: e.target.value }))} />
        </div>
        <div>
          <Label>Tipo de Cliente</Label>
          <Select value={form.clientType} onValueChange={v => setForm(p => ({ ...p, clientType: v }))}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="mensal">Mensal</SelectItem>
              <SelectItem value="contratual">Contratual</SelectItem>
              <SelectItem value="sodexo">Sodexo</SelectItem>
              <SelectItem value="avulso">Avulso</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="col-span-2">
          <Label>Senha inicial do cliente</Label>
          <Input value={form.password} onChange={e => setForm(p => ({ ...p, password: e.target.value }))} placeholder="123456" />
          <p className="text-xs text-muted-foreground mt-1">Senha temporária — o admin pode alterar depois no cadastro de empresas.</p>
        </div>
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>Cancelar</Button>
        <Button onClick={handleConvert} disabled={loading} data-testid="button-confirm-convert" className="gap-2">
          {loading ? 'Criando...' : <><ArrowRight className="w-4 h-4" /> Criar Empresa</>}
        </Button>
      </DialogFooter>
    </div>
  );
}

export default function QuotationsPage() {
  const { toast } = useToast();
  const [showForm, setShowForm] = useState(false);
  const [editItem, setEditItem] = useState<CompanyQuotation | undefined>();
  const [selected, setSelected] = useState<CompanyQuotation | undefined>();
  const [convertTarget, setConvertTarget] = useState<CompanyQuotation | undefined>();
  const [filterStatus, setFilterStatus] = useState('ALL');

  const { data: quotations = [], isLoading } = useQuery<CompanyQuotation[]>({ queryKey: ['/api/quotations'] });
  const { data: priceGroups = [] } = useQuery<PriceGroup[]>({ queryKey: ['/api/price-groups'] });

  const delMut = useMutation({
    mutationFn: (id: number) => apiRequest('DELETE', `/api/quotations/${id}`),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['/api/quotations'] }); toast({ title: 'Cotação excluída' }); },
    onError: () => toast({ title: 'Erro ao excluir', variant: 'destructive' }),
  });

  const filtered = filterStatus === 'ALL' ? quotations : quotations.filter(q => q.status === filterStatus);
  const pendingCount = quotations.filter(q => q.status === 'PENDING' || q.status === 'IN_ANALYSIS').length;

  const exportData = () => exportToCSV(filtered.map(q => ({
    Empresa: q.companyName, CNPJ: q.cnpj, Contato: q.contactName, Telefone: q.contactPhone, Email: q.email,
    Cidade: q.city, Estado: q.state, Volume: q.estimatedVolume, 'Grupo Preço': q.priceGroupName, Status: STATUS_LABEL[q.status],
  })), 'cotacoes.csv');

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Cotação de Empresas</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {pendingCount > 0
              ? <span className="text-orange-600 font-medium">{pendingCount} cotação(ões) aguardando análise</span>
              : 'Todas as cotações em dia'}
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Select value={filterStatus} onValueChange={setFilterStatus}>
            <SelectTrigger className="w-40" data-testid="select-quotation-filter"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">Todas</SelectItem>
              {Object.entries(STATUS_LABEL).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" onClick={exportData}><Download className="w-4 h-4 mr-1" /> Exportar</Button>
          <Button onClick={() => { setEditItem(undefined); setShowForm(true); }} data-testid="button-new-quotation" className="gap-2">
            <Plus className="w-4 h-4" /> Nova Cotação
          </Button>
        </div>
      </div>

      {isLoading ? <div className="space-y-3">{[1,2,3].map(i => <div key={i} className="h-20 bg-muted rounded-xl animate-pulse" />)}</div>
      : filtered.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground">
          <Building2 className="w-12 h-12 mx-auto mb-3 opacity-30" />
          <p>Nenhuma cotação encontrada</p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map(q => (
            <Card key={q.id} data-testid={`card-quotation-${q.id}`} className="premium-shadow hover:shadow-md transition-shadow">
              <CardContent className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Building2 className="w-4 h-4 text-primary" />
                      <span className="font-semibold">{q.companyName}</span>
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_COLOR[q.status]}`}>{STATUS_LABEL[q.status]}</span>
                      {q.priceGroupName && <span className="text-xs px-2 py-0.5 bg-muted rounded-full text-muted-foreground">{q.priceGroupName}</span>}
                    </div>
                    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                      <span>👤 {q.contactName}</span>
                      {q.contactPhone && <span>📞 {q.contactPhone}</span>}
                      {q.cnpj && <span>CNPJ: {q.cnpj}</span>}
                      {q.city && <span>📍 {q.city}{q.state && `/${q.state}`}</span>}
                    </div>
                    {q.estimatedVolume && <p className="text-xs text-muted-foreground">Volume: {q.estimatedVolume}</p>}
                    {parseWindows(q.deliveryWindowsJson).length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-1">
                        <span className="text-xs text-purple-700 font-medium flex items-center gap-0.5"><Clock className="w-3 h-3" />Janelas:</span>
                        {parseWindows(q.deliveryWindowsJson).map((w, i) => (
                          <span key={i} className="text-xs bg-purple-100 text-purple-800 px-1.5 py-0.5 rounded-full">{w.startTime}–{w.endTime}</span>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="flex flex-col gap-1 items-end shrink-0">
                    <p className="text-xs text-muted-foreground">{new Date(q.createdAt).toLocaleDateString('pt-BR')}</p>
                    <div className="flex gap-1 flex-wrap justify-end">
                      {q.status === 'APPROVED' && (
                        <Button size="sm" variant="outline" className="h-7 px-2 text-green-700 border-green-300 hover:bg-green-50" onClick={() => setConvertTarget(q)} data-testid={`button-convert-quotation-${q.id}`}>
                          <ArrowRight className="w-3 h-3 mr-1" /> Converter
                        </Button>
                      )}
                      <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => setSelected(q)} data-testid={`button-view-quotation-${q.id}`}><Eye className="w-3.5 h-3.5 mr-1" /> Ver</Button>
                      <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => { setEditItem(q); setShowForm(true); }}><Pencil className="w-3.5 h-3.5" /></Button>
                      <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-red-600" onClick={() => delMut.mutate(q.id)} disabled={delMut.isPending}><Trash2 className="w-3.5 h-3.5" /></Button>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={showForm} onOpenChange={setShowForm}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>{editItem ? 'Editar Cotação' : 'Nova Cotação'}</DialogTitle></DialogHeader>
          <QuotationForm onClose={() => setShowForm(false)} priceGroups={priceGroups} editItem={editItem} />
        </DialogContent>
      </Dialog>

      <Dialog open={!!selected} onOpenChange={() => setSelected(undefined)}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>Cotação — {selected?.companyName}</DialogTitle></DialogHeader>
          {selected && <QuotationDetail quotation={selected} onClose={() => setSelected(undefined)} priceGroups={priceGroups} />}
        </DialogContent>
      </Dialog>

      <Dialog open={!!convertTarget} onOpenChange={() => setConvertTarget(undefined)}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ArrowRight className="w-5 h-5 text-green-600" /> Converter Cotação em Empresa
            </DialogTitle>
          </DialogHeader>
          {convertTarget && <ConvertToCompanyModal quotation={convertTarget} onClose={() => setConvertTarget(undefined)} />}
        </DialogContent>
      </Dialog>
    </div>
  );
}
