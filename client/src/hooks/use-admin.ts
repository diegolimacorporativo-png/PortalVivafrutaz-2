import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, buildUrl } from "@shared/routes";
import { z } from "zod";
import { useToast } from "@/hooks/use-toast";

// ========== COMPANIES ==========
export function useCompanies() {
  return useQuery({
    queryKey: [api.companies.list.path],
    queryFn: async () => {
      const res = await fetch(api.companies.list.path, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch companies");
      return api.companies.list.responses[200].parse(await res.json());
    }
  });
}

export function useCreateCompany() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: async (data: z.infer<typeof api.companies.create.input>) => {
      const res = await fetch(api.companies.create.path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to create company");
      return api.companies.create.responses[201].parse(await res.json());
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [api.companies.list.path] });
      toast({ title: "Empresa criada com sucesso!" });
    },
    onError: () => {
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
      const res = await fetch(url, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to update company");
      return api.companies.update.responses[200].parse(await res.json());
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
      const res = await fetch(api.users.list.path, { credentials: "include" });
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
      const res = await fetch(api.priceGroups.list.path, { credentials: "include" });
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
      const res = await fetch(api.priceGroups.create.path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
        credentials: "include",
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
