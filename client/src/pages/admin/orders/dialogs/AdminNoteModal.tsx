import { useState } from "react";
import { Modal } from "@/components/Modal";
import { Save } from "lucide-react";
import type { Order } from "../types";

interface AdminNoteModalProps {
  order: Order;
  onClose: () => void;
  onSave: (note: string) => Promise<void>;
}

export function AdminNoteModal({ order, onClose, onSave }: AdminNoteModalProps) {
  const [note, setNote] = useState(order.adminNote || "");
  const [saving, setSaving] = useState(false);

  return (
    <Modal isOpen onClose={onClose} title="Observação Administrativa" maxWidth="max-w-lg">
      <div className="space-y-4">
        <div className="p-3 bg-primary/5 rounded-xl border border-primary/20">
          <p className="text-sm font-bold text-primary">Pedido {order.orderCode || `#${order.id}`}</p>
        </div>
        <textarea
          value={note}
          onChange={e => setNote(e.target.value)}
          rows={5}
          placeholder="Ex: Produto enviado errado, aplicado desconto de 10%, aguardando reposição..."
          className="w-full px-4 py-3 rounded-xl border-2 border-border focus:border-primary outline-none resize-none"
        />
        <div className="flex gap-3">
          <button onClick={onClose} className="flex-1 py-3 border-2 border-border rounded-xl font-bold text-muted-foreground hover:bg-muted transition-colors">
            Cancelar
          </button>
          <button
            onClick={async () => { setSaving(true); await onSave(note); onClose(); }}
            disabled={saving}
            className="flex-1 py-3 bg-primary text-white font-bold rounded-xl hover:-translate-y-0.5 transition-all disabled:opacity-50 flex items-center justify-center gap-2"
          >
            <Save className="w-4 h-4" /> {saving ? "Salvando..." : "Salvar Observação"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
