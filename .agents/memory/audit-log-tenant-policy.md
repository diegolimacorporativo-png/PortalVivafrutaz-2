---
name: Audit log tenant policy
description: Regras de autorização e isolamento para os logs legados em system_logs.
---

Usuários vinculados a uma empresa devem consultar, exportar e remover apenas registros de `system_logs` cujo `companyId` corresponda ao tenant resolvido no servidor. Filtros `companyId`, `empresaId` e `tenantId` enviados pelo cliente nunca substituem esse contexto.

**Why:** A tabela legada não possui uma coluna `tenantId` canônica, e os endpoints de logs historicamente consultavam/removiam sem escopo, permitindo exposição ou exclusão entre empresas.

**How to apply:** MASTER/DIRECTOR sem empresa vinculada podem manter visão global e selecionar uma empresa explicitamente; ADMIN/DEVELOPER vinculados permanecem tenant-bound. POST manual deve aceitar apenas eventos de frontend necessários e derivar actor/tenant/metadata da sessão.