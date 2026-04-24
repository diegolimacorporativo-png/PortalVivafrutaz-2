import { useState, useEffect, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Plus, Trash2, Save, Search, Building2, TrendingUp, Package,
  ChevronRight, Copy, UserCheck, BarChart3, AlertTriangle,
  CheckCircle2, XCircle, RefreshCw, FileText, Edit3, X,
  ArrowUpRight, Banknote, Route, Calendar, Users
} from "lucide-react";

// ─── Types ───────────────────────────────────────────────────────────────────
type SimItem = {
  _key: string;
  productId: number;
  productName: string;
  category: string;
  quantity: number;
  unit: string;
  dayOfWeek: string;
  frequency: number; // 1=toda semana, 0.5=quinzenal
  unitPrice: number;
  avgCost: number;
  weeklyValue: number;
};

type Simulation = {
  id: number;
  companyName: string;
  cnpj: string | null;
  city: string | null;
  contactName: string | null;
  phone: string | null;
  email: string | null;
  modelType: string;
  minWeeklyBilling: string;
  minMonthlyBilling: string;
  route: string | null;
  routeMinManha: string;
  routeMinTarde: string;
  items: SimItem[] | null;
  totalWeekly: string;
  totalMonthly: string;
  totalCost: string;
  status: string;
  convertedToCompanyId: number | null;
  convertedAt: string | null;
  createdByName: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
};

type Product = {
  id: number;
  name: string;
  category: string;
  unit: string;
  basePrice: string | null;
  active: boolean;
  outOfSeason: boolean;
};

// ─── Constants ────────────────────────────────────────────────────────────────
const DAYS = ["Segunda-feira", "Terça-feira", "Quarta-feira", "Quinta-feira", "Sexta-feira", "Sábado"];
const MODEL_LABELS: Record<string, string> = {
  semanal: "Semanal",
  mensal: "Mensal",
  contratual: "Contratual",
  a_definir: "A Definir",
};
const STATUS_LABEL: Record<string, { label: string; color: string }> = {
  draft: { label: "Rascunho", color: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300" },
  saved: { label: "Salvo", color: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300" },
  converted: { label: "Convertido", color: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300" },
};

function classifyClient(weeklyValue: number): { label: string; color: string; description: string } {
  if (weeklyValue < 400) return { label: "Pequeno", color: "text-gray-500", description: "< R$ 400/sem" };
  if (weeklyValue < 800) return { label: "Médio", color: "text-blue-600", description: "R$ 400–799/sem" };
  if (weeklyValue < 1500) return { label: "Corporativo", color: "text-purple-600", description: "R$ 800–1499/sem" };
  return { label: "Estratégico", color: "text-green-600 font-bold", description: "≥ R$ 1500/sem" };
}

function fmt(value: number) {
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function pct(numerator: number, denominator: number): string {
  if (!denominator) return "—";
  return ((numerator / denominator) * 100).toFixed(1) + "%";
}

const genKey = () => Math.random().toString(36).slice(2, 10);

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function ScopeSimulationsPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [searchTerm, setSearchTerm] = useState("");
  const [filterStatus, setFilterStatus] = useState("all");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [showConvert, setShowConvert] = useState(false);
  const [activeTab, setActiveTab] = useState("empresa");
  const [dirty, setDirty] = useState(false);

  // ─── Local editing state ────────────────────────────────────────────────
  const [form, setForm] = useState({
    companyName: "", cnpj: "", city: "", contactName: "", phone: "", email: "",
    modelType: "a_definir",
    minWeeklyBilling: "350", minMonthlyBilling: "1400",
    route: "", routeMinManha: "350", routeMinTarde: "450",
    notes: "",
  });
  const [items, setItems] = useState<SimItem[]>([]);

  // ─── New item form ──────────────────────────────────────────────────────
  const [newItem, setNewItem] = useState({
    productId: 0, dayOfWeek: "Segunda-feira", quantity: 1, frequency: 1, unitPrice: 0, avgCost: 0,
  });

  // ─── Fetch all simulations ──────────────────────────────────────────────
  const { data: simulations = [], isLoading } = useQuery<Simulation[]>({
    queryKey: ["/api/scope-simulations"],
  });

  // ─── Fetch products ─────────────────────────────────────────────────────
  const { data: products = [] } = useQuery<Product[]>({
    queryKey: ["/api/products"],
  });
  const activeProducts = products.filter((p) => p.active && !p.outOfSeason);

  // ─── Load selected simulation into form ─────────────────────────────────
  const loadSim = useCallback((sim: Simulation) => {
    setForm({
      companyName: sim.companyName || "",
      cnpj: sim.cnpj || "",
      city: sim.city || "",
      contactName: sim.contactName || "",
      phone: sim.phone || "",
      email: sim.email || "",
      modelType: sim.modelType || "a_definir",
      minWeeklyBilling: sim.minWeeklyBilling || "350",
      minMonthlyBilling: sim.minMonthlyBilling || "1400",
      route: sim.route || "",
      routeMinManha: sim.routeMinManha || "350",
      routeMinTarde: sim.routeMinTarde || "450",
      notes: sim.notes || "",
    });
    const rawItems = (sim.items as any[]) || [];
    setItems(rawItems.map((it) => ({ ...it, _key: it._key || genKey() })));
    setDirty(false);
  }, []);

  useEffect(() => {
    if (selectedId && !isNew) {
      const sim = simulations.find((s) => s.id === selectedId);
      if (sim) loadSim(sim);
    }
  }, [selectedId, simulations, isNew, loadSim]);

  // ─── Calculations ────────────────────────────────────────────────────────
  const totalWeekly = items.reduce((acc, it) => acc + it.weeklyValue, 0);
  const totalMonthly = totalWeekly * 4.33;
  const totalCost = items.reduce((acc, it) => acc + it.avgCost * it.quantity * it.frequency, 0);
  const grossMargin = totalWeekly - totalCost;
  const marginPct = totalWeekly > 0 ? (grossMargin / totalWeekly) * 100 : 0;

  const minWeekly = parseFloat(form.minWeeklyBilling) || 350;
  const minMonthly = parseFloat(form.minMonthlyBilling) || 1400;
  const routeMin = form.route === "manha" ? parseFloat(form.routeMinManha) || 350 : form.route === "tarde" ? parseFloat(form.routeMinTarde) || 450 : null;

  const meetsWeekly = totalWeekly >= minWeekly;
  const meetsMonthly = totalMonthly >= minMonthly;
  const meetsRoute = routeMin === null || totalWeekly >= routeMin;
  const classification = classifyClient(totalWeekly);

  // ─── Save mutation ───────────────────────────────────────────────────────
  const saveMut = useMutation({
    mutationFn: async (status?: string) => {
      const payload = {
        ...form,
        items: items.map(({ _key, ...rest }) => rest),
        totalWeekly: String(totalWeekly.toFixed(2)),
        totalMonthly: String(totalMonthly.toFixed(2)),
        totalCost: String(totalCost.toFixed(2)),
        status: status || (selectedId && !isNew ? (simulations.find(s => s.id === selectedId)?.status || "draft") : "draft"),
      };
      if (isNew || !selectedId) {
        return apiRequest("POST", "/api/scope-simulations", payload);
      } else {
        return apiRequest("PATCH", `/api/scope-simulations/${selectedId}`, payload);
      }
    },
    onSuccess: async (res) => {
      const saved = await res.json();
      queryClient.invalidateQueries({ queryKey: ["/api/scope-simulations"] });
      if (isNew) {
        setSelectedId(saved.id);
        setIsNew(false);
      }
      setDirty(false);
      toast({ title: "Simulação salva com sucesso!" });
    },
    onError: (e: any) => toast({ title: "Erro ao salvar", description: e.message, variant: "destructive" }),
  });

  const deleteMut = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/scope-simulations/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/scope-simulations"] });
      setSelectedId(null);
      setIsNew(false);
      toast({ title: "Simulação excluída" });
    },
    onError: (e: any) => toast({ title: "Erro ao excluir", description: e.message, variant: "destructive" }),
  });

  // ─── Item management ─────────────────────────────────────────────────────
  function selectProduct(productId: number) {
    const p = activeProducts.find((x) => x.id === productId);
    if (!p) return;
    setNewItem((prev) => ({
      ...prev,
      productId: p.id,
      unitPrice: p.basePrice ? parseFloat(p.basePrice) : 0,
      avgCost: p.basePrice ? parseFloat(p.basePrice) * 0.6 : 0,
    }));
  }

  function addItem() {
    const p = activeProducts.find((x) => x.id === newItem.productId);
    if (!p) return toast({ title: "Selecione um produto", variant: "destructive" });
    if (!newItem.dayOfWeek) return toast({ title: "Selecione o dia", variant: "destructive" });
    const weeklyValue = newItem.quantity * newItem.unitPrice * newItem.frequency;
    const entry: SimItem = {
      _key: genKey(),
      productId: p.id,
      productName: p.name,
      category: p.category,
      quantity: newItem.quantity,
      unit: p.unit,
      dayOfWeek: newItem.dayOfWeek,
      frequency: newItem.frequency,
      unitPrice: newItem.unitPrice,
      avgCost: newItem.avgCost,
      weeklyValue,
    };
    setItems((prev) => [...prev, entry]);
    setNewItem({ productId: 0, dayOfWeek: "Segunda-feira", quantity: 1, frequency: 1, unitPrice: 0, avgCost: 0 });
    setDirty(true);
  }

  function removeItem(key: string) {
    setItems((prev) => prev.filter((i) => i._key !== key));
    setDirty(true);
  }

  function updateItem(key: string, field: keyof SimItem, value: any) {
    setItems((prev) =>
      prev.map((it) => {
        if (it._key !== key) return it;
        const updated = { ...it, [field]: value };
        updated.weeklyValue = updated.quantity * updated.unitPrice * updated.frequency;
        return updated;
      })
    );
    setDirty(true);
  }

  // ─── New simulation ──────────────────────────────────────────────────────
  function startNew() {
    setIsNew(true);
    setSelectedId(null);
    setForm({
      companyName: "", cnpj: "", city: "", contactName: "", phone: "", email: "",
      modelType: "a_definir",
      minWeeklyBilling: "350", minMonthlyBilling: "1400",
      route: "", routeMinManha: "350", routeMinTarde: "450",
      notes: "",
    });
    setItems([]);
    setDirty(false);
    setActiveTab("empresa");
  }

  function duplicateSim(sim: Simulation) {
    setIsNew(true);
    setSelectedId(null);
    setForm({
      companyName: `${sim.companyName} (cópia)`,
      cnpj: sim.cnpj || "", city: sim.city || "",
      contactName: sim.contactName || "", phone: sim.phone || "", email: sim.email || "",
      modelType: sim.modelType,
      minWeeklyBilling: sim.minWeeklyBilling, minMonthlyBilling: sim.minMonthlyBilling,
      route: sim.route || "", routeMinManha: sim.routeMinManha, routeMinTarde: sim.routeMinTarde,
      notes: sim.notes || "",
    });
    const rawItems = (sim.items as any[]) || [];
    setItems(rawItems.map((it) => ({ ...it, _key: genKey() })));
    setDirty(true);
    setActiveTab("empresa");
  }

  // ─── Filtered list ───────────────────────────────────────────────────────
  const filtered = simulations.filter((s) => {
    const matchSearch = !searchTerm || s.companyName.toLowerCase().includes(searchTerm.toLowerCase()) || (s.city || "").toLowerCase().includes(searchTerm.toLowerCase());
    const matchStatus = filterStatus === "all" || s.status === filterStatus;
    return matchSearch && matchStatus;
  });

  const currentSim = selectedId ? simulations.find((s) => s.id === selectedId) : null;
  const isConverted = currentSim?.status === "converted";
  const hasEditor = isNew || selectedId !== null;

  // ─── Grouped items by day ────────────────────────────────────────────────
  const itemsByDay: Record<string, SimItem[]> = {};
  for (const item of items) {
    if (!itemsByDay[item.dayOfWeek]) itemsByDay[item.dayOfWeek] = [];
    itemsByDay[item.dayOfWeek].push(item);
  }

  return (
    <div className="flex h-[calc(100vh-64px)] overflow-hidden bg-background">
      {/* ─── Left Panel: List ─────────────────────────────────────────── */}
      <aside className="w-80 flex-shrink-0 border-r flex flex-col bg-card">
        {/* Header */}
        <div className="p-4 border-b">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold text-sm text-foreground">Simulações Comerciais</h2>
            <Button
              size="sm"
              onClick={startNew}
              data-testid="button-new-simulation"
              className="h-7 text-xs gap-1"
            >
              <Plus className="w-3 h-3" />
              Nova
            </Button>
          </div>
          <div className="relative mb-2">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
            <Input
              placeholder="Buscar empresa ou cidade..."
              className="pl-8 h-8 text-xs"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              data-testid="input-search-simulation"
            />
          </div>
          <Select value={filterStatus} onValueChange={setFilterStatus}>
            <SelectTrigger className="h-7 text-xs" data-testid="select-filter-status">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos os status</SelectItem>
              <SelectItem value="draft">Rascunho</SelectItem>
              <SelectItem value="saved">Salvos</SelectItem>
              <SelectItem value="converted">Convertidos</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Simulation list */}
        <ScrollArea className="flex-1">
          {isLoading ? (
            <div className="p-4 text-center text-muted-foreground text-xs">Carregando...</div>
          ) : filtered.length === 0 ? (
            <div className="p-6 text-center text-muted-foreground text-xs">
              <FileText className="w-8 h-8 mx-auto mb-2 opacity-40" />
              Nenhuma simulação encontrada
            </div>
          ) : (
            <div className="divide-y">
              {filtered.map((sim) => {
                const isSelected = sim.id === selectedId && !isNew;
                const st = STATUS_LABEL[sim.status] || STATUS_LABEL.draft;
                const weekly = parseFloat(sim.totalWeekly || "0");
                return (
                  <button
                    key={sim.id}
                    data-testid={`item-simulation-${sim.id}`}
                    onClick={() => { setSelectedId(sim.id); setIsNew(false); }}
                    className={`w-full text-left p-3 hover:bg-accent transition-colors ${isSelected ? "bg-accent" : ""}`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <p className="font-medium text-xs truncate">{sim.companyName}</p>
                        <p className="text-[10px] text-muted-foreground truncate mt-0.5">
                          {sim.city || "—"} · {MODEL_LABELS[sim.modelType]}
                        </p>
                        <p className="text-[10px] font-medium text-primary mt-1">
                          {fmt(weekly)}<span className="text-muted-foreground font-normal">/sem</span>
                        </p>
                      </div>
                      <div className="flex flex-col items-end gap-1 flex-shrink-0">
                        <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${st.color}`}>
                          {st.label}
                        </span>
                        <div className="flex gap-1">
                          <button
                            type="button"
                            data-testid={`button-duplicate-${sim.id}`}
                            onClick={(e) => { e.stopPropagation(); duplicateSim(sim); }}
                            className="p-0.5 text-muted-foreground hover:text-foreground"
                            title="Duplicar"
                          >
                            <Copy className="w-3 h-3" />
                          </button>
                        </div>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </ScrollArea>

        {/* Stats footer */}
        <div className="p-3 border-t bg-muted/30">
          <div className="flex justify-between text-[10px] text-muted-foreground">
            <span>{simulations.length} simulações</span>
            <span>{simulations.filter(s => s.status === "converted").length} convertidas</span>
          </div>
        </div>
      </aside>

      {/* ─── Right Panel: Editor ──────────────────────────────────────── */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {!hasEditor ? (
          <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground gap-4">
            <BarChart3 className="w-16 h-16 opacity-20" />
            <div className="text-center">
              <p className="font-medium">Simulação de Escopo Comercial</p>
              <p className="text-sm mt-1">Selecione uma simulação ou crie uma nova</p>
            </div>
            <Button onClick={startNew} data-testid="button-start-simulation">
              <Plus className="w-4 h-4 mr-2" />
              Nova Simulação
            </Button>
          </div>
        ) : (
          <>
            {/* Editor Header */}
            <div className="flex items-center justify-between px-6 py-3 border-b bg-card flex-shrink-0">
              <div className="flex items-center gap-3">
                <Building2 className="w-5 h-5 text-primary" />
                <div>
                  <h1 className="font-semibold text-sm">
                    {isNew ? "Nova Simulação" : (form.companyName || "Sem nome")}
                  </h1>
                  {!isNew && currentSim && (
                    <p className="text-xs text-muted-foreground">
                      Criado por {currentSim.createdByName || "—"} · Atualizado {new Date(currentSim.updatedAt).toLocaleDateString("pt-BR")}
                    </p>
                  )}
                </div>
                {!isNew && currentSim && (
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_LABEL[currentSim.status]?.color}`}>
                    {STATUS_LABEL[currentSim.status]?.label}
                  </span>
                )}
                {dirty && (
                  <span className="text-xs text-orange-500 font-medium flex items-center gap-1">
                    <Edit3 className="w-3 h-3" /> Não salvo
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2">
                {!isNew && selectedId && !isConverted && (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="text-red-600 border-red-200 hover:bg-red-50 dark:hover:bg-red-900/20 h-8 text-xs"
                    onClick={() => { if (confirm("Excluir esta simulação?")) deleteMut.mutate(selectedId!); }}
                    data-testid="button-delete-simulation"
                  >
                    <Trash2 className="w-3 h-3 mr-1" />
                    Excluir
                  </Button>
                )}
                {!isConverted && (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => saveMut.mutate("draft")}
                    disabled={saveMut.isPending}
                    data-testid="button-save-draft"
                    className="h-8 text-xs"
                  >
                    <Save className="w-3 h-3 mr-1" />
                    Salvar Rascunho
                  </Button>
                )}
                {!isConverted && (
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => saveMut.mutate("saved")}
                    disabled={saveMut.isPending || !form.companyName}
                    data-testid="button-save-simulation"
                    className="h-8 text-xs"
                  >
                    <Save className="w-3 h-3 mr-1" />
                    Salvar
                  </Button>
                )}
                {!isNew && currentSim?.status === "saved" && !isConverted && (
                  <Button
                    type="button"
                    size="sm"
                    variant="default"
                    className="h-8 text-xs bg-green-600 hover:bg-green-700"
                    onClick={() => setShowConvert(true)}
                    data-testid="button-convert-simulation"
                  >
                    <UserCheck className="w-3 h-3 mr-1" />
                    Converter em Cliente
                  </Button>
                )}
                {isConverted && (
                  <Badge className="bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300 gap-1">
                    <CheckCircle2 className="w-3 h-3" />
                    Convertido — Empresa #{currentSim?.convertedToCompanyId}
                  </Badge>
                )}
              </div>
            </div>

            {/* Tabs */}
            <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col overflow-hidden">
              <TabsList className="mx-6 mt-3 flex-shrink-0 w-fit">
                <TabsTrigger value="empresa" data-testid="tab-empresa" className="text-xs gap-1">
                  <Building2 className="w-3.5 h-3.5" /> Empresa
                </TabsTrigger>
                <TabsTrigger value="escopo" data-testid="tab-escopo" className="text-xs gap-1">
                  <Package className="w-3.5 h-3.5" /> Escopo
                  {items.length > 0 && <Badge variant="secondary" className="ml-1 text-[10px] px-1.5 py-0">{items.length}</Badge>}
                </TabsTrigger>
                <TabsTrigger value="analise" data-testid="tab-analise" className="text-xs gap-1">
                  <BarChart3 className="w-3.5 h-3.5" /> Análise
                </TabsTrigger>
              </TabsList>

              <ScrollArea className="flex-1">
                {/* ── Tab: Empresa ─────────────────────────────────────── */}
                <TabsContent value="empresa" className="p-6 space-y-6 mt-0">
                  {/* Company Info */}
                  <Card>
                    <CardHeader className="pb-3">
                      <CardTitle className="text-sm flex items-center gap-2">
                        <Building2 className="w-4 h-4 text-primary" />
                        Dados da Empresa Prospectada
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <div className="grid grid-cols-2 gap-4">
                        <div className="col-span-2">
                          <Label className="text-xs">Nome da Empresa *</Label>
                          <Input
                            value={form.companyName}
                            onChange={(e) => { setForm(f => ({ ...f, companyName: e.target.value })); setDirty(true); }}
                            placeholder="Razão Social ou Nome Fantasia"
                            className="mt-1"
                            disabled={isConverted}
                            data-testid="input-company-name"
                          />
                        </div>
                        <div>
                          <Label className="text-xs">CNPJ</Label>
                          <Input
                            value={form.cnpj}
                            onChange={(e) => { setForm(f => ({ ...f, cnpj: e.target.value })); setDirty(true); }}
                            placeholder="00.000.000/0000-00"
                            className="mt-1"
                            disabled={isConverted}
                            data-testid="input-cnpj"
                          />
                        </div>
                        <div>
                          <Label className="text-xs">Cidade</Label>
                          <Input
                            value={form.city}
                            onChange={(e) => { setForm(f => ({ ...f, city: e.target.value })); setDirty(true); }}
                            placeholder="Ex: São Paulo - SP"
                            className="mt-1"
                            disabled={isConverted}
                            data-testid="input-city"
                          />
                        </div>
                        <div>
                          <Label className="text-xs">Responsável / Contato</Label>
                          <Input
                            value={form.contactName}
                            onChange={(e) => { setForm(f => ({ ...f, contactName: e.target.value })); setDirty(true); }}
                            placeholder="Nome do contato"
                            className="mt-1"
                            disabled={isConverted}
                            data-testid="input-contact-name"
                          />
                        </div>
                        <div>
                          <Label className="text-xs">Telefone / WhatsApp</Label>
                          <Input
                            value={form.phone}
                            onChange={(e) => { setForm(f => ({ ...f, phone: e.target.value })); setDirty(true); }}
                            placeholder="(11) 99999-9999"
                            className="mt-1"
                            disabled={isConverted}
                            data-testid="input-phone"
                          />
                        </div>
                        <div className="col-span-2">
                          <Label className="text-xs">E-mail</Label>
                          <Input
                            type="email"
                            value={form.email}
                            onChange={(e) => { setForm(f => ({ ...f, email: e.target.value })); setDirty(true); }}
                            placeholder="contato@empresa.com"
                            className="mt-1"
                            disabled={isConverted}
                            data-testid="input-email"
                          />
                        </div>
                      </div>
                    </CardContent>
                  </Card>

                  {/* Model + Billing */}
                  <Card>
                    <CardHeader className="pb-3">
                      <CardTitle className="text-sm flex items-center gap-2">
                        <Banknote className="w-4 h-4 text-primary" />
                        Modelo Comercial e Limites de Faturamento
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <div className="grid grid-cols-2 gap-4">
                        <div className="col-span-2">
                          <Label className="text-xs">Modelo de Contrato</Label>
                          <Select
                            value={form.modelType}
                            onValueChange={(v) => { setForm(f => ({ ...f, modelType: v })); setDirty(true); }}
                            disabled={isConverted}
                          >
                            <SelectTrigger className="mt-1" data-testid="select-model-type">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="a_definir">A Definir</SelectItem>
                              <SelectItem value="semanal">Semanal</SelectItem>
                              <SelectItem value="mensal">Mensal</SelectItem>
                              <SelectItem value="contratual">Contratual</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        <div>
                          <Label className="text-xs">Mínimo Semanal (R$)</Label>
                          <Input
                            type="number"
                            value={form.minWeeklyBilling}
                            onChange={(e) => { setForm(f => ({ ...f, minWeeklyBilling: e.target.value })); setDirty(true); }}
                            className="mt-1"
                            disabled={isConverted}
                            data-testid="input-min-weekly"
                          />
                        </div>
                        <div>
                          <Label className="text-xs">Mínimo Mensal (R$)</Label>
                          <Input
                            type="number"
                            value={form.minMonthlyBilling}
                            onChange={(e) => { setForm(f => ({ ...f, minMonthlyBilling: e.target.value })); setDirty(true); }}
                            className="mt-1"
                            disabled={isConverted}
                            data-testid="input-min-monthly"
                          />
                        </div>
                      </div>
                    </CardContent>
                  </Card>

                  {/* Route Config */}
                  <Card>
                    <CardHeader className="pb-3">
                      <CardTitle className="text-sm flex items-center gap-2">
                        <Route className="w-4 h-4 text-primary" />
                        Configuração de Rota
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <div className="grid grid-cols-3 gap-4">
                        <div className="col-span-3">
                          <Label className="text-xs">Rota de Entrega</Label>
                          <Select
                            value={form.route || "nenhuma"}
                            onValueChange={(v) => { setForm(f => ({ ...f, route: v === "nenhuma" ? "" : v })); setDirty(true); }}
                            disabled={isConverted}
                          >
                            <SelectTrigger className="mt-1" data-testid="select-route">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="nenhuma">Não definida</SelectItem>
                              <SelectItem value="manha">Rota Manhã</SelectItem>
                              <SelectItem value="tarde">Rota Tarde</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        <div>
                          <Label className="text-xs">Mínimo Rota Manhã (R$)</Label>
                          <Input
                            type="number"
                            value={form.routeMinManha}
                            onChange={(e) => { setForm(f => ({ ...f, routeMinManha: e.target.value })); setDirty(true); }}
                            className="mt-1"
                            disabled={isConverted}
                            data-testid="input-route-min-manha"
                          />
                        </div>
                        <div>
                          <Label className="text-xs">Mínimo Rota Tarde (R$)</Label>
                          <Input
                            type="number"
                            value={form.routeMinTarde}
                            onChange={(e) => { setForm(f => ({ ...f, routeMinTarde: e.target.value })); setDirty(true); }}
                            className="mt-1"
                            disabled={isConverted}
                            data-testid="input-route-min-tarde"
                          />
                        </div>
                      </div>
                    </CardContent>
                  </Card>

                  {/* Notes */}
                  <Card>
                    <CardHeader className="pb-3">
                      <CardTitle className="text-sm flex items-center gap-2">
                        <FileText className="w-4 h-4 text-primary" />
                        Observações Internas
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <Textarea
                        value={form.notes}
                        onChange={(e) => { setForm(f => ({ ...f, notes: e.target.value })); setDirty(true); }}
                        placeholder="Anotações sobre o prospect, histórico de contato, preferências..."
                        rows={4}
                        disabled={isConverted}
                        data-testid="textarea-notes"
                      />
                    </CardContent>
                  </Card>
                </TabsContent>

                {/* ── Tab: Escopo ───────────────────────────────────────── */}
                <TabsContent value="escopo" className="p-6 space-y-4 mt-0">
                  {!isConverted && (
                    <Card>
                      <CardHeader className="pb-3">
                        <CardTitle className="text-sm flex items-center gap-2">
                          <Plus className="w-4 h-4 text-primary" />
                          Adicionar Produto ao Escopo
                        </CardTitle>
                      </CardHeader>
                      <CardContent>
                        <div className="grid grid-cols-6 gap-3 items-end">
                          <div className="col-span-2">
                            <Label className="text-xs">Produto</Label>
                            <Select
                              value={newItem.productId ? String(newItem.productId) : ""}
                              onValueChange={(v) => selectProduct(Number(v))}
                            >
                              <SelectTrigger className="mt-1 h-8 text-xs" data-testid="select-product">
                                <SelectValue placeholder="Selecionar produto..." />
                              </SelectTrigger>
                              <SelectContent>
                                {activeProducts.map((p) => (
                                  <SelectItem key={p.id} value={String(p.id)} className="text-xs">
                                    {p.name} <span className="text-muted-foreground">({p.category})</span>
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                          <div>
                            <Label className="text-xs">Dia</Label>
                            <Select
                              value={newItem.dayOfWeek}
                              onValueChange={(v) => setNewItem(n => ({ ...n, dayOfWeek: v }))}
                            >
                              <SelectTrigger className="mt-1 h-8 text-xs" data-testid="select-day">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {DAYS.map((d) => <SelectItem key={d} value={d} className="text-xs">{d.split("-")[0]}</SelectItem>)}
                              </SelectContent>
                            </Select>
                          </div>
                          <div>
                            <Label className="text-xs">Qtd</Label>
                            <Input
                              type="number"
                              min={1}
                              value={newItem.quantity}
                              onChange={(e) => setNewItem(n => ({ ...n, quantity: Number(e.target.value) }))}
                              className="mt-1 h-8 text-xs"
                              data-testid="input-quantity"
                            />
                          </div>
                          <div>
                            <Label className="text-xs">Preço Unit. (R$)</Label>
                            <Input
                              type="number"
                              step="0.01"
                              min={0}
                              value={newItem.unitPrice}
                              onChange={(e) => setNewItem(n => ({ ...n, unitPrice: Number(e.target.value) }))}
                              className="mt-1 h-8 text-xs"
                              data-testid="input-unit-price"
                            />
                          </div>
                          <div>
                            <Button
                              type="button"
                              size="sm"
                              className="w-full h-8 text-xs mt-5"
                              onClick={addItem}
                              data-testid="button-add-item"
                            >
                              <Plus className="w-3 h-3 mr-1" />
                              Adicionar
                            </Button>
                          </div>
                        </div>
                        {/* Custo médio field */}
                        {newItem.productId > 0 && (
                          <div className="mt-3 grid grid-cols-6 gap-3">
                            <div className="col-span-2">
                              <Label className="text-xs">Frequência</Label>
                              <Select
                                value={String(newItem.frequency)}
                                onValueChange={(v) => setNewItem(n => ({ ...n, frequency: Number(v) }))}
                              >
                                <SelectTrigger className="mt-1 h-8 text-xs">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="1" className="text-xs">Toda semana (1x/sem)</SelectItem>
                                  <SelectItem value="0.5" className="text-xs">Quinzenal (0,5x/sem)</SelectItem>
                                  <SelectItem value="2" className="text-xs">2x por semana</SelectItem>
                                  <SelectItem value="3" className="text-xs">3x por semana</SelectItem>
                                </SelectContent>
                              </Select>
                            </div>
                            <div>
                              <Label className="text-xs">Custo Médio (R$)</Label>
                              <Input
                                type="number"
                                step="0.01"
                                min={0}
                                value={newItem.avgCost}
                                onChange={(e) => setNewItem(n => ({ ...n, avgCost: Number(e.target.value) }))}
                                className="mt-1 h-8 text-xs"
                                data-testid="input-avg-cost"
                              />
                            </div>
                            <div className="flex items-end pb-0">
                              <div className="text-xs text-muted-foreground">
                                <span className="font-medium text-foreground">{fmt(newItem.quantity * newItem.unitPrice * newItem.frequency)}</span>
                                <span> /sem</span>
                              </div>
                            </div>
                          </div>
                        )}
                      </CardContent>
                    </Card>
                  )}

                  {/* Items by day */}
                  {items.length === 0 ? (
                    <div className="text-center py-12 text-muted-foreground">
                      <Package className="w-12 h-12 mx-auto mb-3 opacity-20" />
                      <p className="text-sm">Nenhum produto no escopo</p>
                      <p className="text-xs mt-1">Adicione produtos usando o formulário acima</p>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {DAYS.filter(d => itemsByDay[d]?.length > 0).map((day) => {
                        const dayItems = itemsByDay[day] || [];
                        const dayTotal = dayItems.reduce((a, i) => a + i.weeklyValue, 0);
                        return (
                          <Card key={day}>
                            <CardHeader className="py-2 px-4">
                              <div className="flex items-center justify-between">
                                <CardTitle className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                                  {day}
                                </CardTitle>
                                <span className="text-xs font-medium text-primary">{fmt(dayTotal)}/sem</span>
                              </div>
                            </CardHeader>
                            <CardContent className="p-0">
                              <div className="divide-y">
                                {dayItems.map((item) => (
                                  <div key={item._key} className="flex items-center gap-3 px-4 py-2">
                                    <div className="flex-1 min-w-0">
                                      <p className="text-xs font-medium truncate">{item.productName}</p>
                                      <p className="text-[10px] text-muted-foreground">{item.category} · {item.unit}</p>
                                    </div>
                                    <div className="flex items-center gap-2 flex-shrink-0">
                                      <div className="flex items-center gap-1">
                                        <Input
                                          type="number"
                                          min={1}
                                          value={item.quantity}
                                          onChange={(e) => updateItem(item._key, "quantity", Number(e.target.value))}
                                          className="w-16 h-6 text-xs text-center"
                                          disabled={isConverted}
                                        />
                                        <span className="text-[10px] text-muted-foreground">{item.unit}</span>
                                      </div>
                                      <div className="flex items-center gap-1">
                                        <span className="text-[10px] text-muted-foreground">R$</span>
                                        <Input
                                          type="number"
                                          step="0.01"
                                          min={0}
                                          value={item.unitPrice}
                                          onChange={(e) => updateItem(item._key, "unitPrice", Number(e.target.value))}
                                          className="w-20 h-6 text-xs"
                                          disabled={isConverted}
                                        />
                                      </div>
                                      <span className="text-xs font-medium text-primary w-20 text-right">
                                        {fmt(item.weeklyValue)}
                                      </span>
                                      {!isConverted && (
                                        <button
                                          type="button"
                                          onClick={() => removeItem(item._key)}
                                          className="text-red-400 hover:text-red-600"
                                          data-testid={`button-remove-item-${item._key}`}
                                        >
                                          <X className="w-3.5 h-3.5" />
                                        </button>
                                      )}
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </CardContent>
                          </Card>
                        );
                      })}

                      {/* Totals row */}
                      <div className="flex items-center justify-between p-4 bg-muted/50 rounded-xl border">
                        <span className="text-sm font-semibold">Total do Escopo</span>
                        <div className="flex items-center gap-6 text-sm">
                          <div className="text-right">
                            <p className="text-xs text-muted-foreground">Semanal</p>
                            <p className="font-bold text-primary" data-testid="text-total-weekly">{fmt(totalWeekly)}</p>
                          </div>
                          <div className="text-right">
                            <p className="text-xs text-muted-foreground">Mensal</p>
                            <p className="font-bold" data-testintimidated="text-total-monthly">{fmt(totalMonthly)}</p>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                </TabsContent>

                {/* ── Tab: Análise ──────────────────────────────────────── */}
                <TabsContent value="analise" className="p-6 space-y-4 mt-0">
                  {/* KPI Cards */}
                  <div className="grid grid-cols-4 gap-3">
                    <Card className="p-4">
                      <p className="text-xs text-muted-foreground mb-1">Faturamento Semanal</p>
                      <p className="text-xl font-bold text-primary" data-testid="kpi-weekly">{fmt(totalWeekly)}</p>
                    </Card>
                    <Card className="p-4">
                      <p className="text-xs text-muted-foreground mb-1">Faturamento Mensal</p>
                      <p className="text-xl font-bold" data-testid="kpi-monthly">{fmt(totalMonthly)}</p>
                    </Card>
                    <Card className="p-4">
                      <p className="text-xs text-muted-foreground mb-1">Margem Bruta</p>
                      <p className={`text-xl font-bold ${marginPct >= 30 ? "text-green-600" : marginPct >= 20 ? "text-yellow-600" : "text-red-600"}`} data-testid="kpi-margin">
                        {totalCost > 0 ? pct(grossMargin, totalWeekly) : "—"}
                      </p>
                    </Card>
                    <Card className="p-4">
                      <p className="text-xs text-muted-foreground mb-1">Classificação</p>
                      <p className={`text-xl font-bold ${classification.color}`} data-testid="kpi-classification">
                        {classification.label}
                      </p>
                      <p className="text-[10px] text-muted-foreground mt-0.5">{classification.description}</p>
                    </Card>
                  </div>

                  {/* Validations */}
                  <Card>
                    <CardHeader className="pb-3">
                      <CardTitle className="text-sm flex items-center gap-2">
                        <CheckCircle2 className="w-4 h-4 text-primary" />
                        Validações Comerciais
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      <ValidationRow
                        ok={meetsWeekly}
                        label="Mínimo semanal"
                        current={fmt(totalWeekly)}
                        required={fmt(minWeekly)}
                      />
                      <ValidationRow
                        ok={meetsMonthly}
                        label="Mínimo mensal"
                        current={fmt(totalMonthly)}
                        required={fmt(minMonthly)}
                      />
                      {routeMin !== null && (
                        <ValidationRow
                          ok={meetsRoute}
                          label={`Mínimo rota ${form.route === "manha" ? "manhã" : "tarde"}`}
                          current={fmt(totalWeekly)}
                          required={fmt(routeMin)}
                        />
                      )}
                      {items.length === 0 && (
                        <div className="flex items-center gap-2 text-yellow-600 text-xs">
                          <AlertTriangle className="w-4 h-4 flex-shrink-0" />
                          <span>Escopo vazio — adicione produtos na aba "Escopo"</span>
                        </div>
                      )}
                    </CardContent>
                  </Card>

                  {/* Margin detail */}
                  {totalCost > 0 && (
                    <Card>
                      <CardHeader className="pb-3">
                        <CardTitle className="text-sm flex items-center gap-2">
                          <TrendingUp className="w-4 h-4 text-primary" />
                          Simulação de Margem (semanal)
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="space-y-2">
                        <div className="flex justify-between text-sm">
                          <span className="text-muted-foreground">Receita bruta</span>
                          <span className="font-medium">{fmt(totalWeekly)}</span>
                        </div>
                        <div className="flex justify-between text-sm">
                          <span className="text-muted-foreground">Custo total (CMV)</span>
                          <span className="font-medium text-red-600">- {fmt(totalCost)}</span>
                        </div>
                        <Separator />
                        <div className="flex justify-between text-sm font-semibold">
                          <span>Margem bruta</span>
                          <span className={grossMargin >= 0 ? "text-green-600" : "text-red-600"}>
                            {fmt(grossMargin)} ({pct(grossMargin, totalWeekly)})
                          </span>
                        </div>
                        {/* Margin bar */}
                        <div className="mt-2">
                          <div className="flex justify-between text-[10px] text-muted-foreground mb-1">
                            <span>Margem: {pct(grossMargin, totalWeekly)}</span>
                            <span>{marginPct >= 30 ? "✅ Ótima" : marginPct >= 20 ? "⚠️ Aceitável" : "❌ Baixa"}</span>
                          </div>
                          <div className="h-2 bg-muted rounded-full overflow-hidden">
                            <div
                              className={`h-full rounded-full transition-all ${marginPct >= 30 ? "bg-green-500" : marginPct >= 20 ? "bg-yellow-500" : "bg-red-500"}`}
                              style={{ width: `${Math.min(100, Math.max(0, marginPct))}%` }}
                            />
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  )}

                  {/* Breakdown by category */}
                  {items.length > 0 && (
                    <Card>
                      <CardHeader className="pb-3">
                        <CardTitle className="text-sm flex items-center gap-2">
                          <BarChart3 className="w-4 h-4 text-primary" />
                          Mix por Categoria
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="space-y-2">
                        {Object.entries(
                          items.reduce((acc: Record<string, number>, it) => {
                            acc[it.category] = (acc[it.category] || 0) + it.weeklyValue;
                            return acc;
                          }, {})
                        )
                          .sort((a, b) => b[1] - a[1])
                          .map(([cat, val]) => (
                            <div key={cat}>
                              <div className="flex justify-between text-xs mb-1">
                                <span>{cat}</span>
                                <span className="font-medium">{fmt(val)} ({pct(val, totalWeekly)})</span>
                              </div>
                              <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                                <div
                                  className="h-full bg-primary rounded-full"
                                  style={{ width: `${(val / totalWeekly) * 100}%` }}
                                />
                              </div>
                            </div>
                          ))}
                      </CardContent>
                    </Card>
                  )}

                  {/* Summary for prospect */}
                  {items.length > 0 && (
                    <Card className="border-primary/20 bg-primary/5">
                      <CardHeader className="pb-3">
                        <CardTitle className="text-sm flex items-center gap-2">
                          <ArrowUpRight className="w-4 h-4 text-primary" />
                          Resumo para Apresentação
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="text-sm space-y-1">
                        <p>• Empresa: <strong>{form.companyName || "—"}</strong> — {form.city || "localização não informada"}</p>
                        <p>• Modelo: <strong>{MODEL_LABELS[form.modelType]}</strong></p>
                        <p>• Escopo: <strong>{items.length} produtos</strong> em <strong>{Object.keys(itemsByDay).length} dias/semana</strong></p>
                        <p>• Faturamento estimado: <strong>{fmt(totalWeekly)}/sem</strong> → <strong>{fmt(totalMonthly)}/mês</strong></p>
                        <p>• Classificação: <strong className={classification.color}>{classification.label}</strong></p>
                        {totalCost > 0 && <p>• Margem bruta: <strong>{pct(grossMargin, totalWeekly)}</strong></p>}
                        {!meetsWeekly && <p className="text-yellow-600">⚠️ Abaixo do mínimo semanal de {fmt(minWeekly)}</p>}
                      </CardContent>
                    </Card>
                  )}
                </TabsContent>
              </ScrollArea>
            </Tabs>
          </>
        )}
      </div>

      {/* ─── Convert Dialog ───────────────────────────────────────────── */}
      {showConvert && currentSim && (
        <ConvertDialog
          simulation={currentSim}
          onClose={() => setShowConvert(false)}
          onConverted={() => {
            setShowConvert(false);
            queryClient.invalidateQueries({ queryKey: ["/api/scope-simulations"] });
            toast({ title: "Empresa criada com sucesso!", description: `${currentSim.companyName} foi cadastrada como cliente.` });
          }}
        />
      )}
    </div>
  );
}

// ─── Validation Row Component ─────────────────────────────────────────────────
function ValidationRow({ ok, label, current, required }: { ok: boolean; label: string; current: string; required: string }) {
  return (
    <div className="flex items-center justify-between text-xs">
      <div className="flex items-center gap-2">
        {ok ? <CheckCircle2 className="w-4 h-4 text-green-500" /> : <XCircle className="w-4 h-4 text-red-500" />}
        <span className={ok ? "text-foreground" : "text-red-600"}>{label}</span>
      </div>
      <span className="text-muted-foreground">
        <span className={ok ? "text-green-600 font-medium" : "text-red-600 font-medium"}>{current}</span>
        {" / mín. "}{required}
      </span>
    </div>
  );
}

// ─── Convert Dialog Component ─────────────────────────────────────────────────
function ConvertDialog({
  simulation,
  onClose,
  onConverted,
}: {
  simulation: Simulation;
  onClose: () => void;
  onConverted: () => void;
}) {
  const { toast } = useToast();
  const [password, setPassword] = useState("");
  const [segment, setSegment] = useState("empresarial");
  const [adminFee, setAdminFee] = useState("0");
  const [deliveryDay, setDeliveryDay] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleConvert() {
    if (!password || password.length < 6) {
      return toast({ title: "Senha deve ter ao menos 6 caracteres", variant: "destructive" });
    }
    setLoading(true);
    try {
      const res = await apiRequest("POST", `/api/scope-simulations/${simulation.id}/convert`, {
        password,
        segment,
        adminFee: parseFloat(adminFee),
        deliveryDay: deliveryDay || null,
        cnpj: simulation.cnpj,
        email: simulation.email,
        phone: simulation.phone,
        city: simulation.city,
        contactName: simulation.contactName,
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message);
      }
      onConverted();
    } catch (e: any) {
      toast({ title: "Erro ao converter", description: e.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-md" data-testid="dialog-convert">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <UserCheck className="w-5 h-5 text-green-600" />
            Converter em Cliente
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="p-3 bg-muted/50 rounded-lg text-sm">
            <p className="font-medium">{simulation.companyName}</p>
            <p className="text-muted-foreground text-xs mt-1">
              {simulation.city} · Escopo: {((simulation.items as any[]) || []).length} produtos
            </p>
          </div>

          <div>
            <Label className="text-xs">Senha de Acesso *</Label>
            <Input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Mínimo 6 caracteres"
              className="mt-1"
              data-testid="input-convert-password"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Segmento</Label>
              <Select value={segment} onValueChange={setSegment}>
                <SelectTrigger className="mt-1 text-xs" data-testid="select-convert-segment">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="empresarial">Empresarial</SelectItem>
                  <SelectItem value="hortifruti">Hortifruti</SelectItem>
                  <SelectItem value="restaurante">Restaurante</SelectItem>
                  <SelectItem value="supermercado">Supermercado</SelectItem>
                  <SelectItem value="outros">Outros</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Taxa Admin (%)</Label>
              <Input
                type="number"
                min={0}
                max={100}
                step={0.1}
                value={adminFee}
                onChange={(e) => setAdminFee(e.target.value)}
                className="mt-1"
                data-testid="input-convert-admin-fee"
              />
            </div>
          </div>

          <div>
            <Label className="text-xs">Dia de Entrega</Label>
            <Select value={deliveryDay || "nenhum"} onValueChange={(v) => setDeliveryDay(v === "nenhum" ? "" : v)}>
              <SelectTrigger className="mt-1 text-xs" data-testid="select-convert-delivery-day">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="nenhum">Não definido</SelectItem>
                {DAYS.map((d) => <SelectItem key={d} value={d} className="text-xs">{d}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          <div className="text-xs text-muted-foreground bg-blue-50 dark:bg-blue-900/20 p-3 rounded-lg space-y-1">
            <p className="font-medium text-blue-700 dark:text-blue-300">Isso irá:</p>
            <p>✓ Criar um perfil de empresa no sistema</p>
            <p>✓ Importar os itens do escopo como Contrato</p>
            <p>✓ Disponibilizar acesso ao cliente</p>
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose} data-testid="button-cancel-convert">
            Cancelar
          </Button>
          <Button
            type="button"
            onClick={handleConvert}
            disabled={loading || !password}
            className="bg-green-600 hover:bg-green-700"
            data-testid="button-confirm-convert"
          >
            {loading ? <RefreshCw className="w-4 h-4 mr-2 animate-spin" /> : <UserCheck className="w-4 h-4 mr-2" />}
            Converter
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
