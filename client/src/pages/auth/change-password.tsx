import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { Leaf, KeyRound, Eye, EyeOff, CheckCircle2, ShieldCheck } from "lucide-react";
import { useQuery } from "@tanstack/react-query";

export default function ChangePassword() {
  const [, setLocation] = useLocation();

  const { data: logoData } = useQuery<{ logoBase64: string; logoType: string }>({
    queryKey: ['/api/company-config/logo'],
    staleTime: 5 * 60 * 1000,
    retry: false,
  });

  const [email, setEmail] = useState("");
  const [tempPassword, setTempPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showTemp, setShowTemp] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState("");

  useEffect(() => {
    const stored = sessionStorage.getItem("change_password_email");
    if (stored) {
      setEmail(stored);
    } else {
      setLocation("/login");
    }
  }, [setLocation]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage("");

    if (newPassword.length < 8) {
      setErrorMessage("A nova senha deve ter pelo menos 8 caracteres.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setErrorMessage("As senhas não coincidem.");
      return;
    }

    setStatus("loading");
    try {
      const res = await fetch("/api/auth/force-password-change", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, tempPassword, newPassword }),
      });
      const data = await res.json();
      if (!res.ok) {
        setStatus("error");
        setErrorMessage(data.message || "Erro ao alterar senha.");
        return;
      }
      sessionStorage.removeItem("change_password_email");
      setStatus("success");
    } catch {
      setStatus("error");
      setErrorMessage("Erro de conexão. Tente novamente.");
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

          {status === "success" ? (
            <div className="text-center py-4">
              <div className="w-16 h-16 mx-auto rounded-2xl bg-green-100 flex items-center justify-center mb-5">
                <CheckCircle2 className="w-8 h-8 text-green-600" />
              </div>
              <h3 className="text-xl font-bold text-foreground mb-2">Senha alterada com sucesso!</h3>
              <p className="text-sm text-muted-foreground mb-6">
                Sua senha foi atualizada. Faça login com a nova senha para acessar o sistema.
              </p>
              <button
                data-testid="button-go-to-login"
                onClick={() => setLocation("/login")}
                className="w-full py-3.5 px-4 rounded-xl bg-gradient-to-r from-primary to-primary/90 text-primary-foreground font-bold text-sm shadow-lg shadow-primary/25 hover:-translate-y-0.5 active:translate-y-0 transition-all duration-200"
              >
                Ir para o Login
              </button>
            </div>
          ) : (
            <>
              <div className="flex items-center gap-3 mb-8">
                <div className="w-10 h-10 rounded-xl bg-amber-100 flex items-center justify-center shrink-0">
                  <ShieldCheck className="w-5 h-5 text-amber-600" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-foreground">Troca de Senha Obrigatória</h3>
                  <p className="text-xs text-muted-foreground">Sua senha é temporária e deve ser alterada para continuar.</p>
                </div>
              </div>

              {email && (
                <div className="mb-6 px-4 py-3 rounded-xl bg-muted/50 border border-border">
                  <p className="text-xs text-muted-foreground font-medium">Conta</p>
                  <p className="text-sm font-semibold text-foreground mt-0.5">{email}</p>
                </div>
              )}

              <form onSubmit={handleSubmit} className="space-y-5">
                <div>
                  <label className="block text-sm font-semibold text-foreground mb-2">
                    Senha temporária recebida
                  </label>
                  <div className="relative">
                    <input
                      data-testid="input-temp-password"
                      type={showTemp ? "text" : "password"}
                      required
                      value={tempPassword}
                      onChange={e => setTempPassword(e.target.value)}
                      placeholder="Cole a senha temporária aqui"
                      className="w-full px-4 py-3 pr-12 rounded-xl bg-background border-2 border-border text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary focus:ring-4 focus:ring-primary/10 transition-all"
                    />
                    <button
                      type="button"
                      onClick={() => setShowTemp(v => !v)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                    >
                      {showTemp ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-semibold text-foreground mb-2">
                    Nova senha
                  </label>
                  <div className="relative">
                    <input
                      data-testid="input-new-password"
                      type={showNew ? "text" : "password"}
                      required
                      value={newPassword}
                      onChange={e => setNewPassword(e.target.value)}
                      placeholder="Mínimo 8 caracteres"
                      className="w-full px-4 py-3 pr-12 rounded-xl bg-background border-2 border-border text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary focus:ring-4 focus:ring-primary/10 transition-all"
                    />
                    <button
                      type="button"
                      onClick={() => setShowNew(v => !v)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                    >
                      {showNew ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-semibold text-foreground mb-2">
                    Confirmar nova senha
                  </label>
                  <div className="relative">
                    <input
                      data-testid="input-confirm-password"
                      type={showConfirm ? "text" : "password"}
                      required
                      value={confirmPassword}
                      onChange={e => setConfirmPassword(e.target.value)}
                      placeholder="Repita a nova senha"
                      className="w-full px-4 py-3 pr-12 rounded-xl bg-background border-2 border-border text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary focus:ring-4 focus:ring-primary/10 transition-all"
                    />
                    <button
                      type="button"
                      onClick={() => setShowConfirm(v => !v)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                    >
                      {showConfirm ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                {errorMessage && (
                  <div className="p-3 bg-red-50 border border-red-200 rounded-xl">
                    <p className="text-sm text-red-700 font-medium">{errorMessage}</p>
                  </div>
                )}

                <button
                  data-testid="button-change-password"
                  type="submit"
                  disabled={status === "loading"}
                  className="w-full flex justify-center items-center gap-2 py-3.5 px-4 rounded-xl bg-gradient-to-r from-primary to-primary/90 text-primary-foreground font-bold text-sm shadow-lg shadow-primary/25 hover:-translate-y-0.5 active:translate-y-0 focus:outline-none focus:ring-4 focus:ring-primary/20 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200"
                >
                  <KeyRound className="w-4 h-4" />
                  {status === "loading" ? "Alterando senha..." : "Alterar senha e acessar"}
                </button>
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
