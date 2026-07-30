import { useState, useMemo, useEffect } from "react";
import { useAuth } from "@/hooks/use-auth";
import { useOrderDetail, useCompanyOrders } from "@/hooks/use-ordering";
import { useProducts } from "@/hooks/use-catalog";
import { Layout } from "@/components/Layout";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import { useLocation, useRoute, Redirect } from "wouter";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { ShoppingCart, Package, Minus, Plus, Trash2, CheckCircle2, ArrowLeft, Lock, Ban } from "lucide-react";
import { BackHeader } from "@/components/navigation/BackHeader";
import { api } from "@shared/routes";
import { resolvePrice } from "@/utils/priceResolver";
import { calculateOrderModificationDeadline, logDeadlineAudit } from "@/lib/order-deadline";

function fmtBRL(n: number) {
  return n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function EditOrderPage() {
  const { user, company, isLoading: authLoading } = useAuth();
  const { data: products } = useProducts();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [, navigate] = useLocation();
  const [, params] = useRoute("/client/order/edit/:id");
  const orderId = params?.id ? Number(params.id) : undefined;

  const { data: orderDetail, isLoading: orderLoading } = useOrderDetail(orderId);
  const [cart, setCart] = useState<Record<number, number>>({});
  const [initialized, setInitialized] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Pre-fill cart from existing order items once loaded
  // [TEMP LOG — DIAGNÓSTICO BUG EDIT] Remover após identificar causa.
  useEffect(() => {
    console.log('[EDIT_ORDER]', { id: orderId, pedido: orderDetail ?? null });
  }, [orderId, orderDetail]);

  useEffect(() => {
    if (orderDetail && !initialized) {
      const initCart: Record<number, number> = {};
      (orderDetail.items || []).forEach((item: any) => {
        initCart[Number(item.productId)] = item.quantity;
      });
      setCart(initCart);
      setInitialized(true);
    }
  }, [orderDetail, initialized]);

  const availableProducts = useMemo(() => {
    if (!products || !company) return [];
    return products
      .filter(p => p.active)
      .map(product => {
        const price = resolvePrice({
          basePrice: product.basePrice,
          subCategoryPrice: (product as any).subCategoryPrice,
          contractPrice: (product as any).contractPrice,
          adminFee: company.adminFee,
          useNewPricing: (company as any).useNewPricing === true,
          pricingMode: (product as any).pricingMode,
        });
        return { ...product, price };
      })
      .filter(p => p.price > 0);
  }, [products, company]);

  // Índice de todos os itens originais do pedido, indexado por productId.
  // Usado para recuperar o unitPrice registrado no momento do pedido —
  // fonte de verdade de preço para itens já existentes.
  const orderItemsByProductId = useMemo(() => {
    const map: Record<number, any> = {};
    (orderDetail?.items || []).forEach((item: any) => {
      map[Number(item.productId)] = item;
    });
    return map;
  }, [orderDetail?.items]);

  const cartItems = useMemo(() => {
    return Object.entries(cart)
      .filter(([, qty]) => qty > 0)
      .map(([productId, qty]) => {
        const pid = Number(productId);

        // 1️⃣ Item novo adicionado durante a edição → usa availableProducts
        //    (catálogo filtrado com preço resolvido pelo modelo de preços).
        const fromCatalog = availableProducts.find(x => x.id === pid);
        if (fromCatalog) {
          return { product: fromCatalog, qty, subtotal: fromCatalog.price * qty };
        }

        // 2️⃣ Item pré-existente no pedido → usa unitPrice do próprio order_item.
        //    Preserva itens cujo produto tenha basePrice null, esteja inativo
        //    ou cujo preço venha de contrato/subcategoria não resolvível no
        //    catálogo atual. O preço gravado no pedido é a fonte de verdade.
        const orderItem = orderItemsByProductId[pid];
        if (orderItem) {
          const unitPrice = Number(orderItem.unitPrice) || 0;
          // Tenta enriquecer com o nome/categoria do catálogo bruto se disponível.
          const rawProduct = (products || []).find((x: any) => x.id === pid);
          const product = rawProduct
            ? { ...rawProduct, price: unitPrice }
            : { id: pid, name: `Produto #${pid}`, price: unitPrice };
          return { product, qty, subtotal: unitPrice * qty };
        }

        return null;
      })
      .filter(Boolean) as { product: any; qty: number; subtotal: number }[];
  }, [cart, availableProducts, orderItemsByProductId, products]);

  const cartTotal = useMemo(() => cartItems.reduce((s, i) => s + i.subtotal, 0), [cartItems]);

  const handleUpdateCart = (productId: number, qty: number) => {
    setCart(prev => {
      const next = { ...prev };
      if (qty <= 0) delete next[productId];
      else next[productId] = qty;
      return next;
    });
  };

  const handleSubmit = async () => {
    if (cartItems.length === 0) {
      toast({ title: "Adicione pelo menos um item ao pedido.", variant: "destructive" });
      return;
    }
    if (submitting) return;
    setSubmitting(true);
    try {
      const items = cartItems.map(({ product, qty }) => ({
        productId: product.id,
        quantity: qty,
        unitPrice: String(product.price),
        totalPrice: String(product.price * qty),
      }));
      const res = await fetchWithAuth(`/api/orders/${orderId}/finalize-edit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items }),
      });
      if (!res.ok) {
        const d = await res.json();
        throw new Error(d.message || 'Erro ao salvar pedido.');
      }
      queryClient.invalidateQueries({ queryKey: [api.orders.companyOrders.path] });
      queryClient.invalidateQueries({ queryKey: [api.orders.get.path, orderId] });
      toast({ title: "Pedido atualizado e confirmado com sucesso!" });
      navigate("/client/history");
    } catch (e: any) {
      toast({ title: e.message || "Erro ao salvar pedido", variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  if (!authLoading && !company) return <Redirect to="/client" />;
  if (!orderLoading && orderDetail && orderDetail.order.status !== 'OPEN_FOR_EDITING') {
    return <Redirect to="/client/history" />;
  }

  const order = orderDetail?.order;

  // Prazo operacional expirado: bloqueia edição mesmo que o admin tenha aprovado a reabertura.
  // Usa a função canônica de order-deadline — mesma regra para todos os pontos de ação.
  const deadlineCheckForEdit = order?.deliveryDate
    ? calculateOrderModificationDeadline(order.deliveryDate)
    : null;
  const deadlineExpiredForEdit = deadlineCheckForEdit ? !deadlineCheckForEdit.canModify : false;

  // Auditoria: log da verificação de prazo ao carregar a página (uma vez por orderId/deliveryDate)
  useEffect(() => {
    if (!order?.deliveryDate || !orderId) return;
    const result = calculateOrderModificationDeadline(order.deliveryDate);
    logDeadlineAudit({ orderId, companyId: company?.id, userId: user?.id, now: new Date().toISOString(), deadline: result.deadline.toISOString(), canModify: result.canModify, reason: result.reason, action: "edit" });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [order?.deliveryDate, orderId]);

  return (
    <Layout>
      <div className="max-w-5xl mx-auto">
        <BackHeader
          fallback="/client/history"
          breadcrumb={[{ label: "Meus Pedidos", href: "/client/history" }, { label: "Editar Pedido" }]}
        />
        <div className="mb-8">
          <h1 className="text-2xl font-display font-bold text-foreground">Editar Pedido</h1>
          {order && (
            <p className="text-muted-foreground text-sm mt-0.5">
              {order.orderCode} — Entrega solicitada
            </p>
          )}
        </div>

        {deadlineExpiredForEdit && (
          <div className="rounded-2xl border border-red-200 bg-red-50 p-6 flex items-start gap-4">
            <Ban className="w-6 h-6 text-red-500 flex-shrink-0 mt-0.5" />
            <div>
              <p className="font-bold text-red-700 text-base mb-1">Prazo operacional expirado</p>
              <p className="text-sm text-red-600">
                Este pedido foi reaberto, porém o prazo operacional para alterações já foi encerrado.
              </p>
              <p className="text-sm text-red-600 mt-2">
                Alterações são permitidas somente até às 12h00 do segundo dia útil anterior à data de entrega.
              </p>
            </div>
          </div>
        )}

        {orderLoading || !initialized ? (
          <div className="text-center py-16 text-muted-foreground animate-pulse">Carregando pedido...</div>
        ) : deadlineExpiredForEdit ? null : (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Product list */}
            <div className="lg:col-span-2">
              <div className="bg-card rounded-2xl border border-border/50 premium-shadow overflow-hidden">
                <div className="p-4 border-b border-border/50 bg-primary/5">
                  <p className="font-bold text-foreground flex items-center gap-2">
                    <Package className="w-4 h-4 text-primary" /> Produtos Disponíveis
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5">Ajuste quantidades ou adicione novos itens ao pedido</p>
                </div>
                <div className="divide-y divide-border/50 max-h-[60vh] overflow-y-auto">
                  {availableProducts.map(product => {
                    const qty = cart[product.id] || 0;
                    return (
                      <div key={product.id} className="flex items-center justify-between p-4 hover:bg-muted/20 transition-colors">
                        <div className="flex-1 min-w-0">
                          <p className="font-bold text-sm text-foreground">{product.name}</p>
                          <p className="text-xs text-muted-foreground">{product.category}</p>
                          <p className="text-sm font-bold text-primary mt-0.5">R$ {fmtBRL(product.price)}</p>
                        </div>
                        <div className="flex items-center gap-2 flex-shrink-0">
                          {qty > 0 ? (
                            <>
                              <button onClick={() => handleUpdateCart(product.id, qty - 1)}
                                data-testid={`button-decrease-${product.id}`}
                                className="w-8 h-8 rounded-lg bg-primary/10 text-primary flex items-center justify-center hover:bg-primary hover:text-white transition-colors font-bold">
                                <Minus className="w-3.5 h-3.5" />
                              </button>
                              <span className="w-8 text-center font-bold text-sm text-foreground">{qty}</span>
                              <button onClick={() => handleUpdateCart(product.id, qty + 1)}
                                data-testid={`button-increase-${product.id}`}
                                className="w-8 h-8 rounded-lg bg-primary/10 text-primary flex items-center justify-center hover:bg-primary hover:text-white transition-colors font-bold">
                                <Plus className="w-3.5 h-3.5" />
                              </button>
                            </>
                          ) : (
                            <button onClick={() => handleUpdateCart(product.id, 1)}
                              data-testid={`button-add-${product.id}`}
                              className="px-4 py-1.5 bg-primary/10 text-primary rounded-lg hover:bg-primary hover:text-white transition-colors font-bold text-sm">
                              Adicionar
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* Cart sidebar */}
            <div className="lg:col-span-1">
              <div className="bg-card rounded-2xl border border-border/50 premium-shadow sticky top-4">
                <div className="p-4 border-b border-border/50 bg-secondary/5 flex items-center gap-2">
                  <ShoppingCart className="w-4 h-4 text-secondary" />
                  <p className="font-bold text-foreground">Resumo do Pedido</p>
                </div>
                <div className="p-4">
                  {cartItems.length === 0 ? (
                    <div className="py-8 text-center">
                      <ShoppingCart className="w-8 h-8 text-muted-foreground/30 mx-auto mb-2" />
                      <p className="text-muted-foreground text-sm">Nenhum item</p>
                    </div>
                  ) : (
                    <div className="space-y-0 divide-y divide-border/50 max-h-[40vh] overflow-y-auto">
                      {cartItems.map(({ product, qty, subtotal }) => (
                        <div key={product.id} className="py-3 flex justify-between items-start gap-2">
                          <div className="flex-1 min-w-0">
                            <p className="font-bold text-sm text-foreground truncate">{product.name}</p>
                            <p className="text-xs text-muted-foreground">{qty} × R$ {fmtBRL(product.price)}</p>
                          </div>
                          <div className="text-right flex-shrink-0 flex items-center gap-1.5">
                            <p className="font-bold text-sm">R$ {fmtBRL(subtotal)}</p>
                            <button onClick={() => handleUpdateCart(product.id, 0)}
                              className="p-1 rounded text-muted-foreground hover:text-red-500 transition-colors">
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="border-t border-border/50 mt-4 pt-4 space-y-3">
                    <div className="flex justify-between items-center">
                      <p className="font-bold text-foreground">Total</p>
                      <p className="text-xl font-display font-bold text-primary">R$ {fmtBRL(cartTotal)}</p>
                    </div>
                    <button
                      data-testid="button-finalize-edit"
                      onClick={handleSubmit}
                      disabled={cartItems.length === 0 || submitting}
                      className="w-full py-3.5 bg-secondary text-secondary-foreground font-bold rounded-xl shadow-lg shadow-secondary/20 hover:-translate-y-0.5 transition-all disabled:opacity-50 disabled:transform-none flex justify-center items-center gap-2">
                      <CheckCircle2 className="w-5 h-5" />
                      {submitting ? "Finalizando..." : "Confirmar Pedido"}
                    </button>
                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <Lock className="w-3.5 h-3.5" />
                      <p>Após confirmar, o pedido será travado novamente.</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </Layout>
  );
}
