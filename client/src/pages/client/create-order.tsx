import { useState, useMemo, useEffect, useRef } from "react";
import { useAuth } from "@/hooks/use-auth";
import { useActiveOrderWindow, useCreateOrder, useCompanyOrders, useOrderDetail } from "@/hooks/use-ordering";
import { useProducts } from "@/hooks/use-catalog";
import { Layout } from "@/components/Layout";
import { FruitCuriosities } from "@/components/FruitCuriosities";
import { useToast } from "@/hooks/use-toast";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import {
  ShoppingCart, CheckCircle2, AlertCircle, RotateCcw, Package,
  Minus, Plus, Trash2, FileText, Clock, PartyPopper, X, Search, AlertTriangle, Lock, RefreshCcw,
  Wrench, FlaskConical, SendHorizonal
} from "lucide-react";

const DAY_OPTIONS = ["Segunda-feira", "Terça-feira", "Quarta-feira", "Quinta-feira", "Sexta-feira"];

const DAY_EN_TO_NUM: Record<string, number> = {
  "Segunda-feira": 1, "Terça-feira": 2, "Quarta-feira": 3,
  "Quinta-feira": 4, "Sexta-feira": 5,
};

const DAY_NORMALIZE: Record<string, string> = {
  "Monday": "Segunda-feira", "Tuesday": "Terça-feira", "Wednesday": "Quarta-feira",
  "Thursday": "Quinta-feira", "Friday": "Sexta-feira",
};

// Module 2 fix: finds the correct delivery date without timezone issues.
// Works with local date strings (YYYY-MM-DD) to avoid UTC/Brasília shift.
function getDeliveryDate(dayName: string, deliveryStartIso: string, deliveryEndIso: string): string {
  const targetNum = DAY_EN_TO_NUM[dayName];
  if (!targetNum) return "";
  // Extract date parts from ISO strings to avoid timezone issues
  const startStr = deliveryStartIso.split('T')[0];
  const endStr = deliveryEndIso.split('T')[0];
  const [sy, sm, sd] = startStr.split('-').map(Number);
  const [ey, em, ed] = endStr.split('-').map(Number);
  let current = new Date(sy, sm - 1, sd); // local date, no timezone shift
  const end = new Date(ey, em - 1, ed);
  for (let i = 0; i <= 14; i++) {
    const jsDay = current.getDay(); // local weekday
    const isoDay = jsDay === 0 ? 7 : jsDay;
    if (isoDay === targetNum && current <= end) {
      return `${current.getFullYear()}-${String(current.getMonth() + 1).padStart(2, '0')}-${String(current.getDate()).padStart(2, '0')}`;
    }
    current.setDate(current.getDate() + 1);
  }
  return "";
}

function fmtBRL(n: number) {
  return n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

const ORDER_NOTE_PLACEHOLDER = "Ex: Bananas mais verdes, solicito produto que não está na planilha (informar nome), entregar antes das 9h...";

export default function CreateOrderPage() {
  const { company, isLoading: authLoading } = useAuth();
  const { data: activeWindow, isLoading: windowLoading } = useActiveOrderWindow();
  const { data: products } = useProducts();
  const createOrder = useCreateOrder();
  const { data: companyOrders } = useCompanyOrders(company?.id);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // System mode checks
  const { data: testModeData } = useQuery<{ enabled: boolean }>({
    queryKey: ['/api/settings/test-mode'],
    staleTime: 0,
    refetchOnMount: true,
  });
  const testModeActive = testModeData?.enabled === true;

  const urlDay = new URLSearchParams(typeof window !== 'undefined' ? window.location.search : '').get('day') || '';

  const [selectedDay, setSelectedDay] = useState<string>(urlDay);
  const [pendingDay, setPendingDay] = useState<string | null>(null); // Module 1: day requested while cart has items
  const [cart, setCart] = useState<Record<number, number>>({});
  const [orderNote, setOrderNote] = useState("");
  const [replicating, setReplicating] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [successOrder, setSuccessOrder] = useState<{ orderCode: string; total: number } | null>(null);
  const [filterCategory, setFilterCategory] = useState("ALL");
  const [search, setSearch] = useState("");
  const [showBillingWarning, setShowBillingWarning] = useState(false);

  // Reopen (SOLICITAR ALTERAÇÃO) state
  const [showReopenModal, setShowReopenModal] = useState(false);
  const [reopenReason, setReopenReason] = useState("");
  const [reopenTargetId, setReopenTargetId] = useState<number | null>(null);
  const [reopenSuccess, setReopenSuccess] = useState(false);

  const requestReopenMut = useMutation({
    mutationFn: ({ id, reason }: { id: number; reason: string }) =>
      apiRequest('POST', `/api/orders/${id}/request-reopen`, { reason }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/orders'] });
      queryClient.invalidateQueries({ queryKey: ['/api/company-orders'] });
      setShowReopenModal(false);
      setReopenReason("");
      setReopenTargetId(null);
      setReopenSuccess(true);
      toast({ title: 'Solicitação enviada!', description: 'O administrador irá analisar e liberar a edição do pedido.' });
    },
    onError: (e: any) => toast({ title: e?.message || 'Erro ao solicitar alteração', variant: 'destructive' }),
  });

  if (!authLoading && !company) {
    return (
      <Layout>
        <div className="flex flex-col items-center justify-center py-24 text-center">
          <div className="w-16 h-16 rounded-2xl bg-orange-100 flex items-center justify-center mb-4 mx-auto">
            <span className="text-3xl">⚠️</span>
          </div>
          <h2 className="text-xl font-bold text-foreground mb-2">Dados da empresa não encontrados.</h2>
          <p className="text-muted-foreground text-sm max-w-sm">Não foi possível carregar as informações da sua empresa. Entre em contato com a equipe VivaFrutaz.</p>
        </div>
      </Layout>
    );
  }

  // Cart auto-save key (scoped to company + order window)
  const cartKey = company && activeWindow
    ? `vf_cart_${company.id}_${activeWindow.id}`
    : null;

  // Restore cart from localStorage once company + window are loaded
  const cartRestored = useRef(false);
  useEffect(() => {
    if (!cartKey || cartRestored.current) return;
    cartRestored.current = true;
    try {
      const saved = localStorage.getItem(cartKey);
      if (!saved) return;
      const parsed = JSON.parse(saved);
      const hasItems = Object.keys(parsed.cart || {}).length > 0;
      if (!hasItems) return;
      setCart(parsed.cart || {});
      if (parsed.selectedDay) setSelectedDay(parsed.selectedDay);
      if (parsed.orderNote) setOrderNote(parsed.orderNote);
      toast({
        title: '🛒 Pedido recuperado',
        description: 'Seu pedido anterior foi recuperado automaticamente.',
      });
    } catch {
      // ignore parse errors
    }
  }, [cartKey]);

  // Auto-save cart to localStorage on every change
  useEffect(() => {
    if (!cartKey) return;
    const hasItems = Object.keys(cart).length > 0;
    if (hasItems || orderNote) {
      localStorage.setItem(cartKey, JSON.stringify({ cart, selectedDay, orderNote }));
    } else {
      localStorage.removeItem(cartKey);
    }
  }, [cart, selectedDay, orderNote, cartKey]);

  useEffect(() => { if (urlDay && !selectedDay) setSelectedDay(urlDay); }, [urlDay]);

  const deliveryDate = useMemo(() => {
    if (!activeWindow || !selectedDay) return "";
    return getDeliveryDate(selectedDay, activeWindow.deliveryStartDate as unknown as string, activeWindow.deliveryEndDate as unknown as string);
  }, [activeWindow, selectedDay]);

  // Check if an order already exists for the selected delivery date (date-lock)
  const existingOrderForDate = useMemo(() => {
    if (!deliveryDate || !companyOrders) return null;
    return companyOrders.find(o => {
      if (o.status === 'CANCELLED') return false;
      const d = new Date(o.deliveryDate).toISOString().split('T')[0];
      return d === deliveryDate;
    }) || null;
  }, [deliveryDate, companyOrders]);

  const lastOrder = companyOrders?.[0];
  const { data: lastOrderDetail } = useOrderDetail(lastOrder?.id);

  const allowedDays = useMemo((): string[] => {
    const days = company?.allowedOrderDays;
    if (!days) return [];
    if (Array.isArray(days)) return (days as any[]).map(d => DAY_NORMALIZE[String(d)] || String(d));
    return [];
  }, [company]);

  const availableProducts = useMemo(() => {
    if (!products || !company) return [];
    const adminFee = Number(company.adminFee || 0);
    return products
      .filter(p => {
        if (!p || !p.active) return false;
        const base = Number(p.basePrice);
        if (!p.basePrice || isNaN(base) || base <= 0) return false;
        const days = (p as any).availableDays;
        if (days && Array.isArray(days) && days.length > 0 && selectedDay) {
          if (!days.includes(selectedDay)) return false;
        }
        return true;
      })
      .map(product => {
        const base = Number(product.basePrice);
        const finalPrice = base * (1 + adminFee / 100);
        const price = Math.round(finalPrice * 100) / 100;
        return { ...product, price };
      })
      .filter(p => p.price > 0); // final safety net
  }, [products, company, selectedDay]);

  const categories = useMemo(() => {
    const cats = new Set<string>();
    availableProducts.forEach(p => cats.add(p.category));
    return Array.from(cats).sort();
  }, [availableProducts]);

  const visibleProducts = useMemo(() => {
    return availableProducts.filter(p => {
      const matchCat = filterCategory === 'ALL' || p.category === filterCategory;
      const q = search.toLowerCase();
      const matchSearch = !q || p.name.toLowerCase().includes(q) || p.category.toLowerCase().includes(q);
      return matchCat && matchSearch;
    });
  }, [availableProducts, filterCategory, search]);

  const cartItems = useMemo(() => {
    return Object.entries(cart)
      .filter(([, qty]) => qty > 0)
      .map(([productId, qty]) => {
        const p = availableProducts.find(x => x.id === Number(productId));
        if (!p || !p.price) return null; // guard: product removed or has no price
        return { product: p, qty, subtotal: p.price * qty };
      })
      .filter((item): item is { product: typeof availableProducts[0]; qty: number; subtotal: number } => item !== null);
  }, [cart, availableProducts]);

  const cartTotal = useMemo(() => cartItems.reduce((s, i) => s + i.subtotal, 0), [cartItems]);

  // Weekly billing: sum of all non-cancelled orders in the current week
  const weeklyOrdersTotal = useMemo(() => {
    if (!companyOrders || !activeWindow) return 0;
    return companyOrders
      .filter(o => o.status !== 'CANCELLED' && o.weekReference === activeWindow.weekReference)
      .reduce((sum, o) => sum + (parseFloat(o.totalValue as string) || 0), 0);
  }, [companyOrders, activeWindow]);

  const minWeeklyBilling = parseFloat((company as any)?.minWeeklyBilling || '0') || 0;
  const projectedWeeklyTotal = weeklyOrdersTotal + cartTotal;
  const billingShortfall = minWeeklyBilling > 0 ? Math.max(0, minWeeklyBilling - projectedWeeklyTotal) : 0;

  const cartHasItems = cartItems.length > 0;

  // Module 1: handle day click — block if cart has items
  const handleDayClick = (day: string) => {
    if (day === selectedDay) return;
    if (cartHasItems) {
      setPendingDay(day); // show warning modal
    } else {
      setSelectedDay(day);
      setFilterCategory("ALL");
      setSearch("");
    }
  };

  // Module 1: cancel current order (clear cart) and switch day
  const handleCancelCurrentOrder = () => {
    if (pendingDay) {
      setSelectedDay(pendingDay);
      setCart({});
      setOrderNote("");
      setFilterCategory("ALL");
      setSearch("");
    }
    setPendingDay(null);
  };

  const handleUpdateCart = (productId: number, qty: number) => {
    setCart(prev => {
      const next = { ...prev };
      if (qty <= 0) delete next[productId];
      else next[productId] = qty;
      return next;
    });
  };

  const handleReplicateLastOrder = () => {
    if (!lastOrderDetail?.items) return;
    setReplicating(true);
    const newCart: Record<number, number> = {};
    for (const item of lastOrderDetail.items) newCart[Number(item.productId)] = item.quantity;
    setCart(newCart);
    setTimeout(() => setReplicating(false), 600);
  };

  const handleSubmit = async (force = false) => {
    if (!activeWindow || !company || !deliveryDate) return;
    if (submitting) return; // proteção clique duplo

    // Minimum weekly billing check
    if (!force && minWeeklyBilling > 0 && projectedWeeklyTotal < minWeeklyBilling) {
      setShowBillingWarning(true);
      return;
    }

    setSubmitting(true);
    try {
      const items = cartItems.map(({ product, qty }) => ({
        productId: product.id,
        quantity: qty,
        unitPrice: String(product.price),
        totalPrice: String(product.price * qty),
      }));

      const result = await createOrder.mutateAsync({
        order: {
          companyId: company.id,
          deliveryDate: new Date(deliveryDate + 'T12:00:00').toISOString(),
          weekReference: activeWindow.weekReference,
          totalValue: String(cartTotal),
          orderNote: orderNote || null,
          allowReplication: false,
        },
        items,
      });

      // Clear saved cart after successful submission
      if (cartKey) localStorage.removeItem(cartKey);

      setSuccessOrder({
        orderCode: result.orderCode || `VF-${new Date().getFullYear()}-${String(result.id).padStart(6, '0')}`,
        total: cartTotal,
      });
    } catch {
      setSubmitting(false);
    }
  };

  if (windowLoading) {
    return <Layout><div className="p-8 text-center text-muted-foreground">Carregando...</div></Layout>;
  }

  if (company?.clientType === 'contratual') {
    return (
      <Layout>
        <div className="max-w-xl mx-auto mt-16 text-center space-y-6">
          <div className="w-20 h-20 rounded-full bg-primary/10 flex items-center justify-center mx-auto">
            <Lock className="w-10 h-10 text-primary" />
          </div>
          <h1 className="text-2xl font-display font-bold text-foreground">Pedidos automáticos</h1>
          <p className="text-muted-foreground">
            Este cliente possui contrato ativo. Os pedidos são gerados automaticamente conforme o escopo contratual.
          </p>
          <a
            href="/client/contract-scope"
            className="inline-flex items-center gap-2 px-6 py-3 bg-primary text-primary-foreground font-bold rounded-xl hover:bg-primary/90 transition-colors"
            data-testid="link-view-contract-scope"
          >
            Ver Meu Escopo Contratual
          </a>
        </div>
      </Layout>
    );
  }

  if (successOrder) {
    return (
      <Layout>
        <div className="max-w-xl mx-auto mt-16 text-center">
          <div className="w-24 h-24 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-6">
            <PartyPopper className="w-12 h-12 text-green-600" />
          </div>
          <h1 className="text-3xl font-display font-bold text-foreground">Pedido Realizado!</h1>
          <p className="text-muted-foreground mt-2 text-lg">Seu pedido foi enviado com sucesso.</p>
          <div className="mt-8 bg-card rounded-2xl border-2 border-primary/20 p-8 premium-shadow">
            <p className="text-sm font-bold text-muted-foreground uppercase tracking-wider mb-2">Código do Pedido</p>
            <p className="text-4xl font-display font-bold text-primary tracking-wider">{successOrder.orderCode}</p>
            <div className="mt-4 pt-4 border-t border-border/50">
              <p className="text-sm text-muted-foreground">Total do pedido</p>
              <p className="text-2xl font-display font-bold text-foreground mt-1">R$ {fmtBRL(successOrder.total)}</p>
            </div>
          </div>
          <div className="flex gap-3 justify-center mt-8">
            <a href="/client/history" className="px-6 py-3 bg-primary text-white font-bold rounded-xl hover:-translate-y-0.5 transition-transform">
              Ver Meus Pedidos
            </a>
            <button onClick={() => { setSuccessOrder(null); setCart({}); setOrderNote(""); if (cartKey) localStorage.removeItem(cartKey); }}
              className="px-6 py-3 border-2 border-border font-bold rounded-xl text-muted-foreground hover:bg-muted transition-colors">
              Novo Pedido
            </button>
          </div>
        </div>
      </Layout>
    );
  }

  if (!activeWindow) {
    return (
      <Layout>
        <div className="bg-card rounded-2xl p-12 text-center border border-border/50 premium-shadow max-w-2xl mx-auto mt-12">
          <Clock className="w-16 h-16 text-muted-foreground mx-auto mb-4" />
          <h2 className="text-3xl font-display font-bold text-foreground">Pedidos Indisponíveis</h2>
          <p className="text-muted-foreground mt-3 text-lg">Prazo de pedidos encerrado. Aguarde a próxima janela.</p>
        </div>
      </Layout>
    );
  }

  // Test mode blocking screen (maintenance is handled at router level in App.tsx)
  if (testModeActive) {
    return (
      <Layout>
        <div className="bg-amber-50 border-2 border-amber-300 rounded-2xl p-12 text-center max-w-2xl mx-auto mt-12">
          <FlaskConical className="w-16 h-16 text-amber-500 mx-auto mb-4" />
          <h2 className="text-2xl font-display font-bold text-amber-800">Sistema em Modo Teste</h2>
          <p className="text-amber-700 mt-3 text-base font-medium">
            Criação de pedidos temporariamente bloqueada.
          </p>
          <p className="text-amber-600 mt-2 text-sm">
            O sistema está em modo de testes. Pedidos não podem ser criados neste momento. Entre em contato com o administrador para mais informações.
          </p>
          <a href="/client/history"
            className="inline-flex items-center gap-2 mt-6 px-6 py-3 bg-amber-500 text-white font-bold rounded-xl hover:bg-amber-600 transition-colors">
            Ver Meus Pedidos
          </a>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      {/* Reopen (SOLICITAR ALTERAÇÃO) modal */}
      {showReopenModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-card rounded-2xl p-8 max-w-md w-full premium-shadow border border-border/50">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-12 h-12 rounded-xl bg-blue-100 flex items-center justify-center">
                <SendHorizonal className="w-6 h-6 text-blue-600" />
              </div>
              <div>
                <h3 className="text-lg font-bold text-foreground">Solicitar Alteração de Pedido</h3>
                <p className="text-xs text-muted-foreground">O administrador irá analisar sua solicitação</p>
              </div>
            </div>
            <p className="text-sm text-muted-foreground mb-4">
              Informe o motivo da alteração. Após a aprovação, você poderá editar o pedido existente.
            </p>
            <textarea
              value={reopenReason}
              onChange={e => setReopenReason(e.target.value)}
              placeholder="Ex: Preciso aumentar a quantidade de bananas, adicionar maçãs..."
              rows={3}
              data-testid="input-reopen-reason"
              className="w-full px-4 py-2.5 rounded-xl border-2 border-border focus:border-primary outline-none resize-none text-sm mb-4"
            />
            <div className="flex gap-3">
              <button onClick={() => { setShowReopenModal(false); setReopenReason(""); }}
                className="flex-1 py-2.5 border-2 border-border text-muted-foreground font-bold rounded-xl hover:bg-muted transition-colors text-sm">
                Cancelar
              </button>
              <button
                onClick={() => {
                  if (!reopenTargetId || reopenReason.trim().length < 3) {
                    toast({ title: 'Informe o motivo da alteração (mínimo 3 caracteres)', variant: 'destructive' });
                    return;
                  }
                  requestReopenMut.mutate({ id: reopenTargetId, reason: reopenReason.trim() });
                }}
                disabled={requestReopenMut.isPending || reopenReason.trim().length < 3}
                data-testid="button-confirm-reopen"
                className="flex-1 py-2.5 bg-blue-600 text-white font-bold rounded-xl hover:bg-blue-700 transition-colors text-sm disabled:opacity-50">
                {requestReopenMut.isPending ? 'Enviando...' : 'Enviar Solicitação'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Minimum weekly billing warning modal */}
      {showBillingWarning && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-card rounded-2xl p-8 max-w-md w-full premium-shadow border border-border/50">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-12 h-12 rounded-xl bg-orange-100 flex items-center justify-center">
                <AlertTriangle className="w-6 h-6 text-orange-600" />
              </div>
              <div>
                <h3 className="text-lg font-bold text-foreground">Faturamento mínimo não atingido</h3>
                <p className="text-xs text-muted-foreground">Verifique os valores antes de continuar</p>
              </div>
            </div>
            <div className="bg-orange-50 border border-orange-200 rounded-xl p-4 mb-5 space-y-1.5 text-sm">
              <p className="font-bold text-orange-800">
                ATENÇÃO: o faturamento mínimo semanal deste contrato é de R$ {fmtBRL(minWeeklyBilling)}.
              </p>
              <p className="text-orange-700">
                O valor total de pedidos da semana atual é R$ {fmtBRL(projectedWeeklyTotal)}.
              </p>
              <p className="text-orange-700 font-medium">
                Para atingir o mínimo, faltam R$ {fmtBRL(billingShortfall)}.
              </p>
            </div>
            <p className="text-sm text-muted-foreground mb-5">
              Para finalizar os pedidos da semana é necessário atingir o valor mínimo, ou você pode continuar assim mesmo.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setShowBillingWarning(false)}
                data-testid="button-billing-add-more"
                className="flex-1 py-2.5 bg-primary text-white font-bold rounded-xl hover:bg-primary/90 transition-colors text-sm">
                Adicionar Mais Produtos
              </button>
              <button
                onClick={() => { setShowBillingWarning(false); handleSubmit(true); }}
                data-testid="button-billing-continue"
                className="flex-1 py-2.5 border-2 border-border text-muted-foreground font-bold rounded-xl hover:bg-muted transition-colors text-sm">
                Continuar Pedido
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Module 1: Day-switch warning modal */}
      {pendingDay && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-card rounded-2xl p-8 max-w-md w-full premium-shadow border border-border/50">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-12 h-12 rounded-xl bg-orange-100 flex items-center justify-center">
                <AlertTriangle className="w-6 h-6 text-orange-600" />
              </div>
              <h3 className="text-lg font-bold text-foreground">Pedido em andamento</h3>
            </div>
            <p className="text-muted-foreground mb-6 leading-relaxed">
              Você já iniciou um pedido para <strong>{selectedDay}</strong>. Para mudar o dia de entrega para <strong>{pendingDay}</strong>, é necessário cancelar o pedido atual.
            </p>
            <div className="flex gap-3">
              <button onClick={() => setPendingDay(null)}
                className="flex-1 py-2.5 border-2 border-border text-muted-foreground font-bold rounded-xl hover:bg-muted transition-colors">
                Voltar
              </button>
              <button onClick={handleCancelCurrentOrder}
                className="flex-1 py-2.5 bg-red-600 text-white font-bold rounded-xl hover:bg-red-700 transition-colors">
                Cancelar pedido atual
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="mb-8 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-display font-bold text-foreground">
            {selectedDay ? `Entrega: ${selectedDay}` : "Novo Pedido"}
          </h1>
          <p className="text-muted-foreground mt-1 text-base">{activeWindow.weekReference}</p>
        </div>
        {lastOrderDetail && (
          <button
            data-testid="button-replicate-order"
            onClick={handleReplicateLastOrder}
            disabled={replicating}
            className="flex items-center gap-2 px-5 py-3 bg-secondary/10 hover:bg-secondary/20 text-secondary font-bold rounded-xl transition-all border-2 border-secondary/30"
          >
            <RotateCcw className={`w-4 h-4 ${replicating ? 'animate-spin' : ''}`} />
            Replicar pedido anterior
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Left: Day selector + Catalog */}
        <div className="lg:col-span-2 space-y-6">
          {/* Step 1: Day */}
          <div className="bg-card rounded-2xl border border-border/50 premium-shadow p-6">
            <h2 className="text-base font-bold text-foreground mb-4 flex items-center gap-2">
              <span className="w-6 h-6 rounded-full bg-primary text-white flex items-center justify-center text-xs font-bold">1</span>
              Selecione o Dia de Entrega
            </h2>
            <div className="flex flex-wrap gap-2">
              {allowedDays.filter(d => DAY_OPTIONS.includes(d)).map(day => {
                const isSelected = selectedDay === day;
                const isBlocked = cartHasItems && !isSelected;
                return (
                  <button key={day} data-testid={`button-select-day-${day}`}
                    onClick={() => handleDayClick(day)}
                    className={`px-5 py-3 rounded-xl font-bold text-sm border-2 transition-all flex items-center gap-2 ${
                      isSelected
                        ? 'bg-primary text-white border-primary shadow-lg shadow-primary/20'
                        : isBlocked
                        ? 'border-border/50 text-muted-foreground/50 bg-muted/30 cursor-pointer'
                        : 'border-border text-muted-foreground hover:border-primary/40'
                    }`}>
                    {isBlocked && <Lock className="w-3 h-3" />}
                    {day}
                  </button>
                );
              })}
              {allowedDays.length === 0 && (
                <p className="text-sm text-muted-foreground">Nenhum dia configurado. Contate o administrador.</p>
              )}
            </div>
            {cartHasItems && selectedDay && (
              <div className="mt-3 flex items-center gap-2 p-2.5 bg-orange-50 border border-orange-200 rounded-xl text-sm">
                <Lock className="w-3.5 h-3.5 text-orange-600 flex-shrink-0" />
                <span className="text-orange-700 font-medium">
                  Pedido vinculado a <strong>{selectedDay}</strong>. Para trocar o dia, clique em outro dia e cancele o pedido atual.
                </span>
              </div>
            )}
            {/* Module 2 fix: show selected day name directly, not a computed date */}
            {selectedDay && deliveryDate && (
              <div className="mt-3 flex items-center gap-2 text-sm font-semibold text-primary">
                <CheckCircle2 className="w-4 h-4" />
                Dia de entrega: <strong>{selectedDay}</strong>
              </div>
            )}
            {selectedDay && !deliveryDate && (
              <p className="mt-3 text-sm text-red-500 font-semibold">Este dia não está disponível na janela de entrega atual.</p>
            )}
          </div>

          {/* Step 2: Product catalog */}
          <div className="bg-card rounded-2xl border border-border/50 premium-shadow overflow-hidden">
            <div className="p-5 border-b border-border/50 bg-muted/20 flex items-center gap-2 flex-wrap">
              <span className="w-6 h-6 rounded-full bg-primary text-white flex items-center justify-center text-xs font-bold flex-shrink-0">2</span>
              <h2 className="text-base font-bold text-foreground">Catálogo de Produtos</h2>
              <span className="ml-auto text-xs font-bold text-muted-foreground">{visibleProducts.length}/{availableProducts.length} produto(s)</span>
            </div>

            {/* Fruit Curiosity compact */}
            <div className="px-5 pt-4">
              <FruitCuriosities compact />
            </div>

            {/* Filters */}
            <div className="p-4 border-b border-border/50 bg-muted/10 flex flex-wrap gap-2 items-center">
              <div className="relative flex-1 min-w-[160px] max-w-xs">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                <input value={search} onChange={e => setSearch(e.target.value)}
                  placeholder="Buscar produto..."
                  className="w-full pl-8 pr-4 py-2 rounded-xl border-2 border-border text-sm focus:border-primary outline-none" />
                {search && <button onClick={() => setSearch("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground"><X className="w-3 h-3" /></button>}
              </div>
              <div className="flex gap-1.5 flex-wrap">
                <button onClick={() => setFilterCategory("ALL")}
                  className={`px-3 py-1.5 rounded-xl text-xs font-bold border-2 transition-all ${filterCategory === 'ALL' ? 'bg-primary text-white border-primary' : 'border-border text-muted-foreground hover:border-primary/50'}`}>
                  Todos
                </button>
                {categories.map(cat => (
                  <button key={cat} onClick={() => setFilterCategory(cat)}
                    className={`px-3 py-1.5 rounded-xl text-xs font-bold border-2 transition-all ${filterCategory === cat ? 'bg-primary text-white border-primary' : 'border-border text-muted-foreground hover:border-primary/50'}`}>
                    {cat}
                  </button>
                ))}
              </div>
            </div>

            {visibleProducts.length === 0 ? (
              <div className="p-12 text-center">
                <Package className="w-12 h-12 text-muted-foreground mx-auto mb-3" />
                <p className="text-muted-foreground font-medium">
                  {availableProducts.length === 0 ? "Nenhum produto disponível." : "Nenhum produto nesta categoria."}
                </p>
              </div>
            ) : (
              <div className="divide-y divide-border/50">
                {visibleProducts.map(product => {
                  if (!product || !product.price) return null; // defensive guard
                  const qty = cart[product.id] || 0;
                  const subtotal = qty * product.price;
                  return (
                    <div key={product.id} className={`p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4 transition-colors ${qty > 0 ? 'bg-primary/[0.03]' : 'hover:bg-muted/10'}`}>
                      <div className="flex items-center gap-4">
                        <div className={`w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0 ${qty > 0 ? 'bg-primary/15' : 'bg-muted'}`}>
                          <Package className={`w-6 h-6 ${qty > 0 ? 'text-primary' : 'text-muted-foreground'}`} />
                        </div>
                        <div>
                          <h3 className="font-bold text-foreground">{product.name}</h3>
                          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">{product.category}</p>
                          {(product as any).observation && (
                            <p className="text-xs text-muted-foreground italic mt-0.5">{(product as any).observation}</p>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-5">
                        <div className="text-right min-w-[80px]">
                          <p className="font-display font-bold text-lg text-primary">R$ {fmtBRL(product.price)}</p>
                          <p className="text-xs text-muted-foreground">por {product.unit}</p>
                        </div>
                        <div className="flex items-center gap-1 bg-background border-2 border-border rounded-xl overflow-hidden">
                          <button data-testid={`button-decrease-${product.id}`}
                            onClick={() => handleUpdateCart(product.id, qty - 1)}
                            className="w-9 h-9 flex items-center justify-center text-muted-foreground hover:bg-muted transition-colors">
                            <Minus className="w-4 h-4" />
                          </button>
                          <input type="number" min="0" value={qty || ''}
                            onChange={e => handleUpdateCart(product.id, parseInt(e.target.value) || 0)}
                            className="w-12 text-center font-bold bg-transparent outline-none text-foreground" placeholder="0" />
                          <button data-testid={`button-increase-${product.id}`}
                            onClick={() => handleUpdateCart(product.id, qty + 1)}
                            className="w-9 h-9 flex items-center justify-center bg-primary/10 text-primary hover:bg-primary/20 transition-colors">
                            <Plus className="w-4 h-4" />
                          </button>
                        </div>
                        <div className="text-right min-w-[80px]">
                          {qty > 0 ? <p className="font-bold text-sm text-foreground">R$ {fmtBRL(subtotal)}</p>
                            : <p className="text-xs text-muted-foreground">—</p>}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Step 3: Order note */}
          <div className="bg-card rounded-2xl border border-border/50 premium-shadow p-6">
            <h2 className="text-base font-bold text-foreground mb-4 flex items-center gap-2">
              <span className="w-6 h-6 rounded-full bg-primary text-white flex items-center justify-center text-xs font-bold">3</span>
              Observação do Pedido
            </h2>
            <textarea data-testid="input-order-note" value={orderNote}
              onChange={e => setOrderNote(e.target.value)} rows={4}
              placeholder={ORDER_NOTE_PLACEHOLDER}
              className="w-full px-4 py-3 rounded-xl border-2 border-border focus:border-primary outline-none resize-none text-foreground placeholder:text-muted-foreground" />
            <p className="text-xs text-muted-foreground mt-2 flex items-center gap-1">
              <FileText className="w-3 h-3" /> Esta observação é enviada ao time da VivaFrutaz.
            </p>
          </div>
        </div>

        {/* Right: Cart summary */}
        <div className="lg:col-span-1">
          <div className="bg-card rounded-2xl border border-border/50 premium-shadow sticky top-8">
            <div className="p-5 border-b border-border/50 bg-primary rounded-t-2xl text-primary-foreground flex items-center justify-between">
              <h2 className="font-bold text-base flex items-center gap-2">
                <ShoppingCart className="w-5 h-5" /> Carrinho
              </h2>
              {cartItems.length > 0 && (
                <span className="bg-white/20 text-white text-xs font-bold px-2 py-0.5 rounded-full">{cartItems.length} item(s)</span>
              )}
            </div>
            <div className="p-5">
              {cartItems.length === 0 ? (
                <div className="py-10 text-center">
                  <ShoppingCart className="w-10 h-10 text-muted-foreground/30 mx-auto mb-2" />
                  <p className="text-muted-foreground text-sm">Carrinho vazio</p>
                </div>
              ) : (
                <div className="space-y-0 divide-y divide-border/50 max-h-[45vh] overflow-y-auto">
                  {cartItems.map(({ product, qty, subtotal }) => (
                    <div key={product.id} className="py-3 flex justify-between items-start gap-2">
                      <div className="flex-1 min-w-0">
                        <p className="font-bold text-sm text-foreground truncate">{product.name}</p>
                        <p className="text-xs text-muted-foreground mt-0.5">{qty} × R$ {fmtBRL(product.price)}</p>
                      </div>
                      <div className="text-right flex-shrink-0 flex items-center gap-2">
                        <p className="font-bold text-sm text-foreground">R$ {fmtBRL(subtotal)}</p>
                        <button onClick={() => handleUpdateCart(product.id, 0)}
                          className="p-1 rounded text-muted-foreground hover:text-red-500 transition-colors">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              <div className="border-t border-border/50 mt-4 pt-4 space-y-4">
                <div className="flex justify-between items-center">
                  <p className="font-bold text-foreground">Total</p>
                  <p className="text-2xl font-display font-bold text-primary">R$ {fmtBRL(cartTotal)}</p>
                </div>

                {/* Weekly minimum billing indicator */}
                {minWeeklyBilling > 0 && (
                  <div className={`p-3 rounded-xl border text-xs ${projectedWeeklyTotal >= minWeeklyBilling ? 'bg-green-50 border-green-200' : 'bg-orange-50 border-orange-200'}`}>
                    <div className="flex justify-between items-center mb-1.5">
                      <span className={`font-bold ${projectedWeeklyTotal >= minWeeklyBilling ? 'text-green-700' : 'text-orange-700'}`}>
                        Faturamento semanal
                      </span>
                      <span className={`font-bold ${projectedWeeklyTotal >= minWeeklyBilling ? 'text-green-700' : 'text-orange-700'}`}>
                        R$ {fmtBRL(projectedWeeklyTotal)} / R$ {fmtBRL(minWeeklyBilling)}
                      </span>
                    </div>
                    <div className="w-full bg-white/60 rounded-full h-1.5">
                      <div className={`h-1.5 rounded-full transition-all ${projectedWeeklyTotal >= minWeeklyBilling ? 'bg-green-500' : 'bg-orange-400'}`}
                        style={{ width: `${Math.min(100, (projectedWeeklyTotal / minWeeklyBilling) * 100)}%` }} />
                    </div>
                    {billingShortfall > 0 && (
                      <p className="text-orange-600 mt-1.5 font-medium">Faltam R$ {fmtBRL(billingShortfall)} para o mínimo semanal.</p>
                    )}
                  </div>
                )}

                {/* Date-lock: block submission if order already exists for this delivery date */}
                {existingOrderForDate && existingOrderForDate.status !== 'OPEN_FOR_EDITING' ? (
                  <div className="rounded-xl border-2 border-orange-200 bg-orange-50 p-4 space-y-3">
                    <div className="flex items-center gap-2 text-orange-700">
                      <Lock className="w-5 h-5 flex-shrink-0" />
                      <p className="font-bold text-sm">Já existe um pedido registrado para este dia.</p>
                    </div>
                    <p className="text-orange-600 text-xs">
                      Pedido <span className="font-mono font-bold">{existingOrderForDate.orderCode || `#${existingOrderForDate.id}`}</span>{' '}
                      — <span className="font-bold">{existingOrderForDate.status === 'CONFIRMED' ? 'Confirmado' : existingOrderForDate.status === 'REOPEN_REQUESTED' ? 'Solicitação enviada, aguardando aprovação' : existingOrderForDate.status}</span>
                    </p>
                    {existingOrderForDate.status === 'REOPEN_REQUESTED' ? (
                      <div className="flex items-center gap-2 p-3 bg-blue-50 border border-blue-200 rounded-xl text-xs text-blue-700 font-medium">
                        <Clock className="w-4 h-4 flex-shrink-0" />
                        Solicitação de alteração enviada. Aguardando aprovação do administrador.
                      </div>
                    ) : reopenSuccess ? (
                      <div className="flex items-center gap-2 p-3 bg-green-50 border border-green-200 rounded-xl text-xs text-green-700 font-bold">
                        <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
                        Solicitação enviada com sucesso! O administrador irá liberar a edição.
                      </div>
                    ) : (
                      <div className="flex gap-2 flex-wrap">
                        <button
                          data-testid="button-request-reopen"
                          onClick={() => {
                            setReopenTargetId(existingOrderForDate.id);
                            setReopenSuccess(false);
                            setShowReopenModal(true);
                          }}
                          className="flex items-center gap-2 px-4 py-2.5 bg-blue-600 text-white font-bold rounded-xl text-sm hover:bg-blue-700 transition-colors">
                          <SendHorizonal className="w-4 h-4" />
                          Solicitar Alteração
                        </button>
                        <a href="/client/history"
                          data-testid="button-view-existing-order"
                          className="inline-flex items-center gap-2 px-4 py-2.5 border-2 border-orange-300 text-orange-700 font-bold rounded-xl text-sm hover:bg-orange-100 transition-colors">
                          Ver pedido
                        </a>
                      </div>
                    )}
                    <p className="text-orange-500 text-xs">
                      Caso precise alterar, solicite abertura do pedido ao administrador.
                    </p>
                  </div>
                ) : (
                  <>
                    <button data-testid="button-submit-order" onClick={() => handleSubmit(false)}
                      disabled={!selectedDay || !deliveryDate || cartItems.length === 0 || createOrder.isPending || submitting || !!existingOrderForDate}
                      className="w-full py-3.5 bg-secondary text-secondary-foreground font-bold rounded-xl shadow-lg shadow-secondary/20 hover:-translate-y-0.5 transition-all disabled:opacity-50 disabled:transform-none flex justify-center items-center gap-2">
                      <CheckCircle2 className="w-5 h-5" />
                      {submitting || createOrder.isPending ? "Processando pedido..." : "Confirmar Pedido"}
                    </button>
                    {!selectedDay && cartItems.length > 0 && (
                      <p className="text-red-500 text-xs font-medium text-center">Selecione um dia de entrega.</p>
                    )}
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </Layout>
  );
}
