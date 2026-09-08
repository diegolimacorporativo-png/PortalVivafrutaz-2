---
name: GPS global access
description: Regra de acesso e montagem do endpoint de posições GPS em tempo real.
---

O endpoint de leitura do GPS deve estar registrado no router modular `/api/logistics`; `MASTER`, `ADMIN` e `DIRECTOR` têm visibilidade global, enquanto os demais perfis internos permanecem limitados ao próprio tenant.

**Why:** A tela chama `/api/logistics/drivers/gps`; deixar a implementação apenas em rotas legadas causa 404, e restringir administradores pelo `empresaId` impede a visão operacional completa.

**How to apply:** Ao alterar o GPS, valide a rota modular e preserve a distinção entre perfis globais e perfis internos tenant-scoped.