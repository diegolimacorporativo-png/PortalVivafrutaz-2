# Relatório de Refatoração — Intervalo de Troca de Senha

**Data:** 2026-08-25  
**Repositório oficial:** `https://github.com/diegolimacorporativo-png/PortalVivafrutaz-2`  
**RFC observada:** `docs/architecture/RFC-001_ARCHITECTURE_STANDARD.md`

## Problema

Usuários internos que já haviam trocado a senha voltavam a receber a tela de
troca obrigatória após reinicializações ou novas prévias da aplicação. O seed
executado no startup marcava novamente todos os usuários internos com
`mustChangePassword = true` quando essa flag estava `false`.

## Correção

Arquivo alterado:

- `server/routes/routes.ts`

O seed agora só ativa a troca obrigatória para usuários internos que ainda não
possuem `passwordChangedAt`. Depois que a senha é trocada, o fluxo de
autenticação grava `passwordChangedAt` no Supabase/PostgreSQL e a inicialização
não reabre a troca obrigatória.

## Impacto

- A senha não volta a ser solicitada a cada reinicialização ou troca de link.
- A política existente de troca periódica a cada 30 dias permanece ativa,
  baseada em `passwordChangedAt`.
- Contas antigas sem data registrada ainda podem ser direcionadas uma vez para
  a troca inicial; após isso a data passa a ser persistida.
- Nenhuma regra de negócio, rota, diretório ou arquitetura foi reorganizada.

## Validações

- `npx tsc --noEmit` — ✅ aprovado
- `npm run check` — ✅ aprovado
- Workflow `Start application` — ✅ reiniciado e em execução
