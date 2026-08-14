import { useState, useMemo, useEffect, useRef } from "react";
import { useAuth } from "@/hooks/use-auth";
import {
  useActiveOrderWindow,
  useCreateProgramacao,
  useCompanyOrders,
  useOrderDetail,
} from "@/hooks/use-ordering";
import { useProducts } from "@/hooks/use-catalog";
import { Layout } from "@/components/Layout";
import { useToast } from "@/hooks/use-toast";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import {
  Calendar, CheckCircle2, AlertCircle, Package, Minus, Plus, Trash2,
  FileText, Clock, PartyPopper, X, Search, AlertTriangle, Lock,
  ChevronDown, ChevronUp, SendHorizonal, CalendarDays, RotateCcw,
  FlaskConical, Wrench,
} from "lucide-react";
import { buildOrderCatalog, type ProductEntry } from "@/utils/buildOrderCatalog";
import { BackHeader } from "@/components/navigation/BackHeader";
import { calculateOrderModificationDeadline, logDeadlineAudit } from "@/lib/order-deadline";
import { DeadlineExpiredModal } from "@/components/DeadlineExpiredModal";

// ─────────────────── helpers ───────────────────────────────────────────────
const DAY_OPTIONS = ["Segunda-feira", "Terça-feira", "Quarta-feira", "Quinta-feira", "Sexta-feira"];

const DAY_EN_TO_NUM: Record<string, number> = {
  "Segunda-feira": 1, "Terça-feira": 2, "Quarta-feira": 3,
  "Quinta-feira": 4, "Sexta-feira": 5,
};

const DAY_NORMALIZE: Record<string, string> = {
  "Monday": "Segunda-feira", "Tuesday": "Terça-feira", "Wednesday": "Quarta-feira",
  "Thursday": "Quinta-feira", "Friday": "Sexta-feira",
};

const DAY_SHORT: Record<string, string> = {
  "Segunda-feira": "Seg", "Terça-feira": "Ter", "Quarta-feira": "Qua",
  "Quinta-feira": "Qui", "Sexta-feira": "Sex",
};

function getDeliveryDate(dayName: string, deliveryStartIso: string, deliveryEndIso: string): string {
  const targetNum = DAY_EN_TO_NUM[dayName];
  if (!targetNum) return "";
  const startStr = deliveryStartIso.split("T")[0];
  const endStr = deliveryEndIso.split("T")[0];
  const [sy, sm, sd] = startStr.split("-").map(Number);
  const [ey, em, ed] = endStr.split("-").map(Number);
  let current = new Date(sy, sm - 1, sd);
  const end = new Date(ey, em - 1, ed);
  for (let i = 0; i <= 14; i++) {
    const jsDay = current.getDay();
    const isoDay = jsDay === 0 ? 7 : jsDay;
    if (isoDay === targetNum && current <= end) {
      return `${current.getFullYear()}-${String(current.getMonth() + 1).padStart(2, "0")}-${String(current.getDate()).padStart(2, "0")}`;
    }
    current.setDate(current.getDate() + 1);
  }
  return "";
}

function fmtBRL(n: number) {
  return n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtDate(iso: string): string {
  if (!iso) return "";
  const [, m, d] = iso.split("-");
  return `${d}/${m}`;
}

// ─────────────────── types ─────────────────────────────────────────────────
// ProductEntry is imported from the shared buildOrderCatalog helper so that
// weekly-schedule, create-order, and edit-order all share the same type and
// the same pricing logic (resolvePrice chain).

type GroupedProduct = {
  productId: number;
  name: string;
  unit: string;
  observation?: string | null;
  rows: ProductEntry[];
};

function groupEntries(entries: ProductEntry[]): GroupedProduct[] {
  const grouped = new Map<number, GroupedProduct>();
  for (const e of entries) {
    if (!grouped.has(e.productId)) {
      grouped.set(e.productId, {
        productId: e.productId,
        name: e.name,
        unit: e.unit,
        observation: e.observation,
        rows: [],
      });
    }
    grouped.get(e.productId)!.rows.push(e);
  }
  return Array.from(grouped.values());
}

function ProductThumbnail({
  src,
  alt,
  className = "w-9 h-9",
  iconClassName = "w-4 h-4",
}: {
  src?: string | null;
  alt: string;
  className?: string;
  iconClassName?: string;
}) {
  const [hasError, setHasError] = useState(false);
  const normalizedSrc = useMemo(() => {
    const value = String(src ?? "").trim();
    if (!value) return "";
    if (/^(https?:|data:|blob:|\/)/i.test(value)) return value;
    return `/${value}`;
  }, [src]);

  if (!normalizedSrc || hasError) {
    return (
      <div className={`${className} rounded-xl flex items-center justify-center flex-shrink-0 bg-muted`}>
        <Package className={`${iconClassName} text-muted-foreground`} />
      </div>
    );
  }

  return (
    <div className={`${className} rounded-xl overflow-hidden flex-shrink-0 bg-muted`}>
      <img
        src={normalizedSrc}
        alt={alt}
        className="w-full h-full object-cover"
        loading="lazy"
        onError={() => setHasError(true)}
      />
    </div>
  );
}

// ─────────────────── DayPanel ───────────────────────────────────────────────
interface DayPanelProps {
  dayName: string;
  deliveryDate: string;
  isExpanded: boolean;
  onToggle: () => void;
  cart: Record<string, number>;
  onCartChange: (key: string, qty: number) => void;
  note: string;
  onNoteChange: (note: string) => void;
  entries: ProductEntry[];
  isLocked: boolean;
  existingOrder?: any;
  onRequestReopen?: (orderId: number) => void;
}

function DayPanel({
  dayName, deliveryDate, isExpanded, onToggle,
  cart, onCartChange, note, onNoteChange,
  entries, isLocked, existingOrder, onRequestReopen,
}: DayPanelProps) {
  const [search, setSearch] = useState("");
  const [filterCategory, setFilterCategory] = useState("ALL");

  const cartItems = useMemo(() => {
    return Object.entries(cart)
      .filter(([, qty]) => qty > 0)
      .map(([key, qty]) => {
        const entry = entries.find(e => e.cartKey === key);
        if (!entry) return null;
        return { entry, qty, subtotal: entry.price * qty };
      })
      .filter((x): x is { entry: ProductEntry; qty: number; subtotal: number } => x !== null);
  }, [cart, entries]);

  const dayTotal = cartItems.reduce((s, i) => s + i.subtotal, 0);
  const itemCount = cartItems.length;

  const categories = useMemo(() => {
    const cats = new Set<string>();
    entries.forEach(e => cats.add(e.category));
    return Array.from(cats).sort();
  }, [entries]);

  const filteredEntries = useMemo(() => {
    const q = search.toLowerCase();
    return entries.filter(e => {
      const matchCat = filterCategory === "ALL" || e.category === filterCategory;
      const matchSearch = !q || e.name.toLowerCase().includes(q) || e.category.toLowerCase().includes(q);
      return matchCat && matchSearch;
    });
  }, [entries, filterCategory, search]);

  const groupedEntries = useMemo(() => {
    const q = search.toLowerCase();
    const filtered = entries.filter(e => {
      const matchCat = filterCategory === "ALL" || e.category === filterCategory;
      const matchSearch = !q || e.name.toLowerCase().includes(q) || e.category.toLowerCase().includes(q);
      return matchCat && matchSearch;
    });
    if (filterCategory !== "ALL") return [];
    return groupEntries(filtered);
  }, [entries, filterCategory, search]);

  // Locked by existing submitted order
  if (isLocked && existingOrder) {
    const statusLabel: Record<string, string> = {
      CONFIRMED: "Confirmado",
      REOPEN_REQUESTED: "Alteração solicitada",
      OPEN_FOR_EDITING: "Aberto para edição",
      ACTIVE: "Ativo",
    };
    return (
      <div className="bg-card rounded-2xl border-2 border-green-200 overflow-hidden">
        <div className="p-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-green-100 flex items-center justify-center flex-shrink-0">
              <CheckCircle2 className="w-5 h-5 text-green-600" />
            </div>
            <div>
              <p className="font-bold text-foreground">{dayName}</p>
              {deliveryDate && (
                <p className="text-xs text-muted-foreground">Entrega: {fmtDate(deliveryDate)}</p>
              )}
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="text-right">
              <p className="text-xs text-muted-foreground font-medium">
                {statusLabel[existingOrder.status] || existingOrder.status}
              </p>
              <p className="font-bold text-green-700 text-sm">
                R$ {fmtBRL(parseFloat(existingOrder.totalValue || "0"))}
              </p>
            </div>
            {existingOrder.status === "CONFIRMED" && onRequestReopen && (
              <button
                onClick={() => {
                  const check = calculateOrderModificationDeadline(existingOrder.deliveryDate);
                  if (check.canModify) {
                    onRequestReopen(existingOrder.id);
                  }
                }}
                className="px-3 py-1.5 text-xs font-bold bg-blue-50 border border-blue-200 text-blue-700 rounded-xl hover:bg-blue-100 transition-colors"
              >
                Solicitar alteração
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={`bg-card rounded-2xl border-2 overflow-hidden transition-all ${isExpanded ? "border-primary/40" : "border-border/50"}`}>
      {/* Day header */}
      <button
        onClick={onToggle}
        className={`w-full p-4 flex items-center justify-between text-left transition-colors ${isExpanded ? "bg-primary/5" : "hover:bg-muted/30"}`}
      >
        <div className="flex items-center gap-3">
          <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 transition-colors ${isExpanded ? "bg-primary text-white" : itemCount > 0 ? "bg-green-100" : "bg-muted"}`}>
            {itemCount > 0 && !isExpanded
              ? <CheckCircle2 className="w-5 h-5 text-green-600" />
              : <CalendarDays className={`w-5 h-5 ${isExpanded ? "text-white" : "text-muted-foreground"}`} />
            }
          </div>
          <div>
            <p className="font-bold text-foreground">{dayName}</p>
            {deliveryDate
              ? <p className="text-xs text-muted-foreground">Entrega: {fmtDate(deliveryDate)}</p>
              : <p className="text-xs text-red-500">Dia não disponível na janela atual</p>
            }
          </div>
        </div>
        <div className="flex items-center gap-3">
          {itemCount > 0 && (
            <div className="text-right">
              <p className="text-xs text-muted-foreground font-medium">{itemCount} item(s)</p>
              <p className="font-bold text-primary text-sm">R$ {fmtBRL(dayTotal)}</p>
            </div>
          )}
          {isExpanded
            ? <ChevronUp className="w-5 h-5 text-muted-foreground flex-shrink-0" />
            : <ChevronDown className="w-5 h-5 text-muted-foreground flex-shrink-0" />
          }
        </div>
      </button>

      {/* Expanded body */}
      {isExpanded && (
        <div className="border-t border-border/50">
          {entries.length === 0 ? (
            <div className="p-8 text-center">
              <Package className="w-10 h-10 text-muted-foreground/40 mx-auto mb-2" />
              <p className="text-muted-foreground text-sm">Nenhum produto disponível para este dia.</p>
            </div>
          ) : (
            <>
              {/* Cart summary at top when has items */}
              {cartItems.length > 0 && (
                <div className="px-4 py-3 bg-primary/5 border-b border-border/50">
                  <p className="text-xs font-bold text-primary uppercase tracking-wider mb-2 flex items-center gap-1">
                    <CheckCircle2 className="w-3.5 h-3.5" /> Itens selecionados para {dayName}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {cartItems.map(({ entry, qty, subtotal }) => (
                      <div key={entry.cartKey} className="flex items-center gap-1.5 bg-white border border-primary/20 rounded-xl px-2.5 py-1.5 text-xs">
                        <span className="font-bold text-foreground truncate max-w-[100px]">{entry.name}</span>
                        {entry.subCategoryName && <span className="text-muted-foreground truncate max-w-[60px]">({entry.subCategoryName})</span>}
                        <span className="font-bold text-primary">{qty}× R$ {fmtBRL(subtotal)}</span>
                        <button onClick={() => onCartChange(entry.cartKey, 0)} className="text-muted-foreground hover:text-red-500 ml-1">
                          <X className="w-3 h-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Filters */}
              <div className="p-3 border-b border-border/50 bg-muted/10 flex flex-wrap gap-2 items-center">
                <div className="relative flex-1 min-w-[140px] max-w-xs">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                  <input
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    placeholder="Buscar produto..."
                    className="w-full pl-8 pr-4 py-2 rounded-xl border-2 border-border text-sm focus:border-primary outline-none"
                  />
                  {search && (
                    <button onClick={() => setSearch("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground">
                      <X className="w-3 h-3" />
                    </button>
                  )}
                </div>
                <div className="flex gap-1.5 flex-wrap">
                  <button
                    onClick={() => setFilterCategory("ALL")}
                    className={`px-3 py-1.5 rounded-xl text-xs font-bold border-2 transition-all ${filterCategory === "ALL" ? "bg-primary text-white border-primary" : "border-border text-muted-foreground hover:border-primary/50"}`}
                  >
                    Todos
                  </button>
                  {categories.map(cat => (
                    <button
                      key={cat}
                      onClick={() => setFilterCategory(cat)}
                      className={`px-3 py-1.5 rounded-xl text-xs font-bold border-2 transition-all ${filterCategory === cat ? "bg-primary text-white border-primary" : "border-border text-muted-foreground hover:border-primary/50"}`}
                    >
                      {cat}
                    </button>
                  ))}
                </div>
              </div>

              {/* Product list */}
              <div className="divide-y divide-border/50 max-h-[400px] overflow-y-auto">
                {filterCategory === "ALL" ? (
                  groupedEntries.map(group => {
                    const anyInCart = group.rows.some(r => (cart[r.cartKey] || 0) > 0);
                    return (
                      <div key={group.productId} className={`p-4 transition-colors ${anyInCart ? "bg-primary/[0.03]" : "hover:bg-muted/10"}`}>
                        <div className="flex items-center gap-3 mb-2">
                          <ProductThumbnail
                            src={group.rows[0]?.imageUrl}
                            alt={group.name}
                            className={`w-9 h-9 ${anyInCart ? "ring-2 ring-primary/30" : ""}`}
                          />
                          <div>
                            <h3 className="font-bold text-foreground text-sm">{group.name}</h3>
                            {group.observation && <p className="text-xs text-muted-foreground italic">{group.observation}</p>}
                          </div>
                        </div>
                        <div className="space-y-1.5 pl-12">
                          {group.rows.map(row => {
                            const qty = cart[row.cartKey] || 0;
                            return (
                              <div key={row.cartKey} className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 py-1 border-t border-border/30 first:border-0">
                                <div className="flex-1 min-w-0">
                                  <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">{row.category}</span>
                                </div>
                                <div className="flex items-center gap-3 flex-shrink-0">
                                  <div className="text-right min-w-[65px]">
                                    <p className="font-bold text-sm text-primary">R$ {fmtBRL(row.price)}</p>
                                    <p className="text-xs text-muted-foreground">/{group.unit}</p>
                                  </div>
                                  <div className="flex items-center gap-1 bg-background border-2 border-border rounded-xl overflow-hidden">
                                    <button
                                      onClick={() => onCartChange(row.cartKey, qty - 1)}
                                      className="w-7 h-7 flex items-center justify-center text-muted-foreground hover:bg-muted transition-colors"
                                    >
                                      <Minus className="w-3 h-3" />
                                    </button>
                                    <input
                                      type="number" min="0" value={qty || ""}
                                      onChange={e => onCartChange(row.cartKey, parseInt(e.target.value) || 0)}
                                      className="w-9 text-center font-bold bg-transparent outline-none text-foreground text-xs"
                                      placeholder="0"
                                    />
                                    <button
                                      onClick={() => onCartChange(row.cartKey, qty + 1)}
                                      className="w-7 h-7 flex items-center justify-center bg-primary/10 text-primary hover:bg-primary/20 transition-colors"
                                    >
                                      <Plus className="w-3 h-3" />
                                    </button>
                                  </div>
                                  <div className="text-right min-w-[65px]">
                                    {qty > 0
                                      ? <p className="font-bold text-xs text-foreground">R$ {fmtBRL(qty * row.price)}</p>
                                      : <p className="text-xs text-muted-foreground">—</p>
                                    }
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })
                ) : (
                  filteredEntries.map(entry => {
                    const qty = cart[entry.cartKey] || 0;
                    return (
                      <div key={entry.cartKey} className={`p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 transition-colors ${qty > 0 ? "bg-primary/[0.03]" : "hover:bg-muted/10"}`}>
                        <div className="flex items-center gap-3">
                          <ProductThumbnail
                            src={entry.imageUrl}
                            alt={entry.name}
                            className={`w-10 h-10 ${qty > 0 ? "ring-2 ring-primary/30" : ""}`}
                            iconClassName="w-5 h-5"
                          />
                          <div>
                            <h3 className="font-bold text-foreground text-sm">{entry.name}</h3>
                            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">{entry.category}</p>
                            {entry.observation && <p className="text-xs text-muted-foreground italic mt-0.5">{entry.observation}</p>}
                          </div>
                        </div>
                        <div className="flex items-center gap-4">
                          <div className="text-right min-w-[70px]">
                            <p className="font-bold text-base text-primary">R$ {fmtBRL(entry.price)}</p>
                            <p className="text-xs text-muted-foreground">/{entry.unit}</p>
                          </div>
                          <div className="flex items-center gap-1 bg-background border-2 border-border rounded-xl overflow-hidden">
                            <button onClick={() => onCartChange(entry.cartKey, qty - 1)} className="w-8 h-8 flex items-center justify-center text-muted-foreground hover:bg-muted transition-colors">
                              <Minus className="w-3.5 h-3.5" />
                            </button>
                            <input
                              type="number" min="0" value={qty || ""}
                              onChange={e => onCartChange(entry.cartKey, parseInt(e.target.value) || 0)}
                              className="w-10 text-center font-bold bg-transparent outline-none text-foreground text-sm"
                              placeholder="0"
                            />
                            <button onClick={() => onCartChange(entry.cartKey, qty + 1)} className="w-8 h-8 flex items-center justify-center bg-primary/10 text-primary hover:bg-primary/20 transition-colors">
                              <Plus className="w-3.5 h-3.5" />
                            </button>
                          </div>
                          <div className="text-right min-w-[70px]">
                            {qty > 0
                              ? <p className="font-bold text-sm text-foreground">R$ {fmtBRL(qty * entry.price)}</p>
                              : <p className="text-xs text-muted-foreground">—</p>
                            }
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
                {(filterCategory === "ALL" ? groupedEntries : filteredEntries).length === 0 && (
                  <div className="p-8 text-center">
                    <Package className="w-10 h-10 text-muted-foreground/30 mx-auto mb-2" />
                    <p className="text-muted-foreground text-sm">Nenhum produto encontrado.</p>
                  </div>
                )}
              </div>

              {/* Note field */}
              <div className="p-4 border-t border-border/50 bg-muted/5">
                <label className="text-xs font-bold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5 mb-2">
                  <FileText className="w-3.5 h-3.5" /> Observação para {DAY_SHORT[dayName]}
                </label>
                <textarea
                  value={note}
                  onChange={e => onNoteChange(e.target.value)}
                  rows={2}
                  placeholder="Ex: Bananas mais verdes, entregar antes das 9h..."
                  className="w-full px-3 py-2 rounded-xl border-2 border-border focus:border-primary outline-none resize-none text-foreground placeholder:text-muted-foreground text-sm"
                />
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ─────────────────── main page ─────────────────────────────────────────────
export default function WeeklySchedulePage() {
  const { user, company, isLoading: authLoading } = useAuth();
  const { data: activeWindow, isLoading: windowLoading } = useActiveOrderWindow();
  const { data: products } = useProducts();
  const { data: companyOrders } = useCompanyOrders(company?.id);
  const { toast } = useToast();
  const createProgramacao = useCreateProgramacao();
  const queryClient = useQueryClient();

  // dayCarts: { "Segunda-feira": { "sc_1": 2, "p_3": 1 }, ... }
  const [dayCarts, setDayCarts] = useState<Record<string, Record<string, number>>>({});
  const [dayNotes, setDayNotes] = useState<Record<string, string>>({});
  const [activeDay, setActiveDay] = useState<string | null>(null);
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [successOrders, setSuccessOrders] = useState<any[] | null>(null);
  const [showDeadlineExpired, setShowDeadlineExpired] = useState(false);

  // Reopen flow
  const [showReopenModal, setShowReopenModal] = useState(false);
  const [reopenReason, setReopenReason] = useState("");
  const [reopenTargetId, setReopenTargetId] = useState<number | null>(null);
  const [reopenSuccess, setReopenSuccess] = useState(false);

  const requestReopenMut = useMutation({
    mutationFn: ({ id, reason }: { id: number; reason: string }) =>
      apiRequest("POST", `/api/orders/${id}/request-reopen`, { reason }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/orders"] });
      queryClient.invalidateQueries({ queryKey: ["/api/company-orders"] });
      setShowReopenModal(false);
      setReopenReason("");
      setReopenTargetId(null);
      setReopenSuccess(true);
      toast({ title: "Solicitação enviada!", description: "O administrador irá analisar e liberar a edição do pedido." });
    },
    onError: (e: any) => toast({ title: e?.message || "Erro ao solicitar alteração", variant: "destructive" }),
  });

  // Test / maintenance mode
  const { data: testModeData } = { data: undefined } as any;
  const testModeActive = (testModeData as any)?.enabled === true;

  // Allowed delivery days
  const allowedDays = useMemo((): string[] => {
    const days = (company as any)?.allowedOrderDays;
    if (!days) return [];
    if (Array.isArray(days)) return (days as any[]).map(d => DAY_NORMALIZE[String(d)] || String(d)).filter(d => DAY_OPTIONS.includes(d));
    return [];
  }, [company]);

  // Delivery dates per day
  const deliveryDates = useMemo((): Record<string, string> => {
    if (!activeWindow) return {};
    const result: Record<string, string> = {};
    for (const day of allowedDays) {
      result[day] = getDeliveryDate(day, activeWindow.deliveryStartDate as unknown as string, activeWindow.deliveryEndDate as unknown as string);
    }
    return result;
  }, [activeWindow, allowedDays]);

  // Product entries per day — delegates to buildOrderCatalog (shared helper)
  // so that weekly-schedule uses the exact same resolvePrice chain as
  // create-order and edit-order. Day gate is applied here by pre-filtering
  // before passing to the helper (which expects already-gated products).
  const entriesPerDay = useMemo((): Record<string, ProductEntry[]> => {
    if (!products || !company) return {};
    const result: Record<string, ProductEntry[]> = {};
    for (const day of allowedDays) {
      const dayProducts = products.filter((p: any) => {
        if (!p?.active) return false;
        const avDays = (p as any).availableDays;
        if (avDays && Array.isArray(avDays) && avDays.length > 0) {
          return avDays.includes(day);
        }
        return true;
      });
      result[day] = buildOrderCatalog(dayProducts, company);
    }
    return result;
  }, [products, company, allowedDays]);

  // Existing orders for the current week
  const weekOrders = useMemo(() => {
    if (!companyOrders || !activeWindow) return [];
    return companyOrders.filter(o =>
      o.status !== "CANCELLED" &&
      (o as any).weekReference === activeWindow.weekReference
    );
  }, [companyOrders, activeWindow]);

  const weekAlreadySubmitted = weekOrders.length > 0;

  // Per-day cart helpers
  const getDayCart = (day: string): Record<string, number> => dayCarts[day] || {};
  const getDayNote = (day: string): string => dayNotes[day] || "";

  const handleCartChange = (day: string, key: string, qty: number) => {
    setDayCarts(prev => {
      const dayCart = { ...(prev[day] || {}) };
      if (qty <= 0) delete dayCart[key];
      else dayCart[key] = qty;
      return { ...prev, [day]: dayCart };
    });
  };

  const handleNoteChange = (day: string, note: string) => {
    setDayNotes(prev => ({ ...prev, [day]: note }));
  };

  // Weekly totals
  const weekTotal = useMemo(() => {
    let total = 0;
    for (const day of allowedDays) {
      const dayCart = getDayCart(day);
      const entries = entriesPerDay[day] || [];
      for (const [key, qty] of Object.entries(dayCart)) {
        const entry = entries.find(e => e.cartKey === key);
        if (entry) total += entry.price * qty;
      }
    }
    return total;
  }, [dayCarts, entriesPerDay, allowedDays]);

  const minWeeklyBilling = parseFloat((company as any)?.minWeeklyBilling || "0") || 0;
  const billingShortfall = minWeeklyBilling > 0 ? Math.max(0, minWeeklyBilling - weekTotal) : 0;

  const daysWithItems = useMemo(() => {
    return allowedDays.filter(day => {
      const dayCart = getDayCart(day);
      return Object.values(dayCart).some(qty => qty > 0);
    });
  }, [dayCarts, allowedDays]);

  const hasAnyItems = daysWithItems.length > 0;

  // Build submission payload
  const buildPayload = () => {
    if (!activeWindow) return null;
    const days: any[] = [];
    for (const day of daysWithItems) {
      const dayCart = getDayCart(day);
      const entries = entriesPerDay[day] || [];
      const deliveryDate = deliveryDates[day];
      if (!deliveryDate) continue;
      const items = Object.entries(dayCart)
        .filter(([, qty]) => qty > 0)
        .map(([key, qty]) => {
          const entry = entries.find(e => e.cartKey === key);
          if (!entry) return null;
          return {
            productId: entry.productId,
            quantity: qty,
            unitPrice: String(entry.price),
            totalPrice: String(entry.price * qty),
            subCategoryId: entry.subCategoryId ?? null,
            subCategoryName: entry.subCategoryName ?? null,
          };
        })
        .filter(Boolean) as any[];

      if (items.length === 0) continue;
      const dayTotal = items.reduce((s: number, i: any) => s + parseFloat(i.totalPrice), 0);
      days.push({
        deliveryDate: new Date(deliveryDate + "T12:00:00").toISOString(),
        weekReference: activeWindow.weekReference,
        totalValue: String(dayTotal),
        orderNote: getDayNote(day) || null,
        items,
      });
    }
    return { days };
  };

  const handleConfirmSubmit = async () => {
    const payload = buildPayload();
    if (!payload || payload.days.length === 0) return;
    setSubmitting(true);
    try {
      const result = await createProgramacao.mutateAsync(payload);
      setShowConfirmModal(false);
      setSuccessOrders(result.orders || []);
    } catch {
      // toast is handled in the hook's onError
    } finally {
      setSubmitting(false);
    }
  };

  // ── guards ────────────────────────────────────────────────────────────────
  if (!authLoading && !company) {
    return (
      <Layout>
        <div className="flex flex-col items-center justify-center py-24 text-center">
          <AlertCircle className="w-16 h-16 text-orange-400 mx-auto mb-4" />
          <h2 className="text-xl font-bold text-foreground mb-2">Dados da empresa não encontrados.</h2>
          <p className="text-muted-foreground text-sm max-w-sm">Entre em contato com a equipe VivaFrutaz.</p>
        </div>
      </Layout>
    );
  }

  if (windowLoading) {
    return <Layout><div className="p-8 text-center text-muted-foreground">Carregando...</div></Layout>;
  }

  if (company?.clientType === "contratual") {
    return (
      <Layout>
        <div className="max-w-xl mx-auto mt-16 text-center space-y-6">
          <div className="w-20 h-20 rounded-full bg-primary/10 flex items-center justify-center mx-auto">
            <Lock className="w-10 h-10 text-primary" />
          </div>
          <h1 className="text-2xl font-display font-bold text-foreground">Pedidos automáticos</h1>
          <p className="text-muted-foreground">Este cliente possui contrato ativo. Os pedidos são gerados automaticamente conforme o escopo contratual.</p>
          <a href="/client/contract-scope" className="inline-flex items-center gap-2 px-6 py-3 bg-primary text-primary-foreground font-bold rounded-xl hover:bg-primary/90 transition-colors">
            Ver Meu Escopo Contratual
          </a>
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

  // ── success screen ────────────────────────────────────────────────────────
  if (successOrders) {
    return (
      <Layout>
        <div className="max-w-2xl mx-auto mt-12 text-center">
          <div className="w-24 h-24 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-6">
            <PartyPopper className="w-12 h-12 text-green-600" />
          </div>
          <h1 className="text-3xl font-display font-bold text-foreground">Programação Enviada!</h1>
          <p className="text-muted-foreground mt-2 text-lg">Sua programação da semana foi enviada com sucesso.</p>
          <div className="mt-8 bg-card rounded-2xl border-2 border-primary/20 p-6 premium-shadow text-left">
            <p className="text-sm font-bold text-muted-foreground uppercase tracking-wider mb-4">
              {activeWindow.weekReference} — {successOrders.length} pedido(s) criado(s)
            </p>
            <div className="space-y-2">
              {successOrders.map((order: any, i: number) => (
                <div key={i} className="flex items-center justify-between py-2 border-b border-border/50 last:border-0">
                  <span className="font-mono text-sm font-bold text-primary">{order.orderCode || `#${order.id}`}</span>
                  <span className="text-sm text-muted-foreground">
                    {order.deliveryDate ? new Date(order.deliveryDate).toLocaleDateString("pt-BR") : ""}
                  </span>
                  <span className="font-bold text-sm text-foreground">
                    R$ {fmtBRL(parseFloat(order.totalValue || "0"))}
                  </span>
                </div>
              ))}
            </div>
            <div className="mt-4 pt-4 border-t border-border/50 flex justify-between">
              <span className="font-bold text-foreground">Total da Semana</span>
              <span className="text-xl font-display font-bold text-primary">
                R$ {fmtBRL(successOrders.reduce((s: number, o: any) => s + parseFloat(o.totalValue || "0"), 0))}
              </span>
            </div>
          </div>
          <div className="flex gap-3 justify-center mt-8">
            <a href="/client/history" className="px-6 py-3 bg-primary text-white font-bold rounded-xl hover:-translate-y-0.5 transition-transform">
              Ver Meus Pedidos
            </a>
            <a href="/client" className="px-6 py-3 border-2 border-border font-bold rounded-xl text-muted-foreground hover:bg-muted transition-colors">
              Início
            </a>
          </div>
        </div>
      </Layout>
    );
  }

  const weekNum = activeWindow.weekReference;

  return (
    <Layout>
      <BackHeader fallback="/client" breadcrumb={[{ label: "Início", href: "/client" }, { label: "Programação Semanal" }]} />

      {showDeadlineExpired && <DeadlineExpiredModal onClose={() => setShowDeadlineExpired(false)} />}

      {/* Reopen modal */}
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
              className="w-full px-4 py-2.5 rounded-xl border-2 border-border focus:border-primary outline-none resize-none text-sm mb-4"
            />
            <div className="flex gap-3">
              <button
                onClick={() => { setShowReopenModal(false); setReopenReason(""); }}
                className="flex-1 py-2.5 border-2 border-border text-muted-foreground font-bold rounded-xl hover:bg-muted transition-colors text-sm"
              >
                Cancelar
              </button>
              <button
                onClick={() => {
                  if (!reopenTargetId || reopenReason.trim().length < 3) {
                    toast({ title: "Informe o motivo da alteração (mínimo 3 caracteres)", variant: "destructive" });
                    return;
                  }
                  const targetOrder = companyOrders?.find((o: any) => o.id === reopenTargetId);
                  if (targetOrder?.deliveryDate) {
                    const check = calculateOrderModificationDeadline(targetOrder.deliveryDate);
                    logDeadlineAudit({ orderId: reopenTargetId, companyId: company?.id, userId: user?.id, now: new Date().toISOString(), deadline: check.deadline.toISOString(), canModify: check.canModify, reason: check.reason, action: "request-change" });
                    if (!check.canModify) { setShowReopenModal(false); setShowDeadlineExpired(true); return; }
                  }
                  requestReopenMut.mutate({ id: reopenTargetId, reason: reopenReason.trim() });
                }}
                disabled={requestReopenMut.isPending || reopenReason.trim().length < 3}
                className="flex-1 py-2.5 bg-blue-600 text-white font-bold rounded-xl hover:bg-blue-700 transition-colors text-sm disabled:opacity-50"
              >
                {requestReopenMut.isPending ? "Enviando..." : "Enviar Solicitação"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Confirmation modal */}
      {showConfirmModal && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
          <div className="bg-card rounded-2xl p-8 max-w-lg w-full premium-shadow border border-border/50">
            <div className="flex items-center gap-3 mb-5">
              <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center">
                <Calendar className="w-6 h-6 text-primary" />
              </div>
              <div>
                <h3 className="text-xl font-bold text-foreground">Enviar programação da semana?</h3>
              </div>
            </div>

            <div className="bg-muted/30 rounded-xl p-4 mb-5 space-y-2 text-sm">
              <p className="font-semibold text-foreground">
                Você está enviando sua programação da {weekNum}.
              </p>
              <p className="text-muted-foreground">
                Após a confirmação ela será enviada para produção.
              </p>
              <p className="text-muted-foreground">
                Após o envio não será possível alterar os pedidos sem solicitar uma reabertura.
              </p>
              <p className="text-muted-foreground font-medium">
                Alterações somente poderão ser solicitadas até 48 horas úteis antes da data de entrega, respeitando o horário limite das 12:00.
              </p>
            </div>

            {/* Summary of days */}
            <div className="bg-card border border-border/50 rounded-xl divide-y divide-border/50 mb-5">
              {daysWithItems.map(day => {
                const dayCart = getDayCart(day);
                const entries = entriesPerDay[day] || [];
                const dayTotal = Object.entries(dayCart).reduce((s, [key, qty]) => {
                  const entry = entries.find(e => e.cartKey === key);
                  return s + (entry ? entry.price * qty : 0);
                }, 0);
                const itemCount = Object.values(dayCart).filter(q => q > 0).length;
                return (
                  <div key={day} className="px-4 py-2.5 flex justify-between items-center text-sm">
                    <span className="font-semibold text-foreground">{day}</span>
                    <div className="text-right">
                      <span className="text-muted-foreground text-xs">{itemCount} item(s) · </span>
                      <span className="font-bold text-primary">R$ {fmtBRL(dayTotal)}</span>
                    </div>
                  </div>
                );
              })}
              <div className="px-4 py-2.5 flex justify-between items-center bg-primary/5">
                <span className="font-bold text-foreground">Total da Semana</span>
                <span className="font-bold text-xl text-primary">R$ {fmtBRL(weekTotal)}</span>
              </div>
            </div>

            <p className="text-sm text-center text-muted-foreground mb-5 font-medium">Deseja confirmar?</p>

            <div className="flex gap-3">
              <button
                onClick={() => setShowConfirmModal(false)}
                disabled={submitting}
                className="flex-1 py-3 border-2 border-border text-muted-foreground font-bold rounded-xl hover:bg-muted transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={handleConfirmSubmit}
                disabled={submitting}
                className="flex-1 py-3 bg-primary text-primary-foreground font-bold rounded-xl hover:bg-primary/90 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {submitting ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                    Enviando...
                  </>
                ) : (
                  <>
                    <SendHorizonal className="w-4 h-4" />
                    Enviar programação
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Page header */}
      <div className="mb-6">
        <h1 className="text-3xl font-display font-bold text-foreground">Programação Semanal</h1>
        <p className="text-muted-foreground mt-1">{weekNum}</p>
      </div>

      {/* Week already submitted: read-only view */}
      {weekAlreadySubmitted ? (
        <div className="space-y-4 max-w-3xl">
          <div className="bg-green-50 border-2 border-green-200 rounded-2xl p-5 flex items-start gap-4">
            <CheckCircle2 className="w-6 h-6 text-green-600 flex-shrink-0 mt-0.5" />
            <div>
              <p className="font-bold text-green-800">Programação já enviada para esta semana.</p>
              <p className="text-green-700 text-sm mt-1">
                Você enviou {weekOrders.length} pedido(s) para a {weekNum}.
                Para solicitar alterações, use o botão abaixo em cada pedido (dentro do prazo de 48h úteis antes da entrega).
              </p>
            </div>
          </div>

          {weekOrders.map((order: any) => {
            const delivDate = order.deliveryDate ? new Date(order.deliveryDate) : null;
            const dayName = delivDate
              ? ["Domingo", "Segunda-feira", "Terça-feira", "Quarta-feira", "Quinta-feira", "Sexta-feira", "Sábado"][delivDate.getDay()]
              : "—";
            const statusLabel: Record<string, string> = {
              CONFIRMED: "Confirmado",
              REOPEN_REQUESTED: "Alteração solicitada",
              OPEN_FOR_EDITING: "Aberto para edição",
              ACTIVE: "Ativo",
              CANCELLED: "Cancelado",
            };
            const check = order.deliveryDate ? calculateOrderModificationDeadline(order.deliveryDate) : null;
            return (
              <div key={order.id} className="bg-card rounded-2xl border border-border/50 p-5 flex items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
                    <CalendarDays className="w-5 h-5 text-primary" />
                  </div>
                  <div>
                    <p className="font-bold text-foreground">{dayName}</p>
                    <p className="text-xs text-muted-foreground">
                      {delivDate ? delivDate.toLocaleDateString("pt-BR") : ""} · {order.orderCode || `#${order.id}`}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <div className="text-right">
                    <p className="text-xs text-muted-foreground font-medium">{statusLabel[order.status] || order.status}</p>
                    <p className="font-bold text-primary">R$ {fmtBRL(parseFloat(order.totalValue || "0"))}</p>
                  </div>
                  {order.status === "CONFIRMED" && check?.canModify && (
                    <button
                      onClick={() => {
                        setReopenTargetId(order.id);
                        setReopenSuccess(false);
                        setShowReopenModal(true);
                      }}
                      className="px-3 py-1.5 text-xs font-bold bg-blue-50 border border-blue-200 text-blue-700 rounded-xl hover:bg-blue-100 transition-colors whitespace-nowrap"
                    >
                      Solicitar alteração
                    </button>
                  )}
                  {order.status === "CONFIRMED" && check && !check.canModify && (
                    <span className="px-3 py-1.5 text-xs font-bold bg-orange-50 border border-orange-200 text-orange-600 rounded-xl">
                      Fora do prazo
                    </span>
                  )}
                  {order.status === "REOPEN_REQUESTED" && (
                    <span className="px-3 py-1.5 text-xs font-bold bg-blue-50 border border-blue-200 text-blue-600 rounded-xl flex items-center gap-1">
                      <Clock className="w-3 h-3" /> Aguardando aprovação
                    </span>
                  )}
                </div>
              </div>
            );
          })}

          <div className="flex justify-end">
            <a href="/client/history" className="inline-flex items-center gap-2 px-4 py-2.5 text-sm font-bold text-primary border-2 border-primary/30 rounded-xl hover:bg-primary/5 transition-colors">
              Ver histórico completo →
            </a>
          </div>
        </div>
      ) : (
        /* Creation flow */
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left: day panels */}
          <div className="lg:col-span-2 space-y-3">
            {allowedDays.length === 0 && (
              <div className="bg-card rounded-2xl p-10 text-center border border-border/50">
                <AlertCircle className="w-12 h-12 text-muted-foreground mx-auto mb-3" />
                <p className="text-muted-foreground font-medium">Nenhum dia de entrega configurado para sua empresa.</p>
                <p className="text-muted-foreground text-sm mt-1">Entre em contato com o administrador.</p>
              </div>
            )}
            {allowedDays.map(day => (
              <DayPanel
                key={day}
                dayName={day}
                deliveryDate={deliveryDates[day] || ""}
                isExpanded={activeDay === day}
                onToggle={() => setActiveDay(prev => prev === day ? null : day)}
                cart={getDayCart(day)}
                onCartChange={(key, qty) => handleCartChange(day, key, qty)}
                note={getDayNote(day)}
                onNoteChange={note => handleNoteChange(day, note)}
                entries={entriesPerDay[day] || []}
                isLocked={false}
              />
            ))}
          </div>

          {/* Right: weekly summary */}
          <div className="lg:col-span-1">
            <div className="bg-card rounded-2xl border border-border/50 premium-shadow sticky top-8">
              <div className="p-5 border-b border-border/50 bg-primary rounded-t-2xl text-primary-foreground">
                <h2 className="font-bold text-base flex items-center gap-2">
                  <CalendarDays className="w-5 h-5" /> Resumo da Semana
                </h2>
                <p className="text-xs text-primary-foreground/70 mt-0.5">{weekNum}</p>
              </div>
              <div className="p-5">
                {allowedDays.length === 0 ? (
                  <p className="text-muted-foreground text-sm text-center py-6">Nenhum dia configurado.</p>
                ) : (
                  <div className="space-y-2">
                    {allowedDays.map(day => {
                      const dayCart = getDayCart(day);
                      const entries = entriesPerDay[day] || [];
                      const dayTotal = Object.entries(dayCart).reduce((s, [key, qty]) => {
                        const entry = entries.find(e => e.cartKey === key);
                        return s + (entry ? entry.price * qty : 0);
                      }, 0);
                      const itemCount = Object.values(dayCart).filter(q => q > 0).length;
                      const hasItems = itemCount > 0;
                      const deliveryDate = deliveryDates[day];
                      return (
                        <button
                          key={day}
                          onClick={() => setActiveDay(prev => prev === day ? null : day)}
                          className={`w-full flex items-center justify-between text-left px-3 py-2.5 rounded-xl transition-colors border ${
                            activeDay === day
                              ? "border-primary/40 bg-primary/5"
                              : hasItems
                              ? "border-green-200 bg-green-50 hover:bg-green-100"
                              : "border-border/50 hover:bg-muted/20"
                          }`}
                        >
                          <div className="flex items-center gap-2">
                            {hasItems
                              ? <CheckCircle2 className="w-4 h-4 text-green-600 flex-shrink-0" />
                              : <div className="w-4 h-4 rounded-full border-2 border-border flex-shrink-0" />
                            }
                            <div>
                              <p className={`text-xs font-bold ${hasItems ? "text-green-700" : "text-muted-foreground"}`}>
                                {DAY_SHORT[day]}
                              </p>
                              {deliveryDate && (
                                <p className="text-xs text-muted-foreground/70">{fmtDate(deliveryDate)}</p>
                              )}
                            </div>
                          </div>
                          {hasItems ? (
                            <div className="text-right">
                              <p className="text-xs text-green-600 font-bold">R$ {fmtBRL(dayTotal)}</p>
                              <p className="text-xs text-muted-foreground">{itemCount} item(s)</p>
                            </div>
                          ) : (
                            <Plus className="w-3.5 h-3.5 text-muted-foreground" />
                          )}
                        </button>
                      );
                    })}
                  </div>
                )}

                <div className="border-t border-border/50 mt-4 pt-4 space-y-3">
                  <div className="flex justify-between items-center">
                    <p className="font-bold text-foreground text-sm">Total da Semana</p>
                    <p className={`text-xl font-display font-bold ${weekTotal > 0 ? "text-primary" : "text-muted-foreground"}`}>
                      R$ {fmtBRL(weekTotal)}
                    </p>
                  </div>

                  {/* Minimum weekly billing indicator */}
                  {minWeeklyBilling > 0 && (
                    <div className={`p-3 rounded-xl border text-xs ${weekTotal >= minWeeklyBilling ? "bg-green-50 border-green-200" : "bg-orange-50 border-orange-200"}`}>
                      <div className="flex justify-between items-center mb-1.5">
                        <span className={`font-bold ${weekTotal >= minWeeklyBilling ? "text-green-700" : "text-orange-700"}`}>
                          Faturamento mínimo
                        </span>
                        <span className={`font-bold ${weekTotal >= minWeeklyBilling ? "text-green-700" : "text-orange-700"}`}>
                          R$ {fmtBRL(weekTotal)} / R$ {fmtBRL(minWeeklyBilling)}
                        </span>
                      </div>
                      <div className="w-full bg-white/60 rounded-full h-1.5">
                        <div
                          className={`h-1.5 rounded-full transition-all ${weekTotal >= minWeeklyBilling ? "bg-green-500" : "bg-orange-400"}`}
                          style={{ width: `${Math.min(100, (weekTotal / minWeeklyBilling) * 100)}%` }}
                        />
                      </div>
                      {billingShortfall > 0 && (
                        <p className="text-orange-600 mt-1.5 font-medium">
                          Faltam R$ {fmtBRL(billingShortfall)} para o mínimo.
                        </p>
                      )}
                    </div>
                  )}

                  <button
                    onClick={() => {
                      if (!hasAnyItems) {
                        toast({ title: "Adicione produtos em pelo menos um dia.", variant: "destructive" });
                        return;
                      }
                      setShowConfirmModal(true);
                    }}
                    disabled={!hasAnyItems}
                    className="w-full py-3.5 bg-secondary text-secondary-foreground font-bold rounded-xl shadow-lg shadow-secondary/20 hover:-translate-y-0.5 transition-all disabled:opacity-40 disabled:transform-none flex justify-center items-center gap-2"
                  >
                    <SendHorizonal className="w-5 h-5" />
                    Enviar Programação
                  </button>
                  {!hasAnyItems && (
                    <p className="text-xs text-muted-foreground text-center">
                      Selecione produtos em pelo menos um dia para enviar.
                    </p>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </Layout>
  );
}
