import { useQuery } from "@tanstack/react-query";
import { fetchWithAuth } from "@/lib/fetchWithAuth";

interface SubCategory {
  id: number;
  categoryName: string;
  price: string;
}

interface SubCategorySelectorProps {
  productId: number;
  selectedSubCatId: number | null;
  onSelect: (subCat: SubCategory | null) => void;
}

export function SubCategorySelector({ productId, selectedSubCatId, onSelect }: SubCategorySelectorProps) {
  const { data: subCats = [] } = useQuery<SubCategory[]>({
    queryKey: ['/api/products', productId, 'sub-categories'],
    queryFn: async () => {
      const r = await fetchWithAuth(`/api/products/${productId}/sub-categories`);
      if (!r.ok) return [];
      return r.json();
    },
    staleTime: 60000,
  });

  if (subCats.length === 0) return null;

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <span className="text-xs text-muted-foreground font-medium">Categoria:</span>
      <button
        type="button"
        onClick={() => onSelect(null)}
        className={`text-xs px-2 py-1 rounded-lg border transition-all ${selectedSubCatId === null ? 'bg-muted border-border font-bold text-foreground' : 'border-border/50 text-muted-foreground hover:border-border'}`}
        data-testid={`subcategory-none-${productId}`}
      >
        Sem categoria
      </button>
      {subCats.map((sc) => (
        <button
          key={sc.id}
          type="button"
          onClick={() => onSelect(sc)}
          className={`text-xs px-2 py-1 rounded-lg border transition-all ${selectedSubCatId === sc.id ? 'bg-indigo-600 text-white border-indigo-600 font-bold' : 'border-indigo-200 text-indigo-700 hover:bg-indigo-50'}`}
          data-testid={`subcategory-${sc.id}-${productId}`}
        >
          {sc.categoryName} — R$ {Number(sc.price).toFixed(2)}
        </button>
      ))}
    </div>
  );
}
