import React, { useState, useEffect } from 'react';
import { useAuth } from '@/hooks/use-auth';
import { useLocation, Link } from 'wouter';
import { useQuery } from '@tanstack/react-query';
import { fetchWithAuth } from '@/lib/fetchWithAuth';
import { 
  Leaf, LayoutDashboard, Users, Package, Tag, 
  CalendarDays, ShoppingCart, BarChart3, PieChart, LogOut, Receipt,
  ShieldCheck, Factory, FolderOpen, KeyRound, Star, UserCog, HardDrive, FlaskConical,
  ClipboardList, AlertTriangle, Building2, Truck, FileText, TrendingUp, UserCircle, Megaphone, TrendingDown, ShoppingBag, Warehouse, Mail, Settings, Brain, GraduationCap, DollarSign, Route, Menu, X, Bell, BookOpen,
  Search, ScrollText, Activity, Landmark, ReceiptText, Bot, RefreshCw, Palette, Upload
} from 'lucide-react';

import { VirtualAssistant } from './VirtualAssistant';
import { PWAInstallPrompt } from './PWAInstallPrompt';
import { WhatsNewModal } from './WhatsNewModal';
import { TrainingModeProvider, TrainingModeButton } from './TrainingMode';
import { GlobalSearch } from './GlobalSearch';
import { usePushNotifications } from '@/hooks/use-push-notifications';

export function Layout({ children }: { children: React.ReactNode }) {
  const { user, company, isStaff, isClient, logout } = useAuth();
  const [location, navigate] = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarSearch, setSidebarSearch] = useState('');
  const push = usePushNotifications();

  // White-label: Apply company colors
  const { data: empresaConfig } = useQuery({
    queryKey: ['empresa-config', company?.id],
    queryFn: async () => {
      if (!company?.id) return null;
      const res = await fetchWithAuth(`/api/empresa-config/${company.id}`);
      if (res.status === 404) return null;
      return res.json();
    },
    enabled: !!company?.id,
  });

  useEffect(() => {
    if (empresaConfig) {
      document.documentElement.style.setProperty('--primary-color', empresaConfig.corPrimaria || '#16a34a');
      document.documentElement.style.setProperty('--secondary-color', empresaConfig.corSecundaria || '#ea580c');
    }
  }, [empresaConfig]);

  // Auto-prompt for push permission for staff users (only once per browser)
  useEffect(() => {
    if (!isStaff || !push.isSupported || push.isSubscribed || push.permission === 'denied') return;
    const alreadyAsked = localStorage.getItem('push-permission-asked');
    if (alreadyAsked) return;
    const t = setTimeout(async () => {
      localStorage.setItem('push-permission-asked', '1');
      await push.subscribe();
    }, 8000); // Wait 8s before prompting
    return () => clearTimeout(t);
  }, [isStaff, push.isSupported, push.isSubscribed, push.permission]);

  // Auto-prompt for push permission for client users (only once per browser)
  useEffect(() => {
    if (!isClient || !push.isSupported || push.isSubscribed || push.permission === 'denied') return;
    const alreadyAsked = localStorage.getItem('push-permission-client-asked');
    if (alreadyAsked) return;
    const t = setTimeout(async () => {
      localStorage.setItem('push-permission-client-asked', '1');
      await push.subscribe();
    }, 10000); // Wait 10s before prompting clients
    return () => clearTimeout(t);
  }, [isClient, push.isSupported, push.isSubscribed, push.permission]);

  // Close sidebar on navigation (mobile)
  useEffect(() => {
    setSidebarOpen(false);
  }, [location]);

  // Close sidebar on Escape key
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') setSidebarOpen(false); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, []);

  const { data: testModeData } = useQuery<{ enabled: boolean }>({
    queryKey: ['/api/settings/test-mode'],
    staleTime: 30000,
    enabled: isStaff,
  });
  const testModeActive = (testModeData?.enabled ?? false) || ((user as any)?.testMode === true);

  const { data: logoData } = useQuery<{ logoBase64: string; logoType: string }>({
    queryKey: ['/api/company-config/logo'],
    staleTime: 5 * 60 * 1000,
    retry: false,
  });

  const staffRole = user?.role || '';
  const isAdminRole = ['MASTER', 'ADMIN', 'DEVELOPER', 'DIRECTOR'].includes(staffRole);
  const { data: allowedModulos } = useQuery<string[]>({
    queryKey: ['/api/saas/minha-assinatura/modulos'],
    enabled: isStaff && !isAdminRole,
    staleTime: 5 * 60 * 1000,
    retry: false,
  });

  const adminLinks: { href: string; label: string; icon: any; roles: string[]; tabKey: string; category: string; moduloChave?: string }[] = [
    { href: '/admin', label: 'Painel', icon: LayoutDashboard, roles: ['ADMIN', 'DIRECTOR', 'LOGISTICS'], tabKey: 'dashboard', category: 'Painel' },
    { href: '/admin/executive', label: 'Dashboard Executivo', icon: TrendingUp, roles: ['ADMIN', 'DIRECTOR', 'FINANCEIRO', 'DEVELOPER'], tabKey: 'executive', category: 'Painel' },
    { href: '/admin/companies', label: 'Empresas', icon: Users, roles: ['ADMIN', 'DIRECTOR'], tabKey: 'companies', category: 'Comercial' },
    { href: '/admin/contracts', label: 'Gestão de Contratos', icon: ScrollText, roles: ['ADMIN', 'DIRECTOR', 'DEVELOPER', 'OPERATIONS_MANAGER'], tabKey: 'contracts', category: 'Comercial' },
    { href: '/admin/scope-simulations', label: 'Simulação Comercial', icon: PieChart, roles: ['ADMIN', 'DIRECTOR', 'DEVELOPER', 'OPERATIONS_MANAGER'], tabKey: 'scope-simulations', category: 'Comercial' },
    { href: '/admin/quotations', label: 'Cotação de Empresas', icon: FileText, roles: ['ADMIN', 'DIRECTOR', 'DEVELOPER', 'OPERATIONS_MANAGER'], tabKey: 'quotations', category: 'Comercial' },
    { href: '/admin/price-groups', label: 'Grupos de Preço', icon: Tag, roles: ['ADMIN', 'DIRECTOR'], tabKey: 'price-groups', category: 'Comercial' },
    { href: '/admin/products', label: 'Produtos', icon: Package, roles: ['ADMIN', 'DIRECTOR'], tabKey: 'products', category: 'Comercial' },
    { href: '/admin/categories', label: 'Categorias', icon: FolderOpen, roles: ['ADMIN', 'DIRECTOR'], tabKey: 'categories', category: 'Comercial' },
    { href: '/admin/orders', label: 'Pedidos', icon: ShoppingCart, roles: ['ADMIN', 'OPERATIONS_MANAGER', 'FINANCEIRO', 'DIRECTOR', 'LOGISTICS'], tabKey: 'orders', category: 'Pedidos' },
    { href: '/admin/special-orders', label: 'Pedidos Pontuais', icon: Star, roles: ['ADMIN', 'OPERATIONS_MANAGER', 'DIRECTOR', 'DEVELOPER', 'LOGISTICS'], tabKey: 'special-orders', category: 'Pedidos' },
    { href: '/admin/order-windows', label: 'Janelas de Pedido', icon: CalendarDays, roles: ['ADMIN', 'OPERATIONS_MANAGER', 'DIRECTOR'], tabKey: 'order-windows', category: 'Pedidos' },
    { href: '/admin/order-exceptions', label: 'Exceções de Pedido', icon: ShieldCheck, roles: ['ADMIN', 'DIRECTOR'], tabKey: 'order-exceptions', category: 'Pedidos' },
    { href: '/admin/purchasing', label: 'Compras', icon: BarChart3, roles: ['ADMIN', 'PURCHASE_MANAGER', 'DIRECTOR'], tabKey: 'purchasing', category: 'Compras' },
    { href: '/admin/purchase-planning', label: 'Planejamento de Compras', icon: ShoppingBag, roles: ['ADMIN', 'DIRECTOR', 'DEVELOPER', 'PURCHASE_MANAGER', 'OPERATIONS_MANAGER'], tabKey: 'purchase-planning', category: 'Compras' },
    { href: '/admin/inventory', label: 'Estoque / Inventário', icon: Warehouse, roles: ['ADMIN', 'DIRECTOR', 'DEVELOPER', 'PURCHASE_MANAGER'], tabKey: 'inventory', category: 'Compras' },
    { href: '/admin/industrialized', label: 'Industrializados', icon: Factory, roles: ['ADMIN', 'PURCHASE_MANAGER', 'DIRECTOR'], tabKey: 'industrialized', category: 'Compras' },
    { href: '/admin/waste-control', label: 'Controle de Desperdício', icon: TrendingDown, roles: ['ADMIN', 'DIRECTOR', 'DEVELOPER', 'OPERATIONS_MANAGER', 'PURCHASE_MANAGER', 'LOGISTICS'], tabKey: 'waste-control', category: 'Compras' },
    { href: '/admin/sanitary', label: 'Vigilância Sanitária', icon: ShieldCheck, roles: ['ADMIN', 'DIRECTOR', 'DEVELOPER', 'NUTRICIONISTA', 'OPERATIONS_MANAGER', 'PURCHASE_MANAGER', 'LOGISTICS', 'FINANCEIRO'], tabKey: 'sanitary', category: 'Qualidade' },
    { href: '/admin/import-data', label: 'Importar Dados', icon: Upload, roles: ['ADMIN', 'DIRECTOR', 'DEVELOPER', 'OPERATIONS_MANAGER', 'PURCHASE_MANAGER'], tabKey: 'import-data', category: 'Gestão' },
    { href: '/admin/logistics', label: 'Logística', icon: Truck, roles: ['ADMIN', 'DIRECTOR', 'DEVELOPER', 'OPERATIONS_MANAGER', 'LOGISTICS'], tabKey: 'logistics', category: 'Logística', moduloChave: 'logistica' },
    { href: '/admin/driver-panel', label: 'Painel do Motorista', icon: Route, roles: ['ADMIN', 'DIRECTOR', 'DEVELOPER', 'LOGISTICS', 'MASTER', 'MOTORISTA'], tabKey: 'driver-panel', category: 'Logística' },
    { href: '/admin/financial', label: 'Painel Financeiro', icon: PieChart, roles: ['ADMIN', 'FINANCEIRO', 'DIRECTOR'], tabKey: 'financial', category: 'Financeiro', moduloChave: 'financeiro' },
    { href: '/admin/fiscal', label: 'Gestão de Notas Fiscais', icon: Receipt, roles: ['ADMIN', 'FINANCEIRO', 'DIRECTOR', 'DEVELOPER'], tabKey: 'fiscal', category: 'Financeiro', moduloChave: 'fiscal' },
    { href: '/admin/fiscal-config', label: 'Configurações Fiscais', icon: Settings, roles: ['ADMIN', 'DIRECTOR', 'DEVELOPER'], tabKey: 'fiscal-config', category: 'Financeiro', moduloChave: 'fiscal' },
    { href: '/admin/finance', label: 'Contas & Caixa', icon: DollarSign, roles: ['ADMIN', 'FINANCEIRO', 'DIRECTOR'], tabKey: 'finance', category: 'Financeiro', moduloChave: 'financeiro' },
    { href: '/admin/nfe', label: 'Emissão de NF-e', icon: ReceiptText, roles: ['ADMIN', 'FINANCEIRO', 'DIRECTOR'], tabKey: 'nfe', category: 'Financeiro', moduloChave: 'fiscal' },
    { href: '/admin/banco', label: 'Integração Bancária', icon: Landmark, roles: ['ADMIN', 'FINANCEIRO', 'DIRECTOR'], tabKey: 'banco', category: 'Financeiro', moduloChave: 'financeiro' },
    { href: '/admin/tasks', label: 'Tarefas', icon: ClipboardList, roles: ['ADMIN', 'DIRECTOR', 'DEVELOPER', 'OPERATIONS_MANAGER', 'PURCHASE_MANAGER', 'FINANCEIRO', 'LOGISTICS'], tabKey: 'tasks', category: 'Gestão' },
    { href: '/admin/client-incidents', label: 'Ocorrências de Clientes', icon: Building2, roles: ['ADMIN', 'DIRECTOR', 'DEVELOPER', 'OPERATIONS_MANAGER', 'LOGISTICS'], tabKey: 'incidents', category: 'Gestão' },
    { href: '/admin/internal-incidents', label: 'Ocorrências Internas', icon: AlertTriangle, roles: ['ADMIN', 'DIRECTOR', 'DEVELOPER', 'OPERATIONS_MANAGER', 'LOGISTICS'], tabKey: 'internal-incidents', category: 'Gestão' },
    { href: '/admin/announcements', label: 'Painel de Avisos', icon: Megaphone, roles: ['ADMIN', 'DIRECTOR', 'DEVELOPER'], tabKey: 'announcements', category: 'Gestão' },
    { href: '/admin/password-reset-requests', label: 'Senhas de Clientes', icon: KeyRound, roles: ['ADMIN', 'DIRECTOR'], tabKey: 'password-reset', category: 'Gestão' },
    { href: '/admin/intelligence', label: 'IA Operacional', icon: Brain, roles: ['ADMIN', 'DIRECTOR', 'DEVELOPER', 'OPERATIONS_MANAGER', 'PURCHASE_MANAGER', 'LOGISTICS'], tabKey: 'intelligence', category: 'Inteligência', moduloChave: 'ia' },
    { href: '/admin/commercial-intelligence', label: 'Inteligência Comercial', icon: Users, roles: ['ADMIN', 'DIRECTOR', 'DEVELOPER', 'OPERATIONS_MANAGER'], tabKey: 'commercial-intelligence', category: 'Inteligência', moduloChave: 'ia' },
    { href: '/admin/financial-intelligence', label: 'Inteligência Financeira', icon: DollarSign, roles: ['ADMIN', 'DIRECTOR', 'DEVELOPER', 'FINANCEIRO'], tabKey: 'financial-intelligence', category: 'Inteligência', moduloChave: 'ia' },
    { href: '/admin/logistics-intelligence', label: 'Inteligência Logística', icon: Route, roles: ['ADMIN', 'DIRECTOR', 'DEVELOPER', 'OPERATIONS_MANAGER', 'PURCHASE_MANAGER', 'LOGISTICS'], tabKey: 'logistics-intelligence', category: 'Inteligência', moduloChave: 'logistica_inteligente' },
    { href: '/admin/clara-training', label: 'Treinar Clara', icon: GraduationCap, roles: ['ADMIN', 'DIRECTOR', 'DEVELOPER'], tabKey: 'clara-training', category: 'Inteligência' },
    { href: '/admin/treinamento', label: 'Central de Treinamento', icon: BookOpen, roles: ['MASTER', 'ADMIN', 'DIRECTOR', 'DEVELOPER', 'OPERATIONS_MANAGER', 'LOGISTICS', 'FINANCEIRO', 'PURCHASE_MANAGER'], tabKey: 'treinamento', category: 'Treinamento' },
    { href: '/admin/users', label: 'Usuários do Sistema', icon: UserCog, roles: ['ADMIN', 'DEVELOPER', 'DIRECTOR'], tabKey: 'users', category: 'Sistema' },
    { href: '/admin/system-health', label: 'Saúde do Sistema', icon: Activity, roles: ['ADMIN', 'DEVELOPER', 'DIRECTOR'], tabKey: 'system-health', category: 'Sistema' },
    { href: '/admin/backups', label: 'Backup & E-mails', icon: HardDrive, roles: ['ADMIN', 'DEVELOPER', 'DIRECTOR'], tabKey: 'backups', category: 'Sistema' },
    { href: '/admin/email-management', label: 'Central de E-mails', icon: Mail, roles: ['ADMIN', 'DIRECTOR', 'DEVELOPER', 'OPERATIONS_MANAGER'], tabKey: 'email-management', category: 'Sistema' },
    { href: '/admin/smtp-config', label: 'Configuração SMTP', icon: Settings, roles: ['ADMIN', 'DIRECTOR', 'DEVELOPER'], tabKey: 'smtp-config', category: 'Sistema' },
    { href: '/admin/notification-settings', label: 'Notificações Push', icon: Bell, roles: ['ADMIN', 'DIRECTOR', 'DEVELOPER'], tabKey: 'notification-settings', category: 'Sistema' },
    { href: '/admin/about-us', label: 'Quem Somos Nós', icon: Building2, roles: ['ADMIN', 'DIRECTOR', 'DEVELOPER', 'OPERATIONS_MANAGER', 'PURCHASE_MANAGER', 'FINANCEIRO', 'LOGISTICS'], tabKey: 'about-us', category: 'Sistema' },
    { href: '/admin/support', label: 'Configuração de Suporte', icon: ShieldCheck, roles: ['ADMIN', 'DEVELOPER', 'DIRECTOR'], tabKey: 'support', category: 'Sistema' },
    { href: '/admin/ai-developer', label: 'AI Developer', icon: Bot, roles: ['DEVELOPER', 'ADMIN', 'DIRECTOR', 'MASTER'], tabKey: 'ai-developer', category: 'Sistema' },
    { href: '/admin/security-intelligence', label: 'Security Intelligence', icon: ShieldCheck, roles: ['MASTER', 'ADMIN'], tabKey: 'security-intelligence', category: 'Sistema' },
    { href: '/admin/developer', label: 'Área do Desenvolvedor', icon: ShieldCheck, roles: ['DEVELOPER', 'ADMIN', 'DIRECTOR', 'MASTER'], tabKey: 'developer', category: 'Sistema' },
    { href: '/admin/master-control', label: 'Painel MASTER', icon: ShieldCheck, roles: ['MASTER'], tabKey: 'master-control', category: 'Sistema' },
    { href: '/admin/observability', label: 'Observabilidade', icon: Activity, roles: ['MASTER'], tabKey: 'observability', category: 'Sistema' },
    { href: '/admin/saas-dashboard', label: 'Gestão SaaS', icon: ShieldCheck, roles: ['MASTER', 'ADMIN', 'DIRECTOR', 'GESTOR_CONTRATOS'], tabKey: 'saas-dashboard', category: 'SaaS' },
    { href: '/admin/saas-financeiro', label: 'Painel Financeiro SaaS', icon: TrendingUp, roles: ['MASTER', 'ADMIN', 'DIRECTOR', 'GESTOR_CONTRATOS'], tabKey: 'saas-financeiro', category: 'SaaS' },
    { href: '/admin/marketplace', label: 'Loja de Módulos', icon: Package, roles: ['MASTER', 'ADMIN', 'DIRECTOR', 'DEVELOPER'], tabKey: 'marketplace', category: 'SaaS' },
    { href: '/admin/white-label', label: 'White Label', icon: Palette, roles: ['MASTER', 'ADMIN', 'DIRECTOR', 'DEVELOPER'], tabKey: 'white-label', category: 'SaaS' },
    { href: '/admin/system-updates', label: 'Atualizações do Sistema', icon: RefreshCw, roles: ['MASTER', 'ADMIN', 'DEVELOPER'], tabKey: 'system-updates', category: 'SaaS' },
    { href: '/admin/settings', label: 'Minha Conta', icon: UserCircle, roles: ['MASTER', 'ADMIN', 'DIRECTOR', 'DEVELOPER', 'OPERATIONS_MANAGER', 'FINANCEIRO', 'LOGISTICS', 'PURCHASE_MANAGER', 'NUTRICIONISTA', 'MOTORISTA'], tabKey: 'settings', category: 'Conta' },
  ];

  const isContratual = company?.clientType === 'contratual';
  const clientLinks = [
    { href: '/client', label: 'Início', icon: LayoutDashboard },
    ...(isContratual
      ? [{ href: '/client/contract-scope', label: 'Meu Escopo Contratual', icon: FileText }]
      : [{ href: '/client/order', label: 'Novo Pedido', icon: ShoppingCart }]
    ),
    { href: '/client/history', label: 'Histórico de Pedidos', icon: Receipt },
    ...(!isContratual ? [{ href: '/client/special-order', label: 'Pedidos Pontuais', icon: Star }] : []),
    { href: '/client/incidents', label: 'Ocorrências', icon: AlertTriangle },
    { href: '/client/profile', label: 'Perfil da Empresa', icon: UserCircle },
    { href: '/client/about-us', label: 'Quem Somos Nós', icon: Building2 },
  ];

  const userTabPerms = user?.tabPermissions as string[] | null | undefined;
  const isMaster = user?.role === 'MASTER';
  const links = isStaff 
    ? adminLinks.filter(l => {
        if (isMaster) return true; // MASTER sees everything
        if (!l.roles.includes(user?.role || '')) return false;
        if (!userTabPerms || userTabPerms.length === 0) {
          // Apply module filtering for non-admin roles when modules are loaded
          if (l.moduloChave && !isAdminRole && allowedModulos && allowedModulos.length > 0) {
            return allowedModulos.includes(l.moduloChave);
          }
          return true;
        }
        if (!userTabPerms.includes(l.tabKey)) return false;
        // Apply module filtering for non-admin roles when modules are loaded
        if (l.moduloChave && !isAdminRole && allowedModulos && allowedModulos.length > 0) {
          return allowedModulos.includes(l.moduloChave);
        }
        return true;
      })
    : isClient ? clientLinks : [];

  const roleLabel = (role?: string) => {
    switch (role) {
      case 'MASTER': return 'Master';
      case 'ADMIN': return 'Administrador';
      case 'OPERATIONS_MANAGER': return 'Gerente de Operações';
      case 'PURCHASE_MANAGER': return 'Gerente de Compras';
      case 'DEVELOPER': return 'Desenvolvedor';
      case 'FINANCEIRO': return 'Financeiro';
      case 'DIRECTOR': return 'Diretor';
      case 'LOGISTICS': return 'Logística';
      case 'MOTORISTA': return 'Motorista';
      case 'NUTRICIONISTA': return 'Nutricionista';
      default: return role || '';
    }
  };

  const currentPageLabel = links.find(l => l.href === location)?.label || 'Painel';

  const SidebarContent = () => (
    <>
      <div className="p-5 flex items-center gap-3 border-b border-border/50">
        <div className="w-10 h-10 rounded-xl overflow-hidden flex-shrink-0 flex items-center justify-center shadow-lg shadow-primary/25">
          {logoData?.logoBase64 ? (
            <img
              src={`data:${logoData.logoType};base64,${logoData.logoBase64}`}
              alt="Logo"
              className="w-full h-full object-contain"
            />
          ) : (
            <div className="w-full h-full bg-gradient-to-br from-primary to-primary/80 flex items-center justify-center">
              <Leaf className="w-6 h-6 text-primary-foreground" />
            </div>
          )}
        </div>
        <div className="flex-1 min-w-0">
          <h1 className="font-display font-bold text-xl tracking-tight text-foreground leading-none">VivaFrutaz</h1>
          <p className="text-xs text-muted-foreground font-medium mt-1">Portal B2B</p>
        </div>
        {/* Close button on mobile */}
        <button
          onClick={() => setSidebarOpen(false)}
          className="md:hidden w-8 h-8 rounded-lg flex items-center justify-center text-muted-foreground hover:bg-muted transition-colors"
          aria-label="Fechar menu"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      {isStaff && (
        <div className="px-3 pt-3 pb-1">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
            <input
              data-testid="input-sidebar-search"
              type="text"
              placeholder="Buscar funcionalidade..."
              value={sidebarSearch}
              onChange={e => setSidebarSearch(e.target.value)}
              className="w-full pl-9 pr-3 py-2 text-sm bg-muted/50 border border-border/50 rounded-xl text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/50 transition-all"
            />
          </div>
        </div>
      )}

      <nav className="flex-1 overflow-y-auto py-2 px-3">
        {(() => {
          const searchTerm = sidebarSearch.trim().toLowerCase();
          const visibleLinks = links.filter(l => {
            if (!searchTerm) return true;
            return l.label.toLowerCase().includes(searchTerm) || (l as any).category?.toLowerCase().includes(searchTerm);
          });

          if (!isStaff || searchTerm) {
            return (
              <div className="space-y-1">
                {visibleLinks.map((link) => {
                  const Icon = link.icon;
                  const isActive = location === link.href;
                  return (
                    <Link
                      key={link.href}
                      href={link.href}
                      className={`flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-200 font-medium text-sm min-h-[48px] ${
                        isActive
                          ? 'bg-primary/10 text-primary'
                          : 'text-muted-foreground hover:bg-muted hover:text-foreground active:bg-muted'
                      }`}
                    >
                      <Icon className={`w-5 h-5 flex-shrink-0 ${isActive ? 'text-primary' : ''}`} />
                      <span className="truncate">{link.label}</span>
                    </Link>
                  );
                })}
                {visibleLinks.length === 0 && (
                  <p className="text-xs text-muted-foreground text-center py-6">Nenhuma funcionalidade encontrada</p>
                )}
              </div>
            );
          }

          const categoryOrder = ['Painel', 'Comercial', 'Pedidos', 'Compras', 'Logística', 'Financeiro', 'Gestão', 'Inteligência', 'Sistema', 'SaaS', 'Treinamento'];
          const grouped: Record<string, any[]> = {};
          visibleLinks.forEach(l => {
            const cat = (l as any).category || 'Outros';
            if (!grouped[cat]) grouped[cat] = [];
            grouped[cat].push(l);
          });

          return (
            <div className="space-y-4">
              {categoryOrder.filter(cat => grouped[cat]?.length).map(cat => (
                <div key={cat}>
                  <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/60 px-4 mb-1">{cat}</p>
                  <div className="space-y-0.5">
                    {grouped[cat].map((link) => {
                      const Icon = link.icon;
                      const isActive = location === link.href;
                      return (
                        <Link
                          key={link.href}
                          href={link.href}
                          className={`flex items-center gap-3 px-4 py-2.5 rounded-xl transition-all duration-200 font-medium text-sm min-h-[44px] ${
                            isActive
                              ? 'bg-primary/10 text-primary'
                              : 'text-muted-foreground hover:bg-muted hover:text-foreground active:bg-muted'
                          }`}
                        >
                          <Icon className={`w-4 h-4 flex-shrink-0 ${isActive ? 'text-primary' : ''}`} />
                          <span className="truncate text-[13px]">{link.label}</span>
                        </Link>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          );
        })()}
      </nav>

      <div className="p-4 border-t border-border/50 space-y-2">
        {isStaff && <TrainingModeButton />}
        <div className="px-4 py-3 bg-muted/30 rounded-xl">
          <p className="text-sm font-bold text-foreground truncate">
            {isStaff ? user?.name : company?.companyName}
          </p>
          <p className="text-xs text-muted-foreground truncate">
            {isStaff ? roleLabel(user?.role) : company?.contactName}
          </p>
        </div>
        <button 
          data-testid="button-logout"
          onClick={() => logout()}
          className="w-full flex items-center gap-3 px-4 py-3 rounded-xl text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors font-medium text-sm min-h-[48px]"
        >
          <LogOut className="w-5 h-5" />
          Sair
        </button>
      </div>
    </>
  );

  const handleAskClara = (message: string) => {
    window.dispatchEvent(new CustomEvent('clara:ask', { detail: { message } }));
  };

  return (
    <TrainingModeProvider onAskClara={handleAskClara}>
    <div className="h-screen overflow-hidden bg-background flex">
      {/* Mobile overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/50 md:hidden"
          onClick={() => setSidebarOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* Sidebar — fixed on mobile (drawer), static on desktop */}
      <aside
        className={`
          fixed md:static inset-y-0 left-0 z-40
          w-72 md:w-64 h-full md:h-screen
          bg-card border-r border-border/50
          flex flex-col flex-shrink-0
          premium-shadow
          transition-transform duration-300 ease-in-out
          ${sidebarOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'}
        `}
      >
        {SidebarContent()}
      </aside>

      {/* Main area */}
      <div className="flex-1 flex flex-col min-w-0 md:ml-0">
        <VirtualAssistant />
        <WhatsNewModal />
        <PWAInstallPrompt />

        {testModeActive && (
          <div className="flex items-center justify-center gap-2 bg-amber-400 text-amber-900 px-4 py-2 text-sm font-bold shrink-0 z-20">
            <FlaskConical className="w-4 h-4" />
            <span className="hidden sm:inline">MODO TESTE ATIVO — Pedidos criados não afetam dados reais</span>
            <span className="sm:hidden">MODO TESTE ATIVO</span>
            <FlaskConical className="w-4 h-4" />
          </div>
        )}

        {/* Top bar with hamburger on mobile */}
        <header className="h-16 border-b border-border/50 bg-card/50 backdrop-blur-sm flex items-center gap-3 px-4 md:px-6 shrink-0 sticky top-0 z-10">
          <button
            onClick={() => setSidebarOpen(true)}
            className="md:hidden w-10 h-10 rounded-xl flex items-center justify-center text-muted-foreground hover:bg-muted transition-colors flex-shrink-0"
            aria-label="Abrir menu"
            data-testid="button-open-sidebar"
          >
            <Menu className="w-5 h-5" />
          </button>
          <h2 className="text-base md:text-lg font-bold text-foreground truncate hidden md:block shrink-0">
            {currentPageLabel}
          </h2>
          <div className="flex-1 flex justify-center md:justify-end">
            <GlobalSearch />
          </div>
        </header>

        <main className="flex-1 overflow-y-auto p-4 md:p-8">
          <div className="max-w-7xl mx-auto">
            {children}
          </div>
        </main>
      </div>
    </div>
    </TrainingModeProvider>
  );
}
