---
name: Push global settings policy
description: Regra de escopo para configurações e testes de Push quando a tabela não possui companyId.
---

Configurações e testes de Push armazenados em tabela global só podem ser acessados por contas administrativas explicitamente globais, sem empresa vinculada. Administradores vinculados a tenant não devem ganhar acesso global apenas pelo role.

**Why:** A tabela de configurações não possui companyId; permitir que um administrador tenant-bound a leia ou alterearia configurações de todas as empresas sem isolamento possível.

**How to apply:** Em endpoints de configuração/teste, combine RBAC estrito com validação de ausência de empresa. Em subscriptions, derive userId/companyId da sessão e use operações de storage condicionadas ao proprietário.