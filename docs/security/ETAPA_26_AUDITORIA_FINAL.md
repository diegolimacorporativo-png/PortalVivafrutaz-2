# ETAPA 26 — AUDITORIA FINAL DE SEGURANÇA, MULTI-TENANT E RBAC

**Projeto:** Portal/ERP VivaFrutaz  
**Escopo:** auditoria estática final após as Etapas 1–25  
**Data da auditoria:** 10 de setembro de 2026  
**Modo:** somente leitura  

> Nenhum código da aplicação, schema, migration, dado, credencial, configuração ou
> integração fiscal foi alterado nesta etapa. O único arquivo criado pelo agente é
> este relatório.

## 1. Resumo executivo

Foram revisados:

- montagem e proteção das rotas Express, incluindo aliases `/api`, `/api/v1` e `/api/v2`;
- autenticação, resolução de tenant e `AsyncLocalStorage`;
- RBAC e uso de `requireRole`, inclusive modo `strict`;
- entradas de `companyId`, `empresaId`, `tenantId`, headers e query strings;
- operações por ID e ownership;
- caminhos de storage/repository/service;
- mass assignment e campos controlados pelo servidor;
- uploads e arquivos estáticos;
- endpoints públicos;
- respostas com dados sensíveis;
- frontend, dependências e verificações disponíveis.

### Resultado

Foram encontrados **dois riscos médios reais no desenho dos endpoints públicos de
rastreamento**, ambos relacionados a identificadores numéricos enumeráveis e à
quantidade de dados retornada. A finalidade pública do rastreamento é legítima,
mas a autorização atual é baseada somente no conhecimento de `deliveryId` ou
`routeId`.

Foi identificado também **um risco baixo de hardening por mass assignment** no
CRUD de versões do sistema, restrito a perfis administrativos já autorizados e
sem bypass de tenant. Não é um caminho de acesso anônimo ou de escalada de
privilégio.

Não foi encontrado caminho explorável Critical ou High para:

- autenticação;
- bypass de tenant em rotas tenant-scoped;
- IDOR nos fluxos internos revisados;
- uploads sem autenticação;
- exposição de senha, token ou certificado por resposta HTTP comum;
- falsificação de usuário/role em audit logs;
- acesso indevido aos módulos financeiros, inventário, produtos, preços,
  cotações ou ocorrências pelos fluxos protegidos revisados.

## 2. Escopo e metodologia

### Evidências consultadas

Foram consultados os módulos e pontos centrais abaixo:

- `server/app.ts`;
- `server/modules/index.ts`;
- `server/core/http/requireAuth.ts`;
- `server/middleware/tenant.ts`;
- `server/core/tenant/context.ts`;
- `server/core/security/orderSecurity.ts`;
- routers e controllers de orders, products e logistics;
- `server/services/storage.ts`;
- `server/modules/*/repository.ts` e `server/modules/*/service.ts` nos fluxos
  relevantes;
- `shared/schema.ts`;
- relatórios de segurança anteriores em `docs/security/`.

### Técnicas utilizadas

1. inventário estático de declarações `router.*` e `app.*`;
2. busca de middleware de autenticação, role e tenant;
3. busca de entradas controladas pelo cliente;
4. rastreamento de cada parâmetro por ID até storage/repository;
5. inspeção das cláusulas de tenant e ownership;
6. inspeção de spreads de `req.body` e chamadas de persistência;
7. inspeção de endpoints públicos e payloads;
8. execução de verificações sem escrita de dados;
9. conferência final do estado Git.

Não foram executadas requisições reais de escrita no banco e não foram feitos
testes destrutivos.

## 3. Findings Critical

### Nenhum

Não foi encontrado finding Critical explorável.

## 4. Findings High

### Nenhum

Não foi encontrado finding High explorável.

## 5. Findings Medium

### M-26-01 — Rastreamento público de entrega usa ID numérico direto

**Severidade:** Medium  
**Arquivo:** `server/routes/logistics.routes.ts`  
**Endpoint:** `GET /api/track/:deliveryId`  
**Função:** handler de rastreamento público, aproximadamente linhas 745–782
  
**Comportamento observado**

O endpoint não exige sessão nem token de rastreamento. Ele lê diretamente:

```typescript
const delivery = await storage.getDelivery(Number(req.params.deliveryId));
```

O método usado em `server/services/storage.ts`, aproximadamente linhas
3421–3423, consulta somente:

```typescript
where(eq(deliveries.id, id))
```

Sem autenticação, um cliente que conheça ou enumere um `deliveryId` recebe dados
da entrega. O handler também busca todas as entregas da mesma rota/data e a
última posição GPS do motorista.

**Cenário de exploração**

Um visitante anônimo incrementa IDs de entrega ou obtém um ID de outro link e
consulta entregas pertencentes a outras empresas. Não é necessário possuir uma
sessão de outro tenant.

**Impacto**

O payload inclui, aproximadamente:

- `companyId`;
- status da entrega;
- data programada;
- posição na rota;
- horário de entrega;
- quantidade total de paradas;
- posição GPS do motorista quando disponível.

Isso permite confirmar atividade logística de outro tenant e pode expor
localização operacional em tempo real.

**É explorável?**

Sim, por análise estática. O endpoint é público e o identificador é numérico.
Não é necessário explorar um bypass de middleware.

**Contexto legítimo**

O rastreamento público é uma finalidade declarada do produto. Portanto, a
existência do endpoint não é, por si só, um erro. O risco está na ausência de
um token/identificador opaco específico para o compartilhamento e na quantidade
de dados retornada ao visitante anônimo.

**Cobertura por etapas anteriores**

Parcial. As etapas anteriores protegeram os fluxos internos de entrega e
adicionaram ownership para usuários autenticados e motoristas. Elas não
substituíram o `deliveryId` público por um token de rastreamento nem eliminaram
o GPS do payload anônimo.

**Recomendação futura**

- usar token de rastreamento aleatório, assinado ou com alta entropia, em vez de
  aceitar somente `deliveryId`;
- limitar o token ao escopo da entrega e a uma validade;
- retornar ao público somente status e janela operacional mínima;
- não retornar `companyId`, `orderId` ou GPS exato para visitantes anônimos;
- manter uma resposta operacional mais detalhada somente para usuários
  autenticados e autorizados.

Nenhuma correção foi aplicada nesta etapa.

### M-26-02 — Rastreamento público de rota expõe dados agregados por `routeId`

**Severidade:** Medium  
**Arquivo:** `server/modules/logistics/logistics.controller.ts`  
**Endpoint:** `GET /api/logistics/track/:routeId`  
**Função:** `routeTracking`, aproximadamente linhas 640–869

**Comportamento observado**

O handler é documentado como público e consulta a rota diretamente por ID:

```sql
WHERE lr.id = ${routeId}
```

As consultas seguintes também filtram somente pelo `routeId`:

```sql
WHERE route_id = ${routeId}
```

O payload público remove alguns campos de ETA, mas ainda retorna informações
derivadas de:

- rota;
- motorista;
- `route_stops`;
- `deliveries`;
- empresa associada;
- posição GPS.

Em particular, o objeto final inclui `driverPosition` mesmo quando
`viewerScope` é `"public"`:

```typescript
driverPosition,
viewerScope: isInternal ? "internal" : "public",
```

**Cenário de exploração**

Um visitante anônimo enumera `routeId` e consulta rotas de outras empresas.
Não há tenant context exigido para essa rota pública. O handler não confirma que
o visitante possui um link/token correspondente à rota.

**Impacto**

Para uma rota conhecida ou enumerada, o visitante pode obter:

- nome e telefone do motorista;
- nome/status/data da rota;
- stops com endereço, CEP, cidade, estado e coordenadas;
- `companyId` e nome de empresas nas entregas;
- `orderId` e IDs de deliveries;
- status e coordenadas das entregas;
- última posição GPS do motorista.

**É explorável?**

Sim, por análise estática. A rota é pública e o parâmetro é um ID numérico.

**Contexto legítimo**

O código documenta que a mesma URL é usada pelo mapa administrativo, pelo
aplicativo do motorista e pela página pública do cliente. Essa decisão explica
por que o endpoint é público, mas não impede o risco de enumeração ou
superexposição.

**Cobertura por etapas anteriores**

Parcial. A proteção de motorista foi implementada para sessões autenticadas:
um motorista só pode obter sua própria rota. A resposta pública, entretanto,
continua sem autenticação e mantém dados de rota, empresa e GPS.

**Recomendação futura**

- separar endpoint interno e endpoint público;
- usar um token de rastreamento opaco por rota/entrega;
- remover telefone, `orderId`, IDs internos e GPS exato do payload público;
- retornar apenas o estado mínimo necessário para o cliente;
- aplicar validade e revogação ao link público.

Nenhuma correção foi aplicada nesta etapa.

## 6. Findings Low

### L-26-01 — CRUD de versões do sistema aceita campos além da intenção do formulário

**Severidade:** Low  
**Arquivos:**

- `server/routes/system-versions.routes.ts`, aproximadamente linhas 20–48;
- `server/services/storage.ts`, aproximadamente linhas 3572–3578;
- `shared/schema.ts`, aproximadamente linhas 1695–1708.

**Endpoints/funções**

- `POST /api/system/versions`;
- `PATCH /api/system/versions/:id`;
- `storage.createSystemVersion`;
- `storage.updateSystemVersion`.

**Comportamento observado**

O POST monta o objeto com:

```typescript
{
  ...req.body,
  criadoPor: actor.name || actor.email,
}
```

O PATCH passa o body inteiro:

```typescript
storage.updateSystemVersion(parseInt(req.params.id), req.body)
```

O storage persiste diretamente:

```typescript
db.update(systemVersions).set(data)
```

Não existe schema de request específico no router para limitar os campos do
formulário. O controle principal é o role gate
`requireAuthCore + requireRole(["MASTER", "ADMIN", "DEVELOPER", "DIRECTOR"])`.

**Cenário de exploração**

Um usuário que já possui uma dessas roles pode enviar campos de controle do
registro, como `createdAt`, `criadoPor` no PATCH, ou outros campos aceitos pela
camada Drizzle em runtime, em vez de somente `versionName`, `descricao`,
`changelog`, `dataLancamento`, `tipoVersao` e `status`.

**Impacto**

Alteração indevida de metadados e histórico de versão por um operador
administrativo autorizado. Não há evidência de que esse caminho permita a um
cliente comum ou a um tenant acessar outro tenant.

**É explorável?**

Sim, mas somente após autenticação e autorização como operador administrativo.
Não é bypass de RBAC nem IDOR tenant-scoped.

**Cobertura por etapas anteriores**

O endpoint possui gate formal de autenticação e role. O risco residual de
allowlist de campos não aparece coberto pelas etapas anteriores consultadas.

**Recomendação futura**

Aplicar um schema de entrada explícito para criação/edição e permitir somente
campos de negócio editáveis. Campos de auditoria, timestamps e identificadores
devem ser definidos pelo servidor.

Nenhuma correção foi aplicada nesta etapa.

## 7. Itens verificados sem finding explorável

### 7.1 Autenticação e RBAC

`requireAuth` exige `session.userId`; `requireSession` aceita sessão
administrativa ou de portal. `requireRole` resolve a role da sessão ou do banco,
e oferece modo `strict` para impedir o bypass de `FULL_ACCESS_ROLES`.

Foram confirmados gates formais em:

- finance;
- fiscal;
- reports;
- products;
- uploads de imagem;
- users;
- orders;
- inventory;
- purchase planning;
- waste control;
- bank;
- company settings;
- módulos administrativos.

O uso de `FULL_ACCESS_ROLES` não foi classificado como vulnerabilidade onde o
acesso global é intencional. Endpoints de escopo global usam `strict` quando
necessário, como reports e executive dashboard.

### 7.2 Tenant context

`server/middleware/tenant.ts` resolve o tenant na borda HTTP e executa o
handler dentro de `runWithTenant`. Usuário de portal não pode substituir o
tenant da sessão por `?empresaId` ou `X-Empresa-Id`. Administradores vinculados
a uma empresa também não podem substituir o tenant.

O fluxo global está limitado explicitamente a `MASTER` e `DIRECTOR` sem empresa
vinculada, conforme `resolveAdminTenant`.

`server/core/tenant/context.ts` não confia em `req.user`, query, header ou body
para obter o tenant; `requireTenantId()` falha fechado quando o contexto está
ausente.

### 7.3 Orders e aliases

O router de orders instala `tenantContext`. As rotas v1 e v2 reutilizam o mesmo
router e não criam uma variante desprotegida. O alias legado de leitura de
orders usa `validateCompanyTenant`/`validateOrderTenant` antes de consultar
storage.

### 7.4 Products, categorias e subcategorias

Embora alguns handlers de subcategoria usem checks inline, o router de products
instala `tenantContext`. O storage:

- filtra produtos globais ou do tenant atual;
- verifica ownership antes de mutar;
- remove campos de tenant recebidos pelo cliente;
- verifica o produto pai antes de criar/editar/remover subcategorias.

O toggle `out-of-season` exige `requireSession` e passa por
`storage.updateProduct`, que aplica `assertCatalogMutation` e a cláusula
tenant-scoped. Não foi classificado como anônimo ou cross-tenant.

### 7.5 Financeiro, banco, inventário, produção e planejamento

Os fluxos revisados exigem autenticação, role e tenant quando fazem leitura ou
mutação tenant-scoped. Os repositórios/storage usam `tenantWhere`,
`tenantAnd`, `withTenant` ou `requireTenantId` nos caminhos consultados.

O `purchase-planning/status` recebe body parcial, mas o storage força o tenant
com `requireTenantId`, remove os campos de tenant e atualiza por ID já
encontrado no tenant atual. Não foi observado escape de tenant.

### 7.6 IDOR e ownership de logística

Os endpoints internos de delivery usam `getAuthorizedDelivery`, que resolve o
tenant e valida ownership de motorista. A proteção do motorista também é
aplicada ao rastreamento de rota autenticado.

O risco remanescente está restrito aos dois endpoints públicos descritos em
M-26-01 e M-26-02.

### 7.7 Mass assignment tenant-scoped

Foram encontrados spreads de body em vários fluxos, mas os caminhos
tenant-scoped relevantes aplicam uma ou mais destas barreiras:

- validação Zod no router;
- `stripTenantFields`;
- `withTenant`;
- `tenantAnd`;
- ownership no repository;
- sobrescrita de campos controlados pelo servidor.

O caso que permaneceu como risco residual foi o CRUD global de versões do
sistema, descrito em L-26-01.

### 7.8 Logs e auditoria

Não foi encontrado endpoint público para falsificar `userId`, role ou tenant em
logs. Os logs tenant-scoped consultados aplicam o contexto do tenant ou exigem
roles administrativas. Escritores internos sobrescrevem campos de ator em
vários fluxos.

Existe logging amplo de respostas em `server/app.ts`, aproximadamente linhas
166–180:

```typescript
if (captured) line += ` :: ${JSON.stringify(captured)}`;
console.log(`${time} [${req.requestId}] [express] ${line}`);
```

Isso é um risco operacional de exposição caso um endpoint futuro retorne dado
sensível, mas não constitui, isoladamente, um bypass HTTP de tenant ou
autorização. A recomendação é reduzir/redigir payloads em logs de produção em
uma etapa futura.

### 7.9 Uploads e arquivos

O upload de imagem de produto:

- exige `requireAuth`;
- exige role `ADMIN`;
- usa nome aleatório;
- restringe MIME a imagens;
- limita o tamanho a 5 MB.

Os uploads de PDF/importação exigem `requireAuth` e usam storage em memória com
limite de 20 MB. Não foi encontrado path traversal evidente ou endpoint de
upload anônimo explorável.

`/uploads` é servido estaticamente, mas o upload de produto não usa nome de
arquivo controlado pelo cliente para o caminho final.

### 7.10 Dados sensíveis

Não foi encontrado retorno comum de senha, hash, token de sessão, chave privada
ou senha SMTP:

- usuários usam `SafeUser` com senha mascarada;
- SMTP mascara password no GET e na resposta de save;
- company config separa campos seguros de credenciais/certificado;
- certificado A1 possui endpoints de status sem retornar material do
  certificado;
- banco mascara dados sensíveis antes do retorno.

O log de resposta global descrito acima permanece como risco operacional
separado, não como evidência de que esses dados sejam retornados pela API.

## 8. Endpoints públicos legítimos identificados

| Endpoint | Finalidade | Dados | Avaliação |
|---|---|---|---|
| `POST /api/auth/login` | autenticação | resposta de login | Público necessário, protegido por rate limit |
| `GET /api/auth/me` | descobrir sessão atual | estado mínimo de sessão | Público necessário |
| `POST /api/auth/logout` | encerrar sessão | confirmação | Público necessário |
| `POST /api/auth/forgot-password` | iniciar reset | resposta não enumerável | Público necessário, rate limit |
| `POST /api/auth/reset-password` | concluir reset | confirmação | Público necessário, rate limit |
| `GET /api/settings/maintenance` | tela de login | flag booleana | Público intencional |
| `GET /api/settings/test-mode` | comportamento da tela de login | flag booleana | Público intencional |
| `GET /api/company-config/logo` | branding/login | logo público | Público intencional |
| `GET /api/system/versions/current` | metadata de versão | versão ativa | Público intencional e somente leitura |
| `GET /api/push/vapid-public-key` | Web Push | chave pública | Público por definição |
| `GET /api/geo/cep/:cep` | geocoding | endereço de CEP | Público funcional, sem dados de tenant |
| `GET /api/logistics/geo/cep/:cep` | geocoding | endereço de CEP | Público funcional |
| `GET /api/track/:deliveryId` | tracking de cliente | status/logística/GPS | Público por design, residual M-26-01 |
| `GET /api/logistics/track/:routeId` | tracking de cliente | rota/stops/entregas/GPS | Público por design, residual M-26-02 |
| `GET /api/health/*` | health checks | estado operacional básico | Público operacional |
| webhook de billing | integração de cobrança | evento assinado | Público por necessidade, protegido por HMAC/idempotência |

Os endpoints públicos de tracking não foram descartados como legítimos; foram
registrados como riscos médios porque a finalidade legítima não elimina a
enumeração de IDs nem a exposição agregada.

## 9. Itens já corrigidos nas Etapas 1–25

Com base no código atual e nos relatórios anteriores consultados:

- senha de usuário não é retornada em claro;
- reset de senha não persiste a senha original;
- tenant context usa `AsyncLocalStorage` e falha fechado;
- empresa vinculada não pode trocar tenant por query/header;
- repositories de orders, products, prices, reports, finance, inventory e
  logística usam escopo de tenant nos caminhos principais;
- deliveries internos têm ownership de tenant/motorista;
- products/categorias/subcategorias aplicam ownership;
- quotations e incidentes possuem escopo;
- push subscriptions e configurações globais têm gates administrativos;
- reports diferenciam tenant pinado de fluxo global explícito;
- roles administrativas em endpoints sensíveis usam `strict` quando necessário;
- uploads administrativos exigem sessão/role e possuem limites;
- aliases v1/v2 não reabrem as antigas rotas anônimas;
- endpoints administrativos críticos possuem rate limiting e logs;
- respostas de SMTP, usuários e configurações removem/maskaram segredos.

## 10. Riscos aceitos ou legítimos

Os itens abaixo foram observados, mas não classificados como vulnerabilidades
novas:

1. **Acesso global de MASTER/DIRECTOR sem empresa:** previsto pela arquitetura
   para operações globais explícitas.
2. **Rota pública de tracking:** finalidade de negócio legítima; o risco de
   exposição está detalhado nos findings M-26-01 e M-26-02.
3. **Logo, geocoding, health e versão atual públicos:** dados sem tenant
   sensível ou necessários antes do login.
4. **Operações de sistema globais:** aplicação de versão/rollback por roles
   administrativas é uma capacidade global intencional.
5. **Métodos internos de storage sem tenant próprio:** não foram considerados
   vulnerabilidade isoladamente quando todos os consumidores HTTP revisados
   fornecem ownership, tenant context ou validação anterior.
6. **Relatório financeiro placeholder para fluxo global:** não representa
   leitura cross-tenant real; é um payload legado de demonstração retornado
   somente no fluxo global permitido.

## 11. Limitações ambientais

- O workflow `Start application` ficou indisponível/falho no ambiente durante
  a auditoria.
- `npm run check` falhou antes de compilar o projeto por dependência ausente:

  ```text
  server/app.ts:3:18 - error TS2307: Cannot find module 'cors'
  ```

  A dependência não foi instalada ou alterada, pois esta etapa é somente
  auditoria.
- Não foi executada conexão real de escrita no Supabase.
- Não foram executados testes HTTP autenticados contra dados reais.
- A auditoria é estática; os achados de tracking refletem o caminho de código
  observável e não uma exploração ativa.

## 12. Testes e verificações executados

| Verificação | Resultado |
|---|---|
| Busca estática de rotas e aliases | Concluída |
| Busca de auth/RBAC/tenant middleware | Concluída |
| Busca de `companyId`/`empresaId`/`tenantId` controlados pelo cliente | Concluída |
| Busca de mass assignment | Concluída |
| Auditoria de storage/repository/service | Concluída nos domínios priorizados |
| Auditoria de uploads | Concluída |
| Auditoria de endpoints públicos | Concluída |
| `git diff --check` | Passou |
| `npm run check` | Falhou por `cors` ausente em `server/app.ts` |
| `npm test` | Falhou em testes preexistentes de deadline por diferença UTC/BRT de uma hora |
| `npm run build` | Não executado para evitar gerar artefatos durante auditoria read-only |
| Operações reais de escrita no banco | Não executadas |

As falhas de `npm test` observadas foram as conhecidas de timezone: os testes
esperavam `15:00Z` e o ambiente produziu `16:00Z` para o mesmo horário BRT.
Não há evidência de que sejam causadas por esta auditoria.

## 13. Matriz final

| Área | Status | Findings | Severidade |
|---|---|---:|---|
| Autenticação | Protegida nos fluxos revisados | 0 | — |
| RBAC | Protegido; `strict` usado nos gates críticos | 0 | — |
| Multi-tenant | Protegido nos fluxos internos revisados | 0 | — |
| IDOR | Risco nos endpoints públicos de tracking | 2 | Medium |
| Mass assignment | Risco residual em versões do sistema | 1 | Low |
| Ownership | Protegido nos fluxos internos de delivery/catalog | 0 | — |
| Tenant context | Fail-closed nos módulos revisados | 0 | — |
| Storage/repository | Escopo aplicado nos consumidores revisados | 0 | — |
| Logistics | Tracking público amplo | 2 | Medium |
| Deliveries | Internos protegidos; tracking público residual | 1 | Medium |
| Products | Ownership e tenant presentes | 0 | — |
| Prices | Tenant/ownership presentes nos caminhos revisados | 0 | — |
| Quotations | Tenant/auth presentes nos caminhos revisados | 0 | — |
| Reports | Fluxo global explícito e tenant pinado | 0 | — |
| Incidents | Auth/RBAC/tenant presentes nos caminhos revisados | 0 | — |
| Finance | `requireAuth` + tenant scope | 0 | — |
| Bank | Auth/role/tenant presentes | 0 | — |
| Inventory | Auth inline + tenant scope | 0 | — |
| Push | Público somente para chave pública; mutações protegidas | 0 | — |
| Audit logs | Sem falsificação HTTP observada | 0 | — |
| Uploads | Auth, role, limits e nomes aleatórios | 0 | — |
| Frontend | Sem token/secret em localStorage encontrado | 0 | — |
| Endpoints públicos | Tracking amplo; demais públicos justificados | 2 | Medium |
| Dados sensíveis | Mascarados nos endpoints revisados | 0 | — |
| Dependências | Não auditadas/atualizadas nesta etapa | — | Limitação |

## 14. Recomendações futuras, fora do escopo desta etapa

1. Introduzir tokens opacos e expiráveis para os dois fluxos de tracking
   público.
2. Separar payload público de payload interno, removendo GPS exato, telefone,
   `orderId`, IDs de empresa e coordenadas detalhadas quando não forem
   indispensáveis.
3. Adicionar schemas Zod de criação/edição para `system_versions` e excluir
   campos de auditoria/timestamps/IDs do body do cliente.
4. Reduzir ou redigir o logging global de corpos JSON de respostas em
   produção.
5. Reexecutar `npm run check`, `npm run build` e a suíte após a correção
   ambiental de `cors` e do timezone de testes.

## 15. Conclusão

A arquitetura atual apresenta proteção consistente de autenticação, RBAC e
tenant nos fluxos internos auditados. Não foi encontrado bypass Critical ou
High, nem caminho de acesso cross-tenant em operações internas protegidas.

Os riscos médios restantes concentram-se deliberadamente nos endpoints públicos
de rastreamento: eles funcionam sem sessão e aceitam IDs numéricos diretamente.
Isso é compatível com a finalidade de negócio declarada, mas deixa a superfície
enumerável e expõe mais dados logísticos do que o mínimo necessário para um
visitante anônimo.

O risco baixo de mass assignment em versões do sistema é restrito a perfis
administrativos autorizados e não altera a conclusão de isolamento multi-tenant.

Nenhuma correção foi feita nesta etapa.