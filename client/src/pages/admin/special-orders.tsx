import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useCompanies } from "@/hooks/use-admin";
import { Layout } from "@/components/Layout";
import { Modal } from "@/components/Modal";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import {
  Star, Building2, CheckCircle, XCircle, Clock, Eye, Calendar, AlertTriangle,
  Package, Tag, Edit2, Plus, Trash2, Filter, X, FileDown, Printer
} from "lucide-react";

type SpecialItem = {
  productName: string;
  quantity: string;
  brand?: string;
  category: string;
  productType: string;
  approvedQuantity?: string;
};

type SpecialOrderRequest = {
  id: number; companyId: number; requestedDay: string; requestedDate?: string | null;
  description: string; quantity: string; observations: string | null; status: string;
  adminNote: string | null; createdAt: string; resolvedAt: string | null;
  items?: SpecialItem[] | null; estimatedDeliveryDate?: string | null;
};

const STATUS_MAP: Record<string, { label: string; color: string; icon: any }> = {
  PENDING: { label: "Pendente", color: "bg-yellow-100 text-yellow-700", icon: Clock },
  APPROVED: { label: "Aprovado", color: "bg-green-100 text-green-700", icon: CheckCircle },
  REJECTED: { label: "Recusado", color: "bg-red-100 text-red-700", icon: XCircle },
};

const CATEGORY_COLORS: Record<string, string> = {
  "Frutas": "bg-orange-100 text-orange-700",
  "Hortifruti / Verduras": "bg-green-100 text-green-700",
  "Industrializados": "bg-blue-100 text-blue-700",
};

const REJECTION_PRESETS = [
  "Produto indisponível", "Fora da janela de entrega", "Estoque insuficiente",
  "Pedido fora do contrato", "Data solicitada inválida", "Quantidade acima do limite",
];

function generateSpecialOrderPDF(req: SpecialOrderRequest, companyName: string) {
  const doc = new jsPDF();
  const items: SpecialItem[] = Array.isArray(req.items) ? req.items : [];
  const today = format(new Date(), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR });
  const orderCode = `PP-${String(req.id).padStart(6, '0')}`;
  const statusLabel = req.status === 'APPROVED' ? 'Aprovado' : req.status === 'REJECTED' ? 'Recusado' : 'Pendente';
  const GREEN = [34, 197, 94] as [number, number, number];
  const ORANGE = [249, 115, 22] as [number, number, number];
  const DARK = [30, 30, 30] as [number, number, number];

  doc.setFillColor(...GREEN);
  doc.rect(0, 0, 210, 22, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(16);
  doc.setFont("helvetica", "bold");
  doc.text("VivaFrutaz — Pedido Pontual", 14, 14);

  doc.setFontSize(9);
  doc.setFont("helvetica", "normal");
  doc.text(orderCode, 196, 14, { align: "right" });

  doc.setTextColor(...DARK);
  let y = 30;

  doc.setFontSize(11);
  doc.setFont("helvetica", "bold");
  doc.text("Dados do Pedido", 14, y);
  y += 6;

  const infoData = [
    ["Cliente", companyName],
    ["Nº do Pedido Pontual", orderCode],
    ["Data da Solicitação", format(new Date(req.createdAt), "dd/MM/yyyy", { locale: ptBR })],
    ["Dia Solicitado", req.requestedDay],
    ["Data Solicitada", req.requestedDate ? new Date(req.requestedDate + 'T12:00:00').toLocaleDateString('pt-BR') : "—"],
    ["Data Prevista de Entrega", req.estimatedDeliveryDate ? new Date(req.estimatedDeliveryDate + 'T12:00:00').toLocaleDateString('pt-BR') : "—"],
    ["Status", statusLabel],
    ...(req.resolvedAt ? [["Data de Aprovação/Recusa", format(new Date(req.resolvedAt), "dd/MM/yyyy", { locale: ptBR })]] : []),
    ...(req.adminNote ? [["Nota do Responsável", req.adminNote]] : []),
  ];

  autoTable(doc, {
    startY: y,
    head: [],
    body: infoData,
    theme: "grid",
    styles: { fontSize: 9, cellPadding: 3 },
    columnStyles: {
      0: { fontStyle: "bold", fillColor: [245, 245, 245], cellWidth: 60 },
      1: { cellWidth: 120 },
    },
    margin: { left: 14, right: 14 },
  });

  y = (doc as any).lastAutoTable.finalY + 10;

  if (items.length > 0) {
    doc.setFontSize(11);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(...DARK);
    doc.text("Produtos Solicitados", 14, y);
    y += 4;

    autoTable(doc, {
      startY: y,
      head: [["Produto", "Categoria", "Qtd. Solicitada", "Qtd. Aprovada", "Observações"]],
      body: items.map(it => [
        it.productName,
        it.category || "—",
        it.quantity,
        it.approvedQuantity || "—",
        (it as any).observations || "—",
      ]),
      theme: "striped",
      headStyles: { fillColor: GREEN, textColor: [255, 255, 255], fontStyle: "bold", fontSize: 9 },
      styles: { fontSize: 9, cellPadding: 3 },
      margin: { left: 14, right: 14 },
    });
    y = (doc as any).lastAutoTable.finalY + 8;
  } else if (req.description) {
    doc.setFontSize(11);
    doc.setFont("helvetica", "bold");
    doc.text("Descrição do Pedido", 14, y);
    y += 5;
    doc.setFontSize(9);
    doc.setFont("helvetica", "normal");
    doc.text(req.description, 14, y);
    y += 10;
  }

  if (req.observations) {
    doc.setFontSize(9);
    doc.setFont("helvetica", "italic");
    doc.setTextColor(100, 100, 100);
    doc.text(`Observações do cliente: ${req.observations}`, 14, y);
    y += 8;
  }

  const pageH = doc.internal.pageSize.getHeight();
  doc.setFillColor(...ORANGE);
  doc.rect(0, pageH - 14, 210, 14, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(8);
  doc.setFont("helvetica", "normal");
  doc.text(`Documento gerado pelo sistema VivaFrutaz  |  ${today}  |  Pedido: ${orderCode}`, 14, pageH - 5);

  doc.save(`pedido-pontual-${orderCode}.pdf`);
}

export default function SpecialOrdersAdminPage() {
  const { data: companies } = useCompanies();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [reviewing, setReviewing] = useState<SpecialOrderRequest | null>(null);
  const [rejectionReason, setRejectionReason] = useState("");
  const [approvalNote, setApprovalNote] = useState("");
  const [action, setAction] = useState<'APPROVE' | 'REJECT' | null>(null);
  const [editedItems, setEditedItems] = useState<SpecialItem[]>([]);
  const [estimatedDeliveryDate, setEstimatedDeliveryDate] = useState("");
  const [filterStatus, setFilterStatus] = useState("");
  const [filterCategory, setFilterCategory] = useState("");

  const { data: requests, isLoading } = useQuery({
    queryKey: ['/api/special-order-requests'],
    queryFn: async () => {
      const res = await fetch('/api/special-order-requests', { credentials: 'include' });
      return res.json() as Promise<SpecialOrderRequest[]>;
    },
    refetchInterval: 30000,
  });

  const resolve = useMutation({
    mutationFn: async ({ id, status, adminNote, items, estimatedDeliveryDate }: {
      id: number; status: string; adminNote: string; items?: SpecialItem[]; estimatedDeliveryDate?: string;
    }) => {
      const res = await fetch(`/api/special-order-requests/${id}`, {
        method: 'PUT', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status, adminNote, items, estimatedDeliveryDate }),
      });
      if (!res.ok) throw new Error();
      return res.json();
    },
    onSuccess: (_, vars) => {
      queryClient.invalidateQueries({ queryKey: ['/api/special-order-requests'] });
      toast({ title: vars.status === 'APPROVED' ? "Pedido pontual aprovado! Cliente notificado." : "Pedido recusado. Cliente notificado." });
      closeModal();
    },
    onError: () => toast({ title: "Erro ao processar", variant: "destructive" }),
  });

  const openReview = (req: SpecialOrderRequest) => {
    setReviewing(req);
    setEditedItems(Array.isArray(req.items) ? req.items.map(i => ({ ...i })) : []);
    setEstimatedDeliveryDate(req.estimatedDeliveryDate || "");
    setRejectionReason(""); setApprovalNote(""); setAction(null);
  };

  const closeModal = () => {
    setReviewing(null); setAction(null); setRejectionReason(""); setApprovalNote("");
    setEditedItems([]); setEstimatedDeliveryDate("");
  };

  const handleReject = () => {
    if (!reviewing) return;
    if (!rejectionReason.trim()) { toast({ title: "Informe o motivo da recusa", variant: "destructive" }); return; }
    resolve.mutate({ id: reviewing.id, status: 'REJECTED', adminNote: rejectionReason.trim() });
  };

  const handleApprove = () => {
    if (!reviewing) return;
    resolve.mutate({
      id: reviewing.id, status: 'APPROVED',
      adminNote: approvalNote.trim() || 'Pedido pontual aprovado!',
      items: editedItems.length > 0 ? editedItems : undefined,
      estimatedDeliveryDate: estimatedDeliveryDate || undefined,
    });
  };

  const updateItemQty = (idx: number, val: string) => {
    setEditedItems(prev => prev.map((it, i) => i === idx ? { ...it, approvedQuantity: val } : it));
  };

  const removeEditItem = (idx: number) => {
    setEditedItems(prev => prev.filter((_, i) => i !== idx));
  };

  const filteredRequests = (requests || []).filter(req => {
    if (filterStatus && req.status !== filterStatus) return false;
    if (filterCategory) {
      const items: SpecialItem[] = Array.isArray(req.items) ? req.items : [];
      if (!items.some(it => it.category === filterCategory)) return false;
    }
    return true;
  });

  const pending = requests?.filter(r => r.status === 'PENDING') || [];

  return (
    <Layout>
      <div className="mb-8">
        <h1 className="text-3xl font-display font-bold text-foreground">Pedidos Pontuais</h1>
        <p className="text-muted-foreground mt-1">Solicitações especiais fora da rotina semanal.</p>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        {[
          { label: "Pendentes", value: pending.length, color: "text-yellow-600", bg: "bg-yellow-100", icon: Clock },
          { label: "Aprovados", value: requests?.filter(r => r.status === 'APPROVED').length || 0, color: "text-green-600", bg: "bg-green-100", icon: CheckCircle },
          { label: "Recusados", value: requests?.filter(r => r.status === 'REJECTED').length || 0, color: "text-red-600", bg: "bg-red-100", icon: XCircle },
        ].map(({ label, value, color, bg, icon: Icon }) => (
          <div key={label} className="bg-card rounded-2xl p-5 border border-border/50 premium-shadow flex items-center gap-4">
            <div className={`w-11 h-11 rounded-xl ${bg} flex items-center justify-center`}>
              <Icon className={`w-6 h-6 ${color}`} />
            </div>
            <div>
              <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider">{label}</p>
              <p className="text-2xl font-display font-bold text-foreground">{value}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="bg-card rounded-2xl border border-border/50 premium-shadow p-4 mb-6 flex flex-wrap gap-3 items-center">
        <Filter className="w-4 h-4 text-muted-foreground" />
        <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)}
          data-testid="select-filter-status"
          className="px-3 py-2 rounded-xl border-2 border-border text-sm focus:border-primary outline-none">
          <option value="">Todos os status</option>
          <option value="PENDING">Pendentes</option>
          <option value="APPROVED">Aprovados</option>
          <option value="REJECTED">Recusados</option>
        </select>
        <select value={filterCategory} onChange={e => setFilterCategory(e.target.value)}
          data-testid="select-filter-category"
          className="px-3 py-2 rounded-xl border-2 border-border text-sm focus:border-primary outline-none">
          <option value="">Todas as categorias</option>
          <option value="Frutas">Frutas</option>
          <option value="Hortifruti / Verduras">Hortifruti / Verduras</option>
          <option value="Industrializados">Industrializados</option>
        </select>
        {(filterStatus || filterCategory) && (
          <button onClick={() => { setFilterStatus(""); setFilterCategory(""); }}
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground font-medium">
            <X className="w-3 h-3" /> Limpar
          </button>
        )}
        <span className="ml-auto text-xs text-muted-foreground font-medium">
          {filteredRequests.length} solicitaç{filteredRequests.length !== 1 ? 'ões' : 'ão'}
        </span>
      </div>

      {/* Table */}
      <div className="bg-card rounded-2xl border border-border/50 premium-shadow overflow-hidden">
        <div className="p-5 border-b border-border/50 bg-muted/20 flex items-center gap-3">
          <Star className="w-5 h-5 text-secondary" />
          <h2 className="font-bold text-foreground">Todas as Solicitações</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="bg-muted/30 border-b border-border/50 text-muted-foreground text-xs uppercase tracking-wider">
                <th className="px-6 py-4 font-semibold">Cliente</th>
                <th className="px-6 py-4 font-semibold">Data</th>
                <th className="px-6 py-4 font-semibold">Produtos</th>
                <th className="px-6 py-4 font-semibold">Categorias</th>
                <th className="px-6 py-4 font-semibold">Status</th>
                <th className="px-6 py-4 font-semibold">Nota</th>
                <th className="px-6 py-4 font-semibold"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/50">
              {isLoading ? (
                <tr><td colSpan={7} className="px-6 py-8 text-center text-muted-foreground">Carregando...</td></tr>
              ) : filteredRequests.length === 0 ? (
                <tr><td colSpan={7} className="px-6 py-8 text-center text-muted-foreground">
                  <Star className="w-10 h-10 text-muted-foreground/30 mx-auto mb-2" />
                  <p>Nenhum pedido pontual encontrado.</p>
                </td></tr>
              ) : (
                filteredRequests.map(req => {
                  const company = companies?.find(c => c.id === req.companyId);
                  const status = STATUS_MAP[req.status] || { label: req.status, color: 'bg-muted text-muted-foreground', icon: Clock };
                  const StatusIcon = status.icon;
                  const reqItems: SpecialItem[] = Array.isArray(req.items) ? req.items : [];
                  const categories = Array.from(new Set(reqItems.map(i => i.category).filter(Boolean)));
                  const hasExternal = reqItems.some(i => i.productType === 'external');

                  return (
                    <tr key={req.id} data-testid={`special-order-row-${req.id}`}
                      className={`hover:bg-muted/10 transition-colors ${req.status === 'PENDING' ? 'border-l-4 border-yellow-400' : req.status === 'REJECTED' ? 'border-l-4 border-red-400' : 'border-l-4 border-green-400'}`}>
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0">
                            <Building2 className="w-4 h-4 text-primary" />
                          </div>
                          <p className="font-bold text-foreground text-sm">{company?.companyName || `#${req.companyId}`}</p>
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <span className="text-sm">
                          <span className="font-medium">{req.requestedDay}</span>
                          {req.requestedDate && (
                            <span className="block text-xs text-muted-foreground">
                              {new Date(req.requestedDate + 'T12:00:00').toLocaleDateString('pt-BR')}
                            </span>
                          )}
                          {req.estimatedDeliveryDate && req.status === 'APPROVED' && (
                            <span className="block text-xs text-green-600 font-semibold">
                              Entrega: {new Date(req.estimatedDeliveryDate + 'T12:00:00').toLocaleDateString('pt-BR')}
                            </span>
                          )}
                        </span>
                      </td>
                      <td className="px-6 py-4">
                        {reqItems.length > 0 ? (
                          <div className="space-y-1">
                            {reqItems.slice(0, 2).map((it, i) => (
                              <p key={i} className="text-xs text-foreground">{it.productName} · <span className="text-muted-foreground">{it.approvedQuantity || it.quantity}</span></p>
                            ))}
                            {reqItems.length > 2 && <p className="text-xs text-muted-foreground">+{reqItems.length - 2} mais</p>}
                          </div>
                        ) : (
                          <span className="text-sm text-muted-foreground truncate block max-w-xs">{req.description}</span>
                        )}
                        {hasExternal && <span className="inline-block mt-1 px-1.5 py-0.5 rounded text-xs font-bold bg-purple-100 text-purple-700">Fora catálogo</span>}
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex flex-wrap gap-1">
                          {categories.map(cat => (
                            <span key={cat} className={`px-1.5 py-0.5 rounded text-xs font-bold ${CATEGORY_COLORS[cat] || 'bg-muted text-muted-foreground'}`}>{cat}</span>
                          ))}
                          {categories.length === 0 && <span className="text-xs text-muted-foreground">—</span>}
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold ${status.color}`}>
                          <StatusIcon className="w-3 h-3" /> {status.label}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-sm max-w-xs">
                        {req.adminNote ? (
                          <span className={`${req.status === 'REJECTED' ? 'text-red-600 font-medium' : 'text-muted-foreground'}`}>
                            {req.adminNote.length > 40 ? req.adminNote.slice(0, 40) + '…' : req.adminNote}
                          </span>
                        ) : <span className="text-muted-foreground">—</span>}
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-2">
                          <button data-testid={`button-review-special-order-${req.id}`}
                            onClick={() => openReview(req)}
                            className={`flex items-center gap-1.5 px-3 py-1.5 font-bold text-xs rounded-xl transition-colors ${
                              req.status === 'PENDING' ? 'bg-primary text-white hover:bg-primary/90' : 'bg-muted text-muted-foreground hover:bg-muted/80'
                            }`}>
                            <Eye className="w-3.5 h-3.5" /> {req.status === 'PENDING' ? 'Revisar' : 'Ver'}
                          </button>
                          <button
                            data-testid={`button-pdf-special-order-${req.id}`}
                            onClick={() => generateSpecialOrderPDF(req, company?.companyName || `Empresa #${req.companyId}`)}
                            title="Gerar PDF"
                            className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-bold rounded-xl border border-secondary/40 text-secondary hover:bg-secondary/10 transition-colors">
                            <FileDown className="w-3.5 h-3.5" /> PDF
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Review modal */}
      {reviewing && (
        <Modal isOpen onClose={closeModal} title="Revisar Pedido Pontual" maxWidth="max-w-2xl">
          <div className="space-y-4">
            {/* PDF Button */}
            {(() => {
              const modalCompany = companies?.find(c => c.id === reviewing.companyId);
              return (
                <div className="flex justify-end">
                  <button
                    data-testid="button-modal-pdf-special-order"
                    onClick={() => generateSpecialOrderPDF(reviewing, modalCompany?.companyName || `Empresa #${reviewing.companyId}`)}
                    className="flex items-center gap-2 px-4 py-2 text-sm font-bold rounded-xl bg-secondary/10 text-secondary border border-secondary/30 hover:bg-secondary/20 transition-colors"
                  >
                    <FileDown className="w-4 h-4" /> Gerar PDF
                  </button>
                </div>
              );
            })()}

            {/* Company + date header */}
            {(() => {
              const company = companies?.find(c => c.id === reviewing.companyId);
              return (
                <div className="p-4 bg-muted/30 rounded-xl border border-border/50">
                  <div className="flex items-center gap-3 mb-3">
                    <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center">
                      <Building2 className="w-5 h-5 text-primary" />
                    </div>
                    <div>
                      <p className="font-bold text-foreground">{company?.companyName || `Empresa #${reviewing.companyId}`}</p>
                      <p className="text-xs text-muted-foreground">Solicitado em {format(new Date(reviewing.createdAt), "d 'de' MMM yyyy", { locale: ptBR })}</p>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3 text-sm">
                    <div>
                      <span className="text-muted-foreground font-semibold text-xs">Dia desejado</span>
                      <p className="font-bold text-foreground">{reviewing.requestedDay}</p>
                      {reviewing.requestedDate && <p className="text-xs text-muted-foreground">{new Date(reviewing.requestedDate + 'T12:00:00').toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' })}</p>}
                    </div>
                    {reviewing.observations && (
                      <div className="col-span-2">
                        <span className="text-muted-foreground font-semibold text-xs">Observações do cliente</span>
                        <p className="text-foreground italic">{reviewing.observations}</p>
                      </div>
                    )}
                  </div>
                </div>
              );
            })()}

            {/* Items editor */}
            {editedItems.length > 0 && (
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <Package className="w-4 h-4 text-primary" />
                  <p className="text-sm font-bold text-foreground">Produtos Solicitados</p>
                  {reviewing.status === 'PENDING' && <span className="text-xs text-muted-foreground">(ajuste as quantidades aprovadas se necessário)</span>}
                </div>
                <div className="space-y-2">
                  {editedItems.map((item, idx) => (
                    <div key={idx} className="p-3 rounded-xl border border-border bg-muted/10 flex items-start gap-3">
                      <div className="flex-1 grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm">
                        <div>
                          <p className="font-semibold text-foreground">{item.productName}</p>
                          {item.brand && <p className="text-xs text-muted-foreground">{item.brand}</p>}
                          <div className="flex gap-1 mt-1 flex-wrap">
                            {item.category && (
                              <span className={`px-1.5 py-0.5 rounded text-xs font-bold ${CATEGORY_COLORS[item.category] || 'bg-muted text-muted-foreground'}`}>
                                {item.category}
                              </span>
                            )}
                            {item.productType === 'external' && (
                              <span className="px-1.5 py-0.5 rounded text-xs font-bold bg-purple-100 text-purple-700">Fora catálogo</span>
                            )}
                          </div>
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground mb-1">Qtd. solicitada: <strong>{item.quantity}</strong></p>
                          {reviewing.status === 'PENDING' && (
                            <div>
                              <label className="text-xs font-semibold text-muted-foreground">Qtd. aprovada</label>
                              <input
                                data-testid={`input-approved-qty-${idx}`}
                                value={item.approvedQuantity ?? item.quantity}
                                onChange={e => updateItemQty(idx, e.target.value)}
                                placeholder={item.quantity}
                                className="w-full px-2 py-1 text-xs rounded-lg border-2 border-border focus:border-primary outline-none mt-0.5"
                              />
                            </div>
                          )}
                          {reviewing.status !== 'PENDING' && item.approvedQuantity && (
                            <p className="text-xs text-green-700 font-semibold">Qtd. aprovada: {item.approvedQuantity}</p>
                          )}
                        </div>
                      </div>
                      {reviewing.status === 'PENDING' && editedItems.length > 1 && (
                        <button type="button" onClick={() => removeEditItem(idx)}
                          className="p-1 rounded-lg text-muted-foreground hover:text-red-500 hover:bg-red-50 transition-colors">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Already resolved */}
            {reviewing.status !== 'PENDING' && (
              <div className={`p-3 rounded-xl border text-sm ${reviewing.status === 'APPROVED' ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'}`}>
                <p className={`font-bold ${reviewing.status === 'APPROVED' ? 'text-green-800' : 'text-red-800'}`}>
                  {reviewing.status === 'APPROVED' ? 'Pedido Aprovado' : 'Pedido Recusado'}
                </p>
                {reviewing.adminNote && <p className={`mt-0.5 ${reviewing.status === 'APPROVED' ? 'text-green-700' : 'text-red-700'}`}>{reviewing.adminNote}</p>}
                {reviewing.estimatedDeliveryDate && (
                  <p className="mt-1 text-green-700 font-semibold">Previsão de entrega: {new Date(reviewing.estimatedDeliveryDate + 'T12:00:00').toLocaleDateString('pt-BR')}</p>
                )}
              </div>
            )}

            {/* Actions — only for PENDING */}
            {reviewing.status === 'PENDING' && (
              <>
                {/* Estimated delivery date */}
                {(action === 'APPROVE' || !action) && (
                  <div>
                    <label className="block text-sm font-semibold mb-1.5 flex items-center gap-1.5">
                      <Calendar className="w-4 h-4 text-primary" /> Previsão de Entrega (opcional)
                    </label>
                    <input type="date" value={estimatedDeliveryDate} onChange={e => setEstimatedDeliveryDate(e.target.value)}
                      data-testid="input-estimated-delivery"
                      className="px-3 py-2 rounded-xl border-2 border-border focus:border-primary outline-none text-sm w-full" />
                  </div>
                )}

                {!action && (
                  <div className="flex gap-3">
                    <button data-testid="button-select-reject" onClick={() => setAction('REJECT')}
                      className="flex-1 py-2.5 border-2 border-red-300 text-red-600 font-bold rounded-xl hover:bg-red-50 transition-colors flex items-center justify-center gap-2">
                      <XCircle className="w-4 h-4" /> Recusar Pedido
                    </button>
                    <button data-testid="button-select-approve" onClick={() => setAction('APPROVE')}
                      className="flex-1 py-2.5 bg-green-600 text-white font-bold rounded-xl hover:bg-green-700 transition-colors flex items-center justify-center gap-2">
                      <CheckCircle className="w-4 h-4" /> Aprovar Pedido
                    </button>
                  </div>
                )}

                {action === 'REJECT' && (
                  <div className="space-y-3 border border-red-200 rounded-xl p-4 bg-red-50">
                    <div className="flex items-center gap-2">
                      <AlertTriangle className="w-4 h-4 text-red-600" />
                      <label className="text-sm font-bold text-red-800">Motivo da recusa (obrigatório)</label>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {REJECTION_PRESETS.map(preset => (
                        <button key={preset} type="button" onClick={() => setRejectionReason(preset)}
                          className={`text-xs px-3 py-1.5 rounded-lg border transition-colors ${rejectionReason === preset ? 'bg-red-600 text-white border-red-600' : 'bg-white text-red-700 border-red-200 hover:bg-red-100'}`}>
                          {preset}
                        </button>
                      ))}
                    </div>
                    <textarea data-testid="input-rejection-reason" value={rejectionReason}
                      onChange={e => setRejectionReason(e.target.value)} rows={3}
                      placeholder="Descreva o motivo da recusa..."
                      className="w-full px-4 py-2.5 rounded-xl border-2 border-red-200 focus:border-red-400 outline-none resize-none text-sm bg-white" />
                    <div className="flex gap-3">
                      <button type="button" onClick={() => setAction(null)} className="flex-1 py-2 text-sm border border-border rounded-xl hover:bg-muted transition-colors">Voltar</button>
                      <button data-testid="button-confirm-reject" onClick={handleReject}
                        disabled={resolve.isPending || !rejectionReason.trim()}
                        className="flex-1 py-2 bg-red-600 text-white font-bold rounded-xl hover:bg-red-700 transition-colors disabled:opacity-50 text-sm flex items-center justify-center gap-2">
                        <XCircle className="w-4 h-4" /> Confirmar Recusa
                      </button>
                    </div>
                  </div>
                )}

                {action === 'APPROVE' && (
                  <div className="space-y-3 border border-green-200 rounded-xl p-4 bg-green-50">
                    <label className="block text-sm font-bold text-green-800">Mensagem para o cliente (opcional)</label>
                    <textarea data-testid="input-approval-note" value={approvalNote}
                      onChange={e => setApprovalNote(e.target.value)} rows={2}
                      placeholder="Ex.: Pedido aprovado! Entrega confirmada para quinta-feira. Preço estimado: R$ 250,00."
                      className="w-full px-4 py-2.5 rounded-xl border-2 border-green-200 focus:border-green-400 outline-none resize-none text-sm bg-white" />
                    <div className="flex gap-3">
                      <button type="button" onClick={() => setAction(null)} className="flex-1 py-2 text-sm border border-border rounded-xl hover:bg-muted transition-colors">Voltar</button>
                      <button data-testid="button-confirm-approve" onClick={handleApprove} disabled={resolve.isPending}
                        className="flex-1 py-2 bg-green-600 text-white font-bold rounded-xl hover:bg-green-700 transition-colors disabled:opacity-50 text-sm flex items-center justify-center gap-2">
                        <CheckCircle className="w-4 h-4" /> Confirmar Aprovação
                      </button>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </Modal>
      )}
    </Layout>
  );
}
