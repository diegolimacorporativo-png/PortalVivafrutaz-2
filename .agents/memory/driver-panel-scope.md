---
name: Driver panel tenant scope
description: Regras duráveis para manter a consulta do painel do motorista segura entre deliveries e orders.
---

O endpoint do painel deve aplicar o tenant do usuário antes de consultar deliveries, orders, empresas e qualquer ponte de pedidos; o filtro de empresa não pode ampliar esse escopo.

**Why:** A busca por pedido/cliente reutiliza um payload autorizado e une pedidos CONFIRMED sem delivery, então cada ramo precisa herdar exatamente a mesma restrição de tenant para não criar uma brecha por parâmetros.

**How to apply:** Ao alterar a consulta da rota, derive o tenant do ator primeiro, rejeite companyId externo e use a lista de empresas já limitada para enriquecer e preencher os filtros.