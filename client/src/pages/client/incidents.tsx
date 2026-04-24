import { useState, useRef } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { useAuth } from '@/hooks/use-auth';
import { queryClient } from '@/lib/queryClient';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Plus, AlertTriangle, Camera, Trash2, Send, Bell, ImageIcon, MessageSquareReply } from 'lucide-react';
import type { ClientIncident, IncidentMessage } from '@shared/schema';

const TYPE_LABELS: Record<string, string> = {
  DELIVERY_PROBLEM: 'Problema de entrega',
  DEFECTIVE_PRODUCT: 'Produto com defeito',
  MISSING_PRODUCT: 'Produto faltando',
  QUALITY: 'Qualidade do produto',
  COMPLAINT: 'Reclamação geral',
  OTHER: 'Outro',
};
const STATUS_LABEL: Record<string, string> = {
  OPEN: 'Aberta',
  ANALYZING: 'Em análise',
  RESPONDED: 'Respondida',
  RESOLVED: 'Resolvida',
};
const STATUS_COLOR: Record<string, string> = {
  OPEN: 'bg-red-100 text-red-800',
  ANALYZING: 'bg-yellow-100 text-yellow-800',
  RESPONDED: 'bg-blue-100 text-blue-800',
  RESOLVED: 'bg-green-100 text-green-800',
};

const MAX_PHOTOS = 5;
const MAX_SIZE_MB = 5;
const MAX_WIDTH = 1600;

interface PhotoEntry { base64: string; mime: string; name: string; preview: string; }

// ─── Image compression util ───────────────────────────────────
function compressImage(file: File): Promise<PhotoEntry> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = reject;
    reader.onload = ev => {
      const img = new Image();
      img.onerror = reject;
      img.onload = () => {
        let { width, height } = img;
        if (width > MAX_WIDTH) {
          height = Math.round((height * MAX_WIDTH) / width);
          width = MAX_WIDTH;
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d')!;
        ctx.drawImage(img, 0, 0, width, height);
        const mime = file.type === 'image/png' ? 'image/png' : 'image/jpeg';
        const quality = mime === 'image/png' ? undefined : 0.82;
        const dataUrl = quality ? canvas.toDataURL(mime, quality) : canvas.toDataURL(mime);
        const [header, base64] = dataUrl.split(',');
        const detectedMime = header.match(/:(.*?);/)?.[1] || mime;
        resolve({ base64, mime: detectedMime, name: file.name, preview: dataUrl });
      };
      img.src = ev.target?.result as string;
    };
    reader.readAsDataURL(file);
  });
}

// ─── New Incident Form ─────────────────────────────────────────
function IncidentForm({ onClose, companyId, companyName }: { onClose: () => void; companyId: number; companyName: string }) {
  const { toast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [form, setForm] = useState({ type: '', description: '', contactPhone: '', contactEmail: '' });
  const [photos, setPhotos] = useState<PhotoEntry[]>([]);
  const [compressing, setCompressing] = useState(false);

  const handleFiles = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    const remaining = MAX_PHOTOS - photos.length;
    const toProcess = files.slice(0, remaining);
    if (files.length > remaining) {
      toast({ title: `Máximo de ${MAX_PHOTOS} fotos. Apenas as primeiras ${remaining} foram adicionadas.`, variant: 'destructive' });
    }
    setCompressing(true);
    for (const file of toProcess) {
      if (file.size > MAX_SIZE_MB * 1024 * 1024) {
        toast({ title: `"${file.name}" excede ${MAX_SIZE_MB}MB e foi ignorado.`, variant: 'destructive' });
        continue;
      }
      try {
        const entry = await compressImage(file);
        setPhotos(prev => prev.length < MAX_PHOTOS ? [...prev, entry] : prev);
      } catch {
        toast({ title: `Erro ao processar "${file.name}".`, variant: 'destructive' });
      }
    }
    setCompressing(false);
    if (fileRef.current) fileRef.current.value = '';
  };

  const createMut = useMutation({
    mutationFn: async (data: any) => {
      const res = await fetch('/api/client-incidents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.message || 'Erro ao registrar ocorrência');
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/client-incidents'] });
      toast({ title: 'Ocorrência registrada! Nossa equipe irá analisar em breve.' });
      onClose();
    },
    onError: (err: any) => toast({ title: 'Erro ao registrar', description: err?.message, variant: 'destructive' }),
  });

  const handleSubmit = () => {
    if (!form.type || !form.description.trim()) {
      return toast({ title: 'Preencha o tipo e a descrição.', variant: 'destructive' });
    }
    createMut.mutate({
      companyId,
      companyName,
      ...form,
      photosJson: photos.length > 0 ? JSON.stringify(photos.map(p => ({ base64: p.base64, mime: p.mime, name: p.name }))) : undefined,
      photoBase64: photos[0]?.base64,
      photoMime: photos[0]?.mime,
    });
  };

  return (
    <div className="space-y-4">
      <div>
        <Label>Tipo de ocorrência *</Label>
        <Select value={form.type} onValueChange={v => setForm(p => ({ ...p, type: v }))}>
          <SelectTrigger data-testid="select-incident-type" className="mt-1">
            <SelectValue placeholder="Selecione o tipo" />
          </SelectTrigger>
          <SelectContent>
            {Object.entries(TYPE_LABELS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      <div>
        <Label>Descrição detalhada *</Label>
        <Textarea
          data-testid="input-incident-description"
          value={form.description}
          onChange={e => setForm(p => ({ ...p, description: e.target.value }))}
          placeholder="Descreva o problema com detalhes"
          rows={4}
          className="mt-1"
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label>Contato</Label>
          <Input data-testid="input-incident-phone" value={form.contactPhone} onChange={e => setForm(p => ({ ...p, contactPhone: e.target.value }))} placeholder="(11) 99999-9999" className="mt-1" />
        </div>
        <div>
          <Label>Email</Label>
          <Input data-testid="input-incident-email" type="email" value={form.contactEmail} onChange={e => setForm(p => ({ ...p, contactEmail: e.target.value }))} placeholder="contato@empresa.com" className="mt-1" />
        </div>
      </div>

      {/* Photos */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <Label>Fotos (opcional, máx. {MAX_PHOTOS})</Label>
          <span className="text-xs text-muted-foreground">{photos.length}/{MAX_PHOTOS}</span>
        </div>
        {photos.length > 0 && (
          <div className="grid grid-cols-4 gap-2 mb-2">
            {photos.map((p, idx) => (
              <div key={idx} className="relative group rounded-lg overflow-hidden border border-border aspect-square bg-muted">
                <img src={p.preview} alt={p.name} className="w-full h-full object-cover" />
                <button
                  type="button"
                  onClick={() => setPhotos(prev => prev.filter((_, i) => i !== idx))}
                  data-testid={`button-remove-photo-${idx}`}
                  className="absolute top-1 right-1 w-5 h-5 bg-red-500 hover:bg-red-600 text-white rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
            ))}
          </div>
        )}
        {photos.length < MAX_PHOTOS && (
          <div
            onClick={() => fileRef.current?.click()}
            className="border-2 border-dashed rounded-xl p-4 text-center cursor-pointer hover:border-primary/50 transition-colors"
            data-testid="upload-incident-photo"
          >
            <input ref={fileRef} type="file" accept="image/jpg,image/jpeg,image/png" multiple className="hidden" onChange={handleFiles} />
            <Camera className="w-5 h-5 mx-auto mb-1 text-muted-foreground/60" />
            <p className="text-sm text-muted-foreground">{compressing ? 'Processando...' : photos.length === 0 ? 'Clique para adicionar fotos' : 'Adicionar mais fotos'}</p>
            <p className="text-xs text-muted-foreground/60 mt-0.5">JPG, PNG · máx. {MAX_SIZE_MB}MB cada</p>
          </div>
        )}
      </div>

      <DialogFooter>
        <Button variant="outline" onClick={onClose} disabled={createMut.isPending || compressing}>Cancelar</Button>
        <Button data-testid="button-submit-incident" onClick={handleSubmit} disabled={createMut.isPending || compressing}>
          {createMut.isPending ? 'Enviando...' : 'Registrar Ocorrência'}
        </Button>
      </DialogFooter>
    </div>
  );
}

// ─── Incident Detail Modal (with chat) ────────────────────────
function IncidentDetail({ incident, onClose, companyName }: { incident: ClientIncident; onClose: () => void; companyName: string }) {
  const { toast } = useToast();
  const [newMsg, setNewMsg] = useState('');

  const { data: messages = [], isLoading: msgsLoading } = useQuery<IncidentMessage[]>({
    queryKey: ['/api/client-incidents', incident.id, 'messages'],
    queryFn: async () => {
      const res = await fetch(`/api/client-incidents/${incident.id}/messages`, { credentials: 'include' });
      if (!res.ok) throw new Error('Erro ao carregar mensagens');
      return res.json();
    },
  });

  const sendMut = useMutation({
    mutationFn: async (msg: string) => {
      const res = await fetch(`/api/client-incidents/${incident.id}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ message: msg }),
      });
      if (!res.ok) throw new Error('Erro ao enviar mensagem');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/client-incidents', incident.id, 'messages'] });
      queryClient.invalidateQueries({ queryKey: ['/api/client-incidents'] });
      setNewMsg('');
    },
    onError: () => toast({ title: 'Erro ao enviar mensagem', variant: 'destructive' }),
  });

  let parsedPhotos: Array<{ base64: string; mime: string; name: string }> = [];
  try { if ((incident as any).photosJson) parsedPhotos = JSON.parse((incident as any).photosJson); } catch {}

  return (
    <div className="space-y-4">
      {/* Meta */}
      <div className="grid grid-cols-2 gap-3 text-sm p-3 bg-muted/40 rounded-lg">
        <div><span className="text-muted-foreground text-xs">Tipo</span><p className="font-medium">{TYPE_LABELS[incident.type] || incident.type}</p></div>
        <div><span className="text-muted-foreground text-xs">Status</span>
          <p><span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_COLOR[incident.status]}`}>{STATUS_LABEL[incident.status]}</span></p>
        </div>
        <div><span className="text-muted-foreground text-xs">Abertura</span><p className="font-medium">{new Date(incident.createdAt).toLocaleString('pt-BR')}</p></div>
        <div><span className="text-muted-foreground text-xs">Última atualização</span>
          <p className="font-medium">{(incident as any).updatedAt ? new Date((incident as any).updatedAt).toLocaleString('pt-BR') : '—'}</p>
        </div>
      </div>

      {/* Description */}
      <div>
        <Label className="text-muted-foreground text-xs">Descrição original</Label>
        <div className="mt-1 p-3 bg-muted/30 rounded-lg text-sm">{incident.description}</div>
      </div>

      {/* Attached photos */}
      {(parsedPhotos.length > 0 || incident.photoBase64) && (
        <div>
          <Label className="text-muted-foreground text-xs">Fotos anexadas</Label>
          <div className="flex gap-2 mt-1 flex-wrap">
            {parsedPhotos.length > 0
              ? parsedPhotos.map((ph, i) => (
                <a key={i} href={`data:${ph.mime};base64,${ph.base64}`} target="_blank" rel="noreferrer">
                  <img src={`data:${ph.mime};base64,${ph.base64}`} alt={ph.name} className="w-16 h-16 object-cover rounded-lg border border-border hover:opacity-90 transition-opacity" />
                </a>
              ))
              : <img src={`data:${incident.photoMime};base64,${incident.photoBase64}`} alt="Foto" className="w-16 h-16 object-cover rounded-lg border border-border" />
            }
          </div>
        </div>
      )}

      {/* Chat thread */}
      <div>
        <Label className="text-muted-foreground text-xs">Histórico de mensagens</Label>
        <div className="mt-2 space-y-2 max-h-56 overflow-y-auto border border-border rounded-xl p-3 bg-background">
          {msgsLoading ? (
            <div className="h-8 bg-muted rounded animate-pulse" />
          ) : messages.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">Nenhuma mensagem ainda. Quando nossa equipe responder, aparecerá aqui.</p>
          ) : (
            messages.map(msg => {
              const isAdmin = msg.senderType === 'ADMIN';
              return (
                <div key={msg.id} className={`flex ${isAdmin ? 'justify-start' : 'justify-end'}`}>
                  <div className={`max-w-[80%] p-2.5 rounded-xl text-sm ${isAdmin ? 'bg-blue-50 border border-blue-200 text-blue-900' : 'bg-primary/10 border border-primary/20 text-foreground'}`}>
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className={`text-[11px] font-semibold ${isAdmin ? 'text-blue-700' : 'text-primary'}`}>{msg.senderName}</span>
                      <span className="text-[10px] text-muted-foreground ml-auto">{new Date(msg.createdAt).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}</span>
                    </div>
                    <p className="text-sm">{msg.message}</p>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* Send client message */}
      {incident.status !== 'RESOLVED' && (
        <div className="flex gap-2">
          <Textarea
            value={newMsg}
            onChange={e => setNewMsg(e.target.value)}
            placeholder="Enviar mensagem para a equipe..."
            rows={2}
            className="resize-none flex-1"
            data-testid="input-client-message"
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); if (newMsg.trim()) sendMut.mutate(newMsg); } }}
          />
          <Button
            size="icon"
            data-testid="button-send-client-message"
            onClick={() => { if (newMsg.trim()) sendMut.mutate(newMsg); }}
            disabled={sendMut.isPending || !newMsg.trim()}
            className="self-end h-10 w-10"
          >
            <Send className="w-4 h-4" />
          </Button>
        </div>
      )}

      <DialogFooter>
        <Button variant="outline" onClick={onClose}>Fechar</Button>
      </DialogFooter>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────
export default function ClientIncidentsPage() {
  const { company, isLoading: authLoading } = useAuth();
  const [showForm, setShowForm] = useState(false);
  const [selected, setSelected] = useState<ClientIncident | undefined>();

  const { data: incidents = [], isLoading, isError } = useQuery<ClientIncident[]>({
    queryKey: ['/api/client-incidents'],
  });

  if (!authLoading && !company) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center">
        <div className="w-16 h-16 rounded-2xl bg-orange-100 flex items-center justify-center mb-4 mx-auto text-3xl">⚠️</div>
        <h2 className="text-xl font-bold text-foreground mb-2">Dados da empresa não encontrados.</h2>
        <p className="text-muted-foreground text-sm">Entre em contato com a equipe VivaFrutaz.</p>
      </div>
    );
  }

  const unreadCount = incidents.filter(i => (i as any).hasUnreadAdminReply).length;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold text-foreground">Ocorrências</h1>
            {unreadCount > 0 && (
              <span className="flex items-center gap-1 text-xs bg-blue-100 text-blue-800 px-2 py-0.5 rounded-full font-semibold animate-pulse" data-testid="badge-unread-incidents">
                <Bell className="w-3 h-3" /> {unreadCount} nova{unreadCount > 1 ? 's' : ''}
              </span>
            )}
          </div>
          <p className="text-sm text-muted-foreground mt-1">Registre e acompanhe suas ocorrências</p>
        </div>
        <Button data-testid="button-new-incident" onClick={() => setShowForm(true)} className="gap-2">
          <Plus className="w-4 h-4" /> Registrar Ocorrência
        </Button>
      </div>

      {isLoading ? (
        <div className="space-y-3">{[1,2,3].map(i => <div key={i} className="h-24 bg-muted rounded-xl animate-pulse" />)}</div>
      ) : isError ? (
        <div className="text-center py-16 text-muted-foreground">
          <AlertTriangle className="w-12 h-12 mx-auto mb-3 opacity-30" />
          <p className="font-medium">Dados indisponíveis no momento.</p>
          <p className="text-sm mt-1">Tente novamente em alguns instantes.</p>
        </div>
      ) : incidents.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground">
          <AlertTriangle className="w-12 h-12 mx-auto mb-3 opacity-30" />
          <p className="font-medium">Nenhuma ocorrência registrada</p>
          <p className="text-sm mt-1">Clique em "Registrar Ocorrência" para enviar um problema</p>
        </div>
      ) : (
        <div className="space-y-3">
          {incidents.map(inc => {
            const hasUnread = !!(inc as any).hasUnreadAdminReply;
            let parsedPhotos: any[] = [];
            try { if ((inc as any).photosJson) parsedPhotos = JSON.parse((inc as any).photosJson); } catch {}
            const photoCount = parsedPhotos.length || (inc.photoBase64 ? 1 : 0);

            return (
              <Card
                key={inc.id}
                data-testid={`card-incident-${inc.id}`}
                className={`premium-shadow cursor-pointer hover:shadow-md transition-shadow ${hasUnread ? 'border-blue-300 bg-blue-50/30' : ''}`}
                onClick={() => setSelected(inc)}
              >
                <CardContent className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="space-y-1.5 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-sm text-foreground">{TYPE_LABELS[inc.type] || inc.type}</span>
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_COLOR[inc.status] || 'bg-muted text-muted-foreground'}`}>
                          {STATUS_LABEL[inc.status] || inc.status}
                        </span>
                        {photoCount > 0 && <span className="flex items-center gap-1 text-xs text-muted-foreground"><ImageIcon className="w-3 h-3" /> {photoCount}</span>}
                        {hasUnread && (
                          <span className="flex items-center gap-1 text-xs bg-blue-100 text-blue-800 px-2 py-0.5 rounded-full font-semibold">
                            <Bell className="w-3 h-3" /> Nova resposta
                          </span>
                        )}
                      </div>
                      <p className="text-sm text-muted-foreground line-clamp-1">{inc.description}</p>
                      {(inc as any).responseMessage && (
                        <div className="flex items-start gap-1.5 text-xs text-blue-700">
                          <MessageSquareReply className="w-3 h-3 mt-0.5 shrink-0" />
                          <span className="line-clamp-1">{(inc as any).responseMessage}</span>
                        </div>
                      )}
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="text-xs text-muted-foreground">{new Date(inc.createdAt).toLocaleDateString('pt-BR')}</p>
                      <p className="text-xs text-muted-foreground font-mono">#{inc.id.toString().padStart(4, '0')}</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* New Incident Form Dialog */}
      <Dialog open={showForm} onOpenChange={setShowForm}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Registrar Ocorrência</DialogTitle>
          </DialogHeader>
          {company && <IncidentForm onClose={() => setShowForm(false)} companyId={company.id} companyName={company.companyName} />}
        </DialogContent>
      </Dialog>

      {/* Incident Detail Dialog */}
      <Dialog open={!!selected} onOpenChange={() => setSelected(undefined)}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Ocorrência #{selected?.id?.toString().padStart(4, '0')}</DialogTitle>
          </DialogHeader>
          {selected && company && (
            <IncidentDetail
              incident={selected}
              companyName={company.companyName}
              onClose={() => {
                setSelected(undefined);
                queryClient.invalidateQueries({ queryKey: ['/api/client-incidents'] });
              }}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
