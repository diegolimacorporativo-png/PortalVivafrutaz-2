import { Building2, Mail, Phone, Hash, Clock, CheckCircle, XCircle, Edit2 } from "lucide-react";
import { getBillingLabel, getBillingFormatLabel } from "../constants";
import type { Company } from "@shared/schema";

interface CompanyRowProps {
  company: Company;
  priceGroupName: string | undefined;
  onEdit: (company: Company) => void;
}

export function CompanyRow({ company, priceGroupName, onEdit }: CompanyRowProps) {
  const deliveryRange = (() => {
    try {
      const cfg =
        typeof (company as any).deliveryConfigJson === "string"
          ? JSON.parse((company as any).deliveryConfigJson)
          : (company as any).deliveryConfigJson;
      if (!cfg) return null;
      const enabled = Object.values(cfg as Record<string, any>).filter((d: any) => d.enabled);
      if (enabled.length === 0) return null;
      const starts = enabled.map((d: any) => d.startTime).filter(Boolean).sort();
      const ends = enabled.map((d: any) => d.endTime).filter(Boolean).sort();
      const minStart = starts[0];
      const maxEnd = ends[ends.length - 1];
      if (!minStart || !maxEnd) return null;
      return `${minStart} – ${maxEnd}`;
    } catch {
      return null;
    }
  })();

  const clientTypeBadge =
    company.clientType === "pontual" ? "bg-orange-100 text-orange-700" :
    company.clientType === "semanal" ? "bg-green-100 text-green-700" :
    company.clientType === "contratual" ? "bg-purple-100 text-purple-700" :
    "bg-blue-100 text-blue-700";

  const clientTypeLabel =
    company.clientType === "pontual" ? "Pontual" :
    company.clientType === "semanal" ? "Semanal" :
    company.clientType === "contratual" ? "Contratual" : "Mensal";

  return (
    <tr className="hover:bg-muted/10 transition-colors">
      <td className="px-6 py-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-primary/10 text-primary flex items-center justify-center flex-shrink-0">
            <Building2 className="w-5 h-5" />
          </div>
          <div>
            <p className="font-bold text-foreground">{company.companyName}</p>
            <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
              <Mail className="w-3 h-3" /> {company.email}
            </p>
            {company.phone && (
              <p className="text-xs text-muted-foreground flex items-center gap-1">
                <Phone className="w-3 h-3" /> {company.phone}
              </p>
            )}
          </div>
        </div>
      </td>
      <td className="px-6 py-4 font-medium text-foreground">{company.contactName}</td>
      <td className="px-6 py-4">
        {company.priceGroupId ? (
          <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full bg-secondary/10 text-secondary text-xs font-bold">
            <Hash className="w-3 h-3" />
            {priceGroupName || "Nenhum"}
          </span>
        ) : (
          <span className="text-muted-foreground text-sm">—</span>
        )}
      </td>
      <td className="px-6 py-4">
        {deliveryRange ? (
          <span className="flex items-center gap-1 text-sm font-bold text-foreground">
            <Clock className="w-4 h-4 text-primary" /> {deliveryRange}
          </span>
        ) : (
          <span className="text-muted-foreground text-sm">—</span>
        )}
      </td>
      <td className="px-6 py-4">
        <span className={`px-2 py-0.5 rounded-lg text-xs font-bold ${clientTypeBadge}`}>
          {clientTypeLabel}
        </span>
      </td>
      <td className="px-6 py-4">
        {company.billingType ? (
          <div className="text-sm">
            <p className="font-semibold text-foreground">{getBillingLabel(company.billingType)}</p>
            <p className="text-muted-foreground text-xs">{getBillingFormatLabel(company.billingFormat)}</p>
          </div>
        ) : (
          <span className="text-muted-foreground text-sm">—</span>
        )}
      </td>
      <td className="px-6 py-4">
        <span
          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold ${
            company.active ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"
          }`}
        >
          {company.active ? (
            <><CheckCircle className="w-3 h-3" /> Ativo</>
          ) : (
            <><XCircle className="w-3 h-3" /> Inativo</>
          )}
        </span>
      </td>
      <td className="px-6 py-4">
        <button
          data-testid={`button-edit-${company.id}`}
          onClick={() => onEdit(company)}
          className="p-2 rounded-lg text-muted-foreground hover:bg-primary/10 hover:text-primary transition-colors"
        >
          <Edit2 className="w-4 h-4" />
        </button>
      </td>
    </tr>
  );
}
