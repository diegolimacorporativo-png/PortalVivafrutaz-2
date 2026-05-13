import { Switch, Route, Redirect, useLocation, Link } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useAuth } from "@/hooks/use-auth";
import { ErrorBoundary, PageBoundary } from "@/components/ErrorBoundary";
import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import NotFound from "@/pages/not-found";
import FloatingGuide from "@/components/FloatingGuide";
import { fetchWithAuth } from "@/lib/fetchWithAuth";

// Keep-alive: ping every 5 minutes to prevent Replit sleep
function KeepAlive() {
  useEffect(() => {
    const ping = () => fetchWithAuth('/api/health').catch(() => {});
    const id = setInterval(ping, 5 * 60 * 1000);
    return () => clearInterval(id);
  }, []);
  return null;
}

// Redirects to /login when any request fires auth:expired
function AuthExpiredHandler() {
  const [, setLocation] = useLocation();
  useEffect(() => {
    const handler = () => {
      const currentPath = window.location.pathname;
      // 🔒 Guard: never redirect if already on login — prevents infinite loop
      if (currentPath === "/login" || currentPath === "/auth") {
        return;
      }
      sessionStorage.setItem("redirect_after_login", currentPath);
      sessionStorage.setItem("auth_expired", "1");
      if (import.meta.env.DEV) console.warn("[REDIRECT_TRIGGER]", { to: "/login", from: currentPath, source: "AuthExpiredHandler", timestamp: Date.now() });
      setLocation("/login");
    };
    window.addEventListener("auth:expired", handler);
    return () => window.removeEventListener("auth:expired", handler);
  }, [setLocation]);
  return null;
}

// Page Imports
import Login from "@/pages/auth/login";
import ResetPassword from "@/pages/auth/reset-password";
import ChangePassword from "@/pages/auth/change-password";
import AdminDashboard from "@/pages/admin/dashboard";
import AdminCompanies from "@/pages/admin/companies";
import AdminProducts from "@/pages/admin/products";
import AdminCategories from "@/pages/admin/categories";
import AdminPriceGroups from "@/pages/admin/price-groups";
import AdminOrderWindows from "@/pages/admin/order-windows";
import AdminOrders from "@/pages/admin/orders";
import AdminOrderExceptions from "@/pages/admin/order-exceptions";
import PurchasingReport from "@/pages/admin/reports/purchasing";
import IndustrializedReport from "@/pages/admin/reports/industrialized";
import FinancialReport from "@/pages/admin/reports/financial";
import PasswordResetRequestsPage from "@/pages/admin/password-reset-requests";

import AdminSpecialOrders from "@/pages/admin/special-orders";
import AdminUsers from "@/pages/admin/users";
import AdminBackups from "@/pages/admin/backups";
import AdminDeveloper from "@/pages/admin/developer";
import AdminMasterControl from "@/pages/admin/master-control";
import AdminSupportConfig from "@/pages/admin/support-config";
import AdminAnnouncements from "@/pages/admin/announcements";
import AdminSystemHealth from "@/pages/admin/system-health";
import AdminSecurityAudit from "@/pages/admin/security-audit";
import AdminSecurityIntelligence from "@/pages/admin/security-intelligence";
import SecurityDashboard from "@/pages/admin/security-dashboard";
import GovernanceDashboard from "@/pages/admin/governance-dashboard";

import AdminTasks from "@/pages/admin/tasks";
import AdminClientIncidents from "@/pages/admin/client-incidents";
import AdminInternalIncidents from "@/pages/admin/internal-incidents";
import AdminLogistics from "@/pages/admin/logistics";
import AdminQuotations from "@/pages/admin/quotations";
import AdminExecutiveDashboard from "@/pages/admin/executive-dashboard";
import AdminWasteControl from "@/pages/admin/waste-control";
import AdminPurchasePlanning from "@/pages/admin/purchase-planning";
import AdminInventory from "@/pages/admin/inventory";
import AdminFiscal from "@/pages/admin/fiscal";
import AdminFiscalConfig from "@/pages/admin/fiscal-config";
import AdminFiscalDiagnostics from "@/pages/admin/fiscal-diagnostics";
import AdminContracts from "@/pages/admin/contracts";
import AdminEmailManagement from "@/pages/admin/email-management";
import AdminAboutUs from "@/pages/admin/about-us";
import AdminSmtpConfig from "@/pages/admin/smtp-config";
import AdminIntelligence from "@/pages/admin/intelligence";
import AdminClaraTraining from "@/pages/admin/clara-training";
import AdminCommercialIntelligence from "@/pages/admin/commercial-intelligence";
import AdminFinancialIntelligence from "@/pages/admin/financial-intelligence";
import AdminFinance from "@/pages/admin/finance";
import AdminNfe from "@/pages/admin/nfe";
import CentralFaturamento from "@/pages/admin/faturamento";
import InsertNfManual from "@/pages/admin/insert-nf-manual";
import AdminBanco from "@/pages/admin/banco";
import AdminAiDeveloper from "@/pages/admin/ai-developer";
import AdminLogisticsIntelligence from "@/pages/admin/logistics-intelligence";
import AdminDriverPanel from "@/pages/admin/driver-panel";
import TrackDelivery from "@/pages/track";
import DriverMap from "@/pages/driver-map";
import AdminNotificationSettings from "@/pages/admin/notification-settings";
import AdminScopeSimulations from "@/pages/admin/scope-simulations";
import SaasDashboard from "@/pages/admin/saas-dashboard";
import SystemUpdates from "@/pages/admin/system-updates";
import SaasFinanceiro from "@/pages/admin/saas-financeiro";
import Marketplace from "@/pages/admin/marketplace";
import WhiteLabel from "@/pages/admin/white-label";
import TestClaraPage from "@/pages/test-clara";
import AdminTreinamento from "@/pages/admin/treinamento";
import AdminSanitary from "@/pages/admin/sanitary";
import AdminImportData from "@/pages/admin/import-data";
import ControlCenter from "@/pages/admin/control-center";
import AdminSettings from "@/pages/admin/settings";
import AdminObservability from "@/pages/admin/observability";

import ClientDashboard from "@/pages/client/dashboard";
import ClientCreateOrder from "@/pages/client/create-order";
import ClientOrderHistory from "@/pages/client/order-history";
import ClientEditOrder from "@/pages/client/edit-order";
import ClientSpecialOrder from "@/pages/client/special-order";
import ClientIncidents from "@/pages/client/incidents";
import ClientQuotations from "@/pages/client/quotations";
import ClientProfile from "@/pages/client/profile";
import ClientAboutUs from "@/pages/client/about-us";
import ClientContractScope from "@/pages/client/contract-scope";

// Maintenance screen for blocked clients
function MaintenanceScreen() {
  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-6">
      <div className="max-w-md w-full text-center">
        <div className="w-24 h-24 rounded-full bg-orange-100 flex items-center justify-center mx-auto mb-6">
          <svg className="w-12 h-12 text-orange-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
        </div>
        <div className="flex items-center justify-center gap-2 mb-2">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-primary to-primary/80 flex items-center justify-center">
            <svg className="w-4 h-4 text-white" fill="currentColor" viewBox="0 0 24 24">
              <path d="M17 8C8 10 5.9 16.17 3.82 21.34L5.71 22l1-2.3A4.49 4.49 0 0 0 8 20C19 20 22 3 22 3c-1 2-8 2-8 2" />
            </svg>
          </div>
          <span className="font-display font-bold text-xl text-foreground">VivaFrutaz</span>
        </div>
        <h1 className="text-2xl font-display font-bold text-foreground mt-4">Sistema em Manutenção</h1>
        <p className="text-muted-foreground mt-3 text-base leading-relaxed">
          Sistema VivaFrutaz em manutenção. Retornaremos em breve.
        </p>
        <p className="text-sm text-muted-foreground/70 mt-4">
          Em caso de urgência, entre em contato com a equipe VivaFrutaz.
        </p>
        <Link
          href="/equipe"
          data-testid="link-maintenance-team-access"
          className="mt-6 inline-flex items-center justify-center gap-2 py-3 px-6 rounded-xl bg-primary text-primary-foreground font-bold text-sm shadow-lg shadow-primary/25 hover:-translate-y-0.5 active:translate-y-0 transition-all duration-200"
        >
          Acesso da Equipe
        </Link>
      </div>
    </div>
  );
}

const FULL_ACCESS_ROLES = ['MASTER', 'ADMIN', 'DIRECTOR'];

// Auth Guard Wrapper
function UnauthorizedModule() {
  return (
    <div className="min-h-screen bg-background flex items-center justify-center">
      <div className="text-center space-y-4 p-8">
        <div className="w-16 h-16 rounded-2xl bg-red-100 flex items-center justify-center mx-auto">
          <svg className="w-8 h-8 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M5.07 19H19a2 2 0 001.75-2.97L13.75 4a2 2 0 00-3.5 0L3.25 16.03A2 2 0 005.07 19z" />
          </svg>
        </div>
        <h2 className="text-xl font-bold text-foreground">Acesso não autorizado para este módulo.</h2>
        <p className="text-muted-foreground text-sm max-w-xs mx-auto">Você não possui permissão para acessar esta área. Entre em contato com o administrador do sistema.</p>
        <a href="/admin" className="inline-block mt-2 px-6 py-2.5 bg-primary text-primary-foreground font-semibold rounded-xl text-sm hover:opacity-90 transition-opacity">Voltar ao início</a>
      </div>
    </div>
  );
}

function ProtectedRoute({
  component: Component,
  role,
  allowedRoles,
  tabKey,
}: {
  component: any;
  role?: 'admin' | 'client';
  allowedRoles?: string[];
  tabKey?: string;
}) {
  const { isAuthenticated, isStaff, isClient, isLoading, user } = useAuth();
  const [location] = useLocation();

  const { data: maintenance } = useQuery<{ enabled: boolean }>({
    queryKey: ['/api/settings/maintenance'],
    enabled: role === 'client',
    staleTime: 30000,
  });

  // T804 — DEV-only: route guard trace logs fire on every render; gate to avoid prod noise.
  if (import.meta.env.DEV) {
    console.warn("[PROTECTED_ROUTE]", { path: window.location.pathname, isLoading, isAuthenticated, role: user?.role, allowedRoles });
  }

  if (isLoading) return <div className="h-screen flex items-center justify-center text-primary font-bold text-xl animate-pulse">Carregando VivaFrutaz...</div>;
  if (!isAuthenticated) {
    if (import.meta.env.DEV) console.warn("[REDIRECT_TRIGGER]", { to: "/login", from: window.location.pathname, source: "ProtectedRoute:!isAuthenticated", timestamp: Date.now() });
    return <Redirect to="/login" />;
  }
  if (role === 'admin' && !isStaff) {
    if (import.meta.env.DEV) console.warn("[REDIRECT_TRIGGER]", { to: "/client", from: window.location.pathname, source: "ProtectedRoute:!isStaff", timestamp: Date.now() });
    return <Redirect to="/client" />;
  }
  if (role === 'client' && !isClient) {
    if (import.meta.env.DEV) console.warn("[REDIRECT_TRIGGER]", { to: "/admin", from: window.location.pathname, source: "ProtectedRoute:!isClient", timestamp: Date.now() });
    return <Redirect to="/admin" />;
  }

  if (allowedRoles && user && !FULL_ACCESS_ROLES.includes(user.role) && !allowedRoles.includes(user.role)) {
    fetchWithAuth('/api/auth/log-unauthorized', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ route: location }),
    }).catch(() => {});
    if (user.role === 'NUTRICIONISTA') {
      if (import.meta.env.DEV) console.warn("[REDIRECT_TRIGGER]", { to: "/admin/sanitary", from: window.location.pathname, source: "ProtectedRoute:NUTRICIONISTA", timestamp: Date.now() });
      return <Redirect to="/admin/sanitary" />;
    }
    if (user.role === 'MOTORISTA') {
      if (import.meta.env.DEV) console.warn("[REDIRECT_TRIGGER]", { to: "/admin/driver-panel", from: window.location.pathname, source: "ProtectedRoute:MOTORISTA", timestamp: Date.now() });
      return <Redirect to="/admin/driver-panel" />;
    }
    return (
      <div className="h-screen flex flex-col items-center justify-center gap-4 text-center px-6">
        <div className="text-5xl">🔒</div>
        <h2 className="text-xl font-bold text-foreground">Acesso negado</h2>
        <p className="text-muted-foreground text-sm max-w-sm">
          Você não tem permissão para acessar esta página. Fale com o administrador do sistema se precisar de acesso.
        </p>
        <button
          onClick={() => { window.location.href = "/admin"; }}
          className="mt-2 px-6 py-2.5 bg-primary text-primary-foreground font-semibold rounded-xl text-sm hover:opacity-90 transition-opacity"
        >
          Voltar ao painel
        </button>
      </div>
    );
  }

  if (tabKey && user && !FULL_ACCESS_ROLES.includes(user.role)) {
    const tabPerms = (user as any).tabPermissions as string[] | null | undefined;
    if (tabPerms && tabPerms.length > 0 && !tabPerms.includes(tabKey)) {
      return <UnauthorizedModule />;
    }
  }

  if (role === 'client' && maintenance?.enabled) {
    return <MaintenanceScreen />;
  }

  return (
    <PageBoundary name={location}>
      <Component />
    </PageBoundary>
  );
}

function HomeRoute() {
  const { isAuthenticated, isStaff, isClient, isLoading, user } = useAuth();
  // T804 — DEV-only: home route trace fires on every render.
  if (import.meta.env.DEV) console.warn("[HOME_ROUTE]", { path: window.location.pathname, isLoading, isAuthenticated, role: user?.role });
  if (isLoading) return <div className="h-screen flex items-center justify-center text-primary font-bold text-xl animate-pulse">Carregando...</div>;
  if (!isAuthenticated) {
    if (import.meta.env.DEV) console.warn("[REDIRECT_TRIGGER]", { to: "/login", from: window.location.pathname, source: "HomeRoute:!isAuthenticated", timestamp: Date.now() });
    return <Redirect to="/login" />;
  }
  if (isStaff) {
    if (user?.role === 'NUTRICIONISTA') {
      if (import.meta.env.DEV) console.warn("[REDIRECT_TRIGGER]", { to: "/admin/sanitary", from: window.location.pathname, source: "HomeRoute:NUTRICIONISTA", timestamp: Date.now() });
      return <Redirect to="/admin/sanitary" />;
    }
    if (user?.role === 'MOTORISTA') {
      if (import.meta.env.DEV) console.warn("[REDIRECT_TRIGGER]", { to: "/admin/driver-panel", from: window.location.pathname, source: "HomeRoute:MOTORISTA", timestamp: Date.now() });
      return <Redirect to="/admin/driver-panel" />;
    }
    if (import.meta.env.DEV) console.warn("[REDIRECT_TRIGGER]", { to: "/admin", from: window.location.pathname, source: "HomeRoute:isStaff", timestamp: Date.now() });
    return <Redirect to="/admin" />;
  }
  if (import.meta.env.DEV) console.warn("[REDIRECT_TRIGGER]", { to: "/client", from: window.location.pathname, source: "HomeRoute:isClient", timestamp: Date.now() });
  return <Redirect to="/client" />;
}

function Router() {
  return (
    <>
    <AuthExpiredHandler />
    <Switch>
      <Route path="/" component={HomeRoute} />
      <Route path="/login">{() => <Login />}</Route>
      <Route path="/auth">{() => <Login />}</Route>
      <Route path="/equipe">{() => <Login forceAdminTab />}</Route>
      <Route path="/reset-password">{() => <ResetPassword />}</Route>
      <Route path="/change-password">{() => <ChangePassword />}</Route>
      <Route path="/os">{() => <Redirect to="/admin/tasks" />}</Route>
      <Route path="/os/:rest*">{() => <Redirect to="/admin/tasks" />}</Route>
      <Route path="/ordem-servico">{() => <Redirect to="/admin/tasks" />}</Route>
      <Route path="/ordem-servico/:rest*">{() => <Redirect to="/admin/tasks" />}</Route>
      <Route path="/admin">
        {() => <ProtectedRoute component={AdminDashboard} role="admin" allowedRoles={['ADMIN', 'DIRECTOR', 'DEVELOPER', 'OPERATIONS_MANAGER', 'PURCHASE_MANAGER', 'FINANCEIRO', 'LOGISTICS']} tabKey="dashboard" />}
      </Route>
      <Route path="/admin/companies">
        {() => <ProtectedRoute component={AdminCompanies} role="admin" allowedRoles={['ADMIN', 'DIRECTOR']} tabKey="companies" />}
      </Route>
      <Route path="/admin/products">
        {() => <ProtectedRoute component={AdminProducts} role="admin" allowedRoles={['ADMIN', 'DIRECTOR']} tabKey="products" />}
      </Route>
      <Route path="/admin/categories">
        {() => <ProtectedRoute component={AdminCategories} role="admin" allowedRoles={['ADMIN', 'DIRECTOR']} tabKey="categories" />}
      </Route>
      <Route path="/admin/price-groups">
        {() => <ProtectedRoute component={AdminPriceGroups} role="admin" allowedRoles={['ADMIN', 'DIRECTOR']} tabKey="price-groups" />}
      </Route>
      <Route path="/admin/order-windows">
        {() => <ProtectedRoute component={AdminOrderWindows} role="admin" allowedRoles={['ADMIN', 'OPERATIONS_MANAGER', 'DIRECTOR']} tabKey="order-windows" />}
      </Route>
      <Route path="/admin/order-exceptions">
        {() => <ProtectedRoute component={AdminOrderExceptions} role="admin" allowedRoles={['ADMIN', 'DIRECTOR']} tabKey="order-exceptions" />}
      </Route>
      <Route path="/admin/orders">
        {() => <ProtectedRoute component={AdminOrders} role="admin" allowedRoles={['ADMIN', 'OPERATIONS_MANAGER', 'FINANCEIRO', 'DIRECTOR', 'LOGISTICS']} tabKey="orders" />}
      </Route>
      <Route path="/admin/purchasing">
        {() => <ProtectedRoute component={PurchasingReport} role="admin" allowedRoles={['ADMIN', 'PURCHASE_MANAGER', 'DIRECTOR']} tabKey="purchasing" />}
      </Route>
      <Route path="/admin/industrialized">
        {() => <ProtectedRoute component={IndustrializedReport} role="admin" allowedRoles={['ADMIN', 'PURCHASE_MANAGER', 'DIRECTOR']} tabKey="industrialized" />}
      </Route>
      <Route path="/admin/financial">
        {() => <ProtectedRoute component={FinancialReport} role="admin" allowedRoles={['ADMIN', 'FINANCEIRO', 'DIRECTOR']} tabKey="financial" />}
      </Route>
      <Route path="/admin/password-reset-requests">
        {() => <ProtectedRoute component={PasswordResetRequestsPage} role="admin" allowedRoles={['ADMIN', 'DIRECTOR']} tabKey="password-reset" />}
      </Route>
      <Route path="/admin/special-orders">
        {() => <ProtectedRoute component={AdminSpecialOrders} role="admin" allowedRoles={['ADMIN', 'OPERATIONS_MANAGER', 'DIRECTOR', 'DEVELOPER', 'LOGISTICS']} tabKey="special-orders" />}
      </Route>
      <Route path="/admin/users">
        {() => <ProtectedRoute component={AdminUsers} role="admin" allowedRoles={['ADMIN', 'DEVELOPER', 'DIRECTOR']} tabKey="users" />}
      </Route>
      <Route path="/admin/backups">
        {() => <ProtectedRoute component={AdminBackups} role="admin" allowedRoles={['ADMIN', 'DEVELOPER', 'DIRECTOR']} tabKey="backups" />}
      </Route>
      <Route path="/admin/system-health">
        {() => <ProtectedRoute component={AdminSystemHealth} role="admin" allowedRoles={['ADMIN', 'DEVELOPER', 'DIRECTOR']} tabKey="system-health" />}
      </Route>
      <Route path="/admin/security">
        {() => <ProtectedRoute component={SecurityDashboard} role="admin" allowedRoles={['MASTER', 'ADMIN']} tabKey="security" />}
      </Route>
      <Route path="/admin/security-audit">
        {() => <ProtectedRoute component={AdminSecurityAudit} role="admin" allowedRoles={['MASTER']} tabKey="security-audit" />}
      </Route>
      <Route path="/admin/governance">
        {() => <ProtectedRoute component={GovernanceDashboard} role="admin" allowedRoles={['MASTER', 'ADMIN', 'DIRECTOR', 'DEVELOPER']} tabKey="governance" />}
      </Route>
      <Route path="/admin/security-intelligence">
        {() => <ProtectedRoute component={AdminSecurityIntelligence} role="admin" allowedRoles={['MASTER', 'ADMIN']} tabKey="security-intelligence" />}
      </Route>
      <Route path="/admin/developer">
        {() => <ProtectedRoute component={AdminDeveloper} role="admin" allowedRoles={['DEVELOPER', 'ADMIN', 'DIRECTOR', 'MASTER']} tabKey="developer" />}
      </Route>
      <Route path="/admin/master-control">
        {() => <ProtectedRoute component={AdminMasterControl} role="admin" allowedRoles={['MASTER']} tabKey="master-control" />}
      </Route>
      <Route path="/admin/support">
        {() => <ProtectedRoute component={AdminSupportConfig} role="admin" allowedRoles={['ADMIN', 'DEVELOPER', 'DIRECTOR']} tabKey="support" />}
      </Route>
      <Route path="/admin/announcements">
        {() => <ProtectedRoute component={AdminAnnouncements} role="admin" allowedRoles={['ADMIN', 'DIRECTOR', 'DEVELOPER']} tabKey="announcements" />}
      </Route>
      <Route path="/admin/tasks">
        {() => <ProtectedRoute component={AdminTasks} role="admin" allowedRoles={['ADMIN', 'DIRECTOR', 'DEVELOPER', 'OPERATIONS_MANAGER', 'PURCHASE_MANAGER', 'FINANCEIRO', 'LOGISTICS']} tabKey="tasks" />}
      </Route>
      <Route path="/admin/client-incidents">
        {() => <ProtectedRoute component={AdminClientIncidents} role="admin" allowedRoles={['ADMIN', 'DIRECTOR', 'DEVELOPER', 'OPERATIONS_MANAGER', 'LOGISTICS']} tabKey="incidents" />}
      </Route>
      <Route path="/admin/internal-incidents">
        {() => <ProtectedRoute component={AdminInternalIncidents} role="admin" allowedRoles={['ADMIN', 'DIRECTOR', 'DEVELOPER', 'OPERATIONS_MANAGER', 'LOGISTICS']} tabKey="internal-incidents" />}
      </Route>
      <Route path="/admin/logistics">
        {() => <ProtectedRoute component={AdminLogistics} role="admin" allowedRoles={['ADMIN', 'DIRECTOR', 'DEVELOPER', 'OPERATIONS_MANAGER', 'LOGISTICS']} tabKey="logistics" />}
      </Route>
      <Route path="/admin/quotations">
        {() => <ProtectedRoute component={AdminQuotations} role="admin" allowedRoles={['ADMIN', 'DIRECTOR', 'DEVELOPER', 'OPERATIONS_MANAGER']} tabKey="quotations" />}
      </Route>
      <Route path="/admin/executive">
        {() => <ProtectedRoute component={AdminExecutiveDashboard} role="admin" allowedRoles={['ADMIN', 'DIRECTOR', 'FINANCEIRO', 'DEVELOPER']} tabKey="executive" />}
      </Route>
      <Route path="/admin/waste-control">
        {() => <ProtectedRoute component={AdminWasteControl} role="admin" allowedRoles={['ADMIN', 'DIRECTOR', 'DEVELOPER', 'OPERATIONS_MANAGER', 'PURCHASE_MANAGER', 'LOGISTICS']} tabKey="waste-control" />}
      </Route>
      <Route path="/admin/purchase-planning">
        {() => <ProtectedRoute component={AdminPurchasePlanning} role="admin" allowedRoles={['ADMIN', 'DIRECTOR', 'DEVELOPER', 'PURCHASE_MANAGER', 'OPERATIONS_MANAGER']} tabKey="purchase-planning" />}
      </Route>
      <Route path="/admin/inventory">
        {() => <ProtectedRoute component={AdminInventory} role="admin" allowedRoles={['ADMIN', 'DIRECTOR', 'DEVELOPER', 'PURCHASE_MANAGER']} tabKey="inventory" />}
      </Route>
      <Route path="/admin/fiscal">
        {() => <ProtectedRoute component={AdminFiscal} role="admin" allowedRoles={['ADMIN', 'FINANCEIRO', 'DIRECTOR', 'DEVELOPER']} tabKey="fiscal" />}
      </Route>
      <Route path="/admin/fiscal-config">
        {() => <ProtectedRoute component={AdminFiscalConfig} role="admin" allowedRoles={['ADMIN', 'FINANCEIRO', 'DIRECTOR', 'DEVELOPER']} tabKey="fiscal-config" />}
      </Route>
      <Route path="/admin/fiscal-diagnostics">
        {() => <ProtectedRoute component={AdminFiscalDiagnostics} role="admin" allowedRoles={['ADMIN', 'FINANCEIRO', 'DIRECTOR', 'DEVELOPER']} tabKey="fiscal-diagnostics" />}
      </Route>
      <Route path="/admin/contracts">
        {() => <ProtectedRoute component={AdminContracts} role="admin" allowedRoles={['ADMIN', 'DIRECTOR', 'DEVELOPER', 'OPERATIONS_MANAGER']} tabKey="contracts" />}
      </Route>
      <Route path="/admin/email-management">
        {() => <ProtectedRoute component={AdminEmailManagement} role="admin" allowedRoles={['ADMIN', 'DIRECTOR', 'DEVELOPER', 'OPERATIONS_MANAGER']} tabKey="email-management" />}
      </Route>
      <Route path="/admin/about-us">
        {() => <ProtectedRoute component={AdminAboutUs} role="admin" allowedRoles={['ADMIN', 'DIRECTOR', 'DEVELOPER', 'OPERATIONS_MANAGER', 'PURCHASE_MANAGER', 'FINANCEIRO', 'LOGISTICS']} tabKey="about-us" />}
      </Route>
      <Route path="/admin/smtp-config">
        {() => <ProtectedRoute component={AdminSmtpConfig} role="admin" allowedRoles={['ADMIN', 'DIRECTOR', 'DEVELOPER']} tabKey="smtp-config" />}
      </Route>
      <Route path="/admin/clara-training">
        {() => <ProtectedRoute component={AdminClaraTraining} role="admin" allowedRoles={['ADMIN', 'DIRECTOR', 'DEVELOPER']} tabKey="clara-training" />}
      </Route>
      <Route path="/admin/commercial-intelligence">
        {() => <ProtectedRoute component={AdminCommercialIntelligence} role="admin" allowedRoles={['ADMIN', 'DIRECTOR', 'DEVELOPER', 'OPERATIONS_MANAGER']} tabKey="commercial-intelligence" />}
      </Route>
      <Route path="/admin/financial-intelligence">
        {() => <ProtectedRoute component={AdminFinancialIntelligence} role="admin" allowedRoles={['ADMIN', 'DIRECTOR', 'DEVELOPER', 'FINANCEIRO']} tabKey="financial-intelligence" />}
      </Route>
      <Route path="/admin/finance">
        {() => <ProtectedRoute component={AdminFinance} role="admin" allowedRoles={['ADMIN', 'FINANCEIRO', 'DIRECTOR']} tabKey="finance" />}
      </Route>
      <Route path="/admin/nfe">
        {() => <ProtectedRoute component={AdminNfe} role="admin" allowedRoles={['ADMIN', 'FINANCEIRO', 'DIRECTOR']} tabKey="nfe" />}
      </Route>
      <Route path="/admin/faturamento">
        {() => <ProtectedRoute component={CentralFaturamento} role="admin" allowedRoles={['ADMIN', 'FINANCEIRO', 'DIRECTOR']} tabKey="faturamento" />}
      </Route>
      <Route path="/admin/insert-nf-manual">
        {() => <ProtectedRoute component={InsertNfManual} role="admin" allowedRoles={['ADMIN', 'FINANCEIRO', 'DIRECTOR']} tabKey="insert-nf-manual" />}
      </Route>
      <Route path="/admin/banco">
        {() => <ProtectedRoute component={AdminBanco} role="admin" allowedRoles={['ADMIN', 'FINANCEIRO', 'DIRECTOR']} tabKey="banco" />}
      </Route>
      <Route path="/admin/ai-developer">
        {() => <ProtectedRoute component={AdminAiDeveloper} role="admin" allowedRoles={['MASTER', 'ADMIN', 'DEVELOPER', 'DIRECTOR']} tabKey="ai-developer" />}
      </Route>
      <Route path="/admin/logistics-intelligence">
        {() => <ProtectedRoute component={AdminLogisticsIntelligence} role="admin" allowedRoles={['ADMIN', 'DIRECTOR', 'DEVELOPER', 'OPERATIONS_MANAGER', 'PURCHASE_MANAGER', 'LOGISTICS']} tabKey="logistics-intelligence" />}
      </Route>
      <Route path="/admin/driver-panel">
        {() => <ProtectedRoute component={AdminDriverPanel} role="admin" allowedRoles={['ADMIN', 'DIRECTOR', 'DEVELOPER', 'LOGISTICS', 'MASTER', 'MOTORISTA']} tabKey="driver-panel" />}
      </Route>
      <Route path="/admin/saas-dashboard">
        {() => <ProtectedRoute component={SaasDashboard} role="admin" allowedRoles={['MASTER', 'ADMIN', 'DIRECTOR', 'GESTOR_CONTRATOS']} tabKey="saas-dashboard" />}
      </Route>
      <Route path="/admin/system-updates">
        {() => <ProtectedRoute component={SystemUpdates} role="admin" allowedRoles={['MASTER', 'ADMIN', 'DEVELOPER']} tabKey="system-updates" />}
      </Route>
      <Route path="/admin/saas-financeiro">
        {() => <ProtectedRoute component={SaasFinanceiro} role="admin" allowedRoles={['MASTER', 'ADMIN', 'DIRECTOR', 'DEVELOPER', 'GESTOR_CONTRATOS']} tabKey="saas-financeiro" />}
      </Route>
      <Route path="/admin/marketplace">
        {() => <ProtectedRoute component={Marketplace} role="admin" allowedRoles={['MASTER', 'ADMIN', 'DEVELOPER', 'DIRECTOR']} tabKey="marketplace" />}
      </Route>
      <Route path="/admin/white-label">
        {() => <ProtectedRoute component={WhiteLabel} role="admin" allowedRoles={['MASTER', 'ADMIN', 'DEVELOPER', 'DIRECTOR']} tabKey="white-label" />}
      </Route>
      <Route path="/admin/treinamento">
        {() => <ProtectedRoute component={AdminTreinamento} role="admin" allowedRoles={['MASTER', 'ADMIN', 'DEVELOPER', 'DIRECTOR', 'OPERATIONS_MANAGER', 'LOGISTICS', 'FINANCEIRO', 'PURCHASE_MANAGER']} tabKey="treinamento" />}
      </Route>
      <Route path="/admin/sanitary">
        {() => <ProtectedRoute component={AdminSanitary} role="admin" allowedRoles={['ADMIN', 'DIRECTOR', 'DEVELOPER', 'NUTRICIONISTA', 'OPERATIONS_MANAGER', 'PURCHASE_MANAGER', 'LOGISTICS', 'FINANCEIRO']} tabKey="sanitary" />}
      </Route>
      <Route path="/admin/import-data">
        {() => <ProtectedRoute component={AdminImportData} role="admin" allowedRoles={['ADMIN', 'DIRECTOR', 'DEVELOPER', 'OPERATIONS_MANAGER', 'PURCHASE_MANAGER']} tabKey="import-data" />}
      </Route>
      <Route path="/admin/control-center">
        {() => <ProtectedRoute component={ControlCenter} role="admin" allowedRoles={['MASTER', 'ADMIN', 'DEVELOPER', 'DIRECTOR']} tabKey="control-center" />}
      </Route>
      <Route path="/track/:id">
        {() => <TrackDelivery />}
      </Route>
      <Route path="/driver-map/:routeId">
        {() => <DriverMap />}
      </Route>
      <Route path="/test-clara">
        {() => <TestClaraPage />}
      </Route>
      <Route path="/admin/intelligence">
        {() => <ProtectedRoute component={AdminIntelligence} role="admin" allowedRoles={['ADMIN', 'DIRECTOR', 'DEVELOPER', 'OPERATIONS_MANAGER', 'PURCHASE_MANAGER', 'LOGISTICS']} tabKey="intelligence" />}
      </Route>
      <Route path="/admin/notification-settings">
        {() => <ProtectedRoute component={AdminNotificationSettings} role="admin" allowedRoles={['ADMIN', 'DIRECTOR', 'DEVELOPER']} tabKey="notification-settings" />}
      </Route>
      <Route path="/admin/scope-simulations">
        {() => <ProtectedRoute component={AdminScopeSimulations} role="admin" allowedRoles={['ADMIN', 'DIRECTOR', 'DEVELOPER', 'OPERATIONS_MANAGER']} tabKey="scope-simulations" />}
      </Route>
      <Route path="/admin/settings">
        {() => <ProtectedRoute component={AdminSettings} role="admin" allowedRoles={['MASTER', 'ADMIN', 'DIRECTOR', 'DEVELOPER', 'OPERATIONS_MANAGER', 'FINANCEIRO', 'LOGISTICS', 'PURCHASE_MANAGER', 'NUTRICIONISTA', 'MOTORISTA']} tabKey="settings" />}
      </Route>
      <Route path="/admin/observability">
        {() => <ProtectedRoute component={AdminObservability} role="admin" allowedRoles={['MASTER']} tabKey="observability" />}
      </Route>

      {/* Client Routes */}
      <Route path="/client">
        {() => <ProtectedRoute component={ClientDashboard} role="client" />}
      </Route>
      <Route path="/client/order/edit/:id">
        {() => <ProtectedRoute component={ClientEditOrder} role="client" />}
      </Route>
      <Route path="/client/order">
        {() => <ProtectedRoute component={ClientCreateOrder} role="client" />}
      </Route>
      <Route path="/client/history">
        {() => <ProtectedRoute component={ClientOrderHistory} role="client" />}
      </Route>
      <Route path="/client/special-order">
        {() => <ProtectedRoute component={ClientSpecialOrder} role="client" />}
      </Route>
      <Route path="/client/incidents">
        {() => <ProtectedRoute component={ClientIncidents} role="client" />}
      </Route>
      <Route path="/client/quotations">
        {() => <Redirect to="/client" />}
      </Route>
      <Route path="/client/profile">
        {() => <ProtectedRoute component={ClientProfile} role="client" />}
      </Route>
      <Route path="/client/about-us">
        {() => <ProtectedRoute component={ClientAboutUs} role="client" />}
      </Route>
      <Route path="/client/contract-scope">
        {() => <ProtectedRoute component={ClientContractScope} role="client" />}
      </Route>
      <Route component={NotFound} />
    </Switch>
    </>
  );
}

function FloatingGuideWrapper() {
  const { isAuthenticated, isStaff } = useAuth();
  if (!isAuthenticated || !isStaff) return null;
  return <FloatingGuide />;
}

function App() {
  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <KeepAlive />
          <Toaster />
          <Router />
          <FloatingGuideWrapper />
        </TooltipProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}

export default App;
