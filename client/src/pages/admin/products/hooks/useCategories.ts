import { useQuery } from "@tanstack/react-query";
import { fetchWithAuth } from "@/lib/fetchWithAuth";

export function useCategories() {
  return useQuery({
    queryKey: ['/api/categories'],
    queryFn: async () => {
      const res = await fetchWithAuth('/api/categories');
      return res.json() as Promise<{ id: number; name: string }[]>;
    },
  });
}
