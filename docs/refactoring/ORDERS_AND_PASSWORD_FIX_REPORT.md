# Relatório de Refatoração — Pedidos Administrativos e Senha Temporária

**Data:** 2026-08-25  
**Repositório oficial:** `https://github.com/diegolimacorporativo-png/PortalVivafrutaz-2`  
**RFC observada:** `docs/architecture/RFC-001_ARCHITECTURE_STANDARD.md`

## Problemas corrigidos

1. A tela administrativa não conseguia carregar corretamente pedidos de
   empresas diferentes da empresa vinculada ao usuário, inclusive os itens
   exibidos no modal de edição.
2. A tela de troca de senha não rejeitava imediatamente a senha temporária
   repetida, apesar da validação do service já existir para esse fluxo.

## Alterações realizadas

### Pedidos

Arquivos:

- `server/modules/orders/orders.repository.ts`
- `server/core/security/tenantGuard.ts`

Administradores internos com as roles `MASTER`, `ADMIN`, `DIRECTOR` ou
`DEVELOPER` podem consultar a listagem administrativa de pedidos entre
empresas. A consulta detalhada também permite carregar os itens de pedidos de
outra empresa nessa mesma tela. Usuários do portal de empresa continuam
restritos ao próprio tenant.

### Senha

Arquivo:

- `client/src/pages/auth/change-password.tsx`

A tela agora interrompe o envio quando a nova senha é exatamente igual à senha
temporária e informa o motivo ao usuário. A proteção no backend continua sendo
a validação definitiva antes da persistência.

## Impacto

- Todos os pedidos ficam disponíveis na visão administrativa, sem remover o
  isolamento de tenant do portal de empresas.
- O modal de itens deixa de permanecer indefinidamente em “Carregando itens...”
  quando o pedido pertence a outra empresa.
- Nenhuma regra de negócio de pedidos foi alterada.
- Nenhuma senha igual é persistida pelo fluxo de troca temporária.
- Nenhuma estrutura de diretórios ou padrão arquitetural foi reorganizado.

## Validações

- `npx tsc --noEmit` — ✅ aprovado
- `npm run check` — ✅ aprovado
- Workflow `Start application` — ✅ reiniciado
