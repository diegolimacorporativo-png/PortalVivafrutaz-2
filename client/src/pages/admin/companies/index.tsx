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

export default function AdminCompanies() {
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

  const { data: paginatedData, isLoading } = useCompaniesPaginated({
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
