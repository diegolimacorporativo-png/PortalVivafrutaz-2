import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useCompanies } from "@/hooks/use-admin";
import { Layout } from "@/components/Layout";
import { Modal } from "@/components/Modal";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { KeyRound, Building2, CheckCircle, XCircle, Clock, Eye } from "lucide-react";

type PasswordResetRequest = {
  id: number;
  companyId: number;
  status: string;
  newPassword: string | null;
  adminNote: string | null;
  createdAt: string;
  resolvedAt: string | null;
};

function useResetRequests() {
  return useQuery({
    queryKey: ['/api/password-reset-requests'],
    queryFn: async () => {
      const res = await fetch('/api/password-reset-requests', { credentials: 'include' });
      return res.json() as Promise<PasswordResetRequest[]>;
    },
    refetchInterval: 30000,
  });
}

const STATUS_MAP: Record<string, { label: string; color: string; icon: any }> = {
  PENDING: { label: "Pendente", color: "bg-yellow-100 text-yellow-700", icon: Clock },
  APPROVED: { label: "Aprovado", color: "bg-green-100 text-green-700", icon: CheckCircle },
  REJECTED: { label: "Rejeitado", color: "bg-red-100 text-red-700", icon: XCircle },
};

export default function PasswordResetRequestsPage() {
  const { data: requests, isLoading } = useResetRequests();
  const { data: companies } = useCompanies();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [reviewing, setReviewing] = useState<PasswordResetRequest | null>(null);
  const [newPassword, setNewPassword] = useState("");
  const [adminNote, setAdminNote] = useState("");

  const resolve = useMutation({
    mutationFn: async ({ id, status, newPassword, adminNote }: { id: number; status: string; newPassword?: string; adminNote?: string }) => {
      const res = await fetch(`/api/password-reset-requests/${id}`, {
        method: 'PUT', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status, newPassword, adminNote }),
      });
      if (!res.ok) throw new Error('Erro ao processar');
      return res.json();
    },
    onSuccess: (_, vars) => {
      queryClient.invalidateQueries({ queryKey: ['/api/password-reset-requests'] });
      toast({ title: vars.status === 'APPROVED' ? "Senha redefinida com sucesso!" : "Solicitação rejeitada." });
      setReviewing(null);
      setNewPassword("");
      setAdminNote("");
    },
    onError: () => toast({ title: "Erro ao processar solicitação", variant: "destructive" }),
  });

  const pending = requests?.filter(r => r.status === 'PENDING') || [];
  const resolved = requests?.filter(r => r.status !== 'PENDING') || [];

  return (
    <Layout>
      <div className="mb-8">
        <h1 className="text-3xl font-display font-bold text-foreground">Solicitações de Senha</h1>
        <p className="text-muted-foreground mt-1">Gerencie pedidos de recuperação de senha de clientes.</p>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        {[
          { label: "Pendentes", value: pending.length, color: "text-yellow-600", bg: "bg-yellow-100", icon: Clock },
          { label: "Aprovados", value: resolved.filter(r => r.status === 'APPROVED').length, color: "text-green-600", bg: "bg-green-100", icon: CheckCircle },
          { label: "Rejeitados", value: resolved.filter(r => r.status === 'REJECTED').length, color: "text-red-600", bg: "bg-red-100", icon: XCircle },
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

      {/* Table */}
      <div className="bg-card rounded-2xl border border-border/50 premium-shadow overflow-hidden">
        <div className="p-5 border-b border-border/50 bg-muted/20 flex items-center gap-3">
          <KeyRound className="w-5 h-5 text-primary" />
          <h2 className="font-bold text-foreground">Todas as Solicitações</h2>
        </div>

        <table className="w-full text-left">
          <thead>
            <tr className="bg-muted/30 border-b border-border/50 text-muted-foreground text-xs uppercase tracking-wider">
              <th className="px-6 py-4 font-semibold">Empresa</th>
              <th className="px-6 py-4 font-semibold">Data da Solicitação</th>
              <th className="px-6 py-4 font-semibold">Status</th>
              <th className="px-6 py-4 font-semibold">Resolvida em</th>
              <th className="px-6 py-4 font-semibold"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/50">
            {isLoading ? (
              <tr><td colSpan={5} className="px-6 py-8 text-center text-muted-foreground">Carregando...</td></tr>
            ) : !requests?.length ? (
              <tr><td colSpan={5} className="px-6 py-8 text-center text-muted-foreground">
                <KeyRound className="w-10 h-10 text-muted-foreground/30 mx-auto mb-2" />
                <p>Nenhuma solicitação de senha recebida.</p>
              </td></tr>
            ) : (
              requests.map(req => {
                const company = companies?.find(c => c.id === req.companyId);
                const status = STATUS_MAP[req.status] || { label: req.status, color: 'bg-muted text-muted-foreground', icon: Clock };
                const StatusIcon = status.icon;
                return (
                  <tr key={req.id} className={`hover:bg-muted/10 transition-colors ${req.status === 'PENDING' ? 'border-l-4 border-yellow-400' : ''}`}>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center">
                          <Building2 className="w-5 h-5 text-primary" />
                        </div>
                        <div>
                          <p className="font-bold text-foreground">{company?.companyName || `Empresa #${req.companyId}`}</p>
                          <p className="text-xs text-muted-foreground">{company?.email}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4 text-sm text-muted-foreground">
                      {format(new Date(req.createdAt), "d 'de' MMM yyyy 'às' HH:mm", { locale: ptBR })}
                    </td>
                    <td className="px-6 py-4">
                      <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold ${status.color}`}>
                        <StatusIcon className="w-3 h-3" /> {status.label}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-sm text-muted-foreground">
                      {req.resolvedAt ? format(new Date(req.resolvedAt), "d 'de' MMM yyyy", { locale: ptBR }) : "—"}
                    </td>
                    <td className="px-6 py-4">
                      {req.status === 'PENDING' ? (
                        <button
                          onClick={() => { setReviewing(req); setNewPassword(""); setAdminNote(""); }}
                          className="flex items-center gap-1.5 px-4 py-2 bg-primary text-white rounded-xl font-bold text-xs hover:bg-primary/90 transition-colors">
                          <Eye className="w-3.5 h-3.5" /> Revisar
                        </button>
                      ) : (
                        <span className="text-xs text-muted-foreground font-medium">
                          {req.adminNote || "—"}
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Review Modal */}
      {reviewing && (
        <Modal isOpen onClose={() => setReviewing(null)} title="Revisar Solicitação de Senha" maxWidth="max-w-lg">
          <div className="space-y-4">
            {(() => {
              const company = companies?.find(c => c.id === reviewing.companyId);
              return (
                <div className="p-4 bg-muted/30 rounded-xl border border-border/50 flex items-center gap-3">
                  <Building2 className="w-8 h-8 text-primary" />
                  <div>
                    <p className="font-bold text-foreground">{company?.companyName}</p>
                    <p className="text-sm text-muted-foreground">{company?.email}</p>
                  </div>
                </div>
              );
            })()}

            <div>
              <label className="block text-sm font-semibold mb-1">Nova Senha *</label>
              <input type="text" required value={newPassword} onChange={e => setNewPassword(e.target.value)}
                placeholder="Digite a nova senha para o cliente"
                className="w-full px-4 py-2.5 rounded-xl border-2 border-border focus:border-primary outline-none font-mono" />
              <p className="text-xs text-muted-foreground mt-1">A senha será salva imediatamente no cadastro da empresa.</p>
            </div>

            <div>
              <label className="block text-sm font-semibold mb-1">Observação</label>
              <input value={adminNote} onChange={e => setAdminNote(e.target.value)}
                placeholder="Mensagem interna (opcional)"
                className="w-full px-4 py-2.5 rounded-xl border-2 border-border focus:border-primary outline-none" />
            </div>

            <div className="flex gap-3 pt-2">
              <button onClick={() => resolve.mutate({ id: reviewing.id, status: 'REJECTED', adminNote: adminNote || 'Solicitação rejeitada.' })}
                disabled={resolve.isPending}
                className="flex-1 py-2.5 border-2 border-red-300 text-red-600 font-bold rounded-xl hover:bg-red-50 transition-colors disabled:opacity-50">
                <XCircle className="w-4 h-4 inline mr-1" /> Rejeitar
              </button>
              <button onClick={() => {
                if (!newPassword.trim()) return;
                resolve.mutate({ id: reviewing.id, status: 'APPROVED', newPassword: newPassword.trim(), adminNote: adminNote || 'Senha redefinida.' });
              }}
                disabled={resolve.isPending || !newPassword.trim()}
                className="flex-1 py-2.5 bg-primary text-white font-bold rounded-xl hover:bg-primary/90 transition-colors disabled:opacity-50">
                <CheckCircle className="w-4 h-4 inline mr-1" /> Aprovar e Redefinir
              </button>
            </div>
          </div>
        </Modal>
      )}
    </Layout>
  );
}
