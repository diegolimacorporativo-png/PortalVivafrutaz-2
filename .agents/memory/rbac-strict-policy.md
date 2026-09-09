---
name: RBAC strict policy
description: Regra durável para corrigir o bypass de FULL_ACCESS_ROLES sem quebrar acessos administrativos legítimos.
---

O bypass de `FULL_ACCESS_ROLES` não deve ser removido globalmente. Endpoints explicitamente documentados como MASTER-only devem usar a opção `strict`, enquanto políticas operacionais ou administrativas mistas devem declarar suas roles permitidas e manter o comportamento amplo quando isso for intencional.

**Why:** MASTER, ADMIN, DIRECTOR e DEVELOPER têm acesso estratégico em vários módulos; alterar o middleware central transforma falsos positivos legítimos em regressões. O risco real aparece quando um endpoint cross-tenant ou destrutivo afirma ser exclusivo de MASTER, mas aceita o bypass.

**How to apply:** Ao adicionar ou revisar uma rota, classifique-a primeiro como MASTER-only, global administrativa, tenant-bound ou operacional. Use `strict: true` somente na primeira categoria e mantenha validação de tenant separada nas demais.