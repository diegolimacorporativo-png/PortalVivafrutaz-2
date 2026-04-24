import { useCompanies } from "@/hooks/use-admin";
import { useProducts } from "@/hooks/use-catalog";
import { Layout } from "@/components/Layout";
import { useState } from "react";
import { Building2, DollarSign, TrendingUp, Percent, Info, Package } from "lucide-react";
import type { Company } from "@shared/schema";

function calcFinalPrice(basePrice: string | null, adminFee: string | null): number | null {
  if (!basePrice) return null;
  const base = Number(basePrice);
  const fee = Number(adminFee || 0);
  return base * (1 + fee / 100);
}

function fmtBRL(n: number): string {
  return n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function PriceGroupsPage() {
  const { data: companies } = useCompanies();
  const { data: products } = useProducts();
  const [selectedCompany, setSelectedCompany] = useState<Company | null>(null);

  const activeProducts = products?.filter(p => p.active && p.basePrice) || [];

  return (
    <Layout>
      <div className="mb-8">
        <h1 className="text-3xl font-display font-bold text-foreground">Simulador de Preços</h1>
        <p className="text-muted-foreground mt-1">
          Visualize o preço base, taxa administrativa e preço final por empresa.
        </p>
      </div>

      {/* Formula explanation */}
      <div className="mb-6 p-4 rounded-2xl border border-primary/20 bg-primary/5 flex flex-wrap items-center gap-3">
        <Info className="w-5 h-5 text-primary flex-shrink-0" />
        <p className="text-sm text-foreground font-medium">
          <strong>Fórmula:</strong>{" "}
          <span className="font-mono bg-white/50 px-2 py-0.5 rounded-md text-primary">
            preço_final = preço_base × (1 + taxa_administrativa / 100)
          </span>
        </p>
        <p className="text-sm text-muted-foreground">
          Ex: R$ 2,00 × (1 + 12/100) = <strong className="text-foreground">R$ 2,24</strong>
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-8">
        {/* Companies sidebar */}
        <div className="lg:col-span-1 space-y-3">
          <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider px-1 mb-2">Selecione a Empresa</p>
          {companies?.length === 0 && (
            <p className="text-sm text-muted-foreground p-4">Nenhuma empresa cadastrada.</p>
          )}
          {companies?.map(company => (
            <button
              key={company.id}
              data-testid={`button-company-${company.id}`}
              onClick={() => setSelectedCompany(company)}
              className={`w-full text-left p-4 rounded-2xl border transition-all ${
                selectedCompany?.id === company.id
                  ? 'border-primary bg-primary/5 shadow-md'
                  : 'border-border/50 bg-card hover:border-border'
              }`}
            >
              <div className="flex items-start gap-3">
                <Building2 className={`w-5 h-5 mt-0.5 flex-shrink-0 ${selectedCompany?.id === company.id ? 'text-primary' : 'text-muted-foreground'}`} />
                <div className="min-w-0">
                  <h3 className="font-bold text-foreground text-sm leading-tight truncate">{company.companyName}</h3>
                  {company.adminFee !== null && company.adminFee !== undefined && (
                    <div className="flex items-center gap-1 mt-1">
                      <Percent className="w-3 h-3 text-secondary" />
                      <span className="text-xs font-bold text-secondary">
                        Taxa: {Number(company.adminFee).toFixed(1)}%
                      </span>
                    </div>
                  )}
                  {(!company.adminFee || Number(company.adminFee) === 0) && (
                    <span className="text-xs text-muted-foreground">Sem taxa</span>
                  )}
                </div>
              </div>
            </button>
          ))}
        </div>

        {/* Pricing table */}
        <div className="lg:col-span-3">
          {selectedCompany ? (
            <div className="bg-card rounded-2xl border border-border/50 premium-shadow overflow-hidden">
              {/* Header */}
              <div className="p-6 border-b border-border/50 bg-muted/20">
                <div className="flex items-center justify-between flex-wrap gap-4">
                  <div>
                    <h2 className="text-xl font-bold text-foreground">{selectedCompany.companyName}</h2>
                    <p className="text-sm text-muted-foreground mt-0.5">{selectedCompany.contactName}</p>
                  </div>
                  <div className="flex gap-4">
                    <div className="text-center px-5 py-3 bg-secondary/10 rounded-xl border border-secondary/20">
                      <p className="text-xs text-muted-foreground font-semibold uppercase tracking-wider">Taxa Admin.</p>
                      <p className="text-2xl font-display font-bold text-secondary mt-0.5">
                        {Number(selectedCompany.adminFee || 0).toFixed(1)}%
                      </p>
                    </div>
                    <div className="text-center px-5 py-3 bg-primary/10 rounded-xl border border-primary/20">
                      <p className="text-xs text-muted-foreground font-semibold uppercase tracking-wider">Produtos</p>
                      <p className="text-2xl font-display font-bold text-primary mt-0.5">{activeProducts.length}</p>
                    </div>
                  </div>
                </div>
              </div>

              {activeProducts.length === 0 ? (
                <div className="p-12 text-center">
                  <Package className="w-12 h-12 text-muted-foreground mx-auto mb-3" />
                  <p className="text-muted-foreground font-medium">Nenhum produto com preço base definido.</p>
                  <p className="text-sm text-muted-foreground mt-1">
                    Defina o preço base nos produtos para visualizar o simulador.
                  </p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left">
                    <thead>
                      <tr className="bg-muted/30 border-b border-border/50 text-muted-foreground text-xs uppercase tracking-wider">
                        <th className="px-6 py-4 font-semibold">Produto</th>
                        <th className="px-6 py-4 font-semibold text-right">
                          <span className="flex items-center gap-1 justify-end">
                            <DollarSign className="w-3 h-3" /> Preço Base
                          </span>
                        </th>
                        <th className="px-6 py-4 font-semibold text-right">
                          <span className="flex items-center gap-1 justify-end">
                            <Percent className="w-3 h-3" /> Taxa Admin.
                          </span>
                        </th>
                        <th className="px-6 py-4 font-semibold text-right">
                          <span className="flex items-center gap-1 justify-end">
                            <TrendingUp className="w-3 h-3" /> Preço Final (Cliente)
                          </span>
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/50">
                      {activeProducts.map(product => {
                        const final = calcFinalPrice(product.basePrice, selectedCompany.adminFee);
                        const fee = Number(selectedCompany.adminFee || 0);
                        return (
                          <tr key={product.id} className="hover:bg-muted/10 transition-colors">
                            <td className="px-6 py-4">
                              <p className="font-bold text-foreground">{product.name}</p>
                              <p className="text-xs text-muted-foreground uppercase tracking-wider">
                                {product.category} · por {product.unit}
                              </p>
                            </td>
                            <td className="px-6 py-4 text-right">
                              <span className="font-mono text-sm font-bold text-muted-foreground">
                                R$ {fmtBRL(Number(product.basePrice))}
                              </span>
                            </td>
                            <td className="px-6 py-4 text-right">
                              <span className={`inline-flex items-center gap-1 px-3 py-1 rounded-full text-sm font-bold ${
                                fee > 0 ? 'bg-secondary/10 text-secondary' : 'bg-muted text-muted-foreground'
                              }`}>
                                <Percent className="w-3 h-3" />
                                {fee.toFixed(1)}%
                              </span>
                            </td>
                            <td className="px-6 py-4 text-right">
                              {final !== null ? (
                                <div>
                                  <p className="font-display font-bold text-xl text-primary">
                                    R$ {fmtBRL(final)}
                                  </p>
                                  {fee > 0 && (
                                    <p className="text-xs text-muted-foreground mt-0.5">
                                      +R$ {fmtBRL(final - Number(product.basePrice))} de taxa
                                    </p>
                                  )}
                                </div>
                              ) : (
                                <span className="text-muted-foreground text-sm">—</span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          ) : (
            <div className="h-full min-h-[400px] flex flex-col items-center justify-center border-2 border-dashed border-border/50 rounded-2xl text-center p-8">
              <Building2 className="w-12 h-12 text-muted-foreground/40 mb-4" />
              <p className="font-bold text-foreground text-lg">Selecione uma empresa</p>
              <p className="text-muted-foreground text-sm mt-1">
                Escolha uma empresa para visualizar os preços finais calculados com a taxa administrativa.
              </p>
            </div>
          )}
        </div>
      </div>
    </Layout>
  );
}
