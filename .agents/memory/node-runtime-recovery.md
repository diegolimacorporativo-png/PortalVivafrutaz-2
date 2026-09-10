---
name: Node runtime recovery
description: Diagnóstico de falhas do workflow causadas por dependências incompletas no ambiente local.
---

Quando o workflow falhar antes de carregar o código da aplicação com `ERR_MODULE_NOT_FOUND` em pacotes básicos, valide primeiro a integridade do `node_modules` e as versões do lockfile antes de alterar a aplicação.

**Why:** Uma instalação npm interrompida pode deixar diretórios ocultos de renomeação e pacotes parcialmente removidos; nesse estado, o erro observado não representa um defeito do código.

**How to apply:** Limpe apenas temporários incompletos, restaure versões compatíveis com o lockfile usando o gerenciador de pacotes e reinicie o workflow antes de investigar erros de runtime da aplicação.

Testes unitários que importam o bootstrap do banco também precisam de uma
`SUPABASE_DATABASE_URL` com formato PostgreSQL e host não local, mesmo quando
todos os repositórios estão mockados; URLs locais são bloqueadas antes dos
testes começarem.

**Why:** O bootstrap aplica fail-closed para impedir bancos locais e não
distingue essa validação de testes que não executam queries.

**How to apply:** Use somente no comando de teste um host fictício não local,
sem credenciais reais e sem conexão esperada; nunca relaxe a validação da
aplicação.