import { useState, useMemo, useEffect } from "react";
import { useAuth } from "@/hooks/use-auth";
import { useOrderDetail, useCompanyOrders } from "@/hooks/use-ordering";
import { useProducts } from "@/hooks/use-catalog";
import { Layout } from "@/components/Layout";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import { useLocation, useRoute, Redirect } from "wouter";
import { ShoppingCart, Package, Minus, Plus, Trash2, CheckCircle2, ArrowLeft, Lock } from "lucide-react";
import { api } from "@shared/routes";

function fmtBRL(n: number) {
  return n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function EditOrderPage() {
  const { company, isLoading: authLoading } = useAuth();
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
    const adminFee = Number(company.adminFee || 0);
    return products
      .filter(p => p.active && p.basePrice)
      .map(product => {
        const base = Number(product.basePrice);
        const finalPrice = base * (1 + adminFee / 100);
        return { ...product, price: Math.round(finalPrice * 100) / 100 };
      });
  }, [products, company]);

  const cartItems = useMemo(() => {
    return Object.entries(cart)
      .filter(([, qty]) => qty > 0)
      .map(([productId, qty]) => {
        const p = availableProducts.find(x => x.id === Number(productId));
        if (!p) return null;
        return { product: p, qty, subtotal: p.price * qty };
      })
      .filter(Boolean) as { product: any; qty: number; subtotal: number }[];
  }, [cart, availableProducts]);

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
      const res = await fetch(`/api/orders/${orderId}/finalize-edit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items }),
        credentials: 'include',
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

  return (
    <Layout>
      <div className="max-w-5xl mx-auto">
        <div className="flex items-center gap-4 mb-8">
          <button onClick={() => navigate("/client/history")}
            className="p-2 rounded-xl border-2 border-border hover:border-primary/50 text-muted-foreground hover:text-primary transition-colors">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div>
            <h1 className="text-2xl font-display font-bold text-foreground">Editar Pedido</h1>
            {order && (
              <p className="text-muted-foreground text-sm mt-0.5">
                {order.orderCode} — Entrega solicitada
              </p>
            )}
          </div>
        </div>

        {orderLoading || !initialized ? (
          <div className="text-center py-16 text-muted-foreground animate-pulse">Carregando pedido...</div>
        ) : (
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
