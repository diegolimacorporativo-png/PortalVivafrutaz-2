import { useState, useEffect } from "react";
import { useLocation, Link } from "wouter";
import { KeyRound, CheckCircle2, AlertCircle, Loader2, Eye, EyeOff } from "lucide-react";

type PageState =
  | { phase: "form" }
  | { phase: "submitting" }
  | { phase: "success"; message: string }
  | { phase: "error"; message: string };

export default function ResetPassword() {
  const [location] = useLocation();
  const token = new URLSearchParams(window.location.search).get("token") ?? "";

  const [novaSenha, setNovaSenha] = useState("");
  const [confirmar, setConfirmar] = useState("");
  const [showNova, setShowNova] = useState(false);
  const [showConfirmar, setShowConfirmar] = useState(false);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [state, setState] = useState<PageState>({ phase: "form" });

  useEffect(() => {
    if (!token) {
      setState({
        phase: "error",
        message: "Link de recuperação inválido. Por favor, solicite um novo link.",
      });
    }
  }, [token]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFieldError(null);

    if (novaSenha.length < 8) {
      setFieldError("A nova senha deve ter pelo menos 8 caracteres.");
      return;
    }
    if (novaSenha !== confirmar) {
      setFieldError("As senhas não coincidem.");
      return;
    }

    setState({ phase: "submitting" });

    try {
      const res = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, novaSenha }),
      });
      const data = await res.json();

      if (!res.ok) {
        setState({ phase: "error", message: data.message ?? "Erro ao redefinir senha." });
        return;
      }
      setState({ phase: "success", message: data.message ?? "Senha redefinida com sucesso!" });
    } catch {
      setState({
        phase: "error",
        message: "Falha de conexão. Verifique sua internet e tente novamente.",
      });
    }
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-6">
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="flex items-center justify-center gap-2 mb-8">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-primary to-primary/80 flex items-center justify-center shadow-lg shadow-primary/25">
            <svg className="w-5 h-5 text-white" fill="currentColor" viewBox="0 0 24 24">
              <path d="M17 8C8 10 5.9 16.17 3.82 21.34L5.71 22l1-2.3A4.49 4.49 0 0 0 8 20C19 20 22 3 22 3c-1 2-8 2-8 2" />
            </svg>
          </div>
          <span className="font-display font-bold text-xl text-foreground">VivaFrutaz</span>
        </div>

        <div className="bg-card border border-border rounded-2xl shadow-sm p-8">
          {/* Success */}
          {state.phase === "success" && (
            <div className="text-center space-y-4" data-testid="reset-success">
              <div className="w-14 h-14 rounded-full bg-green-100 flex items-center justify-center mx-auto">
                <CheckCircle2 className="w-7 h-7 text-green-600" />
              </div>
              <h1 className="text-xl font-bold text-foreground">Senha redefinida!</h1>
              <p className="text-muted-foreground text-sm">{state.message}</p>
              <Link
                href="/login"
                data-testid="link-go-to-login"
                className="mt-2 inline-flex items-center justify-center w-full py-3 px-4 rounded-xl bg-primary text-primary-foreground font-bold text-sm shadow-md shadow-primary/25 hover:-translate-y-0.5 active:translate-y-0 transition-all duration-200"
              >
                Ir para o login
              </Link>
            </div>
          )}

          {/* Error (invalid / expired token) */}
          {state.phase === "error" && (
            <div className="text-center space-y-4" data-testid="reset-error">
              <div className="w-14 h-14 rounded-full bg-red-100 flex items-center justify-center mx-auto">
                <AlertCircle className="w-7 h-7 text-red-600" />
              </div>
              <h1 className="text-xl font-bold text-foreground">Link inválido</h1>
              <p className="text-muted-foreground text-sm leading-relaxed">{state.message}</p>
              <Link
                href="/login"
                data-testid="link-back-to-login-error"
                className="mt-2 inline-flex items-center justify-center w-full py-3 px-4 rounded-xl bg-primary text-primary-foreground font-bold text-sm shadow-md shadow-primary/25 hover:-translate-y-0.5 active:translate-y-0 transition-all duration-200"
              >
                Voltar ao login
              </Link>
            </div>
          )}

          {/* Form */}
          {(state.phase === "form" || state.phase === "submitting") && (
            <>
              <div className="flex items-center gap-3 mb-6">
                <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
                  <KeyRound className="w-5 h-5 text-primary" />
                </div>
                <div>
                  <h1 className="text-lg font-bold text-foreground leading-tight">Nova senha</h1>
                  <p className="text-xs text-muted-foreground">Escolha uma senha segura</p>
                </div>
              </div>

              <form onSubmit={handleSubmit} className="space-y-4" data-testid="form-reset-password">
                {/* Nova senha */}
                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-foreground" htmlFor="nova-senha">
                    Nova senha
                  </label>
                  <div className="relative">
                    <input
                      id="nova-senha"
                      data-testid="input-nova-senha"
                      type={showNova ? "text" : "password"}
                      value={novaSenha}
                      onChange={(e) => { setNovaSenha(e.target.value); setFieldError(null); }}
                      placeholder="Mínimo 8 caracteres"
                      autoFocus
                      className="w-full rounded-xl border border-input bg-background px-4 py-3 pr-10 text-sm text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-all"
                    />
                    <button
                      type="button"
                      tabIndex={-1}
                      data-testid="toggle-show-nova"
                      onClick={() => setShowNova((v) => !v)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                    >
                      {showNova ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                {/* Confirmar senha */}
                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-foreground" htmlFor="confirmar-senha">
                    Confirmar senha
                  </label>
                  <div className="relative">
                    <input
                      id="confirmar-senha"
                      data-testid="input-confirmar-senha"
                      type={showConfirmar ? "text" : "password"}
                      value={confirmar}
                      onChange={(e) => { setConfirmar(e.target.value); setFieldError(null); }}
                      placeholder="Repita a nova senha"
                      className="w-full rounded-xl border border-input bg-background px-4 py-3 pr-10 text-sm text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-all"
                    />
                    <button
                      type="button"
                      tabIndex={-1}
                      data-testid="toggle-show-confirmar"
                      onClick={() => setShowConfirmar((v) => !v)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                    >
                      {showConfirmar ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                {/* Field error */}
                {fieldError && (
                  <p
                    data-testid="text-field-error"
                    className="text-sm text-red-600 flex items-center gap-1.5"
                  >
                    <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
                    {fieldError}
                  </p>
                )}

                {/* Submit */}
                <button
                  type="submit"
                  data-testid="button-submit-reset"
                  disabled={state.phase === "submitting"}
                  className="w-full py-3 px-4 rounded-xl bg-primary text-primary-foreground font-bold text-sm shadow-md shadow-primary/25 hover:-translate-y-0.5 active:translate-y-0 disabled:opacity-60 disabled:translate-y-0 transition-all duration-200 flex items-center justify-center gap-2"
                >
                  {state.phase === "submitting" ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Redefinindo...
                    </>
                  ) : (
                    "Redefinir senha"
                  )}
                </button>
              </form>

              <div className="mt-5 text-center">
                <Link
                  href="/login"
                  data-testid="link-back-to-login"
                  className="text-sm text-muted-foreground hover:text-primary transition-colors"
                >
                  Voltar ao login
                </Link>
              </div>
            </>
          )}
        </div>

        <p className="text-center text-xs text-muted-foreground/60 mt-6">
          VivaFrutaz ERP © {new Date().getFullYear()}
        </p>
      </div>
    </div>
  );
}
