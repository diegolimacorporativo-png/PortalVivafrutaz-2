import { useMutation } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";

const FORCE_RELEASE_ROLES = new Set(["ADMIN", "MASTER", "DIRECTOR"]);

/**
 * STEP 9.2Y.7 — admin-only quick action to flip an order to `nota_liberada`
 * straight from the blocked badge in the UI.
 *
 * Reuses the existing `PATCH /api/orders/:id/fiscal` endpoint (canonical path
 * for fiscal-status changes; already exercised by `handleUpdateFiscal`) and
 * appends `?force=1` so the controller emits an `[ORDER_FORCE_RELEASE]` audit
 * line distinguishing this override from normal fiscal updates.
 *
 * On success the can-emit cache is invalidated, which trips the existing
 * blocked → allowed transition in `useCanEmitNfe` — so the button auto-unlocks
 * AND the green pulse + "Liberado" badge fire without any extra plumbing.
 *
 * Permission gating happens both here (UI hides the button for non-privileged
 * roles) and in the backend service (which remains the authority).
 */
export function useForceReleaseNfe(orderId: number | null | undefined) {
  const { role } = useAuth();
  const { toast } = useToast();

  const canForceRelease =
    !!role && FORCE_RELEASE_ROLES.has(String(role).toUpperCase());

  const mutation = useMutation({
    mutationFn: async () => {
      if (!orderId) throw new Error("orderId ausente");
      return apiRequest(
        "PATCH",
        `/api/orders/${orderId}/fiscal?force=1`,
        { fiscalStatus: "nota_liberada" },
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/nfe/can-emit", orderId] });
      queryClient.invalidateQueries({ queryKey: ["/api/orders"] });
      toast({
        title: "Pedido liberado",
        description: "Agora é possível emitir a NF-e.",
      });
    },
    onError: (e: any) => {
      toast({
        title: "Falha ao liberar",
        description: e?.message || "Não foi possível alterar o status fiscal.",
        variant: "destructive",
      });
    },
  });

  return {
    canForceRelease,
    forceRelease: () => mutation.mutate(),
    isPending: mutation.isPending,
  };
}
