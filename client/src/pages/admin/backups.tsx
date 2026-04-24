import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Layout } from "@/components/Layout";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import {
  HardDrive, Plus, Download, RefreshCw, CheckCircle, WifiOff,
  Trash2, Send, AlertTriangle, Mail, X, Database, FileCode2, Loader2
} from "lucide-react";

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleString("pt-BR", {
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit"
  });
}

type Backup = { filename: string; size: number; createdAt: string; format: string };

export default function BackupsPage() {
  const { data: backups, isLoading, refetch } = useQuery<Backup[]>({
    queryKey: ['/api/admin/backups'],
  });
  const { data: mailerStatus } = useQuery<{ configured: boolean; smtp: string | null; from: string }>({
    queryKey: ['/api/admin/mailer-status'],
  });
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [showCleanConfirm, setShowCleanConfirm] = useState(false);
  const [showSmtpTest, setShowSmtpTest] = useState(false);
  const [smtpTestEmail, setSmtpTestEmail] = useState("");
  const [downloadingFile, setDownloadingFile] = useState<string | null>(null);

  // ─── Mutations ────────────────────────────────────────────────
  const createJsonBackup = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/admin/backups', { method: 'POST', credentials: 'include' });
      if (!res.ok) { const d = await res.json(); throw new Error(d.message || 'Erro'); }
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['/api/admin/backups'] });
      toast({ title: `Backup JSON criado: ${data.filename}` });
    },
    onError: (e: any) => toast({ title: e.message || "Erro ao criar backup JSON.", variant: "destructive" }),
  });

  const createSqlBackup = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/admin/backups/sql', { method: 'POST', credentials: 'include' });
      if (!res.ok) { const d = await res.json(); throw new Error(d.message || 'Erro'); }
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['/api/admin/backups'] });
      toast({ title: `Backup SQL criado: ${data.filename}` });
    },
    onError: (e: any) => toast({ title: e.message || "Erro ao criar backup SQL.", variant: "destructive" }),
  });

  const deleteBackupMut = useMutation({
    mutationFn: async (filename: string) => {
      const res = await fetch(`/api/admin/backups/${encodeURIComponent(filename)}`, { method: 'DELETE', credentials: 'include' });
      if (!res.ok) { const d = await res.json(); throw new Error(d.message || 'Erro'); }
      return res.json();
    },
    onSuccess: (_, filename) => {
      queryClient.invalidateQueries({ queryKey: ['/api/admin/backups'] });
      setDeleteConfirm(null);
      toast({ title: `Backup excluído com sucesso.` });
    },
    onError: (e: any) => toast({ title: e.message || "Erro ao excluir backup.", variant: "destructive" }),
  });

  const cleanOldMut = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/admin/backups/clean-old', { method: 'POST', credentials: 'include' });
      if (!res.ok) { const d = await res.json(); throw new Error(d.message || 'Erro'); }
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['/api/admin/backups'] });
      setShowCleanConfirm(false);
      toast({ title: data.message || `${data.removed} backup(s) antigos removidos.` });
    },
    onError: (e: any) => toast({ title: e.message || "Erro ao limpar backups antigos.", variant: "destructive" }),
  });

  const smtpTestMut = useMutation({
    mutationFn: async (email: string) => {
      const res = await fetch('/api/admin/smtp-test', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ toEmail: email }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.message || 'Erro');
      return d;
    },
    onSuccess: (data) => {
      toast({ title: data.message || 'E-mail de teste enviado!' });
      setShowSmtpTest(false);
      setSmtpTestEmail("");
    },
    onError: (e: any) => toast({ title: e.message || "Erro ao enviar e-mail de teste.", variant: "destructive" }),
  });

  // ─── Download via fetch+blob (reliable, avoids frontend router interception) ──
  const downloadBackup = async (filename: string) => {
    if (downloadingFile) return;
    setDownloadingFile(filename);
    try {
      const res = await fetch(`/api/admin/backups/${encodeURIComponent(filename)}`, {
        method: 'GET',
        credentials: 'include',
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.message || 'Arquivo não encontrado');
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast({ title: `Download iniciado: ${filename}` });
    } catch (err: any) {
      toast({ title: err.message || 'Erro ao baixar backup', variant: 'destructive' });
    } finally {
      setDownloadingFile(null);
    }
  };

  const isCreating = createJsonBackup.isPending || createSqlBackup.isPending;

  return (
    <Layout>
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-8 gap-4">
        <div>
          <h1 className="text-3xl font-display font-bold text-foreground">Backup do Sistema</h1>
          <p className="text-muted-foreground mt-1">
            Backups automáticos diários às 17h · Máximo de {backups?.length || 0}/30 backups mantidos
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <button onClick={() => refetch()} title="Atualizar lista" className="flex items-center gap-2 px-4 py-2.5 border-2 border-border rounded-xl text-sm font-bold hover:bg-muted transition-colors">
            <RefreshCw className="w-4 h-4" /> Atualizar
          </button>
          <button
            data-testid="button-clean-old-backups"
            onClick={() => setShowCleanConfirm(true)}
            className="flex items-center gap-2 px-4 py-2.5 border-2 border-orange-200 text-orange-600 rounded-xl text-sm font-bold hover:bg-orange-50 transition-colors"
          >
            <Trash2 className="w-4 h-4" /> Limpar Antigos (&gt;30d)
          </button>
          <button
            data-testid="button-create-sql-backup"
            onClick={() => createSqlBackup.mutate()}
            disabled={isCreating}
            className="flex items-center gap-2 px-4 py-2.5 border-2 border-blue-200 text-blue-700 rounded-xl text-sm font-bold hover:bg-blue-50 transition-colors disabled:opacity-50"
          >
            <FileCode2 className="w-4 h-4" />
            {createSqlBackup.isPending ? "Gerando SQL..." : "Gerar SQL"}
          </button>
          <button
            data-testid="button-create-backup"
            onClick={() => createJsonBackup.mutate()}
            disabled={isCreating}
            className="flex items-center gap-2 px-5 py-2.5 bg-primary text-primary-foreground font-bold rounded-xl text-sm hover:-translate-y-0.5 transition-transform shadow-lg shadow-primary/20 disabled:opacity-50"
          >
            <Plus className="w-4 h-4" />
            {createJsonBackup.isPending ? "Gerando JSON..." : "Gerar JSON"}
          </button>
        </div>
      </div>

      {/* Email Status Card */}
      <div className={`mb-4 p-5 rounded-2xl border-2 flex items-center gap-4 ${mailerStatus?.configured ? 'border-green-200 bg-green-50' : 'border-orange-200 bg-orange-50'}`}>
        {mailerStatus?.configured
          ? <CheckCircle className="w-6 h-6 text-green-600 flex-shrink-0" />
          : <WifiOff className="w-6 h-6 text-orange-500 flex-shrink-0" />}
        <div className="flex-1">
          <p className="font-bold text-sm text-foreground">
            {mailerStatus?.configured ? "E-mails automáticos ativos — backup é enviado por e-mail ao admin" : "E-mails automáticos não configurados"}
          </p>
          <p className="text-xs text-muted-foreground">
            {mailerStatus?.configured
              ? `Servidor: ${mailerStatus.smtp} · Remetente: ${mailerStatus.from}`
              : "Configure as variáveis SMTP_HOST, SMTP_USER e SMTP_PASS para ativar o envio de e-mails automáticos com backup em anexo."}
          </p>
        </div>
        {mailerStatus?.configured && (
          <button
            data-testid="button-smtp-test"
            onClick={() => setShowSmtpTest(true)}
            className="flex items-center gap-2 px-4 py-2 rounded-xl border-2 border-green-300 text-green-700 text-sm font-bold hover:bg-green-100 transition-colors flex-shrink-0"
          >
            <Send className="w-4 h-4" /> Testar SMTP
          </button>
        )}
      </div>

      {/* Format legend */}
      <div className="flex gap-3 mb-4">
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <span className="px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 font-bold text-xs">JSON</span>
          Backup completo em JSON (padrão)
        </div>
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <span className="px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 font-bold text-xs">SQL</span>
          Backup com INSERTs SQL (restauração direta no PostgreSQL)
        </div>
      </div>

      {/* Backups list */}
      <div className="bg-card rounded-2xl border border-border/50 premium-shadow overflow-hidden">
        <div className="p-6 border-b border-border/50 bg-muted/20 flex items-center gap-3">
          <HardDrive className="w-5 h-5 text-primary" />
          <h3 className="text-lg font-bold text-foreground">Histórico de Backups</h3>
          <span className="ml-auto text-sm text-muted-foreground font-medium">{backups?.length || 0} arquivo(s)</span>
        </div>

        {isLoading ? (
          <div className="p-8 text-center text-muted-foreground">Carregando...</div>
        ) : !backups || backups.length === 0 ? (
          <div className="p-12 text-center">
            <HardDrive className="w-12 h-12 text-muted-foreground/30 mx-auto mb-4" />
            <p className="font-bold text-foreground">Nenhum backup encontrado</p>
            <p className="text-muted-foreground text-sm mt-1">Clique em "Gerar JSON" ou "Gerar SQL" para criar o primeiro backup.</p>
          </div>
        ) : (
          <ul className="divide-y divide-border/50">
            {backups.map((b) => {
              const isSQL = b.format === 'sql' || b.filename.endsWith('.sql');
              const isDownloading = downloadingFile === b.filename;
              return (
                <li key={b.filename} data-testid={`row-backup-${b.filename}`}
                  className="p-4 flex items-center justify-between hover:bg-muted/10 transition-colors">
                  <div className="flex items-center gap-3">
                    <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${isSQL ? 'bg-blue-100' : 'bg-primary/10'}`}>
                      {isSQL
                        ? <FileCode2 className="w-5 h-5 text-blue-600" />
                        : <Database className="w-5 h-5 text-primary" />
                      }
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <p className="font-bold text-foreground text-sm">{b.filename}</p>
                        <span className={`text-xs px-2 py-0.5 rounded-full font-bold ${isSQL ? 'bg-blue-100 text-blue-700' : 'bg-emerald-100 text-emerald-700'}`}>
                          {isSQL ? 'SQL' : 'JSON'}
                        </span>
                      </div>
                      <p className="text-xs text-muted-foreground">{formatDate(b.createdAt)} · {formatBytes(b.size)}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      data-testid={`button-download-backup-${b.filename}`}
                      onClick={() => downloadBackup(b.filename)}
                      disabled={isDownloading}
                      className="flex items-center gap-2 px-3 py-2 rounded-xl border-2 border-border text-sm font-bold hover:border-primary/50 hover:bg-primary/5 transition-colors disabled:opacity-50"
                    >
                      {isDownloading
                        ? <Loader2 className="w-4 h-4 animate-spin" />
                        : <Download className="w-4 h-4" />
                      }
                      {isDownloading ? 'Baixando...' : 'Baixar'}
                    </button>
                    {deleteConfirm === b.filename ? (
                      <div className="flex gap-1">
                        <button
                          data-testid={`button-confirm-delete-backup-${b.filename}`}
                          onClick={() => deleteBackupMut.mutate(b.filename)}
                          disabled={deleteBackupMut.isPending}
                          className="flex items-center gap-1 px-3 py-2 bg-red-600 text-white rounded-xl text-sm font-bold hover:bg-red-700 transition-colors disabled:opacity-50"
                        >
                          {deleteBackupMut.isPending ? '...' : 'Confirmar'}
                        </button>
                        <button onClick={() => setDeleteConfirm(null)}
                          className="px-3 py-2 border-2 border-border rounded-xl text-sm font-bold hover:bg-muted transition-colors">
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                    ) : (
                      <button
                        data-testid={`button-delete-backup-${b.filename}`}
                        onClick={() => setDeleteConfirm(b.filename)}
                        className="p-2 rounded-xl border-2 border-red-200 text-red-500 hover:bg-red-50 transition-colors"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* Clean old backups modal */}
      {showCleanConfirm && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-card rounded-2xl p-6 max-w-md w-full shadow-2xl">
            <div className="flex items-start gap-3 mb-4">
              <div className="w-10 h-10 rounded-xl bg-orange-100 flex items-center justify-center flex-shrink-0">
                <AlertTriangle className="w-5 h-5 text-orange-600" />
              </div>
              <div>
                <h3 className="font-bold text-lg text-foreground">Limpar Backups Antigos</h3>
                <p className="text-sm text-muted-foreground mt-1">Todos os backups (JSON e SQL) com mais de 30 dias serão excluídos permanentemente.</p>
              </div>
            </div>
            <div className="flex gap-3 justify-end">
              <button onClick={() => setShowCleanConfirm(false)}
                className="px-4 py-2 border-2 border-border rounded-xl font-bold text-sm hover:bg-muted transition-colors">
                Cancelar
              </button>
              <button
                data-testid="button-confirm-clean-old"
                onClick={() => cleanOldMut.mutate()}
                disabled={cleanOldMut.isPending}
                className="flex items-center gap-2 px-4 py-2 bg-orange-600 text-white rounded-xl font-bold text-sm hover:bg-orange-700 transition-colors disabled:opacity-50"
              >
                {cleanOldMut.isPending ? 'Limpando...' : 'Confirmar limpeza'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* SMTP test modal */}
      {showSmtpTest && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-card rounded-2xl p-6 max-w-md w-full shadow-2xl">
            <div className="flex items-start gap-3 mb-4">
              <div className="w-10 h-10 rounded-xl bg-green-100 flex items-center justify-center flex-shrink-0">
                <Mail className="w-5 h-5 text-green-600" />
              </div>
              <div className="flex-1">
                <h3 className="font-bold text-lg text-foreground">Testar Envio SMTP</h3>
                <p className="text-sm text-muted-foreground mt-1">Um e-mail de teste será enviado para o endereço informado.</p>
              </div>
              <button onClick={() => setShowSmtpTest(false)} className="text-muted-foreground hover:text-foreground">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="mb-4">
              <label className="block text-sm font-semibold mb-1">E-mail de destino</label>
              <input
                type="email"
                data-testid="input-smtp-test-email"
                value={smtpTestEmail}
                onChange={e => setSmtpTestEmail(e.target.value)}
                placeholder="seu@email.com"
                className="w-full px-4 py-2.5 rounded-xl border-2 border-border focus:border-primary outline-none text-sm"
              />
            </div>
            <div className="flex gap-3 justify-end">
              <button onClick={() => setShowSmtpTest(false)}
                className="px-4 py-2 border-2 border-border rounded-xl font-bold text-sm hover:bg-muted transition-colors">
                Cancelar
              </button>
              <button
                data-testid="button-confirm-smtp-test"
                onClick={() => smtpTestMut.mutate(smtpTestEmail)}
                disabled={smtpTestMut.isPending || !smtpTestEmail}
                className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-xl font-bold text-sm hover:bg-green-700 transition-colors disabled:opacity-50"
              >
                <Send className="w-4 h-4" />
                {smtpTestMut.isPending ? 'Enviando...' : 'Enviar Teste'}
              </button>
            </div>
          </div>
        </div>
      )}
    </Layout>
  );
}
