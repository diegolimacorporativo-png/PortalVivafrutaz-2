---
name: Empresa-config tenant scope
description: Regra de autorização para configurações white-label por empresa.
---

As configurações white-label devem usar o tenant derivado do usuário autenticado: usuários vinculados só acessam o próprio `empresaId`; a seleção cross-tenant fica restrita ao fluxo global explícito de MASTER/DIRECTOR sem empresa vinculada. O body nunca pode mudar o tenant.

**Why:** A rota legada consultava e atualizava por ID global, permitindo que um administrador tenant-bound escolhesse outra empresa pela URL ou tentasse reatribuir a configuração pelo body.

**How to apply:** Preserve a validação de ownership antes da leitura/update, execute o repositório dentro de `runWithTenant`, use lookup/update com `empresaId` e remova campos tenant-identifying do payload antes da persistência.