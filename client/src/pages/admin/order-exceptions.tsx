import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useCompanies } from "@/hooks/use-admin";
import { Layout } from "@/components/Layout";
import { Modal } from "@/components/Modal";
import { useToast } from "@/hooks/use-toast";
import { format, isAfter, parseISO } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Plus, ShieldCheck, Building2, AlertTriangle, Trash2, Edit2, CheckCircle, XCircle, Calendar } from "lucide-react";

type OrderException = {
  id: number;
  companyId: number;
  reason: string;
  expiryDate: string | null;
  active: boolean;
  createdAt: string;
};

function useOrderExceptions() {
  return useQuery({
    queryKey: ['/api/order-exceptions'],
    queryFn: async () => {
      const res = await fetch('/api/order-exceptions', { credentials: 'include' });
      return res.json() as Promise<OrderException[]>;
    }
  });
}

const emptyForm = {
  companyId: "",
  reason: "",
  expiryDate: "",
  active: true,
};

function isExpired(date: string | null): boolean {
  if (!date) return false;
  return !isAfter(parseISO(date), new Date());
}

export default function OrderExceptionsPage() {
  const { data: exceptions, isLoading } = useOrderExceptions();
  const { data: companies } = useCompanies();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editing, setEditing] = useState<OrderException | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [deleteTarget, setDeleteTarget] = useState<OrderException | null>(null);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['/api/order-exceptions'] });

  const create = useMutation({
    mutationFn: async (data: any) => {
      const res = await fetch('/api/order-exceptions', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error('Erro ao criar exceção');
      return res.json();
    },
    onSuccess: () => { invalidate(); toast({ title: "Exceção criada com sucesso!" }); closeModal(); },
    onError: () => toast({ title: "Erro ao criar exceção", variant: "destructive" }),
  });

  const update = useMutation({
    mutationFn: async ({ id, data }: { id: number; data: any }) => {
      const res = await fetch(`/api/order-exceptions/${id}`, {
        method: 'PUT', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error('Erro ao atualizar');
      return res.json();
    },
    onSuccess: () => { invalidate(); toast({ title: "Exceção atualizada!" }); closeModal(); },
    onError: () => toast({ title: "Erro ao atualizar", variant: "destructive" }),
  });

  const remove = useMutation({
    mutationFn: async (id: number) => {
      await fetch(`/api/order-exceptions/${id}`, { method: 'DELETE', credentials: 'include' });
    },
    onSuccess: () => { invalidate(); toast({ title: "Exceção removida.", variant: "destructive" }); setDeleteTarget(null); },
  });

  const openCreate = () => { setEditing(null); setForm(emptyForm); setIsModalOpen(true); };
  const openEdit = (e: OrderException) => {
    setEditing(e);
    setForm({ companyId: String(e.companyId), reason: e.reason, expiryDate: e.expiryDate || "", active: e.active });
    setIsModalOpen(true);
  };
  const closeModal = () => { setIsModalOpen(false); setEditing(null); };
  const set = (field: string, value: any) => setForm(prev => ({ ...prev, [field]: value }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const data = {
      companyId: Number(form.companyId),
      reason: form.reason,
      expiryDate: form.expiryDate || null,
      active: form.active,
    };
    if (editing) {
      update.mutate({ id: editing.id, data });
    } else {
      create.mutate(data);
    }
  };

  const isPending = create.isPending || update.isPending;
  const active = exceptions?.filter(e => e.active && !isExpired(e.expiryDate)) || [];
  const inactive = exceptions?.filter(e => !e.active || isExpired(e.expiryDate)) || [];

  return (
    <Layout>
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-8 gap-4">
        <div>
          <h1 className="text-3xl font-display font-bold text-foreground">Clientes com Exceção de Pedidos</h1>
          <p className="text-muted-foreground mt-1">
            Empresas que podem fazer pedidos mesmo após o fechamento da janela ou prazo de quinta-feira.
          </p>
        </div>
        <button
          data-testid="button-add-exception"
          onClick={openCreate}
          className="flex items-center gap-2 px-6 py-3 bg-primary text-white font-bold rounded-xl shadow-lg hover:-translate-y-0.5 transition-all"
        >
          <Plus className="w-5 h-5" /> Adicionar Exceção
        </button>
      </div>

      {/* Info banner */}
      <div className="p-4 bg-blue-50 border border-blue-200 rounded-2xl mb-6 flex items-start gap-3">
        <ShieldCheck className="w-6 h-6 text-blue-600 flex-shrink-0 mt-0.5" />
        <div>
          <p className="font-bold text-blue-900">Como funciona</p>
          <p className="text-sm text-blue-700 mt-0.5">
            Empresas nesta lista podem fazer pedidos mesmo quando o sistema estiver fechado (quinta após 12h, janela fechada, ou modo off). A exceção expira na data definida ou permanece ativa até ser desativada manualmente.
          </p>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 gap-4 mb-6">
        <div className="bg-card rounded-2xl p-5 border border-border/50 premium-shadow flex items-center gap-4">
          <div className="w-11 h-11 rounded-xl bg-green-100 flex items-center justify-center">
            <CheckCircle className="w-6 h-6 text-green-600" />
          </div>
          <div>
            <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Exceções Ativas</p>
            <p className="text-2xl font-display font-bold text-foreground">{active.length}</p>
          </div>
        </div>
        <div className="bg-card rounded-2xl p-5 border border-border/50 premium-shadow flex items-center gap-4">
          <div className="w-11 h-11 rounded-xl bg-muted flex items-center justify-center">
            <XCircle className="w-6 h-6 text-muted-foreground" />
          </div>
          <div>
            <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Inativas / Expiradas</p>
            <p className="text-2xl font-display font-bold text-foreground">{inactive.length}</p>
          </div>
        </div>
      </div>

      <div className="bg-card rounded-2xl border border-border/50 premium-shadow overflow-hidden">
        <table className="w-full text-left">
          <thead>
            <tr className="bg-muted/30 border-b border-border/50 text-muted-foreground text-xs uppercase tracking-wider">
              <th className="px-6 py-4 font-semibold">Empresa</th>
              <th className="px-6 py-4 font-semibold">Motivo</th>
              <th className="px-6 py-4 font-semibold">Validade</th>
              <th className="px-6 py-4 font-semibold">Status</th>
              <th className="px-6 py-4 font-semibold"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/50">
            {isLoading ? (
              <tr><td colSpan={5} className="px-6 py-8 text-center text-muted-foreground">Carregando...</td></tr>
            ) : !exceptions?.length ? (
              <tr><td colSpan={5} className="px-6 py-8 text-center text-muted-foreground">Nenhuma exceção cadastrada.</td></tr>
            ) : (
              exceptions.map(exc => {
                const company = companies?.find(c => c.id === exc.companyId);
                const expired = isExpired(exc.expiryDate);
                const effectivelyActive = exc.active && !expired;
                return (
                  <tr key={exc.id} className={`hover:bg-muted/10 transition-colors ${!effectivelyActive ? 'opacity-60' : ''}`}>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center">
                          <Building2 className="w-5 h-5 text-primary" />
                        </div>
                        <div>
                          <p className="font-bold text-foreground">{company?.companyName || `Empresa #${exc.companyId}`}</p>
                          <p className="text-xs text-muted-foreground">{company?.email}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4 text-sm text-foreground max-w-xs">
                      <p className="line-clamp-2">{exc.reason}</p>
                    </td>
                    <td className="px-6 py-4">
                      {exc.expiryDate ? (
                        <div className={`flex items-center gap-1 text-sm ${expired ? 'text-red-600 font-bold' : 'text-foreground'}`}>
                          <Calendar className="w-4 h-4" />
                          {format(parseISO(exc.expiryDate), "d MMM yyyy", { locale: ptBR })}
                          {expired && <span className="text-xs bg-red-100 text-red-700 px-1.5 py-0.5 rounded font-bold ml-1">Expirada</span>}
                        </div>
                      ) : (
                        <span className="text-sm text-muted-foreground">Sem data de expiração</span>
                      )}
                    </td>
                    <td className="px-6 py-4">
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold ${effectivelyActive ? 'bg-green-100 text-green-700' : 'bg-muted text-muted-foreground'}`}>
                        {effectivelyActive ? <><CheckCircle className="w-3 h-3" /> Ativa</> : <><XCircle className="w-3 h-3" /> Inativa</>}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-1">
                        <button onClick={() => openEdit(exc)} className="p-2 text-muted-foreground hover:text-primary hover:bg-primary/10 rounded-lg transition-colors">
                          <Edit2 className="w-4 h-4" />
                        </button>
                        <button onClick={() => setDeleteTarget(exc)} className="p-2 text-muted-foreground hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors">
                          <Trash2 className="w-4 h-4" />
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

      {/* Create/Edit Modal */}
      <Modal isOpen={isModalOpen} onClose={closeModal} title={editing ? "Editar Exceção" : "Nova Exceção de Pedidos"} maxWidth="max-w-lg">
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-semibold mb-1">Empresa *</label>
            <select required value={form.companyId} onChange={e => set("companyId", e.target.value)}
              className="w-full px-4 py-2.5 rounded-xl border-2 border-border focus:border-primary outline-none">
              <option value="">Selecione uma empresa...</option>
              {companies?.map(c => <option key={c.id} value={c.id}>{c.companyName}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-semibold mb-1">Motivo da Exceção *</label>
            <textarea required value={form.reason} onChange={e => set("reason", e.target.value)} rows={3}
              placeholder="ex: Cliente VIP com contrato especial, aguardando normalização de janelas..."
              className="w-full px-4 py-2.5 rounded-xl border-2 border-border focus:border-primary outline-none resize-none" />
          </div>
          <div>
            <label className="flex items-center gap-1 text-sm font-semibold mb-1">
              <Calendar className="w-4 h-4" /> Data de Expiração
            </label>
            <input type="date" value={form.expiryDate} onChange={e => set("expiryDate", e.target.value)}
              className="w-full px-4 py-2.5 rounded-xl border-2 border-border focus:border-primary outline-none" />
            <p className="text-xs text-muted-foreground mt-1">Deixe em branco para exceção permanente (até desativação manual).</p>
          </div>
          <div>
            <label className="block text-sm font-semibold mb-2">Status</label>
            <div className="flex gap-3">
              <button type="button" onClick={() => set("active", true)}
                className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold border-2 transition-all ${form.active ? 'bg-green-600 text-white border-green-600' : 'border-border text-muted-foreground'}`}>
                <CheckCircle className="w-4 h-4" /> Ativa
              </button>
              <button type="button" onClick={() => set("active", false)}
                className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold border-2 transition-all ${!form.active ? 'bg-red-600 text-white border-red-600' : 'border-border text-muted-foreground'}`}>
                <XCircle className="w-4 h-4" /> Inativa
              </button>
            </div>
          </div>
          <button type="submit" disabled={isPending}
            className="w-full py-3 bg-primary text-white font-bold rounded-xl hover:-translate-y-0.5 transition-all disabled:opacity-50">
            {isPending ? "Salvando..." : editing ? "Salvar Alterações" : "Adicionar Exceção"}
          </button>
        </form>
      </Modal>

      {/* Delete Confirm */}
      {deleteTarget && (
        <Modal isOpen onClose={() => setDeleteTarget(null)} title="Remover Exceção" maxWidth="max-w-sm">
          <div className="space-y-4">
            <div className="p-4 bg-orange-50 rounded-xl border border-orange-200 text-center">
              <AlertTriangle className="w-10 h-10 text-orange-500 mx-auto mb-2" />
              <p className="font-bold text-orange-800">Remover exceção desta empresa?</p>
              <p className="text-sm text-orange-700 mt-1">A empresa voltará a seguir as regras normais de pedido.</p>
            </div>
            <div className="flex gap-3">
              <button onClick={() => setDeleteTarget(null)} className="flex-1 py-2.5 border-2 border-border rounded-xl font-bold text-muted-foreground hover:bg-muted transition-colors">Cancelar</button>
              <button onClick={() => remove.mutate(deleteTarget.id)} disabled={remove.isPending}
                className="flex-1 py-2.5 bg-red-600 text-white font-bold rounded-xl hover:bg-red-700 transition-colors disabled:opacity-50">
                {remove.isPending ? "Removendo..." : "Remover"}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </Layout>
  );
}
