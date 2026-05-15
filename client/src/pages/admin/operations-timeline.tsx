import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useParams, Link } from "wouter";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import {
  ShoppingCart,
  ArrowRightLeft,
  Clock,
  CheckCircle2,
  RotateCcw,
  AlertTriangle,
  FileText,
  FileCheck,
  XCircle,
  AlertCircle,
  Bug,
  Activity,
  CreditCard,
  Banknote,
  ChevronDown,
  ChevronRight,
  Copy,
  Check,
  ArrowLeft,
  Loader2,
  Search,
  Hourglass,
  ShieldAlert,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

type TimelineEventStatus = "success" | "error" | "warning" | "info" | "pending";
type TimelineEventCategory = "orders" | "fiscal" | "workers" | "financial" | "errors" | "system";

interface TimelineEvent {
  id: string;
  timestamp: string;
  tipo: string;
  status: TimelineEventStatus;
  categoria: TimelineEventCategory;
  origem: string;
  mensagem: string;
  metadata: Record<string, unknown>;
}

interface TimelineSummary {
  totalEvents: number;
  failures: number;
  retries: number;
  lastEvent: string | null;
  firstEvent: string | null;
  totalDurationMs: number | null;
}

interface TimelineResponse {
  order: {
    id: number;
    orderCode: string | null;
    status: string;
    workflowStatus: string;
    fiscalStatus: string | null;
    companyId: number;
    createdAt: string;
    deliveryDate: string | null;
  };
  events: TimelineEvent[];
  summary: TimelineSummary;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const CATEGORY_LABELS: Record<TimelineEventCategory | "all", string> = {
  all:       "Todos",
  orders:    "Pedidos",
  fiscal:    "Fiscal",
  workers:   "Workers",
  financial: "Financeiro",
  errors:    "Erros",
  system:    "Sistema",
};

const STATUS_COLORS: Record<TimelineEventStatus, string> = {
  success: "bg-emerald-500",
  error:   "bg-red-500",
  warning: "bg-amber-500",
  info:    "bg-blue-500",
  pending: "bg-slate-400",
};

const STATUS_BORDER: Record<TimelineEventStatus, string> = {
  success: "border-emerald-200 dark:border-emerald-800",
  error:   "border-red-200 dark:border-red-800",
  warning: "border-amber-200 dark:border-amber-800",
  info:    "border-blue-200 dark:border-blue-800",
  pending: "border-slate-200 dark:border-slate-700",
};

const STATUS_BG: Record<TimelineEventStatus, string> = {
  success: "bg-emerald-50 dark:bg-emerald-950/20",
  error:   "bg-red-50 dark:bg-red-950/20",
  warning: "bg-amber-50 dark:bg-amber-950/20",
  info:    "bg-blue-50 dark:bg-blue-950/20",
  pending: "bg-slate-50 dark:bg-slate-900/20",
};

const STATUS_BADGE: Record<TimelineEventStatus, string> = {
  success: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300",
  error:   "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300",
  warning: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
  info:    "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300",
  pending: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
};

const TIPO_ICON: Record<string, LucideIcon> = {
  ORDER_CREATED:          ShoppingCart,
  ORDER_STATUS_CHANGED:   ArrowRightLeft,
  OUTBOX_PENDING:         Hourglass,
  OUTBOX_PROCESSED:       CheckCircle2,
  OUTBOX_RETRY:           RotateCcw,
  OUTBOX_DEAD_LETTER:     ShieldAlert,
  NFE_DRAFT_CREATED:      FileText,
  NFE_DRAFT_FINALIZED:    FileCheck,
  NFE_GENERATED:          FileText,
  NFE_AUTHORIZED:         CheckCircle2,
  NFE_CANCELLED:          XCircle,
  NFE_ERROR:              AlertCircle,
  NFE_SEFAZ_ERROR:        Bug,
  AR_CREATED:             CreditCard,
  AR_PAID:                Banknote,
  default:                Activity,
};

const TIPO_LABEL: Record<string, string> = {
  ORDER_CREATED:          "Pedido criado",
  ORDER_STATUS_CHANGED:   "Status alterado",
  OUTBOX_PENDING:         "Outbox pendente",
  OUTBOX_PROCESSED:       "Outbox processado",
  OUTBOX_RETRY:           "Retry",
  OUTBOX_DEAD_LETTER:     "Dead-letter",
  NFE_DRAFT_CREATED:      "Rascunho NF-e",
  NFE_DRAFT_FINALIZED:    "Rascunho finalizado",
  NFE_GENERATED:          "NF-e gerada",
  NFE_AUTHORIZED:         "NF-e autorizada",
  NFE_CANCELLED:          "NF-e cancelada",
  NFE_ERROR:              "Erro NF-e",
  NFE_SEFAZ_ERROR:        "Erro SEFAZ",
  AR_CREATED:             "Conta a receber",
  AR_PAID:                "Pagamento",
};

const CATEGORY_FILTER: Record<string, TimelineEventCategory[]> = {
  fiscal:    ["fiscal"],
  workers:   ["workers"],
  orders:    ["orders"],
  financial: ["financial"],
  errors:    ["errors"],
  system:    ["system"],
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatTimestamp(iso: string): { date: string; time: string } {
  try {
    const d = new Date(iso);
    return {
      date: d.toLocaleDateString("pt-BR"),
      time: d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" }),
    };
  } catch {
    return { date: "—", time: "—" };
  }
}

function formatDuration(ms: number | null): string {
  if (ms === null) return "—";
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m ${Math.floor((ms % 60_000) / 1000)}s`;
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  return `${h}h ${m}m`;
}

// ─── CopyButton ───────────────────────────────────────────────────────────────

function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  const { toast } = useToast();

  function handleCopy() {
    navigator.clipboard.writeText(value).then(() => {
      setCopied(true);
      toast({ description: `${label} copiado!` });
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <button
      onClick={handleCopy}
      data-testid={`copy-${label.toLowerCase().replace(/\s/g, "-")}`}
      className="inline-flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800 font-mono bg-blue-50 dark:bg-blue-950/30 px-2 py-0.5 rounded border border-blue-200 dark:border-blue-800 cursor-pointer transition-colors"
      title={`Copiar ${label}`}
    >
      <span className="max-w-[180px] truncate">{value}</span>
      {copied ? <Check className="w-3 h-3 text-emerald-500" /> : <Copy className="w-3 h-3" />}
    </button>
  );
}

// ─── MetadataRow ──────────────────────────────────────────────────────────────

function MetadataRow({ k, v }: { k: string; v: unknown }) {
  const isCopyable = (k === "fiscalRequestId" || k === "requestId" || k === "chaveNFe") && typeof v === "string" && v;

  return (
    <div className="flex items-start gap-2 text-xs py-0.5">
      <span className="text-muted-foreground w-36 shrink-0 font-medium">{k}</span>
      {isCopyable ? (
        <CopyButton value={v as string} label={k} />
      ) : (
        <span className="font-mono text-foreground break-all">
          {v === null || v === undefined ? "—" : typeof v === "object" ? JSON.stringify(v) : String(v)}
        </span>
      )}
    </div>
  );
}

// ─── TimelineCard ─────────────────────────────────────────────────────────────

function TimelineCard({ event, isLast }: { event: TimelineEvent; isLast: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const Icon = TIPO_ICON[event.tipo] ?? TIPO_ICON.default;
  const { date, time } = formatTimestamp(event.timestamp);
  const hasMetadata = Object.keys(event.metadata).filter((k) => event.metadata[k] !== null && event.metadata[k] !== undefined).length > 0;

  return (
    <div className="flex gap-3">
      {/* Timeline spine */}
      <div className="flex flex-col items-center">
        <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${STATUS_COLORS[event.status]} text-white shadow-sm`}>
          <Icon className="w-4 h-4" />
        </div>
        {!isLast && <div className="w-0.5 flex-1 bg-border mt-1 min-h-[20px]" />}
      </div>

      {/* Card content */}
      <div className={`flex-1 mb-4 border rounded-lg ${STATUS_BORDER[event.status]} ${STATUS_BG[event.status]}`}>
        <div
          className="flex items-start justify-between gap-2 p-3 cursor-pointer select-none"
          onClick={() => hasMetadata && setExpanded((v) => !v)}
          data-testid={`timeline-card-${event.id}`}
        >
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap mb-1">
              <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${STATUS_BADGE[event.status]}`}>
                {TIPO_LABEL[event.tipo] ?? event.tipo}
              </span>
              <span className="text-xs text-muted-foreground font-mono">{event.origem}</span>
            </div>
            <p className="text-sm text-foreground">{event.mensagem}</p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <div className="text-right">
              <div className="text-xs font-mono text-muted-foreground">{time}</div>
              <div className="text-xs text-muted-foreground/70">{date}</div>
            </div>
            {hasMetadata && (
              expanded
                ? <ChevronDown className="w-4 h-4 text-muted-foreground" />
                : <ChevronRight className="w-4 h-4 text-muted-foreground" />
            )}
          </div>
        </div>

        {expanded && hasMetadata && (
          <>
            <Separator />
            <div className="p-3 space-y-0.5">
              {Object.entries(event.metadata)
                .filter(([, v]) => v !== null && v !== undefined)
                .map(([k, v]) => (
                  <MetadataRow key={k} k={k} v={v} />
                ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ─── Summary Banner ───────────────────────────────────────────────────────────

function SummaryBanner({ summary, orderCode }: { summary: TimelineSummary; orderCode: string | null }) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 mb-6">
      <Card className="border-0 bg-blue-50 dark:bg-blue-950/20">
        <CardContent className="p-3">
          <div className="text-xs text-muted-foreground mb-1">Total de eventos</div>
          <div className="text-2xl font-bold text-blue-700 dark:text-blue-300" data-testid="text-total-events">{summary.totalEvents}</div>
        </CardContent>
      </Card>
      <Card className="border-0 bg-red-50 dark:bg-red-950/20">
        <CardContent className="p-3">
          <div className="text-xs text-muted-foreground mb-1">Falhas</div>
          <div className="text-2xl font-bold text-red-700 dark:text-red-300" data-testid="text-failures">{summary.failures}</div>
        </CardContent>
      </Card>
      <Card className="border-0 bg-amber-50 dark:bg-amber-950/20">
        <CardContent className="p-3">
          <div className="text-xs text-muted-foreground mb-1">Retries</div>
          <div className="text-2xl font-bold text-amber-700 dark:text-amber-300" data-testid="text-retries">{summary.retries}</div>
        </CardContent>
      </Card>
      <Card className="border-0 bg-emerald-50 dark:bg-emerald-950/20">
        <CardContent className="p-3">
          <div className="text-xs text-muted-foreground mb-1">Duração total</div>
          <div className="text-2xl font-bold text-emerald-700 dark:text-emerald-300" data-testid="text-duration">
            {formatDuration(summary.totalDurationMs)}
          </div>
        </CardContent>
      </Card>
      <Card className="border-0 bg-slate-50 dark:bg-slate-900/20">
        <CardContent className="p-3">
          <div className="text-xs text-muted-foreground mb-1">Último evento</div>
          <div className="text-xs font-mono font-semibold text-slate-700 dark:text-slate-300 truncate" data-testid="text-last-event">
            {summary.lastEvent ? formatTimestamp(summary.lastEvent).time : "—"}
          </div>
          <div className="text-xs text-muted-foreground/70">
            {summary.lastEvent ? formatTimestamp(summary.lastEvent).date : ""}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Filter Chips ─────────────────────────────────────────────────────────────

function FilterChips({
  active,
  onChange,
  counts,
}: {
  active: string;
  onChange: (v: string) => void;
  counts: Record<string, number>;
}) {
  const categories = ["all", "orders", "fiscal", "workers", "financial", "errors", "system"] as const;

  return (
    <div className="flex flex-wrap gap-2 mb-6">
      {categories.map((cat) => {
        const count = counts[cat] ?? 0;
        const isActive = active === cat;
        return (
          <button
            key={cat}
            onClick={() => onChange(cat)}
            data-testid={`filter-${cat}`}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-colors border ${
              isActive
                ? "bg-primary text-primary-foreground border-primary"
                : "bg-background text-muted-foreground border-border hover:border-foreground/30"
            }`}
          >
            {CATEGORY_LABELS[cat]}
            {count > 0 && (
              <span className={`text-xs px-1.5 rounded-full ${isActive ? "bg-white/20 text-white" : "bg-muted text-muted-foreground"}`}>
                {count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

// ─── Order Search Bar ─────────────────────────────────────────────────────────

function OrderSearchBar({ onSearch }: { onSearch: (id: number) => void }) {
  const [val, setVal] = useState("");

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const n = parseInt(val.trim(), 10);
    if (!isNaN(n) && n > 0) onSearch(n);
  }

  return (
    <form onSubmit={handleSubmit} className="flex items-center gap-2 mb-6 max-w-sm">
      <Input
        placeholder="ID do pedido..."
        value={val}
        onChange={(e) => setVal(e.target.value)}
        className="text-sm h-8"
        data-testid="input-order-search"
      />
      <Button type="submit" size="sm" variant="outline" className="h-8" data-testid="button-order-search">
        <Search className="w-4 h-4" />
      </Button>
    </form>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function OperationsTimeline() {
  const params = useParams<{ orderId?: string }>();
  const [searchedId, setSearchedId] = useState<number | null>(
    params.orderId ? parseInt(params.orderId, 10) : null
  );
  const [activeFilter, setActiveFilter] = useState<string>("all");
  const { toast } = useToast();

  const orderId = searchedId;

  const timelineQ = useQuery<{ success: boolean; data: TimelineResponse }>({
    queryKey: ["/api/admin/operations/timeline", orderId],
    queryFn: async () => {
      const r = await fetch(`/api/admin/operations/timeline/${orderId}`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    },
    enabled: orderId !== null && !isNaN(orderId),
    retry: false,
    staleTime: 15_000,
  });

  const data = timelineQ.data?.data;

  // Compute category counts
  const counts: Record<string, number> = { all: data?.events.length ?? 0 };
  if (data) {
    for (const ev of data.events) {
      counts[ev.categoria] = (counts[ev.categoria] ?? 0) + 1;
    }
  }

  // Filter events
  const visibleEvents = data?.events.filter((ev) => {
    if (activeFilter === "all") return true;
    const cats = CATEGORY_FILTER[activeFilter];
    return cats ? cats.includes(ev.categoria) : true;
  }) ?? [];

  function handleSearch(id: number) {
    setSearchedId(id);
    setActiveFilter("all");
    window.history.replaceState(null, "", `/admin/operations/timeline/${id}`);
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-4xl mx-auto px-4 py-6">
        {/* Header */}
        <div className="flex items-center gap-3 mb-6">
          <Link href="/admin/observability">
            <Button variant="ghost" size="sm" className="gap-1 text-muted-foreground" data-testid="button-back">
              <ArrowLeft className="w-4 h-4" />
              Observabilidade
            </Button>
          </Link>
          <Separator orientation="vertical" className="h-5" />
          <div>
            <h1 className="text-xl font-bold">Timeline Operacional</h1>
            <p className="text-xs text-muted-foreground">Rastreabilidade ponta a ponta por pedido</p>
          </div>
        </div>

        {/* Search bar */}
        <OrderSearchBar onSearch={handleSearch} />

        {/* No orderId selected */}
        {orderId === null && (
          <div className="text-center py-20 text-muted-foreground">
            <Activity className="w-10 h-10 mx-auto mb-3 opacity-30" />
            <p className="text-sm">Digite o ID de um pedido para visualizar a timeline</p>
          </div>
        )}

        {/* Loading */}
        {timelineQ.isLoading && (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        )}

        {/* Error */}
        {timelineQ.isError && (
          <Card className="border-red-200 bg-red-50 dark:bg-red-950/20">
            <CardContent className="p-4">
              <div className="flex items-center gap-2 text-red-700 dark:text-red-300">
                <AlertCircle className="w-4 h-4" />
                <span className="text-sm font-medium">
                  {timelineQ.error instanceof Error ? timelineQ.error.message : "Erro ao carregar timeline"}
                </span>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Data loaded */}
        {data && (
          <>
            {/* Order info header */}
            <Card className="mb-6">
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <CardTitle className="text-base flex items-center gap-2">
                    <ShoppingCart className="w-4 h-4" />
                    Pedido {data.order.orderCode ?? `#${data.order.id}`}
                    <span className="text-muted-foreground text-sm font-normal">— ID {data.order.id}</span>
                  </CardTitle>
                  <div className="flex items-center gap-2 flex-wrap">
                    <Badge variant="outline" className="text-xs" data-testid="badge-workflow-status">
                      {data.order.workflowStatus}
                    </Badge>
                    {data.order.fiscalStatus && (
                      <Badge variant="secondary" className="text-xs" data-testid="badge-fiscal-status">
                        {data.order.fiscalStatus}
                      </Badge>
                    )}
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-y-1 text-xs text-muted-foreground">
                  <div><span className="font-medium text-foreground">Empresa:</span> {data.order.companyId}</div>
                  <div><span className="font-medium text-foreground">Criado:</span> {formatTimestamp(data.order.createdAt).date}</div>
                  {data.order.deliveryDate && (
                    <div><span className="font-medium text-foreground">Entrega:</span> {formatTimestamp(data.order.deliveryDate).date}</div>
                  )}
                </div>
              </CardContent>
            </Card>

            {/* Summary banner */}
            <SummaryBanner summary={data.summary} orderCode={data.order.orderCode} />

            {/* Filter chips */}
            <FilterChips active={activeFilter} onChange={setActiveFilter} counts={counts} />

            {/* Timeline */}
            {visibleEvents.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">
                <Activity className="w-8 h-8 mx-auto mb-2 opacity-30" />
                <p className="text-sm">Nenhum evento nesta categoria</p>
              </div>
            ) : (
              <div data-testid="timeline-container">
                {visibleEvents.map((ev, idx) => (
                  <TimelineCard key={ev.id} event={ev} isLast={idx === visibleEvents.length - 1} />
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
