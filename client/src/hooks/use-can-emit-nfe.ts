import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchWithAuth } from "@/lib/fetchWithAuth";

export type FaturamentoContext = {
  tipo: "imediato" | "semanal" | "mensal" | "contratual" | "pontual";
  prazoDias: number;
  podeEmitir: boolean;
  motivo: string;
  label: string;
};

export type CanEmitNfeResponse = {
  orderId: number;
  allowed: boolean;
  reason?: string;
  faturamento?: FaturamentoContext;
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
      const res = await fetchWithAuth(`/api/nfe/can-emit/${orderId}`);
      if (!res.ok) throw new Error("Erro ao validar emissão");
      return res.json();
    },
    enabled: !!orderId,
    refetchInterval: (q) => (q.state.data?.allowed ? false : 5000),
    refetchOnWindowFocus: true,
    staleTime: 3000,
  });

  const allowed = query.data?.allowed ?? null;

  const wasBlockedRef = useRef(false);
  const [justUnlocked, setJustUnlocked] = useState(false);

  useEffect(() => {
    if (allowed === false) {
      wasBlockedRef.current = true;
      return;
    }
    if (allowed === true && wasBlockedRef.current) {
      wasBlockedRef.current = false;
      setJustUnlocked(true);
      const t = setTimeout(() => setJustUnlocked(false), 1200);
      return () => clearTimeout(t);
    }
  }, [allowed]);

  return {
    allowed,
    reason: query.data?.reason ?? "",
    faturamento: query.data?.faturamento,
    isLoading: query.isLoading,
    isError: query.isError,
    refetch: query.refetch,
    justUnlocked,
  };
}
