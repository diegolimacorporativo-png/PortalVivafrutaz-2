import { ChevronLeft, ChevronRight } from "lucide-react";
import { CompanyRow } from "./CompanyRow";
import type { Company } from "@shared/schema";

interface CompaniesTableProps {
  companies: Company[];
  priceGroups: any[];
  page: number;
  totalPages: number;
  totalCount: number;
  onEdit: (c: Company) => void;
  onPageChange: (p: number) => void;
}

export function CompaniesTable({
  companies, priceGroups, page, totalPages, totalCount, onEdit, onPageChange,
}: CompaniesTableProps) {
  return (
    <div>
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b border-border/50 bg-muted/30">
              <th className="text-left px-6 py-4 text-xs font-bold text-muted-foreground uppercase tracking-wider">Empresa</th>
              <th className="text-left px-6 py-4 text-xs font-bold text-muted-foreground uppercase tracking-wider">Contato</th>
              <th className="text-left px-6 py-4 text-xs font-bold text-muted-foreground uppercase tracking-wider">Grupo de Preço</th>
              <th className="text-left px-6 py-4 text-xs font-bold text-muted-foreground uppercase tracking-wider">Horário</th>
              <th className="text-left px-6 py-4 text-xs font-bold text-muted-foreground uppercase tracking-wider">Tipo</th>
              <th className="text-left px-6 py-4 text-xs font-bold text-muted-foreground uppercase tracking-wider">Faturamento</th>
              <th className="text-left px-6 py-4 text-xs font-bold text-muted-foreground uppercase tracking-wider">Status</th>
              <th className="text-left px-6 py-4 text-xs font-bold text-muted-foreground uppercase tracking-wider">Ações</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/30">
            {companies.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-6 py-16 text-center text-muted-foreground text-sm">
                  Nenhuma empresa encontrada.
                </td>
              </tr>
            ) : (
              companies.map(company => (
                <CompanyRow
                  key={company.id}
                  company={company}
                  priceGroupName={priceGroups.find((pg: any) => pg.id === company.priceGroupId)?.groupName}
                  onEdit={onEdit}
                />
              ))
            )}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-between px-6 py-4 border-t border-border/50">
          <p className="text-sm text-muted-foreground">
            {totalCount} {totalCount === 1 ? "empresa" : "empresas"}
          </p>
          <div className="flex items-center gap-2">
            <button
              onClick={() => onPageChange(page - 1)}
              disabled={page <= 1}
              className="p-2 rounded-lg border border-border text-muted-foreground hover:bg-muted transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span className="text-sm font-medium px-2">{page} / {totalPages}</span>
            <button
              onClick={() => onPageChange(page + 1)}
              disabled={page >= totalPages}
              className="p-2 rounded-lg border border-border text-muted-foreground hover:bg-muted transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
