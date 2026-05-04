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
      console.log("[COMPANY_LIST_FETCH]", { queryKey: api.companies.list.path, ts: Date.now() });
      const res = await fetchWithAuth(api.companies.list.path);
      if (!res.ok) throw new Error("Failed to fetch companies");
      const data = api.companies.list.responses[200].parse(normalizeList(await res.json()));
      console.log("[COMPANY_LIST_RESULT]", { count: data.length, ts: Date.now() });
      return data;
    },
    staleTime: 0,
    refetchOnMount: "always",
  });
}

export function useCreateCompany() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: async (data: z.infer<typeof api.companies.create.input>) => {
      console.log("[CREATE_COMPANY_TRIGGER]", { ts: Date.now() });
      const res = await fetchWithAuth(api.companies.create.path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        let errorBody: any = null;
        try { errorBody = await res.json(); } catch { errorBody = null; }
        console.error("[CREATE_COMPANY_ERROR]", { status: res.status, errorBody });
        throw new Error(errorBody?.message || errorBody?.error || "Erro ao criar empresa");
      }
      const result = api.companies.create.responses[201].parse(normalizeOne(await res.json()));
      console.log("[CREATE_COMPANY_MUTFN_DONE]", { result, ts: Date.now() });
      return result;
    },
    onSuccess: async (data) => {
      console.log("[CREATE_COMPANY_SUCCESS]", data);

      await queryClient.invalidateQueries({
        queryKey: [api.companies.list.path],
      });
      console.log("[INVALIDATED]");

      await queryClient.refetchQueries({
        queryKey: [api.companies.list.path],
      });
      console.log("[REFETCHED]");

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
