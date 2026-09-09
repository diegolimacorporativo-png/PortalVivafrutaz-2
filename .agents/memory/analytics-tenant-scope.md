---
name: Analytics tenant scope
description: Regra para autenticação e isolamento dos endpoints analíticos de logística.
---

Endpoints analíticos que agregam empresas, pedidos, motoristas, rotas ou deliveries devem receber o ator autenticado e resolver o escopo pelo contexto de tenant ou pelo vínculo do ator; `companyId` fornecido pelo cliente nunca deve ampliar o escopo. MASTER/DIRECTOR sem empresa vinculada podem operar globalmente; ADMIN/DEVELOPER e demais perfis vinculados permanecem tenant-bound; perfis sem vínculo falham fechado.

**Why:** leituras agregadas globais podem vazar dados entre empresas mesmo sem mutação, e transformar uma falha de ownership em 500 obscurece uma rejeição de autorização.

**How to apply:** manter gates de sessão/RBAC no controller, usar leituras safe no service para atores tenant-bound e mapear `ForbiddenError`/`NotFoundError` para HTTP 403/404.