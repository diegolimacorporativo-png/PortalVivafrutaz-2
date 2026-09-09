---
name: Users CRUD tenant scope
description: Regra de isolamento para operações administrativas de usuários em instalações multiempresa.
---

Usuários administrativos com `empresaId` na sessão são tenant-bound: o CRUD deve resolver esse tenant no middleware e aplicar `id + empresa_id` nas leituras, updates e exclusões. O `empresaId` vindo do body, query ou frontend nunca substitui o tenant fixado pela sessão. Operações globais ficam restritas ao fluxo explícito de administradores globais sem tenant-alvo.

**Why:** Um lookup por ID sem condição de empresa permite que um administrador de uma empresa altere, exclua, desbloqueie ou redefina a senha de outra empresa.

**How to apply:** Preserve o `tenantContext` nas rotas `/api/users` e `/api/admin/users`, use métodos tenant-scoped no service/repository e trate zero linhas de mutação como usuário não encontrado, sem alterar o schema.