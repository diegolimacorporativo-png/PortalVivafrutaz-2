# Relatório de Refatoração — Prevenção de Reutilização de Senha

**Data:** 2026-08-25  
**Repositório oficial:** `https://github.com/diegolimacorporativo-png/PortalVivafrutaz-2`  
**RFC observada:** `docs/architecture/RFC-001_ARCHITECTURE_STANDARD.md`

## Objetivo

Impedir que a nova senha seja igual à senha temporária usada no fluxo de
primeira troca de senha.

## Alteração realizada

### Arquivo alterado

- `server/modules/auth/auth.service.ts`

### Impacto

O método `forcePasswordChange` agora rejeita a operação com HTTP `422` quando:

- uma conta de empresa tenta definir como nova senha a própria senha temporária;
- um usuário interno tenta definir como nova senha a própria senha temporária.

A comparação funciona para os dois formatos já suportados pelo sistema:

- hashes bcrypt, usando `bcrypt.compare`;
- senhas legadas em texto, usando comparação direta.

Quando a senha é igual, a persistência não é executada e a resposta informa:

> A nova senha não pode ser igual à senha temporária.

O fluxo autenticado de alteração voluntária (`changePasswordSelf`) já possuía
essa proteção e não foi alterado. Nenhuma regra de negócio, contrato de rota,
estrutura de diretórios ou arquitetura foi modificada.

## Validações

- `npx tsc --noEmit` — ✅ aprovado
- `npm run check` — ✅ aprovado

## Resumo

Foi alterado apenas o service de autenticação, centralizando a validação no
local responsável pelas regras de negócio e preservando o comportamento
existente para senhas diferentes.