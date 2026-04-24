import { useState } from "react";
import { useOrderWindows, useCreateOrderWindow, useUpdateOrderWindow, useSetting, useUpdateSetting } from "@/hooks/use-ordering";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Layout } from "@/components/Layout";
import { Modal } from "@/components/Modal";
import { useToast } from "@/hooks/use-toast";
import {
  CalendarDays, Plus, Clock, Truck, Power, PowerOff,
  ShieldCheck, AlertTriangle, Unlock, Lock, Trash2
} from "lucide-react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";

export default function OrderWindowsPage() {
  const { data: windows, isLoading } = useOrderWindows();
  const createWindow = useCreateOrderWindow();
  const updateWindow = useUpdateOrderWindow();
  const { data: ordersEnabled } = useSetting('orders_enabled');
  const updateSetting = useUpdateSetting();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);

  const deleteWindow = useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch(`/api/order-windows/${id}`, { method: 'DELETE', credentials: 'include' });
      if (!res.ok) throw new Error();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/order-windows'] });
      toast({ title: "Janela excluída com sucesso." });
      setConfirmDeleteId(null);
    },
    onError: () => toast({ title: "Erro ao excluir janela.", variant: "destructive" }),
  });
  const [formData, setFormData] = useState({
    weekReference: "",
    orderOpenDate: "",
    orderCloseDate: "",
    deliveryStartDate: "",
    deliveryEndDate: "",
    forceOpen: false,
  });

  const globalEnabled = ordersEnabled !== 'false'; // default enabled if not set

  const handleToggleGlobal = () => {
    updateSetting.mutate({ key: 'orders_enabled', value: globalEnabled ? 'false' : 'true' });
  };

  const handleToggleForceOpen = (windowId: number, currentForceOpen: boolean) => {
    updateWindow.mutate({ id: windowId, data: { forceOpen: !currentForceOpen } });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await createWindow.mutateAsync(formData);
    setIsModalOpen(false);
    setFormData({ weekReference: "", orderOpenDate: "", orderCloseDate: "", deliveryStartDate: "", deliveryEndDate: "", forceOpen: false });
  };

  return (
    <Layout>
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-8 gap-4">
        <div>
          <h1 className="text-3xl font-display font-bold text-foreground">Janelas de Pedido</h1>
          <p className="text-muted-foreground mt-1">Controle quando e como clientes podem fazer pedidos.</p>
        </div>
        <button
          data-testid="button-new-window"
          onClick={() => setIsModalOpen(true)}
          className="flex items-center gap-2 px-6 py-3 bg-primary text-primary-foreground font-bold rounded-xl shadow-lg shadow-primary/25 hover:shadow-xl hover:-translate-y-0.5 transition-all"
        >
          <Plus className="w-5 h-5" /> Nova Janela
        </button>
      </div>

      {/* Global Control */}
      <div className={`mb-8 p-6 rounded-2xl border-2 premium-shadow ${globalEnabled ? 'border-green-200 bg-green-50' : 'border-red-200 bg-red-50'}`}>
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className={`w-14 h-14 rounded-xl flex items-center justify-center ${globalEnabled ? 'bg-green-600' : 'bg-red-600'}`}>
              {globalEnabled ? <Power className="w-7 h-7 text-white" /> : <PowerOff className="w-7 h-7 text-white" />}
            </div>
            <div>
              <h3 className="text-xl font-bold text-foreground">Controle Global de Pedidos</h3>
              <p className={`text-sm font-medium mt-0.5 ${globalEnabled ? 'text-green-700' : 'text-red-700'}`}>
                {globalEnabled
                  ? 'Pedidos HABILITADOS — clientes podem fazer pedidos normalmente.'
                  : 'Pedidos DESABILITADOS — nenhum cliente consegue fazer pedidos.'}
              </p>
            </div>
          </div>
          <button
            data-testid="button-toggle-orders"
            onClick={handleToggleGlobal}
            disabled={updateSetting.isPending}
            className={`flex items-center gap-2 px-6 py-3 rounded-xl font-bold border-2 transition-all hover:-translate-y-0.5 ${
              globalEnabled
                ? 'bg-red-600 text-white border-red-600 shadow-lg shadow-red-600/20'
                : 'bg-green-600 text-white border-green-600 shadow-lg shadow-green-600/20'
            }`}
          >
            {globalEnabled ? (
              <><Lock className="w-4 h-4" /> Fechar Pedidos</>
            ) : (
              <><Unlock className="w-4 h-4" /> Abrir Pedidos</>
            )}
          </button>
        </div>

        {!globalEnabled && (
          <div className="mt-4 flex items-start gap-2 p-3 bg-red-100 rounded-xl border border-red-200">
            <AlertTriangle className="w-4 h-4 text-red-600 flex-shrink-0 mt-0.5" />
            <p className="text-sm font-medium text-red-800">
              Todos os clientes verão a mensagem "Pedidos temporariamente indisponíveis" ao tentar fazer um pedido.
            </p>
          </div>
        )}
      </div>

      {/* Deadline info */}
      <div className="mb-6 p-4 rounded-xl border border-border/50 bg-muted/20 flex items-start gap-3">
        <Clock className="w-5 h-5 text-primary flex-shrink-0 mt-0.5" />
        <div>
          <p className="text-sm font-bold text-foreground">Regra de prazo padrão</p>
          <p className="text-sm text-muted-foreground mt-0.5">
            Pedidos são bloqueados automaticamente após <strong>quinta-feira às 12:00</strong>.
            Use o botão <strong>"Manter Aberta"</strong> em uma janela específica para liberar pedidos fora desse horário (ex: semanas com feriados).
          </p>
        </div>
      </div>

      {/* Windows list */}
      <div className="grid gap-6">
        {isLoading ? (
          <div className="p-8 text-center text-muted-foreground">Carregando janelas...</div>
        ) : windows?.length === 0 ? (
          <div className="p-8 text-center text-muted-foreground bg-card rounded-2xl border border-border/50">
            Nenhuma janela de pedido cadastrada.
          </div>
        ) : windows?.map(w => {
          const wAny = w as any;
          return (
            <div key={w.id} className={`bg-card rounded-2xl p-6 border premium-shadow ${w.active ? 'border-primary/40 ring-2 ring-primary/10' : 'border-border/50'}`}>
              <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
                <div className="flex items-center gap-4">
                  <div className={`w-14 h-14 rounded-xl flex items-center justify-center ${w.active ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'}`}>
                    <CalendarDays className="w-7 h-7" />
                  </div>
                  <div>
                    <h3 className="text-lg font-bold text-foreground">{w.weekReference}</h3>
                    <div className="flex items-center gap-2 mt-1 flex-wrap">
                      <span className={`px-2.5 py-0.5 rounded-full text-xs font-bold ${w.active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-700'}`}>
                        {w.active ? 'ATIVA' : 'ENCERRADA'}
                      </span>
                      {wAny.forceOpen && (
                        <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-orange-100 text-orange-700 flex items-center gap-1">
                          <ShieldCheck className="w-3 h-3" /> PRAZO ESTENDIDO
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                <div className="flex flex-wrap gap-8 text-sm">
                  <div>
                    <p className="text-muted-foreground font-semibold flex items-center gap-1"><Clock className="w-4 h-4" /> Período de Pedidos</p>
                    <p className="font-medium mt-1">
                      {format(new Date(w.orderOpenDate), "d MMM, HH:mm", { locale: ptBR })} — {format(new Date(w.orderCloseDate), "d MMM, HH:mm", { locale: ptBR })}
                    </p>
                  </div>
                  <div>
                    <p className="text-muted-foreground font-semibold flex items-center gap-1"><Truck className="w-4 h-4" /> Janela de Entrega</p>
                    <p className="font-medium mt-1">
                      {format(new Date(w.deliveryStartDate), "d MMM", { locale: ptBR })} — {format(new Date(w.deliveryEndDate), "d MMM", { locale: ptBR })}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2 flex-wrap">
                  {/* Force open toggle */}
                  {w.active && (
                    <button
                      data-testid={`button-force-open-${w.id}`}
                      onClick={() => handleToggleForceOpen(w.id, wAny.forceOpen ?? false)}
                      disabled={updateWindow.isPending}
                      className={`flex items-center gap-2 px-4 py-2.5 rounded-xl font-bold text-sm border-2 transition-all hover:-translate-y-0.5 ${
                        wAny.forceOpen
                          ? 'bg-orange-100 text-orange-700 border-orange-300'
                          : 'bg-card text-muted-foreground border-border hover:border-primary/50'
                      }`}
                    >
                      <ShieldCheck className="w-4 h-4" />
                      {wAny.forceOpen ? 'Prazo Estendido (clique para reverter)' : 'Manter Aberta'}
                    </button>
                  )}
                  {/* Delete button */}
                  <button
                    data-testid={`button-delete-window-${w.id}`}
                    onClick={() => setConfirmDeleteId(w.id)}
                    className="flex items-center gap-1.5 px-3 py-2 text-red-500 border-2 border-red-200 rounded-xl font-bold text-sm hover:bg-red-50 transition-colors"
                  >
                    <Trash2 className="w-4 h-4" /> Excluir
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Create modal */}
      <Modal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} title="Agendar Janela de Pedido" maxWidth="max-w-2xl">
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-semibold mb-1">Referência da Semana</label>
            <input required value={formData.weekReference} onChange={e => setFormData({ ...formData, weekReference: e.target.value })}
              className="w-full px-4 py-2.5 rounded-xl border-2 border-border focus:border-primary outline-none"
              placeholder="ex: Semana 14 - Abr 2026" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-semibold mb-1">Abertura dos Pedidos</label>
              <input type="datetime-local" required value={formData.orderOpenDate}
                onChange={e => setFormData({ ...formData, orderOpenDate: e.target.value })}
                className="w-full px-4 py-2.5 rounded-xl border-2 border-border focus:border-primary outline-none" />
            </div>
            <div>
              <label className="block text-sm font-semibold mb-1">Encerramento dos Pedidos</label>
              <input type="datetime-local" required value={formData.orderCloseDate}
                onChange={e => setFormData({ ...formData, orderCloseDate: e.target.value })}
                className="w-full px-4 py-2.5 rounded-xl border-2 border-border focus:border-primary outline-none" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-semibold mb-1">Início das Entregas</label>
              <input type="date" required value={formData.deliveryStartDate}
                onChange={e => setFormData({ ...formData, deliveryStartDate: e.target.value })}
                className="w-full px-4 py-2.5 rounded-xl border-2 border-border focus:border-primary outline-none" />
            </div>
            <div>
              <label className="block text-sm font-semibold mb-1">Fim das Entregas</label>
              <input type="date" required value={formData.deliveryEndDate}
                onChange={e => setFormData({ ...formData, deliveryEndDate: e.target.value })}
                className="w-full px-4 py-2.5 rounded-xl border-2 border-border focus:border-primary outline-none" />
            </div>
          </div>

          {/* Force open option */}
          <div className="p-4 rounded-xl border-2 border-border bg-muted/10">
            <label className="flex items-center gap-3 cursor-pointer">
              <input type="checkbox" checked={formData.forceOpen}
                onChange={e => setFormData({ ...formData, forceOpen: e.target.checked })}
                className="w-4 h-4 rounded accent-primary" />
              <div>
                <p className="font-bold text-sm text-foreground flex items-center gap-1">
                  <ShieldCheck className="w-4 h-4 text-orange-600" /> Manter aberta fora do prazo padrão
                </p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Ignora o bloqueio automático de quinta-feira às 12:00. Use em semanas com feriados.
                </p>
              </div>
            </label>
          </div>

          <button type="submit" disabled={createWindow.isPending}
            className="w-full py-3 bg-primary text-white font-bold rounded-xl shadow-lg hover:-translate-y-0.5 transition-transform disabled:opacity-50">
            {createWindow.isPending ? "Publicando..." : "Publicar Janela"}
          </button>
        </form>
      </Modal>

      {/* Delete confirmation modal */}
      {confirmDeleteId !== null && (
        <Modal isOpen onClose={() => setConfirmDeleteId(null)} title="Excluir Janela de Pedido" maxWidth="max-w-sm">
          <div className="space-y-4 text-center">
            <div className="w-16 h-16 rounded-full bg-red-100 flex items-center justify-center mx-auto">
              <Trash2 className="w-8 h-8 text-red-600" />
            </div>
            <p className="text-foreground">Tem certeza que deseja excluir esta janela de pedido? Pedidos vinculados não serão afetados.</p>
            <div className="flex gap-3">
              <button onClick={() => setConfirmDeleteId(null)} className="flex-1 py-2.5 border-2 border-border font-bold rounded-xl">Cancelar</button>
              <button onClick={() => deleteWindow.mutate(confirmDeleteId!)} disabled={deleteWindow.isPending}
                className="flex-1 py-2.5 bg-red-600 text-white font-bold rounded-xl hover:bg-red-700 transition-colors disabled:opacity-50">
                {deleteWindow.isPending ? "Excluindo..." : "Excluir"}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </Layout>
  );
}
