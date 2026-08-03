/**
 * edit-order.tsx — Editar Pedido
 *
 * Architecture mirrors create-order.tsx exactly:
 *   • catalog built by buildOrderCatalog() — shared helper, same resolvePrice() chain
 *   • cartKey = "sc_<subCategoryId>" | "p_<productId>" — same format as create-order
 *   • EXISTING items: price comes from order_items.unitPrice (historic, never recalculated)
 *   • NEW items added during edit: price comes from resolvePrice() via buildOrderCatalog
 *   • Submit: historicPriceByCartKey[key] ?? entry.price — never writes 0 over a saved price
 */
import { useState, useMemo, useEffect } from "react";
import { useAuth } from "@/hooks/use-auth";
import { useOrderDetail } from "@/hooks/use-ordering";
import { useProducts } from "@/hooks/use-catalog";
import { Layout } from "@/components/Layout";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import { useLocation, useRoute, Redirect } from "wouter";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { ShoppingCart, Package, Minus, Plus, Trash2, CheckCircle2, Lock, Ban, Search, X } from "lucide-react";
import { BackHeader } from "@/components/navigation/BackHeader";
import { api } from "@shared/routes";
import { buildOrderCatalog, itemToCartKey, type ProductEntry } from "@/utils/buildOrderCatalog";
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

  // cart keys are "sc_<subCategoryId>" | "p_<productId>" — same as create-order
  const [cart, setCart] = useState<Record<string, number>>({});
  const [initialized, setInitialized] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [search, setSearch] = useState("");

  // ── Pre-fill cart from existing order items once loaded ─────────────────────
  // Maps each existing item to the same cartKey format used in create-order.
  useEffect(() => {
    if (orderDetail && !initialized) {
      const initCart: Record<string, number> = {};
      (orderDetail.items || []).forEach((item: any) => {
        const key = itemToCartKey(item);
        initCart[key] = item.quantity;
      });
      setCart(initCart);
      setInitialized(true);
    }
  }, [orderDetail, initialized]);

  // ── Historic price index ────────────────────────────────────────────────────
  // cartKey → unitPrice recorded at order creation.
  // This is the source of truth for existing items and must NEVER be overwritten
  // by a recalculated price, even if the product is inactive or basePrice is null.
  const historicPriceByCartKey = useMemo(() => {
    const map: Record<string, number> = {};
    (orderDetail?.items || []).forEach((item: any) => {
      const key = itemToCartKey(item);
      const price = Number(item.unitPrice);
      if (Number.isFinite(price) && price > 0) map[key] = price;
    });
    return map;
  }, [orderDetail?.items]);

  // ── Available products (active gate — mirrors create-order.tsx exactly) ─────
  // No day filter needed for editing: the order's delivery date is already fixed.
  const availableProducts = useMemo(() => {
    if (!products || !company) return [];
    return products.filter((p: any) => p?.active);
  }, [products, company]);

  // ── AUDIT — trace the reduction pipeline (visible in browser console) ────────
  // Tag: [CATALOG-AUDIT] — grep this in the browser DevTools console.
  useEffect(() => {
    if (!products || !company) return;
    const tag = '[CATALOG-AUDIT][edit-order]';
    console.group(tag + ' pipeline');
    console.log('STEP 1 — GET /api/products raw count:', products.length);
    console.table(products.slice(0, 15).map((p: any) => ({
      id: p.id,
      name: p.name,
      basePrice: p.basePrice ?? null,
      contractPrice: p.contractPrice ?? null,
      subCategories_length: (p.subCategories ?? []).length,
    })));
    console.log('STEP 1 — products[0] raw object:\n' + JSON.stringify(products[0], null, 2));
    console.log('STEP 2 — availableProducts (active gate only, no day filter):', availableProducts.length);
    console.log('STEP 3 — first 10 availableProducts detail:',
      availableProducts.slice(0, 10).map((p: any) => ({
        id: p.id,
        name: p.name,
        subCategories_length: (p.subCategories ?? []).length,
        contractPrice: p.contractPrice ?? null,
        basePrice: p.basePrice ?? null,
        availableDays: p.availableDays ?? null,
      }))
    );
    console.log('STEP 4 — company context passed to buildOrderCatalog:', {
      id: (company as any)?.id,
      priceGroupId: (company as any)?.priceGroupId ?? null,
      adminFee: (company as any)?.adminFee ?? null,
      useNewPricing: (company as any)?.useNewPricing ?? null,
    });
    const catalogEntries = buildOrderCatalog(availableProducts, company);
    console.log('STEP 5 — buildOrderCatalog() → entries:', catalogEntries.length);
    if (catalogEntries.length > 0) {
      console.log('STEP 5 — first 5 entries:', catalogEntries.slice(0, 5).map(e => ({
        cartKey: e.cartKey, productId: e.productId, name: e.name, price: e.price,
      })));
    }
    const subCatTotal = availableProducts.reduce(
      (n: number, p: any) => n + ((p.subCategories ?? []).length as number), 0
    );
    const priceZeroCount = availableProducts.reduce((n: number, p: any) => {
      const subs: any[] = (p.subCategories ?? []).filter((sc: any) => sc.active !== false);
      if (subs.length > 0) return n + subs.filter((sc: any) => Number(sc.price) <= 0).length;
      return Number(p.basePrice) <= 0 || p.basePrice == null ? n + 1 : n;
    }, 0);
    console.log('DIAG — total subCategories across active products:', subCatTotal);
    console.log('DIAG — products/subCats with price ≤ 0 (filtered out):', priceZeroCount);
    if (catalogEntries.length < availableProducts.length) {
      console.warn('⚠ REDUCTION DETECTED — some active products have price = 0 after resolvePrice().');
      console.warn('These products need a basePrice, subCategoryPrice > 0, OR a contractPrice');
      console.warn('via the company\'s priceGroup. Check the productPrices table for this company\'s priceGroupId.');
    }
    console.groupEnd();
  }, [products, availableProducts, company]);

  // ── Expanded catalog — exclusively from buildOrderCatalog (req. 1) ──────────
  // CATALOG = buildOrderCatalog(products, company)
  // NEVER built from order.items.
  const allEntries = useMemo((): ProductEntry[] => {
    return buildOrderCatalog(availableProducts, company);
  }, [availableProducts, company]);

  // ── Filtered catalog (search) ───────────────────────────────────────────────
  const filteredEntries = useMemo((): ProductEntry[] => {
    if (!search.trim()) return allEntries;
    const q = search.toLowerCase();
    return allEntries.filter(e =>
      e.name.toLowerCase().includes(q) ||
      e.category.toLowerCase().includes(q) ||
      (e.subCategoryName ?? "").toLowerCase().includes(q)
    );
  }, [allEntries, search]);

  // ── Cart items ──────────────────────────────────────────────────────────────
  // Price resolution:
  //   existing item (cartKey in historicPriceByCartKey) → historic unitPrice
  //   new item added during this edit session          → entry.price (resolvePrice)
  const cartItems = useMemo(() => {
    return Object.entries(cart)
      .filter(([, qty]) => qty > 0)
      .map(([key, qty]) => {
        const entry = allEntries.find(e => e.cartKey === key);
        if (!entry) return null;
        // Historic price takes absolute priority for existing items
        const unitPrice = historicPriceByCartKey[key] ?? entry.price;
        return { entry, qty, unitPrice, subtotal: unitPrice * qty };
      })
      .filter((item): item is { entry: ProductEntry; qty: number; unitPrice: number; subtotal: number } =>
        item !== null
      );
  }, [cart, allEntries, historicPriceByCartKey]);

  const cartTotal = useMemo(() => cartItems.reduce((s, i) => s + i.subtotal, 0), [cartItems]);

  const handleUpdateCart = (key: string, qty: number) => {
    setCart(prev => {
      const next = { ...prev };
      if (qty <= 0) delete next[key];
      else next[key] = qty;
      return next;
    });
  };

  // ── Submit ──────────────────────────────────────────────────────────────────
  // Existing items → historicPriceByCartKey[key]  (recorded price, never 0)
  // New items      → entry.price                  (current resolvePrice result)
  // Safety guard: unitPrice will NEVER be "0" for any valid item because:
  //   • extraEntries with price=0 are effectively unfilterable (no entry found)
  //   • catalog entries with price≤0 are excluded by buildOrderCatalog
  //   • historicPriceByCartKey only stores price>0 values
  const handleSubmit = async () => {
    if (cartItems.length === 0) {
      toast({ title: "Adicione pelo menos um item ao pedido.", variant: "destructive" });
      return;
    }
    if (submitting) return;
    setSubmitting(true);
    try {
      const items = cartItems.map(({ entry, qty, unitPrice }) => ({
        productId: entry.productId,
        quantity: qty,
        unitPrice: String(unitPrice),
        totalPrice: String(unitPrice * qty),
        subCategoryId: entry.subCategoryId ?? null,
        subCategoryName: entry.subCategoryName ?? null,
      }));
      const res = await fetchWithAuth(`/api/orders/${orderId}/finalize-edit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items }),
      });
      if (!res.ok) {
        const d = await res.json();
        throw new Error(d.message || "Erro ao salvar pedido.");
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
  if (!orderLoading && orderDetail && orderDetail.order.status !== "OPEN_FOR_EDITING") {
    return <Redirect to="/client/history" />;
  }

  const order = orderDetail?.order;

  const deadlineCheck = order?.deliveryDate
    ? calculateOrderModificationDeadline(order.deliveryDate)
    : null;
  const deadlineExpired = deadlineCheck ? !deadlineCheck.canModify : false;

  useEffect(() => {
    if (!order?.deliveryDate || !orderId) return;
    const result = calculateOrderModificationDeadline(order.deliveryDate);
    logDeadlineAudit({
      orderId,
      companyId: company?.id,
      userId: user?.id,
      now: new Date().toISOString(),
      deadline: result.deadline.toISOString(),
      canModify: result.canModify,
      reason: result.reason,
      action: "edit",
    });
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

        {deadlineExpired && (
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
        ) : deadlineExpired ? null : (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Catalog */}
            <div className="lg:col-span-2">
              <div className="bg-card rounded-2xl border border-border/50 premium-shadow overflow-hidden">
                <div className="p-4 border-b border-border/50 bg-primary/5 flex items-center justify-between gap-2">
                  <div>
                    <p className="font-bold text-foreground flex items-center gap-2">
                      <Package className="w-4 h-4 text-primary" /> Catálogo de Produtos
                    </p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Ajuste quantidades ou adicione novos itens ao pedido
                    </p>
                  </div>
                  <span className="text-xs font-bold text-muted-foreground">
                    {filteredEntries.length} produto(s)
                  </span>
                </div>

                {/* Search */}
                <div className="p-3 border-b border-border/50 bg-muted/10">
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                    <input
                      value={search}
                      onChange={e => setSearch(e.target.value)}
                      placeholder="Buscar produto..."
                      className="w-full pl-8 pr-8 py-2 rounded-xl border-2 border-border text-sm focus:border-primary outline-none"
                    />
                    {search && (
                      <button
                        onClick={() => setSearch("")}
                        className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground">
                        <X className="w-3 h-3" />
                      </button>
                    )}
                  </div>
                </div>

                <div className="divide-y divide-border/50 max-h-[60vh] overflow-y-auto">
                  {filteredEntries.length === 0 ? (
                    <div className="p-12 text-center">
                      <Package className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
                      <p className="text-muted-foreground text-sm">Nenhum produto encontrado.</p>
                    </div>
                  ) : (
                    filteredEntries.map(entry => {
                      const qty = cart[entry.cartKey] || 0;
                      // Display price: historic for existing items, current for new
                      const displayPrice = historicPriceByCartKey[entry.cartKey] ?? entry.price;
                      const isExisting = entry.cartKey in historicPriceByCartKey;
                      return (
                        <div
                          key={entry.cartKey}
                          className={`flex items-center justify-between p-4 transition-colors ${qty > 0 ? "bg-primary/[0.03]" : "hover:bg-muted/20"}`}
                        >
                          <div className="flex-1 min-w-0">
                            <p className="font-bold text-sm text-foreground">{entry.name}</p>
                            {entry.subCategoryName ? (
                              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                                {entry.subCategoryName}
                              </p>
                            ) : entry.category ? (
                              <p className="text-xs text-muted-foreground">{entry.category}</p>
                            ) : null}
                            <div className="flex items-center gap-1.5 mt-0.5">
                              <p className="text-sm font-bold text-primary">R$ {fmtBRL(displayPrice)}</p>
                              {isExisting && (
                                <span className="text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded font-medium">
                                  preço gravado
                                </span>
                              )}
                            </div>
                          </div>
                          <div className="flex items-center gap-2 flex-shrink-0 ml-3">
                            {qty > 0 ? (
                              <>
                                <button
                                  onClick={() => handleUpdateCart(entry.cartKey, qty - 1)}
                                  data-testid={`button-decrease-${entry.cartKey}`}
                                  className="w-8 h-8 rounded-lg bg-primary/10 text-primary flex items-center justify-center hover:bg-primary hover:text-white transition-colors font-bold"
                                >
                                  <Minus className="w-3.5 h-3.5" />
                                </button>
                                <input
                                  type="number"
                                  min={0}
                                  value={qty}
                                  data-testid={`input-qty-${entry.cartKey}`}
                                  onChange={e => {
                                    const v = parseInt(e.target.value, 10);
                                    handleUpdateCart(entry.cartKey, Number.isNaN(v) ? 0 : v);
                                  }}
                                  onFocus={e => e.target.select()}
                                  className="w-16 text-center font-bold text-sm text-foreground bg-muted/30 border border-border/50 rounded-lg py-1 focus:outline-none focus:ring-2 focus:ring-primary/40"
                                />
                                <button
                                  onClick={() => handleUpdateCart(entry.cartKey, qty + 1)}
                                  data-testid={`button-increase-${entry.cartKey}`}
                                  className="w-8 h-8 rounded-lg bg-primary/10 text-primary flex items-center justify-center hover:bg-primary hover:text-white transition-colors font-bold"
                                >
                                  <Plus className="w-3.5 h-3.5" />
                                </button>
                              </>
                            ) : (
                              <button
                                onClick={() => handleUpdateCart(entry.cartKey, 1)}
                                data-testid={`button-add-${entry.cartKey}`}
                                className="px-4 py-1.5 bg-primary/10 text-primary rounded-lg hover:bg-primary hover:text-white transition-colors font-bold text-sm"
                              >
                                Adicionar
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            </div>

            {/* Cart sidebar */}
            <div className="lg:col-span-1">
              <div className="bg-card rounded-2xl border border-border/50 premium-shadow sticky top-4">
                <div className="p-4 border-b border-border/50 bg-secondary/5 flex items-center gap-2">
                  <ShoppingCart className="w-4 h-4 text-secondary" />
                  <p className="font-bold text-foreground">Resumo do Pedido</p>
                  {cartItems.length > 0 && (
                    <span className="ml-auto bg-secondary/10 text-secondary text-xs font-bold px-2 py-0.5 rounded-full">
                      {cartItems.length} item(s)
                    </span>
                  )}
                </div>
                <div className="p-4">
                  {cartItems.length === 0 ? (
                    <div className="py-8 text-center">
                      <ShoppingCart className="w-8 h-8 text-muted-foreground/30 mx-auto mb-2" />
                      <p className="text-muted-foreground text-sm">Nenhum item</p>
                    </div>
                  ) : (
                    <div className="space-y-0 divide-y divide-border/50 max-h-[40vh] overflow-y-auto">
                      {cartItems.map(({ entry, qty, unitPrice, subtotal }) => (
                        <div key={entry.cartKey} className="py-3 flex justify-between items-start gap-2">
                          <div className="flex-1 min-w-0">
                            <p className="font-bold text-sm text-foreground truncate">{entry.name}</p>
                            {entry.subCategoryName && (
                              <p className="text-xs text-muted-foreground truncate">{entry.subCategoryName}</p>
                            )}
                            <p className="text-xs text-muted-foreground mt-0.5">
                              {qty} × R$ {fmtBRL(unitPrice)}
                            </p>
                          </div>
                          <div className="text-right flex-shrink-0 flex items-center gap-1.5">
                            <p className="font-bold text-sm">R$ {fmtBRL(subtotal)}</p>
                            <button
                              onClick={() => handleUpdateCart(entry.cartKey, 0)}
                              className="p-1 rounded text-muted-foreground hover:text-red-500 transition-colors"
                            >
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
                      className="w-full py-3.5 bg-secondary text-secondary-foreground font-bold rounded-xl shadow-lg shadow-secondary/20 hover:-translate-y-0.5 transition-all disabled:opacity-50 disabled:transform-none flex justify-center items-center gap-2"
                    >
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
