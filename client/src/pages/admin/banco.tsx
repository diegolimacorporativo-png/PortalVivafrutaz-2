import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Landmark, Plus, Trash2, RefreshCw, Wifi, WifiOff, ArrowDownLeft, ArrowUpRight, CheckCircle2, Clock, AlertCircle, BarChart3, Link2 } from "lucide-react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";

function fmtDate(d: string | null | undefined) {
  if (!d) return "—";
  try { return format(new Date(d), "dd/MM/yyyy HH:mm", { locale: ptBR }); } catch { return d; }
}

function fmtBRL(v: string | number | null | undefined) {
  if (v == null || v === "") return "—";
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(v));
}

type BankAccount = {
  id: number;
  banco: string;
  agencia: string;
  conta: string;
  descricao?: string;
  clientId?: string;
  clientSecret?: string;
  ambiente: string;
  status: string;
  saldoAtual?: string;
  ultimaSincronizacao?: string;
  createdAt: string;
};

type BankTx = {
  id: number;
  tipo: string;
  valor: string;
  data: string;
  descricao: string;
  documento?: string;
  status: string;
  externalId?: string;
};

type Match = {
  bankTx: any;
  match: any;
  score: number;
  tipo: string;
};

function StatusChip({ status }: { status: string }) {
  const map: Record<string, string> = {
    conectado: "bg-green-100 text-green-800",
    desconectado: "bg-gray-100 text-gray-600",
    erro: "bg-red-100 text-red-700",
    aguardando: "bg-yellow-100 text-yellow-700",
  };
  const cls = map[status] || "bg-gray-100 text-gray-600";
  return <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${cls}`}>{status}</span>;
}

function AccountForm({ initial, onSave, onCancel }: { initial?: Partial<BankAccount>; onSave: (d: any) => void; onCancel: () => void }) {
  const [form, setForm] = useState({
    banco: initial?.banco || "Itaú",
    agencia: initial?.agencia || "",
    conta: initial?.conta || "",
    descricao: initial?.descricao || "",
    clientId: initial?.clientId || "",
    clientSecret: "",
    ambiente: initial?.ambiente || "sandbox",
  });
  const set = (k: string) => (e: any) => setForm(f => ({ ...f, [k]: e.target.value }));
  return (
    <div className="space-y-3 text-sm">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label className="text-xs">Banco</Label>
          <Input data-testid="input-banco" value={form.banco} onChange={set("banco")} placeholder="Itaú" />
        </div>
        <div>
          <Label className="text-xs">Descrição</Label>
          <Input data-testid="input-descricao-banco" value={form.descricao} onChange={set("descricao")} placeholder="Conta principal" />
        </div>
        <div>
          <Label className="text-xs">Agência</Label>
          <Input data-testid="input-agencia" value={form.agencia} onChange={set("agencia")} placeholder="0001" />
        </div>
        <div>
          <Label className="text-xs">Conta</Label>
          <Input data-testid="input-conta" value={form.conta} onChange={set("conta")} placeholder="12345-6" />
        </div>
        <div>
          <Label className="text-xs">Client ID (Itaú API)</Label>
          <Input data-testid="input-client-id" value={form.clientId} onChange={set("clientId")} placeholder="client_id da aplicação" />
        </div>
        <div>
          <Label className="text-xs">Client Secret</Label>
          <Input data-testid="input-client-secret" value={form.clientSecret} onChange={set("clientSecret")} placeholder="••••••••" type="password" />
        </div>
        <div className="col-span-2">
          <Label className="text-xs">Ambiente</Label>
          <Select value={form.ambiente} onValueChange={v => setForm(f => ({ ...f, ambiente: v }))}>
            <SelectTrigger data-testid="select-ambiente-banco" className="h-8 text-xs mt-1">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="sandbox">Sandbox (Homologação)</SelectItem>
              <SelectItem value="producao">Produção</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="flex gap-2 pt-2">
        <Button type="button" data-testid="button-salvar-conta" className="bg-blue-600 hover:bg-blue-700 text-white" onClick={() => onSave(form)}>
          Salvar Conta
        </Button>
        <Button type="button" variant="outline" onClick={onCancel}>Cancelar</Button>
      </div>
    </div>
  );
}

function ExtratoTab({ account }: { account: BankAccount }) {
  const { toast } = useToast();
  const [from, setFrom] = useState(() => new Date(Date.now() - 30 * 86400000).toISOString().split("T")[0]);
  const [to, setTo] = useState(() => new Date().toISOString().split("T")[0]);
  const [txs, setTxs] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [resumo, setResumo] = useState<{ periodo?: string; saldoFinal?: number } | null>(null);

  async function buscar() {
    setLoading(true);
    try {
      const res = await fetch(`/api/bank/accounts/${account.id}/extrato?from=${from}&to=${to}`);
      const data = await res.json();
      if (!res.ok) { toast({ title: data.message || "Erro ao buscar extrato", variant: "destructive" }); return; }
      setTxs(data.transacoes || []);
      setResumo({ periodo: `${data.periodo?.dataInicio} a ${data.periodo?.dataFim}` });
    } catch (e: any) {
      toast({ title: e.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }

  const totalEntradas = txs.filter(t => t.tipo === "credito").reduce((s, t) => s + parseFloat(t.valor || 0), 0);
  const totalSaidas = txs.filter(t => t.tipo === "debito").reduce((s, t) => s + parseFloat(t.valor || 0), 0);

  return (
    <div className="space-y-4">
      <div className="flex items-end gap-2 flex-wrap">
        <div>
          <Label className="text-xs">De</Label>
          <Input data-testid="input-extrato-from" type="date" value={from} onChange={e => setFrom(e.target.value)} className="h-8 text-xs w-36" />
        </div>
        <div>
          <Label className="text-xs">Até</Label>
          <Input data-testid="input-extrato-to" type="date" value={to} onChange={e => setTo(e.target.value)} className="h-8 text-xs w-36" />
        </div>
        <Button type="button" data-testid="button-buscar-extrato" onClick={buscar} disabled={loading} className="h-8 text-xs bg-blue-600 hover:bg-blue-700 text-white">
          {loading ? <RefreshCw className="w-3 h-3 animate-spin mr-1" /> : null}
          Buscar Extrato
        </Button>
      </div>

      {txs.length > 0 && (
        <div className="grid grid-cols-3 gap-3 text-sm">
          <div className="bg-green-50 rounded-lg p-3">
            <p className="text-xs text-gray-500">Entradas</p>
            <p className="font-bold text-green-700">{fmtBRL(totalEntradas)}</p>
          </div>
          <div className="bg-red-50 rounded-lg p-3">
            <p className="text-xs text-gray-500">Saídas</p>
            <p className="font-bold text-red-600">{fmtBRL(totalSaidas)}</p>
          </div>
          <div className="bg-blue-50 rounded-lg p-3">
            <p className="text-xs text-gray-500">Saldo período</p>
            <p className={`font-bold ${(totalEntradas - totalSaidas) >= 0 ? "text-blue-700" : "text-red-600"}`}>{fmtBRL(totalEntradas - totalSaidas)}</p>
          </div>
        </div>
      )}

      <div className="divide-y rounded-lg border">
        {loading && [...Array(5)].map((_, i) => <Skeleton key={i} className="h-10 w-full m-1" />)}
        {!loading && txs.length === 0 && (
          <p className="text-center text-gray-400 text-sm py-8">Nenhuma transação. Selecione o período e busque o extrato.</p>
        )}
        {txs.map((tx, i) => (
          <div key={i} data-testid={`row-tx-${i}`} className="flex items-center gap-3 px-3 py-2.5 text-sm">
            <div className={`p-1.5 rounded-full ${tx.tipo === "credito" ? "bg-green-100" : "bg-red-100"}`}>
              {tx.tipo === "credito" ? <ArrowDownLeft className="w-3 h-3 text-green-600" /> : <ArrowUpRight className="w-3 h-3 text-red-500" />}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium truncate">{tx.descricao || "—"}</p>
              <p className="text-xs text-gray-400">{tx.data} {tx.documento ? `· Doc: ${tx.documento}` : ""}</p>
            </div>
            <p className={`font-semibold text-sm ${tx.tipo === "credito" ? "text-green-600" : "text-red-500"}`}>
              {tx.tipo === "credito" ? "+" : "−"}{fmtBRL(Math.abs(parseFloat(tx.valor)))}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}

function ReconciliarTab({ accounts }: { accounts: BankAccount[] }) {
  const { toast } = useToast();
  const [selectedAccount, setSelectedAccount] = useState<number | null>(accounts[0]?.id || null);
  const [matches, setMatches] = useState<Match[]>([]);
  const [resumo, setResumo] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [confirming, setConfirming] = useState<number | null>(null);

  async function reconciliar() {
    setLoading(true);
    try {
      const res = await apiRequest("POST", "/api/bank/reconciliar", { bankAccountId: selectedAccount });
      const data = await res.json();
      if (!res.ok) { toast({ title: data.message || "Erro na reconciliação", variant: "destructive" }); return; }
      setMatches(data.matches || []);
      setResumo(data.resumo || null);
    } catch (e: any) {
      toast({ title: e.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }

  async function confirmar(bankTxId: number, tipo: string, itemId: number) {
    setConfirming(bankTxId);
    try {
      const res = await apiRequest("POST", "/api/bank/reconciliar/confirmar", { bankTxId, tipo, itemId });
      if (!res.ok) { const d = await res.json(); toast({ title: d.message, variant: "destructive" }); return; }
      toast({ title: "Conciliação confirmada!" });
      setMatches(m => m.filter(x => x.bankTx?.id !== bankTxId));
      queryClient.invalidateQueries({ queryKey: ["/api/finance"] });
    } catch (e: any) {
      toast({ title: e.message, variant: "destructive" });
    } finally {
      setConfirming(null);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-end gap-2 flex-wrap">
        <div>
          <Label className="text-xs">Conta Bancária</Label>
          <Select value={String(selectedAccount || "")} onValueChange={v => setSelectedAccount(Number(v))}>
            <SelectTrigger data-testid="select-conta-reconciliar" className="h-8 text-xs w-52">
              <SelectValue placeholder="Selecione a conta" />
            </SelectTrigger>
            <SelectContent>
              {accounts.map(a => (
                <SelectItem key={a.id} value={String(a.id)}>{a.banco} — Ag {a.agencia} / C {a.conta}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button type="button" data-testid="button-reconciliar" onClick={reconciliar} disabled={loading || !selectedAccount} className="h-8 text-xs bg-purple-600 hover:bg-purple-700 text-white">
          {loading ? <RefreshCw className="w-3 h-3 animate-spin mr-1" /> : <Link2 className="w-3 h-3 mr-1" />}
          Reconciliar
        </Button>
      </div>

      {resumo && (
        <div className="grid grid-cols-3 gap-3 text-sm">
          <div className="bg-green-50 rounded-lg p-3">
            <p className="text-xs text-gray-500">Conciliadas</p>
            <p className="font-bold text-green-700">{resumo.totalConciliadas}</p>
          </div>
          <div className="bg-yellow-50 rounded-lg p-3">
            <p className="text-xs text-gray-500">Pendentes</p>
            <p className="font-bold text-yellow-700">{resumo.totalPendentes}</p>
          </div>
          <div className="bg-blue-50 rounded-lg p-3">
            <p className="text-xs text-gray-500">Valor conciliado</p>
            <p className="font-bold text-blue-700">{fmtBRL(resumo.valorConciliado)}</p>
          </div>
        </div>
      )}

      {matches.length === 0 && !loading && resumo && (
        <p className="text-center text-gray-400 text-sm py-8">Nenhum match encontrado para conciliação.</p>
      )}
      {!resumo && !loading && (
        <p className="text-center text-gray-400 text-sm py-8">Execute a reconciliação para ver os matches automáticos entre o extrato bancário e as contas a receber/pagar.</p>
      )}

      <div className="space-y-2">
        {matches.filter(m => m.match).map((m, i) => (
          <div key={i} data-testid={`row-match-${i}`} className="border rounded-lg p-3 flex items-center gap-3 bg-white dark:bg-gray-900">
            <div className={`p-1.5 rounded-full ${m.bankTx.tipo === "credito" ? "bg-green-100" : "bg-red-100"}`}>
              {m.bankTx.tipo === "credito" ? <ArrowDownLeft className="w-3 h-3 text-green-600" /> : <ArrowUpRight className="w-3 h-3 text-red-500" />}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-semibold truncate">{m.bankTx.descricao || "Transação bancária"}</p>
              <p className="text-xs text-gray-400">{m.bankTx.data} · {fmtBRL(m.bankTx.valor)} → Match: {m.match.descricao} ({fmtBRL(m.match.valor)}) · Confiança: {(m.score * 100).toFixed(0)}%</p>
            </div>
            <div className="flex items-center gap-1 text-xs text-gray-500 bg-gray-50 rounded px-2 py-1">
              {m.tipo === "ar" ? "A/Receber" : "A/Pagar"}
            </div>
            <Button
              type="button"
              size="sm"
              data-testid={`button-confirmar-match-${i}`}
              className="h-7 text-xs bg-green-600 hover:bg-green-700 text-white"
              onClick={() => confirmar(m.bankTx.id, m.tipo, m.match.id)}
              disabled={confirming === m.bankTx.id}
            >
              {confirming === m.bankTx.id ? <RefreshCw className="w-3 h-3 animate-spin" /> : <CheckCircle2 className="w-3 h-3" />}
              <span className="ml-1 hidden sm:inline">Confirmar</span>
            </Button>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function BancoPage() {
  const { toast } = useToast();
  const [showForm, setShowForm] = useState(false);
  const [editAccount, setEditAccount] = useState<BankAccount | null>(null);
  const [selectedForExtrato, setSelectedForExtrato] = useState<BankAccount | null>(null);

  const { data: accounts = [], isLoading } = useQuery<BankAccount[]>({
    queryKey: ["/api/bank/accounts"],
  });

  const createMutation = useMutation({
    mutationFn: (data: any) => apiRequest("POST", "/api/bank/accounts", data),
    onSuccess: async (res) => {
      const d = await res.json();
      if (!res.ok) { toast({ title: d.message, variant: "destructive" }); return; }
      toast({ title: "Conta bancária adicionada!" });
      queryClient.invalidateQueries({ queryKey: ["/api/bank/accounts"] });
      setShowForm(false);
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: any) => apiRequest("PATCH", `/api/bank/accounts/${id}`, data),
    onSuccess: async (res) => {
      const d = await res.json();
      if (!res.ok) { toast({ title: d.message, variant: "destructive" }); return; }
      toast({ title: "Conta atualizada!" });
      queryClient.invalidateQueries({ queryKey: ["/api/bank/accounts"] });
      setEditAccount(null);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/bank/accounts/${id}`, {}),
    onSuccess: () => {
      toast({ title: "Conta removida" });
      queryClient.invalidateQueries({ queryKey: ["/api/bank/accounts"] });
    },
  });

  const testMutation = useMutation({
    mutationFn: (id: number) => apiRequest("POST", `/api/bank/accounts/${id}/testar`, {}),
    onSuccess: async (res, id) => {
      const d = await res.json();
      if (!res.ok) { toast({ title: d.message, variant: "destructive" }); queryClient.invalidateQueries({ queryKey: ["/api/bank/accounts"] }); return; }
      toast({ title: `Conexão OK! Saldo: ${fmtBRL(d.saldo)}` });
      queryClient.invalidateQueries({ queryKey: ["/api/bank/accounts"] });
    },
    onError: (e: any) => toast({ title: e.message, variant: "destructive" }),
  });

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
            <Landmark className="w-6 h-6 text-blue-600" />
            Integração Bancária — Itaú
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">Conecte contas, consulte extratos e reconcilie transações</p>
        </div>
        <Button
          type="button"
          data-testid="button-nova-conta"
          onClick={() => { setShowForm(true); setEditAccount(null); }}
          className="bg-blue-600 hover:bg-blue-700 text-white"
        >
          <Plus className="w-4 h-4 mr-2" />
          Nova Conta
        </Button>
      </div>

      {showForm && !editAccount && (
        <Card>
          <CardHeader><CardTitle className="text-base">Adicionar Conta Bancária</CardTitle></CardHeader>
          <CardContent>
            <AccountForm
              onSave={d => createMutation.mutate(d)}
              onCancel={() => setShowForm(false)}
            />
          </CardContent>
        </Card>
      )}

      {editAccount && (
        <Card>
          <CardHeader><CardTitle className="text-base">Editar Conta — {editAccount.banco}</CardTitle></CardHeader>
          <CardContent>
            <AccountForm
              initial={editAccount}
              onSave={d => updateMutation.mutate({ id: editAccount.id, data: d })}
              onCancel={() => setEditAccount(null)}
            />
          </CardContent>
        </Card>
      )}

      {isLoading ? (
        <div className="space-y-3">{[...Array(3)].map((_, i) => <Skeleton key={i} className="h-24 w-full" />)}</div>
      ) : accounts.length === 0 ? (
        <Card>
          <CardContent className="text-center py-12 text-gray-400">
            <Landmark className="w-10 h-10 mx-auto mb-2 opacity-40" />
            <p>Nenhuma conta bancária configurada.</p>
            <p className="text-xs mt-1">Clique em "Nova Conta" para conectar sua conta Itaú.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {accounts.map(acc => (
            <Card key={acc.id} data-testid={`card-conta-${acc.id}`} className={`border-2 transition-colors ${selectedForExtrato?.id === acc.id ? "border-blue-400" : "border-transparent"}`}>
              <CardContent className="pt-4 pb-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-3">
                    <div className="p-2 bg-blue-50 rounded-lg">
                      <Landmark className="w-5 h-5 text-blue-600" />
                    </div>
                    <div>
                      <p className="font-semibold text-gray-900 dark:text-white">{acc.banco}</p>
                      <p className="text-xs text-gray-500">Ag {acc.agencia} · C {acc.conta}</p>
                      {acc.descricao && <p className="text-xs text-gray-400 mt-0.5">{acc.descricao}</p>}
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <StatusChip status={acc.status} />
                    <span className="text-xs text-gray-400 capitalize">{acc.ambiente}</span>
                  </div>
                </div>

                {acc.saldoAtual && (
                  <div className="mt-3 bg-gray-50 dark:bg-gray-800 rounded-lg p-2.5 flex items-center justify-between">
                    <span className="text-xs text-gray-500">Saldo</span>
                    <span className="font-bold text-gray-900 dark:text-white">{fmtBRL(acc.saldoAtual)}</span>
                  </div>
                )}

                {acc.ultimaSincronizacao && (
                  <p className="text-xs text-gray-400 mt-1.5">Última sync: {fmtDate(acc.ultimaSincronizacao)}</p>
                )}

                <div className="flex gap-2 mt-3 flex-wrap">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs"
                    data-testid={`button-testar-conta-${acc.id}`}
                    onClick={() => testMutation.mutate(acc.id)}
                    disabled={testMutation.isPending}
                  >
                    {testMutation.isPending ? <RefreshCw className="w-3 h-3 animate-spin mr-1" /> : <Wifi className="w-3 h-3 mr-1" />}
                    Testar Conexão
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant={selectedForExtrato?.id === acc.id ? "default" : "outline"}
                    className={`h-7 text-xs ${selectedForExtrato?.id === acc.id ? "bg-blue-600 text-white" : ""}`}
                    data-testid={`button-ver-extrato-${acc.id}`}
                    onClick={() => setSelectedForExtrato(selectedForExtrato?.id === acc.id ? null : acc)}
                  >
                    <BarChart3 className="w-3 h-3 mr-1" />
                    {selectedForExtrato?.id === acc.id ? "Fechar" : "Extrato"}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="h-7 text-xs"
                    data-testid={`button-editar-conta-${acc.id}`}
                    onClick={() => { setEditAccount(acc); setShowForm(false); }}
                  >
                    Editar
                  </Button>
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button type="button" size="sm" variant="ghost" className="h-7 text-xs text-red-500 hover:text-red-700" data-testid={`button-excluir-conta-${acc.id}`}>
                        <Trash2 className="w-3 h-3" />
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Remover conta {acc.banco}?</AlertDialogTitle>
                        <AlertDialogDescription>Esta ação não pode ser desfeita.</AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancelar</AlertDialogCancel>
                        <AlertDialogAction className="bg-red-600 hover:bg-red-700" onClick={() => deleteMutation.mutate(acc.id)}>
                          Remover
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {selectedForExtrato && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <BarChart3 className="w-4 h-4 text-blue-600" />
              Extrato — {selectedForExtrato.banco} · Ag {selectedForExtrato.agencia} / C {selectedForExtrato.conta}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ExtratoTab account={selectedForExtrato} />
          </CardContent>
        </Card>
      )}

      {accounts.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Link2 className="w-4 h-4 text-purple-600" />
              Reconciliação Bancária
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ReconciliarTab accounts={accounts} />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
