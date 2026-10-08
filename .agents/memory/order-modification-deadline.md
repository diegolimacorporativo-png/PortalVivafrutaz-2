---
name: Order modification deadline
description: VivaFrutaz operational cutoff for editing, reopening, and cancelling orders.
---

Um pedido pode ser solicitado para alteração, reaberto, editado ou cancelado somente até às 12:00 BRT do segundo dia útil anterior à entrega. Apenas sábado e domingo são ignorados. A decisão final e a auditoria devem ser feitas no backend; uma aprovação administrativa não pode liberar edição após o prazo.

**Why:** o usuário definiu este corte para proteger a operação logística e pediu que tentativas bloqueadas fossem auditadas.

**How to apply:** calcule o prazo dinamicamente a partir da data de entrega; valide antes de cada mutação relacionada e revalide na aprovação/edição. Não altere o fluxo de aprovação, histórico, notificações ou schema ao aplicar esta regra.
