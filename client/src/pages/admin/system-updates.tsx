import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { queryClient, apiRequest } from '@/lib/queryClient';
import { useToast } from '@/hooks/use-toast';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Checkbox } from '@/components/ui/checkbox';
import {
  RefreshCw, GitBranch, Upload, History, FlaskConical,
  Plus, Pencil, Trash2, CheckCircle2, AlertTriangle, RotateCcw,
  Zap, Globe, Building2, ChevronRight,
} from 'lucide-react';

const TABS = [
  { id: 'versions', label: 'Versões', icon: GitBranch },
  { id: 'publish', label: 'Publicar', icon: Upload },
  { id: 'history', label: 'Histórico', icon: History },
  { id: 'beta', label: 'Beta Testers', icon: FlaskConical },
];

function TypeBadge({ tipo }: { tipo: string }) {
  const map: Record<string, { label: string; className: string }> = {
    stable: { label: 'Stable', className: 'bg-green-100 text-green-800 border-green-200' },
    beta: { label: 'Beta', className: 'bg-purple-100 text-purple-800 border-purple-200' },
    hotfix: { label: 'Hotfix', className: 'bg-orange-100 text-orange-800 border-orange-200' },
  };
  const s = map[tipo] ?? { label: tipo, className: 'bg-gray-100 text-gray-700 border-gray-200' };
  return <Badge className={`text-xs border ${s.className}`}>{s.label}</Badge>;
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; className: string }> = {
    ativa: { label: 'Ativa', className: 'bg-green-100 text-green-800 border-green-200' },
    inativa: { label: 'Inativa', className: 'bg-gray-100 text-gray-700 border-gray-200' },
    aplicado: { label: 'Aplicado', className: 'bg-green-100 text-green-800 border-green-200' },
    pendente: { label: 'Pendente', className: 'bg-yellow-100 text-yellow-800 border-yellow-200' },
    erro: { label: 'Erro', className: 'bg-red-100 text-red-800 border-red-200' },
    rollback: { label: 'Rollback', className: 'bg-orange-100 text-orange-800 border-orange-200' },
  };
  const s = map[status] ?? { label: status, className: 'bg-gray-100 text-gray-700 border-gray-200' };
  return <Badge className={`text-xs border ${s.className}`}>{s.label}</Badge>;
}

function VersionsTab() {
  const { toast } = useToast();
  const { data: versions = [], isLoading } = useQuery<any[]>({ queryKey: ['/api/system/versions'] });
  const { data: currentVersion } = useQuery<any>({ queryKey: ['/api/system/versions/current'] });
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [form, setForm] = useState({ versionName: '', descricao: '', changelog: '', tipoVersao: 'stable', status: 'ativa' });

  const createMut = useMutation({
    mutationFn: (data: any) => apiRequest('POST', '/api/system/versions', data),
    onSuccess: () => {
      toast({ title: 'Versão criada com sucesso' });
      queryClient.invalidateQueries({ queryKey: ['/api/system/versions'] });
      setShowForm(false);
      setForm({ versionName: '', descricao: '', changelog: '', tipoVersao: 'stable', status: 'ativa' });
    },
    onError: (e: any) => toast({ title: 'Erro', description: e.message, variant: 'destructive' }),
  });

  const updateMut = useMutation({
    mutationFn: ({ id, data }: any) => apiRequest('PATCH', `/api/system/versions/${id}`, data),
    onSuccess: () => {
      toast({ title: 'Versão atualizada' });
      queryClient.invalidateQueries({ queryKey: ['/api/system/versions'] });
      setShowForm(false);
      setEditing(null);
    },
  });

  const deleteMut = useMutation({
    mutationFn: (id: number) => apiRequest('DELETE', `/api/system/versions/${id}`, {}),
    onSuccess: () => {
      toast({ title: 'Versão removida' });
      queryClient.invalidateQueries({ queryKey: ['/api/system/versions'] });
    },
  });

  function openEdit(v: any) {
    setEditing(v);
    setForm({ versionName: v.versionName, descricao: v.descricao ?? '', changelog: v.changelog ?? '', tipoVersao: v.tipoVersao, status: v.status });
    setShowForm(true);
  }

  function openNew() {
    setEditing(null);
    setForm({ versionName: '', descricao: '', changelog: '', tipoVersao: 'stable', status: 'ativa' });
    setShowForm(true);
  }

  return (
    <div className="space-y-4">
      {currentVersion && (
        <div className="p-3 rounded-xl bg-green-50 border border-green-200 flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-green-600 shrink-0" />
          <span className="text-sm text-green-800">Versão ativa estável: <strong>{currentVersion.versionName}</strong> — {currentVersion.descricao}</span>
        </div>
      )}

      <div className="flex justify-between items-center">
        <p className="text-sm text-muted-foreground">{versions.length} versão(ões) cadastrada(s)</p>
        <Button type="button" size="sm" onClick={openNew} data-testid="button-new-version">
          <Plus className="w-4 h-4 mr-1" /> Nova Versão
        </Button>
      </div>

      {isLoading ? (
        <div className="text-center py-8 text-muted-foreground">Carregando versões...</div>
      ) : (
        <div className="space-y-3">
          {versions.map((v: any) => (
            <Card key={v.id} className="border border-border/50" data-testid={`card-version-${v.id}`}>
              <CardContent className="pt-4 pb-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center shrink-0">
                      <GitBranch className="w-5 h-5 text-blue-600" />
                    </div>
                    <div>
                      <div className="flex items-center gap-2 mb-1">
                        <span className="font-semibold text-sm">{v.versionName}</span>
                        <TypeBadge tipo={v.tipoVersao} />
                        <StatusBadge status={v.status} />
                      </div>
                      <p className="text-xs text-muted-foreground">{v.descricao}</p>
                      {v.changelog && (
                        <p className="text-xs text-muted-foreground mt-1 italic">{v.changelog}</p>
                      )}
                      <p className="text-xs text-muted-foreground mt-1">
                        Lançamento: {new Date(v.dataLancamento).toLocaleDateString('pt-BR')}
                        {v.criadoPor && ` · Criado por ${v.criadoPor}`}
                      </p>
                    </div>
                  </div>
                  <div className="flex gap-1 shrink-0">
                    <Button type="button" variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => openEdit(v)} data-testid={`button-edit-version-${v.id}`}>
                      <Pencil className="w-3 h-3" />
                    </Button>
                    <Button type="button" variant="ghost" size="sm" className="h-7 w-7 p-0 text-red-500 hover:text-red-700" onClick={() => deleteMut.mutate(v.id)} data-testid={`button-delete-version-${v.id}`}>
                      <Trash2 className="w-3 h-3" />
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
          {versions.length === 0 && <div className="text-center py-8 text-muted-foreground">Nenhuma versão cadastrada</div>}
        </div>
      )}

      <Dialog open={showForm} onOpenChange={setShowForm}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editing ? 'Editar Versão' : 'Nova Versão do Sistema'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Nome da Versão *</Label>
              <Input value={form.versionName} onChange={e => setForm(f => ({ ...f, versionName: e.target.value }))} placeholder="Ex: v2.5.0" data-testid="input-version-name" />
            </div>
            <div>
              <Label>Descrição</Label>
              <Input value={form.descricao} onChange={e => setForm(f => ({ ...f, descricao: e.target.value }))} placeholder="Resumo desta versão" data-testid="input-version-desc" />
            </div>
            <div>
              <Label>Changelog / Melhorias</Label>
              <Textarea value={form.changelog} onChange={e => setForm(f => ({ ...f, changelog: e.target.value }))} placeholder="Liste as melhorias, correções e novidades desta versão..." className="text-sm h-24" data-testid="input-version-changelog" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Tipo de Versão</Label>
                <Select value={form.tipoVersao} onValueChange={v => setForm(f => ({ ...f, tipoVersao: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="stable">Stable</SelectItem>
                    <SelectItem value="beta">Beta</SelectItem>
                    <SelectItem value="hotfix">Hotfix</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Status</Label>
                <Select value={form.status} onValueChange={v => setForm(f => ({ ...f, status: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ativa">Ativa</SelectItem>
                    <SelectItem value="inativa">Inativa</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="flex gap-2 pt-2">
              <Button type="button" variant="outline" className="flex-1" onClick={() => setShowForm(false)}>Cancelar</Button>
              <Button
                type="button"
                className="flex-1"
                disabled={createMut.isPending || updateMut.isPending || !form.versionName}
                onClick={() => {
                  if (editing) updateMut.mutate({ id: editing.id, data: form });
                  else createMut.mutate(form);
                }}
                data-testid="button-save-version"
              >
                {(createMut.isPending || updateMut.isPending) ? 'Salvando...' : 'Salvar'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function PublishTab() {
  const { toast } = useToast();
  const { data: versions = [] } = useQuery<any[]>({ queryKey: ['/api/system/versions'] });
  const { data: companies = [] } = useQuery<any[]>({ queryKey: ['/api/companies'] });
  const [selectedVersion, setSelectedVersion] = useState('');
  const [aplicarTodas, setAplicarTodas] = useState(true);
  const [selectedEmpresas, setSelectedEmpresas] = useState<number[]>([]);
  const [result, setResult] = useState<any>(null);

  const activeVersions = (versions as any[]).filter(v => v.status === 'ativa');
  const selectedVersionObj = (versions as any[]).find(v => v.id === parseInt(selectedVersion));

  const applyMut = useMutation({
    mutationFn: (data: any) => apiRequest('POST', '/api/system/apply-update', data),
    onSuccess: async (res) => {
      const data = await res.json();
      setResult(data);
      toast({ title: 'Atualização aplicada!', description: data.message });
      queryClient.invalidateQueries({ queryKey: ['/api/system/update-logs'] });
      queryClient.invalidateQueries({ queryKey: ['/api/companies'] });
    },
    onError: (e: any) => toast({ title: 'Erro', description: e.message, variant: 'destructive' }),
  });

  function toggleEmpresa(id: number) {
    setSelectedEmpresas(prev =>
      prev.includes(id) ? prev.filter(e => e !== id) : [...prev, id]
    );
  }

  const eligibleCompanies = (companies as any[]).filter(c => {
    if (selectedVersionObj?.tipoVersao === 'beta') return c.betaTester;
    return true;
  });

  return (
    <div className="space-y-5">
      {/* Seleção de versão */}
      <Card className="border border-border/50">
        <CardHeader className="pb-3"><CardTitle className="text-sm">1. Selecionar Versão</CardTitle></CardHeader>
        <CardContent>
          <Select value={selectedVersion} onValueChange={setSelectedVersion}>
            <SelectTrigger data-testid="select-version-publish"><SelectValue placeholder="Escolha a versão a publicar" /></SelectTrigger>
            <SelectContent>
              {activeVersions.map((v: any) => (
                <SelectItem key={v.id} value={String(v.id)}>
                  {v.versionName} ({v.tipoVersao}) — {v.descricao ?? 'Sem descrição'}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {selectedVersionObj && (
            <div className="mt-3 p-3 rounded-lg bg-muted/50 text-xs text-muted-foreground">
              <div className="flex items-center gap-2 mb-1">
                <TypeBadge tipo={selectedVersionObj.tipoVersao} />
                <span className="font-medium">{selectedVersionObj.versionName}</span>
              </div>
              {selectedVersionObj.changelog && <p>{selectedVersionObj.changelog}</p>}
              {selectedVersionObj.tipoVersao === 'beta' && (
                <p className="mt-1 text-purple-700 font-medium">⚡ Versão beta — disponível apenas para empresas Beta Tester</p>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Seleção de empresas */}
      <Card className="border border-border/50">
        <CardHeader className="pb-3"><CardTitle className="text-sm">2. Selecionar Empresas</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center gap-3">
            <Button
              type="button"
              variant={aplicarTodas ? 'default' : 'outline'}
              size="sm"
              className="flex-1 flex items-center gap-2"
              onClick={() => setAplicarTodas(true)}
              data-testid="button-aplicar-todas"
            >
              <Globe className="w-4 h-4" />
              Todas as Empresas
            </Button>
            <Button
              type="button"
              variant={!aplicarTodas ? 'default' : 'outline'}
              size="sm"
              className="flex-1 flex items-center gap-2"
              onClick={() => setAplicarTodas(false)}
              data-testid="button-aplicar-seletiva"
            >
              <Building2 className="w-4 h-4" />
              Selecionar Empresas
            </Button>
          </div>

          {!aplicarTodas && (
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {eligibleCompanies.map((c: any) => (
                <div key={c.id} className="flex items-center gap-2 p-2 rounded-lg hover:bg-muted/30" data-testid={`checkbox-empresa-${c.id}`}>
                  <Checkbox
                    id={`emp-${c.id}`}
                    checked={selectedEmpresas.includes(c.id)}
                    onCheckedChange={() => toggleEmpresa(c.id)}
                  />
                  <label htmlFor={`emp-${c.id}`} className="flex items-center gap-2 text-sm cursor-pointer flex-1">
                    <Building2 className="w-3 h-3 text-muted-foreground" />
                    {c.name ?? c.companyName}
                    {c.betaTester && <Badge className="text-xs bg-purple-100 text-purple-800 border-purple-200 border">Beta</Badge>}
                    {c.currentVersion && <span className="text-xs text-muted-foreground">v{c.currentVersion}</span>}
                  </label>
                </div>
              ))}
              {eligibleCompanies.length === 0 && (
                <p className="text-sm text-muted-foreground text-center py-4">
                  {selectedVersionObj?.tipoVersao === 'beta' ? 'Nenhuma empresa Beta Tester encontrada' : 'Nenhuma empresa cadastrada'}
                </p>
              )}
            </div>
          )}

          {aplicarTodas && selectedVersionObj && (
            <p className="text-sm text-muted-foreground">
              Esta atualização será aplicada para <strong>{eligibleCompanies.length}</strong> empresa(s).
              {selectedVersionObj.tipoVersao === 'beta' && ' (Somente Beta Testers)'}
            </p>
          )}
        </CardContent>
      </Card>

      {/* Botão de publicar */}
      <Button
        type="button"
        className="w-full flex items-center gap-2 h-11"
        disabled={!selectedVersion || applyMut.isPending || (!aplicarTodas && selectedEmpresas.length === 0)}
        onClick={() => applyMut.mutate({
          versionId: parseInt(selectedVersion),
          aplicarTodas,
          empresaIds: aplicarTodas ? [] : selectedEmpresas,
        })}
        data-testid="button-publish-update"
      >
        <Zap className="w-4 h-4" />
        {applyMut.isPending ? 'Aplicando atualização...' : 'Publicar Atualização'}
      </Button>

      {/* Resultado */}
      {result && (
        <div className="p-4 rounded-xl bg-muted/50 border border-border/50">
          <p className="text-sm font-medium mb-3">{result.message}</p>
          <div className="space-y-1 max-h-48 overflow-y-auto">
            {(result.results ?? []).map((r: any, i: number) => {
              const emp = (companies as any[]).find(c => c.id === r.empresaId);
              return (
                <div key={i} className="flex items-center gap-2 text-xs">
                  {r.status === 'ok'
                    ? <CheckCircle2 className="w-3 h-3 text-green-500" />
                    : <AlertTriangle className="w-3 h-3 text-red-500" />
                  }
                  <span>{emp?.name ?? `Empresa #${r.empresaId}`}</span>
                  {r.message && <span className="text-muted-foreground">— {r.message}</span>}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function HistoryTab() {
  const { data: logs = [], isLoading } = useQuery<any[]>({ queryKey: ['/api/system/update-logs'] });
  const { data: companies = [] } = useQuery<any[]>({ queryKey: ['/api/companies'] });
  const { toast } = useToast();
  const [showRollback, setShowRollback] = useState(false);
  const [rollbackForm, setRollbackForm] = useState({ empresaId: '', versionName: '' });

  const rollbackMut = useMutation({
    mutationFn: (data: any) => apiRequest('POST', '/api/system/rollback', data),
    onSuccess: async (res) => {
      const data = await res.json();
      toast({ title: 'Rollback executado', description: data.message });
      queryClient.invalidateQueries({ queryKey: ['/api/system/update-logs'] });
      setShowRollback(false);
    },
    onError: (e: any) => toast({ title: 'Erro', description: e.message, variant: 'destructive' }),
  });

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <p className="text-sm text-muted-foreground">{logs.length} registro(s)</p>
        <Button type="button" variant="outline" size="sm" onClick={() => setShowRollback(true)} className="border-orange-200 text-orange-700 hover:bg-orange-50" data-testid="button-rollback">
          <RotateCcw className="w-4 h-4 mr-1" />
          Rollback
        </Button>
      </div>

      {isLoading ? (
        <div className="text-center py-8 text-muted-foreground">Carregando histórico...</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border/30">
                <th className="text-left py-2 pr-4 font-medium text-muted-foreground">Empresa</th>
                <th className="text-left py-2 pr-4 font-medium text-muted-foreground">Versão</th>
                <th className="text-left py-2 pr-4 font-medium text-muted-foreground">Data</th>
                <th className="text-left py-2 pr-4 font-medium text-muted-foreground">Status</th>
                <th className="text-left py-2 font-medium text-muted-foreground">Operador</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((l: any) => {
                const emp = (companies as any[]).find(c => c.id === l.empresaId);
                return (
                  <tr key={l.id} className="border-b border-border/20 hover:bg-muted/30" data-testid={`row-log-${l.id}`}>
                    <td className="py-2 pr-4 font-medium">{emp?.name ?? (l.empresaId ? `Empresa #${l.empresaId}` : 'Global')}</td>
                    <td className="py-2 pr-4 text-muted-foreground font-mono text-xs">{l.versao}</td>
                    <td className="py-2 pr-4 text-muted-foreground text-xs">{new Date(l.dataAtualizacao).toLocaleString('pt-BR')}</td>
                    <td className="py-2 pr-4"><StatusBadge status={l.status} /></td>
                    <td className="py-2 text-xs text-muted-foreground">{l.operador ?? '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {logs.length === 0 && <div className="text-center py-8 text-muted-foreground">Nenhum registro de atualização</div>}
        </div>
      )}

      <Dialog open={showRollback} onOpenChange={setShowRollback}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle className="flex items-center gap-2"><RotateCcw className="w-4 h-4 text-orange-500" />Rollback de Versão</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">Restaura uma empresa para uma versão anterior específica.</p>
            <div>
              <Label>Empresa *</Label>
              <Select value={rollbackForm.empresaId} onValueChange={v => setRollbackForm(f => ({ ...f, empresaId: v }))}>
                <SelectTrigger data-testid="select-empresa-rollback"><SelectValue placeholder="Selecionar empresa" /></SelectTrigger>
                <SelectContent>
                  {(companies as any[]).map(c => <SelectItem key={c.id} value={String(c.id)}>{c.name ?? c.companyName}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Versão para Restaurar *</Label>
              <Input value={rollbackForm.versionName} onChange={e => setRollbackForm(f => ({ ...f, versionName: e.target.value }))} placeholder="Ex: v2.4.1" data-testid="input-rollback-version" />
            </div>
            <div className="flex gap-2 pt-2">
              <Button type="button" variant="outline" className="flex-1" onClick={() => setShowRollback(false)}>Cancelar</Button>
              <Button
                type="button"
                className="flex-1 bg-orange-600 hover:bg-orange-700"
                disabled={rollbackMut.isPending || !rollbackForm.empresaId || !rollbackForm.versionName}
                onClick={() => rollbackMut.mutate({ empresaId: parseInt(rollbackForm.empresaId), versionName: rollbackForm.versionName })}
                data-testid="button-confirm-rollback"
              >
                {rollbackMut.isPending ? 'Executando...' : 'Executar Rollback'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function BetaTab() {
  const { toast } = useToast();
  const { data: companies = [], isLoading } = useQuery<any[]>({ queryKey: ['/api/companies'] });

  const toggleBetaMut = useMutation({
    mutationFn: ({ id, betaTester }: any) => apiRequest('PUT', `/api/companies/${id}`, { betaTester }),
    onSuccess: () => {
      toast({ title: 'Configuração Beta atualizada' });
      queryClient.invalidateQueries({ queryKey: ['/api/companies'] });
    },
  });

  const betaTesters = (companies as any[]).filter(c => c.betaTester);
  const regular = (companies as any[]).filter(c => !c.betaTester);

  return (
    <div className="space-y-5">
      <div className="p-3 rounded-xl bg-purple-50 border border-purple-200">
        <p className="text-sm text-purple-800">
          <strong>{betaTesters.length}</strong> empresa(s) são Beta Testers e recebem versões beta antes do lançamento oficial.
        </p>
      </div>

      <div>
        <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
          <FlaskConical className="w-4 h-4 text-purple-600" /> Beta Testers Ativos
        </h3>
        {isLoading ? (
          <div className="text-center py-4 text-muted-foreground">Carregando...</div>
        ) : betaTesters.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-4">Nenhuma empresa Beta Tester</p>
        ) : (
          <div className="space-y-2">
            {betaTesters.map((c: any) => (
              <div key={c.id} className="flex items-center justify-between p-3 rounded-lg bg-purple-50 border border-purple-200" data-testid={`row-beta-${c.id}`}>
                <div className="flex items-center gap-2">
                  <FlaskConical className="w-4 h-4 text-purple-600" />
                  <div>
                    <p className="text-sm font-medium">{c.name ?? c.companyName}</p>
                    {c.currentVersion && <p className="text-xs text-muted-foreground">v{c.currentVersion}</p>}
                  </div>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="border-red-200 text-red-700 hover:bg-red-50 text-xs"
                  onClick={() => toggleBetaMut.mutate({ id: c.id, betaTester: false })}
                  data-testid={`button-remove-beta-${c.id}`}
                >
                  Remover Beta
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div>
        <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
          <Building2 className="w-4 h-4 text-muted-foreground" /> Outras Empresas
        </h3>
        <div className="space-y-2 max-h-72 overflow-y-auto">
          {regular.map((c: any) => (
            <div key={c.id} className="flex items-center justify-between p-3 rounded-lg hover:bg-muted/30 border border-border/30" data-testid={`row-regular-${c.id}`}>
              <div className="flex items-center gap-2">
                <Building2 className="w-4 h-4 text-muted-foreground" />
                <div>
                  <p className="text-sm font-medium">{c.name ?? c.companyName}</p>
                  {c.currentVersion && <p className="text-xs text-muted-foreground">v{c.currentVersion}</p>}
                </div>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="border-purple-200 text-purple-700 hover:bg-purple-50 text-xs"
                onClick={() => toggleBetaMut.mutate({ id: c.id, betaTester: true })}
                data-testid={`button-add-beta-${c.id}`}
              >
                <ChevronRight className="w-3 h-3 mr-1" />
                Tornar Beta
              </Button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function SystemUpdates() {
  const [tab, setTab] = useState('versions');

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-indigo-500 to-blue-700 flex items-center justify-center shadow-lg">
          <RefreshCw className="w-6 h-6 text-white" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-foreground">Gestão de Atualizações</h1>
          <p className="text-sm text-muted-foreground">Versões, publicações, histórico e beta testers</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 overflow-x-auto pb-1 border-b border-border/50">
        {TABS.map(t => {
          const Icon = t.icon;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={`flex items-center gap-2 px-4 py-2 rounded-t-lg text-sm font-medium whitespace-nowrap transition-colors ${
                tab === t.id
                  ? 'bg-background border border-b-background border-border/50 text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
              }`}
              data-testid={`tab-${t.id}`}
            >
              <Icon className="w-4 h-4" />
              {t.label}
            </button>
          );
        })}
      </div>

      {/* Content */}
      <div>
        {tab === 'versions' && <VersionsTab />}
        {tab === 'publish' && <PublishTab />}
        {tab === 'history' && <HistoryTab />}
        {tab === 'beta' && <BetaTab />}
      </div>
    </div>
  );
}
