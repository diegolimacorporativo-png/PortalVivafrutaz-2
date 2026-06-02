import { Edit2, Package, DollarSign, Factory, Snowflake, Leaf, Layers, Tag } from "lucide-react";
import type { Product } from "@shared/schema";
import { resolvePrice, formatPriceOrDash, priceSource } from "@/utils/priceResolver";

interface ProductCardProps {
  product: Product;
  onEdit: (product: Product) => void;
}

export function ProductCard({ product, onEdit }: ProductCardProps) {
  const productPricingMode = (product as any).pricingMode as "base" | "category" | undefined;
  const resolved = resolvePrice({
    basePrice: product.basePrice,
    subCategoryPrice: (product as any).subCategoryPrice,
    contractPrice: (product as any).contractPrice,
    useNewPricing: false,
    pricingMode: productPricingMode,
  });
  const source = priceSource({
    basePrice: product.basePrice,
    subCategoryPrice: (product as any).subCategoryPrice,
    contractPrice: (product as any).contractPrice,
  });
  const sourceLabel = source === "contract" ? "contrato" : source === "subcategory" ? "categoria" : "base";

  return (
    <div className="bg-card rounded-2xl p-6 border border-border/50 premium-shadow flex flex-col items-center text-center group relative">
      <button
        data-testid={`button-edit-product-${product.id}`}
        onClick={() => onEdit(product)}
        className="absolute top-3 right-3 p-2 rounded-lg text-muted-foreground hover:bg-primary/10 hover:text-primary transition-colors opacity-0 group-hover:opacity-100"
      >
        <Edit2 className="w-4 h-4" />
      </button>

      <div className="absolute top-3 left-3 flex flex-col gap-1">
        {(product as any).isIndustrialized && (
          <span className="flex items-center gap-0.5 px-1.5 py-0.5 bg-orange-100 text-orange-700 rounded-md text-xs font-bold">
            <Factory className="w-3 h-3" /> Ind.
          </span>
        )}
        {(product as any).isSeasonal && (
          <span className="flex items-center gap-0.5 px-1.5 py-0.5 bg-blue-100 text-blue-700 rounded-md text-xs font-bold">
            <Snowflake className="w-3 h-3" /> Saz.
          </span>
        )}
        {(product as any).outOfSeason && (
          <span className="flex items-center gap-0.5 px-1.5 py-0.5 bg-red-100 text-red-700 rounded-md text-xs font-bold">
            <Leaf className="w-3 h-3" /> Fora de safra
          </span>
        )}
      </div>

      {(product as any).imageUrl ? (
        <div className="w-20 h-20 rounded-2xl overflow-hidden mb-4 border-2 border-border bg-white">
          <img
            src={(product as any).imageUrl}
            alt={product.name}
            onError={(e) => {
              const img = e.currentTarget;
              img.style.display = "none";
              const parent = img.parentElement;
              if (parent && !parent.querySelector(".img-fallback")) {
                const fallback = document.createElement("div");
                fallback.className = "img-fallback w-full h-full flex items-center justify-center bg-muted";
                fallback.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="text-muted-foreground"><path d="m7.5 4.27 9 5.15"/><path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/><path d="m3.3 7 8.7 5 8.7-5"/><path d="M12 22V12"/></svg>';
                parent.appendChild(fallback);
              }
            }}
            className="w-full h-full object-cover"
            data-testid={`img-product-${product.id}`}
          />
        </div>
      ) : (
        <div className={`w-16 h-16 rounded-full flex items-center justify-center mb-4 ${product.active ? 'bg-secondary/10' : 'bg-muted'}`}>
          <Package className={`w-8 h-8 ${product.active ? 'text-secondary' : 'text-muted-foreground'}`} />
        </div>
      )}

      {(product as any).productCode && (
        <span className="mb-1 text-xs bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 px-2 py-0.5 rounded-md font-mono font-bold">
          #{(product as any).productCode}
        </span>
      )}

      <div className="flex items-center justify-center gap-2 flex-wrap">
        <h3 className="text-lg font-bold text-foreground">{product.name}</h3>
        {(product as any).importado === true && (
          <span
            data-testid={`badge-product-importado-${product.id}`}
            className="inline-flex items-center rounded-md bg-orange-100 px-2 py-0.5 text-xs font-semibold text-orange-700"
            title="Produto importado — ICMS calculado a 4%"
          >
            Importado
          </span>
        )}
      </div>
      <p className="text-sm font-semibold text-muted-foreground uppercase tracking-widest mt-1">{product.category}</p>

      {(product as any).observation && (
        <p className="text-xs text-muted-foreground mt-1.5 italic line-clamp-2">{(product as any).observation}</p>
      )}

      <div className="mt-3 inline-block px-3 py-1 bg-muted rounded-lg text-sm font-bold text-foreground">
        Por {product.unit}
      </div>

      {(product as any).availableDays && Array.isArray((product as any).availableDays) && (product as any).availableDays.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1 justify-center">
          {((product as any).availableDays as string[]).map(d => (
            <span key={d} className="px-1.5 py-0.5 bg-primary/10 text-primary text-xs font-medium rounded">
              {d.split('-')[0].slice(0, 3)}
            </span>
          ))}
        </div>
      )}

      {product.basePrice == null && resolved === 0 ? (
        <div className="mt-3 px-4 py-2 bg-orange-50 rounded-xl border border-orange-200" data-testid={`price-missing-${product.id}`}>
          <p className="text-xs font-bold text-orange-600">Preço base não definido</p>
        </div>
      ) : (
        <div className="mt-3 flex flex-col items-center gap-1.5">
          <div className="flex items-center gap-1.5 px-4 py-2 bg-primary/10 rounded-xl">
            <DollarSign className="w-4 h-4 text-primary" />
            <span className="text-sm font-bold text-primary" data-testid={`text-price-${product.id}`}>
              {formatPriceOrDash(resolved)}{" "}
              <span className="font-normal text-primary/70">({sourceLabel})</span>
            </span>
          </div>
          <div className="flex flex-wrap gap-1 justify-center">
            {(product as any).subCategoryPrice != null && (
              <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-blue-100 text-blue-700" data-testid={`badge-subcategory-${product.id}`}>
                Categoria
              </span>
            )}
            {(product as any).contractPrice != null && (
              <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-purple-100 text-purple-700" data-testid={`badge-contract-${product.id}`}>
                Contrato
              </span>
            )}
          </div>
        </div>
      )}

      <div className="flex flex-wrap gap-1.5 justify-center mt-3">
        <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${product.active ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
          {product.active ? 'Ativo' : 'Inativo'}
        </span>
        {(product as any).categoryAvailability === 'specific' && (
          <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-teal-100 text-teal-700 flex items-center gap-0.5">
            <Tag className="w-2.5 h-2.5" /> Cats. restritas
          </span>
        )}
      </div>
    </div>
  );
}
