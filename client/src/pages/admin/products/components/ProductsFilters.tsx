import { Search, X } from "lucide-react";

interface ProductsFiltersProps {
  search: string;
  onSearch: (v: string) => void;
  filterCat: string;
  onFilterCat: (v: string) => void;
  filterStatus: string;
  onFilterStatus: (v: string) => void;
  onlyImportados: boolean;
  onToggleImportados: () => void;
  uniqueCategories: string[];
  total?: number;
}

export function ProductsFilters({
  search, onSearch, filterCat, onFilterCat, filterStatus, onFilterStatus,
  onlyImportados, onToggleImportados, uniqueCategories, total,
}: ProductsFiltersProps) {
  return (
    <div className="bg-card rounded-2xl border border-border/50 premium-shadow p-4 mb-6 flex flex-wrap gap-3 items-center">
      <div className="relative flex-1 min-w-[180px] max-w-xs">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <input
          value={search} onChange={e => onSearch(e.target.value)}
          placeholder="Buscar produto..."
          className="w-full pl-9 pr-4 py-2.5 rounded-xl border-2 border-border focus:border-primary outline-none text-sm"
        />
        {search && (
          <button onClick={() => onSearch("")} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
      <select value={filterCat} onChange={e => onFilterCat(e.target.value)}
        className="px-3 py-2.5 rounded-xl border-2 border-border text-sm focus:border-primary outline-none">
        <option value="ALL">Todas as categorias</option>
        {uniqueCategories.map(c => <option key={c} value={c}>{c}</option>)}
      </select>
      {(['ALL', 'ACTIVE', 'INACTIVE'] as const).map(s => (
        <button key={s} onClick={() => onFilterStatus(s)}
          className={`px-3 py-2 rounded-xl text-xs font-bold border-2 transition-all ${filterStatus === s ? 'bg-primary text-white border-primary' : 'border-border text-muted-foreground hover:border-primary/50'}`}>
          {s === 'ALL' ? 'Todos' : s === 'ACTIVE' ? 'Ativos' : 'Inativos'}
        </button>
      ))}
      <button
        type="button"
        onClick={onToggleImportados}
        data-testid="filter-only-importados"
        aria-pressed={onlyImportados}
        title="Mostrar apenas produtos com a flag de importado (ICMS 4%)"
        className={`px-3 py-2 rounded-xl text-xs font-bold border-2 transition-all ${onlyImportados ? 'bg-orange-100 text-orange-700 border-orange-300' : 'border-border text-muted-foreground hover:border-orange-300'}`}
      >
        Apenas importados
      </button>
      <span className="text-xs text-muted-foreground font-medium">
        {total != null ? `${total} produto${total !== 1 ? 's' : ''}` : ''}
      </span>
    </div>
  );
}
