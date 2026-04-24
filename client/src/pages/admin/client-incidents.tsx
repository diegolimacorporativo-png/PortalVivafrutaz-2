import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { useAuth } from '@/hooks/use-auth';
import { queryClient, apiRequest } from '@/lib/queryClient';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { AlertTriangle, Eye, ImageIcon, MessageSquareReply, Send, Building2, Download, Trash2 } from 'lucide-react';
import type { ClientIncident, IncidentMessage } from '@shared/schema';
import { downloadIncidentPdf } from '@/lib/incident-pdf-generator';

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

function IncidentDetail({ incident, onClose }: { incident: ClientIncident; onClose: () => void }) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [status, setStatus] = useState(incident.status);
  const [adminNote, setAdminNote] = useState(incident.adminNote || '');
  const [newMsg, setNewMsg] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Parse photos
  let parsedPhotos: Array<{ base64: string; mime: string; name: string }> = [];
  try { if ((incident as any).photosJson) parsedPhotos = JSON.parse((incident as any).photosJson); } catch {}

  const { data: messages = [], isLoading: msgsLoading } = useQuery<IncidentMessage[]>({
    queryKey: ['/api/client-incidents', incident.id, 'messages'],
    queryFn: async () => {
      const res = await fetch(`/api/client-incidents/${incident.id}/messages`, { credentials: 'include' });
      if (!res.ok) throw new Error('Erro ao carregar mensagens');
      return res.json();
    },
  });

  const updateMut = useMutation({
    mutationFn: (data: any) => apiRequest('PATCH', `/api/client-incidents/${incident.id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/client-incidents'] });
      toast({ title: 'Ocorrência atualizada!' });
    },
    onError: () => toast({ title: 'Erro ao atualizar', variant: 'destructive' }),
  });

  const deleteMut = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/client-incidents/${incident.id}`, { method: 'DELETE', credentials: 'include' });
      if (!res.ok) throw new Error('Erro ao excluir');
      return res;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/client-incidents'] });
      toast({ title: 'Ocorrência excluída com sucesso!' });
      onClose();
    },
    onError: (err: any) => toast({ title: 'Erro', description: err.message, variant: 'destructive' }),
  });

  const sendMut = useMutation({
    mutationFn: async (msg: string) => {
      const res = await fetch(`/api/client-incidents/${incident.id}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ message: msg }),
      });
      if (!res.ok) throw new Error('Erro');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/client-incidents', incident.id, 'messages'] });
      queryClient.invalidateQueries({ queryKey: ['/api/client-incidents'] });
      setNewMsg('');
      toast({ title: 'Mensagem enviada ao cliente!' });
    },
    onError: () => toast({ title: 'Erro ao enviar mensagem', variant: 'destructive' }),
  });

  // Also use old respond endpoint for backward compat
  const respondMut = useMutation({
    mutationFn: (data: any) => apiRequest('POST', `/api/client-incidents/${incident.id}/respond`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/client-incidents'] });
      queryClient.invalidateQueries({ queryKey: ['/api/client-incidents', incident.id, 'messages'] });
      setNewMsg('');
    },
    onError: () => toast({ title: 'Erro ao responder', variant: 'destructive' }),
  });

  const handleSend = () => {
    if (!newMsg.trim()) return;
    sendMut.mutate(newMsg);
  };

  return (
    <div className="space-y-4">
      {/* Meta */}
      <div className="grid grid-cols-2 gap-3 text-sm">
        <div><span className="text-muted-foreground text-xs">Empresa</span><p className="font-semibold flex items-center gap-1"><Building2 className="w-3.5 h-3.5" />{incident.companyName}</p></div>
        <div><span className="text-muted-foreground text-xs">Tipo</span><p className="font-semibold">{TYPE_LABELS[incident.type] || incident.type}</p></div>
        <div><span className="text-muted-foreground text-xs">Contato</span><p>{incident.contactPhone || '—'}</p></div>
        <div><span className="text-muted-foreground text-xs">Email</span><p>{incident.contactEmail || '—'}</p></div>
        <div className="col-span-2"><span className="text-muted-foreground text-xs">Abertura</span><p>{new Date(incident.createdAt).toLocaleString('pt-BR')}</p></div>
      </div>

      {/* Description */}
      <div>
        <Label className="text-muted-foreground text-xs">Descrição do cliente</Label>
        <div className="mt-1 p-3 bg-muted/40 rounded-lg text-sm">{incident.description}</div>
      </div>

      {/* Photos gallery */}
      {(parsedPhotos.length > 0 || incident.photoBase64) && (
        <div>
          <Label className="text-muted-foreground text-xs">Fotos anexadas ({parsedPhotos.length || 1})</Label>
          <div className="flex gap-2 mt-1 flex-wrap">
            {parsedPhotos.length > 0
              ? parsedPhotos.map((ph, i) => (
                <a key={i} href={`data:${ph.mime};base64,${ph.base64}`} target="_blank" rel="noreferrer">
                  <img src={`data:${ph.mime};base64,${ph.base64}`} alt={ph.name || `Foto ${i+1}`} className="w-20 h-20 object-cover rounded-lg border border-border hover:opacity-80 transition-opacity cursor-zoom-in" />
                </a>
              ))
              : <img src={`data:${incident.photoMime};base64,${incident.photoBase64}`} alt="Foto" className="w-20 h-20 object-cover rounded-lg border border-border" />
            }
          </div>
        </div>
      )}

      {/* Chat Thread */}
      <div>
        <Label className="text-muted-foreground text-xs">Histórico de mensagens</Label>
        <div className="mt-2 space-y-2 max-h-52 overflow-y-auto border border-border rounded-xl p-3 bg-background">
          {msgsLoading ? (
            <div className="h-8 bg-muted rounded animate-pulse" />
          ) : messages.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-3">Nenhuma mensagem ainda. Use o campo abaixo para responder ao cliente.</p>
          ) : (
            messages.map(msg => {
              const isAdmin = msg.senderType === 'ADMIN';
              return (
                <div key={msg.id} className={`flex ${isAdmin ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-[80%] p-2.5 rounded-xl text-sm ${isAdmin ? 'bg-green-50 border border-green-200 text-green-900' : 'bg-muted border border-border text-foreground'}`}>
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className={`text-[11px] font-semibold ${isAdmin ? 'text-green-700' : 'text-muted-foreground'}`}>{msg.senderName}</span>
                      <span className="text-[10px] text-muted-foreground ml-auto">{new Date(msg.createdAt).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}</span>
                    </div>
                    <p>{msg.message}</p>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Send message */}
        <div className="flex gap-2 mt-2">
          <Textarea
            value={newMsg}
            onChange={e => setNewMsg(e.target.value)}
            placeholder="Responder ao cliente (visível no portal do cliente)..."
            rows={2}
            className="resize-none flex-1 text-sm"
            data-testid="input-response-message"
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
          />
          <Button
            size="icon"
            data-testid="button-send-response"
            onClick={handleSend}
            disabled={sendMut.isPending || !newMsg.trim()}
            className="self-end h-10 w-10 bg-primary"
          >
            <Send className="w-4 h-4" />
          </Button>
        </div>
      </div>

      {/* Status + Note */}
      <div className="border-t pt-4 space-y-3">
        <div>
          <Label>Status da ocorrência</Label>
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger data-testid="select-incident-status" className="mt-1">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="OPEN">Aberta</SelectItem>
              <SelectItem value="ANALYZING">Em análise</SelectItem>
              <SelectItem value="RESPONDED">Respondida</SelectItem>
              <SelectItem value="RESOLVED">Resolvida</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label>Nota interna (não visível ao cliente)</Label>
          <Textarea
            data-testid="input-admin-note"
            value={adminNote}
            onChange={e => setAdminNote(e.target.value)}
            placeholder="Notas internas sobre esta ocorrência..."
            rows={2}
            className="mt-1"
          />
        </div>
      </div>

      <DialogFooter className="flex justify-between">
        <div className="flex gap-2">
          <Button 
            variant="outline" 
            size="sm"
            onClick={() => downloadIncidentPdf({
              id: incident.id,
              companyName: incident.companyName,
              type: incident.type,
              status: incident.status,
              description: incident.description,
              createdAt: incident.createdAt.toISOString(),
              responseMessage: incident.responseMessage || undefined,
              respondedByName: incident.respondedByName || undefined,
              respondedAt: incident.respondedAt ? new Date(incident.respondedAt).toISOString() : undefined,
              adminNote: incident.adminNote || undefined
            })}
            data-testid="button-download-incident-pdf"
          >
            <Download className="w-4 h-4 mr-1" /> PDF
          </Button>
          {user?.role && ['ADMIN', 'DIRECTOR', 'DEVELOPER'].includes(user.role) && (
            <Button 
              variant="destructive" 
              size="sm"
              onClick={() => setConfirmDelete(true)}
              disabled={deleteMut.isPending}
              data-testid="button-delete-incident"
            >
              <Trash2 className="w-4 h-4 mr-1" /> Excluir
            </Button>
          )}
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={onClose}>Fechar</Button>
          <Button
            data-testid="button-save-incident"
            onClick={() => updateMut.mutate({ status, adminNote, resolvedAt: status === 'RESOLVED' ? new Date().toISOString() : undefined })}
            disabled={updateMut.isPending}
          >
            {updateMut.isPending ? 'Salvando...' : 'Salvar'}
          </Button>
        </div>
      </DialogFooter>

      {/* Delete confirmation */}
      <Dialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="text-red-600">Excluir Ocorrência #{incident.id}</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-gray-600">Tem certeza que deseja excluir esta ocorrência? Esta ação é irreversível.</p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmDelete(false)}>Cancelar</Button>
            <Button variant="destructive" onClick={() => deleteMut.mutate()} disabled={deleteMut.isPending} data-testid="button-confirm-delete">
              {deleteMut.isPending ? 'Excluindo...' : 'Excluir Permanentemente'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default function AdminClientIncidentsPage() {
  const [selected, setSelected] = useState<ClientIncident | undefined>();
  const [filterStatus, setFilterStatus] = useState('ALL');

  const { data: incidents = [], isLoading } = useQuery<ClientIncident[]>({
    queryKey: ['/api/client-incidents'],
  });

  const filtered = filterStatus === 'ALL' ? incidents : incidents.filter(i => i.status === filterStatus);
  const openCount = incidents.filter(i => i.status === 'OPEN').length;
  const respondedCount = incidents.filter(i => i.status === 'RESPONDED').length;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Ocorrências de Clientes</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {openCount > 0
              ? <span className="text-red-600 font-medium">{openCount} em aberto</span>
              : 'Nenhuma em aberto'}
            {respondedCount > 0 && <span className="text-blue-600 font-medium ml-3">{respondedCount} respondida(s)</span>}
          </p>
        </div>
        <Select value={filterStatus} onValueChange={setFilterStatus}>
          <SelectTrigger className="w-48" data-testid="select-filter-status">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">Todas</SelectItem>
            <SelectItem value="OPEN">Abertas</SelectItem>
            <SelectItem value="ANALYZING">Em análise</SelectItem>
            <SelectItem value="RESPONDED">Respondidas</SelectItem>
            <SelectItem value="RESOLVED">Resolvidas</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <div className="space-y-3">{[1,2,3].map(i => <div key={i} className="h-20 bg-muted rounded-xl animate-pulse" />)}</div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground">
          <AlertTriangle className="w-12 h-12 mx-auto mb-3 opacity-30" />
          <p className="font-medium">Nenhuma ocorrência encontrada</p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map(inc => {
            let parsedPhotos: any[] = [];
            try { if ((inc as any).photosJson) parsedPhotos = JSON.parse((inc as any).photosJson); } catch {}
            const photoCount = parsedPhotos.length || (inc.photoBase64 ? 1 : 0);

            return (
              <Card key={inc.id} data-testid={`card-client-incident-${inc.id}`} className="premium-shadow hover:shadow-md transition-shadow cursor-pointer" onClick={() => setSelected(inc)}>
                <CardContent className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 space-y-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-sm">{inc.companyName}</span>
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_COLOR[inc.status] || 'bg-muted'}`}>
                          {STATUS_LABEL[inc.status] || inc.status}
                        </span>
                        <span className="text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground">
                          {TYPE_LABELS[inc.type] || inc.type}
                        </span>
                        {photoCount > 0 && (
                          <span className="flex items-center gap-1 text-xs text-muted-foreground">
                            <ImageIcon className="w-3 h-3" /> {photoCount} foto{photoCount > 1 ? 's' : ''}
                          </span>
                        )}
                        {(inc as any).responseMessage && (
                          <span className="flex items-center gap-1 text-xs text-blue-600">
                            <MessageSquareReply className="w-3 h-3" /> Com resposta
                          </span>
                        )}
                      </div>
                      <p className="text-sm text-muted-foreground line-clamp-1">{inc.description}</p>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="text-xs text-muted-foreground">{new Date(inc.createdAt).toLocaleDateString('pt-BR')}</p>
                      <Button data-testid={`button-view-incident-${inc.id}`} size="sm" variant="ghost" className="h-7 px-2 mt-1" onClick={e => { e.stopPropagation(); setSelected(inc); }}>
                        <Eye className="w-3.5 h-3.5 mr-1" /> Ver
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <Dialog open={!!selected} onOpenChange={() => setSelected(undefined)}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Ocorrência #{selected?.id?.toString().padStart(4, '0')}</DialogTitle>
          </DialogHeader>
          {selected && (
            <IncidentDetail
              incident={selected}
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
