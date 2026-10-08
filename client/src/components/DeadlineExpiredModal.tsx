import { Ban } from "lucide-react";
import { Modal } from "@/components/Modal";
import { ORDER_MODIFICATION_EXPIRED_MESSAGE } from "@shared/utils/orderDeadline";

interface DeadlineExpiredModalProps {
  onClose: () => void;
}

/**
 * Modal exibido quando o prazo para alteração / cancelamento / reabertura
 * de um pedido já expirou (now > deadline).
 *
 * Texto e botão conforme especificação operacional.
 * Compartilhado por order-history, create-order e edit-order.
 */
export function DeadlineExpiredModal({ onClose }: DeadlineExpiredModalProps) {
  return (
    <Modal isOpen onClose={onClose} title="Prazo para alteração expirado" maxWidth="max-w-md">
      <div className="space-y-4">
        <div className="flex items-start gap-3 p-4 bg-red-50 rounded-xl border border-red-200">
          <Ban className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
          <p className="text-sm text-red-700 whitespace-pre-line">
            {ORDER_MODIFICATION_EXPIRED_MESSAGE}
          </p>
        </div>
        <button
          onClick={onClose}
          className="w-full py-3 bg-primary text-white font-bold rounded-xl hover:bg-primary/90 transition-colors">
          Fechar
        </button>
      </div>
    </Modal>
  );
}
