import { useState, useRef } from "react";
import { FiscalInvoiceOCR } from "@/components/FiscalInvoiceOCR";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Warehouse, Plus, Trash2, AlertTriangle, TrendingUp, TrendingDown,
  CheckCircle2, Package, ArrowUpCircle, ArrowDownCircle, RefreshCw,
  Filter, Download, Pencil, ClipboardCheck, FileText, ChevronRight
} from "lucide-react";
import type { InventorySettings, InventoryEntry, InventoryMovement, InventoryPhysicalCount } from "@shared/schema";

const UNITS = ["kg", "g", "un", "cx", "sc", "lt", "pote", "display", "bandeja", "fardo", "saco"];
const CATEGORIES = ["Frutas", "Hortifruti / Verduras", "Industrializados", "Outros"];

function today() { return new Date().toISOString().split("T")[0]; }
function fmtDate(d: string | null) {
  if (!d) return "—";
  const [y, m, day] = d.split("-");
  return `${day}/${m}/${y}`;
}
function fmtNum(n: string | number | null) {
  if (n == null || n === "") return "0";
  return parseFloat(String(n)).toLocaleString("pt-BR", { maximumFractionDigits: 3 });
}
function fmtCurrency(n: string | number | null) {
  if (n == null || n === "" || n === "0" || n === "0.00") return "—";
  return `R$ ${parseFloat(String(n)).toFixed(2).replace(".", ",")}`;
}

function stockStatus(setting: InventorySettings): { label: string; color: string; icon: typeof CheckCircle2 } {
  const cur = parseFloat(setting.currentStock || "0");
  const min = parseFloat(setting.minStock || "0");
  if (min === 0) return { label: "OK", color: "bg-green-100 text-green-700 border-green-200", icon: CheckCircle2 };
  if (cur <= 0) return { label: "Comprar", color: "bg-red-100 text-red-700 border-red-200", icon: AlertTriangle };
  if (cur <= min) return { label: "Baixo Estoque", color: "bg-yellow-100 text-yellow-700 border-yellow-200", icon: AlertTriangle };
  return { label: "OK", color: "bg-green-100 text-green-700 border-green-200", icon: CheckCircle2 };
}

function movementColor(type: string) {
  switch (type) {
    case "ENTRY": return "text-green-700 bg-green-50 border-green-200";
    case "EXIT": return "text-red-700 bg-red-50 border-red-200";
    case "ADJUSTMENT": return "text-blue-700 bg-blue-50 border-blue-200";
    case "WASTE": return "text-orange-700 bg-orange-50 border-orange-200";
    default: return "text-gray-700 bg-gray-50 border-gray-200";
  }
}
function movementLabel(type: string) {
  switch (type) {
    case "ENTRY": return "Entrada";
    case "EXIT": return "Saída";
    case "ADJUSTMENT": return "Ajuste";
    case "WASTE": return "Desperdício";
    default: return type;
  }
}

export default function InventoryPage() {
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState("panel");

  // ─── Painel State ─────────────────────────────────────────────
  const [searchPanel, setSearchPanel] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [editMinStockId, setEditMinStockId] = useState<number | null>(null);
  const [editMinStockValue, setEditMinStockValue] = useState("");
  const [addProductOpen, setAddProductOpen] = useState(false);
  const [addProductForm, setAddProductForm] = useState({ productName: "", unit: "kg", minStock: "", category: "" });

  // ─── Entry State ──────────────────────────────────────────────
  const [entryOpen, setEntryOpen] = useState(false);
  const [entryForm, setEntryForm] = useState({
    productName: "", category: "", supplier: "", quantity: "", unit: "kg",
    purchasePrice: "", invoiceNumber: "", invoiceDate: "", entryDate: today(),
    expiryDate: "", notes: ""
  });

  // ─── Movements State ──────────────────────────────────────────
  const [movFilter, setMovFilter] = useState({ from: "", to: "", type: "all" });

  // ─── Physical Count State ─────────────────────────────────────
  const [countOpen, setCountOpen] = useState(false);
  const [countForm, setCountForm] = useState({ productName: "", unit: "kg", physicalStock: "", notes: "", date: today() });

  // ─── Queries ──────────────────────────────────────────────────
  const { data: settings = [], isLoading: loadingSettings } = useQuery<InventorySettings[]>({
    queryKey: ["/api/inventory/settings"],
  });

  const { data: entries = [], isLoading: loadingEntries } = useQuery<InventoryEntry[]>({
    queryKey: ["/api/inventory/entries"],
  });

  const { data: movements = [], isLoading: loadingMovements } = useQuery<InventoryMovement[]>({
    queryKey: ["/api/inventory/movements"],
  });

  const { data: counts = [] } = useQuery<InventoryPhysicalCount[]>({
    queryKey: ["/api/inventory/physical-counts"],
  });

  // ─── Mutations ────────────────────────────────────────────────
  const updateMinStock = useMutation({
    mutationFn: ({ id, minStock }: { id: number; minStock: number }) =>
      apiRequest("PUT", `/api/inventory/settings/${id}`, { minStock }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/inventory/settings"] });
      setEditMinStockId(null);
      toast({ title: "Estoque mínimo atualizado!" });
    },
  });

  const addProductMutation = useMutation({
    mutationFn: (data: any) => apiRequest("POST", "/api/inventory/settings", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/inventory/settings"] });
      setAddProductOpen(false);
      setAddProductForm({ productName: "", unit: "kg", minStock: "", category: "" });
      toast({ title: "Produto adicionado ao inventário!" });
    },
  });

  const createEntry = useMutation({
    mutationFn: (data: any) => apiRequest("POST", "/api/inventory/entries", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/inventory/settings"] });
      queryClient.invalidateQueries({ queryKey: ["/api/inventory/entries"] });
      queryClient.invalidateQueries({ queryKey: ["/api/inventory/movements"] });
      setEntryOpen(false);
      setEntryForm({ productName: "", category: "", supplier: "", quantity: "", unit: "kg", purchasePrice: "", invoiceNumber: "", invoiceDate: "", entryDate: today(), expiryDate: "", notes: "" });
      toast({ title: "Entrada registrada com sucesso!", description: "Estoque atualizado automaticamente." });
    },
    onError: (e: any) => toast({ title: "Erro ao registrar entrada", description: e?.message, variant: "destructive" }),
  });

  const deleteEntry = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/inventory/entries/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/inventory/entries"] });
      toast({ title: "Entrada removida." });
    },
  });

  const createCount = useMutation({
    mutationFn: (data: any) => apiRequest("POST", "/api/inventory/physical-counts", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/inventory/settings"] });
      queryClient.invalidateQueries({ queryKey: ["/api/inventory/movements"] });
      queryClient.invalidateQueries({ queryKey: ["/api/inventory/physical-counts"] });
      setCountOpen(false);
      setCountForm({ productName: "", unit: "kg", physicalStock: "", notes: "", date: today() });
      toast({ title: "Contagem registrada!", description: "Estoque ajustado automaticamente." });
    },
    onError: (e: any) => toast({ title: "Erro", description: e?.message, variant: "destructive" }),
  });

  // ─── Derived Data ─────────────────────────────────────────────
  const lowStockCount = settings.filter(s => {
    const st = stockStatus(s);
    return st.label !== "OK";
  }).length;

  const expiryAlerts = entries.filter(e => {
    if (!e.expiryDate) return false;
    const diff = (new Date(e.expiryDate).getTime() - Date.now()) / 86400000;
    return diff >= 0 && diff <= 7;
  });

  const filteredSettings = settings.filter(s => {
    const matchSearch = !searchPanel || s.productName.toLowerCase().includes(searchPanel.toLowerCase());
    const st = stockStatus(s);
    const matchStatus = statusFilter === "all" ||
      (statusFilter === "ok" && st.label === "OK") ||
      (statusFilter === "low" && st.label === "Baixo Estoque") ||
      (statusFilter === "buy" && st.label === "Comprar");
    return matchSearch && matchStatus;
  });

  const filteredMovements = movements.filter(m => {
    const matchType = movFilter.type === "all" || m.movementType === movFilter.type;
    const matchFrom = !movFilter.from || m.date >= movFilter.from;
    const matchTo = !movFilter.to || m.date <= movFilter.to;
    return matchType && matchFrom && matchTo;
  });

  // Export to CSV
  function exportCSV() {
    const header = "Produto,Categoria,Estoque Atual,Estoque Mínimo,Unidade,Preço Médio,Status\n";
    const rows = settings.map(s => {
      const st = stockStatus(s);
      return `"${s.productName}","${s.category || ""}","${fmtNum(s.currentStock)}","${fmtNum(s.minStock)}","${s.unit}","${s.avgPurchasePrice || ""}","${st.label}"`;
    }).join("\n");
    const blob = new Blob(["\uFEFF" + header + rows], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `estoque-${today()}.csv`; a.click();
    URL.revokeObjectURL(url);
  }

  function exportMovCSV() {
    const header = "Data,Produto,Tipo,Quantidade,Saldo Após,Referência,Observações\n";
    const rows = filteredMovements.map(m =>
      `"${fmtDate(m.date)}","${m.productName}","${movementLabel(m.movementType)}","${fmtNum(m.quantity)} ${m.unit}","${m.balanceAfter ? fmtNum(m.balanceAfter) : ""}","${m.referenceType || ""} ${m.referenceId || ""}","${m.notes || ""}"`
    ).join("\n");
    const blob = new Blob(["\uFEFF" + header + rows], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `movimentacoes-${today()}.csv`; a.click();
    URL.revokeObjectURL(url);
  }

  // Matching product in inventory for physical count autocomplete
  const countMatchedSetting = settings.find(s => s.productName === countForm.productName);

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center gap-4 justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
            <Warehouse className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-foreground">Estoque / Inventário</h1>
            <p className="text-sm text-muted-foreground">Controle de entrada, saída e movimentações de estoque</p>
          </div>
        </div>
        <div className="flex gap-2 flex-wrap">
          {lowStockCount > 0 && (
            <Badge className="bg-yellow-100 text-yellow-800 border-yellow-200 border gap-1 px-3 py-1">
              <AlertTriangle className="w-3.5 h-3.5" />
              {lowStockCount} produto{lowStockCount > 1 ? "s" : ""} abaixo do mínimo
            </Badge>
          )}
          {expiryAlerts.length > 0 && (
            <Badge className="bg-red-100 text-red-800 border-red-200 border gap-1 px-3 py-1">
              <AlertTriangle className="w-3.5 h-3.5" />
              {expiryAlerts.length} perto do vencimento
            </Badge>
          )}
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="grid grid-cols-5 w-full max-w-2xl">
          <TabsTrigger value="panel" data-testid="tab-panel">Painel</TabsTrigger>
          <TabsTrigger value="entries" data-testid="tab-entries">Entradas</TabsTrigger>
          <TabsTrigger value="movements" data-testid="tab-movements">Movimentações</TabsTrigger>
          <TabsTrigger value="physical" data-testid="tab-physical">Inventário Físico</TabsTrigger>
          <TabsTrigger value="invoices" data-testid="tab-invoices">Notas Fiscais</TabsTrigger>
        </TabsList>

        {/* ─── PAINEL DE ESTOQUE ─────────────────────────────────── */}
        <TabsContent value="panel" className="space-y-4 mt-4">
          {/* Summary Cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Card className="rounded-xl">
              <CardContent className="p-4">
                <p className="text-xs text-muted-foreground mb-1">Total de Produtos</p>
                <p className="text-2xl font-bold text-foreground">{settings.length}</p>
              </CardContent>
            </Card>
            <Card className="rounded-xl">
              <CardContent className="p-4">
                <p className="text-xs text-muted-foreground mb-1">OK</p>
                <p className="text-2xl font-bold text-green-600">{settings.filter(s => stockStatus(s).label === "OK").length}</p>
              </CardContent>
            </Card>
            <Card className="rounded-xl">
              <CardContent className="p-4">
                <p className="text-xs text-muted-foreground mb-1">Baixo Estoque</p>
                <p className="text-2xl font-bold text-yellow-600">{settings.filter(s => stockStatus(s).label === "Baixo Estoque").length}</p>
              </CardContent>
            </Card>
            <Card className="rounded-xl">
              <CardContent className="p-4">
                <p className="text-xs text-muted-foreground mb-1">Comprar Urgente</p>
                <p className="text-2xl font-bold text-red-600">{settings.filter(s => stockStatus(s).label === "Comprar").length}</p>
              </CardContent>
            </Card>
          </div>

          {/* Filters + Actions */}
          <div className="flex flex-col md:flex-row gap-3 items-start md:items-center justify-between">
            <div className="flex gap-2 flex-wrap items-center">
              <Input
                placeholder="Buscar produto..."
                value={searchPanel}
                onChange={e => setSearchPanel(e.target.value)}
                className="w-48"
                data-testid="input-search-panel"
              />
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-40" data-testid="select-status-filter">
                  <SelectValue placeholder="Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos os Status</SelectItem>
                  <SelectItem value="ok">OK</SelectItem>
                  <SelectItem value="low">Baixo Estoque</SelectItem>
                  <SelectItem value="buy">Comprar</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={exportCSV} data-testid="button-export-csv">
                <Download className="w-4 h-4 mr-1" /> Exportar CSV
              </Button>
              <Button size="sm" onClick={() => setAddProductOpen(true)} data-testid="button-add-product">
                <Plus className="w-4 h-4 mr-1" /> Adicionar Produto
              </Button>
            </div>
          </div>

          {/* Table */}
          {loadingSettings ? (
            <div className="text-center py-12 text-muted-foreground">Carregando...</div>
          ) : filteredSettings.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <Warehouse className="w-8 h-8 mx-auto mb-3 opacity-40" />
              <p>Nenhum produto no inventário.</p>
              <p className="text-sm mt-1">Adicione produtos ou registre uma entrada para começar.</p>
            </div>
          ) : (
            <div className="rounded-xl border overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/40">
                    <TableHead>Produto</TableHead>
                    <TableHead>Categoria</TableHead>
                    <TableHead className="text-right">Estoque Atual</TableHead>
                    <TableHead className="text-right">Estoque Mínimo</TableHead>
                    <TableHead className="text-right">Preço Médio</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="w-12"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredSettings.map(s => {
                    const st = stockStatus(s);
                    const isEditing = editMinStockId === s.id;
                    return (
                      <TableRow key={s.id} className="hover:bg-muted/20" data-testid={`row-inventory-${s.id}`}>
                        <TableCell className="font-medium">{s.productName}</TableCell>
                        <TableCell className="text-muted-foreground text-sm">{s.category || "—"}</TableCell>
                        <TableCell className="text-right font-semibold">{fmtNum(s.currentStock)} {s.unit}</TableCell>
                        <TableCell className="text-right">
                          {isEditing ? (
                            <div className="flex items-center justify-end gap-1">
                              <Input
                                type="number" min="0" step="0.1"
                                value={editMinStockValue}
                                onChange={e => setEditMinStockValue(e.target.value)}
                                className="w-24 h-7 text-sm"
                                autoFocus
                                data-testid="input-min-stock"
                              />
                              <Button size="sm" className="h-7 px-2 text-xs" onClick={() => updateMinStock.mutate({ id: s.id, minStock: parseFloat(editMinStockValue) })} data-testid="button-save-min-stock">
                                OK
                              </Button>
                            </div>
                          ) : (
                            <span
                              className="cursor-pointer hover:text-primary flex items-center justify-end gap-1"
                              onClick={() => { setEditMinStockId(s.id); setEditMinStockValue(s.minStock || "0"); }}
                              data-testid={`text-min-stock-${s.id}`}
                            >
                              {fmtNum(s.minStock)} {s.unit}
                              <Pencil className="w-3 h-3 opacity-40" />
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="text-right text-sm text-muted-foreground">{fmtCurrency(s.avgPurchasePrice)}</TableCell>
                        <TableCell>
                          <Badge className={`text-xs border ${st.color}`}>{st.label}</Badge>
                        </TableCell>
                        <TableCell>
                          <Button
                            variant="ghost" size="icon" className="h-7 w-7"
                            onClick={() => { setEntryForm(f => ({ ...f, productName: s.productName, unit: s.unit, category: s.category || "" })); setEntryOpen(true); setActiveTab("entries"); }}
                            title="Registrar entrada"
                            data-testid={`button-quick-entry-${s.id}`}
                          >
                            <ArrowUpCircle className="w-4 h-4 text-green-600" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}

          {/* Expiry Alerts */}
          {expiryAlerts.length > 0 && (
            <Card className="rounded-xl border-orange-200 bg-orange-50">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold text-orange-800 flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4" />
                  Alertas de Validade (próximos 7 dias)
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {expiryAlerts.map(e => {
                  const diff = Math.ceil((new Date(e.expiryDate!).getTime() - Date.now()) / 86400000);
                  return (
                    <div key={e.id} className="flex items-center justify-between text-sm text-orange-800">
                      <span className="font-medium">{e.productName}</span>
                      <span>{fmtNum(e.quantity)} {e.unit} — Vence em {diff === 0 ? "hoje" : `${diff} dia${diff > 1 ? "s" : ""}`} ({fmtDate(e.expiryDate)})</span>
                    </div>
                  );
                })}
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* ─── ENTRADAS DE ESTOQUE ───────────────────────────────── */}
        <TabsContent value="entries" className="space-y-4 mt-4">
          <div className="flex justify-between items-center">
            <div>
              <h2 className="text-base font-semibold">Entradas de Estoque</h2>
              <p className="text-sm text-muted-foreground">Registro manual ou por nota fiscal</p>
            </div>
            <Button onClick={() => setEntryOpen(true)} data-testid="button-new-entry">
              <Plus className="w-4 h-4 mr-1" /> Nova Entrada
            </Button>
          </div>

          {loadingEntries ? (
            <div className="text-center py-8 text-muted-foreground">Carregando...</div>
          ) : entries.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <ArrowUpCircle className="w-8 h-8 mx-auto mb-3 opacity-40" />
              <p>Nenhuma entrada registrada ainda.</p>
            </div>
          ) : (
            <div className="rounded-xl border overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/40">
                    <TableHead>Data</TableHead>
                    <TableHead>Produto</TableHead>
                    <TableHead>Fornecedor</TableHead>
                    <TableHead className="text-right">Qtd</TableHead>
                    <TableHead className="text-right">Valor Unit.</TableHead>
                    <TableHead>Nota Fiscal</TableHead>
                    <TableHead>Validade</TableHead>
                    <TableHead className="w-10"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {entries.map(e => {
                    const diff = e.expiryDate ? Math.ceil((new Date(e.expiryDate).getTime() - Date.now()) / 86400000) : null;
                    const expiryWarn = diff !== null && diff <= 7;
                    return (
                      <TableRow key={e.id} className={`hover:bg-muted/20 ${expiryWarn ? "bg-orange-50" : ""}`} data-testid={`row-entry-${e.id}`}>
                        <TableCell className="text-sm">{fmtDate(e.entryDate)}</TableCell>
                        <TableCell className="font-medium">{e.productName}</TableCell>
                        <TableCell className="text-muted-foreground text-sm">{e.supplier || "—"}</TableCell>
                        <TableCell className="text-right font-semibold">{fmtNum(e.quantity)} {e.unit}</TableCell>
                        <TableCell className="text-right text-sm">{fmtCurrency(e.purchasePrice)}</TableCell>
                        <TableCell className="text-sm">{e.invoiceNumber ? `NF ${e.invoiceNumber}` : "—"}</TableCell>
                        <TableCell className={`text-sm ${expiryWarn ? "text-orange-700 font-semibold" : "text-muted-foreground"}`}>
                          {e.expiryDate ? fmtDate(e.expiryDate) : "—"}
                          {expiryWarn && " ⚠"}
                        </TableCell>
                        <TableCell>
                          <Button
                            variant="ghost" size="icon" className="h-7 w-7"
                            onClick={() => { if (confirm("Remover esta entrada?")) deleteEntry.mutate(e.id); }}
                            data-testid={`button-delete-entry-${e.id}`}
                          >
                            <Trash2 className="w-4 h-4 text-red-500" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </TabsContent>

        {/* ─── MOVIMENTAÇÕES ─────────────────────────────────────── */}
        <TabsContent value="movements" className="space-y-4 mt-4">
          <div className="flex flex-col md:flex-row gap-3 items-start md:items-center justify-between">
            <div>
              <h2 className="text-base font-semibold">Histórico de Movimentações</h2>
              <p className="text-sm text-muted-foreground">Entradas, saídas, ajustes e desperdícios</p>
            </div>
            <Button variant="outline" size="sm" onClick={exportMovCSV} data-testid="button-export-movements">
              <Download className="w-4 h-4 mr-1" /> Exportar CSV
            </Button>
          </div>

          {/* Filters */}
          <div className="flex gap-3 flex-wrap items-center">
            <div className="flex items-center gap-1">
              <Label className="text-xs text-muted-foreground">De:</Label>
              <Input type="date" value={movFilter.from} onChange={e => setMovFilter(f => ({ ...f, from: e.target.value }))} className="h-8 w-36 text-sm" data-testid="input-mov-from" />
            </div>
            <div className="flex items-center gap-1">
              <Label className="text-xs text-muted-foreground">Até:</Label>
              <Input type="date" value={movFilter.to} onChange={e => setMovFilter(f => ({ ...f, to: e.target.value }))} className="h-8 w-36 text-sm" data-testid="input-mov-to" />
            </div>
            <Select value={movFilter.type} onValueChange={v => setMovFilter(f => ({ ...f, type: v }))}>
              <SelectTrigger className="w-36 h-8 text-sm" data-testid="select-mov-type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos os Tipos</SelectItem>
                <SelectItem value="ENTRY">Entradas</SelectItem>
                <SelectItem value="EXIT">Saídas</SelectItem>
                <SelectItem value="ADJUSTMENT">Ajustes</SelectItem>
                <SelectItem value="WASTE">Desperdícios</SelectItem>
              </SelectContent>
            </Select>
            {(movFilter.from || movFilter.to || movFilter.type !== "all") && (
              <Button variant="ghost" size="sm" className="h-8 text-xs" onClick={() => setMovFilter({ from: "", to: "", type: "all" })}>
                Limpar
              </Button>
            )}
          </div>

          {loadingMovements ? (
            <div className="text-center py-8 text-muted-foreground">Carregando...</div>
          ) : filteredMovements.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <RefreshCw className="w-8 h-8 mx-auto mb-3 opacity-40" />
              <p>Nenhuma movimentação encontrada.</p>
              <p className="text-sm mt-1">As movimentações são registradas automaticamente ao confirmar pedidos ou registrar entradas.</p>
            </div>
          ) : (
            <div className="rounded-xl border overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/40">
                    <TableHead>Data</TableHead>
                    <TableHead>Produto</TableHead>
                    <TableHead>Tipo</TableHead>
                    <TableHead className="text-right">Quantidade</TableHead>
                    <TableHead className="text-right">Saldo Após</TableHead>
                    <TableHead>Referência</TableHead>
                    <TableHead>Observações</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredMovements.map(m => (
                    <TableRow key={m.id} className="hover:bg-muted/20" data-testid={`row-movement-${m.id}`}>
                      <TableCell className="text-sm">{fmtDate(m.date)}</TableCell>
                      <TableCell className="font-medium">{m.productName}</TableCell>
                      <TableCell>
                        <Badge className={`text-xs border ${movementColor(m.movementType)}`}>
                          {m.movementType === "ENTRY" && <ArrowUpCircle className="w-3 h-3 mr-1" />}
                          {m.movementType === "EXIT" && <ArrowDownCircle className="w-3 h-3 mr-1" />}
                          {m.movementType === "ADJUSTMENT" && <RefreshCw className="w-3 h-3 mr-1" />}
                          {movementLabel(m.movementType)}
                        </Badge>
                      </TableCell>
                      <TableCell className={`text-right font-semibold ${m.movementType === "ENTRY" ? "text-green-600" : m.movementType === "EXIT" ? "text-red-600" : "text-blue-600"}`}>
                        {m.movementType === "EXIT" || m.movementType === "WASTE" ? "-" : "+"}{fmtNum(m.quantity)} {m.unit}
                      </TableCell>
                      <TableCell className="text-right text-muted-foreground text-sm">
                        {m.balanceAfter ? `${fmtNum(m.balanceAfter)} ${m.unit}` : "—"}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {m.referenceType && m.referenceId ? `${m.referenceType} #${m.referenceId}` : "—"}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground max-w-[200px] truncate">{m.notes || "—"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </TabsContent>

        {/* ─── INVENTÁRIO FÍSICO ─────────────────────────────────── */}
        <TabsContent value="physical" className="space-y-4 mt-4">
          <div className="flex justify-between items-center">
            <div>
              <h2 className="text-base font-semibold">Inventário Físico</h2>
              <p className="text-sm text-muted-foreground">Conferência manual — o sistema calcula a diferença e ajusta o saldo</p>
            </div>
            <Button onClick={() => setCountOpen(true)} data-testid="button-new-count">
              <ClipboardCheck className="w-4 h-4 mr-1" /> Nova Conferência
            </Button>
          </div>

          {counts.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <ClipboardCheck className="w-8 h-8 mx-auto mb-3 opacity-40" />
              <p>Nenhuma conferência registrada ainda.</p>
            </div>
          ) : (
            <div className="rounded-xl border overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/40">
                    <TableHead>Data</TableHead>
                    <TableHead>Produto</TableHead>
                    <TableHead className="text-right">Saldo Sistema</TableHead>
                    <TableHead className="text-right">Saldo Físico</TableHead>
                    <TableHead className="text-right">Diferença</TableHead>
                    <TableHead>Observações</TableHead>
                    <TableHead>Registrado por</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {counts.map(c => {
                    const diff = parseFloat(c.difference || "0");
                    return (
                      <TableRow key={c.id} className="hover:bg-muted/20" data-testid={`row-count-${c.id}`}>
                        <TableCell className="text-sm">{fmtDate(c.date)}</TableCell>
                        <TableCell className="font-medium">{c.productName}</TableCell>
                        <TableCell className="text-right text-muted-foreground">{fmtNum(c.systemStock)} {c.unit}</TableCell>
                        <TableCell className="text-right font-semibold">{fmtNum(c.physicalStock)} {c.unit}</TableCell>
                        <TableCell className={`text-right font-bold ${diff < 0 ? "text-red-600" : diff > 0 ? "text-green-600" : "text-muted-foreground"}`}>
                          {diff > 0 ? "+" : ""}{fmtNum(diff)} {c.unit}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">{c.notes || "—"}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">{c.createdBy}</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </TabsContent>

        {/* ─── NOTAS FISCAIS (OCR IMPORT) ─────────────────────────── */}
        <TabsContent value="invoices" className="space-y-4 mt-4">
          <FiscalInvoiceOCR />
        </TabsContent>
      </Tabs>

      {/* ─── Dialog: Nova Entrada ──────────────────────────────────── */}
      <Dialog open={entryOpen} onOpenChange={setEntryOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ArrowUpCircle className="w-5 h-5 text-green-600" />
              Registrar Entrada de Estoque
            </DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <Label>Produto *</Label>
              <Input
                value={entryForm.productName}
                onChange={e => setEntryForm(f => ({ ...f, productName: e.target.value }))}
                placeholder="Nome do produto"
                list="products-list"
                data-testid="input-entry-product"
              />
              <datalist id="products-list">
                {settings.map(s => <option key={s.id} value={s.productName} />)}
              </datalist>
            </div>
            <div>
              <Label>Categoria</Label>
              <Select value={entryForm.category} onValueChange={v => setEntryForm(f => ({ ...f, category: v }))}>
                <SelectTrigger data-testid="select-entry-category">
                  <SelectValue placeholder="Selecionar..." />
                </SelectTrigger>
                <SelectContent>
                  {CATEGORIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Fornecedor</Label>
              <Input
                value={entryForm.supplier}
                onChange={e => setEntryForm(f => ({ ...f, supplier: e.target.value }))}
                placeholder="Nome do fornecedor"
                data-testid="input-entry-supplier"
              />
            </div>
            <div>
              <Label>Quantidade *</Label>
              <Input
                type="number" min="0" step="0.1"
                value={entryForm.quantity}
                onChange={e => setEntryForm(f => ({ ...f, quantity: e.target.value }))}
                data-testid="input-entry-quantity"
              />
            </div>
            <div>
              <Label>Unidade *</Label>
              <Select value={entryForm.unit} onValueChange={v => setEntryForm(f => ({ ...f, unit: v }))}>
                <SelectTrigger data-testid="select-entry-unit">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {UNITS.map(u => <SelectItem key={u} value={u}>{u}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Valor de Compra (unit.)</Label>
              <Input
                type="number" min="0" step="0.01"
                value={entryForm.purchasePrice}
                onChange={e => setEntryForm(f => ({ ...f, purchasePrice: e.target.value }))}
                placeholder="R$ 0,00"
                data-testid="input-entry-price"
              />
            </div>
            <div>
              <Label>Data de Entrada *</Label>
              <Input
                type="date"
                value={entryForm.entryDate}
                onChange={e => setEntryForm(f => ({ ...f, entryDate: e.target.value }))}
                data-testid="input-entry-date"
              />
            </div>
            <div>
              <Label>Número da Nota Fiscal</Label>
              <Input
                value={entryForm.invoiceNumber}
                onChange={e => setEntryForm(f => ({ ...f, invoiceNumber: e.target.value }))}
                placeholder="NF-e 000000"
                data-testid="input-entry-invoice-number"
              />
            </div>
            <div>
              <Label>Data da Nota Fiscal</Label>
              <Input
                type="date"
                value={entryForm.invoiceDate}
                onChange={e => setEntryForm(f => ({ ...f, invoiceDate: e.target.value }))}
                data-testid="input-entry-invoice-date"
              />
            </div>
            <div>
              <Label>Validade Estimada</Label>
              <Input
                type="date"
                value={entryForm.expiryDate}
                onChange={e => setEntryForm(f => ({ ...f, expiryDate: e.target.value }))}
                data-testid="input-entry-expiry"
              />
            </div>
            <div className="col-span-2">
              <Label>Observações</Label>
              <Textarea
                value={entryForm.notes}
                onChange={e => setEntryForm(f => ({ ...f, notes: e.target.value }))}
                rows={2}
                data-testid="input-entry-notes"
              />
            </div>
          </div>
          <div className="bg-blue-50 rounded-lg p-3 border border-blue-200">
            <p className="text-sm text-blue-800 flex items-start gap-2">
              <FileText className="w-4 h-4 mt-0.5 shrink-0" />
              <span>Ao confirmar, o estoque será atualizado automaticamente. Para importação de NF, preencha os campos manualmente com os dados da nota fiscal.</span>
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEntryOpen(false)}>Cancelar</Button>
            <Button
              onClick={() => createEntry.mutate(entryForm)}
              disabled={!entryForm.productName || !entryForm.quantity || !entryForm.entryDate || createEntry.isPending}
              data-testid="button-confirm-entry"
            >
              {createEntry.isPending ? "Salvando..." : "Confirmar Entrada"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ─── Dialog: Adicionar Produto ────────────────────────────── */}
      <Dialog open={addProductOpen} onOpenChange={setAddProductOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Package className="w-5 h-5" />
              Adicionar Produto ao Inventário
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Nome do Produto *</Label>
              <Input
                value={addProductForm.productName}
                onChange={e => setAddProductForm(f => ({ ...f, productName: e.target.value }))}
                data-testid="input-add-product-name"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Unidade *</Label>
                <Select value={addProductForm.unit} onValueChange={v => setAddProductForm(f => ({ ...f, unit: v }))}>
                  <SelectTrigger data-testid="select-add-unit">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {UNITS.map(u => <SelectItem key={u} value={u}>{u}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Estoque Mínimo</Label>
                <Input
                  type="number" min="0" step="0.1"
                  value={addProductForm.minStock}
                  onChange={e => setAddProductForm(f => ({ ...f, minStock: e.target.value }))}
                  placeholder="0"
                  data-testid="input-add-min-stock"
                />
              </div>
            </div>
            <div>
              <Label>Categoria</Label>
              <Select value={addProductForm.category} onValueChange={v => setAddProductForm(f => ({ ...f, category: v }))}>
                <SelectTrigger data-testid="select-add-category">
                  <SelectValue placeholder="Selecionar..." />
                </SelectTrigger>
                <SelectContent>
                  {CATEGORIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddProductOpen(false)}>Cancelar</Button>
            <Button
              onClick={() => addProductMutation.mutate(addProductForm)}
              disabled={!addProductForm.productName || addProductMutation.isPending}
              data-testid="button-confirm-add-product"
            >
              {addProductMutation.isPending ? "Salvando..." : "Adicionar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ─── Dialog: Inventário Físico ────────────────────────────── */}
      <Dialog open={countOpen} onOpenChange={setCountOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ClipboardCheck className="w-5 h-5" />
              Conferência de Inventário Físico
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Produto *</Label>
              <Input
                value={countForm.productName}
                onChange={e => setCountForm(f => ({ ...f, productName: e.target.value, unit: settings.find(s => s.productName === e.target.value)?.unit || f.unit }))}
                placeholder="Nome do produto"
                list="products-list-count"
                data-testid="input-count-product"
              />
              <datalist id="products-list-count">
                {settings.map(s => <option key={s.id} value={s.productName} />)}
              </datalist>
            </div>
            {countMatchedSetting && (
              <div className="bg-muted/40 rounded-lg p-3 border text-sm">
                <p className="text-muted-foreground">Saldo atual no sistema:</p>
                <p className="text-lg font-bold">{fmtNum(countMatchedSetting.currentStock)} {countMatchedSetting.unit}</p>
              </div>
            )}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Estoque Físico Real *</Label>
                <Input
                  type="number" min="0" step="0.1"
                  value={countForm.physicalStock}
                  onChange={e => setCountForm(f => ({ ...f, physicalStock: e.target.value }))}
                  data-testid="input-count-physical"
                />
              </div>
              <div>
                <Label>Unidade</Label>
                <Select value={countForm.unit} onValueChange={v => setCountForm(f => ({ ...f, unit: v }))}>
                  <SelectTrigger data-testid="select-count-unit">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {UNITS.map(u => <SelectItem key={u} value={u}>{u}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            {countForm.physicalStock && countMatchedSetting && (() => {
              const diff = parseFloat(countForm.physicalStock) - parseFloat(countMatchedSetting.currentStock || "0");
              return (
                <div className={`rounded-lg p-3 border text-sm ${diff < 0 ? "bg-red-50 border-red-200 text-red-800" : diff > 0 ? "bg-green-50 border-green-200 text-green-800" : "bg-muted/40"}`}>
                  Diferença: <strong>{diff > 0 ? "+" : ""}{diff.toFixed(3)} {countForm.unit}</strong>
                  {diff < 0 ? " — estoque real menor que o sistema" : diff > 0 ? " — estoque real maior que o sistema" : " — sem diferença"}
                </div>
              );
            })()}
            <div>
              <Label>Data da Conferência *</Label>
              <Input type="date" value={countForm.date} onChange={e => setCountForm(f => ({ ...f, date: e.target.value }))} data-testid="input-count-date" />
            </div>
            <div>
              <Label>Observações</Label>
              <Textarea
                value={countForm.notes}
                onChange={e => setCountForm(f => ({ ...f, notes: e.target.value }))}
                rows={2}
                data-testid="input-count-notes"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCountOpen(false)}>Cancelar</Button>
            <Button
              onClick={() => createCount.mutate(countForm)}
              disabled={!countForm.productName || !countForm.physicalStock || !countForm.date || createCount.isPending}
              data-testid="button-confirm-count"
            >
              {createCount.isPending ? "Registrando..." : "Confirmar Conferência"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
