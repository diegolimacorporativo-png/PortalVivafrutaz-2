import { useState, useMemo, useEffect } from "react";
import { useProducts, useProductsPaginated } from "@/hooks/use-catalog";
import { PaginationBar } from "@/components/ui/PaginationBar";
import { Layout } from "@/components/Layout";
import type { Product } from "@shared/schema";
import { useCategories } from "./hooks/useCategories";
import { ProductsHeader } from "./components/ProductsHeader";
import { ProductsFilters } from "./components/ProductsFilters";
import { PriceAlertsSection } from "./components/PriceAlertsSection";
import { SafraAlertsSection } from "./components/SafraAlertsSection";
import { ProductCard } from "./components/ProductCard";
import { ProductModal } from "./dialogs/ProductModal";
import { BackHeader } from "@/components/navigation/BackHeader";

export default function ProductsPage() {
  const { data: products } = useProducts();

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);

  const [search, setSearch] = useState("");
  const [filterCat, setFilterCat] = useState("ALL");
  const [filterStatus, setFilterStatus] = useState("ALL");
  const [onlyImportados, setOnlyImportados] = useState(false);
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(50);
  const [debouncedSearch, setDebouncedSearch] = useState("");

  useEffect(() => {
    const t = setTimeout(() => { setDebouncedSearch(search); setPage(1); }, 350);
    return () => clearTimeout(t);
  }, [search]);

  useEffect(() => { setPage(1); }, [filterCat, filterStatus, onlyImportados]);

  const { data: paginatedProducts, isLoading } = useProductsPaginated({
    page, limit, search: debouncedSearch, category: filterCat, status: filterStatus, onlyImportados,
  });

  const { data: categories = [] } = useCategories();
  const uniqueCategories = useMemo(() =>
    (categories as any[]).map(c => c.name).sort()
  , [categories]);

  const filtered = paginatedProducts?.data ?? [];

  const openCreate = () => { setEditingProduct(null); setIsModalOpen(true); };
  const openEdit = (product: Product) => { setEditingProduct(product); setIsModalOpen(true); };
  const closeModal = () => { setIsModalOpen(false); setEditingProduct(null); };

  return (
    <Layout>
      <BackHeader
        fallback="/admin"
        breadcrumb={[{ label: "Painel", href: "/admin" }, { label: "Produtos" }]}
      />
      <ProductsHeader onAddNew={openCreate} />

      <PriceAlertsSection />
      {products && <SafraAlertsSection allProducts={products as any[]} />}

      <ProductsFilters
        search={search}
        onSearch={setSearch}
        filterCat={filterCat}
        onFilterCat={setFilterCat}
        filterStatus={filterStatus}
        onFilterStatus={setFilterStatus}
        onlyImportados={onlyImportados}
        onToggleImportados={() => setOnlyImportados(v => !v)}
        uniqueCategories={uniqueCategories}
        total={paginatedProducts?.total}
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
        {isLoading ? (
          <div className="col-span-full p-8 text-center text-muted-foreground">Carregando produtos...</div>
        ) : filtered.length === 0 ? (
          <div className="col-span-full p-8 text-center text-muted-foreground">Nenhum produto encontrado.</div>
        ) : filtered.map(product => (
          <ProductCard key={product.id} product={product} onEdit={openEdit} />
        ))}
      </div>

      {paginatedProducts && (
        <div className="mt-6">
          <PaginationBar
            page={page}
            totalPages={paginatedProducts.totalPages}
            total={paginatedProducts.total}
            limit={limit}
            onPageChange={setPage}
            onLimitChange={(l) => { setLimit(l); setPage(1); }}
          />
        </div>
      )}

      <ProductModal
        isOpen={isModalOpen}
        editingProduct={editingProduct}
        onClose={closeModal}
        onSaved={closeModal}
      />
    </Layout>
  );
}
