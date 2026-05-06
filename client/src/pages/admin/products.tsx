import { useState, useMemo, useEffect } from "react";
import { useProducts, useCreateProduct, useUpdateProduct } from "@/hooks/use-catalog";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { safeArray } from "@/lib/safeArray";
import { Layout } from "@/components/Layout";
import { Modal } from "@/components/Modal";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  Plus, Package, Edit2, DollarSign, CheckCircle, XCircle,
  Factory, Snowflake, AlignLeft, CalendarDays, Search, X, AlertTriangle,
  Leaf, ArrowLeftRight, Loader2, ChevronDown, ChevronUp, Percent, StickyNote,
  Hash, Tag, TrendingUp, TrendingDown, RefreshCw, ChevronRight, Layers, Tags
} from "lucide-react";
import type { Product } from "@shared/schema";
import { useToast } from "@/hooks/use-toast";
import { resolvePrice, formatPriceOrDash, priceSource } from "@/utils/priceResolver";

const UNITS = [
  { value: "kg", label: "Quilograma (kg)" },
  { value: "caixa", label: "Caixa" },
  { value: "unidade", label: "Unidade" },
  { value: "pallet", label: "Pallet" },
  { value: "bandeja", label: "Bandeja" },
  { value: "pote", label: "Pote" },
  { value: "pacote", label: "Pacote" },
  { value: "display", label: "Display" },
  { value: "porcao", label: "Porção" },
];

const DAYS = ["Segunda-feira", "Terça-feira", "Quarta-feira", "Quinta-feira", "Sexta-feira"];

function useCategories() {
  return useQuery({
    queryKey: ['/api/categories'],
    queryFn: async () => {
      const res = await fetchWithAuth('/api/categories');
      return res.json() as Promise<{ id: number; name: string }[]>;
    }
  });
}

type CategorySelection = { categoryName: string; price: string };
type PricingMode = "base" | "category";

const emptyForm = {
  name: "",
  unit: "kg",
  active: true,
  basePrice: "",
  isIndustrialized: false,
  isSeasonal: false,
  outOfSeason: false,
  observation: "",
  curiosity: "",
  availableDays: [] as string[],
  ncm: "",
  cfop: "",
  // FASE NF.6.3 — ETAPA 2: CST por item (Lucro Presumido / Lucro Real, CRT=3).
  // Vazio ("") = "padrão (00)". Validação fiscal estrita é do generator
  // (server/services/nfe/nfeGenerator.ts:201, regex /^\d{2}$/).
  cst: "",
  commercialUnit: "",
  productCode: "",
  // FASE NF.7.8.1 — flag fiscal de produto importado.
  // Default false: catálogo nacional inteiro mantém comportamento atual.
  // Quando true → ICMS 4% (Resolução 13/2012), com prioridade sobre regra
  // de UF. Não interfere em CST/CSOSN nem em XML — somente alíquota.
  importado: false,
  categorySelections: [] as CategorySelection[],
  pricingMode: "category" as PricingMode,
  // Imagem do produto. Pode ser uma URL externa (https://...) ou um
  // caminho interno servido pelo backend (/uploads/products/<arquivo>).
  imageUrl: null as string | null,
};

function productToForm(p: Product): typeof emptyForm {
  // Infer the original mode from persisted data so editing keeps the
  // chosen behaviour. The new `pricingMode` field is read first when the
  // backend exposes it; otherwise we fall back to "base" only when a
  // basePrice exists and assume "category" by default.
  const persistedMode = (p as any).pricingMode as PricingMode | undefined;
  const inferredMode: PricingMode =
    persistedMode === "base" || persistedMode === "category"
      ? persistedMode
      : p.basePrice != null
        ? "base"
        : "category";

  return {
    name: p.name,
    unit: p.unit,
    active: p.active,
    basePrice: p.basePrice != null ? String(p.basePrice) : "",
    isIndustrialized: p.isIndustrialized ?? false,
    isSeasonal: p.isSeasonal ?? false,
    outOfSeason: (p as any).outOfSeason ?? false,
    observation: (p as any).observation || "",
    curiosity: (p as any).curiosity || "",
    availableDays: Array.isArray((p as any).availableDays) ? (p as any).availableDays as string[] : [],
    ncm: (p as any).ncm || "",
    cfop: (p as any).cfop || "",
    // FASE NF.6.3 — leitura de cst persistido no produto (passthrough).
    cst: (p as any).cst || "",
    commercialUnit: (p as any).commercialUnit || "",
    productCode: (p as any).productCode || "",
    // FASE NF.7.8.1 — leitura defensiva da flag importado.
    // Comparação === true evita falso positivo de "true"/1/etc. e o `||` final
    // garante false para produtos antigos sem o campo (compatível com NF.7.8).
    importado: (p as any).importado === true,
    categorySelections: [],
    pricingMode: inferredMode,
    imageUrl: (p as any).imageUrl ?? null,
  };
}

// ─── Safra Substitution Modal ─────────────────────────────────
function SafraSubstituteModal({ alert, products, onClose, onDone }: {
  alert: { product: any; affectedOrders: any[] };
  products: any[];
  onClose: () => void;
  onDone: () => void;
}) {
  const { toast } = useToast();
  const [action, setAction] = useState<'replace' | 'remove' | 'discount' | 'note'>('replace');
  const [newProductId, setNewProductId] = useState('');
  const [discountPct, setDiscountPct] = useState('');
  const [nfNote, setNfNote] = useState('');
  const [loading, setLoading] = useState(false);

  const availableProducts = products.filter(p => p.id !== alert.product.id && p.active && !p.outOfSeason);

  const handleApply = async () => {
    if (action === 'replace' && !newProductId) { toast({ title: 'Selecione o produto substituto', variant: 'destructive' }); return; }
    if (action === 'discount' && (!discountPct || Number(discountPct) <= 0 || Number(discountPct) > 100)) {
      toast({ title: 'Informe um percentual válido (1-100)', variant: 'destructive' }); return;
    }
    if (action === 'note' && !nfNote.trim()) { toast({ title: 'Informe a observação', variant: 'destructive' }); return; }
    setLoading(true);
    let errors = 0;
    for (const o of alert.affectedOrders) {
      try {
        const body: any = { action, itemId: o.itemId };
        if (action === 'replace') body.newProductId = Number(newProductId);
        if (action === 'discount') body.discountPct = Number(discountPct);
        if (action === 'note') body.nfNote = nfNote;
        const res = await fetchWithAuth(`/api/orders/${o.orderId}/substitute-item`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        if (!res.ok) errors++;
      } catch { errors++; }
    }
    setLoading(false);
    if (errors > 0) {
      toast({ title: `${errors} erro(s) ao processar`, variant: 'destructive' });
    } else {
      toast({ title: 'Alterações aplicadas!', description: `${alert.affectedOrders.length} pedido(s) atualizado(s)` });
    }
    onDone();
  };

  return (
    <Modal isOpen onClose={onClose} title={`Gerenciar Substituição — ${alert.product.name}`} maxWidth="max-w-lg">
      <div className="space-y-4">
        <div className="p-3 bg-orange-50 border border-orange-200 rounded-xl text-xs text-orange-700 font-medium">
          <strong>{alert.affectedOrders.length}</strong> pedido(s) ativo(s) contém este produto. Escolha como proceder:
        </div>

        {/* Affected orders list */}
        <div className="max-h-32 overflow-y-auto rounded-xl border border-border/50 divide-y">
          {alert.affectedOrders.map(o => (
            <div key={o.orderId} className="flex justify-between items-center px-3 py-2 text-xs">
              <span className="font-mono font-bold text-primary">{o.orderCode}</span>
              <span className="text-muted-foreground">{o.companyName}</span>
              <span className="font-bold">{o.quantity}x</span>
              <span className="text-muted-foreground">{o.deliveryDate ? format(new Date(o.deliveryDate), 'd MMM', { locale: ptBR }) : '—'}</span>
            </div>
          ))}
        </div>

        {/* Action selector */}
        <div className="grid grid-cols-2 gap-2">
          {([
            { key: 'replace', icon: ArrowLeftRight, label: 'Substituir produto', color: 'blue' },
            { key: 'remove', icon: XCircle, label: 'Remover item', color: 'red' },
            { key: 'discount', icon: Percent, label: 'Dar desconto', color: 'green' },
            { key: 'note', icon: StickyNote, label: 'Obs. nota fiscal', color: 'purple' },
          ] as const).map(a => (
            <button key={a.key} type="button" onClick={() => setAction(a.key)}
              className={`flex items-center gap-2 p-2.5 rounded-xl border-2 text-xs font-bold transition-all ${action === a.key ? `bg-${a.color}-100 border-${a.color}-400 text-${a.color}-700` : 'border-border text-muted-foreground hover:border-border/80'}`}>
              <a.icon className="w-3.5 h-3.5" /> {a.label}
            </button>
          ))}
        </div>

        {action === 'replace' && (
          <div>
            <label className="block text-xs font-semibold mb-1.5">Produto substituto</label>
            <select value={newProductId} onChange={e => setNewProductId(e.target.value)}
              className="w-full px-3 py-2.5 rounded-xl border-2 border-border text-sm focus:border-primary outline-none">
              <option value="">Selecione...</option>
              {availableProducts.map(p => <option key={p.id} value={p.id}>{p.name} ({p.category})</option>)}
            </select>
          </div>
        )}
        {action === 'discount' && (
          <div>
            <label className="block text-xs font-semibold mb-1.5">Percentual de desconto (%)</label>
            <input type="number" min="1" max="100" value={discountPct} onChange={e => setDiscountPct(e.target.value)}
              className="w-full px-3 py-2.5 rounded-xl border-2 border-border text-sm focus:border-primary outline-none"
              placeholder="ex: 10" />
          </div>
        )}
        {action === 'note' && (
          <div>
            <label className="block text-xs font-semibold mb-1.5">Observação para a nota fiscal</label>
            <textarea value={nfNote} onChange={e => setNfNote(e.target.value)} rows={2}
              className="w-full px-3 py-2.5 rounded-xl border-2 border-border text-sm focus:border-primary outline-none resize-none"
              placeholder="ex: Produto substituído por indisponibilidade de safra..." />
          </div>
        )}
        {action === 'remove' && (
          <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-xs text-red-700">
            O item será removido dos pedidos listados e o valor total será recalculado automaticamente.
          </div>
        )}

        <div className="flex gap-2 pt-1">
          <button type="button" onClick={onClose} className="flex-1 py-2.5 rounded-xl border border-border text-sm text-muted-foreground hover:bg-muted/50 transition-colors">Cancelar</button>
          <button type="button" onClick={handleApply} disabled={loading}
            className="flex-1 py-2.5 rounded-xl bg-primary text-primary-foreground text-sm font-bold hover:bg-primary/90 transition-colors disabled:opacity-50 flex items-center justify-center gap-2">
            {loading && <Loader2 className="w-4 h-4 animate-spin" />}
            Aplicar em {alert.affectedOrders.length} pedido(s)
          </button>
        </div>
      </div>
    </Modal>
  );
}

// ─── Price Alerts Section ──────────────────────────────────────
function PriceAlertsSection() {
  const [expanded, setExpanded] = useState(true);
  const [dismissed, setDismissed] = useState<number[]>([]);

  const { data: alerts = [], isLoading, refetch, isFetching } = useQuery<any[]>({
    queryKey: ['/api/products/price-alerts'],
    queryFn: async () => {
      const res = await fetchWithAuth('/api/products/price-alerts');
      return res.json();
    },
    refetchInterval: 60000,
  });

  const visible = safeArray(alerts).filter((a: any) => !dismissed.includes(a.product.id));
  if (isLoading || visible.length === 0) return null;

  return (
    <div className="mb-6 bg-red-50 dark:bg-red-900/10 border-2 border-red-200 dark:border-red-800 rounded-2xl overflow-hidden" data-testid="price-alerts-panel">
      <div className="p-4 flex items-center gap-3 cursor-pointer" onClick={() => setExpanded(e => !e)}>
        <div className="w-9 h-9 bg-red-500 rounded-xl flex items-center justify-center flex-shrink-0">
          <TrendingUp className="w-4 h-4 text-white" />
        </div>
        <div className="flex-1">
          <h2 className="font-display font-bold text-red-900 dark:text-red-300 text-base">Alertas de Variação de Custo</h2>
          <p className="text-xs text-red-700 dark:text-red-400 mt-0.5">
            {visible.length} produto(s) com variação significativa de preço detectada nas notas fiscais
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); refetch(); }}
            className="p-1.5 rounded-lg hover:bg-red-200 transition-colors"
            title="Atualizar"
          >
            <RefreshCw className={`w-3.5 h-3.5 text-red-700 ${isFetching ? 'animate-spin' : ''}`} />
          </button>
          <span className="px-2 py-0.5 bg-red-500 text-white text-xs font-bold rounded-full">{visible.length}</span>
          {expanded ? <ChevronUp className="w-4 h-4 text-red-700" /> : <ChevronDown className="w-4 h-4 text-red-700" />}
        </div>
      </div>
      {expanded && (
        <div className="border-t border-red-200 dark:border-red-800 divide-y divide-red-100 dark:divide-red-900">
          {visible.map((a: any) => (
            <div key={a.product.id} className="p-4 flex items-start gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap mb-1">
                  {a.product.productCode && (
                    <span className="text-xs bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded font-mono">#{a.product.productCode}</span>
                  )}
                  <span className="font-bold text-red-900 dark:text-red-200 text-sm">{a.product.name}</span>
                  <span className="text-xs bg-red-100 text-red-700 px-2 py-0.5 rounded-full font-bold">{a.product.category}</span>
                  <span className={`flex items-center gap-1 text-xs font-bold px-2 py-0.5 rounded-full ${a.direction === 'increase' ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'}`}>
                    {a.direction === 'increase'
                      ? <TrendingUp className="w-3 h-3" />
                      : <TrendingDown className="w-3 h-3" />
                    }
                    {a.direction === 'increase' ? '+' : ''}{a.variation}%
                  </span>
                </div>
                <div className="flex items-center gap-3 text-xs text-muted-foreground mb-1.5">
                  <span>Preço base: <strong className="text-foreground">R$ {Number(a.product.basePrice).toFixed(2)}</strong></span>
                  <ChevronRight className="w-3 h-3" />
                  <span>Custo NF: <strong className={a.direction === 'increase' ? 'text-red-600' : 'text-green-600'}>R$ {Number(a.latestCost).toFixed(2)}</strong></span>
                  <span className="text-muted-foreground">· NF {a.latestInvoice.invoiceNumber} · {a.latestInvoice.supplier}</span>
                </div>
                {a.derivedProducts?.length > 0 && (
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <Layers className="w-3 h-3 text-muted-foreground flex-shrink-0" />
                    <span className="text-xs text-muted-foreground">Produtos derivados impactados:</span>
                    {a.derivedProducts.map((d: any) => (
                      <span key={d.id} className="text-xs bg-slate-100 text-slate-700 px-1.5 py-0.5 rounded font-medium">{d.name}</span>
                    ))}
                  </div>
                )}
              </div>
              <button
                type="button"
                onClick={() => setDismissed(prev => [...prev, a.product.id])}
                data-testid={`button-dismiss-price-alert-${a.product.id}`}
                className="p-1.5 rounded-lg text-muted-foreground hover:bg-red-100 transition-colors flex-shrink-0"
                title="Dispensar alerta"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Safra Alerts Section ─────────────────────────────────────
function SafraAlertsSection({ allProducts }: { allProducts: any[] }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [expanded, setExpanded] = useState(true);
  const [substituteAlert, setSubstituteAlert] = useState<any | null>(null);

  const { data: alerts, isLoading } = useQuery({
    queryKey: ['/api/products/safra-alerts'],
    queryFn: async () => {
      const res = await fetchWithAuth('/api/products/safra-alerts');
      return res.json();
    },
    refetchInterval: 30000,
  });

  if (isLoading || !alerts || alerts.length === 0) return null;

  return (
    <>
      {substituteAlert && (
        <SafraSubstituteModal
          alert={substituteAlert}
          products={allProducts}
          onClose={() => setSubstituteAlert(null)}
          onDone={() => {
            setSubstituteAlert(null);
            queryClient.invalidateQueries({ queryKey: ['/api/products/safra-alerts'] });
          }}
        />
      )}
      <div className="mb-6 bg-orange-50 border-2 border-orange-200 rounded-2xl overflow-hidden" data-testid="safra-alerts-panel">
        <div className="p-4 flex items-center gap-3 cursor-pointer" onClick={() => setExpanded(e => !e)}>
          <div className="w-9 h-9 bg-orange-500 rounded-xl flex items-center justify-center flex-shrink-0">
            <Leaf className="w-4 h-4 text-white" />
          </div>
          <div className="flex-1">
            <h2 className="font-display font-bold text-orange-900 text-base">Alertas de Safra</h2>
            <p className="text-xs text-orange-700 mt-0.5">
              {alerts.length} produto(s) fora de safra com pedidos ativos — ação necessária
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span className="px-2 py-0.5 bg-orange-500 text-white text-xs font-bold rounded-full">{alerts.length}</span>
            {expanded ? <ChevronUp className="w-4 h-4 text-orange-700" /> : <ChevronDown className="w-4 h-4 text-orange-700" />}
          </div>
        </div>
        {expanded && (
          <div className="border-t border-orange-200 divide-y divide-orange-100">
            {alerts.map((a: any) => (
              <div key={a.product.id} className="p-4 flex items-start gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-bold text-orange-900 text-sm">{a.product.name}</span>
                    <span className="text-xs bg-orange-200 text-orange-800 px-2 py-0.5 rounded-full font-bold">{a.product.category}</span>
                    <span className="px-2 py-0.5 bg-red-100 text-red-700 text-[11px] font-bold rounded-full border border-red-200">Fora de safra</span>
                  </div>
                  <p className="text-xs text-orange-700 mb-2">{a.affectedOrders.length} pedido(s) ativo(s) contém este produto:</p>
                  <div className="flex flex-wrap gap-1.5">
                    {a.affectedOrders.map((o: any) => (
                      <span key={o.orderId} className="inline-flex items-center gap-1 text-[11px] bg-white border border-orange-200 rounded-lg px-2 py-0.5 font-mono text-orange-800">
                        {o.orderCode} · {o.companyName} · {o.quantity}x
                      </span>
                    ))}
                  </div>
                </div>
                <button type="button" onClick={() => setSubstituteAlert(a)}
                  data-testid={`button-safra-manage-${a.product.id}`}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-orange-500 text-white rounded-xl text-xs font-bold hover:bg-orange-600 transition-colors flex-shrink-0 whitespace-nowrap">
                  <ArrowLeftRight className="w-3.5 h-3.5" /> Gerenciar substituição
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}

// ── Seletor de Categorias + Preços (checkbox cards da base central) ──────────
function ProductCategorySelector({
  dbCategories,
  selections,
  onChange,
}: {
  dbCategories: { id: number; name: string }[];
  selections: CategorySelection[];
  onChange: (sel: CategorySelection[]) => void;
}) {
  const toggle = (catName: string) => {
    const exists = selections.find(s => s.categoryName === catName);
    if (exists) {
      onChange(selections.filter(s => s.categoryName !== catName));
    } else {
      onChange([...selections, { categoryName: catName, price: '' }]);
    }
  };

  const setPrice = (catName: string, price: string) => {
    onChange(selections.map(s => s.categoryName === catName ? { ...s, price } : s));
  };

  if (dbCategories.length === 0) {
    return (
      <div className="p-4 rounded-xl border-2 border-dashed border-amber-300 bg-amber-50 text-center">
        <AlertTriangle className="w-5 h-5 text-amber-500 mx-auto mb-1" />
        <p className="text-xs font-bold text-amber-700">Nenhuma categoria cadastrada</p>
        <p className="text-xs text-amber-600 mt-0.5">
          Acesse a aba <strong>Categorias</strong> para criar categorias antes de adicionar produtos.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {dbCategories.map(cat => {
        const sel = selections.find(s => s.categoryName === cat.name);
        const isSelected = !!sel;
        return (
          <div
            key={cat.id}
            data-testid={`category-card-${cat.id}`}
            className={`rounded-xl border-2 transition-all ${isSelected ? 'border-primary bg-primary/5 dark:bg-primary/10' : 'border-border bg-card hover:border-primary/40'}`}
          >
            <div className="flex items-center gap-3 px-4 py-3">
              <button
                type="button"
                onClick={() => toggle(cat.name)}
                data-testid={`checkbox-category-${cat.id}`}
                className={`w-5 h-5 rounded border-2 flex items-center justify-center flex-shrink-0 transition-all ${isSelected ? 'bg-primary border-primary' : 'border-border bg-white dark:bg-slate-800'}`}
              >
                {isSelected && <CheckCircle className="w-3 h-3 text-white" />}
              </button>
              <span
                className={`flex-1 text-sm font-semibold cursor-pointer ${isSelected ? 'text-primary' : 'text-foreground'}`}
                onClick={() => toggle(cat.name)}
              >
                {cat.name}
              </span>
              {isSelected && (
                <div className="flex items-center gap-1.5" onClick={e => e.stopPropagation()}>
                  <span className="text-xs font-bold text-muted-foreground">R$</span>
                  <input
                    type="number" step="0.01" min="0"
                    value={sel!.price}
                    onChange={e => setPrice(cat.name, e.target.value)}
                    data-testid={`input-price-category-${cat.id}`}
                    className={`w-28 px-2 py-1.5 rounded-lg border-2 outline-none text-sm font-bold text-right transition-colors ${
                      sel!.price && Number(sel!.price) > 0
                        ? 'border-primary/40 focus:border-primary'
                        : 'border-red-300 focus:border-red-400 bg-red-50'
                    }`}
                    placeholder="0,00"
                  />
                </div>
              )}
            </div>
            {isSelected && (!sel!.price || Number(sel!.price) <= 0) && (
              <div className="px-4 pb-2">
                <p className="text-xs text-red-600 flex items-center gap-1">
                  <AlertTriangle className="w-3 h-3" /> Informe o preço para esta categoria
                </p>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

export default function ProductsPage() {
  const queryClient = useQueryClient();
  const { data: products, isLoading } = useProducts();
  const { data: categories = [] } = useCategories();
  const createProduct = useCreateProduct();
  const updateProduct = useUpdateProduct();
  const { toast } = useToast();

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [formData, setFormData] = useState(emptyForm);
  const [search, setSearch] = useState("");
  const [filterCat, setFilterCat] = useState("ALL");
  const [filterStatus, setFilterStatus] = useState("ALL");
  // FASE NF.7.8.3 — toggle "Apenas importados". Estado local apenas;
  // não toca query/endpoint. Default false = lista completa preservada.
  const [onlyImportados, setOnlyImportados] = useState(false);
  const [priceError, setPriceError] = useState(false);
  const [codeError, setCodeError] = useState<string | null>(null);
  const [duplicateError, setDuplicateError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // Modo de origem da imagem do produto: "url" (link externo) ou
  // "upload" (arquivo armazenado no servidor em /uploads/products).
  // Default "url" para novos produtos; ao editar é detectado automaticamente.
  const [imageMode, setImageMode] = useState<"url" | "upload">("url");
  const [uploadingImage, setUploadingImage] = useState(false);

  // Carrega sub-categorias ao abrir produto para edição
  const { data: editingSubCats = [] } = useQuery<any[]>({
    queryKey: ['/api/products', editingProduct?.id, 'sub-categories'],
    queryFn: async () => {
      const r = await fetchWithAuth(`/api/products/${editingProduct!.id}/sub-categories`);
      return r.json();
    },
    enabled: !!editingProduct,
  });

  // Popula as categorySelections a partir das sub-categorias carregadas
  useEffect(() => {
    if (editingProduct && editingSubCats.length > 0) {
      setFormData(prev => ({
        ...prev,
        categorySelections: editingSubCats.map((sc: any) => ({
          categoryName: sc.categoryName,
          price: String(sc.price),
        })),
      }));
    }
  }, [editingProduct?.id, editingSubCats]);

  // Quando o usuário troca o modo de precificação, limpamos o campo
  // que NÃO se aplica ao novo modo. Isso evita que dados orfãos sejam
  // enviados ao backend e mantém o formulário consistente com a UX.
  useEffect(() => {
    if (formData.pricingMode === "category") {
      if (formData.basePrice !== "") {
        setFormData(prev => ({ ...prev, basePrice: "" }));
        setPriceError(false);
      }
    } else if (formData.pricingMode === "base") {
      if (formData.categorySelections.length > 0) {
        setFormData(prev => ({ ...prev, categorySelections: [] }));
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formData.pricingMode]);

  // ── AJUSTE 1: detecta o modo correto ao abrir um produto existente.
  // Sem isso, ao editar um produto cuja imagem veio de upload, o form
  // mostraria o campo "URL" mesmo que o caminho seja /uploads/... Esse
  // efeito roda só quando o `imageUrl` muda — não interfere quando o
  // usuário troca o modo manualmente (ver handleChangeImageMode).
  useEffect(() => {
    if (formData.imageUrl?.startsWith("/uploads")) {
      setImageMode("upload");
    } else if (formData.imageUrl) {
      setImageMode("url");
    }
  }, [formData.imageUrl]);

  // ── AJUSTE 2: a troca de modo é uma ação explícita do usuário,
  // só nesses pontos limpamos a `imageUrl`. Um useEffect com `imageMode`
  // como dep apagaria a imagem de uma URL recém-carregada do banco.
  function handleChangeImageMode(mode: "url" | "upload") {
    setImageMode(mode);
    setFormData(prev => ({ ...prev, imageUrl: null }));
  }

  async function handleUploadImage(file: File) {
    try {
      setUploadingImage(true);
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetchWithAuth("/api/admin/products/upload-image", {
        method: "POST",
        body: fd,
      });
      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        throw new Error(errBody?.message || "Falha ao enviar a imagem");
      }
      const json = await res.json() as { imageUrl: string };
      setFormData(prev => ({ ...prev, imageUrl: json.imageUrl }));
    } catch (e: any) {
      toast({ title: "Erro no upload", description: e?.message || "Tente novamente.", variant: "destructive" });
    } finally {
      setUploadingImage(false);
    }
  }

  const openCreate = () => {
    setEditingProduct(null);
    setFormData(emptyForm);
    setCodeError(null);
    setDuplicateError(null);
    setIsModalOpen(true);
  };

  const openEdit = (product: Product) => {
    setEditingProduct(product);
    setFormData(productToForm(product));
    setCodeError(null);
    setDuplicateError(null);
    setIsModalOpen(true);
  };

  const closeModal = () => {
    setIsModalOpen(false);
    setEditingProduct(null);
    setPriceError(false);
    setCodeError(null);
    setDuplicateError(null);
  };

  const set = (field: string, value: any) =>
    setFormData(prev => ({ ...prev, [field]: value }));

  const toggleDay = (day: string) => {
    setFormData(prev => ({
      ...prev,
      availableDays: prev.availableDays.includes(day)
        ? prev.availableDays.filter(d => d !== day)
        : [...prev.availableDays, day]
    }));
  };

  // Verifica unicidade do código ao sair do campo
  const checkCodeUniqueness = async (code: string) => {
    if (!code.trim()) { setCodeError(null); return; }
    try {
      const excludeId = editingProduct?.id;
      const url = `/api/products/check-code?code=${encodeURIComponent(code.trim())}${excludeId ? `&excludeId=${excludeId}` : ''}`;
      const res = await fetchWithAuth(url);
      const data = await res.json();
      if (data.exists) {
        setCodeError(`ID já cadastrado (produto: "${data.product?.name}"). Utilize outro ID ou edite o produto existente.`);
      } else {
        setCodeError(null);
      }
    } catch { setCodeError(null); }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setPriceError(false);
    setCodeError(null);
    setDuplicateError(null);

    // Validações dependem do modo escolhido. Em "category", exigimos
    // ao menos uma categoria com preço > 0; em "base", exigimos um
    // preço base > 0. Nunca os dois — o useEffect já limpa o lado
    // não-utilizado ao trocar de modo.
    let priceNum = 0;

    if (formData.pricingMode === "category") {
      if (formData.categorySelections.length === 0) {
        toast({ title: 'Selecione ao menos uma categoria', description: 'Escolha pelo menos uma categoria e informe o preço.', variant: 'destructive' });
        return;
      }
      const missingPrice = formData.categorySelections.find(s => !s.price || Number(s.price) <= 0);
      if (missingPrice) {
        toast({ title: `Preço ausente em "${missingPrice.categoryName}"`, description: 'Informe o preço para todas as categorias selecionadas.', variant: 'destructive' });
        return;
      }
    } else {
      // pricingMode === "base"
      priceNum = Number(formData.basePrice);
      if (!formData.basePrice || isNaN(priceNum) || priceNum <= 0) {
        setPriceError(true);
        toast({ title: 'Preço base obrigatório', description: 'Informe um preço base válido (maior que zero) antes de salvar.', variant: 'destructive' });
        return;
      }
    }

    // ── AJUSTE 5: validação de protocolo na URL externa.
    // Em modo "url" exigimos http:// ou https:// para evitar caminhos
    // relativos ou protocolos exóticos (data:, javascript:, etc.) que
    // quebrariam o preview ou abririam vetor de XSS na imagem.
    if (imageMode === "url" && formData.imageUrl) {
      const trimmed = formData.imageUrl.trim();
      const isHttp = /^https?:\/\//i.test(trimmed);
      if (!isHttp) {
        toast({
          title: "URL inválida",
          description: "A URL da imagem deve começar com http:// ou https://",
          variant: "destructive",
        });
        return;
      }
    }

    // Trava de ID duplicado
    if (formData.productCode.trim()) {
      const excludeId = editingProduct?.id;
      const codeUrl = `/api/products/check-code?code=${encodeURIComponent(formData.productCode.trim())}${excludeId ? `&excludeId=${excludeId}` : ''}`;
      const codeRes = await fetchWithAuth(codeUrl);
      const codeData = await codeRes.json();
      if (codeData.exists) {
        const msg = `ID já cadastrado (produto: "${codeData.product?.name}"). Utilize outro ID ou edite o produto existente.`;
        setCodeError(msg);
        toast({ title: 'ID já cadastrado', description: msg, variant: 'destructive' });
        return;
      }
    }

    // Trava de produto duplicado (nome + código)
    const dupUrl = `/api/products/check-duplicate?name=${encodeURIComponent(formData.name.trim())}&code=${encodeURIComponent(formData.productCode.trim())}${editingProduct ? `&excludeId=${editingProduct.id}` : ''}`;
    const dupRes = await fetchWithAuth(dupUrl);
    const dupData = await dupRes.json();
    if (dupData.exists) {
      const msg = `Produto já cadastrado com esse ID (produto existente: "${dupData.product?.name}").`;
      setDuplicateError(msg);
      toast({ title: 'Produto duplicado', description: msg, variant: 'destructive' });
      return;
    }

    // Deriva `category` da primeira categoria selecionada (ou usa um
    // rótulo neutro quando o produto é precificado apenas pela base).
    const primaryCategory =
      formData.categorySelections[0]?.categoryName ?? "Geral";

    const payload: any = {
      name: formData.name,
      category: primaryCategory,
      unit: formData.unit,
      active: formData.active,
      // basePrice só vai ao backend quando o modo é "base"; em "category"
      // enviamos null para deixar explícito que o produto não tem base.
      basePrice: formData.pricingMode === "base" ? priceNum : null,
      isIndustrialized: formData.isIndustrialized,
      isSeasonal: formData.isSeasonal,
      outOfSeason: formData.outOfSeason,
      observation: formData.observation || null,
      curiosity: formData.curiosity || null,
      availableDays: formData.availableDays.length > 0 ? formData.availableDays : null,
      ncm: formData.ncm || null,
      cfop: formData.cfop || null,
      // FASE NF.6.3 — ETAPA 3: cst enviado no payload do produto.
      // O backend de produtos (sem coluna products.cst hoje) ignora silenciosamente,
      // mas o contrato fica preparado para quando o campo for adicionado ao schema
      // em uma fase futura. O caminho que JÁ funciona end-to-end é o draft:
      // PUT /api/fiscal/drafts/:id com items[].cst → builder NF.6.2 → XML NF.6.
      cst: formData.cst || null,
      commercialUnit: formData.commercialUnit || null,
      productCode: formData.productCode || null,
      // FASE NF.7.8.1 — flag de produto importado.
      // Persistida na coluna products.importado (NF.7.8). Coerção === true
      // garante que strings/numbers truthy não disparem ICMS 4% por engano.
      importado: formData.importado === true,
      categoryAvailability: 'all',
      allowedCategories: null,
      // Backend ignora por enquanto, mas já viaja no payload para que a
      // próxima etapa (persistência) seja apenas adicionar a coluna.
      pricingMode: formData.pricingMode,
      // Imagem do produto: pode ser uma URL externa ou um caminho
      // /uploads/products/<arquivo>. null quando o admin removeu.
      imageUrl: formData.imageUrl || null,
    };

    try {
      setSubmitting(true);
      let savedProductId: number;

      if (editingProduct) {
        const updated = await updateProduct.mutateAsync({ id: editingProduct.id, data: payload });
        savedProductId = editingProduct.id;
        // Sincroniza sub-categorias: deleta todas e recria
        await apiRequest('DELETE', `/api/products/${savedProductId}/sub-categories`, {});
      } else {
        const created = await createProduct.mutateAsync(payload);
        savedProductId = (created as any).id;
      }

      // Cria todas as sub-categorias selecionadas
      for (const sel of formData.categorySelections) {
        await apiRequest('POST', `/api/products/${savedProductId}/sub-categories`, {
          categoryName: sel.categoryName,
          price: String(Number(sel.price)),
        });
      }

      // Invalida cache de sub-categorias
      queryClient.invalidateQueries({ queryKey: ['/api/products', savedProductId, 'sub-categories'] });
      closeModal();
    } catch (err: any) {
      toast({ title: 'Erro ao salvar produto', description: err?.message || 'Tente novamente.', variant: 'destructive' });
    } finally {
      setSubmitting(false);
    }
  };



  const uniqueCategories = useMemo(() => {
    const cats = new Set<string>();
    products?.forEach(p => cats.add(p.category));
    return Array.from(cats).sort();
  }, [products]);

  const filtered = useMemo(() => {
    return (products || []).filter(p => {
      const q = search.toLowerCase();
      const matchSearch = !q || p.name.toLowerCase().includes(q) || p.category.toLowerCase().includes(q);
      const matchCat = filterCat === 'ALL' || p.category === filterCat;
      const matchStatus = filterStatus === 'ALL' || (filterStatus === 'ACTIVE' ? p.active : !p.active);
      // FASE NF.7.8.3 — filtro aditivo "Apenas importados".
      // Comparação === true evita falso positivo de truthy values e
      // mantém o filtro 100% inerte quando o toggle está desligado.
      const matchImportado = !onlyImportados || (p as any).importado === true;
      return matchSearch && matchCat && matchStatus && matchImportado;
    });
  }, [products, search, filterCat, filterStatus, onlyImportados]);

  return (
    <Layout>
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-8 gap-4">
        <div>
          <h1 className="text-3xl font-display font-bold text-foreground">Catálogo de Produtos</h1>
          <p className="text-muted-foreground mt-1">Gerencie frutas, unidades, preços e atributos.</p>
        </div>
        <button
          data-testid="button-add-product"
          onClick={openCreate}
          className="flex items-center gap-2 px-6 py-3 bg-primary text-primary-foreground font-bold rounded-xl shadow-lg shadow-primary/25 hover:shadow-xl hover:-translate-y-0.5 transition-all"
        >
          <Plus className="w-5 h-5" /> Novo Produto
        </button>
      </div>

      {/* Price Variation Alerts */}
      <PriceAlertsSection />

      {/* Safra Alerts */}
      {products && <SafraAlertsSection allProducts={products as any[]} />}

      {/* Search + Filter Bar */}
      <div className="bg-card rounded-2xl border border-border/50 premium-shadow p-4 mb-6 flex flex-wrap gap-3 items-center">
        <div className="relative flex-1 min-w-[180px] max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input
            value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Buscar produto..."
            className="w-full pl-9 pr-4 py-2.5 rounded-xl border-2 border-border focus:border-primary outline-none text-sm"
          />
          {search && <button onClick={() => setSearch("")} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"><X className="w-3.5 h-3.5" /></button>}
        </div>
        <select value={filterCat} onChange={e => setFilterCat(e.target.value)}
          className="px-3 py-2.5 rounded-xl border-2 border-border text-sm focus:border-primary outline-none">
          <option value="ALL">Todas as categorias</option>
          {uniqueCategories.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        {['ALL', 'ACTIVE', 'INACTIVE'].map(s => (
          <button key={s} onClick={() => setFilterStatus(s)}
            className={`px-3 py-2 rounded-xl text-xs font-bold border-2 transition-all ${filterStatus === s ? 'bg-primary text-white border-primary' : 'border-border text-muted-foreground hover:border-primary/50'}`}>
            {s === 'ALL' ? 'Todos' : s === 'ACTIVE' ? 'Ativos' : 'Inativos'}
          </button>
        ))}
        {/* FASE NF.7.8.3 — Toggle "Apenas importados".
            Aditivo aos filtros de categoria/status/busca (AND lógico no
            useMemo acima). Paleta laranja casa com o badge da listagem
            (NF.7.8.2) para reforço visual: filtro ON = todos os cards
            visíveis terão o badge "Importado". */}
        <button
          type="button"
          onClick={() => setOnlyImportados(v => !v)}
          data-testid="filter-only-importados"
          aria-pressed={onlyImportados}
          title="Mostrar apenas produtos com a flag de importado (ICMS 4%)"
          className={`px-3 py-2 rounded-xl text-xs font-bold border-2 transition-all ${onlyImportados ? 'bg-orange-100 text-orange-700 border-orange-300' : 'border-border text-muted-foreground hover:border-orange-300'}`}
        >
          Apenas importados
        </button>
        <span className="text-xs text-muted-foreground font-medium">{filtered.length} produto{filtered.length !== 1 ? 's' : ''}</span>
      </div>

      {/* Products grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
        {isLoading ? (
          <div className="col-span-full p-8 text-center text-muted-foreground">Carregando produtos...</div>
        ) : filtered.length === 0 ? (
          <div className="col-span-full p-8 text-center text-muted-foreground">Nenhum produto encontrado.</div>
        ) : filtered.map(product => (
          <div key={product.id} className="bg-card rounded-2xl p-6 border border-border/50 premium-shadow flex flex-col items-center text-center group relative">
            <button
              data-testid={`button-edit-product-${product.id}`}
              onClick={() => openEdit(product)}
              className="absolute top-3 right-3 p-2 rounded-lg text-muted-foreground hover:bg-primary/10 hover:text-primary transition-colors opacity-0 group-hover:opacity-100"
            >
              <Edit2 className="w-4 h-4" />
            </button>

            {/* Flag badges top-left */}
            <div className="absolute top-3 left-3 flex flex-col gap-1">
              {(product as any).isIndustrialized && (
                <span className="flex items-center gap-0.5 px-1.5 py-0.5 bg-orange-100 text-orange-700 rounded-md text-xs font-bold">
                  <Factory className="w-3 h-3" /> Ind.
                </span>
              )}
              {(product as any).isSeasonal && (
                <span className="flex items-center gap-0.5 px-1.5 py-0.5 bg-blue-100 text-blue-700 rounded-md text-xs font-bold">
                  <Snowflake className="w-3 h-3" /> Saz.
                </span>
              )}
              {(product as any).outOfSeason && (
                <span className="flex items-center gap-0.5 px-1.5 py-0.5 bg-red-100 text-red-700 rounded-md text-xs font-bold">
                  <Leaf className="w-3 h-3" /> Fora de safra
                </span>
              )}
            </div>

            {(product as any).imageUrl ? (
              <div className="w-20 h-20 rounded-2xl overflow-hidden mb-4 border-2 border-border bg-white">
                <img
                  src={(product as any).imageUrl}
                  alt={product.name}
                  onError={(e) => {
                    // Fallback discreto: esconde o <img> e mostra o ícone
                    // genérico no lugar, sem quebrar o layout do card.
                    const img = e.currentTarget;
                    img.style.display = "none";
                    const parent = img.parentElement;
                    if (parent && !parent.querySelector(".img-fallback")) {
                      const fallback = document.createElement("div");
                      fallback.className = "img-fallback w-full h-full flex items-center justify-center bg-muted";
                      fallback.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="text-muted-foreground"><path d="m7.5 4.27 9 5.15"/><path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/><path d="m3.3 7 8.7 5 8.7-5"/><path d="M12 22V12"/></svg>';
                      parent.appendChild(fallback);
                    }
                  }}
                  className="w-full h-full object-cover"
                  data-testid={`img-product-${product.id}`}
                />
              </div>
            ) : (
              <div className={`w-16 h-16 rounded-full flex items-center justify-center mb-4 ${product.active ? 'bg-secondary/10' : 'bg-muted'}`}>
                <Package className={`w-8 h-8 ${product.active ? 'text-secondary' : 'text-muted-foreground'}`} />
              </div>
            )}

            {(product as any).productCode && (
              <span className="mb-1 text-xs bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 px-2 py-0.5 rounded-md font-mono font-bold">
                #{(product as any).productCode}
              </span>
            )}
            {/* FASE NF.7.8.2 — indicador visual de produto importado.
                Posicionado ao lado do nome (spec ETAPA 3). Texto explícito
                ("Importado") garante acessibilidade — não depende só de cor.
                Comparação === true evita falso positivo de truthy values
                (string "true", number 1, etc.) em payloads degenerados. */}
            <div className="flex items-center justify-center gap-2 flex-wrap">
              <h3 className="text-lg font-bold text-foreground">{product.name}</h3>
              {(product as any).importado === true && (
                <span
                  data-testid={`badge-product-importado-${product.id}`}
                  className="inline-flex items-center rounded-md bg-orange-100 px-2 py-0.5 text-xs font-semibold text-orange-700"
                  title="Produto importado — ICMS calculado a 4%"
                >
                  Importado
                </span>
              )}
            </div>
            <p className="text-sm font-semibold text-muted-foreground uppercase tracking-widest mt-1">{product.category}</p>

            {(product as any).observation && (
              <p className="text-xs text-muted-foreground mt-1.5 italic line-clamp-2">{(product as any).observation}</p>
            )}

            <div className="mt-3 inline-block px-3 py-1 bg-muted rounded-lg text-sm font-bold text-foreground">
              Por {product.unit}
            </div>

            {(product as any).availableDays && Array.isArray((product as any).availableDays) && (product as any).availableDays.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1 justify-center">
                {((product as any).availableDays as string[]).map(d => (
                  <span key={d} className="px-1.5 py-0.5 bg-primary/10 text-primary text-xs font-medium rounded">
                    {d.split('-')[0].slice(0, 3)}
                  </span>
                ))}
              </div>
            )}

            {(() => {
              // Admin price view — no per-company context here, so adminFee
              // is intentionally NOT applied. We still route through the
              // resolver so override badges (Categoria / Contrato) appear
              // whenever those values are present on the product row.
              const productPricingMode = (product as any).pricingMode as
                | "base"
                | "category"
                | undefined;
              const resolved = resolvePrice({
                basePrice: product.basePrice,
                subCategoryPrice: (product as any).subCategoryPrice,
                contractPrice: (product as any).contractPrice,
                useNewPricing: false,
                pricingMode: productPricingMode,
              });
              const source = priceSource({
                basePrice: product.basePrice,
                subCategoryPrice: (product as any).subCategoryPrice,
                contractPrice: (product as any).contractPrice,
              });
              const sourceLabel =
                source === "contract" ? "contrato" : source === "subcategory" ? "categoria" : "base";

              if (product.basePrice == null && resolved === 0) {
                return (
                  <div className="mt-3 px-4 py-2 bg-orange-50 rounded-xl border border-orange-200" data-testid={`price-missing-${product.id}`}>
                    <p className="text-xs font-bold text-orange-600">Preço base não definido</p>
                  </div>
                );
              }
              return (
                <div className="mt-3 flex flex-col items-center gap-1.5">
                  <div className="flex items-center gap-1.5 px-4 py-2 bg-primary/10 rounded-xl">
                    <DollarSign className="w-4 h-4 text-primary" />
                    <span className="text-sm font-bold text-primary" data-testid={`text-price-${product.id}`}>
                      {formatPriceOrDash(resolved)}{" "}
                      <span className="font-normal text-primary/70">({sourceLabel})</span>
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-1 justify-center">
                    {(product as any).subCategoryPrice != null && (
                      <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-blue-100 text-blue-700" data-testid={`badge-subcategory-${product.id}`}>
                        Categoria
                      </span>
                    )}
                    {(product as any).contractPrice != null && (
                      <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-purple-100 text-purple-700" data-testid={`badge-contract-${product.id}`}>
                        Contrato
                      </span>
                    )}
                  </div>
                </div>
              );
            })()}

            <div className="flex flex-wrap gap-1.5 justify-center mt-3">
              <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${product.active ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                {product.active ? 'Ativo' : 'Inativo'}
              </span>
              {(product as any).categoryAvailability === 'specific' && (
                <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-teal-100 text-teal-700 flex items-center gap-0.5">
                  <Tag className="w-2.5 h-2.5" /> Cats. restritas
                </span>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Modal Create / Edit */}
      <Modal
        isOpen={isModalOpen}
        onClose={closeModal}
        title={editingProduct ? `Editar: ${editingProduct.name}` : "Novo Produto"}
        maxWidth="max-w-2xl"
      >
        <form onSubmit={handleSubmit} className="space-y-5">
          {/* ── ID do Produto ─────────────────────── */}
          <div className={`p-4 rounded-xl border-2 ${codeError ? 'border-red-400 bg-red-50' : 'border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-800/30'}`}>
            <label className="flex items-center gap-1.5 text-sm font-bold text-slate-700 dark:text-slate-300 mb-2">
              <Hash className="w-4 h-4" /> ID do Produto Base
            </label>
            <div className="flex gap-2">
              <input
                value={formData.productCode}
                onChange={e => { set("productCode", e.target.value); setCodeError(null); }}
                onBlur={e => checkCodeUniqueness(e.target.value)}
                className={`flex-1 px-4 py-2.5 rounded-xl border-2 outline-none font-mono text-sm ${codeError ? 'border-red-400 focus:border-red-500 bg-white' : 'border-border focus:border-primary'}`}
                placeholder="ex: 001"
                data-testid="input-product-code"
              />
              <button
                type="button"
                data-testid="button-auto-generate-code"
                onClick={async () => {
                  try {
                    const res = await fetchWithAuth('/api/products/next-code');
                    const data = await res.json();
                    set("productCode", data.nextCode);
                  } catch { /* ignore */ }
                }}
                className="px-3 py-2.5 rounded-xl border-2 border-primary/30 text-primary hover:bg-primary/10 transition-colors text-xs font-bold whitespace-nowrap"
              >
                Gerar Auto
              </button>
            </div>
            {codeError ? (
              <p className="flex items-start gap-1 text-xs text-red-700 font-semibold mt-1.5">
                <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" /> {codeError}
              </p>
            ) : (
              <p className="text-xs text-muted-foreground mt-1.5">
                Identifica o produto base. Produtos com mesmo ID são agrupados para análise de custo.
              </p>
            )}
          </div>

          <div>
            <label className="block text-sm font-semibold mb-1">Nome do Produto *</label>
            <input required value={formData.name} onChange={e => set("name", e.target.value)}
              className="w-full px-4 py-2.5 rounded-xl border-2 border-border focus:border-primary outline-none"
              placeholder="ex: Banana Nanica" />
          </div>

          <div>
            <label className="block text-sm font-semibold mb-1">Unidade *</label>
            <select value={formData.unit} onChange={e => set("unit", e.target.value)}
              className="w-full px-4 py-2.5 rounded-xl border-2 border-border focus:border-primary outline-none">
              {UNITS.map(u => <option key={u.value} value={u.value}>{u.label}</option>)}
            </select>
          </div>

          {/* Observação */}
          <div>
            <label className="flex items-center gap-1 text-sm font-semibold mb-1">
              <AlignLeft className="w-4 h-4" /> Observação
            </label>
            <input value={formData.observation} onChange={e => set("observation", e.target.value)}
              className="w-full px-4 py-2.5 rounded-xl border-2 border-border focus:border-primary outline-none"
              placeholder="ex: Display com 12 unidades, Bandeja com 6 potes..." />
            <p className="text-xs text-muted-foreground mt-1">Aparece no catálogo do cliente e nos relatórios.</p>
          </div>

          {/* Curiosidade */}
          <div className="p-4 rounded-xl border-2 border-amber-200 bg-amber-50">
            <label className="flex items-center gap-1 text-sm font-bold text-amber-800 mb-2">
              🍊 Curiosidade do Produto
            </label>
            <textarea value={formData.curiosity} onChange={e => set("curiosity", e.target.value)}
              rows={3}
              className="w-full px-3 py-2.5 rounded-xl border-2 border-amber-200 focus:border-amber-400 outline-none text-sm bg-white resize-none"
              placeholder="ex: A maçã contém antioxidantes naturais que ajudam a proteger o coração..." />
            <p className="text-xs text-amber-700 mt-1">Conteúdo educativo exibido no assistente virtual e no quadro de curiosidades.</p>
          </div>

          {/* Flags row */}
          <div className="grid grid-cols-2 gap-4">
            <div className="p-4 rounded-xl border-2 border-orange-200 bg-orange-50">
              <label className="flex items-center gap-2 cursor-pointer">
                <div className={`w-10 h-6 rounded-full transition-colors ${formData.isIndustrialized ? 'bg-orange-500' : 'bg-muted'} relative flex-shrink-0`}
                  onClick={() => set("isIndustrialized", !formData.isIndustrialized)}>
                  <div className={`w-4 h-4 rounded-full bg-white shadow absolute top-1 transition-all ${formData.isIndustrialized ? 'left-5' : 'left-1'}`} />
                </div>
                <div>
                  <p className="font-bold text-sm text-orange-800 flex items-center gap-1"><Factory className="w-4 h-4" /> Industrializado</p>
                  <p className="text-xs text-orange-600">Registrado no controle de industrializados</p>
                </div>
              </label>
            </div>
            <div className="p-4 rounded-xl border-2 border-blue-200 bg-blue-50">
              <label className="flex items-center gap-2 cursor-pointer">
                <div className={`w-10 h-6 rounded-full transition-colors ${formData.isSeasonal ? 'bg-blue-500' : 'bg-muted'} relative flex-shrink-0`}
                  onClick={() => set("isSeasonal", !formData.isSeasonal)}>
                  <div className={`w-4 h-4 rounded-full bg-white shadow absolute top-1 transition-all ${formData.isSeasonal ? 'left-5' : 'left-1'}`} />
                </div>
                <div>
                  <p className="font-bold text-sm text-blue-800 flex items-center gap-1"><Snowflake className="w-4 h-4" /> Sazonal</p>
                  <p className="text-xs text-blue-600">Produto disponível sazonalmente</p>
                </div>
              </label>
            </div>
          </div>

          {/* Out of Season toggle */}
          <div className={`p-4 rounded-xl border-2 transition-colors ${formData.outOfSeason ? 'border-red-300 bg-red-50' : 'border-border bg-muted/20'}`}>
            <label className="flex items-center gap-3 cursor-pointer">
              <div className={`w-10 h-6 rounded-full transition-colors ${formData.outOfSeason ? 'bg-red-500' : 'bg-muted'} relative flex-shrink-0`}
                onClick={() => set("outOfSeason", !formData.outOfSeason)}
                data-testid="toggle-out-of-season">
                <div className={`w-4 h-4 rounded-full bg-white shadow absolute top-1 transition-all ${formData.outOfSeason ? 'left-5' : 'left-1'}`} />
              </div>
              <div>
                <p className={`font-bold text-sm flex items-center gap-1 ${formData.outOfSeason ? 'text-red-800' : 'text-foreground'}`}>
                  <Leaf className="w-4 h-4" /> Safra Encerrada / Produto Indisponível
                </p>
                <p className={`text-xs ${formData.outOfSeason ? 'text-red-600' : 'text-muted-foreground'}`}>
                  {formData.outOfSeason
                    ? 'Alerta ativo — sistema verificará pedidos existentes com este produto'
                    : 'Ativar quando o produto estiver temporariamente indisponível por safra'}
                </p>
              </div>
            </label>
          </div>

          {/* Dados Fiscais */}
          <div className="p-4 rounded-xl border-2 border-violet-200 bg-violet-50">
            <label className="flex items-center gap-1 text-sm font-bold text-violet-800 mb-3">
              <span className="text-xs bg-violet-200 text-violet-700 px-2 py-0.5 rounded-full font-bold uppercase tracking-wider">Dados Fiscais</span>
            </label>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="block text-xs font-semibold text-violet-700 mb-1">NCM</label>
                <input value={formData.ncm} onChange={e => set("ncm", e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border-2 border-violet-200 focus:border-violet-400 outline-none text-sm"
                  placeholder="ex: 0803.10.00" />
                <p className="text-xs text-muted-foreground mt-0.5">Nomenclatura Comum do Mercosul</p>
              </div>
              <div>
                <label className="block text-xs font-semibold text-violet-700 mb-1">CFOP</label>
                <input value={formData.cfop} onChange={e => set("cfop", e.target.value)}
                  data-testid="input-product-cfop"
                  className="w-full px-3 py-2 rounded-lg border-2 border-violet-200 focus:border-violet-400 outline-none text-sm"
                  placeholder="ex: 5102" />
                <p className="text-xs text-muted-foreground mt-0.5">Código Fiscal de Operações</p>
              </div>
              {/* FASE NF.6.3 — ETAPA 2: select de CST (ICMS).
                  Vazio = "padrão (00)". Aplicável a CRT=3 (Lucro Presumido / Real).
                  Em Simples Nacional (CRT=1/2) o generator IGNORA este campo
                  (branch CSOSN intacto desde NF.5.1) — sem necessidade de
                  condicional na UI, conforme ETAPA 5 da spec. */}
              <div>
                <label className="block text-xs font-semibold text-violet-700 mb-1">CST (ICMS)</label>
                <select
                  value={formData.cst}
                  onChange={e => set("cst", e.target.value)}
                  data-testid="select-product-cst"
                  className="w-full px-3 py-2 rounded-lg border-2 border-violet-200 focus:border-violet-400 outline-none text-sm bg-white"
                >
                  <option value="">Padrão (00)</option>
                  <option value="00">00 — Tributada integralmente</option>
                  <option value="20">20 — Com redução de BC</option>
                  <option value="40">40 — Isenta</option>
                  <option value="60">60 — ICMS cobrado anteriormente por ST</option>
                </select>
                <p className="text-xs text-muted-foreground mt-0.5">Lucro Presumido/Real. Ignorado no Simples Nacional.</p>
              </div>
              <div>
                <label className="block text-xs font-semibold text-violet-700 mb-1">Unid. Comercial</label>
                <input value={formData.commercialUnit} onChange={e => set("commercialUnit", e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border-2 border-violet-200 focus:border-violet-400 outline-none text-sm"
                  placeholder="ex: KG, UN, CX" />
                <p className="text-xs text-muted-foreground mt-0.5">Para NF-e</p>
              </div>
            </div>

            {/* FASE NF.7.8.1 — Checkbox Produto Importado.
                Quando marcado, o item gera ICMS a 4% (Resolução 13/2012 do
                Senado), com prioridade sobre regra de UF. Não esconder por
                CRT — em Simples Nacional o cálculo já é ignorado pelo
                generator (branch CSOSN intocado). NÃO inferir por NCM
                aqui — controle continua manual e explícito. */}
            <div className="mt-3 pt-3 border-t border-violet-200">
              <label
                className="flex items-start gap-2 cursor-pointer"
                data-testid="label-product-importado"
              >
                <input
                  type="checkbox"
                  checked={formData.importado}
                  onChange={(e) => set("importado", e.target.checked)}
                  data-testid="checkbox-product-importado"
                  className="mt-0.5 h-4 w-4 rounded border-violet-300 text-violet-600 focus:ring-violet-500"
                />
                <div className="flex-1">
                  <span className="text-sm font-semibold text-violet-800">
                    Produto importado (ICMS 4%)
                  </span>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Marque apenas se o produto for importado ou possuir
                    conteúdo de importação relevante. Aplica alíquota de 4%
                    independentemente do estado de destino.
                  </p>
                </div>
              </label>
            </div>
          </div>

          {/* Available days */}
          <div>
            <label className="flex items-center gap-1 text-sm font-semibold mb-2">
              <CalendarDays className="w-4 h-4" /> Dias de Venda Disponíveis
            </label>
            <p className="text-xs text-muted-foreground mb-2">Deixe em branco para disponível todos os dias.</p>
            <div className="flex flex-wrap gap-2">
              {DAYS.map(day => (
                <button
                  key={day} type="button"
                  onClick={() => toggleDay(day)}
                  className={`px-3 py-1.5 rounded-xl text-xs font-bold border-2 transition-all ${formData.availableDays.includes(day) ? 'bg-primary text-white border-primary' : 'border-border text-muted-foreground hover:border-primary/50'}`}>
                  {day.split('-')[0]}
                </button>
              ))}
            </div>
          </div>

          {/* ── Modo de Precificação ──────────────────────── */}
          <div className="rounded-2xl border-2 border-border bg-muted/20 p-4">
            <p className="text-xs font-bold text-muted-foreground uppercase tracking-wide mb-3">
              Modo de Precificação
            </p>
            <div className="flex flex-col sm:flex-row gap-2">
              <label
                className={`flex-1 cursor-pointer flex items-center gap-3 px-4 py-3 rounded-xl border-2 transition-all ${formData.pricingMode === 'category' ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-950/40' : 'border-border bg-background hover:border-indigo-300'}`}
                data-testid="radio-pricing-mode-category"
              >
                <input
                  type="radio"
                  name="pricingMode"
                  value="category"
                  checked={formData.pricingMode === 'category'}
                  onChange={() => set('pricingMode', 'category')}
                  className="w-4 h-4 accent-indigo-600"
                />
                <div className="flex-1">
                  <p className="text-sm font-bold text-foreground flex items-center gap-1.5">
                    <Tags className="w-4 h-4 text-indigo-600" /> Preço por categoria
                  </p>
                  <p className="text-xs text-muted-foreground">Um preço por sub-categoria do produto.</p>
                </div>
              </label>
              <label
                className={`flex-1 cursor-pointer flex items-center gap-3 px-4 py-3 rounded-xl border-2 transition-all ${formData.pricingMode === 'base' ? 'border-primary bg-primary/10' : 'border-border bg-background hover:border-primary/50'}`}
                data-testid="radio-pricing-mode-base"
              >
                <input
                  type="radio"
                  name="pricingMode"
                  value="base"
                  checked={formData.pricingMode === 'base'}
                  onChange={() => set('pricingMode', 'base')}
                  className="w-4 h-4 accent-primary"
                />
                <div className="flex-1">
                  <p className="text-sm font-bold text-foreground flex items-center gap-1.5">
                    <DollarSign className="w-4 h-4 text-primary" /> Preço base único
                  </p>
                  <p className="text-xs text-muted-foreground">Um único preço aplicado ao produto.</p>
                </div>
              </label>
            </div>
          </div>

          {/* ── Categorias + Preços (da base central) ─────── */}
          {formData.pricingMode === 'category' && (
            <div className="rounded-2xl border-2 border-indigo-200 bg-gradient-to-br from-indigo-50 to-violet-50 dark:from-indigo-950/30 dark:to-violet-950/20 overflow-hidden">
              <div className="flex items-center gap-2 px-4 py-3 bg-indigo-600 text-white">
                <Tags className="w-4 h-4" />
                <span className="text-sm font-bold">Categorias + Preços <span className="text-indigo-300">*</span></span>
                <span className="ml-auto text-xs bg-white/20 px-2 py-0.5 rounded-full">
                  {formData.categorySelections.length} selecionada{formData.categorySelections.length !== 1 ? 's' : ''}
                </span>
              </div>
              <div className="p-4">
                <p className="text-xs text-indigo-700 dark:text-indigo-300 mb-3">
                  Selecione as categorias aplicáveis ao produto e informe o preço de cada uma. Categorias são gerenciadas na aba <strong>Categorias</strong>.
                </p>
                <ProductCategorySelector
                  dbCategories={categories}
                  selections={formData.categorySelections}
                  onChange={(sel) => set('categorySelections', sel)}
                />
                {formData.categorySelections.length === 0 && (
                  <p className="text-xs text-orange-600 mt-3 flex items-center gap-1 font-semibold">
                    <AlertTriangle className="w-3 h-3" /> Selecione ao menos uma categoria com preço
                  </p>
                )}
              </div>
            </div>
          )}

          {/* Base Price */}
          {formData.pricingMode === 'base' && (
            <div className={`p-4 rounded-xl border-2 ${priceError ? 'border-red-400 bg-red-50' : 'border-primary/20 bg-primary/5'}`}>
              <label className={`flex items-center gap-2 text-sm font-bold mb-2 ${priceError ? 'text-red-600' : 'text-primary'}`}>
                <DollarSign className="w-4 h-4" /> Preço Base Interno (R$) <span className="text-red-500">*</span>
              </label>
              <input
                type="number" step="0.01" min="0"
                value={formData.basePrice}
                onChange={e => { set("basePrice", e.target.value); if (priceError) setPriceError(false); }}
                placeholder="Ex: 5,90"
                data-testid="input-product-price"
                className={`w-full px-4 py-2.5 rounded-xl border-2 focus:outline-none text-lg font-bold ${priceError ? 'border-red-400 focus:border-red-500 bg-white' : 'border-border focus:border-primary'}`}
              />
              {priceError && (
                <p className="flex items-center gap-1.5 text-xs text-red-600 font-semibold mt-2">
                  <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
                  Preço obrigatório. Informe um valor maior que zero.
                </p>
              )}
              {!priceError && (
                <p className="text-xs text-muted-foreground mt-2">
                  Preço base interno. Preço final ao cliente = base × (1 + taxa admin / 100).
                </p>
              )}
            </div>
          )}

          {/* ── Imagem do Produto ───────────────────────────── */}
          <div className="rounded-2xl border-2 border-border bg-muted/10 p-4 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <label className="text-sm font-bold text-foreground flex items-center gap-1.5">
                <Package className="w-4 h-4" /> Imagem do produto
                <span className="text-xs font-normal text-muted-foreground">(opcional)</span>
              </label>
              {formData.imageUrl && (
                <button
                  type="button"
                  onClick={() => setFormData(prev => ({ ...prev, imageUrl: null }))}
                  className="text-xs font-bold text-red-600 hover:text-red-700 hover:underline"
                  data-testid="button-remove-image"
                >
                  Remover imagem
                </button>
              )}
            </div>

            {/* Mode toggle */}
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => handleChangeImageMode("url")}
                className={`flex-1 px-3 py-2 rounded-lg text-xs font-bold border-2 transition-all ${imageMode === "url" ? 'bg-primary text-white border-primary' : 'border-border text-muted-foreground hover:border-primary/50'}`}
                data-testid="button-image-mode-url"
              >
                Usar URL
              </button>
              <button
                type="button"
                onClick={() => handleChangeImageMode("upload")}
                className={`flex-1 px-3 py-2 rounded-lg text-xs font-bold border-2 transition-all ${imageMode === "upload" ? 'bg-primary text-white border-primary' : 'border-border text-muted-foreground hover:border-primary/50'}`}
                data-testid="button-image-mode-upload"
              >
                Enviar arquivo
              </button>
            </div>

            {/* URL input */}
            {imageMode === "url" && (
              <input
                type="url"
                placeholder="https://exemplo.com/imagem.jpg"
                value={formData.imageUrl ?? ""}
                onChange={e => set("imageUrl", e.target.value || null)}
                data-testid="input-image-url"
                className="w-full px-4 py-2.5 rounded-xl border-2 border-border focus:border-primary focus:outline-none text-sm"
              />
            )}

            {/* Upload input */}
            {imageMode === "upload" && (
              <div className="space-y-2">
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp,image/gif"
                  onChange={e => {
                    const f = e.target.files?.[0];
                    if (f) handleUploadImage(f);
                    e.target.value = "";
                  }}
                  disabled={uploadingImage}
                  data-testid="input-image-file"
                  className="block w-full text-xs text-muted-foreground file:mr-3 file:py-2 file:px-4 file:rounded-lg file:border-0 file:bg-primary file:text-white file:font-bold file:cursor-pointer hover:file:bg-primary/90 disabled:opacity-50"
                />
                {uploadingImage && (
                  <p className="text-xs text-muted-foreground">Enviando arquivo…</p>
                )}
                <p className="text-xs text-muted-foreground">
                  Formatos: JPG, PNG, WEBP ou GIF · Máx. 5MB.
                </p>
              </div>
            )}

            {/* ── AJUSTE 3 + 4: preview seguro com fallback. */}
            {formData.imageUrl && (
              <div className="flex items-center gap-3 pt-2 border-t border-border">
                <img
                  src={formData.imageUrl}
                  alt="Pré-visualização do produto"
                  onError={(e) => {
                    e.currentTarget.style.opacity = "0.4";
                    e.currentTarget.title = "Imagem indisponível";
                  }}
                  className="w-20 h-20 object-cover rounded-lg border-2 border-border bg-white"
                  data-testid="img-product-preview"
                />
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-bold text-foreground">Pré-visualização</p>
                  <p className="text-xs text-muted-foreground truncate" title={formData.imageUrl}>
                    {formData.imageUrl.startsWith("/uploads") ? "Arquivo enviado" : formData.imageUrl}
                  </p>
                </div>
              </div>
            )}
          </div>

          {/* Status */}
          <div>
            <label className="block text-sm font-semibold mb-2">Status</label>
            <div className="flex gap-3">
              <button type="button" onClick={() => set("active", true)}
                className={`flex items-center gap-2 px-5 py-2.5 rounded-xl font-bold text-sm border-2 transition-all ${formData.active ? 'bg-green-600 text-white border-green-600' : 'border-border text-muted-foreground hover:border-green-400'}`}>
                <CheckCircle className="w-4 h-4" /> Ativo
              </button>
              <button type="button" onClick={() => set("active", false)}
                className={`flex items-center gap-2 px-5 py-2.5 rounded-xl font-bold text-sm border-2 transition-all ${!formData.active ? 'bg-red-600 text-white border-red-600' : 'border-border text-muted-foreground hover:border-red-400'}`}>
                <XCircle className="w-4 h-4" /> Inativo
              </button>
            </div>
          </div>

          {/* Erros de validação de ID/duplicação */}
          {(codeError || duplicateError) && (
            <div className="p-3 rounded-xl border-2 border-red-300 bg-red-50 space-y-1">
              {codeError && (
                <p className="flex items-start gap-1.5 text-xs text-red-700 font-semibold">
                  <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
                  {codeError}
                </p>
              )}
              {duplicateError && (
                <p className="flex items-start gap-1.5 text-xs text-red-700 font-semibold">
                  <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
                  {duplicateError}
                </p>
              )}
            </div>
          )}

          <button type="submit" disabled={submitting}
            data-testid="button-submit-product"
            className="w-full py-3 bg-primary text-white font-bold rounded-xl shadow-lg hover:-translate-y-0.5 transition-transform disabled:opacity-50 flex items-center justify-center gap-2">
            {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
            {submitting ? "Salvando..." : editingProduct ? "Salvar Alterações" : "Adicionar Produto"}
          </button>
        </form>
      </Modal>
    </Layout>
  );
}
