import { useState, useEffect } from "react";
import { useCompaniesPaginated, usePriceGroups } from "@/hooks/use-admin";
import { Layout } from "@/components/Layout";
import { Loader2 } from "lucide-react";
import type { Company } from "@shared/schema";

import { CompaniesHeader }  from "./components/CompaniesHeader";
import { CompaniesFilters } from "./components/CompaniesFilters";
import { CompaniesTable }   from "./components/CompaniesTable";
import { CompanyModal }     from "./dialogs/CompanyModal";
import { TempPasswordModal } from "./dialogs/TempPasswordModal";
import { BackHeader } from "@/components/navigation/BackHeader";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { normalizeError } from "@/lib/normalizeResponse";
import { useToast } from "@/hooks/use-toast";

export default function AdminCompanies() {
  const { toast } = useToast();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingCompany, setEditingCompany] = useState<Company | null>(null);
  const [tempPasswordModal, setTempPasswordModal] = useState<{
    companyName: string; email: string; password: string;
  } | null>(null);

  const [search, setSearch]             = useState("");
  const [filterStatus, setFilterStatus] = useState("ALL");
  const [filterType, setFilterType]     = useState("ALL");
  const [page, setPage]                 = useState(1);
  const [debouncedSearch, setDebouncedSearch] = useState("");

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 350);
    return () => clearTimeout(t);
  }, [search]);

  const { data: priceGroups = [] } = usePriceGroups();

  const { data: paginatedData, isLoading, refetch } = useCompaniesPaginated({
    search:     debouncedSearch,
    status:     filterStatus,
    clientType: filterType,
    page,
    limit:      20,
  });

  const companies:  Company[] = (paginatedData?.data ?? []) as Company[];
  const totalPages: number    = paginatedData?.totalPages ?? 1;
  const totalCount: number    = paginatedData?.total      ?? 0;

  function openCreate() {
    setEditingCompany(null);
    setIsModalOpen(true);
  }

  function openEdit(company: Company) {
    setEditingCompany(company);
    setIsModalOpen(true);
  }

  async function handlePermanentDelete(company: Company) {
    const confirmed = window.confirm(
      `Excluir permanentemente a empresa "${company.companyName}"?\n\nEsta ação também apaga pedidos, entregas, notas fiscais, usuários e demais registros vinculados encontrados. A operação é irreversível.`,
    );
    if (!confirmed) return;

    try {
      const response = await fetchWithAuth(`/api/companies/${company.id}/permanent`, { method: "DELETE" });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        const error = normalizeError(body);
        toast({ title: error.message || "Não foi possível excluir a empresa.", variant: "destructive" });
        return;
      }
      toast({ title: "Empresa excluída permanentemente." });
      await refetch();
    } catch {
      toast({ title: "Erro de conexão ao excluir a empresa.", variant: "destructive" });
    }
  }

  function closeModal() {
    setIsModalOpen(false);
    setEditingCompany(null);
  }

  function handleSuccess(result?: { companyName: string; email: string; password: string }) {
    if (result) setTempPasswordModal(result);
  }

  function clearFilters() {
    setSearch("");
    setFilterStatus("ALL");
    setFilterType("ALL");
    setPage(1);
  }

  return (
    <Layout>
      <BackHeader
        fallback="/admin"
        breadcrumb={[{ label: "Painel", href: "/admin" }, { label: "Gestão de Empresas" }]}
      />
      <div className="max-w-[1400px] mx-auto">
        <CompaniesHeader onAddCompany={openCreate} />

        <div className="bg-card rounded-2xl shadow-sm border border-border/50 overflow-hidden">
          <CompaniesFilters
            search={search}
            filterStatus={filterStatus}
            filterType={filterType}
            onSearch={v => { setSearch(v); setPage(1); }}
            onFilterStatus={v => { setFilterStatus(v); setPage(1); }}
            onFilterType={v => { setFilterType(v); setPage(1); }}
            onClear={clearFilters}
          />

          {isLoading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <CompaniesTable
              companies={companies}
              priceGroups={priceGroups}
              page={page}
              totalPages={totalPages}
              totalCount={totalCount}
              onEdit={openEdit}
              onDelete={handlePermanentDelete}
              onPageChange={setPage}
            />
          )}
        </div>
      </div>

      <CompanyModal
        isOpen={isModalOpen}
        editingCompany={editingCompany}
        onClose={closeModal}
        onSuccess={handleSuccess}
      />

      {tempPasswordModal && (
        <TempPasswordModal
          data={tempPasswordModal}
          onClose={() => setTempPasswordModal(null)}
        />
      )}
    </Layout>
  );
}
