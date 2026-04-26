import { useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";

export type LoteResult = {
  orderId: number;
  status: "success" | "blocked" | "error" | "skipped";
  reason?: string;
  nfe?: any;
};

export type LoteResponse = {
  summary: {
    total: number;
    success: number;
    blocked: number;
    errors: number;
    skipped: number;
  };
  results: LoteResult[];
};

export function useEmitirLoteNfe() {
  return useMutation({
    mutationFn: async (orderIds: number[]): Promise<LoteResponse> => {
      const res = await apiRequest("POST", "/api/nfe/emitir-lote", { orderIds });
      return res.json();
    },
  });
}
