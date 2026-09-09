---
name: Pricing tenant isolation
description: Regra de escopo para grupos de preço e preços vinculados a produtos.
---

Uma linha de preço só é visível quando ela, o produto referenciado e o grupo de preço referenciado são globais ou pertencem ao tenant atual. Criações derivam `empresaId` do contexto confiável; atualizações e exclusões validam ownership e referência antes de operar por ID.

**Why:** Um filtro apenas em `priceGroupId` ou apenas no registro de preço permite alcançar dados de outro tenant por relações globais ou por IDs enviados pelo cliente.

**How to apply:** Rotas de pricing devem fixar `tenantContext`; o storage deve manter leitura global + tenant próprio, rejeitar fallback sem escopo e nunca aceitar `empresaId`, `companyId` ou `tenantId` do body para reatribuição.