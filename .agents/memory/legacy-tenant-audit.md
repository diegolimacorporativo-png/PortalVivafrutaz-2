---
name: Legacy tenant audit
description: Durable lessons from the final multi-tenant/RBAC audit about legacy routes, public config, and generic storage methods.
---

Rotas legadas não ficam tenant-safe apenas porque existe um middleware de contexto em outros módulos. Toda operação tenant-bound precisa carregar ownership até a consulta/mutação no storage, e endpoints públicos devem retornar somente uma whitelist explícita de campos não sensíveis.

**Why:** A auditoria encontrou superfícies antigas que usavam métodos genéricos por ID, além de respostas públicas que incluíam configuração sensível; autenticação e contexto aplicados em módulos novos não protegem automaticamente esses caminhos.

**How to apply:** Ao revisar ou alterar uma rota legada, rastrear sempre rota → controller/service → repository/storage, exigir predicado de tenant/ownership em cada ID e bloquear campos de credencial, fiscal e configuração interna antes da serialização pública.

Para deliveries, o lookup tenant-bound deve usar `id + companyId` no storage; na criação, `companyId` deve ser derivado do ator vinculado, e updates nunca podem alterar a coluna de ownership.

**Why:** Métodos legados genéricos como `getDelivery(id)` e `updateDelivery(id, body)` permitem que o ID ou o body atravessem tenants mesmo quando a sessão está autenticada.

**How to apply:** Aplicar a política antes de GET/PUT/PATCH/DELETE e às auxiliares que alteram a mesma delivery, mantendo `MASTER`/`DIRECTOR` globais somente conforme a política existente.