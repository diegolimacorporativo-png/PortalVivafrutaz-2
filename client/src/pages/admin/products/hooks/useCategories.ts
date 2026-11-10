import { useQuery } from "@tanstack/react-query";
import { fetchWithAuth } from "@/lib/fetchWithAuth";

export function useCategories() {
  return useQuery({
    queryKey: ['/api/categories'],
    queryFn: async () => {
      const res = await fetchWithAuth('/api/categories');
      if (!res.ok) throw new Error("Não foi possível carregar as categorias.");
      const payload: unknown = await res.json();
      if (Array.isArray(payload)) return payload as { id: number; name: string }[];
      if (payload && typeof payload === "object" && Array.isArray((payload as { data?: unknown }).data)) {
        return (payload as { data: { id: number; name: string }[] }).data;
      }
      return [];
    },
  });
}
