import { useState, useMemo } from "react";
import { useCompanies, useCreateCompany, useUpdateCompany, usePriceGroups } from "@/hooks/use-admin";
import { Layout } from "@/components/Layout";
import { Modal } from "@/components/Modal";
import {
  Plus, Building2, Mail, Hash, Phone, Clock, Edit2,
  CheckCircle, CheckCircle2, XCircle, CalendarDays, CreditCard, DollarSign,
  FileText, Settings, User, Percent, Search, Filter, X, Package, Trash2, Save, MapPin, Loader2, Lock
} from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useProducts } from "@/hooks/use-catalog";
import { useToast } from "@/hooks/use-toast";
import type { Company } from "@shared/schema";

const DAYS_OPTIONS = ["Segunda-feira", "Terça-feira", "Quarta-feira", "Quinta-feira", "Sexta-feira"];

type TabKey = "basico" | "config" | "financeiro" | "contrato" | "entrega";

const TABS: { key: TabKey; label: string; icon: any }[] = [
  { key: "basico", label: "Dados Básicos", icon: User },
  { key: "config", label: "Configurações", icon: Settings },
  { key: "financeiro", label: "Financeiro", icon: CreditCard },
  { key: "contrato", label: "Escopo Contratual", icon: Package },
  { key: "entrega", label: "Configuração de Entrega", icon: Clock },
];

type DeliveryDayConfig = { enabled: boolean; startTime: string; endTime: string };
type DeliveryConfig = { [day: string]: DeliveryDayConfig };

const DEFAULT_DELIVERY_CONFIG: DeliveryConfig = {
  "Segunda-feira": { enabled: false, startTime: "09:00", endTime: "10:00" },
  "Terça-feira": { enabled: false, startTime: "09:00", endTime: "10:00" },
  "Quarta-feira": { enabled: false, startTime: "09:00", endTime: "10:00" },
  "Quinta-feira": { enabled: false, startTime: "09:00", endTime: "10:00" },
  "Sexta-feira": { enabled: false, startTime: "09:00", endTime: "10:00" },
};

function parseDeliveryConfig(json: string | null | undefined): DeliveryConfig {
  try {
    return json ? { ...DEFAULT_DELIVERY_CONFIG, ...JSON.parse(json) } : { ...DEFAULT_DELIVERY_CONFIG };
  } catch {
    return { ...DEFAULT_DELIVERY_CONFIG };
  }
}

const emptyForm = {
  companyName: "",
  contactName: "",
  email: "",
  password: "",
  notificationEmail: "",
  phone: "",
  cnpj: "",
  addressStreet: "",
  addressNumber: "",
  addressNeighborhood: "",
  addressCity: "",
  addressZip: "",
  latitude: "",
  longitude: "",
  priceGroupId: "",
  allowedOrderDays: [] as string[],
  active: true,
  clientType: "mensal",
  contractModel: "",
  minWeeklyBilling: "",
  deliveryTime: "",
  adminFee: "0",
  billingTerm: "",
  billingType: "",
  billingFormat: "",
  paymentDates: "",
  financialNotes: "",
  deliveryConfigJson: null as DeliveryConfig | null,
  autoCalcCost: true,
  autoPriceFromCatalog: false,
  manualAvgCost: "",
};

function companyToForm(c: Company): typeof emptyForm {
  const ca = c as any;
  return {
    companyName: c.companyName,
    contactName: c.contactName,
    email: c.email,
    password: "",
    notificationEmail: ca.notificationEmail || "",
    phone: c.phone || "",
    cnpj: ca.cnpj || "",
    addressStreet: ca.addressStreet || "",
    addressNumber: ca.addressNumber || "",
    addressNeighborhood: ca.addressNeighborhood || "",
    addressCity: ca.addressCity || "",
    addressZip: ca.addressZip || "",
    latitude: ca.latitude ? String(ca.latitude) : "",
    longitude: ca.longitude ? String(ca.longitude) : "",
    priceGroupId: c.priceGroupId ? String(c.priceGroupId) : "",
    allowedOrderDays: Array.isArray(c.allowedOrderDays) ? (c.allowedOrderDays as any[]).map(String) : [],
    active: c.active,
    clientType: c.clientType || "mensal",
    contractModel: (c as any).contractModel || "",
    minWeeklyBilling: c.minWeeklyBilling ? String(c.minWeeklyBilling) : "",
    deliveryTime: c.deliveryTime || "",
    adminFee: c.adminFee ? String(c.adminFee) : "0",
    billingTerm: c.billingTerm || "",
    billingType: c.billingType || "",
    billingFormat: c.billingFormat || "",
    paymentDates: c.paymentDates || "",
    financialNotes: c.financialNotes || "",
    deliveryConfigJson: parseDeliveryConfig((c as any).deliveryConfigJson),
    autoCalcCost: ca.autoCalcCost !== false,
    autoPriceFromCatalog: !!ca.autoPriceFromCatalog,
    manualAvgCost: ca.manualAvgCost ? String(ca.manualAvgCost) : "",
  };
}

const getBillingLabel = (type: string | null) => {
  const map: Record<string, string> = { boleto: "Boleto", deposito: "Depósito", pix: "PIX" };
  return type ? (map[type] || type) : "—";
};
const getBillingFormatLabel = (f: string | null) => {
  const map: Record<string, string> = { diario: "Diário", semanal: "Semanal", mensal: "Mensal" };
  return f ? (map[f] || f) : "—";
};

const WEEK_DAYS = ["Segunda-feira", "Terça-feira", "Quarta-feira", "Quinta-feira", "Sexta-feira"];

// ─── Category color palette (cycling) ────────────────────────────
const CAT_PALETTE = [
  "bg-blue-100 text-blue-700",
  "bg-purple-100 text-purple-700",
  "bg-green-100 text-green-700",
  "bg-orange-100 text-orange-700",
  "bg-pink-100 text-pink-700",
  "bg-yellow-100 text-yellow-700",
  "bg-teal-100 text-teal-700",
  "bg-indigo-100 text-indigo-700",
];
function catColor(name: string | null | undefined, allCats: string[]) {
  if (!name) return "bg-muted text-muted-foreground";
  const idx = allCats.indexOf(name);
  return CAT_PALETTE[(idx >= 0 ? idx : 0) % CAT_PALETTE.length];
}

function fmt(v: string | null | undefined) {
  const n = Number(v);
  return isNaN(n) ? "—" : `R$ ${n.toFixed(2).replace('.', ',')}`;
}

// ─── Contract Scope Manager ──────────────────────────────────────
function ContractScopeManager({ company, contractModel, hiddenIds, onDelete,
  autoCalcCost, autoPriceFromCatalog, manualAvgCost, priceGroupId, onFlagChange, clientType }: {
  company: any | null;
  contractModel: string;
  hiddenIds: number[];
  onDelete: (id: number) => void;
  autoCalcCost: boolean;
  autoPriceFromCatalog: boolean;
  manualAvgCost: string;
  priceGroupId: number | null;
  onFlagChange: (flag: string, val: any) => void;
  clientType: string;
}) {
  const { data: products } = useProducts();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  // Load DB categories
  const { data: dbCategories } = useQuery<any[]>({
    queryKey: ['/api/categories'],
    staleTime: 60000,
  });
  const catNames = (dbCategories || []).filter((c: any) => c.active).map((c: any) => c.name as string);

  // Load product prices for auto-fill
  const { data: allPrices } = useQuery<any[]>({
    queryKey: ['/api/product-prices'],
    staleTime: 120000,
    enabled: autoPriceFromCatalog,
  });

  // Helper: get price for product from company's price group
  const getPriceForProduct = (productId: number): string => {
    if (!autoPriceFromCatalog || !priceGroupId || !allPrices) return "";
    const entry = allPrices.find((p: any) => p.productId === productId && p.priceGroupId === priceGroupId);
    return entry ? String(Number(entry.price).toFixed(2)) : "";
  };

  // New item form state
  const [newItem, setNewItem] = useState({
    dayOfWeek: "", weekNumber: "", scopeCategory: "",
    productId: "", quantity: "1", unitPrice: "", averageCost: "",
  });
  const [saving, setSaving] = useState(false);

  // Inline editing state
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editRow, setEditRow] = useState<any>({});
  const [editSaving, setEditSaving] = useState(false);

  // Order generation state
  const [generating, setGenerating] = useState(false);
  const handleGenerateOrders = async () => {
    if (!company?.id) return;
    if (!confirm('Gerar pedidos desta semana a partir do escopo contratual?')) return;
    setGenerating(true);
    try {
      const res = await fetch(`/api/companies/${company.id}/generate-orders-from-scope`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Erro ao gerar pedidos');
      alert(`✅ ${data.created} pedido(s) gerado(s) com sucesso para a semana atual!`);
      queryClient.invalidateQueries({ queryKey: ['/api/orders'] });
    } catch (e: any) {
      alert('Erro: ' + e.message);
    } finally { setGenerating(false); }
  };

  const { data: scopes, isLoading } = useQuery<any[]>({
    queryKey: ['/api/companies', company?.id, 'contract-scopes'],
    queryFn: async () => {
      if (!company?.id) return [];
      const res = await fetch(`/api/companies/${company.id}/contract-scopes`, { credentials: 'include' });
      return res.json();
    },
    enabled: !!company?.id,
  });

  // Products filtered by selected category (category name matches product.category field)
  const getProductsForCategory = (cat: string) => {
    const all = (products || []).filter((p: any) => p.active);
    if (!cat) return all;
    return all.filter((p: any) => p.category === cat);
  };

  const newItemProducts = getProductsForCategory(newItem.scopeCategory);
  const allActiveProducts = (products || []).filter((p: any) => p.active);

  // When category changes in new item form, reset product if it doesn't match
  const handleNewCategoryChange = (cat: string) => {
    const filtered = getProductsForCategory(cat);
    const currentOk = filtered.some((p: any) => String(p.id) === newItem.productId);
    const newProductId = currentOk ? newItem.productId : "";
    const autoPrice = newProductId && autoPriceFromCatalog ? getPriceForProduct(Number(newProductId)) : (currentOk ? newItem.unitPrice : "");
    setNewItem(p => ({ ...p, scopeCategory: cat, productId: newProductId, unitPrice: autoPrice }));
  };

  // When product changes, auto-fill price if flag is ON
  const handleNewProductChange = (productId: string) => {
    const price = productId && autoPriceFromCatalog ? getPriceForProduct(Number(productId)) : newItem.unitPrice;
    setNewItem(p => ({ ...p, productId, unitPrice: price }));
  };

  const addScope = async () => {
    if (!company?.id || !newItem.dayOfWeek || !newItem.productId) return;
    setSaving(true);
    try {
      const body: any = {
        companyId: company.id,
        dayOfWeek: newItem.dayOfWeek,
        scopeCategory: newItem.scopeCategory || null,
        productId: Number(newItem.productId),
        quantity: Number(newItem.quantity) || 1,
        unitPrice: newItem.unitPrice ? Number(newItem.unitPrice) : null,
        averageCost: newItem.averageCost ? Number(newItem.averageCost) : null,
      };
      if ((contractModel === 'alternado' || contractModel === 'rotacao4') && newItem.weekNumber) {
        body.weekNumber = Number(newItem.weekNumber);
      }
      const res = await fetch(`/api/companies/${company.id}/contract-scopes`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error('Erro ao adicionar item');
      queryClient.invalidateQueries({ queryKey: ['/api/companies', company.id, 'contract-scopes'] });
      setNewItem(p => ({ ...p, productId: "", quantity: "1", unitPrice: "", averageCost: "" }));
    } finally { setSaving(false); }
  };

  const startEdit = (s: any) => {
    setEditingId(s.id);
    setEditRow({
      dayOfWeek: s.dayOfWeek,
      weekNumber: s.weekNumber ? String(s.weekNumber) : "",
      scopeCategory: s.scopeCategory || "",
      productId: String(s.productId),
      quantity: String(s.quantity),
      unitPrice: s.unitPrice != null ? String(s.unitPrice) : "",
      averageCost: s.averageCost != null ? String(s.averageCost) : "",
    });
  };

  const saveEdit = async (id: number) => {
    setEditSaving(true);
    try {
      const body: any = {
        dayOfWeek: editRow.dayOfWeek,
        weekNumber: editRow.weekNumber ? Number(editRow.weekNumber) : null,
        scopeCategory: editRow.scopeCategory || null,
        productId: Number(editRow.productId),
        quantity: Number(editRow.quantity) || 1,
        unitPrice: editRow.unitPrice ? Number(editRow.unitPrice) : null,
        averageCost: editRow.averageCost ? Number(editRow.averageCost) : null,
      };
      const res = await fetch(`/api/companies/${company.id}/contract-scopes/${id}`, {
        method: 'PUT', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error('Erro ao salvar item');
      await queryClient.invalidateQueries({ queryKey: ['/api/companies', company.id, 'contract-scopes'] });
      setEditingId(null);
      toast({ title: "Item atualizado", description: "Preço e informações do item salvos com sucesso." });
    } catch (e: any) {
      toast({ title: "Erro ao salvar item", description: e.message, variant: "destructive" });
    } finally { setEditSaving(false); }
  };

  if (!company) {
    return (
      <div className="py-8 text-center text-muted-foreground text-sm">
        <Package className="w-8 h-8 mx-auto mb-2 opacity-30" />
        Salve a empresa primeiro para gerenciar o escopo contratual.
      </div>
    );
  }

  if (clientType !== 'contratual') {
    return (
      <div className="py-14 text-center text-muted-foreground flex flex-col items-center gap-3">
        <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center">
          <Lock className="w-8 h-8 opacity-25" />
        </div>
        <div>
          <p className="font-bold text-sm text-foreground">Escopo Contratual bloqueado</p>
          <p className="text-xs mt-1 text-muted-foreground">Disponível apenas para empresas do tipo <strong>Contratual</strong>.</p>
          <p className="text-xs text-muted-foreground">Altere o tipo de cliente na aba <strong>Configurações</strong>.</p>
        </div>
      </div>
    );
  }

  const isAlternado = contractModel === 'alternado';
  const isRotacao4 = contractModel === 'rotacao4';
  const hasWeekRotation = isAlternado || isRotacao4;

  const WEEK_LABELS: Record<string, string> = {
    "": 'Todas', "0": 'Todas',
    "1": 'Sem. 1 (A)', "2": 'Sem. 2 (B)', "3": 'Sem. 3 (C)', "4": 'Sem. 4 (D)',
  };

  const visibleScopes = (scopes || []).filter((s: any) => !hiddenIds.includes(s.id));

  // ── Summary calculations ──────────────────────────────────
  const totalQtd = visibleScopes.reduce((sum: number, s: any) => sum + Number(s.quantity), 0);
  const totalValor = visibleScopes.reduce((sum: number, s: any) => {
    return sum + (Number(s.quantity) * (s.unitPrice != null ? Number(s.unitPrice) : 0));
  }, 0);
  const hasPrices = visibleScopes.some((s: any) => s.unitPrice != null);
  const hasCosts = visibleScopes.some((s: any) => s.averageCost != null);
  const manualCostNum = parseFloat(manualAvgCost) || 0;
  const custoEstimado = visibleScopes.reduce((sum: number, s: any) => {
    const itemCost = s.averageCost != null
      ? Number(s.averageCost)
      : (!autoCalcCost && manualCostNum > 0 ? manualCostNum : 0);
    return sum + (Number(s.quantity) * itemCost);
  }, 0);
  const valorSemanal = totalValor;
  const valorMensal = totalValor * 4;
  const margemEstimada = valorSemanal - custoEstimado;

  // ── Group by day → week ───────────────────────────────────
  const DAY_ORDER = ["Segunda-feira", "Terça-feira", "Quarta-feira", "Quinta-feira", "Sexta-feira"];
  type DayGroup = { day: string; weekKey: string; weekNum: number; items: any[] };
  const groups: DayGroup[] = [];
  const groupMap: Record<string, DayGroup> = {};
  visibleScopes.forEach((s: any) => {
    const weekNum = s.weekNumber || 0;
    const mapKey = `${s.dayOfWeek}__${weekNum}`;
    if (!groupMap[mapKey]) {
      groupMap[mapKey] = { day: s.dayOfWeek, weekKey: String(weekNum), weekNum, items: [] };
      groups.push(groupMap[mapKey]);
    }
    groupMap[mapKey].items.push(s);
  });
  groups.sort((a, b) => {
    const di = DAY_ORDER.indexOf(a.day) - DAY_ORDER.indexOf(b.day);
    return di !== 0 ? di : a.weekNum - b.weekNum;
  });

  const selectCls = "px-2.5 py-1.5 rounded-lg border border-border text-xs focus:border-primary outline-none bg-background";
  const inputCls  = "px-2.5 py-1.5 rounded-lg border border-border text-xs focus:border-primary outline-none w-full bg-background";

  return (
    <div className="space-y-4">
      {/* ── Model badge ── */}
      <div className="flex items-center gap-2 p-3 bg-secondary/5 rounded-xl border border-secondary/20">
        <Package className="w-4 h-4 text-secondary" />
        <p className="text-sm font-bold text-secondary">
          {contractModel === 'fixo' ? 'Contrato Fixo — Escopo imutável por semana'
           : contractModel === 'variavel' ? 'Contrato Variável — Escopo base com ajustes permitidos'
           : contractModel === 'alternado' ? 'Contrato Alternado — Rotação quinzenal (Lista A / B)'
           : contractModel === 'rotacao4' ? 'Rotação 4 Semanas — Ciclo mensal (Listas A–D)'
           : 'Defina o modelo de contrato na aba Configurações'}
        </p>
      </div>

      {/* ── Configuration flags ── */}
      <div className="p-3 rounded-xl border border-border bg-muted/10 flex flex-wrap gap-4">
        {/* Flag 1: auto calc cost */}
        <label className="flex items-center gap-2.5 cursor-pointer select-none">
          <button type="button" data-testid="toggle-auto-calc-cost"
            onClick={() => onFlagChange('autoCalcCost', !autoCalcCost)}
            className={`w-10 h-5 rounded-full transition-colors relative ${autoCalcCost ? 'bg-primary' : 'bg-muted-foreground/30'}`}>
            <span className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${autoCalcCost ? 'translate-x-5' : 'translate-x-0.5'}`} />
          </button>
          <span className="text-xs font-medium text-foreground">Calcular custo médio automaticamente</span>
        </label>

        {/* Flag 2: auto price from catalog */}
        <label className="flex items-center gap-2.5 cursor-pointer select-none">
          <button type="button" data-testid="toggle-auto-price"
            onClick={() => onFlagChange('autoPriceFromCatalog', !autoPriceFromCatalog)}
            className={`w-10 h-5 rounded-full transition-colors relative ${autoPriceFromCatalog ? 'bg-secondary' : 'bg-muted-foreground/30'}`}>
            <span className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${autoPriceFromCatalog ? 'translate-x-5' : 'translate-x-0.5'}`} />
          </button>
          <span className="text-xs font-medium text-foreground">Preço automático dos produtos</span>
          {autoPriceFromCatalog && !priceGroupId && (
            <span className="text-xs text-orange-500">(configure um Grupo de Preço para habilitar)</span>
          )}
        </label>
      </div>

      {/* ── Resumo financeiro do contrato ── */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Resumo Financeiro do Contrato</p>
          {visibleScopes.length > 0 && (
            <button
              type="button"
              data-testid="btn-generate-orders"
              onClick={handleGenerateOrders}
              disabled={generating}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-secondary text-white text-xs font-bold rounded-lg shadow hover:-translate-y-0.5 transition-transform disabled:opacity-50"
            >
              {generating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Package className="w-3.5 h-3.5" />}
              {generating ? 'Gerando...' : 'Gerar Pedidos da Semana'}
            </button>
          )}
        </div>

        {visibleScopes.length === 0 ? (
          <div className="p-4 rounded-xl border border-dashed border-border bg-muted/10 text-center text-sm text-muted-foreground">
            <Package className="w-6 h-6 mx-auto mb-1.5 opacity-30" />
            Adicione itens ao escopo para ver o resumo financeiro.
          </div>
        ) : (
          <>
            {!hasPrices && (
              <div className="flex items-start gap-2 p-2.5 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-700">
                <span className="mt-0.5 shrink-0">💡</span>
                <span>Defina o <strong>Preço unitário</strong> nos itens abaixo para calcular o valor e a margem do contrato.</span>
              </div>
            )}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="rounded-xl border border-green-200 bg-green-50 p-3">
                <p className="text-xs text-muted-foreground font-medium">💰 Valor estimado semanal</p>
                <p className="text-xl font-bold text-green-700 mt-0.5">{fmt(String(valorSemanal))}</p>
                <p className="text-xs text-muted-foreground">soma dos itens do escopo</p>
              </div>
              <div className="rounded-xl border border-blue-200 bg-blue-50 p-3">
                <p className="text-xs text-muted-foreground font-medium">📅 Valor estimado mensal</p>
                <p className="text-xl font-bold text-blue-700 mt-0.5">{fmt(String(valorMensal))}</p>
                <p className="text-xs text-muted-foreground">valor semanal × 4</p>
              </div>
              <div className="rounded-xl border border-orange-200 bg-orange-50 p-3">
                <p className="text-xs text-muted-foreground font-medium">📦 Custo estimado</p>
                {autoCalcCost ? (
                  <>
                    <p className="text-xl font-bold text-orange-700 mt-0.5">{fmt(String(custoEstimado))}</p>
                    <p className="text-xs text-muted-foreground">custo por item do escopo</p>
                  </>
                ) : (
                  <div className="mt-1 space-y-1">
                    <input
                      type="number" min="0" step="0.01"
                      data-testid="input-manual-avg-cost"
                      value={manualAvgCost}
                      onChange={e => onFlagChange('manualAvgCost', e.target.value)}
                      placeholder="Custo médio R$"
                      className="w-full px-2 py-1 rounded-lg border border-orange-300 text-sm font-bold bg-white outline-none focus:border-orange-500"
                    />
                    <p className="text-xs text-muted-foreground">custo médio manual × qtd</p>
                  </div>
                )}
              </div>
              <div className={`rounded-xl border p-3 ${margemEstimada >= 0 ? 'border-purple-200 bg-purple-50' : 'border-red-200 bg-red-50'}`}>
                <p className="text-xs text-muted-foreground font-medium">📊 Margem estimada</p>
                <p className={`text-xl font-bold mt-0.5 ${margemEstimada >= 0 ? 'text-purple-700' : 'text-red-700'}`}>
                  {fmt(String(margemEstimada))}
                </p>
                <p className="text-xs text-muted-foreground">valor − custo estimado</p>
              </div>
            </div>
          </>
        )}
      </div>

      {/* ── Add item form ── */}
      <div className="p-4 bg-muted/20 rounded-xl border border-border space-y-3">
        <p className="text-sm font-bold text-foreground">Adicionar item ao escopo</p>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
          {/* Dia */}
          <select data-testid="select-scope-day" value={newItem.dayOfWeek}
            onChange={e => setNewItem(p => ({ ...p, dayOfWeek: e.target.value }))}
            className={selectCls}>
            <option value="">Dia da semana...</option>
            {WEEK_DAYS.map(d => <option key={d} value={d}>{d}</option>)}
          </select>

          {/* Semana do ciclo */}
          {hasWeekRotation ? (
            <select data-testid="select-scope-week" value={newItem.weekNumber}
              onChange={e => setNewItem(p => ({ ...p, weekNumber: e.target.value }))}
              className={selectCls}>
              <option value="">Semana...</option>
              <option value="1">Semana 1 (Lista A)</option>
              <option value="2">Semana 2 (Lista B)</option>
              {isRotacao4 && <><option value="3">Semana 3 (Lista C)</option><option value="4">Semana 4 (Lista D)</option></>}
            </select>
          ) : <div />}

          {/* Categoria */}
          <select data-testid="select-scope-category" value={newItem.scopeCategory}
            onChange={e => handleNewCategoryChange(e.target.value)}
            className={selectCls}>
            <option value="">Categoria (opcional)</option>
            {catNames.map(c => <option key={c} value={c}>{c}</option>)}
          </select>

          {/* Produto */}
          <select data-testid="select-scope-product" value={newItem.productId}
            onChange={e => handleNewProductChange(e.target.value)}
            className={selectCls}>
            <option value="">Produto{autoPriceFromCatalog && priceGroupId ? ' (preço auto)' : ''}...</option>
            {(newItem.scopeCategory ? newItemProducts : allActiveProducts).map((p: any) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>

          {/* Qtd */}
          <input data-testid="input-scope-quantity" type="number" min="1"
            value={newItem.quantity} onChange={e => setNewItem(p => ({ ...p, quantity: e.target.value }))}
            placeholder="Qtd" className={inputCls} />

          {/* Preço unitário */}
          <input data-testid="input-scope-price" type="number" min="0" step="0.01"
            value={newItem.unitPrice} onChange={e => setNewItem(p => ({ ...p, unitPrice: e.target.value }))}
            placeholder="Preço unit. (R$)" className={inputCls} />

          {/* Custo médio */}
          <input data-testid="input-scope-cost" type="number" min="0" step="0.01"
            value={newItem.averageCost} onChange={e => setNewItem(p => ({ ...p, averageCost: e.target.value }))}
            placeholder="Custo médio (opcional)" className={inputCls} />

          {/* Total preview */}
          <div className="px-2.5 py-1.5 rounded-lg bg-primary/5 border border-primary/20 text-xs text-center flex flex-col justify-center">
            <span className="text-muted-foreground">Total</span>
            <span className="font-bold text-primary">
              {newItem.quantity && newItem.unitPrice
                ? `R$ ${(Number(newItem.quantity) * Number(newItem.unitPrice)).toFixed(2).replace('.', ',')}`
                : '—'}
            </span>
          </div>
        </div>

        <div className="flex justify-end">
          <button data-testid="button-add-scope" onClick={addScope}
            disabled={saving || !newItem.dayOfWeek || !newItem.productId}
            className="px-5 py-2 bg-primary text-white font-bold rounded-xl hover:bg-primary/90 transition-colors disabled:opacity-50 flex items-center gap-2 text-sm">
            <Save className="w-3.5 h-3.5" /> {saving ? 'Adicionando...' : 'Adicionar item'}
          </button>
        </div>
      </div>

      {/* ── Scope table ── */}
      {isLoading ? (
        <p className="text-sm text-muted-foreground py-4 text-center">Carregando escopo...</p>
      ) : visibleScopes.length === 0 ? (
        <div className="py-10 text-center text-muted-foreground border border-dashed border-border rounded-xl">
          <Package className="w-8 h-8 mx-auto mb-2 opacity-30" />
          <p className="text-sm">Nenhum item no escopo. Adicione itens acima.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {groups.map((group) => {
            const groupTotal = group.items.reduce((sum: number, s: any) => {
              return sum + (Number(s.quantity) * (s.unitPrice != null ? Number(s.unitPrice) : 0));
            }, 0);
            return (
              <div key={`${group.day}__${group.weekKey}`} className="border border-border/60 rounded-xl overflow-hidden">
                {/* Day header */}
                <div className="px-4 py-2.5 bg-primary/5 border-b border-border/50 flex items-center gap-2">
                  <CalendarDays className="w-4 h-4 text-primary" />
                  <p className="font-bold text-sm text-foreground">{group.day}</p>
                  {hasWeekRotation && group.weekNum > 0 && (
                    <span className="px-2 py-0.5 bg-secondary/20 text-secondary text-xs font-bold rounded-full">
                      {WEEK_LABELS[group.weekKey] || group.weekKey}
                    </span>
                  )}
                  <span className="ml-auto text-xs text-muted-foreground">
                    {group.items.length} {group.items.length === 1 ? 'item' : 'itens'}
                    {hasPrices && groupTotal > 0 && <span className="ml-2 font-bold text-primary">{fmt(String(groupTotal))}</span>}
                  </span>
                </div>

                {/* Table header */}
                <div className="grid grid-cols-[1fr_1fr_1fr_80px_90px_90px_90px_60px] text-xs font-bold text-muted-foreground bg-muted/20 px-3 py-1.5 border-b border-border/40 gap-2">
                  <span>Categoria</span>
                  <span>Produto</span>
                  <span>Unidade</span>
                  <span className="text-right">Qtd</span>
                  <span className="text-right">Preço unit.</span>
                  <span className="text-right">Custo</span>
                  <span className="text-right">Total</span>
                  <span />
                </div>

                {/* Rows */}
                {group.items.map((s: any) => {
                  const product = allActiveProducts.find((p: any) => p.id === Number(s.productId))
                    || (products || []).find((p: any) => p.id === Number(s.productId));
                  const isEditing = editingId === s.id;
                  const editProducts = editRow.scopeCategory
                    ? getProductsForCategory(editRow.scopeCategory)
                    : allActiveProducts;
                  const rowTotal = Number(s.quantity) * (s.unitPrice != null ? Number(s.unitPrice) : 0);

                  if (isEditing) {
                    return (
                      <div key={s.id} className="grid grid-cols-[1fr_1fr_1fr_80px_90px_90px_90px_60px] items-center px-3 py-2 gap-2 bg-primary/3 border-b border-border/40">
                        {/* Categoria */}
                        <select value={editRow.scopeCategory} onChange={e => {
                          const cat = e.target.value;
                          const fp = getProductsForCategory(cat);
                          const ok = fp.some((p: any) => String(p.id) === editRow.productId);
                          setEditRow((r: any) => ({ ...r, scopeCategory: cat, productId: ok ? r.productId : "" }));
                        }} className={selectCls}>
                          <option value="">Sem categoria</option>
                          {catNames.map(c => <option key={c} value={c}>{c}</option>)}
                        </select>
                        {/* Produto */}
                        <select value={editRow.productId} onChange={e => setEditRow((r: any) => ({ ...r, productId: e.target.value }))} className={selectCls}>
                          <option value="">Produto...</option>
                          {editProducts.map((p: any) => <option key={p.id} value={p.id}>{p.name}</option>)}
                        </select>
                        {/* Unidade */}
                        <span className="text-xs text-muted-foreground">{(editProducts.find((p: any) => String(p.id) === editRow.productId) as any)?.unit || '—'}</span>
                        {/* Qtd */}
                        <input type="number" min="1" value={editRow.quantity}
                          data-testid={`scope-item-qty-${s.id}`}
                          onChange={e => setEditRow((r: any) => ({ ...r, quantity: e.target.value }))}
                          className={inputCls + " text-right"} />
                        {/* Preço */}
                        <input type="number" min="0" step="0.01" value={editRow.unitPrice}
                          data-testid={`scope-item-price-${s.id}`}
                          onChange={e => setEditRow((r: any) => ({ ...r, unitPrice: e.target.value }))}
                          placeholder="R$" className={inputCls + " text-right"} />
                        {/* Custo */}
                        <input type="number" min="0" step="0.01" value={editRow.averageCost}
                          data-testid={`scope-item-cost-${s.id}`}
                          onChange={e => setEditRow((r: any) => ({ ...r, averageCost: e.target.value }))}
                          placeholder="R$" className={inputCls + " text-right"} />
                        {/* Total preview */}
                        <span className="text-right text-xs font-bold text-primary">
                          {editRow.quantity && editRow.unitPrice
                            ? `R$ ${(Number(editRow.quantity) * Number(editRow.unitPrice)).toFixed(2).replace('.', ',')}`
                            : '—'}
                        </span>
                        {/* Actions */}
                        <div className="flex gap-1">
                          <button data-testid={`scope-item-save-${s.id}`} onClick={() => saveEdit(s.id)} disabled={editSaving}
                            title="Salvar item"
                            className="p-1.5 rounded-lg bg-primary text-white hover:bg-primary/90 transition-colors disabled:opacity-50">
                            {editSaving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
                          </button>
                          <button data-testid={`scope-item-cancel-${s.id}`} onClick={() => setEditingId(null)}
                            title="Cancelar edição"
                            className="p-1.5 rounded-lg text-muted-foreground hover:bg-muted transition-colors">
                            <X className="w-3 h-3" />
                          </button>
                        </div>
                      </div>
                    );
                  }

                  return (
                    <div key={s.id} className="grid grid-cols-[1fr_1fr_1fr_80px_90px_90px_90px_60px] items-center px-3 py-2.5 gap-2 hover:bg-muted/20 transition-colors border-b border-border/30 last:border-0 group">
                      {/* Categoria */}
                      <span>
                        {s.scopeCategory
                          ? <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${catColor(s.scopeCategory, catNames)}`}>{s.scopeCategory}</span>
                          : <span className="text-xs text-muted-foreground italic">—</span>}
                      </span>
                      {/* Produto */}
                      <p className="text-sm font-medium text-foreground truncate">{product?.name || `Produto #${s.productId}`}</p>
                      {/* Unidade */}
                      <p className="text-xs text-muted-foreground">{product?.unit || '—'}</p>
                      {/* Qtd */}
                      <p className="text-sm font-bold text-right">{s.quantity}</p>
                      {/* Preço */}
                      <p className="text-sm text-right text-foreground">{s.unitPrice != null ? fmt(s.unitPrice) : <span className="text-muted-foreground">—</span>}</p>
                      {/* Custo */}
                      <p className="text-sm text-right text-muted-foreground">{s.averageCost != null ? fmt(s.averageCost) : '—'}</p>
                      {/* Total */}
                      <p className="text-sm font-bold text-right text-primary">
                        {s.unitPrice != null ? fmt(String(rowTotal)) : '—'}
                      </p>
                      {/* Actions */}
                      <div className="flex gap-1 justify-end">
                        <button type="button" title="Editar item"
                          data-testid={`scope-item-edit-${s.id}`}
                          onClick={() => startEdit(s)}
                          className="p-1.5 rounded-lg text-primary/70 hover:text-primary hover:bg-primary/10 transition-colors">
                          <Edit2 className="w-3.5 h-3.5" />
                        </button>
                        <button type="button" title="Remover item"
                          data-testid={`button-remove-scope-${s.id}`}
                          onClick={() => onDelete(s.id)}
                          className="p-1.5 rounded-lg text-muted-foreground hover:text-red-500 hover:bg-red-50 transition-colors">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default function CompaniesPage() {
  const { data: companies, isLoading } = useCompanies();
  const { data: priceGroups } = usePriceGroups();
  const createCompany = useCreateCompany();
  const updateCompany = useUpdateCompany();

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingCompany, setEditingCompany] = useState<Company | null>(null);
  const [activeTab, setActiveTab] = useState<TabKey>("basico");
  const [formData, setFormData] = useState(emptyForm);
  const [geocoding, setGeocoding] = useState(false);
  const [lookingUpCep, setLookingUpCep] = useState(false);
  const [cepFilled, setCepFilled] = useState(false);
  const [viaCepUF, setViaCepUF] = useState("");
  const [pendingDeletes, setPendingDeletes] = useState<number[]>([]);
  const { toast } = useToast();

  const openCreate = () => {
    setEditingCompany(null);
    setFormData(emptyForm);
    setActiveTab("basico");
    setCepFilled(false);
    setViaCepUF("");
    setPendingDeletes([]);
    setIsModalOpen(true);
  };

  const openEdit = (company: Company) => {
    setEditingCompany(company);
    setFormData(companyToForm(company));
    setActiveTab("basico");
    setCepFilled(false);
    setViaCepUF("");
    setPendingDeletes([]);
    setIsModalOpen(true);
  };

  const closeModal = () => {
    setIsModalOpen(false);
    setEditingCompany(null);
    setPendingDeletes([]);
  };

  const toggleDay = (day: string) => {
    setFormData(prev => ({
      ...prev,
      allowedOrderDays: prev.allowedOrderDays.includes(day)
        ? prev.allowedOrderDays.filter(d => d !== day)
        : [...prev.allowedOrderDays, day]
    }));
  };

  const set = (field: string, value: any) =>
    setFormData(prev => ({ ...prev, [field]: value }));

  const buscarCep = async (cepValue: string) => {
    const digits = cepValue.replace(/\D/g, "");
    if (digits.length !== 8) return;
    setLookingUpCep(true);
    try {
      const res = await fetch(`https://viacep.com.br/ws/${digits}/json/`);
      const data = await res.json();
      if (data.erro) {
        toast({ title: "CEP não encontrado", description: "Verifique o número do CEP e tente novamente.", variant: "destructive" });
        setCepFilled(false);
        setViaCepUF("");
        return;
      }
      setFormData(prev => ({
        ...prev,
        addressStreet: data.logradouro || prev.addressStreet,
        addressNeighborhood: data.bairro || prev.addressNeighborhood,
        addressCity: data.localidade || prev.addressCity,
      }));
      setViaCepUF(data.uf || "");
      setCepFilled(true);
      toast({ title: "Endereço preenchido!", description: `${data.logradouro}, ${data.localidade} - ${data.uf}` });
    } catch {
      toast({ title: "Erro ao consultar CEP", description: "Verifique sua conexão e tente novamente.", variant: "destructive" });
    } finally {
      setLookingUpCep(false);
    }
  };

  const buscarCoordenadas = async () => {
    const rua = formData.addressStreet;
    const numero = formData.addressNumber;
    const cidade = formData.addressCity;
    const uf = viaCepUF;

    if (!rua || !cidade) {
      toast({ title: "Endereço incompleto", description: "Preencha o CEP primeiro para buscar as coordenadas.", variant: "destructive" });
      return;
    }

    const partes = [rua, numero, cidade, uf, "Brasil"].filter(Boolean);
    const enderecoCompleto = partes.join(", ");
    setGeocoding(true);
    try {
      const res = await fetch(`/api/geocode?q=${encodeURIComponent(enderecoCompleto)}`, { credentials: "include" });
      const data = await res.json();
      if (Array.isArray(data) && data.length > 0) {
        const { lat, lon } = data[0];
        setFormData(prev => ({ ...prev, latitude: parseFloat(lat).toFixed(7), longitude: parseFloat(lon).toFixed(7) }));
        toast({ title: "Coordenadas encontradas!", description: `Lat: ${parseFloat(lat).toFixed(5)}, Lon: ${parseFloat(lon).toFixed(5)}` });
      } else {
        toast({
          title: "Coordenadas não localizadas",
          description: "Não foi possível localizar as coordenadas automaticamente. Verifique o número ou ajuste o CEP.",
          variant: "destructive",
        });
      }
    } catch {
      toast({ title: "Erro ao buscar coordenadas", description: "Verifique sua conexão e tente novamente.", variant: "destructive" });
    } finally {
      setGeocoding(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const payload: any = {
      companyName: formData.companyName,
      contactName: formData.contactName,
      email: formData.email,
      priceGroupId: formData.priceGroupId ? Number(formData.priceGroupId) : null,
      allowedOrderDays: formData.allowedOrderDays,
      active: formData.active,
      phone: formData.phone || null,
      cnpj: formData.cnpj || null,
      addressStreet: formData.addressStreet || null,
      addressNumber: formData.addressNumber || null,
      addressNeighborhood: formData.addressNeighborhood || null,
      addressCity: formData.addressCity || null,
      addressZip: formData.addressZip || null,
      latitude: formData.latitude ? formData.latitude : null,
      longitude: formData.longitude ? formData.longitude : null,
      clientType: formData.clientType || null,
      contractModel: formData.contractModel || null,
      minWeeklyBilling: formData.minWeeklyBilling ? String(formData.minWeeklyBilling) : null,
      deliveryTime: formData.deliveryTime || null,
      adminFee: formData.adminFee ? String(formData.adminFee) : "0",
      billingTerm: formData.billingTerm || null,
      billingType: formData.billingType || null,
      billingFormat: formData.billingFormat || null,
      paymentDates: formData.paymentDates || null,
      financialNotes: formData.financialNotes || null,
      notificationEmail: formData.notificationEmail || null,
      deliveryConfigJson: formData.deliveryConfigJson ? JSON.stringify(formData.deliveryConfigJson) : null,
      autoCalcCost: formData.autoCalcCost,
      autoPriceFromCatalog: formData.autoPriceFromCatalog,
      manualAvgCost: formData.manualAvgCost ? String(formData.manualAvgCost) : null,
    };

    if (editingCompany) {
      if (formData.password) payload.password = formData.password;
      await updateCompany.mutateAsync({ id: editingCompany.id, data: payload });
      // Flush staged scope deletions
      if (pendingDeletes.length > 0) {
        await Promise.all(pendingDeletes.map(id =>
          fetch(`/api/companies/${editingCompany.id}/contract-scopes/${id}`, { method: 'DELETE', credentials: 'include' })
        ));
      }
    } else {
      payload.password = formData.password;
      await createCompany.mutateAsync(payload);
    }
    closeModal();
  };

  const getDays = (c: Company): string[] => {
    if (!c.allowedOrderDays) return [];
    if (Array.isArray(c.allowedOrderDays)) return (c.allowedOrderDays as any[]).map(String);
    return [];
  };

  const isPending = createCompany.isPending || updateCompany.isPending;

  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState("ALL");
  const [filterType, setFilterType] = useState("ALL");

  const filtered = useMemo(() => {
    return (companies || []).filter(c => {
      const q = search.toLowerCase();
      const matchSearch = !q ||
        c.companyName.toLowerCase().includes(q) ||
        c.email.toLowerCase().includes(q) ||
        c.contactName.toLowerCase().includes(q);
      const matchStatus = filterStatus === 'ALL' ||
        (filterStatus === 'ACTIVE' && c.active) ||
        (filterStatus === 'INACTIVE' && !c.active);
      const matchType = filterType === 'ALL' || c.clientType === filterType;
      return matchSearch && matchStatus && matchType;
    });
  }, [companies, search, filterStatus, filterType]);

  return (
    <Layout>
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-8 gap-4">
        <div>
          <h1 className="text-3xl font-display font-bold text-foreground">Empresas</h1>
          <p className="text-muted-foreground mt-1">Cadastro completo de clientes corporativos.</p>
        </div>
        <button
          data-testid="button-add-company"
          onClick={openCreate}
          className="flex items-center gap-2 px-6 py-3 bg-primary text-primary-foreground font-bold rounded-xl shadow-lg shadow-primary/25 hover:shadow-xl hover:-translate-y-0.5 transition-all"
        >
          <Plus className="w-5 h-5" /> Nova Empresa
        </button>
      </div>

      {/* Company cards/table */}
      <div className="bg-card rounded-2xl border border-border/50 premium-shadow overflow-hidden">
        {/* Search + Filter Toolbar */}
        <div className="p-4 border-b border-border/50 bg-muted/20 flex flex-wrap gap-3 items-center">
          <div className="relative flex-1 min-w-[200px] max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <input
              data-testid="input-search-companies"
              value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Pesquisar empresa, email ou contato..."
              className="w-full pl-9 pr-4 py-2.5 rounded-xl border-2 border-border focus:border-primary outline-none text-sm"
            />
            {search && <button onClick={() => setSearch("")} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"><X className="w-3.5 h-3.5" /></button>}
          </div>
          <div className="flex gap-2">
            {(['ALL', 'ACTIVE', 'INACTIVE'] as const).map(s => (
              <button key={s} onClick={() => setFilterStatus(s)}
                className={`px-3 py-2 rounded-xl text-xs font-bold border-2 transition-all ${filterStatus === s ? 'bg-primary text-white border-primary' : 'border-border text-muted-foreground hover:border-primary/50'}`}>
                {s === 'ALL' ? 'Todos' : s === 'ACTIVE' ? 'Ativas' : 'Inativas'}
              </button>
            ))}
          </div>
          <div className="flex gap-2">
            {(['ALL', 'semanal', 'mensal', 'pontual'] as const).map(t => (
              <button key={t} onClick={() => setFilterType(t)}
                className={`px-3 py-2 rounded-xl text-xs font-bold border-2 transition-all ${filterType === t ? 'bg-secondary text-white border-secondary' : 'border-border text-muted-foreground hover:border-secondary/50'}`}>
                {t === 'ALL' ? 'Tipo: Todos' : t.charAt(0).toUpperCase() + t.slice(1)}
              </button>
            ))}
          </div>
          {(search || filterStatus !== 'ALL' || filterType !== 'ALL') && (
            <button onClick={() => { setSearch(""); setFilterStatus("ALL"); setFilterType("ALL"); }} className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground font-medium">
              <X className="w-3 h-3" /> Limpar
            </button>
          )}
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="bg-muted/30 border-b border-border/50 text-muted-foreground text-xs uppercase tracking-wider">
                <th className="px-6 py-4 font-semibold">Empresa</th>
                <th className="px-6 py-4 font-semibold">Contato</th>
                <th className="px-6 py-4 font-semibold">Grupo de Preço</th>
                <th className="px-6 py-4 font-semibold">Horário</th>
                <th className="px-6 py-4 font-semibold">Tipo</th>
                <th className="px-6 py-4 font-semibold">Faturamento</th>
                <th className="px-6 py-4 font-semibold">Status</th>
                <th className="px-6 py-4 font-semibold"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/50">
              {isLoading ? (
                <tr><td colSpan={8} className="px-6 py-8 text-center text-muted-foreground">Carregando...</td></tr>
              ) : filtered?.length === 0 ? (
                <tr><td colSpan={8} className="px-6 py-8 text-center text-muted-foreground">Nenhuma empresa encontrada.</td></tr>
              ) : (
                filtered?.map(company => (
                  <tr key={company.id} className="hover:bg-muted/10 transition-colors">
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-lg bg-primary/10 text-primary flex items-center justify-center flex-shrink-0">
                          <Building2 className="w-5 h-5" />
                        </div>
                        <div>
                          <p className="font-bold text-foreground">{company.companyName}</p>
                          <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
                            <Mail className="w-3 h-3" /> {company.email}
                          </p>
                          {company.phone && (
                            <p className="text-xs text-muted-foreground flex items-center gap-1">
                              <Phone className="w-3 h-3" /> {company.phone}
                            </p>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4 font-medium text-foreground">{company.contactName}</td>
                    <td className="px-6 py-4">
                      {company.priceGroupId ? (
                        <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full bg-secondary/10 text-secondary text-xs font-bold">
                          <Hash className="w-3 h-3" />
                          {priceGroups?.find(pg => pg.id === company.priceGroupId)?.groupName || 'Nenhum'}
                        </span>
                      ) : (
                        <span className="text-muted-foreground text-sm">—</span>
                      )}
                    </td>
                    <td className="px-6 py-4">
                      {(() => {
                        try {
                          const cfg = typeof (company as any).deliveryConfigJson === 'string'
                            ? JSON.parse((company as any).deliveryConfigJson)
                            : (company as any).deliveryConfigJson;
                          if (!cfg) return <span className="text-muted-foreground text-sm">—</span>;
                          const enabled = Object.values(cfg as Record<string, any>).filter((d: any) => d.enabled);
                          if (enabled.length === 0) return <span className="text-muted-foreground text-sm">—</span>;
                          const starts = enabled.map((d: any) => d.startTime).filter(Boolean).sort();
                          const ends = enabled.map((d: any) => d.endTime).filter(Boolean).sort();
                          const minStart = starts[0];
                          const maxEnd = ends[ends.length - 1];
                          if (!minStart || !maxEnd) return <span className="text-muted-foreground text-sm">—</span>;
                          return (
                            <span className="flex items-center gap-1 text-sm font-bold text-foreground">
                              <Clock className="w-4 h-4 text-primary" /> {minStart} – {maxEnd}
                            </span>
                          );
                        } catch {
                          return <span className="text-muted-foreground text-sm">—</span>;
                        }
                      })()}
                    </td>
                    <td className="px-6 py-4">
                      <span className={`px-2 py-0.5 rounded-lg text-xs font-bold ${
                        company.clientType === 'pontual' ? 'bg-orange-100 text-orange-700' :
                        company.clientType === 'semanal' ? 'bg-green-100 text-green-700' :
                        company.clientType === 'contratual' ? 'bg-purple-100 text-purple-700' :
                        'bg-blue-100 text-blue-700'
                      }`}>
                        {company.clientType === 'pontual' ? 'Pontual' :
                         company.clientType === 'semanal' ? 'Semanal' :
                         company.clientType === 'contratual' ? 'Contratual' :
                         'Mensal'}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      {company.billingType ? (
                        <div className="text-sm">
                          <p className="font-semibold text-foreground">{getBillingLabel(company.billingType)}</p>
                          <p className="text-muted-foreground text-xs">{getBillingFormatLabel(company.billingFormat)}</p>
                        </div>
                      ) : (
                        <span className="text-muted-foreground text-sm">—</span>
                      )}
                    </td>
                    <td className="px-6 py-4">
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold ${company.active ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                        {company.active ? <><CheckCircle className="w-3 h-3" /> Ativo</> : <><XCircle className="w-3 h-3" /> Inativo</>}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      <button
                        data-testid={`button-edit-${company.id}`}
                        onClick={() => openEdit(company)}
                        className="p-2 rounded-lg text-muted-foreground hover:bg-primary/10 hover:text-primary transition-colors"
                      >
                        <Edit2 className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Create / Edit Modal */}
      <Modal
        isOpen={isModalOpen}
        onClose={closeModal}
        title={editingCompany ? `Editar: ${editingCompany.companyName}` : "Nova Empresa"}
        maxWidth="max-w-3xl"
      >
        <form onSubmit={handleSubmit}>
          {/* Tab Nav */}
          <div className="flex border-b border-border/50 mb-6 -mx-0">
            {TABS.map(tab => {
              const Icon = tab.icon;
              const isContratualLocked = tab.key === 'contrato' && formData.clientType !== 'contratual';
              return (
                <button
                  key={tab.key}
                  type="button"
                  onClick={() => !isContratualLocked && setActiveTab(tab.key)}
                  title={isContratualLocked ? 'Disponível apenas para clientes do tipo Contratual' : tab.label}
                  className={`flex items-center gap-1.5 px-4 py-3 text-sm font-bold border-b-2 transition-all ${
                    isContratualLocked
                      ? 'border-transparent text-muted-foreground/30 cursor-not-allowed bg-muted/20'
                      : activeTab === tab.key
                        ? 'border-primary text-primary'
                        : 'border-transparent text-muted-foreground hover:text-foreground'
                  }`}
                >
                  <Icon className="w-4 h-4" />
                  {tab.label}
                  {isContratualLocked && (
                    <span className="inline-flex items-center gap-0.5 bg-muted text-muted-foreground/60 text-[10px] font-medium px-1.5 py-0.5 rounded-full ml-1">
                      <Lock className="w-2.5 h-2.5" />
                      Contratual
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          {/* ─── Tab: Dados Básicos ─── */}
          {activeTab === "basico" && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-semibold mb-1">Nome da Empresa *</label>
                  <input required value={formData.companyName} onChange={e => set("companyName", e.target.value)}
                    data-testid="input-company-name"
                    className="w-full px-4 py-2.5 rounded-xl border-2 border-border focus:border-primary outline-none" />
                </div>
                <div>
                  <label className="block text-sm font-semibold mb-1">Contato Responsável *</label>
                  <input required value={formData.contactName} onChange={e => set("contactName", e.target.value)}
                    data-testid="input-company-contact"
                    className="w-full px-4 py-2.5 rounded-xl border-2 border-border focus:border-primary outline-none" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-semibold mb-1">LOGIN (e-mail de acesso) *</label>
                  <input required type="email" value={formData.email} onChange={e => set("email", e.target.value)}
                    data-testid="input-company-email"
                    className="w-full px-4 py-2.5 rounded-xl border-2 border-border focus:border-primary outline-none" />
                </div>
                <div>
                  <label className="block text-sm font-semibold mb-1">Telefone</label>
                  <input type="tel" value={formData.phone} onChange={e => set("phone", e.target.value)}
                    placeholder="(11) 99999-9999"
                    className="w-full px-4 py-2.5 rounded-xl border-2 border-border focus:border-primary outline-none" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-semibold mb-1">E-mail de Notificações</label>
                  <input type="email" value={formData.notificationEmail} onChange={e => set("notificationEmail", e.target.value)}
                    placeholder="notificacoes@empresa.com.br (opcional)"
                    data-testid="input-company-notification-email"
                    className="w-full px-4 py-2.5 rounded-xl border-2 border-border focus:border-primary outline-none" />
                  <p className="text-xs text-muted-foreground mt-1">E-mail alternativo para receber notificações de pedidos.</p>
                </div>
                <div />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-semibold mb-1">CNPJ</label>
                  <input value={formData.cnpj} onChange={e => set("cnpj", e.target.value)}
                    placeholder="00.000.000/0000-00"
                    className="w-full px-4 py-2.5 rounded-xl border-2 border-border focus:border-primary outline-none" />
                </div>
                <div>
                  <label className="block text-sm font-semibold mb-1">
                    {editingCompany ? "Nova Senha (deixe em branco para manter)" : "Senha *"}
                  </label>
                  <input type="password" value={formData.password} onChange={e => set("password", e.target.value)}
                    required={!editingCompany}
                    data-testid="input-company-password"
                    className="w-full px-4 py-2.5 rounded-xl border-2 border-border focus:border-primary outline-none" />
                </div>
                <div>
                  <label className="block text-sm font-semibold mb-1">Grupo de Preço</label>
                  <select value={formData.priceGroupId} onChange={e => set("priceGroupId", e.target.value)}
                    className="w-full px-4 py-2.5 rounded-xl border-2 border-border focus:border-primary outline-none">
                    <option value="">Selecionar grupo</option>
                    {priceGroups?.map(pg => <option key={pg.id} value={pg.id}>{pg.groupName}</option>)}
                  </select>
                </div>
              </div>

              {/* Endereço */}
              <div className="p-4 rounded-xl border-2 border-border bg-muted/10">
                <div className="flex items-center justify-between mb-3">
                  <p className="text-sm font-semibold text-foreground">Endereço de Entrega</p>
                  {cepFilled && (
                    <button type="button" onClick={() => { setCepFilled(false); setViaCepUF(""); }}
                      className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors">
                      <Lock className="w-3 h-3" /> Editar manualmente
                    </button>
                  )}
                </div>

                {/* ETAPA 1: CEP com consulta automática */}
                <div className="grid grid-cols-3 gap-3 mb-3">
                  <div>
                    <label className="block text-xs font-semibold mb-1 text-muted-foreground">
                      CEP {lookingUpCep && <span className="text-primary font-normal ml-1">consultando...</span>}
                    </label>
                    <div className="relative">
                      <input
                        data-testid="input-cep"
                        value={formData.addressZip}
                        onChange={e => {
                          const v = e.target.value;
                          set("addressZip", v);
                          const digits = v.replace(/\D/g, "");
                          if (digits.length === 8) buscarCep(v);
                          else if (digits.length < 8) { setCepFilled(false); setViaCepUF(""); }
                        }}
                        placeholder="00000-000"
                        maxLength={9}
                        className="w-full px-3 py-2 rounded-xl border-2 border-border focus:border-primary outline-none text-sm pr-8" />
                      {lookingUpCep && <Loader2 className="w-3.5 h-3.5 animate-spin text-primary absolute right-2.5 top-1/2 -translate-y-1/2" />}
                      {cepFilled && !lookingUpCep && <CheckCircle2 className="w-3.5 h-3.5 text-green-500 absolute right-2.5 top-1/2 -translate-y-1/2" />}
                    </div>
                  </div>
                  <div className="col-span-2">
                    <label className="block text-xs font-semibold mb-1 text-muted-foreground">
                      Rua / Logradouro {cepFilled && <Lock className="w-3 h-3 inline ml-1 text-muted-foreground/60" />}
                    </label>
                    <input
                      data-testid="input-address-street"
                      value={formData.addressStreet}
                      onChange={e => set("addressStreet", e.target.value)}
                      readOnly={cepFilled}
                      placeholder="Rua das Flores"
                      className={`w-full px-3 py-2 rounded-xl border-2 outline-none text-sm transition-colors ${cepFilled ? "border-border bg-muted/40 text-muted-foreground cursor-not-allowed" : "border-border focus:border-primary"}`} />
                  </div>
                </div>

                {/* ETAPA 2: Número + campos bloqueados */}
                <div className="grid grid-cols-3 gap-3 mb-3">
                  <div>
                    <label className="block text-xs font-semibold mb-1 text-muted-foreground">Número</label>
                    <input
                      data-testid="input-address-number"
                      value={formData.addressNumber}
                      onChange={e => set("addressNumber", e.target.value)}
                      placeholder="417"
                      className="w-full px-3 py-2 rounded-xl border-2 border-border focus:border-primary outline-none text-sm" />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold mb-1 text-muted-foreground">
                      Bairro {cepFilled && <Lock className="w-3 h-3 inline ml-1 text-muted-foreground/60" />}
                    </label>
                    <input
                      data-testid="input-address-neighborhood"
                      value={formData.addressNeighborhood}
                      onChange={e => set("addressNeighborhood", e.target.value)}
                      readOnly={cepFilled}
                      placeholder="Centro"
                      className={`w-full px-3 py-2 rounded-xl border-2 outline-none text-sm transition-colors ${cepFilled ? "border-border bg-muted/40 text-muted-foreground cursor-not-allowed" : "border-border focus:border-primary"}`} />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold mb-1 text-muted-foreground">
                      Cidade {cepFilled && <Lock className="w-3 h-3 inline ml-1 text-muted-foreground/60" />}
                    </label>
                    <input
                      data-testid="input-address-city"
                      value={formData.addressCity}
                      onChange={e => set("addressCity", e.target.value)}
                      readOnly={cepFilled}
                      placeholder="São Paulo"
                      className={`w-full px-3 py-2 rounded-xl border-2 outline-none text-sm transition-colors ${cepFilled ? "border-border bg-muted/40 text-muted-foreground cursor-not-allowed" : "border-border focus:border-primary"}`} />
                  </div>
                </div>

                {/* Estado (só mostra quando preenchido pelo ViaCEP) */}
                {cepFilled && viaCepUF && (
                  <div className="mb-3">
                    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-primary/10 text-primary text-xs font-bold border border-primary/20">
                      <MapPin className="w-3 h-3" /> Estado: {viaCepUF}
                    </span>
                  </div>
                )}

                {/* CEP hint */}
                {!cepFilled && (
                  <p className="text-xs text-muted-foreground mb-3 flex items-center gap-1">
                    <span className="text-primary font-bold">Dica:</span> Digite o CEP para preencher rua, bairro e cidade automaticamente.
                  </p>
                )}

                {/* ETAPA 3: Coordenadas GPS */}
                <div className="border-t border-border/50 pt-3">
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Coordenadas GPS</p>
                    <button type="button" data-testid="button-buscar-coordenadas" onClick={buscarCoordenadas}
                      disabled={geocoding || !formData.addressStreet || !formData.addressCity}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold bg-primary/10 text-primary hover:bg-primary/20 border border-primary/30 transition-all disabled:opacity-50 disabled:cursor-not-allowed">
                      {geocoding ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <MapPin className="w-3.5 h-3.5" />}
                      {geocoding ? "Buscando..." : "Gerar Coordenadas"}
                    </button>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-semibold mb-1 text-muted-foreground">Latitude</label>
                      <input type="number" step="0.0000001" value={formData.latitude} onChange={e => set("latitude", e.target.value)}
                        placeholder="-23.5505"
                        className="w-full px-3 py-2 rounded-xl border-2 border-border focus:border-primary outline-none text-sm" />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold mb-1 text-muted-foreground">Longitude</label>
                      <input type="number" step="0.0000001" value={formData.longitude} onChange={e => set("longitude", e.target.value)}
                        placeholder="-46.6333"
                        className="w-full px-3 py-2 rounded-xl border-2 border-border focus:border-primary outline-none text-sm" />
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1.5">
                    {cepFilled && formData.addressNumber
                      ? `Endereço: ${formData.addressStreet}, ${formData.addressNumber} — ${formData.addressCity}/${viaCepUF}`
                      : "Preencha o CEP e o número para gerar as coordenadas automaticamente."}
                  </p>
                </div>
              </div>

              <div>
                <label className="block text-sm font-semibold mb-2">Dias de Entrega Permitidos</label>
                <div className="flex flex-wrap gap-2">
                  {DAYS_OPTIONS.map(day => (
                    <button key={day} type="button" onClick={() => toggleDay(day)}
                      className={`px-4 py-2 rounded-xl text-sm font-bold border-2 transition-all ${
                        formData.allowedOrderDays.includes(day)
                          ? 'bg-primary text-white border-primary'
                          : 'border-border text-muted-foreground hover:border-primary/50'
                      }`}>
                      {day}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* ─── Tab: Configurações ─── */}
          {activeTab === "config" && (
            <div className="space-y-5">
              {/* Status */}
              <div className="p-4 rounded-xl border-2 border-border bg-muted/20">
                <p className="text-sm font-semibold mb-3 text-foreground">Status da Empresa</p>
                <div className="flex gap-3">
                  <button type="button" onClick={() => set("active", true)}
                    className={`flex items-center gap-2 px-5 py-2.5 rounded-xl font-bold text-sm border-2 transition-all ${formData.active ? 'bg-green-600 text-white border-green-600' : 'border-border text-muted-foreground hover:border-green-400'}`}>
                    <CheckCircle className="w-4 h-4" /> Ativa
                  </button>
                  <button type="button" onClick={() => set("active", false)}
                    className={`flex items-center gap-2 px-5 py-2.5 rounded-xl font-bold text-sm border-2 transition-all ${!formData.active ? 'bg-red-600 text-white border-red-600' : 'border-border text-muted-foreground hover:border-red-400'}`}>
                    <XCircle className="w-4 h-4" /> Inativa
                  </button>
                </div>
              </div>

              {/* Tipo de cliente */}
              <div className="p-4 rounded-xl border-2 border-border bg-muted/20">
                <p className="text-sm font-semibold mb-1 text-foreground">Tipo de Empresa</p>
                <p className="text-xs text-muted-foreground mb-3">Define o perfil e frequência de pedidos do cliente.</p>
                <div className="flex gap-3 flex-wrap">
                  {[
                    { value: "semanal", label: "Cliente Semanal", desc: "Pedidos manuais toda semana" },
                    { value: "mensal", label: "Mensal", desc: "Programação mensal de pedidos" },
                    { value: "pontual", label: "Pontual", desc: "Esporádico, sem notificações" },
                    { value: "contratual", label: "Cliente Contratual", desc: "Escopo fixo definido em contrato" },
                  ].map(opt => (
                    <button key={opt.value} type="button"
                      data-testid={`button-clienttype-${opt.value}`}
                      onClick={() => {
                        set("clientType", opt.value);
                        if (opt.value !== 'contratual') {
                          set("contractModel", "");
                          if ((activeTab as string) === 'contrato') setActiveTab('config');
                        }
                      }}
                      className={`flex-1 min-w-[100px] px-4 py-3 rounded-xl font-bold text-sm border-2 transition-all text-left ${formData.clientType === opt.value ? 'bg-primary text-white border-primary' : 'border-border text-muted-foreground hover:border-primary/50'}`}>
                      <p>{opt.label}</p>
                      <p className={`text-xs font-normal mt-0.5 ${formData.clientType === opt.value ? 'text-white/80' : 'text-muted-foreground'}`}>{opt.desc}</p>
                    </button>
                  ))}
                </div>
                {/* Modelo de contrato — only for "contratual" */}
                {formData.clientType === 'contratual' && (
                  <div className="mt-4 pt-4 border-t border-border/50">
                    <p className="text-sm font-semibold mb-1 text-foreground">Modelo de Contrato</p>
                    <p className="text-xs text-muted-foreground mb-3">Define como o escopo de produtos é gerenciado.</p>
                    <div className="flex gap-3 flex-wrap">
                      {[
                        { value: "fixo", label: "Contrato Fixo", desc: "Escopo fixo, pedidos automáticos" },
                        { value: "variavel", label: "Contrato Variável", desc: "Escopo base com ajustes permitidos" },
                        { value: "alternado", label: "Contrato Alternado", desc: "Rotação quinzenal (Lista A / Lista B)" },
                        { value: "rotacao4", label: "Rotação 4 Semanas", desc: "Ciclo mensal (Listas A-D)" },
                      ].map(opt => (
                        <button key={opt.value} type="button" data-testid={`button-contractmodel-${opt.value}`} onClick={() => set("contractModel", opt.value)}
                          className={`flex-1 min-w-[120px] px-4 py-3 rounded-xl font-bold text-sm border-2 transition-all text-left ${formData.contractModel === opt.value ? 'bg-secondary text-secondary-foreground border-secondary' : 'border-border text-muted-foreground hover:border-secondary/50'}`}>
                          <p>{opt.label}</p>
                          <p className={`text-xs font-normal mt-0.5 ${formData.contractModel === opt.value ? 'text-secondary-foreground/80' : 'text-muted-foreground'}`}>{opt.desc}</p>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-semibold mb-1">
                    <span className="flex items-center gap-1"><DollarSign className="w-4 h-4 text-primary" /> Faturamento Mínimo Semanal (R$)</span>
                  </label>
                  <input type="number" step="0.01" min="0" value={formData.minWeeklyBilling}
                    onChange={e => set("minWeeklyBilling", e.target.value)}
                    placeholder="0,00"
                    className="w-full px-4 py-2.5 rounded-xl border-2 border-border focus:border-primary outline-none" />
                  <p className="text-xs text-muted-foreground mt-1">Mínimo esperado por semana. Pode ter exceções por cliente.</p>
                </div>
                <div>
                  <label className="block text-sm font-semibold mb-1">
                    <span className="flex items-center gap-1"><Clock className="w-4 h-4 text-primary" /> Janela de Entrega</span>
                  </label>
                  {(() => {
                    const cfg = formData.deliveryConfigJson || DEFAULT_DELIVERY_CONFIG;
                    const enabled = Object.entries(cfg).filter(([, v]) => v.enabled);
                    if (enabled.length === 0) {
                      return <p className="text-xs text-muted-foreground py-2">Configure os dias de entrega na aba <strong>Configuração de Entrega</strong> para ver as janelas aqui.</p>;
                    }
                    return (
                      <div className="space-y-1.5">
                        {enabled.map(([day, v]) => (
                          <div key={day} className="flex items-center gap-3 px-3 py-2 bg-primary/5 border border-primary/20 rounded-xl">
                            <Clock className="w-3.5 h-3.5 text-primary flex-shrink-0" />
                            <span className="text-sm font-semibold text-foreground">{day}</span>
                            <span className="text-sm text-muted-foreground ml-auto">{v.startTime} – {v.endTime}</span>
                          </div>
                        ))}
                      </div>
                    );
                  })()}
                  <p className="text-xs text-muted-foreground mt-1">Janelas configuradas na aba Configuração de Entrega.</p>
                </div>
              </div>

              {/* Taxa administrativa */}
              <div className="p-4 rounded-xl border-2 border-secondary/30 bg-secondary/5">
                <label className="flex items-center gap-2 text-sm font-bold text-secondary mb-3">
                  <Percent className="w-4 h-4" />
                  Taxa Administrativa (%)
                </label>
                {/* Quick-select by operator */}
                <div className="flex gap-2 mb-3 flex-wrap">
                  <span className="text-xs text-muted-foreground self-center font-medium">Seleção rápida:</span>
                  {[{ label: "GRSA", value: "27" }, { label: "SODEXO", value: "18" }].map(op => (
                    <button key={op.label} type="button" onClick={() => set("adminFee", op.value)}
                      className={`px-4 py-1.5 rounded-xl text-sm font-bold border-2 transition-all ${formData.adminFee === op.value ? 'bg-secondary text-white border-secondary shadow-md' : 'border-secondary/40 text-secondary hover:bg-secondary/10'}`}>
                      {op.label} — {op.value}%
                    </button>
                  ))}
                </div>
                <div className="flex items-center gap-4">
                  <input
                    type="number" step="0.1" min="0" max="100"
                    value={formData.adminFee}
                    onChange={e => set("adminFee", e.target.value)}
                    className="w-32 px-4 py-2.5 rounded-xl border-2 border-border focus:border-secondary outline-none text-xl font-bold text-center"
                    placeholder="0"
                  />
                  <div className="flex gap-2 flex-wrap">
                    {["0", "5", "10", "12", "15", "20"].map(v => (
                      <button key={v} type="button" onClick={() => set("adminFee", v)}
                        className={`px-3 py-1.5 rounded-lg text-sm font-bold border-2 transition-all ${formData.adminFee === v ? 'bg-secondary text-white border-secondary' : 'border-border text-muted-foreground hover:border-secondary/50'}`}>
                        {v}%
                      </button>
                    ))}
                  </div>
                </div>
                <p className="text-xs text-muted-foreground mt-2">
                  Aplicada automaticamente sobre o preço base. Clientes <strong>não visualizam</strong> esta taxa.
                </p>
                {formData.adminFee && Number(formData.adminFee) > 0 && (
                  <div className="mt-2 p-2 bg-secondary/10 rounded-lg">
                    <p className="text-xs font-bold text-secondary">
                      Exemplo: produto R$ 10,00 → cliente vê R$ {(10 * (1 + Number(formData.adminFee) / 100)).toFixed(2)}
                    </p>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ─── Tab: Financeiro ─── */}
          {activeTab === "financeiro" && (
            <div className="space-y-5">
              <div className="grid grid-cols-3 gap-4">
                {/* Prazo de faturamento */}
                <div>
                  <label className="block text-sm font-semibold mb-2">Prazo de Faturamento</label>
                  <div className="flex flex-col gap-2">
                    {["15", "30", "45"].map(opt => (
                      <button key={opt} type="button" onClick={() => set("billingTerm", opt)}
                        className={`px-4 py-2 rounded-xl font-bold text-sm border-2 transition-all text-left ${formData.billingTerm === opt ? 'bg-primary text-white border-primary' : 'border-border text-muted-foreground hover:border-primary/50'}`}>
                        {opt} dias
                      </button>
                    ))}
                    <button type="button" onClick={() => set("billingTerm", "")}
                      className={`px-4 py-2 rounded-xl font-bold text-sm border-2 transition-all text-left ${!formData.billingTerm ? 'bg-muted border-border text-foreground' : 'border-border text-muted-foreground hover:border-border'}`}>
                      Não definido
                    </button>
                  </div>
                </div>

                {/* Tipo de faturamento */}
                <div>
                  <label className="block text-sm font-semibold mb-2">Tipo de Faturamento</label>
                  <div className="flex flex-col gap-2">
                    {[
                      { value: "boleto", label: "Boleto" },
                      { value: "deposito", label: "Depósito" },
                      { value: "pix", label: "PIX" },
                    ].map(opt => (
                      <button key={opt.value} type="button" onClick={() => set("billingType", opt.value)}
                        className={`px-4 py-2 rounded-xl font-bold text-sm border-2 transition-all text-left ${formData.billingType === opt.value ? 'bg-primary text-white border-primary' : 'border-border text-muted-foreground hover:border-primary/50'}`}>
                        {opt.label}
                      </button>
                    ))}
                    <button type="button" onClick={() => set("billingType", "")}
                      className={`px-4 py-2 rounded-xl font-bold text-sm border-2 transition-all text-left ${!formData.billingType ? 'bg-muted border-border text-foreground' : 'border-border text-muted-foreground hover:border-border'}`}>
                      Não definido
                    </button>
                  </div>
                </div>

                {/* Formato de faturamento */}
                <div>
                  <label className="block text-sm font-semibold mb-2">Formato de Faturamento</label>
                  <div className="flex flex-col gap-2">
                    {[
                      { value: "diario", label: "Diário" },
                      { value: "semanal", label: "Semanal" },
                      { value: "mensal", label: "Mensal" },
                    ].map(opt => (
                      <button key={opt.value} type="button" onClick={() => set("billingFormat", opt.value)}
                        className={`px-4 py-2 rounded-xl font-bold text-sm border-2 transition-all text-left ${formData.billingFormat === opt.value ? 'bg-primary text-white border-primary' : 'border-border text-muted-foreground hover:border-primary/50'}`}>
                        {opt.label}
                      </button>
                    ))}
                    <button type="button" onClick={() => set("billingFormat", "")}
                      className={`px-4 py-2 rounded-xl font-bold text-sm border-2 transition-all text-left ${!formData.billingFormat ? 'bg-muted border-border text-foreground' : 'border-border text-muted-foreground hover:border-border'}`}>
                      Não definido
                    </button>
                  </div>
                </div>
              </div>

              <div>
                <label className="block text-sm font-semibold mb-1">
                  <span className="flex items-center gap-1"><CalendarDays className="w-4 h-4 text-primary" /> Datas de Pagamento</span>
                </label>
                <input type="text" value={formData.paymentDates}
                  onChange={e => set("paymentDates", e.target.value)}
                  placeholder="Ex: 5, 15, 25 de cada mês"
                  className="w-full px-4 py-2.5 rounded-xl border-2 border-border focus:border-primary outline-none" />
              </div>

              <div>
                <label className="block text-sm font-semibold mb-1">
                  <span className="flex items-center gap-1"><FileText className="w-4 h-4 text-primary" /> Observação Financeira</span>
                </label>
                <textarea value={formData.financialNotes}
                  onChange={e => set("financialNotes", e.target.value)}
                  rows={4}
                  placeholder="Informações adicionais sobre o faturamento deste cliente..."
                  className="w-full px-4 py-2.5 rounded-xl border-2 border-border focus:border-primary outline-none resize-none" />
              </div>
            </div>
          )}

          {/* ─── Escopo Contratual Tab ─── */}
          {activeTab === "contrato" && (
            <ContractScopeManager
              company={editingCompany}
              contractModel={formData.contractModel}
              hiddenIds={pendingDeletes}
              onDelete={(id) => setPendingDeletes(prev => [...prev, id])}
              autoCalcCost={formData.autoCalcCost}
              autoPriceFromCatalog={formData.autoPriceFromCatalog}
              manualAvgCost={formData.manualAvgCost}
              priceGroupId={formData.priceGroupId ? Number(formData.priceGroupId) : null}
              onFlagChange={(flag, val) => set(flag as any, val)}
              clientType={formData.clientType}
            />
          )}

          {/* ─── Configuração de Entrega Tab ─── */}
          {activeTab === "entrega" && (
            <div className="space-y-4">
              <div className="flex items-center gap-2 mb-2">
                <Clock className="w-5 h-5 text-primary" />
                <h3 className="font-bold text-base">Configuração de Janelas de Entrega</h3>
              </div>
              <p className="text-sm text-muted-foreground mb-4">
                Configure os dias e horários em que esta empresa recebe entregas. Essas informações serão usadas automaticamente na criação de cotações.
              </p>
              <div className="space-y-3">
                {DAYS_OPTIONS.map(day => {
                  const cfg = (formData.deliveryConfigJson || DEFAULT_DELIVERY_CONFIG)[day] || DEFAULT_DELIVERY_CONFIG[day];
                  return (
                    <div key={day} className={`rounded-xl border-2 p-4 transition-colors ${cfg.enabled ? 'border-primary/30 bg-primary/5' : 'border-border bg-muted/30'}`}>
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <button
                            type="button"
                            onClick={() => {
                              const current = formData.deliveryConfigJson || { ...DEFAULT_DELIVERY_CONFIG };
                              set("deliveryConfigJson", { ...current, [day]: { ...cfg, enabled: !cfg.enabled } });
                            }}
                            data-testid={`toggle-delivery-${day.replace(/[^a-z]/gi, '-').toLowerCase()}`}
                            className={`relative w-12 h-6 rounded-full transition-colors ${cfg.enabled ? 'bg-primary' : 'bg-gray-300'}`}
                          >
                            <span className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-transform ${cfg.enabled ? 'translate-x-7' : 'translate-x-1'}`} />
                          </button>
                          <span className="font-semibold text-sm">{day}</span>
                          {cfg.enabled && (
                            <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full font-medium">Entrega permitida</span>
                          )}
                          {!cfg.enabled && (
                            <span className="text-xs bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full font-medium">Sem entrega</span>
                          )}
                        </div>
                      </div>
                      {cfg.enabled && (
                        <div className="mt-3 flex items-center gap-4 pl-15">
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-muted-foreground font-medium w-14">Início:</span>
                            <input
                              type="time"
                              value={cfg.startTime}
                              onChange={e => {
                                const current = formData.deliveryConfigJson || { ...DEFAULT_DELIVERY_CONFIG };
                                set("deliveryConfigJson", { ...current, [day]: { ...cfg, startTime: e.target.value } });
                              }}
                              data-testid={`time-start-${day.replace(/[^a-z]/gi, '-').toLowerCase()}`}
                              className="px-2 py-1 rounded-lg border border-border text-sm focus:border-primary outline-none"
                            />
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-muted-foreground font-medium">Fim:</span>
                            <input
                              type="time"
                              value={cfg.endTime}
                              onChange={e => {
                                const current = formData.deliveryConfigJson || { ...DEFAULT_DELIVERY_CONFIG };
                                set("deliveryConfigJson", { ...current, [day]: { ...cfg, endTime: e.target.value } });
                              }}
                              data-testid={`time-end-${day.replace(/[^a-z]/gi, '-').toLowerCase()}`}
                              className="px-2 py-1 rounded-lg border border-border text-sm focus:border-primary outline-none"
                            />
                          </div>
                          <span className="text-sm text-muted-foreground">
                            {cfg.startTime && cfg.endTime ? `Janela: ${cfg.startTime} às ${cfg.endTime}` : ''}
                          </span>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
              <div className="mt-4 p-3 bg-blue-50 rounded-xl border border-blue-200">
                <p className="text-xs text-blue-700 font-medium">
                  💡 Essas informações são exibidas automaticamente na aba de Cotações ao criar uma proposta para esta empresa, permitindo sugestões de agrupamento de rotas.
                </p>
              </div>
            </div>
          )}

          {/* Footer */}
          <div className="flex items-center justify-between mt-8 pt-6 border-t border-border/50">
            <div className="flex gap-2">
              {TABS.map(tab => {
                const Icon = tab.icon;
                const isContratualLocked = tab.key === 'contrato' && formData.clientType !== 'contratual';
                return (
                  <button
                    key={tab.key}
                    type="button"
                    onClick={() => !isContratualLocked && setActiveTab(tab.key)}
                    title={isContratualLocked ? 'Disponível apenas para Cliente Contratual' : tab.label}
                    className={`p-2 rounded-lg transition-colors relative ${
                      isContratualLocked ? 'text-muted-foreground/30 cursor-not-allowed' :
                      activeTab === tab.key ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-muted'
                    }`}>
                    <Icon className="w-4 h-4" />
                    {isContratualLocked && <Lock className="w-2.5 h-2.5 absolute bottom-0.5 right-0.5 opacity-50" />}
                  </button>
                );
              })}
            </div>
            <div className="flex gap-3">
              <button type="button" onClick={closeModal}
                className="px-5 py-2.5 rounded-xl border-2 border-border font-bold text-muted-foreground hover:bg-muted transition-colors">
                Cancelar
              </button>
              <button type="submit" disabled={isPending}
                className="px-6 py-2.5 bg-primary text-white font-bold rounded-xl shadow-lg hover:-translate-y-0.5 transition-transform disabled:opacity-50">
                {isPending ? "Salvando..." : editingCompany ? "Salvar Alterações" : "Criar Empresa"}
              </button>
            </div>
          </div>
        </form>
      </Modal>
    </Layout>
  );
}
