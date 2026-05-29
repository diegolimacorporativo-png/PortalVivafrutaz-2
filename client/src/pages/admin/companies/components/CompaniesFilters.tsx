import { Search, X } from "lucide-react";

interface CompaniesFiltersProps {
  search: string;
  filterStatus: string;
  filterType: string;
  onSearch: (v: string) => void;
  onFilterStatus: (v: string) => void;
  onFilterType: (v: string) => void;
  onClear: () => void;
}

export function CompaniesFilters({
  search, filterStatus, filterType,
  onSearch, onFilterStatus, onFilterType, onClear,
}: CompaniesFiltersProps) {
  const hasFilters = search || filterStatus !== "ALL" || filterType !== "ALL";

  return (
    <div className="p-4 border-b border-border/50 bg-muted/20 flex flex-wrap gap-3 items-center">
      <div className="relative flex-1 min-w-[200px] max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <input
          data-testid="input-search-companies"
          value={search}
          onChange={e => onSearch(e.target.value)}
          placeholder="Pesquisar empresa, email ou contato..."
          className="w-full pl-9 pr-4 py-2.5 rounded-xl border-2 border-border focus:border-primary outline-none text-sm"
        />
        {search && (
          <button
            onClick={() => onSearch("")}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      <div className="flex gap-2">
        {(["ALL", "ACTIVE", "INACTIVE"] as const).map(s => (
          <button
            key={s}
            onClick={() => onFilterStatus(s)}
            className={`px-3 py-2 rounded-xl text-xs font-bold border-2 transition-all ${
              filterStatus === s
                ? "bg-primary text-white border-primary"
                : "border-border text-muted-foreground hover:border-primary/50"
            }`}
          >
            {s === "ALL" ? "Todos" : s === "ACTIVE" ? "Ativas" : "Inativas"}
          </button>
        ))}
      </div>

      <div className="flex gap-2">
        {(["ALL", "semanal", "mensal", "pontual"] as const).map(t => (
          <button
            key={t}
            onClick={() => onFilterType(t)}
            className={`px-3 py-2 rounded-xl text-xs font-bold border-2 transition-all ${
              filterType === t
                ? "bg-secondary text-white border-secondary"
                : "border-border text-muted-foreground hover:border-secondary/50"
            }`}
          >
            {t === "ALL" ? "Tipo: Todos" : t.charAt(0).toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>

      {hasFilters && (
        <button
          onClick={onClear}
          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground font-medium"
        >
          <X className="w-3 h-3" /> Limpar
        </button>
      )}
    </div>
  );
}
