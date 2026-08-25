---
name: GPS e motoristas legados
description: Diferença entre contas de motorista e registros operacionais usados pelo GPS.
---

O cadastro de acesso de um motorista e o registro operacional em `logistics_drivers` podem estar dessincronizados em instalações legadas. A tela administrativa de GPS deve continuar usando `logistics_drivers` quando houver registros, mas pode exibir contas ativas com papel MOTORISTA/DRIVER como entradas somente de leitura quando a tabela operacional estiver vazia.

**Why:** Foi encontrada uma base com dois usuários ativos de motorista e nenhum registro em `logistics_drivers`; consultar somente a tabela operacional fazia a tela parecer vazia apesar dos cadastros existentes.

**How to apply:** Não misturar automaticamente as duas fontes quando a tabela operacional já possui dados e não criar registros silenciosamente durante uma consulta de leitura. Entradas legadas devem aparecer sem localização até que exista um vínculo operacional válido para transmissão de GPS.