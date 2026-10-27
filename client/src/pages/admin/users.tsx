import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Layout } from "@/components/Layout";
import { BackHeader } from "@/components/navigation/BackHeader";
import { Modal } from "@/components/Modal";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import { UserCircle, Plus, Pencil, Trash2, Shield, ShieldCheck, DollarSign, Code, Crown, BarChart3, KeyRound, AlertTriangle, Lock, Unlock, FlaskConical, Truck, Leaf } from "lucide-react";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { normalizeList } from "@/lib/normalizeResponse";
import { ACTION_PERMISSION_ACTIONS, ACTION_PERMISSION_KEY, ACTION_PERMISSION_MODULES, DENY_ALL_TAB_PERMISSIONS, GLOBAL_ADMIN_ROLES, GLOBAL_SCOPE_ROLES, TENANT_ASSIGNABLE_USER_ROLES, USER_MANAGEMENT_ROLES } from "@shared/user-roles";

type ActionModule = (typeof ACTION_PERMISSION_MODULES)[number];
type ActionType = (typeof ACTION_PERMISSION_ACTIONS)[number];
type ActionOverrides = Partial<Record<ActionModule, Partial<Record<ActionType, boolean>>>>;
type ActionPermissionsInput = { actionOverridesV1: ActionOverrides | null } | null;

const ACTION_MODULE_LABELS: Record<ActionModule, string> = {
  orders: "Pedidos",
  logistics: "Logística e Entregas",
  quotations: "Cotações",
  "special-orders": "Pedidos Pontuais",
};
const ACTION_LABELS: Record<ActionType, string> = { read: "Visualizar", create: "Criar", edit: "Editar", delete: "Excluir" };

function readActionOverrides(value: unknown): ActionOverrides {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const raw = (value as Record<string, unknown>)[ACTION_PERMISSION_KEY];
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const result: ActionOverrides = {};
  for (const module of ACTION_PERMISSION_MODULES) {
    const rawModule = (raw as Record<string, unknown>)[module];
    if (!rawModule || typeof rawModule !== "object" || Array.isArray(rawModule)) continue;
    const safeModule: Partial<Record<ActionType, boolean>> = {};
    for (const action of ACTION_PERMISSION_ACTIONS) {
      const value = (rawModule as Record<string, unknown>)[action];
      if (typeof value === "boolean") safeModule[action] = value;
    }
    if (Object.keys(safeModule).length) result[module] = safeModule;
  }
  return result;
}

type AdminUser = {
  id: number; name: string; email: string; password: string; role: string; active: boolean;
  tabPermissions: string[] | null;
  permissions?: unknown;
  testMode: boolean;
  empresaId?: number | null;
};

type CompanyOption = { id: number; companyName?: string; name?: string; active?: boolean };

// All system tabs with labels and role access
const ALL_TABS: { key: string; label: string; roles: string[] }[] = [
  { key: 'dashboard', label: 'Dashboard (Painel)', roles: ['ADMIN', 'DIRECTOR', 'LOGISTICS', 'DEVELOPER', 'OPERATIONS_MANAGER', 'PURCHASE_MANAGER', 'FINANCEIRO', 'COMERCIAL', 'MASTER_COMERCIAL'] },
  { key: 'orders', label: 'Pedidos', roles: ['ADMIN', 'DIRECTOR', 'OPERATIONS_MANAGER', 'FINANCEIRO', 'LOGISTICS', 'COMERCIAL', 'MASTER_COMERCIAL', 'SISTEMA_TESTE'] },
  { key: 'special-orders', label: 'Pedidos Pontuais', roles: ['ADMIN', 'DIRECTOR', 'OPERATIONS_MANAGER', 'DEVELOPER', 'LOGISTICS', 'COMERCIAL', 'MASTER_COMERCIAL', 'SISTEMA_TESTE'] },
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
  { key: 'tasks', label: 'Tarefas', roles: ['ADMIN', 'DIRECTOR', 'DEVELOPER', 'OPERATIONS_MANAGER', 'PURCHASE_MANAGER', 'FINANCEIRO', 'LOGISTICS', 'COMERCIAL', 'MASTER_COMERCIAL'] },
  { key: 'incidents', label: 'Ocorrências de Clientes', roles: ['ADMIN', 'DIRECTOR', 'DEVELOPER', 'OPERATIONS_MANAGER', 'LOGISTICS', 'COMERCIAL', 'MASTER_COMERCIAL'] },
  { key: 'internal-incidents', label: 'Ocorrências Internas', roles: ['ADMIN', 'DIRECTOR', 'DEVELOPER', 'OPERATIONS_MANAGER', 'LOGISTICS', 'COMERCIAL', 'MASTER_COMERCIAL'] },
  { key: 'logistics', label: 'Logística', roles: ['ADMIN', 'DIRECTOR', 'DEVELOPER', 'OPERATIONS_MANAGER', 'LOGISTICS', 'COMERCIAL', 'MASTER_COMERCIAL'] },
  { key: 'driver-panel', label: 'Painel do Motorista', roles: ['MASTER', 'ADMIN', 'DIRECTOR', 'DEVELOPER', 'LOGISTICS', 'COMERCIAL', 'MASTER_COMERCIAL', 'MOTORISTA'] },
  { key: 'gps-tracking', label: 'GPS em Tempo Real', roles: ['MASTER', 'ADMIN', 'DIRECTOR', 'DEVELOPER', 'LOGISTICS', 'COMERCIAL', 'MASTER_COMERCIAL'] },
  { key: 'quotations', label: 'Cotação de Empresas', roles: ['ADMIN', 'DIRECTOR', 'DEVELOPER', 'OPERATIONS_MANAGER', 'COMERCIAL', 'MASTER_COMERCIAL'] },
  { key: 'users', label: 'Usuários do Sistema', roles: ['ADMIN', 'DIRECTOR'] },
  { key: 'email-management', label: 'Central de E-mails', roles: ['MANAGER', 'OPERATIONS_MANAGER'] },
  { key: 'backups', label: 'Backup & E-mails', roles: ['ADMIN', 'DIRECTOR', 'DEVELOPER'] },
  { key: 'developer', label: 'Área do Desenvolvedor', roles: ['ADMIN', 'DIRECTOR', 'DEVELOPER'] },
  { key: 'executive', label: 'Dashboard Executivo', roles: ['ADMIN', 'DIRECTOR', 'FINANCEIRO', 'DEVELOPER'] },
  { key: 'announcements', label: 'Painel de Avisos', roles: ['ADMIN', 'DIRECTOR', 'DEVELOPER'] },
  { key: 'waste-control', label: 'Controle de Desperdício', roles: ['ADMIN', 'DIRECTOR', 'DEVELOPER', 'OPERATIONS_MANAGER', 'PURCHASE_MANAGER', 'LOGISTICS', 'COMERCIAL', 'MASTER_COMERCIAL'] },
  { key: 'purchase-planning', label: 'Planejamento de Compras', roles: ['ADMIN', 'DIRECTOR', 'DEVELOPER', 'PURCHASE_MANAGER', 'OPERATIONS_MANAGER'] },
  { key: 'sanitary', label: 'Vigilância Sanitária', roles: ['ADMIN', 'DIRECTOR', 'DEVELOPER', 'NUTRICIONISTA', 'OPERATIONS_MANAGER'] },
];

const ROLES = [
  { value: "MASTER", label: "Master", desc: "Administrador global; mesmas permissões do Diretor", icon: Shield, color: "text-purple-700 bg-purple-100" },
  { value: "ADMIN", label: "Administrador", desc: "Administra usuários operacionais da própria empresa", icon: Shield, color: "text-red-600 bg-red-100" },
  { value: "DIRECTOR", label: "Diretor", desc: "Administrador global; mesmas permissões do Master", icon: Crown, color: "text-yellow-700 bg-yellow-100" },
  { value: "OPERATIONS_MANAGER", label: "Gerente de Operações", desc: "Janelas de pedido e pedidos", icon: ShieldCheck, color: "text-blue-600 bg-blue-100" },
  { value: "PURCHASE_MANAGER", label: "Gerente de Compras", desc: "Compras e relatórios", icon: DollarSign, color: "text-green-600 bg-green-100" },
  { value: "FINANCEIRO", label: "Financeiro", desc: "Pedidos, painel financeiro e exportações", icon: BarChart3, color: "text-emerald-600 bg-emerald-100" },
  { value: "DEVELOPER", label: "Desenvolvedor", desc: "Acesso técnico + logs + backups", icon: Code, color: "text-purple-600 bg-purple-100" },
  { value: "MANAGER", label: "Gerente", desc: "Acesso de gestão operacional e central de e-mails", icon: ShieldCheck, color: "text-blue-700 bg-blue-100" },
  { value: "LOGISTICS", label: "Logística", desc: "Pedidos, rotas, motoristas e ocorrências", icon: AlertTriangle, color: "text-orange-600 bg-orange-100" },
  { value: "COMERCIAL", label: "Comercial", desc: "Clientes, pedidos, cotações e acompanhamento comercial", icon: UserCircle, color: "text-indigo-600 bg-indigo-100" },
  { value: "MASTER_COMERCIAL", label: "Master Comercial", desc: "Acesso ampliado às funções comerciais e operacionais", icon: Crown, color: "text-indigo-700 bg-indigo-100" },
  { value: "MOTORISTA", label: "Motorista", desc: "Acesso restrito: Painel do Motorista, GPS, rotas do dia e notas fiscais da rota", icon: Truck, color: "text-teal-600 bg-teal-100" },
  { value: "NUTRICIONISTA", label: "Nutricionista", desc: "Acesso total ao módulo de Vigilância Sanitária — checklist, avaliações e relatórios", icon: Leaf, color: "text-lime-700 bg-lime-100" },
  { value: "SISTEMA_TESTE", label: "Usuário de Teste", desc: "Acesso para testes — pedidos marcados como TESTE", icon: FlaskConical, color: "text-cyan-700 bg-cyan-100" },
  { value: "GESTOR_CONTRATOS", label: "Gestor de Contratos", desc: "Acesso aos fluxos contratuais autorizados", icon: ShieldCheck, color: "text-sky-700 bg-sky-100" },
];

// DRIVER is kept as a read-compatible alias for accounts created before the
// Portuguese role name was standardized. It must render and edit as Motorista
// instead of appearing as an unknown profile.
const normalizeRole = (role: string) => role === "DRIVER" ? "MOTORISTA" : role;
const isDriverRole = (role: string) => role === "MOTORISTA" || role === "DRIVER";

const isGlobalAdminRole = (role?: string) => GLOBAL_ADMIN_ROLES.some((item) => item === role);

const blank = {
  name: "", email: "", password: "", role: "OPERATIONS_MANAGER", active: true,
  tabPermissions: null as string[] | null,
  permissions: null as ActionPermissionsInput,
  testMode: false,
};

export default function UsersAdminPage() {
  const { toast } = useToast();
  const { user: me } = useAuth();
  const queryClient = useQueryClient();
  const [modal, setModal] = useState<{ open: boolean; editing: AdminUser | null }>({ open: false, editing: null });
  const [form, setForm] = useState(blank);
  const [newUserTargetTenant, setNewUserTargetTenant] = useState("");
  const [confirmDelete, setConfirmDelete] = useState<AdminUser | null>(null);
  const [pwdModal, setPwdModal] = useState<AdminUser | null>(null);
  const [pwdConfirm, setPwdConfirm] = useState<{ user: AdminUser; newPwd: string } | null>(null);
  const [newPwd, setNewPwd] = useState("");

  const canManageUsers = me && USER_MANAGEMENT_ROLES.some((role) => role === me.role);
  const isGlobalAdmin = isGlobalAdminRole(me?.role);
  const { data: companies = [], isLoading: loadingCompanies } = useQuery<CompanyOption[]>({
    queryKey: ["/api/companies"],
    select: normalizeList,
    enabled: Boolean(isGlobalAdmin),
  });
  const selectableCompanies = companies.filter((company) => company.active !== false);
  const companyNameById = new Map(companies.map((company) => [company.id, company.companyName || company.name || `Empresa #${company.id}`]));
  const createTargetEmpresaId = /^\d+$/.test(newUserTargetTenant) ? Number(newUserTargetTenant) : null;
  const targetIsGlobalProfile = !!modal.editing && modal.editing.empresaId == null && (GLOBAL_SCOPE_ROLES as readonly string[]).includes(modal.editing.role);
  const availableRoles = ROLES.filter((role) => {
    const isGlobalProfile = (GLOBAL_SCOPE_ROLES as readonly string[]).includes(role.value);
    const isInternalStaff = role.value === "COMERCIAL" || role.value === "LOGISTICS";
    if (targetIsGlobalProfile) {
      if (modal.editing && (me as any)?.id !== modal.editing.id) return role.value === modal.editing.role;
      return isGlobalProfile;
    }
    if (isGlobalProfile) return isGlobalAdmin && !modal.editing && newUserTargetTenant === "global";
    if (!modal.editing && isGlobalAdmin && (createTargetEmpresaId == null || newUserTargetTenant === "global")) {
      return newUserTargetTenant === "global" && (isGlobalProfile || isInternalStaff);
    }
    if (role.value === "ADMIN") {
      return (isGlobalAdmin && (createTargetEmpresaId != null || modal.editing?.role === "ADMIN")) ||
        modal.editing?.role === role.value;
    }
    return TENANT_ASSIGNABLE_USER_ROLES.some((allowed) => allowed === role.value) ||
      modal.editing?.role === role.value;
  });

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
      const url = isEdit ? `/api/users/${modal.editing?.id}` : '/api/users';
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (!isEdit && isGlobalAdmin && createTargetEmpresaId != null) {
        headers['X-Empresa-Id'] = String(createTargetEmpresaId);
      }
      const res = await fetchWithAuth(url, {
        method: isEdit ? 'PUT' : 'POST',
        headers,
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
      setNewUserTargetTenant("");
    },
    onError: (e: any) => toast({ title: e.message || "Erro ao salvar", variant: "destructive" }),
  });

  const del = useMutation({
    mutationFn: async (id: number) => {
      const res = await fetchWithAuth(`/api/users/${id}`, { method: 'DELETE' });
      if (!res.ok) {
        const payload = await res.json().catch(() => null);
        const message = payload?.message || payload?.error?.message || payload?.error ||
          `Não foi possível excluir o usuário (erro ${res.status}).`;
        throw new Error(typeof message === "string" ? message : `Não foi possível excluir o usuário (erro ${res.status}).`);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/users'] });
      toast({ title: "Usuário removido." });
      setConfirmDelete(null);
    },
    onError: (error: Error) => {
      toast({ title: "Não foi possível excluir", description: error.message, variant: "destructive" });
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
      setNewPwd("");
    },
    onError: (e: any) => toast({ title: e.message, variant: "destructive" }),
  });

  const openCreate = () => {
    setNewUserTargetTenant("");
    setForm({ ...blank, role: isGlobalAdmin ? "ADMIN" : "OPERATIONS_MANAGER" });
    setModal({ open: true, editing: null });
  };
  const openEdit = (u: AdminUser) => {
    setForm({
      name: u.name, email: u.email, password: '', role: normalizeRole(u.role), active: u.active !== false,
      tabPermissions: u.tabPermissions?.length ? u.tabPermissions : null,
      permissions: Object.keys(readActionOverrides(u.permissions)).length
        ? { actionOverridesV1: readActionOverrides(u.permissions) }
        : null,
      testMode: u.testMode ?? false,
    });
    setModal({ open: true, editing: u });
  };

  // Tab permissions helpers
  const roleTabsForRole = (role: string) => (GLOBAL_SCOPE_ROLES as readonly string[]).includes(role)
    ? ALL_TABS
    : ALL_TABS.filter(t => t.roles.includes(role));
  const isTabChecked = (key: string) => {
    if (!form.tabPermissions) return true; // null = all allowed
    if (form.tabPermissions.includes(DENY_ALL_TAB_PERMISSIONS)) return false;
    return form.tabPermissions.includes(key);
  };
  const toggleTab = (key: string) => {
    const roleTabs = roleTabsForRole(form.role).map(t => t.key);
    if (!form.tabPermissions || form.tabPermissions.length === 0) {
      // First toggle: set to all minus this one
      const remaining = roleTabs.filter(k => k !== key);
      setForm(f => ({ ...f, tabPermissions: remaining.length ? remaining : [DENY_ALL_TAB_PERMISSIONS] }));
    } else if (form.tabPermissions.includes(DENY_ALL_TAB_PERMISSIONS)) {
      setForm(f => ({ ...f, tabPermissions: [key] }));
    } else {
      const newPerms = form.tabPermissions.includes(key)
        ? form.tabPermissions.filter(k => k !== key)
        : [...form.tabPermissions, key];
      setForm(f => ({ ...f, tabPermissions: newPerms.length === roleTabs.length ? null : newPerms.length === 0 ? [DENY_ALL_TAB_PERMISSIONS] : newPerms }));
    }
  };
  const resetTabPerms = () => setForm(f => ({ ...f, tabPermissions: null }));
  const enableCustomPerms = () => setForm(f => ({ ...f, tabPermissions: roleTabsForRole(f.role).map(t => t.key) }));
  const getActionSetting = (module: ActionModule, action: ActionType): string => {
    const value = readActionOverrides(form.permissions)[module]?.[action];
    return value === undefined ? "default" : value ? "allow" : "deny";
  };
  const setActionSetting = (module: ActionModule, action: ActionType, setting: string) => {
    const overrides = readActionOverrides(form.permissions);
    const moduleSettings = { ...(overrides[module] ?? {}) };
    if (setting === "default") delete moduleSettings[action];
    else moduleSettings[action] = setting === "allow";
    const next = { ...overrides };
    if (Object.keys(moduleSettings).length) next[module] = moduleSettings;
    else delete next[module];
    setForm(f => ({ ...f, permissions: Object.keys(next).length ? { actionOverridesV1: next } : null }));
  };

  const openPasswordChange = (u: AdminUser) => {
    if (!canManageUsers) {
      toast({ title: "Acesso restrito. Apenas diretoria ou administração podem alterar esta senha.", variant: "destructive" });
      return;
    }
    setNewPwd("");
    setPwdModal(u);
  };

  return (
    <Layout>
      <BackHeader fallback="/admin" breadcrumb={[{ label: "Usuários" }]} />
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
                  {users?.filter(u => r.value === "MOTORISTA" ? isDriverRole(u.role) : u.role === r.value).length || 0} usuário(s)
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
                {isGlobalAdmin && <th className="px-6 py-4 font-semibold">Empresa</th>}
                <th className="px-6 py-4 font-semibold">Perfil</th>
                <th className="px-6 py-4 font-semibold">Status</th>
                {canManageUsers && <th className="px-6 py-4 font-semibold text-right">Ações</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-border/50">
              {isLoading ? (
                <tr><td colSpan={isGlobalAdmin ? 6 : 5} className="px-6 py-8 text-center text-muted-foreground">Carregando...</td></tr>
              ) : users?.map(u => {
                 const role = ROLES.find(r => r.value === normalizeRole(u.role));
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
                    {isGlobalAdmin && <td className="px-6 py-4 text-sm text-muted-foreground">{u.empresaId == null ? "Global" : companyNameById.get(u.empresaId) || `Empresa #${u.empresaId}`}</td>}
                    <td className="px-6 py-4">
                      <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold ${role?.color || (isDriverRole(u.role) ? 'text-teal-600 bg-teal-100' : 'bg-muted text-muted-foreground')}`}>
                        <Icon className="w-3 h-3" /> {role?.label || (isDriverRole(u.role) ? 'Motorista' : u.role)}
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
          {!modal.editing && isGlobalAdmin && (
            <div>
              <label className="block text-sm font-semibold mb-1.5">Empresa de destino</label>
              <select
                value={newUserTargetTenant}
                onChange={(event) => {
                  const value = event.target.value;
                  setNewUserTargetTenant(value);
                  setForm((current) => ({
                    ...current,
                    role: value === "global"
                      ? (isGlobalAdminRole(current.role) ? current.role : "MASTER")
                      : isGlobalAdminRole(current.role) ? "ADMIN" : current.role,
                  }));
                }}
                data-testid="select-user-target-tenant"
                className="w-full px-4 py-2.5 rounded-xl border-2 border-border bg-background focus:border-primary outline-none"
              >
                <option value="">Selecione a empresa onde o usuário atuará</option>
                <option value="global">Conta interna (sem empresa cliente)</option>
                {selectableCompanies.map((company) => (
                  <option key={company.id} value={String(company.id)}>
                    {company.companyName || company.name || `Empresa #${company.id}`}
                  </option>
                ))}
              </select>
              <p className="text-xs text-muted-foreground mt-1.5">
                MASTER e DIRECTOR são globais. COMERCIAL e LOGISTICS podem ser funcionários internos sem empresa; os demais perfis operacionais ficam vinculados à empresa selecionada.
              </p>
              {!loadingCompanies && selectableCompanies.length === 0 && (
                <p className="text-xs text-amber-700 mt-1" role="status">Não foi possível carregar empresas ativas para selecionar.</p>
              )}
            </div>
          )}
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
                <input type="password" minLength={12} value={form.password} onChange={e => setForm({ ...form, password: e.target.value })}
                  className="w-full px-4 py-2.5 rounded-xl border-2 border-border focus:border-primary outline-none" placeholder="••••••••" />
              </div>
            )}
          </div>

          <div>
            <label className="block text-sm font-semibold mb-2">
              Perfil de Acesso <span className="text-red-500">*</span>
            </label>
            <p className="text-xs text-muted-foreground mb-2">
              Selecione um perfil obrigatório. Para contas de motorista, escolha <strong>Motorista</strong> para habilitar o painel e o compartilhamento do GPS.
            </p>
            {!modal.editing && isGlobalAdmin && !newUserTargetTenant && (
              <p className="text-xs text-amber-700 mb-2" role="status">Selecione primeiro uma empresa ativa ou “Conta interna” para carregar os perfis permitidos.</p>
            )}
            <div className="grid grid-cols-2 gap-2">
              {availableRoles.map(r => {
                const Icon = r.icon;
                return (
                  <button key={r.value} type="button" onClick={() => setForm({ ...form, role: r.value, tabPermissions: form.tabPermissions ? roleTabsForRole(r.value).map(t => t.key) : null })}
                    aria-pressed={form.role === r.value}
                    data-testid={`role-option-${r.value}`}
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
            {!form.role && (
              <p className="text-xs text-red-600 mt-2" role="alert">Selecione um perfil de acesso.</p>
            )}
            {isDriverRole(form.role) && (
              <div className="mt-3 rounded-xl border border-teal-200 bg-teal-50 px-3 py-2.5 text-xs text-teal-800">
                <strong>Configuração de motorista obrigatória:</strong> o GPS será vinculado a esta conta quando o motorista abrir o Painel do Motorista e permitir a localização.
              </div>
            )}
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

          {/* Tab visibility also denies access to opted-in APIs; role/action policies remain authoritative. */}
          {canManageUsers && (
            <div className="border border-border/60 rounded-xl p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  {form.tabPermissions ? <Lock className="w-4 h-4 text-orange-500" /> : <Unlock className="w-4 h-4 text-green-500" />}
                  <p className="font-semibold text-sm text-foreground">Visibilidade de Abas</p>
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
                    Define quais abas aparecem na navegação. A autorização real continua sendo validada pelo perfil e pela empresa no servidor.
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
                    {form.tabPermissions.includes(DENY_ALL_TAB_PERMISSIONS) ? 0 : form.tabPermissions.length} de {roleTabsForRole(form.role).length} abas ativas
                  </p>
                </div>
              )}
            </div>
          )}

          {canManageUsers && (
            <div className="border border-border/60 rounded-xl p-4 space-y-3">
              <div>
                <p className="font-semibold text-sm text-foreground">Permissões por ação</p>
                <p className="mt-1 text-xs text-muted-foreground">Bloqueios são aplicados pelo servidor. Permitir mantém as regras do perfil, da empresa e da operação; não concede privilégios adicionais.</p>
              </div>
              <div className="space-y-3">
                {ACTION_PERMISSION_MODULES.map(module => (
                  <fieldset key={module} className="rounded-lg border border-border/50 p-3">
                    <legend className="px-1 text-xs font-semibold">{ACTION_MODULE_LABELS[module]}</legend>
                    <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
                      {ACTION_PERMISSION_ACTIONS.map(action => (
                        <label key={action} className="flex flex-col gap-1 text-xs">
                          <span>{ACTION_LABELS[action]}</span>
                          <select value={getActionSetting(module, action)} onChange={event => setActionSetting(module, action, event.target.value)} className="rounded-md border border-border bg-background px-2 py-1.5">
                            <option value="default">Padrão do perfil</option>
                            <option value="allow">Permitir se o perfil autorizar</option>
                            <option value="deny">Bloquear</option>
                          </select>
                        </label>
                      ))}
                    </div>
                  </fieldset>
                ))}
              </div>
            </div>
          )}

          <button type="button" onClick={() => {
            if (!form.name || !form.email || !form.role || (!modal.editing && form.password.trim().length < 12)) {
              toast({ title: "Preencha todos os campos obrigatórios.", variant: "destructive" }); return;
            }
            if (!modal.editing && isGlobalAdmin && !newUserTargetTenant) {
              toast({ title: "Selecione uma empresa de destino ou uma conta global.", variant: "destructive" }); return;
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
        <Modal isOpen onClose={() => { setPwdModal(null); setNewPwd(""); }}
          title={`Alterar Senha — ${pwdModal.name}`} maxWidth="max-w-md">
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">Defina uma senha individual com pelo menos 12 caracteres.</p>
            <div>
              <label className="block text-sm font-semibold mb-1.5">Nova senha *</label>
              <input type="password" minLength={12} value={newPwd} onChange={e => setNewPwd(e.target.value)}
                data-testid="input-new-password" autoComplete="new-password"
                placeholder="Mínimo de 12 caracteres"
                className="w-full px-4 py-2.5 rounded-xl border-2 border-border focus:border-primary outline-none" />
            </div>
            <div className="flex gap-3">
              <button onClick={() => { setPwdModal(null); setNewPwd(""); }}
                className="flex-1 py-2.5 border-2 border-border font-bold rounded-xl text-muted-foreground hover:bg-muted">Cancelar</button>
              <button data-testid="button-confirm-password-change"
                onClick={() => {
                  if (newPwd.trim().length < 12) { toast({ title: "A senha deve ter pelo menos 12 caracteres.", variant: "destructive" }); return; }
                  setPwdConfirm({ user: pwdModal, newPwd: newPwd.trim() });
                }}
                className="flex-1 py-2.5 bg-orange-500 hover:bg-orange-600 text-white font-bold rounded-xl transition-colors">Prosseguir</button>
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
