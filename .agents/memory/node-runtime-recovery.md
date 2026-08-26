---
name: Node runtime recovery
description: Diagnóstico de falhas do workflow causadas por dependências incompletas no ambiente local.
---

Quando o workflow falhar antes de carregar o código da aplicação com `ERR_MODULE_NOT_FOUND` em pacotes básicos, valide primeiro a integridade do `node_modules` e as versões do lockfile antes de alterar a aplicação.

**Why:** Uma instalação npm interrompida pode deixar diretórios ocultos de renomeação e pacotes parcialmente removidos; nesse estado, o erro observado não representa um defeito do código.

**How to apply:** Limpe apenas temporários incompletos, restaure versões compatíveis com o lockfile usando o gerenciador de pacotes e reinicie o workflow antes de investigar erros de runtime da aplicação.