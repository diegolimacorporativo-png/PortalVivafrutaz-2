import { useState } from "react";
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
import { Trash2, Plus, Pencil, AlertTriangle, TrendingDown, Calendar, Package } from "lucide-react";
import type { WasteControl } from "@shared/schema";

const REASONS: Record<string, { label: string; color: string }> = {
  expired: { label: "Vencimento", color: "bg-red-100 text-red-700 border-red-200" },
  damaged: { label: "Avaria", color: "bg-orange-100 text-orange-700 border-orange-200" },
  overripe: { label: "Passada do Ponto", color: "bg-yellow-100 text-yellow-700 border-yellow-200" },
  separation_error: { label: "Erro de Separação", color: "bg-blue-100 text-blue-700 border-blue-200" },
  logistics_error: { label: "Erro de Logística", color: "bg-purple-100 text-purple-700 border-purple-200" },
  other: { label: "Outro", color: "bg-gray-100 text-gray-700 border-gray-200" },
};

const UNITS = ["kg", "g", "un", "cx", "sc", "lt"];

function emptyForm() {
  return {
    productName: "",
    quantity: "",
    unit: "kg",
    reason: "expired",
    date: new Date().toISOString().split("T")[0],
    notes: "",
  };
}

export default function WasteControlPage() {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [form, setForm] = useState(emptyForm());
  const [filterReason, setFilterReason] = useState("all");
  const [filterMonth, setFilterMonth] = useState("");

  const { data: records = [], isLoading } = useQuery<WasteControl[]>({
    queryKey: ["/api/waste-control"],
  });

  const createMutation = useMutation({
    mutationFn: (data: any) => apiRequest("POST", "/api/waste-control", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/waste-control"] });
      toast({ title: "Registro criado com sucesso" });
      setOpen(false);
    },
    onError: () => toast({ title: "Erro ao criar registro", variant: "destructive" }),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: any }) => apiRequest("PATCH", `/api/waste-control/${id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/waste-control"] });
      toast({ title: "Registro atualizado" });
      setOpen(false);
    },
    onError: () => toast({ title: "Erro ao atualizar", variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/waste-control/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/waste-control"] });
      toast({ title: "Registro excluído" });
    },
    onError: () => toast({ title: "Erro ao excluir", variant: "destructive" }),
  });

  function openCreate() {
    setEditId(null);
    setForm(emptyForm());
    setOpen(true);
  }

  function openEdit(rec: WasteControl) {
    setEditId(rec.id);
    setForm({
      productName: rec.productName,
      quantity: String(rec.quantity),
      unit: rec.unit,
      reason: rec.reason,
      date: rec.date,
      notes: rec.notes || "",
    });
    setOpen(true);
  }

  function handleSubmit() {
    if (!form.productName.trim() || !form.quantity || !form.date) {
      toast({ title: "Preencha os campos obrigatórios", variant: "destructive" });
      return;
    }
    const payload = { ...form, quantity: Number(form.quantity) };
    if (editId) {
      updateMutation.mutate({ id: editId, data: payload });
    } else {
      createMutation.mutate(payload);
    }
  }

  const filtered = records.filter(r => {
    if (filterReason !== "all" && r.reason !== filterReason) return false;
    if (filterMonth && !r.date.startsWith(filterMonth)) return false;
    return true;
  });

  const totalKg = filtered.reduce((acc, r) => acc + Number(r.quantity), 0);
  const byReason = Object.entries(REASONS).map(([key, { label }]) => ({
    key,
    label,
    count: filtered.filter(r => r.reason === key).length,
    qty: filtered.filter(r => r.reason === key).reduce((a, r) => a + Number(r.quantity), 0),
  })).filter(r => r.count > 0);

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <TrendingDown className="w-6 h-6 text-orange-500" />
            Controle de Desperdício
          </h1>
          <p className="text-sm text-muted-foreground mt-1">Registre e monitore perdas de produtos</p>
        </div>
        <Button onClick={openCreate} data-testid="button-new-waste" className="bg-green-600 hover:bg-green-700">
          <Plus className="w-4 h-4 mr-2" /> Novo Registro
        </Button>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-orange-100 flex items-center justify-center">
              <AlertTriangle className="w-5 h-5 text-orange-600" />
            </div>
            <div>
              <div className="text-2xl font-bold" data-testid="text-total-waste">{filtered.length}</div>
              <div className="text-xs text-muted-foreground">Registros filtrados</div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-red-100 flex items-center justify-center">
              <Package className="w-5 h-5 text-red-600" />
            </div>
            <div>
              <div className="text-2xl font-bold" data-testid="text-total-qty">{totalKg.toFixed(2)}</div>
              <div className="text-xs text-muted-foreground">Quantidade total (unidade variada)</div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-yellow-100 flex items-center justify-center">
              <TrendingDown className="w-5 h-5 text-yellow-600" />
            </div>
            <div>
              <div className="text-2xl font-bold">{byReason.length}</div>
              <div className="text-xs text-muted-foreground">Tipos de causa</div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="p-4 flex flex-wrap gap-3 items-center">
          <div className="flex items-center gap-2">
            <Label className="text-sm whitespace-nowrap">Motivo:</Label>
            <Select value={filterReason} onValueChange={setFilterReason}>
              <SelectTrigger className="w-44" data-testid="select-filter-reason">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos</SelectItem>
                {Object.entries(REASONS).map(([k, v]) => (
                  <SelectItem key={k} value={k}>{v.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-2">
            <Label className="text-sm whitespace-nowrap">Mês:</Label>
            <Input
              type="month"
              value={filterMonth}
              onChange={e => setFilterMonth(e.target.value)}
              className="w-40"
              data-testid="input-filter-month"
            />
          </div>
          {(filterReason !== "all" || filterMonth) && (
            <Button variant="ghost" size="sm" onClick={() => { setFilterReason("all"); setFilterMonth(""); }}>
              Limpar Filtros
            </Button>
          )}
        </CardContent>
      </Card>

      {/* Breakdown by reason */}
      {byReason.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {byReason.map(r => (
            <button
              key={r.key}
              onClick={() => setFilterReason(filterReason === r.key ? "all" : r.key)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ${REASONS[r.key].color} ${filterReason === r.key ? 'ring-2 ring-offset-1 ring-current' : ''}`}
              data-testid={`badge-reason-${r.key}`}
            >
              {r.label}: {r.count} reg. — {r.qty.toFixed(2)}
            </button>
          ))}
        </div>
      )}

      {/* Table */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Registros de Desperdício</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-8 text-center text-muted-foreground">Carregando...</div>
          ) : filtered.length === 0 ? (
            <div className="p-8 text-center text-muted-foreground">
              <TrendingDown className="w-12 h-12 mx-auto mb-3 opacity-30" />
              <p>Nenhum registro encontrado</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/40">
                    <th className="text-left p-3 font-medium">Data</th>
                    <th className="text-left p-3 font-medium">Produto</th>
                    <th className="text-right p-3 font-medium">Qtd.</th>
                    <th className="text-left p-3 font-medium">Motivo</th>
                    <th className="text-left p-3 font-medium">Observações</th>
                    <th className="text-left p-3 font-medium">Registrado por</th>
                    <th className="p-3"></th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(rec => (
                    <tr key={rec.id} className="border-b hover:bg-muted/20 transition-colors" data-testid={`row-waste-${rec.id}`}>
                      <td className="p-3 whitespace-nowrap">
                        <span className="flex items-center gap-1.5">
                          <Calendar className="w-3.5 h-3.5 text-muted-foreground" />
                          {new Date(rec.date + "T00:00:00").toLocaleDateString("pt-BR")}
                        </span>
                      </td>
                      <td className="p-3 font-medium">{rec.productName}</td>
                      <td className="p-3 text-right font-mono">{Number(rec.quantity).toFixed(2)} {rec.unit}</td>
                      <td className="p-3">
                        <span className={`inline-flex px-2 py-0.5 rounded text-xs font-medium border ${REASONS[rec.reason]?.color}`}>
                          {REASONS[rec.reason]?.label || rec.reason}
                        </span>
                      </td>
                      <td className="p-3 text-muted-foreground max-w-xs truncate">{rec.notes || "—"}</td>
                      <td className="p-3 text-muted-foreground text-xs">{rec.registeredBy}</td>
                      <td className="p-3">
                        <div className="flex gap-1 justify-end">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            onClick={() => openEdit(rec)}
                            data-testid={`button-edit-waste-${rec.id}`}
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-red-500 hover:text-red-600 hover:bg-red-50"
                            onClick={() => { if (confirm("Excluir este registro?")) deleteMutation.mutate(rec.id); }}
                            data-testid={`button-delete-waste-${rec.id}`}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Dialog */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editId ? "Editar Registro" : "Novo Registro de Desperdício"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <Label>Produto *</Label>
              <Input
                value={form.productName}
                onChange={e => setForm(f => ({ ...f, productName: e.target.value }))}
                placeholder="Ex: Banana Nanica"
                data-testid="input-waste-product"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Quantidade *</Label>
                <Input
                  type="number"
                  step="0.001"
                  min="0"
                  value={form.quantity}
                  onChange={e => setForm(f => ({ ...f, quantity: e.target.value }))}
                  placeholder="0.00"
                  data-testid="input-waste-quantity"
                />
              </div>
              <div>
                <Label>Unidade</Label>
                <Select value={form.unit} onValueChange={v => setForm(f => ({ ...f, unit: v }))}>
                  <SelectTrigger data-testid="select-waste-unit">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {UNITS.map(u => <SelectItem key={u} value={u}>{u}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <Label>Motivo *</Label>
              <Select value={form.reason} onValueChange={v => setForm(f => ({ ...f, reason: v }))}>
                <SelectTrigger data-testid="select-waste-reason">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(REASONS).map(([k, v]) => (
                    <SelectItem key={k} value={k}>{v.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Data da Perda *</Label>
              <Input
                type="date"
                value={form.date}
                onChange={e => setForm(f => ({ ...f, date: e.target.value }))}
                data-testid="input-waste-date"
              />
            </div>
            <div>
              <Label>Observações</Label>
              <Textarea
                value={form.notes}
                onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                placeholder="Detalhes adicionais..."
                rows={2}
                data-testid="textarea-waste-notes"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
            <Button
              onClick={handleSubmit}
              disabled={createMutation.isPending || updateMutation.isPending}
              className="bg-green-600 hover:bg-green-700"
              data-testid="button-submit-waste"
            >
              {editId ? "Salvar" : "Registrar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
