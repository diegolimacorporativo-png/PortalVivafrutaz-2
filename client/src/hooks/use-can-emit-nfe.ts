import { useQuery } from "@tanstack/react-query";

export type CanEmitNfeResponse = {
  orderId: number;
  allowed: boolean;
  reason?: string;
};

/**
 * Single source of truth on the frontend for "can this order emit NF?".
 *
 * Always defers to the backend guard (`GET /api/nfe/can-emit/:orderId`) — the
 * backend remains the authority. The hook just exposes the same answer to the
 * UI so we can disable buttons and show the blocking reason BEFORE the click.
 */
export function useCanEmitNfe(orderId: number | null | undefined) {
  const query = useQuery<CanEmitNfeResponse>({
    queryKey: ["/api/nfe/can-emit", orderId],
    queryFn: async () => {
      const res = await fetch(`/api/nfe/can-emit/${orderId}`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error("Erro ao validar emissão");
      return res.json();
    },
    enabled: !!orderId,
  });

  return {
    allowed: query.data?.allowed ?? null,
    reason: query.data?.reason ?? "",
    isLoading: query.isLoading,
    isError: query.isError,
  };
}
