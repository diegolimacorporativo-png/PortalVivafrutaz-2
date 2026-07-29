import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, buildUrl } from "@shared/routes";
import { z } from "zod";
import { useToast } from "@/hooks/use-toast";
import { normalizeList, normalizeOne } from "@/lib/normalizeResponse";
import { fetchWithAuth } from "@/lib/fetchWithAuth";

// ========== COMPANIES ==========
export function useCompanies() {
  return useQuery({
    queryKey: [api.companies.list.path],
    queryFn: async () => {
      const res = await fetchWithAuth(api.companies.list.path);
      if (!res.ok) throw new Error("Failed to fetch companies");
      const raw = await res.json();
      console.log("[COMPANIES_API]", raw);
      const normalized = normalizeList(raw);
      const parsed = api.companies.list.responses[200].parse(normalized);
      console.log("[COMPANIES_HOOK_RESULT]", parsed, Array.isArray(parsed), typeof parsed);
      return parsed;
    },
    staleTime: 30_000,
    refetchOnMount: "always",
  });
}

export interface CompaniesPaginationParams {
  page?: number;
  limit?: number;
  search?: string;
  status?: string;
  clientType?: string;
}

export type CompaniesPaginatedResponse = {
  data: any[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
};

export function useCompaniesPaginated(params: CompaniesPaginationParams = {}) {
  const { page = 1, limit = 25, search = "", status = "ALL", clientType = "ALL" } = params;
  return useQuery<CompaniesPaginatedResponse>({
    queryKey: [api.companies.list.path, "paginated", page, limit, search, status, clientType],
    queryFn: async () => {
      const qs = new URLSearchParams({ page: String(page), limit: String(limit) });
      if (search) qs.set("search", search);
      if (status && status !== "ALL") qs.set("status", status);
      if (clientType && clientType !== "ALL") qs.set("clientType", clientType);
      const res = await fetchWithAuth(`${api.companies.list.path}?${qs}`);
      if (!res.ok) throw new Error("Failed to fetch companies");
      const json = await res.json();
      return { ...json, data: normalizeList(json.data ?? json) };
    },
    staleTime: 30_000,
    placeholderData: (prev) => prev,
    refetchOnMount: "always",
    retry: 2,
  });
}

export function useCreateCompany() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: async (data: z.infer<typeof api.companies.create.input>) => {
      const res = await fetchWithAuth(api.companies.create.path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        let errorBody: any = null;
        try { errorBody = await res.json(); } catch { errorBody = null; }
        console.error("[CREATE_COMPANY_ERROR]", { status: res.status, errorBody });
        throw new Error(errorBody?.message || errorBody?.error?.message || "Erro ao criar empresa");
      }
      return api.companies.create.responses[201].parse(normalizeOne(await res.json()));
    },
    onSuccess: async (data) => {
      await queryClient.invalidateQueries({
        queryKey: [api.companies.list.path],
      });
      await queryClient.refetchQueries({
        queryKey: [api.companies.list.path],
      });

      // Toast is intentionally skipped here when temporaryPassword is present.
      // The companies page shows a dedicated modal with the credential to copy.
      if (!data.temporaryPassword) {
        toast({ title: "Empresa criada com sucesso!" });
      }
    },
    onError: (err) => {
      console.error("[CREATE_COMPANY_ON_ERROR]", { err, ts: Date.now() });
      toast({ title: "Erro ao criar empresa", variant: "destructive" });
    }
  });
}

export function useUpdateCompany() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: async ({ id, data }: { id: number; data: Partial<z.infer<typeof api.companies.update.input>> }) => {
      const url = buildUrl(api.companies.update.path, { id });
      const res = await fetchWithAuth(url, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error("Failed to update company");
      return api.companies.update.responses[200].parse(normalizeOne(await res.json()));
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [api.companies.list.path] });
      toast({ title: "Empresa atualizada com sucesso!" });
    },
    onError: () => {
      toast({ title: "Erro ao atualizar empresa", variant: "destructive" });
    }
  });
}

// ========== USERS (STAFF) ==========
export function useUsers() {
  return useQuery({
    queryKey: [api.users.list.path],
    queryFn: async () => {
      const res = await fetchWithAuth(api.users.list.path);
      if (!res.ok) throw new Error("Failed to fetch users");
      return api.users.list.responses[200].parse(await res.json());
    }
  });
}

// ========== PRICE GROUPS ==========
export function usePriceGroups() {
  return useQuery({
    queryKey: [api.priceGroups.list.path],
    queryFn: async () => {
      const res = await fetchWithAuth(api.priceGroups.list.path);
      if (!res.ok) throw new Error("Failed to fetch price groups");
      return api.priceGroups.list.responses[200].parse(await res.json());
    }
  });
}

export function useCreatePriceGroup() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: async (data: z.infer<typeof api.priceGroups.create.input>) => {
      const res = await fetchWithAuth(api.priceGroups.create.path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error("Failed to create price group");
      return api.priceGroups.create.responses[201].parse(await res.json());
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [api.priceGroups.list.path] });
      toast({ title: "Grupo de preço criado com sucesso!" });
    }
  });
}
