import { useState } from "react";
import { Modal } from "@/components/Modal";
import { XCircle } from "lucide-react";
import type { Order } from "../types";

interface CancelModalProps {
  order: Order;
  onClose: () => void;
  onConfirm: () => Promise<void>;
}

export function CancelModal({ order, onClose, onConfirm }: CancelModalProps) {
  const [confirming, setConfirming] = useState(false);

  return (
    <Modal isOpen onClose={onClose} title="Cancelar Pedido" maxWidth="max-w-md">
      <div className="space-y-4">
        <div className="p-4 bg-red-50 rounded-xl border border-red-200 text-center">
          <XCircle className="w-12 h-12 text-red-500 mx-auto mb-2" />
          <p className="font-bold text-red-800">Tem certeza que deseja cancelar este pedido?</p>
          <p className="text-sm text-red-700 mt-1">{order.orderCode || `#${order.id}`}</p>
        </div>
        <p className="text-sm text-muted-foreground text-center">
          O pedido ficará marcado como cancelado e não será incluído nos relatórios de compras.
        </p>
        <div className="flex gap-3">
          <button onClick={onClose} className="flex-1 py-3 border-2 border-border rounded-xl font-bold text-muted-foreground hover:bg-muted transition-colors">
            Manter Pedido
          </button>
          <button
            onClick={async () => { setConfirming(true); await onConfirm(); onClose(); }}
            disabled={confirming}
            className="flex-1 py-3 bg-red-600 text-white font-bold rounded-xl hover:bg-red-700 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
          >
            <XCircle className="w-4 h-4" /> {confirming ? "Cancelando..." : "Sim, Cancelar"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
