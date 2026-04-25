import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { queryClient, apiRequest } from '@/lib/queryClient';
import { normalizeList } from '@/lib/normalizeResponse';
import { useToast } from '@/hooks/use-toast';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  Store, Search, Package, Brain, Truck, DollarSign, Plug, Route,
  Receipt, MessageCircle, TrendingDown, MapPin, BarChart3, Plus,
  Download, CheckCircle2, Trash2, RefreshCw, Star, Pencil, X,
  ChevronRight, Zap, Shield,
} from 'lucide-react';

const CATEGORIAS = [
  { id: 'all', label: 'Todos' },
  { id: 'ia', label: 'Inteligência Artificial' },
  { id: 'logistica', label: 'Logística' },
  { id: 'financeiro', label: 'Financeiro' },
  { id: 'integracao', label: 'Integrações' },
  { id: 'geral', label: 'Geral' },
];

const ICON_MAP: Record<string, any> = {
  Brain, Truck, Route, BarChart3, Plug, Receipt, MessageCircle, TrendingDown, MapPin, Package,
  DollarSign, Zap, Shield, Store, Star,
};

function ModuloIcon({ icone }: { icone?: string | null }) {
  const Icon = (icone && ICON_MAP[icone]) ? ICON_MAP[icone] : Package;
  return <Icon className="w-6 h-6" />;
}

function CategoriaColor(cat: string) {
  const map: Record<string, string> = {
    ia: 'bg-purple-100 text-purple-700 border-purple-200',
    logistica: 'bg-teal-100 text-teal-700 border-teal-200',
    financeiro: 'bg-green-100 text-green-700 border-green-200',
    integracao: 'bg-blue-100 text-blue-700 border-blue-200',
    geral: 'bg-gray-100 text-gray-700 border-gray-200',
  };
  return map[cat] ?? 'bg-gray-100 text-gray-700 border-gray-200';
}

function CategoriaIconColor(cat: string) {
  const map: Record<string, string> = {
    ia: 'bg-purple-500',
    logistica: 'bg-teal-500',
    financeiro: 'bg-green-500',
    integracao: 'bg-blue-500',
    geral: 'bg-gray-400',
  };
  return map[cat] ?? 'bg-gray-400';
}

interface EmpresaModuloExtended {
  id: number;
  moduloId: number;
  status: string;
  versaoInstalada: string;
  dataInstalacao: string;
}

export default function Marketplace() {
  const { toast } = useToast();
  const [busca, setBusca] = useState('');
  const [categoriaFiltro, setCategoriaFiltro] = useState('all');
  const [showForm, setShowForm] = useState(false);
  const [editModulo, setEditModulo] = useState<any>(null);
  const [selectedEmpresa, setSelectedEmpresa] = useState<string>('none');
  const [showChangelog, setShowChangelog] = useState<any>(null);
  const [form, setForm] = useState({
    nomeModulo: '', descricao: '', preco: '0', categoria: 'geral',
    icone: 'Package', versao: '1.0.0', changelog: '', destaque: false, ativo: true,
  });

  const { data: modulos = [], isLoading, refetch } = useQuery<any[]>({
    queryKey: ['/api/marketplace/modulos'],
  });

  const { data: companies = [] } = useQuery<any[]>({
    queryKey: ['/api/companies'],
    select: normalizeList,
  });

  const { data: modulosEmpresa = [] } = useQuery<EmpresaModuloExtended[]>({
    queryKey: ['/api/marketplace/empresa', selectedEmpresa],
    enabled: selectedEmpresa !== 'none',
  });

  const seedMut = useMutation({
    mutationFn: () => apiRequest('POST', '/api/marketplace/seed', {}),
    onSuccess: async (res) => {
      const data = await res.json();
      toast({ title: 'Módulos criados', description: data.message });
      queryClient.invalidateQueries({ queryKey: ['/api/marketplace/modulos'] });
    },
    onError: () => toast({ title: 'Erro', description: 'Falha ao criar módulos padrão', variant: 'destructive' }),
  });

  const createMut = useMutation({
    mutationFn: (data: any) => apiRequest('POST', '/api/marketplace/modulos', data),
    onSuccess: () => {
      toast({ title: 'Módulo criado com sucesso' });
      queryClient.invalidateQueries({ queryKey: ['/api/marketplace/modulos'] });
      resetForm();
    },
    onError: () => toast({ title: 'Erro', description: 'Falha ao criar módulo', variant: 'destructive' }),
  });

  const updateMut = useMutation({
    mutationFn: ({ id, data }: { id: number; data: any }) => apiRequest('PATCH', `/api/marketplace/modulos/${id}`, data),
    onSuccess: () => {
      toast({ title: 'Módulo atualizado' });
      queryClient.invalidateQueries({ queryKey: ['/api/marketplace/modulos'] });
      resetForm();
    },
    onError: () => toast({ title: 'Erro', description: 'Falha ao atualizar módulo', variant: 'destructive' }),
  });

  const deleteMut = useMutation({
    mutationFn: (id: number) => apiRequest('DELETE', `/api/marketplace/modulos/${id}`, {}),
    onSuccess: () => {
      toast({ title: 'Módulo removido' });
      queryClient.invalidateQueries({ queryKey: ['/api/marketplace/modulos'] });
    },
    onError: () => toast({ title: 'Erro', description: 'Falha ao remover módulo', variant: 'destructive' }),
  });

  const installMut = useMutation({
    mutationFn: ({ empresaId, moduloId }: { empresaId: number; moduloId: number }) =>
      apiRequest('POST', `/api/marketplace/empresa/${empresaId}/instalar/${moduloId}`, {}),
    onSuccess: () => {
      toast({ title: 'Módulo instalado com sucesso' });
      queryClient.invalidateQueries({ queryKey: ['/api/marketplace/empresa', selectedEmpresa] });
    },
    onError: () => toast({ title: 'Erro', description: 'Falha ao instalar módulo (pode já estar instalado)', variant: 'destructive' }),
  });

  const uninstallMut = useMutation({
    mutationFn: (id: number) => apiRequest('DELETE', `/api/marketplace/empresa-modulos/${id}`, {}),
    onSuccess: () => {
      toast({ title: 'Módulo removido da empresa' });
      queryClient.invalidateQueries({ queryKey: ['/api/marketplace/empresa', selectedEmpresa] });
    },
    onError: () => toast({ title: 'Erro', description: 'Falha ao remover módulo', variant: 'destructive' }),
  });

  const resetForm = () => {
    setForm({ nomeModulo: '', descricao: '', preco: '0', categoria: 'geral', icone: 'Package', versao: '1.0.0', changelog: '', destaque: false, ativo: true });
    setEditModulo(null);
    setShowForm(false);
  };

  const handleEdit = (m: any) => {
    setEditModulo(m);
    setForm({
      nomeModulo: m.nomeModulo, descricao: m.descricao ?? '', preco: m.preco,
      categoria: m.categoria, icone: m.icone ?? 'Package', versao: m.versao ?? '1.0.0',
      changelog: m.changelog ?? '', destaque: m.destaque, ativo: m.ativo,
    });
    setShowForm(true);
  };

  const handleSave = () => {
    if (!form.nomeModulo.trim()) return toast({ title: 'Erro', description: 'Nome obrigatório', variant: 'destructive' });
    if (editModulo) {
      updateMut.mutate({ id: editModulo.id, data: form });
    } else {
      createMut.mutate(form);
    }
  };

  const isInstalled = (moduloId: number) => modulosEmpresa.some(m => m.moduloId === moduloId);
  const getInstalacao = (moduloId: number) => modulosEmpresa.find(m => m.moduloId === moduloId);

  const filtrados = modulos.filter(m => {
    const matchBusca = !busca || m.nomeModulo.toLowerCase().includes(busca.toLowerCase()) || (m.descricao ?? '').toLowerCase().includes(busca.toLowerCase());
    const matchCat = categoriaFiltro === 'all' || m.categoria === categoriaFiltro;
    return matchBusca && matchCat;
  });

  const fmt = (v: string | number) => parseFloat(String(v)).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <Store className="w-7 h-7 text-primary" />
            Loja de Módulos
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Instale módulos adicionais para expandir as funcionalidades da empresa
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          {modulos.length === 0 && (
            <Button
              type="button"
              variant="outline"
              onClick={() => seedMut.mutate()}
              disabled={seedMut.isPending}
              data-testid="button-seed-marketplace"
              className="gap-2"
            >
              <Zap className="w-4 h-4" />
              Carregar Módulos Padrão
            </Button>
          )}
          <Button
            type="button"
            onClick={() => { resetForm(); setShowForm(true); }}
            data-testid="button-novo-modulo"
            className="gap-2"
          >
            <Plus className="w-4 h-4" />
            Novo Módulo
          </Button>
        </div>
      </div>

      {/* Empresa Selector */}
      <Card>
        <CardContent className="p-4">
          <div className="flex items-center gap-3 flex-wrap">
            <Label className="text-sm font-medium shrink-0">Empresa para instalar:</Label>
            <Select value={selectedEmpresa} onValueChange={setSelectedEmpresa}>
              <SelectTrigger className="w-64" data-testid="select-empresa-modulo">
                <SelectValue placeholder="Selecione uma empresa..." />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">— Selecione —</SelectItem>
                {companies.map((c: any) => (
                  <SelectItem key={c.id} value={String(c.id)}>{c.companyName ?? c.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {selectedEmpresa !== 'none' && (
              <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200">
                <CheckCircle2 className="w-3 h-3 mr-1" />
                {modulosEmpresa.length} módulos instalados
              </Badge>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Filtros */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-52">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Buscar módulo..."
            value={busca}
            onChange={e => setBusca(e.target.value)}
            className="pl-9"
            data-testid="input-busca-modulo"
          />
        </div>
        <div className="flex gap-2 flex-wrap">
          {CATEGORIAS.map(cat => (
            <Button
              key={cat.id}
              type="button"
              variant={categoriaFiltro === cat.id ? 'default' : 'outline'}
              size="sm"
              onClick={() => setCategoriaFiltro(cat.id)}
              data-testid={`filter-cat-${cat.id}`}
            >
              {cat.label}
            </Button>
          ))}
        </div>
      </div>

      {/* Grid de Módulos */}
      {isLoading ? (
        <div className="flex items-center justify-center py-16">
          <RefreshCw className="w-8 h-8 animate-spin text-primary" />
        </div>
      ) : filtrados.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center">
            <Store className="w-12 h-12 mx-auto mb-4 text-muted-foreground/40" />
            <p className="text-muted-foreground font-medium">Nenhum módulo encontrado</p>
            <p className="text-sm text-muted-foreground mt-1">
              {modulos.length === 0 ? 'Clique em "Carregar Módulos Padrão" para começar' : 'Tente ajustar os filtros de busca'}
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtrados.map((m: any) => {
            const installed = isInstalled(m.id);
            const instalacao = getInstalacao(m.id);
            return (
              <Card
                key={m.id}
                className={`relative transition-all hover:shadow-md ${installed ? 'border-green-300 bg-green-50/30' : ''}`}
                data-testid={`card-modulo-${m.id}`}
              >
                {m.destaque && (
                  <div className="absolute -top-2 -right-2">
                    <Badge className="bg-yellow-400 text-yellow-900 border-0 text-xs">
                      <Star className="w-3 h-3 mr-1" />
                      Destaque
                    </Badge>
                  </div>
                )}
                <CardContent className="p-5">
                  <div className="flex items-start gap-3 mb-3">
                    <div className={`w-11 h-11 rounded-xl flex items-center justify-center text-white shrink-0 ${CategoriaIconColor(m.categoria)}`}>
                      <ModuloIcon icone={m.icone} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <h3 className="font-semibold text-foreground truncate">{m.nomeModulo}</h3>
                      <Badge className={`text-xs border mt-1 ${CategoriaColor(m.categoria)}`}>{m.categoria}</Badge>
                    </div>
                  </div>

                  <p className="text-sm text-muted-foreground mb-3 line-clamp-2">{m.descricao}</p>

                  <div className="flex items-center justify-between mb-4">
                    <span className="text-lg font-bold text-primary">{parseFloat(m.preco) === 0 ? 'Grátis' : fmt(m.preco)}<span className="text-xs font-normal text-muted-foreground">/mês</span></span>
                    <span className="text-xs text-muted-foreground">v{m.versao}</span>
                  </div>

                  {installed && instalacao && (
                    <div className="flex items-center gap-2 mb-3 text-xs text-green-700 bg-green-100 rounded-lg px-2 py-1">
                      <CheckCircle2 className="w-3 h-3" />
                      Instalado • v{instalacao.versaoInstalada}
                    </div>
                  )}

                  <div className="flex gap-2">
                    {selectedEmpresa !== 'none' && (
                      installed ? (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="flex-1 text-red-600 border-red-200 hover:bg-red-50"
                          onClick={() => instalacao && uninstallMut.mutate(instalacao.id)}
                          disabled={uninstallMut.isPending}
                          data-testid={`button-uninstall-${m.id}`}
                        >
                          <Trash2 className="w-3 h-3 mr-1" />
                          Remover
                        </Button>
                      ) : (
                        <Button
                          type="button"
                          size="sm"
                          className="flex-1 gap-1"
                          onClick={() => installMut.mutate({ empresaId: Number(selectedEmpresa), moduloId: m.id })}
                          disabled={installMut.isPending}
                          data-testid={`button-install-${m.id}`}
                        >
                          <Download className="w-3 h-3" />
                          Instalar
                        </Button>
                      )
                    )}
                    {m.changelog && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="px-2"
                        onClick={() => setShowChangelog(m)}
                        data-testid={`button-changelog-${m.id}`}
                      >
                        <ChevronRight className="w-4 h-4" />
                      </Button>
                    )}
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="px-2"
                      onClick={() => handleEdit(m)}
                      data-testid={`button-edit-modulo-${m.id}`}
                    >
                      <Pencil className="w-4 h-4" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="px-2 text-red-500 hover:text-red-700 hover:bg-red-50"
                      onClick={() => deleteMut.mutate(m.id)}
                      disabled={deleteMut.isPending}
                      data-testid={`button-delete-modulo-${m.id}`}
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Módulos instalados da empresa selecionada */}
      {selectedEmpresa !== 'none' && modulosEmpresa.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-green-600" />
              Módulos Instalados — Empresa #{selectedEmpresa}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {modulosEmpresa.map((em) => {
                const mod = modulos.find(m => m.id === em.moduloId);
                return (
                  <div key={em.id} className="flex items-center gap-3 p-3 rounded-lg bg-muted/50 border border-border/50">
                    <div className={`w-8 h-8 rounded-lg flex items-center justify-center text-white shrink-0 ${CategoriaIconColor(mod?.categoria ?? 'geral')}`}>
                      <ModuloIcon icone={mod?.icone} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{mod?.nomeModulo ?? `Módulo #${em.moduloId}`}</p>
                      <p className="text-xs text-muted-foreground">v{em.versaoInstalada} • Instalado {new Date(em.dataInstalacao).toLocaleDateString('pt-BR')}</p>
                    </div>
                    <Badge className={`text-xs border ${em.status === 'ativo' ? 'bg-green-100 text-green-700 border-green-200' : 'bg-gray-100 text-gray-600 border-gray-200'}`}>
                      {em.status}
                    </Badge>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="text-red-500 hover:bg-red-50"
                      onClick={() => uninstallMut.mutate(em.id)}
                      data-testid={`button-remove-instalado-${em.id}`}
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Modal — Criar/Editar Módulo */}
      <Dialog open={showForm} onOpenChange={v => { if (!v) resetForm(); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editModulo ? 'Editar Módulo' : 'Novo Módulo'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 mt-2">
            <div>
              <Label>Nome do Módulo *</Label>
              <Input
                value={form.nomeModulo}
                onChange={e => setForm(f => ({ ...f, nomeModulo: e.target.value }))}
                placeholder="Ex: GPS Rastreamento"
                data-testid="input-nome-modulo"
              />
            </div>
            <div>
              <Label>Descrição</Label>
              <Textarea
                value={form.descricao}
                onChange={e => setForm(f => ({ ...f, descricao: e.target.value }))}
                placeholder="Descreva o módulo..."
                rows={2}
                data-testid="input-desc-modulo"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Preço (R$/mês)</Label>
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  value={form.preco}
                  onChange={e => setForm(f => ({ ...f, preco: e.target.value }))}
                  data-testid="input-preco-modulo"
                />
              </div>
              <div>
                <Label>Versão</Label>
                <Input
                  value={form.versao}
                  onChange={e => setForm(f => ({ ...f, versao: e.target.value }))}
                  placeholder="1.0.0"
                  data-testid="input-versao-modulo"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Categoria</Label>
                <Select value={form.categoria} onValueChange={v => setForm(f => ({ ...f, categoria: v }))}>
                  <SelectTrigger data-testid="select-cat-modulo">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="geral">Geral</SelectItem>
                    <SelectItem value="ia">IA</SelectItem>
                    <SelectItem value="logistica">Logística</SelectItem>
                    <SelectItem value="financeiro">Financeiro</SelectItem>
                    <SelectItem value="integracao">Integração</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Ícone</Label>
                <Select value={form.icone} onValueChange={v => setForm(f => ({ ...f, icone: v }))}>
                  <SelectTrigger data-testid="select-icon-modulo">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.keys(ICON_MAP).map(k => <SelectItem key={k} value={k}>{k}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <Label>Changelog</Label>
              <Textarea
                value={form.changelog}
                onChange={e => setForm(f => ({ ...f, changelog: e.target.value }))}
                placeholder="v1.0.0: Lançamento inicial..."
                rows={3}
                data-testid="input-changelog-modulo"
              />
            </div>
            <div className="flex gap-4">
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={form.destaque} onChange={e => setForm(f => ({ ...f, destaque: e.target.checked }))} />
                <span className="text-sm">Destaque</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={form.ativo} onChange={e => setForm(f => ({ ...f, ativo: e.target.checked }))} />
                <span className="text-sm">Ativo</span>
              </label>
            </div>
            <div className="flex gap-2 justify-end pt-2">
              <Button type="button" variant="outline" onClick={resetForm}>Cancelar</Button>
              <Button
                type="button"
                onClick={handleSave}
                disabled={createMut.isPending || updateMut.isPending}
                data-testid="button-salvar-modulo"
              >
                {(createMut.isPending || updateMut.isPending) ? 'Salvando...' : 'Salvar'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Modal — Changelog */}
      <Dialog open={!!showChangelog} onOpenChange={v => { if (!v) setShowChangelog(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ChevronRight className="w-5 h-5 text-primary" />
              Changelog — {showChangelog?.nomeModulo}
            </DialogTitle>
          </DialogHeader>
          <div className="mt-2">
            <p className="text-xs text-muted-foreground mb-2">Versão atual: <strong>v{showChangelog?.versao}</strong></p>
            <pre className="text-sm whitespace-pre-wrap bg-muted/50 rounded-lg p-4 border border-border/50 font-mono">
              {showChangelog?.changelog ?? 'Sem changelog disponível.'}
            </pre>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
