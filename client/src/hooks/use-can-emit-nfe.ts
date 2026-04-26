import { useEffect, useRef, useState } from "react";
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
    // Cross-tab / cross-admin sync without sockets:
    //   - while blocked → re-check every 5s (lightweight, ~1 req per tab)
    //   - once allowed → stop polling (zero ongoing cost)
    //   - on tab focus → refetch immediately (catches changes made in another tab)
    refetchInterval: (q) => (q.state.data?.allowed ? false : 5000),
    refetchOnWindowFocus: true,
    staleTime: 3000,
  });

  const allowed = query.data?.allowed ?? null;

  // Detect blocked → allowed transitions so the UI can flash a confirmation
  // (button highlight + transient "✔ Liberado"). The flag auto-clears after
  // 1.2s so callers don't need timer plumbing.
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
    isLoading: query.isLoading,
    isError: query.isError,
    refetch: query.refetch,
    justUnlocked,
  };
}
