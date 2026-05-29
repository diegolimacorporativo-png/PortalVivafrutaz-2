import { useState } from "react";
import { CheckCircle2, Copy } from "lucide-react";

interface TempPasswordModalProps {
  data: { companyName: string; email: string; password: string };
  onClose: () => void;
}

export function TempPasswordModal({ data, onClose }: TempPasswordModalProps) {
  const [copied, setCopied] = useState(false);

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-card rounded-3xl shadow-2xl border border-border max-w-md w-full p-8 z-10">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-12 h-12 rounded-2xl bg-green-100 flex items-center justify-center shrink-0">
            <CheckCircle2 className="w-6 h-6 text-green-600" />
          </div>
          <div>
            <h3 className="text-lg font-bold text-foreground">Empresa criada com sucesso!</h3>
            <p className="text-sm text-muted-foreground">{data.companyName}</p>
          </div>
        </div>

        <div className="mb-6 p-4 rounded-2xl bg-amber-50 border border-amber-200">
          <p className="text-xs font-semibold text-amber-700 uppercase tracking-wider mb-1">Atenção</p>
          <p className="text-sm text-amber-800">
            Esta senha temporária será exibida <strong>apenas uma vez</strong>. Copie e compartilhe com o
            cliente. Ele será obrigado a trocá-la no primeiro login.
          </p>
        </div>

        <div className="mb-2">
          <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
            Conta de acesso
          </label>
          <p className="text-sm font-mono font-semibold text-foreground">{data.email}</p>
        </div>

        <div className="mb-6">
          <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
            Senha temporária
          </label>
          <div className="flex items-center gap-3">
            <code
              data-testid="text-temp-password"
              className="flex-1 px-4 py-3 rounded-xl bg-muted font-mono text-lg font-bold text-foreground tracking-widest border-2 border-border select-all"
            >
              {data.password}
            </code>
            <button
              data-testid="button-copy-password"
              type="button"
              onClick={() => {
                navigator.clipboard.writeText(data.password).then(() => {
                  setCopied(true);
                  setTimeout(() => setCopied(false), 2500);
                });
              }}
              className="flex items-center gap-2 px-4 py-3 rounded-xl bg-primary text-primary-foreground font-bold text-sm shadow-lg hover:-translate-y-0.5 active:translate-y-0 transition-all whitespace-nowrap"
            >
              {copied ? (
                <><CheckCircle2 className="w-4 h-4" /> Copiado!</>
              ) : (
                <><Copy className="w-4 h-4" /> Copiar</>
              )}
            </button>
          </div>
        </div>

        <button
          data-testid="button-close-temp-password-modal"
          type="button"
          onClick={onClose}
          className="w-full py-3 rounded-xl border-2 border-border font-bold text-muted-foreground hover:bg-muted transition-colors"
        >
          Fechar
        </button>
      </div>
    </div>
  );
}
