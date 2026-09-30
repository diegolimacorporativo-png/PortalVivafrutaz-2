import { Plus, FileSpreadsheet } from "lucide-react";

interface ProductsHeaderProps {
  onAddNew: () => void;
  onImport: () => void;
}

export function ProductsHeader({ onAddNew, onImport }: ProductsHeaderProps) {
  return (
    <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-8 gap-4">
      <div>
        <h1 className="text-3xl font-display font-bold text-foreground">Catálogo de Produtos</h1>
        <p className="text-muted-foreground mt-1">Gerencie frutas, unidades, preços e atributos.</p>
      </div>
      <div className="flex gap-2 flex-wrap">
        <button onClick={onImport} className="flex items-center gap-2 px-4 py-3 border-2 border-primary text-primary font-bold rounded-xl hover:bg-primary/5 transition-all">
          <FileSpreadsheet className="w-5 h-5" /> Importar planilha
        </button>
        <button
          data-testid="button-add-product"
          onClick={onAddNew}
          className="flex items-center gap-2 px-6 py-3 bg-primary text-primary-foreground font-bold rounded-xl shadow-lg shadow-primary/25 hover:shadow-xl hover:-translate-y-0.5 transition-all"
        >
          <Plus className="w-5 h-5" /> Novo Produto
        </button>
      </div>
    </div>
  );
}
