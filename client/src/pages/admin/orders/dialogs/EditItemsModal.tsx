import { useState } from "react";
import { Modal } from "@/components/Modal";
import { AlertTriangle, Save, Trash2, Tag } from "lucide-react";
import { useOrderDetail } from "@/hooks/use-ordering";
import { SubCategorySelector } from "../components/SubCategorySelector";
import type { Order, EditItem } from "../types";

interface EditItemsModalProps {
  order: Order;
  products: any[];
  onClose: () => void;
  onSave: (items: any[]) => Promise<void>;
}

export function EditItemsModal({ order, products, onClose, onSave }: EditItemsModalProps) {
  const { data: detail } = useOrderDetail(order.id);
  const [editItems, setEditItems] = useState<EditItem[]>([]);
  const [initialized, setInitialized] = useState(false);
  const [saving, setSaving] = useState(false);

  if (detail && !initialized) {
    setEditItems((detail.items || []).map((i: any) => ({
      productId: i.productId,
      quantity: i.quantity,
      unitPrice: Number(i.unitPrice),
      subCategoryId: i.subCategoryId ?? null,
      subCategoryName: i.subCategoryName ?? null,
    })));
    setInitialized(true);
  }

  const total = editItems.reduce((s, i) => s + (i.quantity * i.unitPrice), 0);

  const handleQtyChange = (idx: number, qty: number) => {
    setEditItems(prev => prev.map((item, i) => i === idx ? { ...item, quantity: Math.max(0, qty) } : item));
  };

  const handlePriceChange = (idx: number, price: number) => {
    setEditItems(prev => prev.map((item, i) => i === idx ? { ...item, unitPrice: price } : item));
  };

  const handleRemove = (idx: number) => {
    setEditItems(prev => prev.filter((_, i) => i !== idx));
  };

  const handleSave = async () => {
    setSaving(true);
    const items = editItems
      .filter(i => i.quantity > 0)
      .map(i => ({
        productId: i.productId,
        quantity: i.quantity,
        unitPrice: String(i.unitPrice),
        totalPrice: String(i.quantity * i.unitPrice),
        subCategoryId: i.subCategoryId,
        subCategoryName: i.subCategoryName,
      }));
    await onSave(items);
    onClose();
  };

  return (
    <Modal isOpen onClose={onClose} title="Editar Itens do Pedido" maxWidth="max-w-2xl">
      <div className="space-y-4">
        <div className="p-3 bg-orange-50 border border-orange-200 rounded-xl flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 text-orange-600 flex-shrink-0 mt-0.5" />
          <p className="text-sm text-orange-800 font-medium">
            Alterações afetam quantidades e o total do pedido. Use para correções administrativas.
          </p>
        </div>

        {!initialized ? (
          <p className="text-center text-muted-foreground py-4">Carregando itens...</p>
        ) : (
          <div className="space-y-2">
            {editItems.map((item, idx) => {
              const product = products.find(p => p.id === Number(item.productId));
              return (
                <div key={idx} className="p-3 bg-muted/20 rounded-xl border border-border/50 space-y-2">
                  <div className="flex items-center gap-3">
                    <div className="flex-1">
                      <p className="font-bold text-sm text-foreground">{product?.name || `Produto #${item.productId}`}</p>
                      {item.subCategoryName && (
                        <span className="inline-flex items-center gap-1 text-xs bg-indigo-100 text-indigo-700 px-2 py-0.5 rounded-full font-bold mt-0.5">
                          <Tag className="w-2.5 h-2.5" /> {item.subCategoryName}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <input
                        type="number" min="0"
                        value={item.quantity}
                        onChange={e => handleQtyChange(idx, parseInt(e.target.value) || 0)}
                        className="w-20 text-center px-2 py-1.5 border-2 border-border rounded-lg font-bold outline-none focus:border-primary"
                        data-testid={`input-qty-item-${idx}`}
                      />
                      <span className="text-sm text-muted-foreground">{product?.unit}</span>
                      <div className="relative">
                        <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">R$</span>
                        <input
                          type="number" step="0.01" min="0"
                          value={item.unitPrice}
                          onChange={e => handlePriceChange(idx, parseFloat(e.target.value) || 0)}
                          className="w-24 pl-7 pr-2 py-1.5 border-2 border-border rounded-lg font-bold outline-none focus:border-primary text-sm"
                          data-testid={`input-price-item-${idx}`}
                        />
                      </div>
                      <p className="text-sm font-bold text-primary w-24 text-right">
                        R$ {(item.quantity * item.unitPrice).toFixed(2)}
                      </p>
                      <button onClick={() => handleRemove(idx)} className="p-1.5 text-muted-foreground hover:text-red-500 transition-colors">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                  <SubCategorySelector
                    productId={item.productId}
                    selectedSubCatId={item.subCategoryId}
                    onSelect={(subCat) => {
                      setEditItems(prev => prev.map((it, i) => i === idx ? {
                        ...it,
                        subCategoryId: subCat?.id ?? null,
                        subCategoryName: subCat?.categoryName ?? null,
                        unitPrice: subCat ? Number(subCat.price) : it.unitPrice,
                      } : it));
                    }}
                  />
                </div>
              );
            })}
          </div>
        )}

        <div className="border-t border-border pt-4 flex justify-between items-center">
          <div>
            <p className="text-sm text-muted-foreground">Novo Total</p>
            <p className="text-2xl font-display font-bold text-primary">R$ {total.toFixed(2)}</p>
          </div>
          <div className="flex gap-3">
            <button onClick={onClose} className="px-5 py-2.5 border-2 border-border rounded-xl font-bold text-muted-foreground hover:bg-muted transition-colors">
              Cancelar
            </button>
            <button
              onClick={handleSave}
              disabled={saving || !initialized}
              className="px-5 py-2.5 bg-primary text-white font-bold rounded-xl hover:-translate-y-0.5 transition-all disabled:opacity-50 flex items-center gap-2"
            >
              <Save className="w-4 h-4" /> {saving ? "Salvando..." : "Confirmar Alterações"}
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
