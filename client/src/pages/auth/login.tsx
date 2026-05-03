import { useState, useEffect, useRef } from "react";
import { useAuth } from "@/hooks/use-auth";
import { useQuery } from "@tanstack/react-query";
import { Redirect, Link } from "wouter";
import { Leaf, Building2, UserCircle, KeyRound, ArrowLeft, CheckCircle2, Wrench, ShieldCheck } from "lucide-react";

const DOMAIN = "@vivafrutaz.com";

function normalizeToFullEmail(username: string): string {
  const clean = username.trim().toLowerCase();
  if (clean.endsWith(DOMAIN)) return clean;
  return clean + DOMAIN;
}

function usernameFromEmail(email: string): string {
  return email.trim().toLowerCase().replace(new RegExp(`${DOMAIN.replace(/\./g, "\\.")}$`, "i"), "");
}

export default function Login({ forceAdminTab }: { forceAdminTab?: boolean } = {}) {
  const { login, logout, isLoggingIn, isAuthenticated, isStaff, isClient } = useAuth();
  const [type, setType] = useState<'admin' | 'company'>(forceAdminTab ? 'admin' : 'company');
  const didAutoLogout = useRef(false);
  const [sessionExpiredBanner, setSessionExpiredBanner] = useState(false);

  useEffect(() => {
    if (sessionStorage.getItem("auth_expired")) {
      sessionStorage.removeItem("auth_expired");
      setSessionExpiredBanner(true);
    }
  }, []);

  const { data: logoData } = useQuery<{ logoBase64: string; logoType: string }>({
    queryKey: ['/api/company-config/logo'],
    staleTime: 5 * 60 * 1000,
    retry: false,
  });

  const { data: maintenanceData } = useQuery<{ enabled: boolean }>({
    queryKey: ['/api/settings/maintenance'],
    staleTime: 15000,
    retry: false,
  });
  const maintenanceActive = maintenanceData?.enabled ?? false;

  // Both tabs use username only — @vivafrutaz.com is added automatically
  const [companyUsername, setCompanyUsername] = useState("");
  const [adminUsername, setAdminUsername] = useState("");

  const [password, setPassword] = useState("");
  const [showForgot, setShowForgot] = useState(false);
  const [forgotUsername, setForgotUsername] = useState("");
  const [forgotStatus, setForgotStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [forgotMessage, setForgotMessage] = useState("");

  useEffect(() => {
    if (forceAdminTab && isAuthenticated && isClient && !didAutoLogout.current) {
      didAutoLogout.current = true;
      logout();
    }
  }, [forceAdminTab, isAuthenticated, isClient, logout]);

  if (isAuthenticated) {
    if (isStaff) return <Redirect to="/admin" />;
    if (isClient && !forceAdminTab) return <Redirect to="/client" />;
    if (isClient && forceAdminTab) return <div className="h-screen flex items-center justify-center text-primary font-bold text-sm animate-pulse">Redirecionando...</div>;
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const email = type === 'admin'
      ? normalizeToFullEmail(adminUsername)
      : normalizeToFullEmail(companyUsername);
    try {
      await login({ email, password, type });
    } catch {
      // Error toast already shown by useAuth onError handler
    }
  };

  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setForgotStatus('loading');
    try {
      const email = normalizeToFullEmail(forgotUsername);
      const res = await fetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      const data = await res.json();
      if (res.ok) {
        setForgotStatus('success');
        setForgotMessage(data.message);
      } else {
        setForgotStatus('error');
        setForgotMessage(data.message || "Erro ao enviar solicitação.");
      }
    } catch {
      setForgotStatus('error');
      setForgotMessage("Erro de conexão. Tente novamente.");
    }
  };

  return (
    <div className="min-h-screen bg-background flex flex-col justify-center py-12 sm:px-6 lg:px-8 relative overflow-hidden">
      <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-primary/20 rounded-full blur-[100px] pointer-events-none" />
      <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-secondary/20 rounded-full blur-[100px] pointer-events-none" />

      <div className="sm:mx-auto sm:w-full sm:max-w-md relative z-10">
        <div className="flex justify-center">
          <div className="w-20 h-20 rounded-2xl overflow-hidden flex items-center justify-center shadow-xl shadow-primary/25 transform -rotate-6">
            {logoData?.logoBase64 ? (
              <img
                src={`data:${logoData.logoType};base64,${logoData.logoBase64}`}
                alt="Logo VivaFrutaz"
                className="w-full h-full object-contain transform rotate-6 p-1"
              />
            ) : (
              <div className="w-full h-full bg-gradient-to-br from-primary to-primary/80 flex items-center justify-center">
                <Leaf className="w-10 h-10 text-primary-foreground transform rotate-6" />
              </div>
            )}
          </div>
        </div>
        <h2 className="mt-6 text-center text-3xl font-display font-extrabold text-foreground">VivaFrutaz</h2>
        <p className="mt-2 text-center text-sm text-muted-foreground">Plataforma Corporativa de Pedidos de Frutas</p>
      </div>

      <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md relative z-10">
        <div className="bg-card py-8 px-4 shadow-2xl shadow-black/5 sm:rounded-3xl sm:px-10 border border-border/50">

          {sessionExpiredBanner && (
            <div
              data-testid="banner-session-expired"
              className="mb-6 flex items-start gap-3 p-4 bg-amber-50 border border-amber-200 rounded-xl"
            >
              <svg className="w-5 h-5 text-amber-600 mt-0.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M5.07 19H19a2 2 0 001.75-2.97L13.75 4a2 2 0 00-3.5 0L3.25 16.03A2 2 0 005.07 19z" />
              </svg>
              <p className="text-sm font-medium text-amber-800">
                Sua sessão expirou. Faça login novamente.
              </p>
            </div>
          )}

          {/* Maintenance mode — block company (client) login */}
          {maintenanceActive && type === 'company' && !forceAdminTab ? (
            <div data-testid="maintenance-banner" className="text-center py-4">
              <div className="w-16 h-16 mx-auto rounded-2xl bg-orange-100 flex items-center justify-center mb-5">
                <Wrench className="w-8 h-8 text-orange-600" />
              </div>
              <h3 className="text-lg font-bold text-foreground mb-2">Sistema temporariamente em manutenção</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">
                Estamos realizando melhorias. Tente novamente em alguns minutos.
              </p>
              <Link
                href="/equipe"
                data-testid="link-team-access"
                className="mt-6 w-full flex items-center justify-center gap-2 py-3.5 px-4 rounded-xl bg-primary text-primary-foreground font-bold text-sm shadow-lg shadow-primary/25 hover:-translate-y-0.5 active:translate-y-0 transition-all duration-200"
              >
                <ShieldCheck className="w-4 h-4" />
                Acesso da Equipe
              </Link>
            </div>
          ) : showForgot ? (
            <div>
              <button onClick={() => { setShowForgot(false); setForgotStatus('idle'); setForgotMessage(""); }}
                className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground mb-6 font-medium transition-colors">
                <ArrowLeft className="w-4 h-4" /> Voltar ao login
              </button>

              <div className="flex items-center gap-3 mb-6">
                <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
                  <KeyRound className="w-5 h-5 text-primary" />
                </div>
                <div>
                  <h3 className="text-lg font-bold text-foreground">Esqueci minha senha</h3>
                  <p className="text-xs text-muted-foreground">Informe seu email cadastrado</p>
                </div>
              </div>

              {forgotStatus === 'success' ? (
                <div className="p-5 bg-green-50 border border-green-200 rounded-2xl text-center">
                  <CheckCircle2 className="w-12 h-12 text-green-600 mx-auto mb-3" />
                  <p className="font-bold text-green-800 text-lg">Solicitação enviada!</p>
                  <p className="text-sm text-green-700 mt-2">{forgotMessage}</p>
                  <p className="text-xs text-green-600 mt-3">
                    A equipe VivaFrutaz analisará sua solicitação e enviará a nova senha.
                  </p>
                  <button onClick={() => { setShowForgot(false); setForgotStatus('idle'); setForgotMessage(""); }}
                    className="mt-4 px-5 py-2 bg-primary text-white font-bold rounded-xl text-sm hover:bg-primary/90 transition-colors">
                    Voltar ao login
                  </button>
                </div>
              ) : (
                <form onSubmit={handleForgotPassword} className="space-y-4">
                  <div>
                    <label className="block text-sm font-semibold text-foreground mb-2">Usuário de acesso</label>
                    <div className="flex items-center border-2 border-border rounded-xl overflow-hidden focus-within:border-primary focus-within:ring-4 focus-within:ring-primary/10 transition-all bg-background">
                      <input
                        type="text"
                        required
                        value={forgotUsername}
                        onChange={e => setForgotUsername(usernameFromEmail(e.target.value))}
                        className="flex-1 px-4 py-3 bg-transparent text-foreground placeholder:text-muted-foreground outline-none min-w-0"
                        placeholder="empresa01"
                      />
                      <span className="px-3 py-3 text-sm font-semibold text-primary/80 bg-primary/5 border-l border-border/50 whitespace-nowrap select-none">
                        @vivafrutaz.com
                      </span>
                    </div>
                  </div>

                  {forgotStatus === 'error' && (
                    <div className="p-3 bg-red-50 border border-red-200 rounded-xl">
                      <p className="text-sm text-red-700 font-medium">{forgotMessage}</p>
                    </div>
                  )}

                  <button type="submit" disabled={forgotStatus === 'loading'}
                    className="w-full py-3.5 bg-primary text-primary-foreground font-bold rounded-xl hover:-translate-y-0.5 transition-all disabled:opacity-50">
                    {forgotStatus === 'loading' ? "Enviando..." : "Solicitar redefinição de senha"}
                  </button>

                  <p className="text-xs text-center text-muted-foreground mt-3">
                    Após a solicitação, a equipe VivaFrutaz criará uma nova senha e você receberá o acesso atualizado.
                  </p>
                </form>
              )}
            </div>
          ) : (
            /* Login view */
            <>
              {forceAdminTab ? (
                <div className="flex items-center gap-3 mb-8">
                  <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
                    <ShieldCheck className="w-5 h-5 text-primary" />
                  </div>
                  <div>
                    <h3 className="text-base font-bold text-foreground">Acesso da Equipe</h3>
                    <p className="text-xs text-muted-foreground">Login exclusivo para equipe interna</p>
                  </div>
                </div>
              ) : (
                <div className="flex p-1 space-x-1 bg-muted/50 rounded-xl mb-8">
                  <button
                    data-testid="tab-company"
                    onClick={() => setType('company')}
                    className={`flex-1 flex justify-center items-center gap-2 py-2.5 text-sm font-bold rounded-lg transition-all ${
                      type === 'company' ? 'bg-white text-primary shadow-sm' : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    <Building2 className="w-4 h-4" /> Portal do Cliente
                  </button>
                  <button
                    data-testid="tab-admin"
                    onClick={() => setType('admin')}
                    className={`flex-1 flex justify-center items-center gap-2 py-2.5 text-sm font-bold rounded-lg transition-all ${
                      type === 'admin' ? 'bg-white text-primary shadow-sm' : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    <UserCircle className="w-4 h-4" /> Acesso da Equipe
                  </button>
                </div>
              )}

              <form className="space-y-6" onSubmit={handleSubmit}>
                {type === 'admin' ? (
                  <div>
                    <label className="block text-sm font-semibold text-foreground mb-2">Usuário</label>
                    <div className="flex items-center border-2 border-border rounded-xl overflow-hidden focus-within:border-primary focus-within:ring-4 focus-within:ring-primary/10 transition-all bg-background">
                      <input
                        data-testid="input-username"
                        type="text"
                        required
                        value={adminUsername}
                        onChange={e => setAdminUsername(usernameFromEmail(e.target.value))}
                        autoComplete="username"
                        className="flex-1 px-4 py-3 bg-transparent text-foreground placeholder:text-muted-foreground outline-none min-w-0"
                        placeholder="seu.nome"
                      />
                      <span className="px-3 py-3 text-sm font-semibold text-primary/80 bg-primary/5 border-l border-border/50 whitespace-nowrap select-none">
                        @vivafrutaz.com
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground mt-1.5">
                      O domínio @vivafrutaz.com é adicionado automaticamente.
                    </p>
                  </div>
                ) : (
                  <div>
                    <label className="block text-sm font-semibold text-foreground mb-2">Usuário de acesso</label>
                    <div className="flex items-center border-2 border-border rounded-xl overflow-hidden focus-within:border-primary focus-within:ring-4 focus-within:ring-primary/10 transition-all bg-background">
                      <input
                        data-testid="input-email"
                        type="text"
                        required
                        value={companyUsername}
                        onChange={e => setCompanyUsername(usernameFromEmail(e.target.value))}
                        autoComplete="username"
                        className="flex-1 px-4 py-3 bg-transparent text-foreground placeholder:text-muted-foreground outline-none min-w-0"
                        placeholder="empresa01"
                      />
                      <span className="px-3 py-3 text-sm font-semibold text-primary/80 bg-primary/5 border-l border-border/50 whitespace-nowrap select-none">
                        @vivafrutaz.com
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground mt-1.5">
                      Digite apenas o nome de usuário — o domínio é adicionado automaticamente.
                    </p>
                  </div>
                )}

                <div>
                  <label className="block text-sm font-semibold text-foreground mb-2">Senha</label>
                  <input
                    data-testid="input-password"
                    type="password" required value={password} onChange={(e) => setPassword(e.target.value)}
                    className="w-full px-4 py-3 rounded-xl bg-background border-2 border-border text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary focus:ring-4 focus:ring-primary/10 transition-all"
                    placeholder="••••••••"
                  />
                </div>

                <button
                  data-testid="button-login"
                  type="submit" disabled={isLoggingIn}
                  className="w-full flex justify-center py-3.5 px-4 border border-transparent rounded-xl shadow-lg shadow-primary/25 text-sm font-bold text-primary-foreground bg-gradient-to-r from-primary to-primary/90 hover:from-primary/90 hover:to-primary hover:-translate-y-0.5 active:translate-y-0 focus:outline-none focus:ring-4 focus:ring-primary/20 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200"
                >
                  {isLoggingIn ? "Entrando..." : "Acessar VivaFrutaz"}
                </button>
              </form>

              {type === 'company' && (
                <div className="mt-6 text-center">
                  <button onClick={() => { setShowForgot(true); setForgotUsername(companyUsername); }}
                    className="text-sm text-muted-foreground hover:text-primary transition-colors font-medium flex items-center gap-1.5 mx-auto">
                    <KeyRound className="w-3.5 h-3.5" />
                    Esqueci minha senha
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
