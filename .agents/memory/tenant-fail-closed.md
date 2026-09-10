---
name: Tenant fail-closed boundary
description: Política central para distinguir tenant fixado, seleção global explícita e ausência de contexto.
---

O limite HTTP deve instalar o tenant a partir da sessão ou de um alvo explícito permitido; `req.user`, body e marcadores textuais como `GLOBAL_VIEW` não são fontes de escopo. Serviços exigem um alvo único, sessões vinculadas não podem trocar de tenant, e somente `MASTER`/`DIRECTOR` sem empresa mantêm leituras globais classificadas.

**Why:** Fallbacks legados transformavam ausência de empresa em leitura global e permitiam que mutações pulassem a verificação quando `currentTenantId()` era nulo.

**How to apply:** Use `tenantContext` antes do handler, `requireTenantId()` em toda mutação tenant-bound e marque cada leitura global como uma política explícita; não aceite `empresaId`/`tenantId` arbitrário do body ou de sessão vinculada.