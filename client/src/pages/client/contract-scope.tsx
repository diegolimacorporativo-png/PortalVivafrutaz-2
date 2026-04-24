import { useState } from "react";
import { useAuth } from "@/hooks/use-auth";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Layout } from "@/components/Layout";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  FileText, Calendar, Package, DollarSign, Truck, TrendingUp,
  Edit3, Loader2, AlertCircle, CheckCircle, ChevronRight
} from "lucide-react";

const DAY_ORDER = ["Segunda-feira", "Terça-feira", "Quarta-feira", "Quinta-feira", "Sexta-feira", "Sábado"];

function formatBRL(v: number | null | undefined) {
  if (v == null) return "—";
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

interface ScopeItem {
  id: number;
  dayOfWeek: string | null;
  productName: string | null;
  categoryName: string | null;
  quantity: number;
  unitPrice: string | null;
  averageCost: string | null;
}

export default function ClientContractScope() {
  const { company } = useAuth();
  const { toast } = useToast();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [requestText, setRequestText] = useState("");

  const { data, isLoading, isError } = useQuery<{ scopes: ScopeItem[]; company: any }>({
    queryKey: ["/api/client/contract-scope"],
  });

  const changeRequest = useMutation({
    mutationFn: (message: string) =>
      apiRequest("POST", "/api/client/scope-change-request", { message }),
    onSuccess: () => {
      toast({ title: "Solicitação enviada!", description: "Nossa equipe entrará em contato em breve." });
      setDialogOpen(false);
      setRequestText("");
    },
    onError: () => {
      toast({ title: "Erro ao enviar", description: "Tente novamente.", variant: "destructive" });
    },
  });

  if (isLoading) {
    return (
      <Layout>
        <div className="flex items-center justify-center min-h-[40vh]">
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
        </div>
      </Layout>
    );
  }

  if (isError || !data) {
    return (
      <Layout>
        <div className="flex flex-col items-center justify-center min-h-[40vh] gap-3 text-center">
          <AlertCircle className="w-12 h-12 text-muted-foreground" />
          <h2 className="text-xl font-bold">Escopo não disponível</h2>
          <p className="text-muted-foreground text-sm max-w-sm">Este recurso está disponível apenas para clientes com contrato ativo.</p>
        </div>
      </Layout>
    );
  }

  const scopes = data.scopes || [];

  const valorSemanal = scopes.reduce(
    (s, i) => s + Number(i.quantity) * (i.unitPrice ? Number(i.unitPrice) : 0), 0
  );
  const valorMensal = valorSemanal * 4;
  const deliveryDays = [...new Set(scopes.map((s) => s.dayOfWeek).filter(Boolean))];
  const totalItems = scopes.reduce((s, i) => s + Number(i.quantity), 0);
  const temPrecos = scopes.some((s) => s.unitPrice != null);

  const byDay: Record<string, ScopeItem[]> = {};
  for (const s of scopes) {
    const d = s.dayOfWeek || "Sem dia";
    if (!byDay[d]) byDay[d] = [];
    byDay[d].push(s);
  }
  const sortedDays = Object.keys(byDay).sort(
    (a, b) => (DAY_ORDER.indexOf(a) ?? 99) - (DAY_ORDER.indexOf(b) ?? 99)
  );

  return (
    <Layout>
      <div className="space-y-6 pb-10">
        {/* Header */}
        <div className="bg-gradient-to-r from-primary to-primary/80 rounded-3xl p-8 text-primary-foreground shadow-xl shadow-primary/20 relative overflow-hidden">
          <div className="absolute top-0 right-0 w-64 h-64 bg-white/10 rounded-full blur-3xl" />
          <div className="absolute bottom-[-10%] left-[10%] w-48 h-48 bg-black/10 rounded-full blur-2xl" />
          <div className="relative z-10">
            <div className="flex items-center gap-2 mb-2 text-primary-foreground/70 text-sm font-medium">
              <FileText className="w-4 h-4" />
              <span>Contrato Ativo</span>
            </div>
            <h1 className="text-3xl sm:text-4xl font-display font-extrabold tracking-tight">
              Meu Escopo Contratual
            </h1>
            <p className="mt-2 text-lg text-primary-foreground/90 font-medium">
              Veja os itens do seu contrato e solicite alterações.
            </p>
            <Button
              type="button"
              data-testid="button-request-scope-change"
              onClick={() => setDialogOpen(true)}
              className="mt-5 bg-white text-primary font-bold rounded-xl hover:bg-white/90 px-6 py-3 shadow-lg"
            >
              <Edit3 className="w-4 h-4 mr-2" />
              Solicitar alteração de escopo
            </Button>
          </div>
        </div>

        {/* Summary cards */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <div className="bg-card border border-border/50 rounded-2xl p-5 flex flex-col gap-1 shadow-sm">
            <div className="flex items-center gap-2 text-muted-foreground text-xs font-medium mb-1">
              <DollarSign className="w-4 h-4" /> Valor semanal
            </div>
            <span className="text-2xl font-bold text-foreground" data-testid="text-valor-semanal">
              {temPrecos ? formatBRL(valorSemanal) : "R$ 0,00"}
            </span>
            {!temPrecos && <span className="text-xs text-amber-600">Preços a definir</span>}
          </div>

          <div className="bg-card border border-border/50 rounded-2xl p-5 flex flex-col gap-1 shadow-sm">
            <div className="flex items-center gap-2 text-muted-foreground text-xs font-medium mb-1">
              <TrendingUp className="w-4 h-4" /> Valor mensal
            </div>
            <span className="text-2xl font-bold text-foreground" data-testid="text-valor-mensal">
              {temPrecos ? formatBRL(valorMensal) : "R$ 0,00"}
            </span>
          </div>

          <div className="bg-card border border-border/50 rounded-2xl p-5 flex flex-col gap-1 shadow-sm">
            <div className="flex items-center gap-2 text-muted-foreground text-xs font-medium mb-1">
              <Truck className="w-4 h-4" /> Entregas/semana
            </div>
            <span className="text-2xl font-bold text-foreground" data-testid="text-entregas">
              {deliveryDays.length}
            </span>
          </div>

          <div className="bg-card border border-border/50 rounded-2xl p-5 flex flex-col gap-1 shadow-sm">
            <div className="flex items-center gap-2 text-muted-foreground text-xs font-medium mb-1">
              <Package className="w-4 h-4" /> Volume semanal
            </div>
            <span className="text-2xl font-bold text-foreground" data-testid="text-volume">
              {totalItems} un
            </span>
          </div>
        </div>

        {/* Scope items */}
        {scopes.length === 0 ? (
          <div className="bg-card border border-border/50 rounded-2xl p-12 text-center">
            <Package className="w-12 h-12 text-muted-foreground mx-auto mb-3" />
            <h3 className="font-semibold text-foreground mb-1">Nenhum item no escopo ainda</h3>
            <p className="text-muted-foreground text-sm">Nossa equipe ainda está configurando seu escopo contratual.</p>
          </div>
        ) : (
          <div className="space-y-4">
            {sortedDays.map((day) => {
              const items = byDay[day];
              const dayTotal = items.reduce(
                (s, i) => s + Number(i.quantity) * (i.unitPrice ? Number(i.unitPrice) : 0), 0
              );
              return (
                <div key={day} className="bg-card border border-border/50 rounded-2xl overflow-hidden shadow-sm" data-testid={`section-day-${day}`}>
                  <div className="flex items-center justify-between px-5 py-3 bg-primary/5 border-b border-border/40">
                    <div className="flex items-center gap-2">
                      <Calendar className="w-4 h-4 text-primary" />
                      <span className="font-bold text-foreground">{day}</span>
                    </div>
                    {dayTotal > 0 && (
                      <span className="text-sm font-semibold text-primary">{formatBRL(dayTotal)}</span>
                    )}
                  </div>
                  <div className="divide-y divide-border/30">
                    {items.map((item) => {
                      const total = Number(item.quantity) * (item.unitPrice ? Number(item.unitPrice) : 0);
                      return (
                        <div
                          key={item.id}
                          className="flex items-center justify-between px-5 py-4"
                          data-testid={`scope-item-client-${item.id}`}
                        >
                          <div className="flex flex-col gap-0.5">
                            <span className="font-semibold text-foreground">
                              {item.productName || item.categoryName || "Produto"}
                            </span>
                            {item.categoryName && item.productName && (
                              <span className="text-xs text-muted-foreground">{item.categoryName}</span>
                            )}
                          </div>
                          <div className="flex items-center gap-6 text-sm">
                            <div className="text-right">
                              <div className="text-muted-foreground text-xs">Quantidade</div>
                              <div className="font-bold text-foreground">{item.quantity} un</div>
                            </div>
                            <div className="text-right">
                              <div className="text-muted-foreground text-xs">Preço unit.</div>
                              <div className="font-bold text-foreground">
                                {item.unitPrice ? formatBRL(Number(item.unitPrice)) : <span className="text-muted-foreground text-xs">A definir</span>}
                              </div>
                            </div>
                            <div className="text-right">
                              <div className="text-muted-foreground text-xs">Total</div>
                              <div className="font-bold text-primary">
                                {item.unitPrice ? formatBRL(total) : <span className="text-muted-foreground text-xs">—</span>}
                              </div>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Info banner */}
        <div className="flex items-start gap-3 bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 rounded-xl p-4">
          <CheckCircle className="w-5 h-5 text-blue-500 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-sm text-blue-800 dark:text-blue-200 font-medium">Pedidos automáticos</p>
            <p className="text-xs text-blue-600 dark:text-blue-400 mt-0.5">
              Seus pedidos são gerados automaticamente conforme o escopo contratual. Não é necessário fazer pedidos manuais.
            </p>
          </div>
        </div>
      </div>

      {/* Scope change request dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Edit3 className="w-5 h-5 text-primary" />
              Solicitar alteração de escopo
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <p className="text-sm text-muted-foreground">
              Descreva a alteração que deseja fazer no seu escopo contratual. Nossa equipe entrará em contato para confirmar.
            </p>
            <div className="space-y-1.5">
              <Label htmlFor="request-text">Sua solicitação</Label>
              <Textarea
                id="request-text"
                data-testid="textarea-scope-request"
                placeholder='Ex: "Quero aumentar a quantidade de bananas de segunda para 50 unidades" ou "Gostaria de adicionar manga às quartas-feiras"'
                value={requestText}
                onChange={(e) => setRequestText(e.target.value)}
                rows={4}
                className="resize-none"
              />
            </div>
            <div className="flex items-start gap-2 text-xs text-muted-foreground bg-muted/50 rounded-lg p-3">
              <ChevronRight className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
              <span>Você também pode solicitar alterações pelo chat com a IA Clara.</span>
            </div>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setDialogOpen(false)}
              data-testid="button-cancel-scope-request"
            >
              Cancelar
            </Button>
            <Button
              type="button"
              data-testid="button-send-scope-request"
              disabled={requestText.trim().length < 5 || changeRequest.isPending}
              onClick={() => changeRequest.mutate(requestText)}
            >
              {changeRequest.isPending ? (
                <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Enviando...</>
              ) : (
                <><Edit3 className="w-4 h-4 mr-2" /> Enviar solicitação</>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Layout>
  );
}
