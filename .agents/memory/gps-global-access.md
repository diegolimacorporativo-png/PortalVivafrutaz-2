---
name: GPS global access
description: Regra de acesso e montagem do endpoint de posições GPS em tempo real.
---

O endpoint de leitura do GPS deve estar registrado no router modular `/api/logistics`; `MASTER`, `ADMIN` e `DIRECTOR` têm visibilidade global, enquanto os demais perfis internos permanecem limitados ao próprio tenant. Usuários com role `LOGISTICS` atuam como supervisores: enviam a própria posição e monitoram motoristas do próprio tenant; contas legadas sem `empresaId` recebem escopo global somente para leitura do GPS.

**Why:** A tela chama `/api/logistics/drivers/gps`; deixar a implementação apenas em rotas legadas causa 404, restringir administradores pelo `empresaId` impede a visão operacional completa, tratar `LOGISTICS` como motorista impede que o supervisor acompanhe a equipe e contas legadas sem empresa eram bloqueadas antes de chegar ao endpoint.

**How to apply:** Ao alterar o GPS, valide a rota modular e preserve a distinção entre perfis globais e perfis internos tenant-scoped. Para `LOGISTICS`, vincule/crie o registro operacional pelo usuário autenticado; nunca aceite `driverId` de outro usuário. O supervisor LOGISTICS deve manter a aba `gps-tracking` mesmo quando `tabPermissions` legado não contém essa chave.