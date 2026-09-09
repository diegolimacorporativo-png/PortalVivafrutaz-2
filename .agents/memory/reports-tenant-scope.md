---
name: Reports tenant scope
description: Regra de isolamento para os endpoints administrativos de relatórios.
---

Os relatórios de compras, industrializados e financeiros devem resolver o tenant dentro do fluxo HTTP antes de consultar dados. Para usuários vinculados a uma empresa, `currentTenantId()` vence qualquer `companyId` enviado por query ou body. A visão global fica restrita a MASTER/DIRECTOR sem empresa vinculada, seguindo o padrão do dashboard executivo.

**Why:** Sem `tenantContext`, `currentTenantId()` fica nulo e um administrador tenant-bound pode escolher outra empresa com `?companyId=...`; placeholders financeiros globais também podem expor nomes e totais fora do tenant.

**How to apply:** Mantenha a proteção local em `reports.routes.ts`, use role checks estritos e não altere o middleware global de tenant para corrigir apenas os relatórios.