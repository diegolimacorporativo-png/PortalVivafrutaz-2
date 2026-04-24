import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, buildUrl } from "@shared/routes";
import { z } from "zod";
import { useToast } from "@/hooks/use-toast";

// ========== PRODUCTS ==========
export function useProducts() {
  return useQuery({
    queryKey: [api.products.list.path],
    queryFn: async () => {
      const res = await fetch(api.products.list.path, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch products");
      return api.products.list.responses[200].parse(await res.json());
    }
  });
}

export function useCreateProduct() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: async (data: z.infer<typeof api.products.create.input>) => {
      const res = await fetch(api.products.create.path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to create product");
      return api.products.create.responses[201].parse(await res.json());
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [api.products.list.path] });
      toast({ title: "Produto criado com sucesso!" });
    }
  });
}

export function useUpdateProduct() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: async ({ id, data }: { id: number; data: Partial<z.infer<typeof api.products.update.input>> }) => {
      const url = buildUrl(api.products.update.path, { id });
      const res = await fetch(url, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to update product");
      return api.products.update.responses[200].parse(await res.json());
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [api.products.list.path] });
      toast({ title: "Produto atualizado com sucesso!" });
    },
    onError: () => {
      toast({ title: "Erro ao atualizar produto", variant: "destructive" });
    }
  });
}

// ========== PRODUCT PRICES ==========
export function useProductPrices() {
  return useQuery({
    queryKey: [api.productPrices.list.path],
    queryFn: async () => {
      const res = await fetch(api.productPrices.list.path, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch product prices");
      return api.productPrices.list.responses[200].parse(await res.json());
    }
  });
}

export function useUpdateProductPrice() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: async (data: { id?: number; productId: number; priceGroupId: number; price: string | number }) => {
      const payload = { ...data, price: z.coerce.number().parse(data.price) };
      
      if (data.id) {
        const url = buildUrl(api.productPrices.update.path, { id: data.id });
        const res = await fetch(url, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
          credentials: "include",
        });
        if (!res.ok) throw new Error("Failed to update price");
        return api.productPrices.update.responses[200].parse(await res.json());
      } else {
        const res = await fetch(api.productPrices.create.path, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
          credentials: "include",
        });
        if (!res.ok) throw new Error("Failed to create price");
        return api.productPrices.create.responses[201].parse(await res.json());
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [api.productPrices.list.path] });
    }
  });
}
