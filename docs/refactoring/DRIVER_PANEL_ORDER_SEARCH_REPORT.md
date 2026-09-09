# PAINEL DO MOTORISTA — CONSULTA DE PEDIDOS

**Data:** 2026-09-09  
**Rota:** `/admin/driver-panel`

## O que foi implementado

- Campo **Buscar pedido ou cliente**.
- Busca por:
  - código completo ou parcial do pedido;
  - nome da empresa/cliente;
  - CNPJ da empresa.
- Botão **Limpar filtros**.
- Botão **Ver pedido** no card de cada pedido.
- Detalhamento do pedido dentro do card, usando os dados reais já autorizados
  pela consulta da rota:
  - código;
  - empresa;
  - data do pedido;
  - data de entrega;
  - endereço;
  - telefone, quando disponível;
  - observação;
  - status;
  - itens, quantidades, unidade e valores quando disponíveis.

## Como funciona a busca

A busca é aplicada em conjunto com o intervalo de datas e a empresa
selecionada. O campo vazio mantém o comportamento anterior.

O código é normalizado para permitir buscas parciais e sem diferença de
acentuação ou pontuação. Para pedidos que já possuem uma entrega vinculada, a
busca também considera o código presente em `orderDetails`.

## Como funciona “Ver pedido”

O botão expande o card e mostra os detalhes retornados pela própria consulta
autorizada de `/api/driver/route-today`. Não foi criado endpoint público,
consulta paralela ou regra de acesso adicional.

Quando os dados detalhados não existem para uma entrega legada, o painel mostra
as informações disponíveis e informa que os itens detalhados não estão
disponíveis.

## CONFIRMED continua funcionando?

Sim. A lógica existente que combina `deliveries` com pedidos
`CONFIRMED`/ativos/entregues foi preservada. A busca é aplicada somente depois
da composição e da filtragem de tenant/motorista, evitando perder pedidos
confirmados quando já existem outras entregas na mesma data.

Pedidos cancelados continuam fora da consulta disponível.

## Testes realizados

- `npx tsc --noEmit` — aprovado
- `npm run check` — aprovado
- `npm run build` — aprovado
- `git diff --check` — aprovado
- `npm test` — 308 testes aprovados e 10 falhas existentes na suíte geral; a
  execução não apresentou falha de compilação relacionada a esta alteração.

## Resultado

A consulta direta por pedido/cliente funciona sem interferir no GPS, na aba
NF-e da rota, nas regras de tenant ou na atualização de status das paradas.

## Arquivos alterados

- `client/src/pages/admin/driver-panel.tsx`
- `docs/refactoring/DRIVER_PANEL_ORDER_SEARCH_REPORT.md`

## Bloqueios, se houver

Não há bloqueio de implementação. A suíte geral possui 10 falhas independentes
da compilação desta melhoria; elas devem ser tratadas em uma etapa específica
de testes, fora deste escopo.
