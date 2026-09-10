# ETAPA 33 — Auditoria Final Consolidada de Segurança

**Data:** 10 de setembro de 2026  
**Modo:** READ-ONLY  
**Escopo:** estado atual do projeto após as Etapas 1–32  
**Referência:** `attached_assets/Pasted--ETAPA-33-AUDITORIA-FINAL-CONSOLIDADA-DE-SEGURAN-A-OBJE_1789051032348.txt`

## 1. Limites da execução

Esta etapa foi executada exclusivamente como auditoria:

- não houve alteração de implementação;
- não houve migration, alteração de schema ou alteração de dados;
- não houve escrita no PostgreSQL do Supabase;
- não houve deploy;
- não houve commit;
- não foram criados testes novos;
- NF-e/fiscal não foi alterado.

O arquivo anexado foi mantido como artefato não rastreado. O único arquivo criado nesta etapa é este relatório.

## 2. Resumo executivo

A superfície de segurança **não está fechada**. Foram confirmados achados HIGH que exigem uma etapa de remediação separada.

### Contagem

| Classificação | Quantidade |
|---|---:|
| CRITICAL confirmado | 0 |
| HIGH confirmado | 7 |
| MEDIUM confirmado | 8 |
| LOW confirmado | 3 |
| INFO/controles positivos | 10 |
| FALSE POSITIVE descartado | 1 |

O risco mais grave confirmado é o acesso cross-tenant no endpoint de timeline operacional, seguido por armazenamento de tokens de reset em claro, logging integral de respostas HTTP, exposição de configuração sensível e bypass de rate limit por `X-Forwarded-For`.

## 3. Achados CRITICAL

### Nenhum CRITICAL confirmado

Não foi confirmada uma exploração anônima ou uma execução remota que justifique CRITICAL. Há, entretanto, achados HIGH com impacto suficiente para manter a segurança aberta.

## 4. Achados HIGH

### H-01 — IDOR cross-tenant na timeline operacional

- **Arquivo:** `server/routes/operations.routes.ts`
- **Endpoint:** `GET /api/admin/operations/timeline/:orderId`
- **Linhas aproximadas:** 104–132
- **Pré-condição:** sessão autenticada com uma das roles aceitas pelo middleware não estrito.
- **Evidência:** a rota consulta `orders`, `workflowEvents`, emissões NF-e, drafts, contas a receber e `eventStore` usando somente `orderId`. Não há `tenantContext`, `requireTenant` ou predicado `companyId`.
- **Exploração:** um usuário autorizado de uma empresa altera `orderId` no path para um pedido de outra empresa.
- **Impacto:** leitura de status operacional, valores, dados fiscais, eventos de workflow e contas a receber de outro tenant.
- **Por que as proteções atuais não impedem:** autenticação e role não substituem a validação de ownership; o endpoint não fixa o tenant antes das consultas.
- **Recomendação:** resolver o tenant a partir da sessão, validar o pedido antes de consultar dados correlacionados e aplicar o predicado de tenant a todas as queries. Adicionar teste negativo cross-tenant.

### H-02 — Token de recuperação de senha armazenado em claro

- **Arquivos:** `shared/schema.ts`, `server/modules/auth/auth.service.ts`, `server/modules/auth/auth.repository.ts`
- **Endpoints:** fluxo de `forgot-password` e `reset-password`
- **Linhas aproximadas:** `shared/schema.ts:321–328`; `auth.service.ts:200–211, 239`; `auth.repository.ts:75–101`
- **Pré-condição:** acesso a dump, backup, leitura SQL ou logs que contenham a tabela de tokens.
- **Evidência:** `password_reset_tokens.token` é persistido diretamente e o lookup consulta o token bruto.
- **Exploração:** obter um token válido ainda dentro da janela de expiração e usá-lo no endpoint de reset.
- **Impacto:** redefinição de senha da conta associada ao token.
- **Proteções existentes:** UUID, expiração curta e uso único reduzem a janela, mas não protegem o valor em repouso.
- **Recomendação:** persistir somente hash/HMAC do token, comparar o hash recebido, invalidar tokens anteriores e revisar backups/logs.

### H-03 — Logging integral de corpos de resposta HTTP

- **Arquivo:** `server/app.ts`
- **Superfície:** middleware global para `/api`
- **Linhas aproximadas:** 166–184
- **Pré-condição:** acesso ao sink de logs, logs de workflow, observabilidade ou armazenamento de logs.
- **Evidência:** `res.json` é interceptado, o corpo completo é capturado e serializado em `console.log` para toda resposta `/api`.
- **Exploração:** chamar ou observar uma rota que devolva PII, valores financeiros, GPS, configuração ou token e recuperar o conteúdo no log.
- **Impacto:** exposição secundária de dados sensíveis e aumento do impacto de qualquer falha de autorização.
- **Recomendação:** remover body logging em produção; se houver necessidade operacional, usar allowlist, redaction centralizada, limite de tamanho e retenção mínima. Nunca registrar password, token, certificado, API key ou PII completa.

### H-04 — Exposição de configuração sensível para roles amplas

- **Arquivo:** `server/routes/settings.routes.ts`
- **Endpoint:** `GET /api/company-config`
- **Linhas aproximadas:** 109–130
- **Pré-condição:** sessão autenticada como `MASTER`, `ADMIN`, `DIRECTOR` ou `DEVELOPER`.
- **Evidência:** para essas roles, a rota retorna o objeto completo de configuração. O próprio código documenta que a linha pode conter credenciais e material de certificado A1.
- **Exploração:** uma conta privilegiada acessa o endpoint e recebe material operacional sensível que não é necessário para a maioria das telas.
- **Impacto:** exposição de credenciais SMTP, certificado privado ou outros segredos de integração; comprometimento potencial de serviços externos e emissão fiscal.
- **Recomendação:** nunca retornar segredos ou material privado em DTO de leitura. Separar configuração operacional de segredo, aplicar privilégio mínimo e disponibilizar somente ações de runtime estritamente necessárias.

### H-05 — Bypass de rate limit por `X-Forwarded-For`

- **Arquivo:** `server/core/security/rateLimit.ts`
- **Superfícies afetadas:** `publicTrackingLimiter`, `publicLimiter`, `fileLimiter`, `adminLimiter` e limitadores globais.
- **Linhas aproximadas:** 35–39
- **Pré-condição:** implantação aceitar requisições cujo `X-Forwarded-For` possa ser controlado pelo cliente ou não houver proxy confiável configurado.
- **Evidência:** o primeiro valor de `X-Forwarded-For` é usado diretamente como identidade do cliente, sem validação de proxy confiável.
- **Exploração:** enviar um valor diferente no header a cada requisição.
- **Impacto:** contorno de limite por IP, abuso de polling de tracking, endpoints de geocoding/CEP, uploads e pressão de recursos.
- **Recomendação:** confiar no header somente atrás de proxy explicitamente confiável; configurar `trust proxy` de forma restrita e usar o endereço de conexão quando a cadeia não for confiável. Adicionar teste de spoofing.

### H-06 — Mutações legadas de pedidos sem ownership no repositório de storage

- **Arquivos:** `server/services/storage.ts`, `server/modules/orders/orders.controller.ts`
- **Superfícies:** métodos legados de leitura/atualização de pedido e itens
- **Linhas aproximadas:** `storage.ts:1251–1303`; controller modular de pedidos
- **Pré-condição:** alcançar um caller que utilize os métodos legados sem a validação anterior de tenant.
- **Evidência:** `getOrder`, `updateOrder` e substituição de itens usam `id`/`orderId` sem predicado de empresa no storage; a atualização aceita estrutura ampla.
- **Exploração:** enviar ID de pedido de outra empresa por um caminho legado ou interno que não aplique `validateOrderTenant`.
- **Impacto:** leitura ou alteração de pedido e itens de outro tenant; possível alteração de campos não destinados ao cliente conforme o caller.
- **Observação:** o GET modular auditado possui validação adicional. O finding permanece para os caminhos legados e para os métodos genéricos reutilizáveis.
- **Recomendação:** tornar os métodos tenant-safe por contrato, exigir tenant em todas as operações e substituir spreads por allowlists de campos.

### H-07 — Timeline/inteligência global acessível por roles sem contrato explícito de escopo

- **Arquivos:** `server/routes/client-intelligence.routes.ts`, `server/services/storage.ts`
- **Endpoints:** rotas de inteligência comercial/logística
- **Linhas aproximadas:** `client-intelligence.routes.ts:9–29,145–169,242–269`
- **Pré-condição:** sessão autenticada em role aceita, sem empresa fixada.
- **Evidência:** os handlers usam `requireSessionOrCompany` e chamam `storage.getOrders()`/`getCompanies()` sem tenant; o retorno contém empresas, faturamento, pedidos e agenda logística.
- **Exploração:** usuário de uma empresa consulta uma rota de inteligência sem tenant e recebe agregações ou registros de outras empresas.
- **Impacto:** vazamento cross-tenant de dados comerciais e operacionais.
- **Recomendação:** tornar o escopo explícito: tenant obrigatório para uso normal; visão global somente em endpoint separado, com roles globais strict e auditoria.

## 5. Achados MEDIUM

### M-01 — Enumeração e mensagens diferenciadas no force password change

- **Arquivos:** `server/modules/auth/auth.routes.ts`, `auth.controller.ts`, `auth.service.ts`
- **Endpoint:** `POST /api/auth/force-password-change`
- **Evidência:** respostas distinguem conta inexistente, conta sem troca pendente e senha temporária incorreta.
- **Impacto:** enumeração de contas e tentativa direcionada de senhas temporárias.
- **Recomendação:** resposta uniforme, rate limit por IP e identidade, token de provisionamento de uso único e expiração.

### M-02 — Bypass global implícito no `requireRole`

- **Arquivo:** `server/core/http/requireAuth.ts`
- **Linhas aproximadas:** 51–75
- **Evidência:** sem `{ strict: true }`, `MASTER`, `ADMIN`, `DIRECTOR` e `DEVELOPER` passam mesmo que não estejam em `allowed`.
- **Impacto:** blast radius maior e risco de autorização excessiva quando uma rota sensível esquece `strict`.
- **Observação:** a política é intencional e documentada, portanto não é falso positivo; o risco está no default permissivo.
- **Recomendação:** migrar rotas sensíveis para strict e exigir matriz explícita de permissões.

### M-03 — Mass assignment em PATCH de company-config

- **Arquivo:** `server/routes/settings.routes.ts`
- **Endpoint:** `PATCH /api/company-config`
- **Linhas aproximadas:** 133–162
- **Evidência:** o body integral é enviado a `storage.updateCompanyConfig(req.body)` e também registrado em `auditLog.details`.
- **Impacto:** roles já privilegiadas podem alterar campos protegidos, inclusive campos sensíveis, se existirem na tabela.
- **Recomendação:** allowlist explícita de campos, sanitização única e redaction do audit log.

### M-04 — Configuração global sem tenant explícito

- **Arquivo:** `server/routes/settings.routes.ts`
- **Endpoint:** `GET /api/company-config`
- **Linhas aproximadas:** 113–129
- **Evidência:** uma única configuração global é retornada, sem `tenantContext` ou seleção de empresa.
- **Impacto:** risco de confundir configuração global com white-label tenant-bound e de expor dados de outra empresa quando a tabela evoluir.
- **Recomendação:** separar endpoint global de configuração por empresa e manter contrato de escopo explícito.

### M-05 — Subcategorias sem RBAC explícito no router modular

- **Arquivo:** `server/modules/products/products.routes.ts`
- **Linhas aproximadas:** 45–52
- **Evidência:** GET/POST/DELETE de subcategorias e mutações por ID são montados depois de `tenantContext`, mas sem guard de sessão/role visível na rota.
- **Impacto:** autorização pode depender de comportamento indireto do contexto; mutações por IDs merecem validação de ownership do produto/subcategoria.
- **Recomendação:** exigir autenticação e role apropriada diretamente no endpoint e validar relação produto/subcategoria no tenant.

### M-06 — Preços por produto dependem de validação relacional incompleta no endpoint

- **Arquivo:** `server/routes/product-prices.routes.ts`
- **Endpoints:** `/api/product-prices` e `/api/product-prices/:id`
- **Linhas aproximadas:** 23–67
- **Evidência:** `productId` e `priceGroupId` recebidos do cliente são validados por forma/valor e enviados ao storage; não há validação explícita no router de pertencimento conjunto.
- **Impacto:** possível ligação de preço com produto/grupo de outro tenant ou adulteração de catálogo, dependendo do método de storage chamado.
- **Recomendação:** validar produto, grupo, preço e tenant no mesmo serviço transacional; adicionar testes com combinações de IDs entre tenants.

### M-07 — Tracking público bearer com alcance operacional amplo

- **Arquivos:** `server/modules/logistics/logistics.controller.ts`, `server/modules/logistics/public-tracking.dto.ts`, `server/core/security/publicTrackingToken.ts`
- **Superfícies:** tracking de rota e delivery por token
- **Evidência:** token válido permite consultar stops/deliveries da rota e dados operacionais; DTO inclui cidade/UF, status, posição, datas e timestamp GPS. TTL padrão observado: 24 horas.
- **Impacto:** qualquer pessoa com o link pode acompanhar a rota inteira; risco de privacidade e vazamento operacional.
- **Classificação:** risco de desenho/privacy, não bypass confirmado, pois o token é assinado, cifrado e expiráveis.
- **Recomendação:** reduzir escopo para o recurso mínimo, permitir revogação, registrar acessos e revisar TTL.

### M-08 — Tracking público pode realizar consulta pesada por polling

- **Arquivo:** `server/routes/logistics.routes.ts`
- **Linhas aproximadas:** 776–807
- **Evidência:** a rota busca a delivery e depois todas as deliveries da data, filtrando em memória; o limitador por IP é afetado por H-05.
- **Impacto:** custo/latência e pressão no PostgreSQL com tokens válidos ou IPs variados.
- **Recomendação:** consulta SQL diretamente escopada ao recurso, cache curto e rate limit confiável.

## 6. Achados LOW

### L-01 — Detalhe interno em erro de parsing de PDF

- **Arquivo:** `server/routes/routes.ts`
- **Linhas aproximadas:** 910–924
- **Evidência:** o catch retorna `detail: e.message`.
- **Impacto:** disclosure de caminho, parser ou detalhe interno para usuário autenticado.
- **Recomendação:** retornar mensagem genérica e registrar detalhes somente em log redigido.

### L-02 — Metadados operacionais em health público

- **Arquivo:** `server/routes/health.routes.ts`
- **Superfícies:** `GET /api/health/live` e `GET /api/health/ready`
- **Evidência:** endpoints públicos expõem pid, uptime, ambiente, timestamp e estado operacional.
- **Impacto:** pequena ajuda para fingerprinting e reconhecimento de ambiente.
- **Recomendação:** minimizar a resposta pública e reservar detalhes para probes confiáveis.

### L-03 — Geocoding/CEP público

- **Arquivos:** controllers/routes de logistics
- **Superfícies:** geocoding/CEP e cálculo de distância
- **Evidência:** endpoints são deliberadamente públicos, com rate limit global dependente de IP.
- **Impacto:** abuso de custo/serviço externo e enumeração de endereços; H-05 agrava o cenário.
- **Recomendação:** autenticar quando possível, limitar por identidade confiável e aplicar cache.

## 7. Endpoints públicos reais revisados

| Endpoint/superfície | Intencional | Token/sessão | Dados | Avaliação |
|---|---|---|---|---|
| `GET /api/settings/maintenance` | Sim | Não | Estado de manutenção | LOW/MEDIUM por disclosure operacional |
| `GET /api/settings/test-mode` | Sim | Não | Estado de teste | LOW/MEDIUM por disclosure operacional |
| `GET /api/company-config/logo` | Sim | Não | Logo | Aceitável; sem segredo observado |
| `GET /api/health/live` | Sim | Não | Metadados de runtime | L-02 |
| `GET /api/health/ready` | Sim | Não | Estado operacional/DB | L-02 |
| Geocoding/CEP/distância | Sim | Não | Endereço/resultado geográfico | L-03 + H-05 |
| Tracking por token | Sim | Token assinado/cifrado | Operação/GPS da rota | M-07; revisar escopo |
| Tracking numérico legado | Não deve ser anônimo | Sessão obrigatória | Dados da rota | Controle positivo; anônimo bloqueado |
| `POST /api/orders/:orderId/deadline-audit` | Não justificado como público | Não | Dados fornecidos pelo caller em log | Falsificação/poluição de observabilidade; revisar em etapa futura |

## 8. Tracking: validações realizadas

### Token público

Controles positivos observados:

- token possui assinatura/HMAC e proteção criptográfica;
- existe expiração;
- existe binding de tipo/recurso no helper;
- o endpoint de delivery exige token;
- DTO público não devolve senha, hash ou credencial.

Riscos residuais:

- token bearer não é revogável individualmente;
- o alcance é de rota inteira, não necessariamente da menor unidade autorizada;
- dados operacionais e GPS permanecem acessíveis enquanto o token estiver válido;
- rate limit depende da correção de `X-Forwarded-For`.

Não foram executados testes destrutivos ou mutacionais de token nesta etapa. A adulteração/expiração/cross-resource deve receber testes HTTP dedicados na etapa de remediação.

### Numeric legacy

Controles positivos observados:

- acesso anônimo é rejeitado;
- sessão é exigida;
- tenant é validado antes da consulta detalhada;
- acesso global é reservado aos papéis globais previstos;
- motorista é limitado à própria rota.

## 9. Mass assignment, tenant bypass e IDOR

Pontos que exigem remediação ou testes dedicados:

1. timeline operacional sem predicado de tenant;
2. métodos legados de pedidos que recebem apenas IDs;
3. `PATCH /api/company-config` com body integral;
4. endpoints de subcategorias sem guard explícito;
5. preços aceitando IDs relacionais cujo vínculo conjunto precisa ser confirmado;
6. fallback global de métodos genéricos quando não há tenant;
7. inteligência comercial/logística usando consultas globais sem contrato strict explícito.

Controles positivos observados:

- tenant vinculado à sessão não é substituído simplesmente por body/query/header;
- search falha fechado sem tenant;
- módulos recentes de finance e inventory aplicam tenant no repositório;
- reports comuns possuem escopo tenant-bound;
- incidentes e entregas usam validação de ownership em caminhos auditados;
- numeric legacy tracking valida antes de consultar detalhes.

## 10. Dados sensíveis e logs

### Falso positivo descartado — plaintext em todos os novos writes

Foi identificado um ramo de compatibilidade para senhas legadas em `auth.service.ts`, mas a confirmação direta mostrou que:

- `UsersRepository.updateUser` aplica `bcrypt.hash` quando recebe `updates.password`;
- o fluxo de autenticação legado atualiza a senha através desse repositório;
- fluxos de criação/troca também passam pelo repositório que faz o hash.

Portanto, não foi confirmado que os fluxos atuais persistam a nova senha em plaintext. A existência de registros legados em plaintext não foi inferida nem modificada nesta auditoria. Deve permanecer como hardening separado: localizar registros sem hash, migrar com segurança e impedir novos formatos legados.

### Exposições confirmadas

- tokens de reset persistidos em claro: H-02;
- corpos completos de respostas em logs: H-03;
- configuração completa com possível material A1/credenciais para roles amplas: H-04;
- detalhes de body em logs de configuração/pedidos: M-03 e risco residual de observabilidade;
- endpoints de audit/security logs retornam PII operacional para roles amplas; revisar minimização, paginação, retenção e auditoria de leitura.

Não foram encontrados no retorno de login/me os campos `password`; esses DTOs removem a senha, o que é controle positivo, mas não resolve os achados de armazenamento/log.

## 11. Controles positivos

1. Sessão usa `SESSION_SECRET`, cookie HttpOnly, Secure em produção, SameSite e store PostgreSQL.
2. Login regenera a sessão.
3. `sessionGuard` valida versão de token/device e falha fechado em erro de banco.
4. Forgot-password tem resposta uniforme.
5. Numeric legacy tracking exige sessão e valida tenant antes do detalhe.
6. GPS autenticado valida coordenadas e ownership.
7. Push subscribe/unsubscribe são vinculados à sessão/empresa.
8. Finance novo usa `withTenant`/`tenantWhere`.
9. Inventory novo aplica autenticação, role e filtros tenant.
10. Search falha fechado sem tenant.

## 12. Testes e verificação

### `npm run check`

**PASSOU.** TypeScript terminou sem erros.

### `npm run build`

**PASSOU.** Client e server foram compilados.

Avisos não bloqueantes observados:

- chunks grandes no bundle client;
- imports dinâmicos e estáticos simultâneos;
- warning de `import.meta` no bundle CommonJS do validador fiscal.

Esses avisos não foram tratados porque NF-e/fiscal e refatorações estão fora do escopo desta etapa.

### `npm test`

**PASSOU.**

Resultado:

- 359 testes;
- 359 aprovados;
- 0 falhas;
- 0 cancelados;
- 0 skipped;
- 0 todo.

As mensagens de erro exibidas durante alguns testes são cenários esperados de validação/negação; os testes correspondentes passaram.

### `git diff --check`

**PASSOU.** Nenhum erro de whitespace.

### Workflow/preview

**PASSOU.**

Evidências observadas:

- `DB_CONNECTED` com provider Supabase;
- `APP_READY`;
- workflow `Start application` em execução;
- `GET /api/health` retornando `{"status":"ok"}`;
- preview HTTP respondeu `200`.

O alerta de backup antigo observado no workflow é operacional e não foi alterado nesta etapa.

## 13. Git

Não foi criado commit.

Antes da criação deste relatório, `git status --short` mostrava somente o arquivo anexado como não rastreado. Nenhuma implementação foi alterada durante a Etapa 33. Ao final, o relatório passa a ser o único arquivo criado pela auditoria, além do artefato anexado.

## 14. Próxima etapa recomendada

1. Corrigir e testar `operations/timeline` com tenant predicate em todas as queries.
2. Fechar os métodos legados de pedidos e remover atualizações por spread.
3. Proteger reset tokens com hash/HMAC.
4. Remover ou redigir logging de corpos HTTP.
5. Separar secrets/certificados de DTOs de company-config e aplicar allowlist no PATCH.
6. Corrigir confiança em `X-Forwarded-For` e criar testes de rate-limit spoofing.
7. Revisar subcategorias, product prices e inteligência cross-tenant com testes A/B.
8. Auditar registros legados de senha e impedir novos writes não bcrypt.
9. Executar testes HTTP de token público: válido, adulterado, expirado, cross-resource e rate limit.

## 15. Painel final

| Item | Resultado |
|---|---|
| ETAPA 1–32 | Contexto considerado; correções históricas não foram reclassificadas sem evidência nova |
| ETAPA 33 | Auditoria read-only concluída |
| CRITICAL | 0 confirmado |
| HIGH | 7 confirmados |
| MEDIUM | 8 confirmados |
| LOW | 3 confirmados |
| TESTES | `npm test`: 359/359 |
| CHECK | PASS |
| BUILD | PASS |
| WORKFLOW | PASS — `DB_CONNECTED`, `APP_READY`, HTTP 200 |
| GIT | Sem commit; sem alteração de implementação |
| PRÓXIMA ETAPA | Remediação dos achados HIGH, começando por tenant/IDOR, reset token e logging |

**Conclusão:** a segurança crítica/HIGH ainda não está fechada. Nenhuma correção foi aplicada nesta Etapa 33, conforme solicitado.