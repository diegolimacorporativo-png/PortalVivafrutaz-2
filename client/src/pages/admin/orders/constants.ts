export const FISCAL_LABEL: Record<string, string> = {
  nota_pendente: "Nota Pendente",
  nota_liberada: "Liberada p/ NF-e",
  nota_exportada: "Nota Exportada",
  nota_emitida: "Nota Emitida",
  nota_cancelada: "Nota Cancelada",
};

export const FISCAL_BADGE: Record<string, string> = {
  nota_pendente: "bg-yellow-100 text-yellow-700 border-yellow-300",
  nota_liberada: "bg-emerald-100 text-emerald-700 border-emerald-300",
  nota_exportada: "bg-blue-100 text-blue-700 border-blue-300",
  nota_emitida: "bg-green-100 text-green-700 border-green-300",
  nota_cancelada: "bg-red-100 text-red-700 border-red-300",
};

export const ERP_STATUS_LABEL: Record<string, string> = {
  nao_exportado: "Não exportado",
  exportando: "Exportando...",
  exportado: "Exportado",
  erro: "Erro Bling",
};

export const ERP_STATUS_BADGE: Record<string, string> = {
  nao_exportado: "bg-gray-100 text-gray-500 border-gray-300",
  exportando: "bg-blue-100 text-blue-600 border-blue-300 animate-pulse",
  exportado: "bg-emerald-100 text-emerald-700 border-emerald-300",
  erro: "bg-red-100 text-red-700 border-red-300",
};

export const STATUS_BADGE: Record<string, string> = {
  ACTIVE: "bg-green-100 text-green-700",
  CONFIRMED: "bg-blue-100 text-blue-700",
  REOPEN_REQUESTED: "bg-orange-100 text-orange-700",
  OPEN_FOR_EDITING: "bg-yellow-100 text-yellow-700",
  CANCELLED: "bg-red-100 text-red-700",
  DELIVERED: "bg-emerald-100 text-emerald-700",
};

export const STATUS_LABEL: Record<string, string> = {
  ACTIVE: "Ativo",
  CONFIRMED: "Confirmado",
  REOPEN_REQUESTED: "Solicitação de Alteração",
  OPEN_FOR_EDITING: "Em Edição",
  CANCELLED: "Cancelado",
  DELIVERED: "Entregue",
};

export const WF_BADGE: Record<string, string> = {
  APPROVED:   "bg-blue-50 text-blue-700 border-blue-200",
  PROCESSING: "bg-amber-50 text-amber-700 border-amber-200",
  READY:      "bg-violet-50 text-violet-700 border-violet-200",
  INVOICED:   "bg-cyan-50 text-cyan-700 border-cyan-200",
  SHIPPED:    "bg-indigo-50 text-indigo-700 border-indigo-200",
  DELIVERED:  "bg-emerald-50 text-emerald-700 border-emerald-200",
};

export const WF_LABEL: Record<string, string> = {
  CREATED:          "Criado",
  PENDING_APPROVAL: "Aguardando Aprovação",
  APPROVED:         "Aprovado",
  PROCESSING:       "Em Separação",
  READY:            "Pedido Pronto",
  INVOICED:         "Faturado",
  SHIPPED:          "Em Rota",
  DELIVERED:        "Entregue",
  REJECTED:         "Rejeitado",
  CANCELLED:        "Cancelado",
};

export const ORDER_TYPE_OPTIONS = [
  { value: 'all', label: 'Todos os tipos' },
  { value: 'semanal', label: 'Semanal' },
  { value: 'mensal', label: 'Mensal' },
  { value: 'pontual', label: 'Pontual' },
  { value: 'contratual', label: 'Contratual' },
  { value: 'teste', label: 'Teste' },
];

export const CLIENT_TYPE_PT: Record<string, string> = {
  semanal: 'Semanal', mensal: 'Mensal', pontual: 'Pontual', contratual: 'Contratual', quinzenal: 'Quinzenal',
};

export const STATUS_PT: Record<string, string> = {
  ACTIVE: 'Ativo', CANCELLED: 'Cancelado', REOPEN_REQUESTED: 'Reabertura solicitada', CLOSED: 'Fechado',
};
