import { format } from "date-fns";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { ptBR } from "date-fns/locale";
import { useQuery } from "@tanstack/react-query";
import {
  Clock,
  CheckCircle2,
  AlertCircle,
  PackageCheck,
  PackageOpen,
  Truck,
  FileText,
  Edit3,
  RotateCw,
  ThumbsUp,
  ThumbsDown,
  XCircle,
  Send,
  Sparkles,
} from "lucide-react";

type TimelineLog = {
  id: number;
  action: string;
  description: string;
  userRole: string | null;
  level: string;
  createdAt: string;
};

const ACTION_META: Record<
  string,
  { label: string; icon: any; color: string }
> = {
  ORDER_CREATED:           { label: "Pedido Criado",            icon: Sparkles,      color: "text-emerald-600 bg-emerald-50 border-emerald-200" },
  TEST_ORDER_CREATED:      { label: "Pedido de Teste Criado",   icon: Sparkles,      color: "text-emerald-600 bg-emerald-50 border-emerald-200" },
  ORDER_REOPEN_REQUESTED:  { label: "Solicitação de Alteração", icon: RotateCw,      color: "text-orange-600 bg-orange-50 border-orange-200" },
  ORDER_REOPEN_APPROVED:   { label: "Reabertura Aprovada",      icon: ThumbsUp,      color: "text-green-600 bg-green-50 border-green-200" },
  ORDER_REOPEN_DENIED:     { label: "Reabertura Negada",        icon: ThumbsDown,    color: "text-red-600 bg-red-50 border-red-200" },
  ORDER_EDIT_FINALIZED:    { label: "Edição Finalizada",        icon: Edit3,         color: "text-blue-600 bg-blue-50 border-blue-200" },
  WORKFLOW_TRANSITION:     { label: "Mudança de Etapa",         icon: CheckCircle2,  color: "text-indigo-600 bg-indigo-50 border-indigo-200" },
  ORDER_DELETED:           { label: "Pedido Excluído",          icon: XCircle,       color: "text-red-600 bg-red-50 border-red-200" },
  BULK_ORDER_DELETE:       { label: "Exclusão em Lote",         icon: XCircle,       color: "text-red-600 bg-red-50 border-red-200" },
  ORDER_FISCAL_UPDATED:    { label: "Atualização Fiscal",       icon: FileText,      color: "text-cyan-600 bg-cyan-50 border-cyan-200" },
  ORDER_ITEMS_REPLACED:    { label: "Itens Atualizados",        icon: Edit3,         color: "text-blue-600 bg-blue-50 border-blue-200" },
  SAFRA_SUBSTITUTION:      { label: "Substituição de Safra",    icon: PackageOpen,   color: "text-violet-600 bg-violet-50 border-violet-200" },
  ERP_BLING_EXPORT:        { label: "Exportação Bling",         icon: Send,          color: "text-cyan-600 bg-cyan-50 border-cyan-200" },
};

// Maps "FROM → TO" segments inside a WORKFLOW_TRANSITION description to
// nicer labels and icons.
const WF_STATE_META: Record<string, { label: string; icon: any; color: string }> = {
  PROCESSING: { label: "Em Separação",  icon: PackageOpen,   color: "text-amber-600 bg-amber-50 border-amber-200" },
  READY:      { label: "Pedido Pronto", icon: PackageCheck,  color: "text-violet-600 bg-violet-50 border-violet-200" },
  INVOICED:   { label: "Faturado",      icon: FileText,      color: "text-cyan-600 bg-cyan-50 border-cyan-200" },
  SHIPPED:    { label: "Em Rota",       icon: Truck,         color: "text-indigo-600 bg-indigo-50 border-indigo-200" },
  DELIVERED:  { label: "Entregue",      icon: CheckCircle2,  color: "text-emerald-600 bg-emerald-50 border-emerald-200" },
  APPROVED:   { label: "Aprovado",      icon: ThumbsUp,      color: "text-blue-600 bg-blue-50 border-blue-200" },
  REJECTED:   { label: "Rejeitado",     icon: ThumbsDown,    color: "text-red-600 bg-red-50 border-red-200" },
  CANCELLED:  { label: "Cancelado",     icon: XCircle,       color: "text-red-600 bg-red-50 border-red-200" },
};

function detectTargetState(description: string): string | null {
  // Pattern: "Pedido #123 (CODE): FROM → TO — extras"
  const m = description.match(/→\s+([A-Z_]+)/);
  return m ? m[1] : null;
}

function deriveMeta(log: TimelineLog) {
  if (log.action === "WORKFLOW_TRANSITION") {
    const target = detectTargetState(log.description);
    if (target && WF_STATE_META[target]) {
      return WF_STATE_META[target];
    }
  }
  return (
    ACTION_META[log.action] || {
      label: log.action.replace(/_/g, " "),
      icon: AlertCircle,
      color: "text-muted-foreground bg-muted/30 border-border",
    }
  );
}

function ROLE_LABEL(role: string | null): string {
  if (!role) return "Sistema";
  const map: Record<string, string> = {
    CLIENT: "Cliente",
    MASTER: "Master",
    ADMIN: "Admin",
    DIRECTOR: "Diretor",
    FINANCEIRO: "Financeiro",
    LOGISTICS: "Logística",
    OPERATIONS_MANAGER: "Operações",
  };
  return map[role] || role;
}

export function OrderTimeline({ orderId }: { orderId: number }) {
  const { data, isLoading, error } = useQuery<TimelineLog[]>({
    queryKey: ["/api/orders", orderId, "timeline"],
    queryFn: async () => {
      const res = await fetchWithAuth(`/api/orders/${orderId}/timeline`);
      if (!res.ok) throw new Error("Falha ao carregar timeline");
      const body = await res.json();
      return Array.isArray(body) ? body : body?.data || [];
    },
  });

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground py-4" data-testid={`timeline-loading-${orderId}`}>
        <Clock className="w-4 h-4 animate-spin" />
        Carregando histórico...
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center gap-2 text-sm text-red-600 py-4" data-testid={`timeline-error-${orderId}`}>
        <AlertCircle className="w-4 h-4" />
        Não foi possível carregar o histórico.
      </div>
    );
  }

  const logs = data || [];

  if (logs.length === 0) {
    return (
      <div className="text-sm text-muted-foreground py-4 italic" data-testid={`timeline-empty-${orderId}`}>
        Nenhum evento registrado ainda.
      </div>
    );
  }

  return (
    <div className="relative pl-6 py-2" data-testid={`timeline-${orderId}`}>
      <div className="absolute left-2 top-2 bottom-2 w-0.5 bg-border" aria-hidden="true" />
      <ul className="space-y-4">
        {logs.map((log) => {
          const meta = deriveMeta(log);
          const Icon = meta.icon;
          return (
            <li
              key={log.id}
              className="relative"
              data-testid={`timeline-item-${log.id}`}
            >
              <div className={`absolute -left-[18px] top-1 w-4 h-4 rounded-full border-2 flex items-center justify-center ${meta.color}`}>
                <Icon className="w-2.5 h-2.5" />
              </div>
              <div className="ml-2">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-bold text-sm text-foreground">
                    {meta.label}
                  </span>
                  <span className={`text-xs font-bold px-1.5 py-0.5 rounded-md border ${meta.color}`}>
                    {ROLE_LABEL(log.userRole)}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
                  {log.description}
                </p>
                <p className="text-[11px] text-muted-foreground/80 mt-0.5 font-mono">
                  {format(new Date(log.createdAt), "dd/MM/yyyy 'às' HH:mm:ss", { locale: ptBR })}
                </p>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
