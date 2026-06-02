import { AlertTriangle, CheckCircle } from "lucide-react";
import type { CategorySelection } from "../types";

interface ProductCategorySelectorProps {
  dbCategories: { id: number; name: string }[];
  selections: CategorySelection[];
  onChange: (sel: CategorySelection[]) => void;
}

export function ProductCategorySelector({ dbCategories, selections, onChange }: ProductCategorySelectorProps) {
  const toggle = (catName: string) => {
    const exists = selections.find(s => s.categoryName === catName);
    if (exists) {
      onChange(selections.filter(s => s.categoryName !== catName));
    } else {
      onChange([...selections, { categoryName: catName, price: '' }]);
    }
  };

  const setPrice = (catName: string, price: string) => {
    onChange(selections.map(s => s.categoryName === catName ? { ...s, price } : s));
  };

  if (dbCategories.length === 0) {
    return (
      <div className="p-4 rounded-xl border-2 border-dashed border-amber-300 bg-amber-50 text-center">
        <AlertTriangle className="w-5 h-5 text-amber-500 mx-auto mb-1" />
        <p className="text-xs font-bold text-amber-700">Nenhuma categoria cadastrada</p>
        <p className="text-xs text-amber-600 mt-0.5">
          Acesse a aba <strong>Categorias</strong> para criar categorias antes de adicionar produtos.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {dbCategories.map(cat => {
        const sel = selections.find(s => s.categoryName === cat.name);
        const isSelected = !!sel;
        return (
          <div
            key={cat.id}
            data-testid={`category-card-${cat.id}`}
            className={`rounded-xl border-2 transition-all ${isSelected ? 'border-primary bg-primary/5 dark:bg-primary/10' : 'border-border bg-card hover:border-primary/40'}`}
          >
            <div className="flex items-center gap-3 px-4 py-3">
              <button
                type="button"
                onClick={() => toggle(cat.name)}
                data-testid={`checkbox-category-${cat.id}`}
                className={`w-5 h-5 rounded border-2 flex items-center justify-center flex-shrink-0 transition-all ${isSelected ? 'bg-primary border-primary' : 'border-border bg-white dark:bg-slate-800'}`}
              >
                {isSelected && <CheckCircle className="w-3 h-3 text-white" />}
              </button>
              <span
                className={`flex-1 text-sm font-semibold cursor-pointer ${isSelected ? 'text-primary' : 'text-foreground'}`}
                onClick={() => toggle(cat.name)}
              >
                {cat.name}
              </span>
              {isSelected && (
                <div className="flex items-center gap-1.5" onClick={e => e.stopPropagation()}>
                  <span className="text-xs font-bold text-muted-foreground">R$</span>
                  <input
                    type="number" step="0.01" min="0"
                    value={sel?.price ?? ''}
                    onChange={e => setPrice(cat.name, e.target.value)}
                    data-testid={`input-price-category-${cat.id}`}
                    className={`w-28 px-2 py-1.5 rounded-lg border-2 outline-none text-sm font-bold text-right transition-colors ${
                      sel?.price && Number(sel.price) > 0
                        ? 'border-primary/40 focus:border-primary'
                        : 'border-red-300 focus:border-red-400 bg-red-50'
                    }`}
                    placeholder="0,00"
                  />
                </div>
              )}
            </div>
            {isSelected && (!sel?.price || Number(sel.price) <= 0) && (
              <div className="px-4 pb-2">
                <p className="text-xs text-red-600 flex items-center gap-1">
                  <AlertTriangle className="w-3 h-3" /> Informe o preço para esta categoria
                </p>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
