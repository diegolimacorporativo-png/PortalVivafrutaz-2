import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Mail, Send, Save, Eye, EyeOff, CheckCircle2, XCircle, Loader2, Server, Info, ExternalLink, Zap } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { fetchWithAuth } from "@/lib/fetchWithAuth";

export default function AdminSmtpConfig() {
  const { toast } = useToast();
  const qc = useQueryClient();

  const { data, isLoading } = useQuery<any>({
    queryKey: ['/api/smtp-config'],
  });

  const [form, setForm] = useState({
    host: '',
    port: 587,
    user: '',
    password: '',
    senderEmail: '',
    senderName: 'VivaFrutaz',
  });
  const [showPassword, setShowPassword] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    if (data) {
      setForm({
        host: data.host || '',
        port: data.port || 587,
        user: data.user || '',
        password: data.password || '',
        senderEmail: data.senderEmail || '',
        senderName: data.senderName || 'VivaFrutaz',
      });
    }
  }, [data]);

  const saveMutation = useMutation({
    mutationFn: (payload: any) => apiRequest('PUT', '/api/smtp-config', payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['/api/smtp-config'] });
      toast({ title: "Configuração SMTP salva com sucesso!" });
      setTestResult(null);
    },
    onError: (e: any) => toast({ title: e.message || "Erro ao salvar", variant: "destructive" }),
  });

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await fetchWithAuth('/api/smtp-config/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      const d = await res.json();
      setTestResult({ success: !!d.success, message: d.message || (d.success ? 'E-mail enviado!' : 'Falha ao enviar.') });
    } catch (e: any) {
      setTestResult({ success: false, message: e.message || 'Erro ao testar SMTP.' });
    } finally {
      setTesting(false);
    }
  };

  const handleSave = () => {
    if (!form.host.trim()) {
      toast({ title: "Servidor SMTP é obrigatório.", variant: "destructive" });
      return;
    }
    saveMutation.mutate(form);
  };

  if (isLoading) return (
    <div className="flex items-center justify-center h-64">
      <div className="animate-spin w-8 h-8 border-4 border-primary border-t-transparent rounded-full" />
    </div>
  );

  const isConfigured = !!(data?.host && data?.user && data?.hasPassword);

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-blue-100 flex items-center justify-center">
          <Mail className="w-5 h-5 text-blue-600" />
        </div>
        <div>
          <h1 className="text-xl font-bold text-foreground">Configuração SMTP</h1>
          <p className="text-sm text-muted-foreground">Configure o servidor de e-mail para envios automáticos</p>
        </div>
        <div className="ml-auto">
          {isConfigured ? (
            <span className="flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 bg-emerald-100 text-emerald-700 rounded-full border border-emerald-200">
              <CheckCircle2 className="w-3.5 h-3.5" />
              SMTP Configurado
            </span>
          ) : (
            <span className="flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 bg-orange-100 text-orange-700 rounded-full border border-orange-200">
              <XCircle className="w-3.5 h-3.5" />
              Não Configurado
            </span>
          )}
        </div>
      </div>

      {/* Provider Quick-Fill */}
      <div className="bg-card rounded-2xl border border-border/50 premium-shadow p-6 space-y-4">
        <div className="flex items-center gap-2">
          <Zap className="w-4 h-4 text-amber-500" />
          <h2 className="font-bold text-foreground">Preencher com Provedor Comum</h2>
          <span className="text-xs text-muted-foreground ml-1">— clique para pré-preencher os campos</span>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            data-testid="button-prefill-gmail"
            onClick={() => setForm(f => ({ ...f, host: 'smtp.gmail.com', port: 587, senderName: f.senderName || 'VivaFrutaz' }))}
            className="flex items-center gap-1.5 px-4 py-2 border-2 border-red-200 bg-red-50 text-red-700 rounded-xl text-sm font-medium hover:bg-red-100 transition-colors"
          >
            <span className="text-base leading-none">G</span> Gmail
          </button>
          <button
            type="button"
            data-testid="button-prefill-outlook"
            onClick={() => setForm(f => ({ ...f, host: 'smtp.office365.com', port: 587, senderName: f.senderName || 'VivaFrutaz' }))}
            className="flex items-center gap-1.5 px-4 py-2 border-2 border-blue-200 bg-blue-50 text-blue-700 rounded-xl text-sm font-medium hover:bg-blue-100 transition-colors"
          >
            <span className="text-base leading-none">◈</span> Outlook / Office365
          </button>
          <button
            type="button"
            data-testid="button-prefill-sendgrid"
            onClick={() => setForm(f => ({ ...f, host: 'smtp.sendgrid.net', port: 587, senderName: f.senderName || 'VivaFrutaz' }))}
            className="flex items-center gap-1.5 px-4 py-2 border-2 border-teal-200 bg-teal-50 text-teal-700 rounded-xl text-sm font-medium hover:bg-teal-100 transition-colors"
          >
            <span className="text-base leading-none">✉</span> SendGrid
          </button>
          <button
            type="button"
            data-testid="button-prefill-zoho"
            onClick={() => setForm(f => ({ ...f, host: 'smtp.zoho.com', port: 587, senderName: f.senderName || 'VivaFrutaz' }))}
            className="flex items-center gap-1.5 px-4 py-2 border-2 border-orange-200 bg-orange-50 text-orange-700 rounded-xl text-sm font-medium hover:bg-orange-100 transition-colors"
          >
            <span className="text-base leading-none">Z</span> Zoho Mail
          </button>
        </div>
        {/* Gmail Specific Guide */}
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 space-y-2">
          <p className="text-xs font-bold text-amber-800 flex items-center gap-1.5">
            <Info className="w-3.5 h-3.5" /> Gmail — Senha de Aplicativo (obrigatória)
          </p>
          <ol className="text-xs text-amber-700 space-y-1 list-decimal list-inside">
            <li>Acesse <strong>myaccount.google.com</strong> e ative a <strong>Verificação em 2 etapas</strong></li>
            <li>Acesse <strong>myaccount.google.com/apppasswords</strong></li>
            <li>Crie um app chamado "VivaFrutaz" e copie a <strong>senha de 16 dígitos</strong></li>
            <li>Use seu e-mail Gmail no campo <em>Usuário</em> e a senha de 16 dígitos no campo <em>Senha</em></li>
          </ol>
          <a
            href="https://myaccount.google.com/apppasswords"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-xs text-amber-700 underline font-medium mt-1"
          >
            Abrir configurações de senha de aplicativo <ExternalLink className="w-3 h-3" />
          </a>
        </div>
      </div>

      {/* Form Card */}
      <div className="bg-card rounded-2xl border border-border/50 premium-shadow p-8 space-y-6">
        <div className="flex items-center gap-2 pb-4 border-b border-border/50">
          <Server className="w-4 h-4 text-muted-foreground" />
          <h2 className="font-bold text-foreground">Configurações do Servidor</h2>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="md:col-span-2 space-y-1.5">
            <label className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Servidor SMTP</label>
            <input
              value={form.host}
              onChange={e => setForm(f => ({ ...f, host: e.target.value }))}
              data-testid="input-smtp-host"
              placeholder="smtp.office365.com"
              className="w-full px-4 py-2.5 border-2 border-border rounded-xl text-sm focus:border-primary outline-none bg-background"
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Porta</label>
            <input
              type="number"
              value={form.port}
              onChange={e => setForm(f => ({ ...f, port: Number(e.target.value) }))}
              data-testid="input-smtp-port"
              placeholder="587"
              className="w-full px-4 py-2.5 border-2 border-border rounded-xl text-sm focus:border-primary outline-none bg-background"
            />
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <label className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Usuário SMTP</label>
            <input
              value={form.user}
              onChange={e => setForm(f => ({ ...f, user: e.target.value }))}
              data-testid="input-smtp-user"
              placeholder="contato@empresa.com"
              className="w-full px-4 py-2.5 border-2 border-border rounded-xl text-sm focus:border-primary outline-none bg-background"
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Senha SMTP</label>
            <div className="relative">
              <input
                type={showPassword ? 'text' : 'password'}
                value={form.password}
                onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
                data-testid="input-smtp-password"
                placeholder={data?.hasPassword ? '••••••••' : 'Senha do servidor'}
                className="w-full px-4 py-2.5 pr-10 border-2 border-border rounded-xl text-sm focus:border-primary outline-none bg-background"
              />
              <button
                type="button"
                onClick={() => setShowPassword(s => !s)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
              >
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
            {data?.hasPassword && !form.password && (
              <p className="text-xs text-muted-foreground">Deixe em branco para manter a senha atual.</p>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-4 border-t border-border/50">
          <div className="space-y-1.5">
            <label className="text-xs font-bold text-muted-foreground uppercase tracking-wider">E-mail Remetente</label>
            <input
              value={form.senderEmail}
              onChange={e => setForm(f => ({ ...f, senderEmail: e.target.value }))}
              data-testid="input-smtp-sender-email"
              placeholder="pedidos@empresa.com"
              className="w-full px-4 py-2.5 border-2 border-border rounded-xl text-sm focus:border-primary outline-none bg-background"
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Nome Remetente</label>
            <input
              value={form.senderName}
              onChange={e => setForm(f => ({ ...f, senderName: e.target.value }))}
              data-testid="input-smtp-sender-name"
              placeholder="VivaFrutaz"
              className="w-full px-4 py-2.5 border-2 border-border rounded-xl text-sm focus:border-primary outline-none bg-background"
            />
          </div>
        </div>

        {/* Test Result Banner */}
        {testResult && (
          <div className={`flex items-center gap-3 p-4 rounded-xl border ${
            testResult.success
              ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
              : 'bg-red-50 border-red-200 text-red-700'
          }`}>
            {testResult.success
              ? <CheckCircle2 className="w-5 h-5 flex-shrink-0" />
              : <XCircle className="w-5 h-5 flex-shrink-0" />}
            <p className="text-sm font-medium">{testResult.message}</p>
          </div>
        )}

        {/* Actions */}
        <div className="flex items-center gap-3 pt-4 border-t border-border/50">
          <button
            onClick={handleTest}
            disabled={testing || !isConfigured}
            data-testid="button-test-smtp"
            title={!isConfigured ? 'Salve as configurações antes de testar' : ''}
            className="flex items-center gap-2 px-5 py-2.5 border-2 border-border rounded-xl font-medium text-sm hover:bg-muted transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {testing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            {testing ? 'Enviando...' : 'Testar Envio de E-mail'}
          </button>
          <button
            onClick={handleSave}
            disabled={saveMutation.isPending}
            data-testid="button-save-smtp"
            className="ml-auto flex items-center gap-2 px-6 py-2.5 bg-primary text-primary-foreground rounded-xl font-medium text-sm hover:bg-primary/90 transition-colors disabled:opacity-50"
          >
            <Save className="w-4 h-4" />
            {saveMutation.isPending ? 'Salvando...' : 'Salvar Configurações'}
          </button>
        </div>
      </div>

      {/* Info Card */}
      <div className="bg-blue-50 rounded-2xl border border-blue-100 p-6 space-y-3">
        <h3 className="font-bold text-blue-800 flex items-center gap-2">
          <Mail className="w-4 h-4" />
          E-mails automáticos do sistema
        </h3>
        <p className="text-sm text-blue-700">
          As configurações SMTP aqui salvas serão usadas para todos os envios automáticos do sistema, incluindo:
        </p>
        <ul className="text-sm text-blue-700 space-y-1 list-disc list-inside">
          <li>Lembrete de janela de pedidos aberta</li>
          <li>Lembrete de pedido não finalizado</li>
          <li>Confirmação de pedido</li>
          <li>Notificação de pedido cancelado</li>
          <li>Comunicados gerais para clientes</li>
          <li>Notificações administrativas</li>
          <li><strong>NF-e autorizada pelo SEFAZ</strong> — envio automático do XML ao emitente e ao cliente</li>
        </ul>
        <p className="text-xs text-blue-600 font-medium">
          A senha é armazenada de forma segura e nunca exibida completamente na interface.
        </p>
      </div>
    </div>
  );
}
