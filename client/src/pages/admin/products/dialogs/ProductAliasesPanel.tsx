import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCompanies } from "@/hooks/use-admin";
import { useAuth } from "@/hooks/use-auth";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { useToast } from "@/hooks/use-toast";

type AliasRow = {
  id: number;
  alias: string;
  companyId: number | null;
  status: "CONFIRMED" | "REVOKED";
  globalJustification: string | null;
  confirmedAt: string | Date;
  confirmedByUserId: number;
  revocationReason: string | null;
};

export function ProductAliasesPanel({ productId }: { productId: number }) {
  const { data: companies = [] } = useCompanies();
  const { role } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const companyOptions = useMemo(() => companies as Array<{ id: number; companyName: string }>, [companies]);
  const [scope, setScope] = useState<"company" | "global">("company");
  const [companyId, setCompanyId] = useState("");
  const [aliasText, setAliasText] = useState("");
  const [globalJustification, setGlobalJustification] = useState("");
  const canCreateGlobal = role === "MASTER" || role === "DIRECTOR";

  const queryKey = ["/api/products", productId, "aliases", scope, companyId];
  const aliasesQuery = useQuery<AliasRow[]>({
    queryKey,
    enabled: scope === "global" || Boolean(companyId),
    queryFn: async () => {
      const params = scope === "global" ? "" : `?companyId=${encodeURIComponent(companyId)}`;
      const response = await fetchWithAuth(`/api/products/${productId}/aliases${params}`);
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.message || "Não foi possível carregar os aliases");
      return body.data ?? [];
    },
  });

  async function addAlias() {
    const body = scope === "global"
      ? { alias: aliasText, global: true, globalJustification }
      : { alias: aliasText, companyId: Number(companyId) };
    const response = await fetchWithAuth(`/api/products/${productId}/aliases`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.message || "Não foi possível confirmar o alias");
    setAliasText("");
    setGlobalJustification("");
    await queryClient.invalidateQueries({ queryKey });
    toast({ title: "Alias confirmado", description: "A associação foi registrada com o usuário e a data." });
  }

  async function revokeAlias(aliasId: number) {
    const reason = window.prompt("Informe o motivo para desativar esta associação (mínimo 10 caracteres):");
    if (reason == null) return;
    const response = await fetchWithAuth(`/api/products/aliases/${aliasId}`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason }),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.message || "Não foi possível desativar o alias");
    await queryClient.invalidateQueries({ queryKey });
    toast({ title: "Alias desativado", description: "O histórico de auditoria foi preservado." });
  }

  return (
    <section className="rounded-xl border-2 border-violet-200 bg-violet-50/60 p-4 space-y-3" data-testid="product-aliases-panel">
      <div>
        <h3 className="font-bold text-sm text-violet-950">Nomes alternativos confirmados</h3>
        <p className="text-xs text-violet-800 mt-1">Só aliases confirmados por uma pessoa autorizada identificam automaticamente um produto. Sugestões aproximadas nunca são consolidadas sozinhas.</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <label className="text-xs font-semibold">
          Escopo do alias
          <select value={scope} onChange={e => setScope(e.target.value as "company" | "global")} className="mt-1 w-full rounded-lg border border-violet-200 bg-white px-3 py-2 text-sm">
            <option value="company">Específico de uma empresa</option>
            {canCreateGlobal && <option value="global">Global (equivalência universal)</option>}
          </select>
        </label>
        {scope === "company" ? (
          <label className="text-xs font-semibold">
            Empresa de origem
            <select value={companyId} onChange={e => setCompanyId(e.target.value)} className="mt-1 w-full rounded-lg border border-violet-200 bg-white px-3 py-2 text-sm">
              <option value="">Selecione uma empresa</option>
              {companyOptions.map(company => <option key={company.id} value={company.id}>{company.companyName}</option>)}
            </select>
          </label>
        ) : (
          <label className="text-xs font-semibold">
            Justificativa da equivalência universal
            <input value={globalJustification} onChange={e => setGlobalJustification(e.target.value)} maxLength={500} className="mt-1 w-full rounded-lg border border-violet-200 bg-white px-3 py-2 text-sm" placeholder="Explique por que vale para todas as empresas" />
          </label>
        )}
      </div>

      <div className="flex flex-col sm:flex-row gap-2">
        <input value={aliasText} onChange={e => setAliasText(e.target.value)} maxLength={200} className="flex-1 rounded-lg border border-violet-200 bg-white px-3 py-2 text-sm" placeholder="Descrição alternativa exata usada na origem" />
        <button
          type="button"
          disabled={!aliasText.trim() || (scope === "company" && !companyId) || (scope === "global" && globalJustification.trim().length < 20)}
          onClick={() => void addAlias().catch(error => toast({ title: "Não foi possível confirmar", description: error.message, variant: "destructive" }))}
          className="rounded-lg bg-violet-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
        >
          Confirmar alias
        </button>
      </div>

      {aliasesQuery.isError && <p role="alert" className="text-xs text-red-700">{(aliasesQuery.error as Error).message}</p>}
      {scope === "company" && !companyId && <p className="text-xs text-muted-foreground">Selecione a empresa que usa esta descrição. O alias não será aplicado a outras empresas.</p>}
      {scope === "global" && <p className="text-xs text-muted-foreground">Somente MASTER ou DIRECTOR pode registrar um alias global, com justificativa e na visão global.</p>}
      {aliasesQuery.data?.length ? (
        <ul className="divide-y divide-violet-200 rounded-lg border border-violet-200 bg-white">
          {aliasesQuery.data.map(alias => (
            <li key={alias.id} className="flex items-start justify-between gap-3 p-2.5 text-xs">
              <div>
                <p className="font-semibold text-foreground">{alias.alias}</p>
                <p className="text-muted-foreground">
                  {alias.companyId == null ? "Global" : companyOptions.find(company => company.id === alias.companyId)?.companyName ?? `Empresa #${alias.companyId}`}
                  {" · "}{alias.status === "CONFIRMED" ? "Confirmado" : "Desativado"}
                  {" · "}por usuário #{alias.confirmedByUserId}
                </p>
                {alias.revocationReason && <p className="text-muted-foreground">Motivo da desativação: {alias.revocationReason}</p>}
              </div>
              {alias.status === "CONFIRMED" && (
                <button type="button" onClick={() => void revokeAlias(alias.id).catch(error => toast({ title: "Não foi possível desativar", description: error.message, variant: "destructive" }))} className="shrink-0 text-red-700 underline">
                  Desativar
                </button>
              )}
            </li>
          ))}
        </ul>
      ) : aliasesQuery.isPending ? (
        <p className="text-xs text-muted-foreground">Carregando aliases…</p>
      ) : null}
    </section>
  );
}
