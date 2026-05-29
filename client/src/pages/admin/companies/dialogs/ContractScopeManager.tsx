import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useProducts } from "@/hooks/use-catalog";
import { useToast } from "@/hooks/use-toast";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { normalizeList, normalizeOne } from "@/lib/normalizeResponse";
import {
  Package, Lock, CalendarDays, Save, Edit2, Trash2, X, Loader2,
} from "lucide-react";
import { catColor, CAT_PALETTE, fmt } from "../constants";

interface ContractScopeManagerProps {
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
}

const WEEK_DAYS = ["Segunda-feira", "Terça-feira", "Quarta-feira", "Quinta-feira", "Sexta-feira"];
const selectCls = "px-2.5 py-1.5 rounded-lg border border-border text-xs focus:border-primary outline-none bg-background";
const inputCls  = "px-2.5 py-1.5 rounded-lg border border-border text-xs focus:border-primary outline-none w-full bg-background";

export function ContractScopeManager({
  company, contractModel, hiddenIds, onDelete,
  autoCalcCost, autoPriceFromCatalog, manualAvgCost, priceGroupId, onFlagChange, clientType,
}: ContractScopeManagerProps) {
  const { data: products } = useProducts();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: dbCategories } = useQuery<any[]>({
    queryKey: ["/api/categories"],
    staleTime: 60000,
  });
  const catNames = (dbCategories || []).filter((c: any) => c.active).map((c: any) => c.name as string);

  const { data: allPrices } = useQuery<any[]>({
    queryKey: ["/api/product-prices"],
    staleTime: 120000,
    enabled: autoPriceFromCatalog,
  });

  const getPriceForProduct = (productId: number): string => {
    if (!autoPriceFromCatalog || !priceGroupId || !allPrices) return "";
    const entry = allPrices.find((p: any) => p.productId === productId && p.priceGroupId === priceGroupId);
    return entry ? String(Number(entry.price).toFixed(2)) : "";
  };

  const [newItem, setNewItem] = useState({
    dayOfWeek: "", weekNumber: "", scopeCategory: "",
    productId: "", quantity: "1", unitPrice: "", averageCost: "",
  });
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editRow, setEditRow] = useState<any>({});
  const [editSaving, setEditSaving] = useState(false);
  const [generating, setGenerating] = useState(false);

  const handleGenerateOrders = async () => {
    if (!company?.id) return;
    if (!confirm("Gerar pedidos desta semana a partir do escopo contratual?")) return;
    setGenerating(true);
    try {
      const res = await fetchWithAuth(`/api/companies/${company.id}/generate-orders-from-scope`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error?.message || json.message || "Erro ao gerar pedidos");
      const payload: any = normalizeOne(json) ?? json;
      alert(`✅ ${payload.created ?? 0} pedido(s) gerado(s) com sucesso para a semana atual!`);
      queryClient.invalidateQueries({ queryKey: ["/api/orders"] });
    } catch (e: any) {
      alert("Erro: " + e.message);
    } finally { setGenerating(false); }
  };

  const { data: scopes, isLoading } = useQuery<any[]>({
    queryKey: ["/api/companies", company?.id, "contract-scopes"],
    queryFn: async () => {
      if (!company?.id) return [];
      const res = await fetchWithAuth(`/api/companies/${company.id}/contract-scopes`);
      return normalizeList(await res.json());
    },
    enabled: !!company?.id,
    staleTime: 2 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  const getProductsForCategory = (cat: string) => {
    const all = (products || []).filter((p: any) => p.active);
    if (!cat) return all;
    return all.filter((p: any) => p.category === cat);
  };

  const newItemProducts = getProductsForCategory(newItem.scopeCategory);
  const allActiveProducts = (products || []).filter((p: any) => p.active);

  const handleNewCategoryChange = (cat: string) => {
    const filtered = getProductsForCategory(cat);
    const currentOk = filtered.some((p: any) => String(p.id) === newItem.productId);
    const newProductId = currentOk ? newItem.productId : "";
    const autoPrice = newProductId && autoPriceFromCatalog
      ? getPriceForProduct(Number(newProductId)) : (currentOk ? newItem.unitPrice : "");
    setNewItem(p => ({ ...p, scopeCategory: cat, productId: newProductId, unitPrice: autoPrice }));
  };

  const handleNewProductChange = (productId: string) => {
    const price = productId && autoPriceFromCatalog
      ? getPriceForProduct(Number(productId)) : newItem.unitPrice;
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
      if ((contractModel === "alternado" || contractModel === "rotacao4") && newItem.weekNumber) {
        body.weekNumber = Number(newItem.weekNumber);
      }
      const res = await fetchWithAuth(`/api/companies/${company.id}/contract-scopes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error("Erro ao adicionar item");
      queryClient.invalidateQueries({ queryKey: ["/api/companies", company.id, "contract-scopes"] });
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
      const res = await fetchWithAuth(
        `/api/companies/${company.id}/contract-scopes/${id}`,
        { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }
      );
      if (!res.ok) throw new Error("Erro ao salvar item");
      await queryClient.invalidateQueries({
        queryKey: ["/api/companies", company.id, "contract-scopes"],
      });
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

  if (clientType !== "contratual") {
    return (
      <div className="py-14 text-center text-muted-foreground flex flex-col items-center gap-3">
        <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center">
          <Lock className="w-8 h-8 opacity-25" />
        </div>
        <div>
          <p className="font-bold text-sm text-foreground">Escopo Contratual bloqueado</p>
          <p className="text-xs mt-1 text-muted-foreground">
            Disponível apenas para empresas do tipo <strong>Contratual</strong>.
          </p>
          <p className="text-xs text-muted-foreground">
            Altere o tipo de cliente na aba <strong>Configurações</strong>.
          </p>
        </div>
      </div>
    );
  }

  const isAlternado = contractModel === "alternado";
  const isRotacao4 = contractModel === "rotacao4";
  const hasWeekRotation = isAlternado || isRotacao4;

  const WEEK_LABELS: Record<string, string> = {
    "": "Todas", "0": "Todas",
    "1": "Sem. 1 (A)", "2": "Sem. 2 (B)", "3": "Sem. 3 (C)", "4": "Sem. 4 (D)",
  };

  const visibleScopes = (scopes || []).filter((s: any) => !hiddenIds.includes(s.id));

  const totalValor = visibleScopes.reduce((sum: number, s: any) => {
    return sum + (Number(s.quantity) * (s.unitPrice != null ? Number(s.unitPrice) : 0));
  }, 0);
  const hasPrices = visibleScopes.some((s: any) => s.unitPrice != null);
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

  return (
    <div className="space-y-4">
      {/* Model badge */}
      <div className="flex items-center gap-2 p-3 bg-secondary/5 rounded-xl border border-secondary/20">
        <Package className="w-4 h-4 text-secondary" />
        <p className="text-sm font-bold text-secondary">
          {contractModel === "fixo" ? "Contrato Fixo — Escopo imutável por semana"
           : contractModel === "variavel" ? "Contrato Variável — Escopo base com ajustes permitidos"
           : contractModel === "alternado" ? "Contrato Alternado — Rotação quinzenal (Lista A / B)"
           : contractModel === "rotacao4" ? "Rotação 4 Semanas — Ciclo mensal (Listas A–D)"
           : "Defina o modelo de contrato na aba Configurações"}
        </p>
      </div>

      {/* Config flags */}
      <div className="p-3 rounded-xl border border-border bg-muted/10 flex flex-wrap gap-4">
        <label className="flex items-center gap-2.5 cursor-pointer select-none">
          <button type="button" data-testid="toggle-auto-calc-cost"
            onClick={() => onFlagChange("autoCalcCost", !autoCalcCost)}
            className={`w-10 h-5 rounded-full transition-colors relative ${autoCalcCost ? "bg-primary" : "bg-muted-foreground/30"}`}>
            <span className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${autoCalcCost ? "translate-x-5" : "translate-x-0.5"}`} />
          </button>
          <span className="text-xs font-medium text-foreground">Calcular custo médio automaticamente</span>
        </label>
        <label className="flex items-center gap-2.5 cursor-pointer select-none">
          <button type="button" data-testid="toggle-auto-price"
            onClick={() => onFlagChange("autoPriceFromCatalog", !autoPriceFromCatalog)}
            className={`w-10 h-5 rounded-full transition-colors relative ${autoPriceFromCatalog ? "bg-secondary" : "bg-muted-foreground/30"}`}>
            <span className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${autoPriceFromCatalog ? "translate-x-5" : "translate-x-0.5"}`} />
          </button>
          <span className="text-xs font-medium text-foreground">Preço automático dos produtos</span>
          {autoPriceFromCatalog && !priceGroupId && (
            <span className="text-xs text-orange-500">(configure um Grupo de Preço para habilitar)</span>
          )}
        </label>
      </div>

      {/* Financial summary */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider">
            Resumo Financeiro do Contrato
          </p>
          {visibleScopes.length > 0 && (
            <button type="button" data-testid="btn-generate-orders"
              onClick={handleGenerateOrders} disabled={generating}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-secondary text-white text-xs font-bold rounded-lg shadow hover:-translate-y-0.5 transition-transform disabled:opacity-50">
              {generating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Package className="w-3.5 h-3.5" />}
              {generating ? "Gerando..." : "Gerar Pedidos da Semana"}
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
                    <input type="number" min="0" step="0.01"
                      data-testid="input-manual-avg-cost"
                      value={manualAvgCost}
                      onChange={e => onFlagChange("manualAvgCost", e.target.value)}
                      placeholder="Custo médio R$"
                      className="w-full px-2 py-1 rounded-lg border border-orange-300 text-sm font-bold bg-white outline-none focus:border-orange-500" />
                    <p className="text-xs text-muted-foreground">custo médio manual × qtd</p>
                  </div>
                )}
              </div>
              <div className={`rounded-xl border p-3 ${margemEstimada >= 0 ? "border-purple-200 bg-purple-50" : "border-red-200 bg-red-50"}`}>
                <p className="text-xs text-muted-foreground font-medium">📊 Margem estimada</p>
                <p className={`text-xl font-bold mt-0.5 ${margemEstimada >= 0 ? "text-purple-700" : "text-red-700"}`}>
                  {fmt(String(margemEstimada))}
                </p>
                <p className="text-xs text-muted-foreground">valor − custo estimado</p>
              </div>
            </div>
          </>
        )}
      </div>

      {/* Add item form */}
      <div className="p-4 bg-muted/20 rounded-xl border border-border space-y-3">
        <p className="text-sm font-bold text-foreground">Adicionar item ao escopo</p>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
          <select data-testid="select-scope-day" value={newItem.dayOfWeek}
            onChange={e => setNewItem(p => ({ ...p, dayOfWeek: e.target.value }))}
            className={selectCls}>
            <option value="">Dia da semana...</option>
            {WEEK_DAYS.map(d => <option key={d} value={d}>{d}</option>)}
          </select>

          {hasWeekRotation ? (
            <select data-testid="select-scope-week" value={newItem.weekNumber}
              onChange={e => setNewItem(p => ({ ...p, weekNumber: e.target.value }))}
              className={selectCls}>
              <option value="">Semana...</option>
              <option value="1">Semana 1 (Lista A)</option>
              <option value="2">Semana 2 (Lista B)</option>
              {isRotacao4 && (
                <>
                  <option value="3">Semana 3 (Lista C)</option>
                  <option value="4">Semana 4 (Lista D)</option>
                </>
              )}
            </select>
          ) : <div />}

          <select data-testid="select-scope-category" value={newItem.scopeCategory}
            onChange={e => handleNewCategoryChange(e.target.value)}
            className={selectCls}>
            <option value="">Categoria (opcional)</option>
            {catNames.map(c => <option key={c} value={c}>{c}</option>)}
          </select>

          <select data-testid="select-scope-product" value={newItem.productId}
            onChange={e => handleNewProductChange(e.target.value)}
            className={selectCls}>
            <option value="">Produto{autoPriceFromCatalog && priceGroupId ? " (preço auto)" : ""}...</option>
            {(newItem.scopeCategory ? newItemProducts : allActiveProducts).map((p: any) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>

          <input data-testid="input-scope-quantity" type="number" min="1"
            value={newItem.quantity} onChange={e => setNewItem(p => ({ ...p, quantity: e.target.value }))}
            placeholder="Qtd" className={inputCls} />

          <input data-testid="input-scope-price" type="number" min="0" step="0.01"
            value={newItem.unitPrice} onChange={e => setNewItem(p => ({ ...p, unitPrice: e.target.value }))}
            placeholder="Preço unit. (R$)" className={inputCls} />

          <input data-testid="input-scope-cost" type="number" min="0" step="0.01"
            value={newItem.averageCost} onChange={e => setNewItem(p => ({ ...p, averageCost: e.target.value }))}
            placeholder="Custo médio (opcional)" className={inputCls} />

          <div className="px-2.5 py-1.5 rounded-lg bg-primary/5 border border-primary/20 text-xs text-center flex flex-col justify-center">
            <span className="text-muted-foreground">Total</span>
            <span className="font-bold text-primary">
              {newItem.quantity && newItem.unitPrice
                ? `R$ ${(Number(newItem.quantity) * Number(newItem.unitPrice)).toFixed(2).replace(".", ",")}`
                : "—"}
            </span>
          </div>
        </div>
        <div className="flex justify-end">
          <button type="button" data-testid="button-add-scope" onClick={addScope}
            disabled={saving || !newItem.dayOfWeek || !newItem.productId}
            className="px-5 py-2 bg-primary text-white font-bold rounded-xl hover:bg-primary/90 transition-colors disabled:opacity-50 flex items-center gap-2 text-sm">
            <Save className="w-3.5 h-3.5" /> {saving ? "Adicionando..." : "Adicionar item"}
          </button>
        </div>
      </div>

      {/* Scope table */}
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
                <div className="px-4 py-2.5 bg-primary/5 border-b border-border/50 flex items-center gap-2">
                  <CalendarDays className="w-4 h-4 text-primary" />
                  <p className="font-bold text-sm text-foreground">{group.day}</p>
                  {hasWeekRotation && group.weekNum > 0 && (
                    <span className="px-2 py-0.5 bg-secondary/20 text-secondary text-xs font-bold rounded-full">
                      {WEEK_LABELS[group.weekKey] || group.weekKey}
                    </span>
                  )}
                  <span className="ml-auto text-xs text-muted-foreground">
                    {group.items.length} {group.items.length === 1 ? "item" : "itens"}
                    {hasPrices && groupTotal > 0 && (
                      <span className="ml-2 font-bold text-primary">{fmt(String(groupTotal))}</span>
                    )}
                  </span>
                </div>
                <div className="grid grid-cols-[1fr_1fr_1fr_80px_90px_90px_90px_60px] text-xs font-bold text-muted-foreground bg-muted/20 px-3 py-1.5 border-b border-border/40 gap-2">
                  <span>Categoria</span><span>Produto</span><span>Unidade</span>
                  <span className="text-right">Qtd</span><span className="text-right">Preço unit.</span>
                  <span className="text-right">Custo</span><span className="text-right">Total</span><span />
                </div>
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
                        <select value={editRow.scopeCategory} onChange={e => {
                          const cat = e.target.value;
                          const fp = getProductsForCategory(cat);
                          const ok = fp.some((p: any) => String(p.id) === editRow.productId);
                          setEditRow((r: any) => ({ ...r, scopeCategory: cat, productId: ok ? r.productId : "" }));
                        }} className={selectCls}>
                          <option value="">Sem categoria</option>
                          {catNames.map(c => <option key={c} value={c}>{c}</option>)}
                        </select>
                        <select value={editRow.productId}
                          onChange={e => setEditRow((r: any) => ({ ...r, productId: e.target.value }))}
                          className={selectCls}>
                          <option value="">Produto...</option>
                          {editProducts.map((p: any) => <option key={p.id} value={p.id}>{p.name}</option>)}
                        </select>
                        <span className="text-xs text-muted-foreground">
                          {(editProducts.find((p: any) => String(p.id) === editRow.productId) as any)?.unit || "—"}
                        </span>
                        <input type="number" min="1" value={editRow.quantity}
                          data-testid={`scope-item-qty-${s.id}`}
                          onChange={e => setEditRow((r: any) => ({ ...r, quantity: e.target.value }))}
                          className={inputCls + " text-right"} />
                        <input type="number" min="0" step="0.01" value={editRow.unitPrice}
                          data-testid={`scope-item-price-${s.id}`}
                          onChange={e => setEditRow((r: any) => ({ ...r, unitPrice: e.target.value }))}
                          placeholder="R$" className={inputCls + " text-right"} />
                        <input type="number" min="0" step="0.01" value={editRow.averageCost}
                          data-testid={`scope-item-cost-${s.id}`}
                          onChange={e => setEditRow((r: any) => ({ ...r, averageCost: e.target.value }))}
                          placeholder="R$" className={inputCls + " text-right"} />
                        <span className="text-right text-xs font-bold text-primary">
                          {editRow.quantity && editRow.unitPrice
                            ? `R$ ${(Number(editRow.quantity) * Number(editRow.unitPrice)).toFixed(2).replace(".", ",")}`
                            : "—"}
                        </span>
                        <div className="flex gap-1">
                          <button type="button" data-testid={`scope-item-save-${s.id}`}
                            onClick={() => saveEdit(s.id)} disabled={editSaving}
                            title="Salvar item"
                            className="p-1.5 rounded-lg bg-primary text-white hover:bg-primary/90 transition-colors disabled:opacity-50">
                            {editSaving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
                          </button>
                          <button type="button" data-testid={`scope-item-cancel-${s.id}`}
                            onClick={() => setEditingId(null)} title="Cancelar edição"
                            className="p-1.5 rounded-lg text-muted-foreground hover:bg-muted transition-colors">
                            <X className="w-3 h-3" />
                          </button>
                        </div>
                      </div>
                    );
                  }
                  return (
                    <div key={s.id} className="grid grid-cols-[1fr_1fr_1fr_80px_90px_90px_90px_60px] items-center px-3 py-2.5 gap-2 hover:bg-muted/20 transition-colors border-b border-border/30 last:border-0 group">
                      <span>
                        {s.scopeCategory
                          ? <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${catColor(s.scopeCategory, catNames)}`}>{s.scopeCategory}</span>
                          : <span className="text-xs text-muted-foreground italic">—</span>}
                      </span>
                      <p className="text-sm font-medium text-foreground truncate">{product?.name || `Produto #${s.productId}`}</p>
                      <p className="text-xs text-muted-foreground">{product?.unit || "—"}</p>
                      <p className="text-sm font-bold text-right">{s.quantity}</p>
                      <p className="text-sm text-right text-foreground">
                        {s.unitPrice != null ? fmt(s.unitPrice) : <span className="text-muted-foreground">—</span>}
                      </p>
                      <p className="text-sm text-right text-muted-foreground">
                        {s.averageCost != null ? fmt(s.averageCost) : "—"}
                      </p>
                      <p className="text-sm font-bold text-right text-primary">
                        {s.unitPrice != null ? fmt(String(rowTotal)) : "—"}
                      </p>
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
