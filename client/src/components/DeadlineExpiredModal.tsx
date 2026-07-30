import { Ban } from "lucide-react";
import { Modal } from "@/components/Modal";

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
    <Modal isOpen onClose={onClose} title="Prazo para alteração encerrado" maxWidth="max-w-md">
      <div className="space-y-4">
        <div className="flex items-start gap-3 p-4 bg-red-50 rounded-xl border border-red-200">
          <Ban className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
          <p className="text-sm text-red-700">
            O prazo para solicitar alterações ou cancelamentos deste pedido foi encerrado.
            <br /><br />
            Para garantir nossa programação logística e produção, alterações são permitidas
            somente até às 12h00 do segundo dia útil anterior à data de entrega.
            <br /><br />
            Caso necessite de atendimento excepcional, entre em contato com nossa equipe comercial.
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
