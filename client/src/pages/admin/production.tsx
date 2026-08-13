import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { BackHeader } from "@/components/navigation/BackHeader";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  Factory,
  RefreshCw,
  Printer,
  ChevronDown,
  ChevronRight,
  CheckCircle2,
  Circle,
  AlertCircle,
  Play,
  ClipboardCheck,
  Flag,
  Trash2,
  Package,
  Truck,
  ListOrdered,
  Eye,
  Building2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";

// ─── Types ─────────────────────────────────────────────────────

type BatchStatus = "PENDENTE" | "EM_PRODUCAO" | "CONFERIDO" | "FINALIZADO";

interface OrderBreakdown {
  orderId: number;
  orderCode: string;
  companyId: number;
  companyName: string;
  quantity: number;
}

interface RouteCompany {
  companyId: number;
  companyName: string;
  quantity: number;
}

interface RouteBreakdown {
  routeId: number | null;
  routeName: string;
  quantity: number;
  companies: RouteCompany[];
}

interface BatchItem {
  id: number;
  batchId: number;
  productId: number;
  productName: string;
  category: string | null;
  unit: string;
  totalQuantity: string;
  checkedQuantity: string;
  orderBreakdown: OrderBreakdown[];
  routeBreakdown: RouteBreakdown[];
  notes: string | null;
}

interface Batch {
  id: number;
  empresaId: number | null;
  productionDate: string;
  status: BatchStatus;
  notes: string | null;
  generatedAt: string | null;
  createdAt: string;
  items?: BatchItem[];
}

interface CompanyProductSummary {
  productId: number;
  productName: string;
  unit: string;
  quantity: number;
}

interface CompanySummary {
  companyId: number;
  companyName: string;
  products: CompanyProductSummary[];
  totalQuantity: number;
}

interface CompanyViewDiscrepancy {
  productId: number;
  productName: string;
  expectedQuantity: number;
  companyQuantity: number;
  difference: number;
  unit: string;
}

interface CompanyViewData {
  companies: CompanySummary[];
  discrepancies: CompanyViewDiscrepancy[];
}

// ─── Helpers ───────────────────────────────────────────────────

const STATUS_CONFIG: Record<
  BatchStatus,
  { label: string; color: string; icon: typeof Circle }
> = {
  PENDENTE:    { label: "Pendente",     color: "bg-yellow-100 text-yellow-800 border-yellow-200", icon: Circle },
  EM_PRODUCAO: { label: "Em Produção",  color: "bg-blue-100 text-blue-800 border-blue-200",       icon: Play },
  CONFERIDO:   { label: "Conferido",    color: "bg-purple-100 text-purple-800 border-purple-200", icon: ClipboardCheck },
  FINALIZADO:  { label: "Finalizado",   color: "bg-green-100 text-green-800 border-green-200",   icon: Flag },
};

const NEXT_STATUS: Record<BatchStatus, BatchStatus | null> = {
  PENDENTE:    "EM_PRODUCAO",
  EM_PRODUCAO: "CONFERIDO",
  CONFERIDO:   "FINALIZADO",
  FINALIZADO:  null,
};

const NEXT_ACTION: Record<BatchStatus, string> = {
  PENDENTE:    "Iniciar Produção",
  EM_PRODUCAO: "Marcar como Conferido",
  CONFERIDO:   "Finalizar",
  FINALIZADO:  "",
};

function fmt(qty: string | number) {
  const n = Number(qty);
  return n % 1 === 0 ? String(n) : n.toFixed(3).replace(/\.?0+$/, "");
}

function today() {
  return format(new Date(), "yyyy-MM-dd");
}

/**
 * Reorganiza o orderBreakdown já carregado no lote, sem consultar o backend.
 * productId e companyId são as chaves de agrupamento para evitar colisões de nomes.
 */
export function buildCompanyView(items: BatchItem[]): CompanyViewData {
  const companyMap = new Map<
    number,
    {
      companyId: number;
      companyName: string;
      products: Map<number, CompanyProductSummary>;
    }
  >();
  const productTotals = new Map<
    number,
    {
      productName: string;
      unit: string;
      expectedQuantity: number;
      companyQuantity: number;
    }
  >();

  for (const item of items) {
    const expectedQuantity = Number(item.totalQuantity);
    const productTotal = productTotals.get(item.productId) ?? {
      productName: item.productName,
      unit: item.unit,
      expectedQuantity: 0,
      companyQuantity: 0,
    };
    productTotal.expectedQuantity += Number.isFinite(expectedQuantity)
      ? expectedQuantity
      : 0;
    productTotals.set(item.productId, productTotal);

    for (const order of item.orderBreakdown ?? []) {
      const quantity = Number(order.quantity);
      if (!Number.isFinite(quantity)) continue;

      // O fallback evita erro de renderização se um payload antigo vier incompleto.
      const companyId = order.companyId ?? -1;
      const companyName = order.companyName?.trim() || "Empresa não identificada";
      const company = companyMap.get(companyId) ?? {
        companyId,
        companyName,
        products: new Map<number, CompanyProductSummary>(),
      };
      const product = company.products.get(item.productId);

      if (product) {
        product.quantity += quantity;
      } else {
        company.products.set(item.productId, {
          productId: item.productId,
          productName: item.productName,
          unit: item.unit,
          quantity,
        });
      }

      productTotal.companyQuantity += quantity;
      companyMap.set(companyId, company);
    }
  }

  const companies = Array.from(companyMap.values())
    .map((company) => {
      const products = Array.from(company.products.values()).sort((a, b) =>
        a.productName.localeCompare(b.productName),
      );
      return {
        ...company,
        products,
        totalQuantity: products.reduce((total, product) => total + product.quantity, 0),
      };
    })
    .sort((a, b) => a.companyName.localeCompare(b.companyName));

  const discrepancies = Array.from(productTotals.entries())
    .map(([productId, product]) => ({
      productId,
      productName: product.productName,
      expectedQuantity: product.expectedQuantity,
      companyQuantity: product.companyQuantity,
      difference: product.companyQuantity - product.expectedQuantity,
      unit: product.unit,
    }))
    // Quantidades têm até três casas decimais; a tolerância evita falso positivo
    // por erro de representação de ponto flutuante.
    .filter((product) => Math.abs(product.difference) > 0.0005);

  return { companies, discrepancies };
}

// ─── Print helper ──────────────────────────────────────────────

function printBatch(batch: Batch) {
  if (!batch.items) return;
  const dateStr = format(new Date(batch.productionDate + "T12:00:00"), "dd/MM/yyyy", { locale: ptBR });
  const statusCfg = STATUS_CONFIG[batch.status];
  const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8"/>
  <title>Produção ${dateStr}</title>
  <style>
    body { font-family: Arial, sans-serif; font-size: 12px; color: #000; margin: 20px; }
    h1 { font-size: 18px; margin-bottom: 4px; }
    .sub { color: #555; margin-bottom: 16px; }
    table { width: 100%; border-collapse: collapse; margin-bottom: 24px; }
    th { background: #f0f0f0; text-align: left; padding: 6px 8px; border: 1px solid #ccc; }
    td { padding: 5px 8px; border: 1px solid #ccc; vertical-align: top; }
    .product { font-weight: bold; }
    .route { font-size: 11px; color: #444; }
    @media print { button { display: none; } }
  </style>
</head>
<body>
  <h1>Produção do Dia — ${dateStr}</h1>
  <div class="sub">Status: ${statusCfg.label} | ${batch.items.length} produto(s)</div>
  <table>
    <thead>
      <tr>
        <th>#</th>
        <th>Produto</th>
        <th>Categoria</th>
        <th>Qtd Total</th>
        <th>Un</th>
        <th>Distribuição por Rota</th>
        <th>✓ Conferido</th>
      </tr>
    </thead>
    <tbody>
      ${batch.items
        .map(
          (item, i) => `
      <tr>
        <td>${i + 1}</td>
        <td class="product">${item.productName}</td>
        <td>${item.category ?? "—"}</td>
        <td><strong>${fmt(item.totalQuantity)}</strong></td>
        <td>${item.unit}</td>
        <td class="route">${item.routeBreakdown
          .map(
            (r) =>
              `<b>${r.routeName}</b>: ${fmt(r.quantity)}<br/>${r.companies
                .map((c) => `&nbsp;&nbsp;• ${c.companyName}: ${fmt(c.quantity)}`)
                .join("<br/>")}`,
          )
          .join("<br/>") || "—"}</td>
        <td style="min-width:60px">&nbsp;</td>
      </tr>`,
        )
        .join("")}
    </tbody>
  </table>
  <p style="margin-top:40px;">Assinatura: _____________________________ &nbsp;&nbsp; Data: ___/___/______</p>
</body>
</html>`;
  const w = window.open("", "_blank");
  if (w) {
    w.document.write(html);
    w.document.close();
    w.focus();
    setTimeout(() => w.print(), 400);
  }
}

// ─── Main Page ─────────────────────────────────────────────────

export default function AdminProduction() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [selectedDate, setSelectedDate] = useState(today());
  const [activeBatchId, setActiveBatchId] = useState<number | null>(null);
  const [expandedItems, setExpandedItems] = useState<Set<number>>(new Set());
  const [deleteTarget, setDeleteTarget] = useState<number | null>(null);
  const [generateOpen, setGenerateOpen] = useState(false);

  // ── Queries ──────────────────────────────────────────────────

  const batchesQuery = useQuery({
    queryKey: ["/api/production/batches", selectedDate],
    queryFn: async () => {
      const res = await fetchWithAuth(
        `/api/production/batches?date=${selectedDate}&limit=50`,
      );
      const json = await res.json();
      return (json.data ?? []) as Batch[];
    },
  });

  const batchDetailQuery = useQuery({
    queryKey: ["/api/production/batches", activeBatchId],
    queryFn: async () => {
      if (!activeBatchId) return null;
      const res = await fetchWithAuth(`/api/production/batches/${activeBatchId}`);
      const json = await res.json();
      return json.data as Batch;
    },
    enabled: activeBatchId != null,
  });

  const activeBatch = batchDetailQuery.data ?? null;
  const companyView = activeBatch?.items
    ? buildCompanyView(activeBatch.items)
    : { companies: [], discrepancies: [] };

  // ── Mutations ─────────────────────────────────────────────────

  const generateMutation = useMutation({
    mutationFn: async () => {
      const res = await fetchWithAuth("/api/production/batches/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productionDate: selectedDate }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? err.message ?? "Erro ao gerar lote");
      }
      return res.json();
    },
    onSuccess: (data) => {
      toast({ title: "Lote gerado com sucesso!" });
      setGenerateOpen(false);
      queryClient.invalidateQueries({ queryKey: ["/api/production/batches"] });
      setActiveBatchId(data.data?.id ?? null);
    },
    onError: (err: Error) => {
      toast({ title: "Erro", description: err.message, variant: "destructive" });
    },
  });

  const statusMutation = useMutation({
    mutationFn: async ({ id, status }: { id: number; status: BatchStatus }) => {
      const res = await fetchWithAuth(`/api/production/batches/${id}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? err.message ?? "Erro");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/production/batches"] });
    },
    onError: (err: Error) => {
      toast({ title: "Erro", description: err.message, variant: "destructive" });
    },
  });

  const checkMutation = useMutation({
    mutationFn: async ({
      itemId,
      checkedQuantity,
    }: {
      itemId: number;
      checkedQuantity: number;
    }) => {
      const res = await fetchWithAuth(
        `/api/production/batch-items/${itemId}/check`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ checkedQuantity }),
        },
      );
      if (!res.ok) throw new Error("Erro ao atualizar");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["/api/production/batches", activeBatchId],
      });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await fetchWithAuth(`/api/production/batches/${id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? "Erro ao excluir");
      }
    },
    onSuccess: () => {
      toast({ title: "Lote excluído" });
      queryClient.invalidateQueries({ queryKey: ["/api/production/batches"] });
      if (activeBatchId === deleteTarget) setActiveBatchId(null);
      setDeleteTarget(null);
    },
    onError: (err: Error) => {
      toast({ title: "Erro", description: err.message, variant: "destructive" });
    },
  });

  // ── Helpers ───────────────────────────────────────────────────

  const toggleItem = (id: number) => {
    setExpandedItems((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const batches = batchesQuery.data ?? [];
  const hasBatch = batches.length > 0;

  // ── Render ────────────────────────────────────────────────────

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Factory className="w-6 h-6 text-orange-500" />
            Produção
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Geração e controle da produção diária a partir dos pedidos
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Input
            type="date"
            value={selectedDate}
            onChange={(e) => {
              setSelectedDate(e.target.value);
              setActiveBatchId(null);
            }}
            className="w-40"
          />
          <Button
            variant="outline"
            size="icon"
            onClick={() => {
              queryClient.invalidateQueries({
                queryKey: ["/api/production/batches"],
              });
            }}
          >
            <RefreshCw className="w-4 h-4" />
          </Button>
          <Button
            onClick={() => setGenerateOpen(true)}
            className="bg-orange-500 hover:bg-orange-600 text-white"
            disabled={hasBatch}
          >
            <Factory className="w-4 h-4 mr-2" />
            Gerar Produção
          </Button>
        </div>
      </div>

      {/* Batches list for selected date */}
      {batchesQuery.isPending && (
        <div className="text-center py-12 text-muted-foreground">
          Carregando...
        </div>
      )}

      {!batchesQuery.isPending && !hasBatch && (
        <Card className="border-dashed">
          <CardContent className="py-12 text-center text-muted-foreground">
            <Factory className="w-12 h-12 mx-auto mb-3 text-gray-300" />
            <p className="font-medium">Nenhuma produção para esta data</p>
            <p className="text-sm mt-1">
              Clique em "Gerar Produção" para criar o lote a partir dos pedidos do dia.
            </p>
          </CardContent>
        </Card>
      )}

      {hasBatch && (
        <div className="grid grid-cols-1 gap-4">
          {batches.map((batch) => {
            const cfg = STATUS_CONFIG[batch.status];
            const StatusIcon = cfg.icon;
            const next = NEXT_STATUS[batch.status];
            const isActive = activeBatchId === batch.id;
            return (
              <Card
                key={batch.id}
                className={`cursor-pointer transition-shadow hover:shadow-md ${isActive ? "ring-2 ring-orange-400" : ""}`}
                onClick={() =>
                  setActiveBatchId(isActive ? null : batch.id)
                }
              >
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <div className="flex items-center gap-3">
                      <StatusIcon className="w-5 h-5 text-gray-500" />
                      <CardTitle className="text-base">
                        Produção —{" "}
                        {format(
                          new Date(batch.productionDate + "T12:00:00"),
                          "dd/MM/yyyy (EEEE)",
                          { locale: ptBR },
                        )}
                      </CardTitle>
                      <Badge className={`${cfg.color} border text-xs`}>
                        {cfg.label}
                      </Badge>
                    </div>
                    <div className="flex items-center gap-2">
                      {next && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={(e) => {
                            e.stopPropagation();
                            statusMutation.mutate({ id: batch.id, status: next });
                          }}
                          disabled={statusMutation.isPending}
                        >
                          {NEXT_ACTION[batch.status]}
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={(e) => {
                          e.stopPropagation();
                          if (activeBatch) printBatch(activeBatch);
                        }}
                        title="Imprimir"
                      >
                        <Printer className="w-4 h-4" />
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-red-500 hover:text-red-700"
                        onClick={(e) => {
                          e.stopPropagation();
                          setDeleteTarget(batch.id);
                        }}
                        title="Excluir lote"
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={(e) => {
                          e.stopPropagation();
                          setActiveBatchId(isActive ? null : batch.id);
                        }}
                      >
                        <Eye className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                </CardHeader>
              </Card>
            );
          })}
        </div>
      )}

      {/* Batch detail */}
      {activeBatch && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Package className="w-5 h-5 text-orange-500" />
              Detalhe do Lote
            </CardTitle>
            <CardDescription>
              {activeBatch.items?.length ?? 0} produto(s) · Gerado em{" "}
              {activeBatch.generatedAt
                ? format(new Date(activeBatch.generatedAt), "dd/MM/yyyy HH:mm")
                : "—"}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {batchDetailQuery.isPending && (
              <p className="text-muted-foreground text-sm">Carregando...</p>
            )}
            {activeBatch.items && (
              <Tabs defaultValue="produtos">
                <TabsList className="mb-4">
                  <TabsTrigger value="produtos">
                    <Package className="w-4 h-4 mr-1" /> Por Produto
                  </TabsTrigger>
                  <TabsTrigger value="empresas">
                    <Building2 className="w-4 h-4 mr-1" /> Por Empresa
                  </TabsTrigger>
                  <TabsTrigger value="rotas">
                    <Truck className="w-4 h-4 mr-1" /> Por Rota
                  </TabsTrigger>
                  <TabsTrigger value="separacao">
                    <ListOrdered className="w-4 h-4 mr-1" /> Lista de Separação
                  </TabsTrigger>
                  <TabsTrigger value="conferencia">
                    <ClipboardCheck className="w-4 h-4 mr-1" /> Conferência
                  </TabsTrigger>
                </TabsList>

                {/* ── Por Produto ── */}
                <TabsContent value="produtos">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-8"></TableHead>
                        <TableHead>Produto</TableHead>
                        <TableHead>Categoria</TableHead>
                        <TableHead className="text-right">Qtd Total</TableHead>
                        <TableHead>Un</TableHead>
                        <TableHead>Pedidos</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {activeBatch.items.map((item) => (
                        <>
                          <TableRow
                            key={item.id}
                            className="cursor-pointer hover:bg-muted/50"
                            onClick={() => toggleItem(item.id)}
                          >
                            <TableCell>
                              {expandedItems.has(item.id) ? (
                                <ChevronDown className="w-4 h-4" />
                              ) : (
                                <ChevronRight className="w-4 h-4" />
                              )}
                            </TableCell>
                            <TableCell className="font-medium">
                              {item.productName}
                            </TableCell>
                            <TableCell className="text-muted-foreground text-sm">
                              {item.category ?? "—"}
                            </TableCell>
                            <TableCell className="text-right font-bold text-lg">
                              {fmt(item.totalQuantity)}
                            </TableCell>
                            <TableCell className="text-muted-foreground">
                              {item.unit}
                            </TableCell>
                            <TableCell className="text-muted-foreground text-sm">
                              {item.orderBreakdown.length} pedido(s)
                            </TableCell>
                          </TableRow>
                          {expandedItems.has(item.id) && (
                            <TableRow key={`exp-${item.id}`}>
                              <TableCell />
                              <TableCell colSpan={5}>
                                <div className="bg-muted/30 rounded p-3 text-sm space-y-1">
                                  {item.orderBreakdown.map((o) => (
                                    <div
                                      key={o.orderId}
                                      className="flex items-center justify-between"
                                    >
                                      <span className="text-muted-foreground">
                                        {o.companyName}
                                      </span>
                                      <span className="font-mono font-medium">
                                        {fmt(o.quantity)} {item.unit}
                                      </span>
                                    </div>
                                  ))}
                                </div>
                              </TableCell>
                            </TableRow>
                          )}
                        </>
                      ))}
                    </TableBody>
                  </Table>
                </TabsContent>

                {/* ── Por Empresa ── */}
                <TabsContent value="empresas">
                  {companyView.discrepancies.length > 0 && (
                    <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded p-3 mb-4 text-amber-800 text-sm">
                      <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                      <div>
                        <p className="font-medium">
                          Divergência no consolidado do lote
                        </p>
                        <p className="mt-1">
                          A soma por empresa não corresponde ao total do produto:
                        </p>
                        <ul className="mt-1 list-disc list-inside">
                          {companyView.discrepancies.map((product) => (
                            <li key={product.productId}>
                              {product.productName}: esperado{" "}
                              <strong>
                                {fmt(product.expectedQuantity)} {product.unit}
                              </strong>
                              , por empresa{" "}
                              <strong>
                                {fmt(product.companyQuantity)} {product.unit}
                              </strong>{" "}
                              (diferença de {fmt(Math.abs(product.difference))}{" "}
                              {product.unit})
                            </li>
                          ))}
                        </ul>
                      </div>
                    </div>
                  )}

                  {companyView.companies.length === 0 ? (
                    <div className="text-center py-8 text-muted-foreground">
                      <Building2 className="w-10 h-10 mx-auto mb-2 text-gray-300" />
                      <p>Nenhuma empresa encontrada neste lote.</p>
                    </div>
                  ) : (
                    <div className="space-y-6">
                      {companyView.companies.map((company) => (
                        <Card key={company.companyId} className="border">
                          <CardHeader className="pb-2">
                            <CardTitle className="text-sm font-semibold flex items-center gap-2">
                              <Building2 className="w-4 h-4 text-orange-500" />
                              {company.companyName}
                              <Badge variant="secondary" className="ml-auto">
                                Total: {fmt(company.totalQuantity)}
                              </Badge>
                            </CardTitle>
                            <CardDescription>
                              {company.products.length} produto(s)
                            </CardDescription>
                          </CardHeader>
                          <CardContent>
                            <Table>
                              <TableHeader>
                                <TableRow>
                                  <TableHead>Produto</TableHead>
                                  <TableHead className="text-right">
                                    Quantidade
                                  </TableHead>
                                  <TableHead>Unidade</TableHead>
                                </TableRow>
                              </TableHeader>
                              <TableBody>
                                {company.products.map((product) => (
                                  <TableRow key={product.productId}>
                                    <TableCell className="font-medium">
                                      {product.productName}
                                    </TableCell>
                                    <TableCell className="text-right font-bold">
                                      {fmt(product.quantity)}
                                    </TableCell>
                                    <TableCell className="text-muted-foreground">
                                      {product.unit}
                                    </TableCell>
                                  </TableRow>
                                ))}
                              </TableBody>
                            </Table>
                            <div className="flex justify-end border-t mt-3 pt-3 text-sm font-semibold">
                              Total da empresa:{" "}
                              <span className="ml-2">
                                {fmt(company.totalQuantity)}
                              </span>
                            </div>
                          </CardContent>
                        </Card>
                      ))}
                    </div>
                  )}
                </TabsContent>

                {/* ── Por Rota ── */}
                <TabsContent value="rotas">
                  <RouteView items={activeBatch.items} />
                </TabsContent>

                {/* ── Lista de Separação ── */}
                <TabsContent value="separacao">
                  <div className="flex justify-end mb-3">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => printBatch(activeBatch)}
                    >
                      <Printer className="w-4 h-4 mr-2" />
                      Imprimir Lista
                    </Button>
                  </div>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>#</TableHead>
                        <TableHead>Produto</TableHead>
                        <TableHead>Categoria</TableHead>
                        <TableHead className="text-right">Qtd Total</TableHead>
                        <TableHead>Un</TableHead>
                        <TableHead>Rotas</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {activeBatch.items.map((item, idx) => (
                        <TableRow key={item.id}>
                          <TableCell className="text-muted-foreground">
                            {idx + 1}
                          </TableCell>
                          <TableCell className="font-medium">
                            {item.productName}
                          </TableCell>
                          <TableCell className="text-muted-foreground text-sm">
                            {item.category ?? "—"}
                          </TableCell>
                          <TableCell className="text-right font-bold text-lg">
                            {fmt(item.totalQuantity)}
                          </TableCell>
                          <TableCell>{item.unit}</TableCell>
                          <TableCell className="text-sm text-muted-foreground">
                            {item.routeBreakdown
                              .map(
                                (r) => `${r.routeName}: ${fmt(r.quantity)}`,
                              )
                              .join(" · ") || "Sem rota"}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TabsContent>

                {/* ── Conferência ── */}
                <TabsContent value="conferencia">
                  <ConferenceView
                    items={activeBatch.items}
                    onCheck={(itemId, qty) =>
                      checkMutation.mutate({ itemId, checkedQuantity: qty })
                    }
                    isPending={checkMutation.isPending}
                  />
                </TabsContent>
              </Tabs>
            )}
          </CardContent>
        </Card>
      )}

      {/* Generate Dialog */}
      <Dialog open={generateOpen} onOpenChange={setGenerateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Gerar Produção do Dia</DialogTitle>
            <DialogDescription>
              Agrupa todos os itens dos pedidos confirmados para{" "}
              <strong>
                {format(
                  new Date(selectedDate + "T12:00:00"),
                  "dd/MM/yyyy (EEEE)",
                  { locale: ptBR },
                )}
              </strong>{" "}
              em um único lote de produção.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <p className="text-sm text-muted-foreground">
              Status incluídos: Criado, Aguardando Aprovação, Aprovado, Faturado, Enviado.
            </p>
            <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded p-2">
              ⚠️ Esta ação não pode ser desfeita sem excluir o lote manualmente.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setGenerateOpen(false)}>
              Cancelar
            </Button>
            <Button
              className="bg-orange-500 hover:bg-orange-600 text-white"
              onClick={() => generateMutation.mutate()}
              disabled={generateMutation.isPending}
            >
              {generateMutation.isPending ? "Gerando..." : "Gerar Lote"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirm */}
      <AlertDialog
        open={deleteTarget != null}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir lote de produção?</AlertDialogTitle>
            <AlertDialogDescription>
              Esta ação não pode ser desfeita. O lote e todos os seus itens
              serão removidos permanentemente.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 hover:bg-red-700 text-white"
              onClick={() => deleteTarget && deleteMutation.mutate(deleteTarget)}
            >
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ─── Route View ────────────────────────────────────────────────

function RouteView({ items }: { items: BatchItem[] }) {
  // Aggregate by route
  const routeMap = new Map<
    string,
    {
      routeId: number | null;
      routeName: string;
      products: Map<
        number,
        { productId: number; productName: string; unit: string; quantity: number }
      >;
    }
  >();

  for (const item of items) {
    for (const route of item.routeBreakdown) {
      const key = route.routeId != null ? String(route.routeId) : "sem-rota";
      if (!routeMap.has(key)) {
        routeMap.set(key, {
          routeId: route.routeId,
          routeName: route.routeName,
          products: new Map(),
        });
      }
      const entry = routeMap.get(key)!;
      const existing = entry.products.get(item.productId);
      if (existing) {
        existing.quantity += route.quantity;
      } else {
        entry.products.set(item.productId, {
          productId: item.productId,
          productName: item.productName,
          unit: item.unit,
          quantity: route.quantity,
        });
      }
    }
  }

  const routes = Array.from(routeMap.values()).sort((a, b) =>
    a.routeName.localeCompare(b.routeName),
  );

  if (routes.length === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        <Truck className="w-10 h-10 mx-auto mb-2 text-gray-300" />
        <p>Nenhuma rota cadastrada para esta data.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {routes.map((route) => {
        const products = Array.from(route.products.values()).sort((a, b) =>
          a.productName.localeCompare(b.productName),
        );
        const totalItems = products.length;
        return (
          <Card key={route.routeId ?? "sem-rota"} className="border">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <Truck className="w-4 h-4 text-blue-500" />
                {route.routeName}
                <Badge variant="secondary" className="ml-auto">
                  {totalItems} produto(s)
                </Badge>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Produto</TableHead>
                    <TableHead className="text-right">Qtd</TableHead>
                    <TableHead>Un</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {products.map((p) => (
                    <TableRow key={p.productId}>
                      <TableCell className="font-medium">{p.productName}</TableCell>
                      <TableCell className="text-right font-bold">
                        {fmt(p.quantity)}
                      </TableCell>
                      <TableCell className="text-muted-foreground">{p.unit}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

// ─── Conference View ───────────────────────────────────────────

function ConferenceView({
  items,
  onCheck,
  isPending,
}: {
  items: BatchItem[];
  onCheck: (itemId: number, qty: number) => void;
  isPending: boolean;
}) {
  const [inputValues, setInputValues] = useState<Record<number, string>>(() =>
    Object.fromEntries(items.map((i) => [i.id, fmt(i.checkedQuantity)])),
  );

  const allDone = items.every(
    (i) => Number(i.checkedQuantity) >= Number(i.totalQuantity),
  );

  return (
    <div className="space-y-4">
      {allDone && (
        <div className="flex items-center gap-2 bg-green-50 border border-green-200 rounded p-3 text-green-800 text-sm">
          <CheckCircle2 className="w-5 h-5" />
          Todos os itens foram conferidos!
        </div>
      )}
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Produto</TableHead>
            <TableHead className="text-right">Necessário</TableHead>
            <TableHead className="text-right">Conferido</TableHead>
            <TableHead>Un</TableHead>
            <TableHead></TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((item) => {
            const total = Number(item.totalQuantity);
            const checked = Number(item.checkedQuantity);
            const done = checked >= total;
            const over = checked > total;
            return (
              <TableRow key={item.id} className={done ? "bg-green-50/50" : ""}>
                <TableCell className="font-medium flex items-center gap-2">
                  {done ? (
                    <CheckCircle2 className="w-4 h-4 text-green-500 flex-shrink-0" />
                  ) : (
                    <Circle className="w-4 h-4 text-gray-300 flex-shrink-0" />
                  )}
                  {item.productName}
                </TableCell>
                <TableCell className="text-right font-bold">
                  {fmt(item.totalQuantity)}
                </TableCell>
                <TableCell className="text-right">
                  <Input
                    type="number"
                    min="0"
                    step="0.001"
                    value={inputValues[item.id] ?? "0"}
                    onChange={(e) =>
                      setInputValues((prev) => ({
                        ...prev,
                        [item.id]: e.target.value,
                      }))
                    }
                    className={`w-24 text-right ${over ? "border-amber-400" : ""}`}
                  />
                </TableCell>
                <TableCell className="text-muted-foreground">{item.unit}</TableCell>
                <TableCell>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={isPending}
                    onClick={() =>
                      onCheck(item.id, Number(inputValues[item.id] ?? 0))
                    }
                  >
                    Salvar
                  </Button>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
      {items.some((i) => Number(i.checkedQuantity) > Number(i.totalQuantity)) && (
        <div className="flex items-center gap-2 bg-amber-50 border border-amber-200 rounded p-3 text-amber-800 text-sm">
          <AlertCircle className="w-4 h-4" />
          Atenção: alguns itens foram conferidos com quantidade acima do necessário.
        </div>
      )}
    </div>
  );
}
