---
name: Users CRUD tenant scope
description: Regra de isolamento para operações administrativas de usuários em instalações multiempresa.
---

Usuários administrativos com `empresaId` na sessão são tenant-bound: o CRUD deve resolver esse tenant no middleware e aplicar `id + empresa_id` nas leituras, updates e exclusões. O `empresaId` vindo do body, query ou frontend nunca substitui o tenant fixado pela sessão. MASTER/DIRECTOR globais sem tenant podem redefinir senha ou desbloquear um usuário apenas pelo ID explícito da operação; a mutação deve repetir `id + empresa_id` usando a empresa lida do próprio usuário no banco. Nunca faça escrita global sem escopo.

**Why:** Um lookup por ID sem condição de empresa permite que um administrador de uma empresa altere, exclua, desbloqueie ou redefina a senha de outra empresa; ao mesmo tempo, exigir tenant para toda ação impede administradores globais de atender um alvo explícito.

**How to apply:** Preserve o `tenantContext` nas rotas `/api/users` e `/api/admin/users`; para fluxos globais autorizados, carregue o alvo pelo ID da rota e escopo a escrita pela empresa desse registro. Trate zero linhas alteradas como usuário não encontrado, sem alterar o schema.