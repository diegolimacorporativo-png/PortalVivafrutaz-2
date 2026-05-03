import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Layout } from "@/components/Layout";
import { Modal } from "@/components/Modal";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import { UserCircle, Plus, Pencil, Trash2, Shield, ShieldCheck, DollarSign, Code, Crown, BarChart3, KeyRound, AlertTriangle, Lock, Unlock, FlaskConical, ChevronDown, ChevronRight, Truck, Leaf } from "lucide-react";
import { fetchWithAuth } from "@/lib/fetchWithAuth";

type AdminUser = {
  id: number; name: string; email: string; password: string; role: string; active: boolean;
  tabPermissions: string[] | null;
  testMode: boolean;
  permissions: Record<string, boolean> | null;
};

const PERMISSIONS_CONFIG: { key: string; label: string; group: string; defaultOn: boolean }[] = [
  { key: 'verPedidos', label: 'Ver Pedidos', group: 'Pedidos', defaultOn: true },
  { key: 'criarPedidos', label: 'Criar Pedidos', group: 'Pedidos', defaultOn: true },
  { key: 'editarPedidos', label: 'Editar Pedidos', group: 'Pedidos', defaultOn: true },
  { key: 'excluirPedidos', label: 'Excluir Pedidos', group: 'Pedidos', defaultOn: false },
  { key: 'verCompras', label: 'Ver Compras', group: 'Compras', defaultOn: true },
  { key: 'criarCompras', label: 'Criar Compras', group: 'Compras', defaultOn: false },
  { key: 'acessarInventario', label: 'Acessar Inventário', group: 'Compras', defaultOn: true },
  { key: 'editarInventario', label: 'Editar Inventário', group: 'Compras', defaultOn: false },
  { key: 'verFinanceiro', label: 'Ver Financeiro', group: 'Financeiro', defaultOn: true },
  { key: 'editarFinanceiro', label: 'Editar Financeiro', group: 'Financeiro', defaultOn: false },
  { key: 'gerarNotaFiscal', label: 'Gerar Nota Fiscal', group: 'Financeiro', defaultOn: true },
  { key: 'exportarBling', label: 'Exportar para Bling', group: 'Financeiro', defaultOn: true },
  { key: 'editarClientes', label: 'Editar Clientes', group: 'Clientes', defaultOn: true },
  { key: 'excluirClientes', label: 'Excluir Clientes', group: 'Clientes', defaultOn: false },
  { key: 'verRelatorios', label: 'Ver Relatórios', group: 'Relatórios', defaultOn: true },
  { key: 'acessarVigilanciaSanitaria', label: 'Acessar Vigilância Sanitária', group: 'Qualidade', defaultOn: false },
  { key: 'editarVigilanciaSanitaria', label: 'Editar Checklist/Avaliações', group: 'Qualidade', defaultOn: false },
];

const PERMISSIONS_GROUPS = ['Pedidos', 'Compras', 'Financeiro', 'Clientes', 'Relatórios', 'Qualidade'];

const DEFAULT_PERMS: Record<string, boolean> = Object.fromEntries(
  PERMISSIONS_CONFIG.map(p => [p.key, p.defaultOn])
);

// All system tabs with labels and role access
const ALL_TABS: { key: string; label: string; roles: string[] }[] = [
  { key: 'dashboard', label: 'Dashboard (Painel)', roles: ['ADMIN', 'DIRECTOR', 'LOGISTICS', 'DEVELOPER', 'OPERATIONS_MANAGER', 'PURCHASE_MANAGER', 'FINANCEIRO'] },
  { key: 'orders', label: 'Pedidos', roles: ['ADMIN', 'DIRECTOR', 'OPERATIONS_MANAGER', 'FINANCEIRO', 'LOGISTICS', 'SISTEMA_TESTE'] },
  { key: 'special-orders', label: 'Pedidos Pontuais', roles: ['ADMIN', 'DIRECTOR', 'OPERATIONS_MANAGER', 'DEVELOPER', 'LOGISTICS', 'SISTEMA_TESTE'] },
  { key: 'companies', label: 'Empresas', roles: ['ADMIN', 'DIRECTOR'] },
  { key: 'products', label: 'Produtos', roles: ['ADMIN', 'DIRECTOR'] },
  { key: 'categories', label: 'Categorias', roles: ['ADMIN', 'DIRECTOR'] },
  { key: 'price-groups', label: 'Grupos de Preço', roles: ['ADMIN', 'DIRECTOR'] },
  { key: 'order-windows', label: 'Janelas de Pedido', roles: ['ADMIN', 'DIRECTOR', 'OPERATIONS_MANAGER'] },
  { key: 'order-exceptions', label: 'Exceções de Pedido', roles: ['ADMIN', 'DIRECTOR'] },
  { key: 'purchasing', label: 'Compras', roles: ['ADMIN', 'DIRECTOR', 'PURCHASE_MANAGER'] },
  { key: 'industrialized', label: 'Industrializados', roles: ['ADMIN', 'DIRECTOR', 'PURCHASE_MANAGER'] },
  { key: 'financial', label: 'Painel Financeiro', roles: ['ADMIN', 'DIRECTOR', 'FINANCEIRO'] },
  { key: 'password-reset', label: 'Senhas de Clientes', roles: ['ADMIN', 'DIRECTOR'] },
  { key: 'tasks', label: 'Tarefas', roles: ['ADMIN', 'DIRECTOR', 'DEVELOPER', 'OPERATIONS_MANAGER', 'PURCHASE_MANAGER', 'FINANCEIRO', 'LOGISTICS'] },
  { key: 'incidents', label: 'Ocorrências de Clientes', roles: ['ADMIN', 'DIRECTOR', 'DEVELOPER', 'OPERATIONS_MANAGER', 'LOGISTICS'] },
  { key: 'internal-incidents', label: 'Ocorrências Internas', roles: ['ADMIN', 'DIRECTOR', 'DEVELOPER', 'OPERATIONS_MANAGER', 'LOGISTICS'] },
  { key: 'logistics', label: 'Logística', roles: ['ADMIN', 'DIRECTOR', 'DEVELOPER', 'OPERATIONS_MANAGER', 'LOGISTICS'] },
  { key: 'quotations', label: 'Cotação de Empresas', roles: ['ADMIN', 'DIRECTOR', 'DEVELOPER', 'OPERATIONS_MANAGER'] },
  { key: 'users', label: 'Usuários do Sistema', roles: ['ADMIN', 'DIRECTOR', 'DEVELOPER'] },
  { key: 'backups', label: 'Backup & E-mails', roles: ['ADMIN', 'DIRECTOR', 'DEVELOPER'] },
  { key: 'developer', label: 'Área do Desenvolvedor', roles: ['ADMIN', 'DIRECTOR', 'DEVELOPER'] },
  { key: 'executive', label: 'Dashboard Executivo', roles: ['ADMIN', 'DIRECTOR', 'FINANCEIRO', 'DEVELOPER'] },
  { key: 'announcements', label: 'Painel de Avisos', roles: ['ADMIN', 'DIRECTOR', 'DEVELOPER'] },
  { key: 'waste-control', label: 'Controle de Desperdício', roles: ['ADMIN', 'DIRECTOR', 'DEVELOPER', 'OPERATIONS_MANAGER', 'PURCHASE_MANAGER', 'LOGISTICS'] },
  { key: 'purchase-planning', label: 'Planejamento de Compras', roles: ['ADMIN', 'DIRECTOR', 'DEVELOPER', 'PURCHASE_MANAGER', 'OPERATIONS_MANAGER'] },
  { key: 'sanitary', label: 'Vigilância Sanitária', roles: ['ADMIN', 'DIRECTOR', 'DEVELOPER', 'NUTRICIONISTA', 'OPERATIONS_MANAGER'] },
];

const ROLES = [
  { value: "MASTER", label: "Master", desc: "Controle absoluto do sistema — acesso irrestrito", icon: Shield, color: "text-purple-700 bg-purple-100" },
  { value: "ADMIN", label: "Administrador", desc: "Acesso total ao sistema", icon: Shield, color: "text-red-600 bg-red-100" },
  { value: "DIRECTOR", label: "Diretor", desc: "Acesso total + alterar qualquer senha", icon: Crown, color: "text-yellow-700 bg-yellow-100" },
  { value: "OPERATIONS_MANAGER", label: "Gerente de Operações", desc: "Janelas de pedido e pedidos", icon: ShieldCheck, color: "text-blue-600 bg-blue-100" },
  { value: "PURCHASE_MANAGER", label: "Gerente de Compras", desc: "Compras e relatórios", icon: DollarSign, color: "text-green-600 bg-green-100" },
  { value: "FINANCEIRO", label: "Financeiro", desc: "Pedidos, painel financeiro e exportações", icon: BarChart3, color: "text-emerald-600 bg-emerald-100" },
  { value: "DEVELOPER", label: "Desenvolvedor", desc: "Acesso técnico + logs + backups", icon: Code, color: "text-purple-600 bg-purple-100" },
  { value: "LOGISTICS", label: "Logística", desc: "Pedidos, rotas, motoristas e ocorrências", icon: AlertTriangle, color: "text-orange-600 bg-orange-100" },
  { value: "MOTORISTA", label: "Motorista", desc: "Acesso restrito: Painel do Motorista, GPS, rotas do dia e notas fiscais da rota", icon: Truck, color: "text-teal-600 bg-teal-100" },
  { value: "NUTRICIONISTA", label: "Nutricionista", desc: "Acesso total ao módulo de Vigilância Sanitária — checklist, avaliações e relatórios", icon: Leaf, color: "text-lime-700 bg-lime-100" },
  { value: "SISTEMA_TESTE", label: "Usuário de Teste", desc: "Acesso para testes — pedidos marcados como TESTE", icon: FlaskConical, color: "text-cyan-700 bg-cyan-100" },
];

const PRIVILEGED_ROLES = ['MASTER', 'ADMIN', 'DIRECTOR', 'DEVELOPER'];
const TEMP_PASSWORD = "Viva2026@";

const blank = {
  name: "", email: "", password: "", role: "ADMIN", active: true,
  tabPermissions: null as string[] | null,
  testMode: false,
  permissions: null as Record<string, boolean> | null,
};

function AdvancedPermissionsSection({
  permissions,
  onChange,
}: {
  permissions: Record<string, boolean> | null;
  onChange: (perms: Record<string, boolean> | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const active = permissions !== null;

  const toggle = (key: string) => {
    const current = permissions ?? DEFAULT_PERMS;
    onChange({ ...current, [key]: !current[key] });
  };

  const getVal = (key: string) => {
    if (permissions === null) return DEFAULT_PERMS[key] ?? true;
    return permissions[key] ?? true;
  };

  return (
    <div className={`border rounded-xl overflow-hidden ${active ? 'border-violet-200' : 'border-border/60'}`}>
      <button type="button"
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between p-4 text-left hover:bg-muted/20 transition-colors">
        <div className="flex items-center gap-2">
          <Shield className="w-4 h-4 text-violet-500" />
          <p className="font-semibold text-sm text-foreground">Permissões Avançadas</p>
          {active && <span className="text-xs px-2 py-0.5 rounded-full bg-violet-100 text-violet-700 font-bold">Personalizado</span>}
        </div>
        <div className="flex items-center gap-2">
          {!active && (
            <button type="button"
              onClick={e => { e.stopPropagation(); onChange(DEFAULT_PERMS); setOpen(true); }}
              className="text-xs px-2 py-1 rounded-lg bg-violet-50 text-violet-700 border border-violet-200 hover:bg-violet-100 font-medium">
              Personalizar
            </button>
          )}
          {active && (
            <button type="button"
              onClick={e => { e.stopPropagation(); onChange(null); }}
              className="text-xs px-2 py-1 rounded-lg bg-muted text-muted-foreground border border-border/50 hover:bg-muted/80 font-medium">
              Usar padrão
            </button>
          )}
          {open ? <ChevronDown className="w-4 h-4 text-muted-foreground" /> : <ChevronRight className="w-4 h-4 text-muted-foreground" />}
        </div>
      </button>

      {open && (
        <div className="px-4 pb-4 space-y-3 border-t border-border/40 pt-3">
          {!active && (
            <p className="text-xs text-muted-foreground">As permissões seguem os padrões do perfil do usuário. Clique em "Personalizar" para definir permissões específicas.</p>
          )}
          {active && PERMISSIONS_GROUPS.map(group => {
            const groupPerms = PERMISSIONS_CONFIG.filter(p => p.group === group);
            return (
              <div key={group}>
                <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-2">{group}</p>
                <div className="grid grid-cols-2 gap-1.5">
                  {groupPerms.map(p => (
                    <label key={p.key}
                      className={`flex items-center gap-2 p-2 rounded-lg cursor-pointer border transition-colors ${getVal(p.key) ? 'bg-violet-50 border-violet-200' : 'bg-muted/30 border-border/40'}`}>
                      <input type="checkbox" checked={getVal(p.key)}
                        onChange={() => toggle(p.key)}
                        data-testid={`perm-${p.key}`}
                        className="w-3.5 h-3.5 rounded accent-violet-600" />
                      <span className={`text-xs font-medium ${getVal(p.key) ? 'text-foreground' : 'text-muted-foreground'}`}>{p.label}</span>
                    </label>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default function UsersAdminPage() {
  const { toast } = useToast();
  const { user: me } = useAuth();
  const queryClient = useQueryClient();
  const [modal, setModal] = useState<{ open: boolean; editing: AdminUser | null }>({ open: false, editing: null });
  const [form, setForm] = useState(blank);
  const [confirmDelete, setConfirmDelete] = useState<AdminUser | null>(null);
  const [pwdModal, setPwdModal] = useState<AdminUser | null>(null);
  const [pwdConfirm, setPwdConfirm] = useState<{ user: AdminUser; newPwd: string } | null>(null);
  const [newPwd, setNewPwd] = useState(TEMP_PASSWORD);
  const [useCustomPwd, setUseCustomPwd] = useState(false);

  const canManageUsers = me && PRIVILEGED_ROLES.includes(me.role);

  const { data: users, isLoading } = useQuery({
    queryKey: ['/api/users'],
    queryFn: async () => {
      const res = await fetchWithAuth('/api/users');
      return res.json() as Promise<AdminUser[]>;
    },
  });

  const save = useMutation({
    mutationFn: async () => {
      const isEdit = !!modal.editing;
      const url = isEdit ? `/api/users/${modal.editing!.id}` : '/api/users';
      const res = await fetchWithAuth(url, {
        method: isEdit ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      if (!res.ok) { const d = await res.json(); throw new Error(d.message || 'Erro'); }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/users'] });
      toast({ title: modal.editing ? "Usuário atualizado!" : "Usuário criado!" });
      setModal({ open: false, editing: null });
      setForm(blank);
    },
    onError: (e: any) => toast({ title: e.message || "Erro ao salvar", variant: "destructive" }),
  });

  const del = useMutation({
    mutationFn: async (id: number) => {
      await fetchWithAuth(`/api/users/${id}`, { method: 'DELETE' });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/users'] });
      toast({ title: "Usuário removido." });
      setConfirmDelete(null);
    },
  });

  const changePassword = useMutation({
    mutationFn: async ({ userId, password }: { userId: number; password: string }) => {
      const res = await fetchWithAuth(`/api/users/${userId}/password`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ newPassword: password }),
      });
      if (!res.ok) { const d = await res.json(); throw new Error(d.message || 'Erro'); }
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Senha alterada com sucesso!" });
      setPwdConfirm(null);
      setPwdModal(null);
      setNewPwd(TEMP_PASSWORD);
      setUseCustomPwd(false);
    },
    onError: (e: any) => toast({ title: e.message, variant: "destructive" }),
  });

  const openCreate = () => { setForm(blank); setModal({ open: true, editing: null }); };
  const openEdit = (u: AdminUser) => {
    setForm({
      name: u.name, email: u.email, password: '', role: u.role, active: u.active !== false,
      tabPermissions: u.tabPermissions ?? null,
      testMode: u.testMode ?? false,
      permissions: u.permissions ?? null,
    });
    setModal({ open: true, editing: u });
  };

  // Tab permissions helpers
  const roleTabsForRole = (role: string) => ALL_TABS.filter(t => t.roles.includes(role));
  const isTabChecked = (key: string) => {
    if (!form.tabPermissions) return true; // null = all allowed
    return form.tabPermissions.includes(key);
  };
  const toggleTab = (key: string) => {
    const roleTabs = roleTabsForRole(form.role).map(t => t.key);
    if (!form.tabPermissions) {
      // First toggle: set to all minus this one
      setForm(f => ({ ...f, tabPermissions: roleTabs.filter(k => k !== key) }));
    } else {
      const newPerms = form.tabPermissions.includes(key)
        ? form.tabPermissions.filter(k => k !== key)
        : [...form.tabPermissions, key];
      setForm(f => ({ ...f, tabPermissions: newPerms.length === roleTabs.length ? null : newPerms }));
    }
  };
  const resetTabPerms = () => setForm(f => ({ ...f, tabPermissions: null }));
  const enableCustomPerms = () => setForm(f => ({ ...f, tabPermissions: roleTabsForRole(f.role).map(t => t.key) }));

  const openPasswordChange = (u: AdminUser) => {
    if (!canManageUsers) {
      toast({ title: "Acesso restrito. Apenas diretoria ou administração podem alterar esta senha.", variant: "destructive" });
      return;
    }
    setNewPwd(TEMP_PASSWORD);
    setUseCustomPwd(false);
    setPwdModal(u);
  };

  return (
    <Layout>
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-8 gap-4">
        <div>
          <h1 className="text-3xl font-display font-bold text-foreground">Usuários do Sistema</h1>
          <p className="text-muted-foreground mt-1">Gerencie os membros da equipe e suas permissões.</p>
        </div>
        {canManageUsers && (
          <button onClick={openCreate} data-testid="button-new-user"
            className="flex items-center gap-2 px-6 py-3 bg-primary text-primary-foreground font-bold rounded-xl shadow-lg shadow-primary/25 hover:-translate-y-0.5 transition-all">
            <Plus className="w-5 h-5" /> Novo Usuário
          </button>
        )}
      </div>

      {/* Role reference */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        {ROLES.map(r => {
          const Icon = r.icon;
          return (
            <div key={r.value} className="bg-card rounded-xl p-4 border border-border/50 flex items-start gap-3">
              <div className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 ${r.color}`}>
                <Icon className="w-5 h-5" />
              </div>
              <div>
                <p className="text-xs font-bold text-foreground">{r.label}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{r.desc}</p>
                <p className="text-xs font-bold text-muted-foreground/60 mt-1">
                  {users?.filter(u => u.role === r.value).length || 0} usuário(s)
                </p>
              </div>
            </div>
          );
        })}
      </div>

      {/* Users table */}
      <div className="bg-card rounded-2xl border border-border/50 premium-shadow overflow-hidden">
        <div className="p-5 border-b border-border/50 bg-muted/20 flex items-center gap-3">
          <UserCircle className="w-5 h-5 text-primary" />
          <h2 className="font-bold text-foreground">Equipe Cadastrada</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="bg-muted/30 border-b border-border/50 text-muted-foreground text-xs uppercase tracking-wider">
                <th className="px-6 py-4 font-semibold">Nome</th>
                <th className="px-6 py-4 font-semibold">Email</th>
                <th className="px-6 py-4 font-semibold">Perfil</th>
                <th className="px-6 py-4 font-semibold">Status</th>
                {canManageUsers && <th className="px-6 py-4 font-semibold text-right">Ações</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-border/50">
              {isLoading ? (
                <tr><td colSpan={5} className="px-6 py-8 text-center text-muted-foreground">Carregando...</td></tr>
              ) : users?.map(u => {
                const role = ROLES.find(r => r.value === u.role);
                const Icon = role?.icon || UserCircle;
                const isSelf = me && (me as any).id === u.id;
                return (
                  <tr key={u.id} className="hover:bg-muted/10 transition-colors">
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-3">
                        <div className={`w-9 h-9 rounded-xl flex items-center justify-center ${role?.color || 'bg-muted text-muted-foreground'}`}>
                          <Icon className="w-5 h-5" />
                        </div>
                        <div>
                          <span className="font-bold text-foreground">{u.name}</span>
                          {isSelf && <span className="ml-2 text-xs text-primary font-bold">(você)</span>}
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4 text-sm text-muted-foreground">{u.email}</td>
                    <td className="px-6 py-4">
                      <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold ${role?.color || 'bg-muted text-muted-foreground'}`}>
                        <Icon className="w-3 h-3" /> {role?.label || u.role}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold ${u.active !== false ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-600'}`}>
                        {u.active !== false ? 'Ativo' : 'Inativo'}
                      </span>
                    </td>
                    {canManageUsers && (
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-1.5 justify-end">
                          <button onClick={() => openPasswordChange(u)}
                            data-testid={`button-pwd-${u.id}`}
                            title="Alterar Senha"
                            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-orange-600 bg-orange-50 hover:bg-orange-100 rounded-lg transition-colors">
                            <KeyRound className="w-3.5 h-3.5" /> Senha
                          </button>
                          <button onClick={() => openEdit(u)}
                            data-testid={`button-edit-${u.id}`}
                            title="Editar"
                            className="p-2 text-muted-foreground hover:text-primary hover:bg-primary/10 rounded-lg transition-colors">
                            <Pencil className="w-4 h-4" />
                          </button>
                          <button onClick={() => setConfirmDelete(u)}
                            data-testid={`button-delete-${u.id}`}
                            title="Excluir"
                            className="p-2 text-muted-foreground hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors">
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Create/Edit Modal */}
      <Modal isOpen={modal.open} onClose={() => setModal({ open: false, editing: null })}
        title={modal.editing ? `Editar Usuário — ${modal.editing.name}` : "Novo Usuário"} maxWidth="max-w-2xl">
        <div className="space-y-4 overflow-y-auto max-h-[80vh] pr-1">
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <label className="block text-sm font-semibold mb-1.5">Nome completo *</label>
              <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })}
                className="w-full px-4 py-2.5 rounded-xl border-2 border-border focus:border-primary outline-none" placeholder="Nome do membro" />
            </div>
            <div>
              <label className="block text-sm font-semibold mb-1.5">Email *</label>
              <input type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })}
                className="w-full px-4 py-2.5 rounded-xl border-2 border-border focus:border-primary outline-none" placeholder="email@vivafrutaz.com" />
            </div>
            {!modal.editing && (
              <div>
                <label className="block text-sm font-semibold mb-1.5">Senha *</label>
                <input type="password" value={form.password} onChange={e => setForm({ ...form, password: e.target.value })}
                  className="w-full px-4 py-2.5 rounded-xl border-2 border-border focus:border-primary outline-none" placeholder="••••••••" />
              </div>
            )}
          </div>

          <div>
            <label className="block text-sm font-semibold mb-2">Perfil de Acesso *</label>
            <div className="grid grid-cols-2 gap-2">
              {ROLES.map(r => {
                const Icon = r.icon;
                return (
                  <button key={r.value} type="button" onClick={() => setForm({ ...form, role: r.value })}
                    className={`flex items-center gap-2 p-3 rounded-xl border-2 text-left transition-all ${form.role === r.value ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/40'}`}>
                    <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${r.color}`}>
                      <Icon className="w-4 h-4" />
                    </div>
                    <div>
                      <p className={`text-xs font-bold ${form.role === r.value ? 'text-primary' : 'text-foreground'}`}>{r.label}</p>
                      <p className="text-xs text-muted-foreground">{r.desc}</p>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="flex items-center justify-between p-4 bg-muted/30 rounded-xl border border-border/50">
            <div>
              <p className="font-semibold text-sm text-foreground">Status do Usuário</p>
              <p className="text-xs text-muted-foreground">{form.active ? "Usuário ativo — pode acessar o sistema" : "Usuário inativo — acesso bloqueado"}</p>
            </div>
            <button type="button" onClick={() => setForm({ ...form, active: !form.active })}
              data-testid="toggle-active"
              className={`relative w-12 h-6 rounded-full transition-colors ${form.active ? 'bg-green-500' : 'bg-muted-foreground/30'}`}>
              <span className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-transform ${form.active ? 'translate-x-7' : 'translate-x-1'}`} />
            </button>
          </div>

          {/* Test Mode Toggle */}
          <div className={`flex items-center justify-between p-4 rounded-xl border ${form.testMode ? 'bg-amber-50 border-amber-200' : 'bg-muted/30 border-border/50'}`}>
            <div>
              <div className="flex items-center gap-2">
                <FlaskConical className={`w-4 h-4 ${form.testMode ? 'text-amber-600' : 'text-muted-foreground'}`} />
                <p className="font-semibold text-sm text-foreground">Modo Teste</p>
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">
                {form.testMode
                  ? "Ativo — pedidos deste usuário são marcados como TESTE e não geram fluxo real"
                  : "Inativo — pedidos seguem o fluxo normal de produção"}
              </p>
            </div>
            <button type="button" onClick={() => setForm({ ...form, testMode: !form.testMode })}
              data-testid="toggle-test-mode"
              className={`relative w-12 h-6 rounded-full transition-colors ${form.testMode ? 'bg-amber-500' : 'bg-muted-foreground/30'}`}>
              <span className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-transform ${form.testMode ? 'translate-x-7' : 'translate-x-1'}`} />
            </button>
          </div>

          {/* Tab Permissions Section — only ADMIN/DIRECTOR/DEVELOPER can edit */}
          {canManageUsers && (
            <div className="border border-border/60 rounded-xl p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  {form.tabPermissions ? <Lock className="w-4 h-4 text-orange-500" /> : <Unlock className="w-4 h-4 text-green-500" />}
                  <p className="font-semibold text-sm text-foreground">Permissões de Acesso a Abas</p>
                </div>
                <div className="flex gap-2">
                  {form.tabPermissions && (
                    <button type="button" onClick={resetTabPerms}
                      className="text-xs px-3 py-1 rounded-lg bg-green-50 text-green-700 border border-green-200 hover:bg-green-100 transition-colors font-medium">
                      Remover restrições
                    </button>
                  )}
                  {!form.tabPermissions && (
                    <button type="button" onClick={enableCustomPerms}
                      className="text-xs px-3 py-1 rounded-lg bg-orange-50 text-orange-700 border border-orange-200 hover:bg-orange-100 transition-colors font-medium">
                      Personalizar acesso
                    </button>
                  )}
                </div>
              </div>
              {!form.tabPermissions ? (
                <p className="text-xs text-muted-foreground">
                  Sem restrições de abas — o usuário acessa todos os módulos permitidos pelo seu perfil ({ROLES.find(r => r.value === form.role)?.label || form.role}).
                </p>
              ) : (
                <div>
                  <p className="text-xs text-muted-foreground mb-3">
                    Marque apenas as abas que este usuário pode acessar. Abas desmarcadas exibem mensagem de acesso negado.
                  </p>
                  <div className="grid grid-cols-2 gap-2">
                    {roleTabsForRole(form.role).map(tab => (
                      <label key={tab.key}
                        className={`flex items-center gap-2 p-2 rounded-lg cursor-pointer border transition-colors ${isTabChecked(tab.key) ? 'bg-primary/5 border-primary/30' : 'bg-muted/30 border-border/40'}`}>
                        <input type="checkbox" checked={isTabChecked(tab.key)}
                          onChange={() => toggleTab(tab.key)}
                          data-testid={`tab-perm-${tab.key}`}
                          className="w-3.5 h-3.5 rounded accent-primary" />
                        <span className={`text-xs font-medium ${isTabChecked(tab.key) ? 'text-foreground' : 'text-muted-foreground'}`}>{tab.label}</span>
                      </label>
                    ))}
                    {roleTabsForRole(form.role).length === 0 && (
                      <p className="col-span-2 text-xs text-muted-foreground italic">Nenhuma aba disponível para este perfil.</p>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground mt-2">
                    {form.tabPermissions.length} de {roleTabsForRole(form.role).length} abas ativas
                  </p>
                </div>
              )}
            </div>
          )}

          {/* Advanced Permissions Section */}
          {canManageUsers && (
            <AdvancedPermissionsSection
              permissions={form.permissions}
              onChange={(perms) => setForm(f => ({ ...f, permissions: perms }))}
            />
          )}

          <button type="button" onClick={() => {
            if (!form.name || !form.email || (!modal.editing && !form.password)) {
              toast({ title: "Preencha todos os campos obrigatórios.", variant: "destructive" }); return;
            }
            save.mutate();
          }}
            disabled={save.isPending}
            className="w-full py-3 bg-primary text-white font-bold rounded-xl hover:-translate-y-0.5 transition-transform disabled:opacity-50">
            {save.isPending ? "Salvando..." : modal.editing ? "Salvar Alterações" : "Criar Usuário"}
          </button>
        </div>
      </Modal>

      {/* Password Change Modal */}
      {pwdModal && !pwdConfirm && (
        <Modal isOpen onClose={() => { setPwdModal(null); setNewPwd(TEMP_PASSWORD); setUseCustomPwd(false); }}
          title={`Alterar Senha — ${pwdModal.name}`} maxWidth="max-w-md">
          <div className="space-y-4">
            <div className="flex items-center gap-3 p-3 bg-orange-50 rounded-xl border border-orange-100">
              <KeyRound className="w-5 h-5 text-orange-600 flex-shrink-0" />
              <div>
                <p className="text-sm font-bold text-orange-800">Usuário: {pwdModal.email}</p>
                <p className="text-xs text-orange-600">Perfil: {ROLES.find(r => r.value === pwdModal.role)?.label || pwdModal.role}</p>
              </div>
            </div>

            <div className="flex items-center gap-3 p-3 bg-muted/30 rounded-xl border border-border/50">
              <button type="button" onClick={() => { setUseCustomPwd(false); setNewPwd(TEMP_PASSWORD); }}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-bold transition-all ${!useCustomPwd ? 'bg-primary text-white' : 'border border-border text-muted-foreground'}`}>
                Senha Temporária
              </button>
              <button type="button" onClick={() => { setUseCustomPwd(true); setNewPwd(""); }}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-bold transition-all ${useCustomPwd ? 'bg-primary text-white' : 'border border-border text-muted-foreground'}`}>
                Senha Personalizada
              </button>
            </div>

            {!useCustomPwd ? (
              <div className="p-4 bg-green-50 rounded-xl border border-green-100 text-center">
                <p className="text-xs font-bold text-green-700 uppercase tracking-wider mb-1">Senha Temporária</p>
                <p className="text-2xl font-mono font-bold text-green-800">{TEMP_PASSWORD}</p>
                <p className="text-xs text-green-600 mt-2">O usuário deverá alterar a senha no próximo acesso.</p>
              </div>
            ) : (
              <div>
                <label className="block text-sm font-semibold mb-1.5">Nova Senha *</label>
                <input type="text" value={newPwd} onChange={e => setNewPwd(e.target.value)}
                  data-testid="input-new-password"
                  placeholder="Digite a nova senha"
                  className="w-full px-4 py-2.5 rounded-xl border-2 border-border focus:border-primary outline-none font-mono" />
              </div>
            )}

            <div className="flex gap-3">
              <button onClick={() => { setPwdModal(null); setNewPwd(TEMP_PASSWORD); setUseCustomPwd(false); }}
                className="flex-1 py-2.5 border-2 border-border font-bold rounded-xl text-muted-foreground hover:bg-muted">
                Cancelar
              </button>
              <button
                data-testid="button-confirm-password-change"
                onClick={() => {
                  if (!newPwd.trim()) { toast({ title: "Digite uma senha válida.", variant: "destructive" }); return; }
                  setPwdConfirm({ user: pwdModal, newPwd: newPwd.trim() });
                }}
                className="flex-1 py-2.5 bg-orange-500 hover:bg-orange-600 text-white font-bold rounded-xl transition-colors">
                Prosseguir
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* Password Confirmation Modal */}
      {pwdConfirm && (
        <Modal isOpen onClose={() => setPwdConfirm(null)} title="Confirmar Alteração de Senha" maxWidth="max-w-sm">
          <div className="space-y-4 text-center">
            <div className="w-16 h-16 rounded-full bg-orange-100 flex items-center justify-center mx-auto">
              <AlertTriangle className="w-8 h-8 text-orange-600" />
            </div>
            <p className="text-foreground">
              Confirmar alteração de senha do usuário <strong>{pwdConfirm.user.name}</strong>?
            </p>
            <p className="text-sm text-muted-foreground">Esta ação será registrada no sistema de logs.</p>
            <div className="flex gap-3">
              <button onClick={() => setPwdConfirm(null)}
                className="flex-1 py-2.5 border-2 border-border font-bold rounded-xl">Cancelar</button>
              <button
                data-testid="button-execute-password-change"
                onClick={() => changePassword.mutate({ userId: pwdConfirm.user.id, password: pwdConfirm.newPwd })}
                disabled={changePassword.isPending}
                className="flex-1 py-2.5 bg-orange-500 text-white font-bold rounded-xl hover:bg-orange-600 disabled:opacity-50">
                {changePassword.isPending ? "Alterando..." : "Confirmar"}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* Delete confirmation */}
      {confirmDelete && (
        <Modal isOpen onClose={() => setConfirmDelete(null)} title="Confirmar Exclusão" maxWidth="max-w-sm">
          <div className="space-y-4 text-center">
            <div className="w-16 h-16 rounded-full bg-red-100 flex items-center justify-center mx-auto">
              <Trash2 className="w-8 h-8 text-red-600" />
            </div>
            <p className="text-foreground">Tem certeza que deseja remover o usuário <strong>{confirmDelete.name}</strong>? Esta ação não pode ser desfeita.</p>
            <div className="flex gap-3">
              <button onClick={() => setConfirmDelete(null)} className="flex-1 py-2.5 border-2 border-border font-bold rounded-xl">Cancelar</button>
              <button onClick={() => del.mutate(confirmDelete.id)} disabled={del.isPending}
                className="flex-1 py-2.5 bg-red-600 text-white font-bold rounded-xl hover:bg-red-700 transition-colors disabled:opacity-50">
                {del.isPending ? "Removendo..." : "Remover"}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </Layout>
  );
}
