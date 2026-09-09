# Etapa 22 — Proteção das Legacy Route Stops

**Status:** concluída  
**Escopo:** `GET`, `POST`, `PATCH` e `DELETE` de `/api/logistics/routes/:routeId/stops`  
**Data:** 2026-09-09

## 1. Relação de ownership confirmada

A cadeia confiável de ownership é:

```text
route_stops.route_id -> logistics_routes.id -> logistics_routes.empresa_id
```

`route_stops.company_id` é um snapshot/legado e não é usado para autorizar a
rota. Na criação, o `companyId` persistido é derivado de
`logistics_routes.empresa_id`.

## 2. Política de acesso

| Perfil | Regra |
|---|---|
| `MASTER` / `DIRECTOR` sem empresa | Acesso global explícito, preservando a capacidade administrativa existente. |
| `MASTER` / `DIRECTOR` com empresa ou alvo selecionado | Escopo limitado ao tenant resolvido pelo contexto da sessão. |
| `ADMIN`, `DEVELOPER`, `LOGISTICS`, `OPERATIONS_MANAGER`, `COMERCIAL`, `MASTER_COMERCIAL` vinculados | Somente rotas da empresa do usuário/contexto. |
| Perfis administrativos sem empresa, exceto `MASTER`/`DIRECTOR` | Negados com `403`; não recebem visão global implícita. |
| `DRIVER` / `MOTORISTA` | Negados nesta superfície administrativa. Um fluxo de motorista deve ter endpoint próprio e política própria. |
| `CLIENT` e demais perfis | Negados com `403`. |
| Sem sessão | Negado com `401`. |

O contexto de tenant continua sendo resolvido no middleware. O service repete a
validação pela cadeia da rota, evitando que uma chamada interna ou um teste sem
middleware possa operar como tenant global por acidente.

## 3. Proteções implementadas

- Os quatro handlers de route stops agora exigem sessão e role logística.
- `GET` resolve a rota dentro do tenant antes de listar stops.
- `POST` resolve a rota dentro do tenant e deriva o ownership da rota.
- `PATCH` exige simultaneamente a rota da URL e o stop vinculado a essa rota.
- `DELETE` aplica a mesma verificação de rota e tenant antes da exclusão.
- Rotas de outro tenant retornam `404`, ocultando a existência do recurso.
- Os campos `routeId`, `companyId`, `empresaId`, `id`, `createdAt` e demais
  campos fora da whitelist não são aceitos do body.
- O `POST` mantém o enriquecimento opcional de endereço por CEP, mas não usa o
  CEP ou qualquer outro campo do body para decidir ownership.
- O storage ganhou variantes scoped com filtro SQL pela rota/empresa; as
  variantes antigas de escrita por ID não são mais usadas pelo módulo.

## 4. Cobertura de testes

`tests/unit/logistics.test.ts` cobre:

- `401` para os quatro métodos sem sessão;
- `403` para `CLIENT`, `DRIVER` e `MOTORISTA`;
- listagem tenant-bound usando apenas o repository scoped;
- `404` para listagem, atualização e exclusão cross-tenant;
- criação com tentativa de spoofing de `routeId`, `companyId`, `empresaId` e
  `createdAt`;
- acesso global explícito de `MASTER` e `DIRECTOR`.

## 5. Escopo não alterado

Não houve migration, alteração de schema, alteração de dados reais, mudança em
deliveries modernos, GPS, fiscal ou contratos de API fora das quatro rotas
legacy de route stops.

## 6. Verificação

Comandos executados com sucesso:

- `npx tsx --test tests/unit/logistics.test.ts` — 20 testes aprovados;
- `npm run check`;
- `npm run build`;
- `git diff --check`.

O build exibiu somente warnings preexistentes sobre chunks grandes e
`import.meta` no bundle CommonJS.