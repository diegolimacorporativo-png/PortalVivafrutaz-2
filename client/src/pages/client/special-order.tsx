import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { Layout } from "@/components/Layout";
import { useToast } from "@/hooks/use-toast";
import { format, subDays } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Star, Plus, Clock, CheckCircle, XCircle, Send, Calendar, Filter, X, Info, Trash2, Package, Tag } from "lucide-react";

const SIXTY_DAYS_AGO = subDays(new Date(), 60);
const DAYS = ["Segunda-feira", "Terça-feira", "Quarta-feira", "Quinta-feira", "Sexta-feira"];
const CATEGORIES = ["Frutas", "Hortifruti / Verduras", "Industrializados"];
const PRODUCT_TYPES = [
  { value: "catalog", label: "Produto do catálogo" },
  { value: "external", label: "Produto fora do catálogo" },
];

type SpecialItem = {
  productName: string;
  quantity: string;
  brand: string;
  category: string;
  productType: string;
};

type SpecialOrderRequest = {
  id: number; companyId: number; requestedDay: string; requestedDate?: string | null;
  description: string; quantity: string; observations: string | null; status: string;
  adminNote: string | null; createdAt: string; resolvedAt: string | null;
  items?: SpecialItem[] | null; estimatedDeliveryDate?: string | null;
};

const STATUS_MAP: Record<string, { label: string; color: string; icon: any }> = {
  PENDING: { label: "Aguardando aprovação", color: "bg-yellow-100 text-yellow-700", icon: Clock },
  APPROVED: { label: "Aprovado", color: "bg-green-100 text-green-700", icon: CheckCircle },
  REJECTED: { label: "Recusado", color: "bg-red-100 text-red-700", icon: XCircle },
};

const CATEGORY_COLORS: Record<string, string> = {
  "Frutas": "bg-orange-100 text-orange-700",
  "Hortifruti / Verduras": "bg-green-100 text-green-700",
  "Industrializados": "bg-blue-100 text-blue-700",
};

function emptyItem(): SpecialItem {
  return { productName: "", quantity: "", brand: "", category: "", productType: "external" };
}

function CompanyMissing() {
  return (
    <Layout>
      <div className="flex flex-col items-center justify-center py-24 text-center">
        <div className="w-16 h-16 rounded-2xl bg-orange-100 flex items-center justify-center mb-4 mx-auto text-3xl">⚠️</div>
        <h2 className="text-xl font-bold text-foreground mb-2">Dados da empresa não encontrados.</h2>
        <p className="text-muted-foreground text-sm max-w-sm">Entre em contato com a equipe VivaFrutaz.</p>
      </div>
    </Layout>
  );
}

export default function SpecialOrderPage() {
  const { company, isLoading: authLoading } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [requestedDay, setRequestedDay] = useState("");
  const [requestedDate, setRequestedDate] = useState("");
  const [observations, setObservations] = useState("");
  const [items, setItems] = useState<SpecialItem[]>([emptyItem()]);
  const [filterStatus, setFilterStatus] = useState("");
  const [filterDateFrom, setFilterDateFrom] = useState("");
  const [filterDateTo, setFilterDateTo] = useState("");

  const { data: requests, isLoading } = useQuery({
    queryKey: ['/api/special-order-requests/company', company?.id],
    queryFn: async () => {
      const res = await fetch(`/api/special-order-requests/company/${company?.id}`, { credentials: 'include' });
      return res.json() as Promise<SpecialOrderRequest[]>;
    },
    enabled: !!company?.id,
  });

  const submit = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/special-order-requests', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          companyId: company!.id,
          requestedDay,
          requestedDate: requestedDate || null,
          observations,
          items,
        }),
      });
      if (!res.ok) throw new Error('Erro ao enviar');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/special-order-requests/company', company?.id] });
      toast({ title: "Pedido pontual enviado! Aguarde a aprovação da VivaFrutaz." });
      setShowForm(false);
      setRequestedDay(""); setRequestedDate(""); setObservations("");
      setItems([emptyItem()]);
    },
    onError: () => toast({ title: "Erro ao enviar solicitação.", variant: "destructive" }),
  });

  const addItem = () => setItems(prev => [...prev, emptyItem()]);
  const removeItem = (idx: number) => setItems(prev => prev.filter((_, i) => i !== idx));
  const updateItem = (idx: number, field: keyof SpecialItem, value: string) => {
    setItems(prev => prev.map((item, i) => i === idx ? { ...item, [field]: value } : item));
  };

  const handleSubmit = () => {
    if (!requestedDay || !requestedDate) {
      toast({ title: "Selecione o dia e a data do pedido.", variant: "destructive" }); return;
    }
    const invalidItem = items.find(it => !it.productName.trim() || !it.quantity.trim() || !it.category);
    if (invalidItem) {
      toast({ title: "Preencha nome, quantidade e categoria de todos os produtos.", variant: "destructive" }); return;
    }
    submit.mutate();
  };

  const hasDateFilter = filterDateFrom || filterDateTo;
  const hasFilters = filterStatus || filterDateFrom || filterDateTo;

  const filteredRequests = useMemo(() => {
    return (requests || []).filter(req => {
      const d = new Date(req.createdAt);
      if (!hasDateFilter && d < SIXTY_DAYS_AGO) return false;
      if (filterStatus && req.status !== filterStatus) return false;
      if (filterDateFrom && d < new Date(filterDateFrom)) return false;
      if (filterDateTo && d > new Date(filterDateTo + 'T23:59:59')) return false;
      return true;
    });
  }, [requests, filterStatus, filterDateFrom, filterDateTo, hasDateFilter]);

  if (!authLoading && !company) return <CompanyMissing />;

  return (
    <Layout>
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-8 gap-4">
        <div>
          <h1 className="text-3xl font-display font-bold text-foreground">Pedido Pontual</h1>
          <p className="text-muted-foreground mt-1">Solicite produtos especiais fora da rotina semanal.</p>
        </div>
        <button onClick={() => setShowForm(!showForm)}
          data-testid="button-new-special-order"
          className="flex items-center gap-2 px-6 py-3 bg-secondary text-secondary-foreground font-bold rounded-xl hover:-translate-y-0.5 transition-all shadow-lg shadow-secondary/20">
          <Plus className="w-4 h-4" /> Nova Solicitação
        </button>
      </div>

      {/* Info banner */}
      <div className="mb-6 p-4 bg-primary/5 border border-primary/20 rounded-2xl flex items-start gap-3">
        <Star className="w-5 h-5 text-primary flex-shrink-0 mt-0.5" />
        <div>
          <p className="text-sm font-bold text-foreground">O que é um Pedido Pontual?</p>
          <p className="text-sm text-muted-foreground mt-1">
            Pedidos pontuais são solicitações especiais fora da rotina habitual — eventos, demandas extras, produtos específicos ou fora do catálogo.
            A equipe VivaFrutaz irá analisar e entrar em contato para confirmar.
          </p>
        </div>
      </div>

      {/* Form */}
      {showForm && (
        <div className="bg-card rounded-2xl border-2 border-secondary/30 premium-shadow p-6 mb-8">
          <h2 className="text-lg font-bold text-foreground mb-5 flex items-center gap-2">
            <Send className="w-5 h-5 text-secondary" /> Nova Solicitação de Pedido Pontual
          </h2>

          {/* Date/day */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-5">
            <div>
              <label className="block text-sm font-semibold mb-1.5">Dia Desejado *</label>
              <select value={requestedDay} onChange={e => setRequestedDay(e.target.value)}
                data-testid="select-requested-day"
                className="w-full px-4 py-2.5 rounded-xl border-2 border-border focus:border-primary outline-none bg-background">
                <option value="">Selecione um dia...</option>
                {DAYS.map(d => <option key={d} value={d}>{d}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-semibold mb-1.5 flex items-center gap-1.5">
                <Calendar className="w-4 h-4 text-primary" /> Data do Pedido *
              </label>
              <input type="date" value={requestedDate}
                onChange={e => setRequestedDate(e.target.value)}
                data-testid="input-requested-date"
                min={new Date().toISOString().split('T')[0]}
                className="w-full px-4 py-2.5 rounded-xl border-2 border-border focus:border-primary outline-none bg-background" />
              {requestedDate && (
                <p className="text-xs text-muted-foreground mt-1">
                  {new Date(requestedDate + 'T12:00:00').toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
                </p>
              )}
            </div>
          </div>

          {/* Products */}
          <div className="mb-5">
            <div className="flex items-center justify-between mb-3">
              <p className="text-sm font-bold text-foreground flex items-center gap-2">
                <Package className="w-4 h-4 text-primary" /> Produtos Solicitados
              </p>
              <button type="button" onClick={addItem} data-testid="button-add-product"
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold bg-primary/10 text-primary hover:bg-primary/20 rounded-xl border border-primary/30 transition-colors">
                <Plus className="w-3.5 h-3.5" /> Adicionar Produto
              </button>
            </div>
            <div className="space-y-4">
              {items.map((item, idx) => (
                <div key={idx} className="p-4 rounded-xl border-2 border-border bg-muted/10 relative">
                  {items.length > 1 && (
                    <button type="button" onClick={() => removeItem(idx)}
                      data-testid={`button-remove-item-${idx}`}
                      className="absolute top-3 right-3 p-1 rounded-lg text-muted-foreground hover:text-red-500 hover:bg-red-50 transition-colors">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div className="md:col-span-2">
                      <label className="block text-xs font-semibold mb-1 text-muted-foreground">Nome do Produto *</label>
                      <input value={item.productName}
                        onChange={e => updateItem(idx, 'productName', e.target.value)}
                        data-testid={`input-product-name-${idx}`}
                        placeholder="Ex: Manga Tommy, Alface Americana..."
                        className="w-full px-3 py-2 rounded-xl border-2 border-border focus:border-primary outline-none text-sm" />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold mb-1 text-muted-foreground">Quantidade *</label>
                      <input value={item.quantity}
                        onChange={e => updateItem(idx, 'quantity', e.target.value)}
                        data-testid={`input-item-quantity-${idx}`}
                        placeholder="Ex: 5kg, 2 caixas, 10 unidades"
                        className="w-full px-3 py-2 rounded-xl border-2 border-border focus:border-primary outline-none text-sm" />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold mb-1 text-muted-foreground">Marca (opcional)</label>
                      <input value={item.brand}
                        onChange={e => updateItem(idx, 'brand', e.target.value)}
                        data-testid={`input-item-brand-${idx}`}
                        placeholder="Ex: Sadia, Forno de Minas..."
                        className="w-full px-3 py-2 rounded-xl border-2 border-border focus:border-primary outline-none text-sm" />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold mb-1 text-muted-foreground">Categoria *</label>
                      <select value={item.category}
                        onChange={e => updateItem(idx, 'category', e.target.value)}
                        data-testid={`select-item-category-${idx}`}
                        className="w-full px-3 py-2 rounded-xl border-2 border-border focus:border-primary outline-none text-sm bg-background">
                        <option value="">Selecione...</option>
                        {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-semibold mb-1 text-muted-foreground">Tipo do Produto *</label>
                      <select value={item.productType}
                        onChange={e => updateItem(idx, 'productType', e.target.value)}
                        data-testid={`select-item-type-${idx}`}
                        className="w-full px-3 py-2 rounded-xl border-2 border-border focus:border-primary outline-none text-sm bg-background">
                        {PRODUCT_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                      </select>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Observations */}
          <div className="mb-5">
            <label className="block text-sm font-semibold mb-1.5">Observações Gerais</label>
            <textarea value={observations} onChange={e => setObservations(e.target.value)}
              rows={2} placeholder="Informações adicionais sobre o pedido (opcional)..."
              className="w-full px-4 py-3 rounded-xl border-2 border-border focus:border-primary outline-none resize-none" />
          </div>

          <div className="flex gap-3">
            <button type="button" onClick={() => setShowForm(false)}
              className="px-5 py-2.5 border-2 border-border text-muted-foreground font-bold rounded-xl hover:bg-muted transition-colors">
              Cancelar
            </button>
            <button type="button" onClick={handleSubmit} disabled={submit.isPending}
              data-testid="button-submit-special-order"
              className="px-8 py-2.5 bg-secondary text-secondary-foreground font-bold rounded-xl hover:-translate-y-0.5 transition-all disabled:opacity-50 flex items-center gap-2">
              <Send className="w-4 h-4" />
              {submit.isPending ? "Enviando..." : "Enviar Solicitação"}
            </button>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="bg-card rounded-2xl border border-border/50 premium-shadow p-4 mb-6 space-y-3">
        <div className="flex flex-wrap gap-3 items-center">
          <Filter className="w-4 h-4 text-muted-foreground flex-shrink-0" />
          <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)}
            className="px-3 py-2 rounded-xl border-2 border-border text-sm focus:border-primary outline-none">
            <option value="">Todos os status</option>
            <option value="PENDING">Aguardando aprovação</option>
            <option value="APPROVED">Aprovado</option>
            <option value="REJECTED">Recusado</option>
          </select>
          <div className="flex items-center gap-2 flex-wrap">
            <Calendar className="w-4 h-4 text-muted-foreground" />
            <input type="date" value={filterDateFrom} onChange={e => setFilterDateFrom(e.target.value)}
              className="px-3 py-2 rounded-xl border-2 border-border text-sm focus:border-primary outline-none" />
            <span className="text-muted-foreground text-sm">até</span>
            <input type="date" value={filterDateTo} onChange={e => setFilterDateTo(e.target.value)}
              className="px-3 py-2 rounded-xl border-2 border-border text-sm focus:border-primary outline-none" />
          </div>
          <div className="flex items-center gap-3 ml-auto">
            {hasFilters && (
              <button onClick={() => { setFilterStatus(""); setFilterDateFrom(""); setFilterDateTo(""); }}
                className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground font-medium">
                <X className="w-3 h-3" /> Limpar
              </button>
            )}
            <span className="text-xs text-muted-foreground font-medium">
              {filteredRequests.length} solicitaç{filteredRequests.length !== 1 ? 'ões' : 'ão'}
            </span>
          </div>
        </div>
        {!hasDateFilter && (
          <div className="flex items-center gap-2 px-3 py-2 bg-blue-50 rounded-xl border border-blue-100">
            <Info className="w-3.5 h-3.5 text-blue-500 flex-shrink-0" />
            <p className="text-xs text-blue-700">Exibindo solicitações dos últimos 60 dias. Use o filtro de datas para ver registros mais antigos.</p>
          </div>
        )}
      </div>

      {/* Requests list */}
      <div className="space-y-4">
        {isLoading ? (
          <div className="p-8 text-center text-muted-foreground">Carregando solicitações...</div>
        ) : !requests?.length ? (
          <div className="bg-card rounded-2xl p-12 text-center border border-border/50">
            <Star className="w-16 h-16 text-muted-foreground/30 mx-auto mb-4" />
            <h3 className="text-xl font-bold text-foreground">Nenhuma Solicitação</h3>
            <p className="text-muted-foreground mt-2">Você ainda não fez solicitações de pedidos pontuais.</p>
            <button onClick={() => setShowForm(true)} className="mt-5 px-6 py-3 bg-secondary text-secondary-foreground font-bold rounded-xl hover:bg-secondary/90 transition-colors">
              Fazer primeira solicitação
            </button>
          </div>
        ) : filteredRequests.length === 0 ? (
          <div className="bg-card rounded-2xl p-8 text-center border border-border/50">
            <p className="text-muted-foreground">Nenhuma solicitação no período selecionado.</p>
            <button onClick={() => { setFilterStatus(""); setFilterDateFrom(""); setFilterDateTo(""); }}
              className="text-primary font-bold text-sm hover:underline mt-2">Limpar filtros</button>
          </div>
        ) : (
          filteredRequests.map(req => {
            const status = STATUS_MAP[req.status] || { label: req.status, color: 'bg-muted text-muted-foreground', icon: Clock };
            const StatusIcon = status.icon;
            const reqItems: SpecialItem[] = Array.isArray(req.items) ? req.items : [];
            return (
              <div key={req.id} data-testid={`special-order-card-${req.id}`} className="bg-card rounded-2xl border border-border/50 premium-shadow p-5">
                <div className="flex flex-col md:flex-row md:items-start justify-between gap-4">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-2 flex-wrap">
                      <Calendar className="w-4 h-4 text-primary" />
                      <span className="font-bold text-foreground">{req.requestedDay}</span>
                      {req.requestedDate && (
                        <span className="text-muted-foreground text-sm">
                          — {new Date(req.requestedDate + 'T12:00:00').toLocaleDateString('pt-BR')}
                        </span>
                      )}
                      <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold ${status.color}`}>
                        <StatusIcon className="w-3 h-3" /> {status.label}
                      </span>
                    </div>

                    {/* Items list */}
                    {reqItems.length > 0 ? (
                      <div className="space-y-2 mt-3">
                        {reqItems.map((item, idx) => (
                          <div key={idx} className="flex items-start gap-2 text-sm">
                            <span className="w-5 h-5 rounded-full bg-primary/10 text-primary text-xs font-bold flex items-center justify-center flex-shrink-0 mt-0.5">{idx + 1}</span>
                            <div className="flex-1">
                              <span className="font-semibold text-foreground">{item.productName}</span>
                              {item.brand && <span className="text-muted-foreground ml-1">({item.brand})</span>}
                              <span className="text-muted-foreground ml-2">· {item.quantity}</span>
                              {item.category && (
                                <span className={`ml-2 px-1.5 py-0.5 rounded text-xs font-bold ${CATEGORY_COLORS[item.category] || 'bg-muted text-muted-foreground'}`}>
                                  {item.category}
                                </span>
                              )}
                              {item.productType === 'external' && (
                                <span className="ml-1 px-1.5 py-0.5 rounded text-xs font-bold bg-purple-100 text-purple-700">
                                  Fora do catálogo
                                </span>
                              )}
                              {req.status === 'APPROVED' && (item as any).approvedQuantity && (item as any).approvedQuantity !== item.quantity && (
                                <span className="ml-2 text-xs text-green-700 font-bold">
                                  ✓ Qtd aprovada: {(item as any).approvedQuantity}
                                </span>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-foreground mt-1">{req.description}</p>
                    )}

                    {req.observations && <p className="text-sm text-muted-foreground mt-2 italic">{req.observations}</p>}
                    {req.estimatedDeliveryDate && req.status === 'APPROVED' && (
                      <p className="text-sm text-green-700 font-semibold mt-2 flex items-center gap-1">
                        <Calendar className="w-3.5 h-3.5" /> Previsão de entrega: {new Date(req.estimatedDeliveryDate + 'T12:00:00').toLocaleDateString('pt-BR')}
                      </p>
                    )}
                    {req.adminNote && (
                      <div className={`mt-3 p-3 rounded-xl border ${req.status === 'REJECTED' ? 'bg-red-50 border-red-200' : 'bg-blue-50 border-blue-200'}`}>
                        <p className={`text-sm font-bold ${req.status === 'REJECTED' ? 'text-red-800' : 'text-blue-800'}`}>
                          {req.status === 'REJECTED' ? 'Motivo da recusa:' : 'Resposta VivaFrutaz:'}
                        </p>
                        <p className={`text-sm mt-0.5 ${req.status === 'REJECTED' ? 'text-red-700' : 'text-blue-700'}`}>{req.adminNote}</p>
                      </div>
                    )}
                  </div>
                  <div className="text-right flex-shrink-0">
                    <p className="text-xs text-muted-foreground">{format(new Date(req.createdAt), "d 'de' MMM yyyy", { locale: ptBR })}</p>
                    {req.resolvedAt && <p className="text-xs text-muted-foreground mt-0.5">Resolvido: {format(new Date(req.resolvedAt), "d 'de' MMM", { locale: ptBR })}</p>}
                    <p className="text-xs text-muted-foreground mt-1">{reqItems.length || 1} produto{(reqItems.length || 1) !== 1 ? 's' : ''}</p>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </Layout>
  );
}
