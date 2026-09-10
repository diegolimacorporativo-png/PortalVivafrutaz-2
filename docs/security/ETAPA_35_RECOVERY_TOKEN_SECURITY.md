# ETAPA 35 — Segurança dos tokens de recuperação

**Data:** 10 de setembro de 2026  
**Escopo:** somente o HIGH de tokens de recuperação armazenados em claro  
**Modo:** correção direcionada, sem migration executada e sem alteração de dados reais

## 1. Fluxo analisado

O fluxo confirmado foi:

- `POST /api/auth/forgot-password`
  - `server/modules/auth/auth.routes.ts`
  - `server/modules/auth/auth.controller.ts`
  - `server/modules/auth/auth.service.ts`
- `POST /api/auth/reset-password`
  - `server/modules/auth/auth.routes.ts`
  - `server/modules/auth/auth.controller.ts`
  - `server/modules/auth/auth.service.ts`
- Persistência:
  - `server/modules/auth/auth.repository.ts`
  - `shared/schema.ts`
  - tabela `password_reset_tokens`
- Interface:
  - `client/src/pages/auth/reset-password.tsx`

O token tinha validade de 15 minutos e era removido após a redefinição bem-sucedida.

## 2. Causa do armazenamento plaintext

Antes da correção:

1. `crypto.randomUUID()` gerava o segredo;
2. o valor era salvo diretamente em `password_reset_tokens.token`;
3. a busca comparava o valor bruto;
4. em desenvolvimento, o link completo com o token era escrito no console.

Isso permitia recuperar tokens a partir de dump, backup, leitura SQL ou logs.

## 3. Impacto

Quem obtivesse um token ainda válido poderia redefinir a senha da conta associada dentro da janela de expiração. O token não era reutilizado após o fluxo normal, mas permanecia reversível enquanto armazenado.

## 4. Solução aplicada

- Schema alterado de `token` para `tokenHash`.
- O repositório calcula o digest antes de persistir.
- O token apresentado é calculado novamente e comparado somente por digest.
- O consumo usa `DELETE ... WHERE token_hash = digest AND expires_at > now() RETURNING`.
- O consumo é atômico e de uso único, inclusive sob requisições concorrentes.
- O serviço valida a nova senha antes de consumir o token.
- A API continua retornando somente mensagens genéricas; o token não é incluído na resposta.
- O link deixou de ser gravado em logs.
- O link é enviado pelo mailer existente, sem criar outro mecanismo de autenticação.

## 5. Mecanismo criptográfico

Foi usado SHA-256 hexadecimal por meio de `node:crypto`.

Os tokens são UUIDs aleatórios de alta entropia, não senhas escolhidas pelo usuário. SHA-256 fornece uma representação não reversível adequada para lookup de capabilities aleatórias.

## 6. Compatibilidade

- Login normal não foi alterado.
- Hashing de senha não foi alterado.
- Sessões não foram alteradas.
- O endpoint e o contrato HTTP existentes foram preservados.
- A página `/reset-password?token=...` continua enviando o token somente no POST de redefinição.
- O mailer existente é reutilizado.

## 7. Tokens antigos

Migration preparada:

```text
migrations/20260910_recovery_token_hash.sql
```

Ela:

1. adiciona `token_hash`;
2. invalida os registros antigos da tabela de tokens;
3. remove a coluna plaintext `token`;
4. torna `token_hash` obrigatório e único.

Não existe maneira segura de derivar e preservar o digest sem manter temporariamente o segredo antigo. Por isso, tokens antigos são invalidados. A migration **não foi executada automaticamente** e nenhum dado real foi alterado nesta etapa.

## 8. Logs e respostas

Removido o log de desenvolvimento que imprimia a URL com o token. O mailer pode registrar destinatário e assunto, mas nunca recebe o token em uma mensagem de log. O segredo aparece somente no corpo do e-mail enviado ao usuário e no request legítimo de reset.

Não foram encontrados caminhos alternativos neste fluxo que aceitem o plaintext diretamente fora do repositório de consumo.

## 9. Testes direcionados

Arquivo:

```text
tests/unit/recovery-token-security.test.ts
```

Resultado:

```text
6 testes
6 aprovados
0 falhas
```

Cobertura:

1. digest SHA-256 estável e diferente do token;
2. persistência não contém a propriedade plaintext;
3. consumo usa o registro persistido e é atômico;
4. criação não retorna nem registra o segredo;
5. token válido altera somente o proprietário;
6. reutilização falha;
7. adulterado, inexistente e expirado usam a mesma falha genérica;
8. token vazio ou malformado é rejeitado.

## 10. Regressão

```text
npm run check
PASS

npm run build
PASS

npm test
372 testes
372 aprovados
0 falhas

git diff --check
PASS
```

O build emitiu somente warnings preexistentes de chunks grandes/imports dinâmicos e `import.meta` no bundle CommonJS do validador fiscal.

## 11. Workflow

O workflow `Start application` permaneceu em execução durante as validações.

Confirmado:

- conexão do provider Supabase no boot;
- aplicação pronta;
- servidor na porta 5000;
- `GET /api/health` retornando HTTP 200 com `{"status":"ok"}`.

## 12. Supabase

- Nenhuma migration foi executada.
- Nenhum schema foi alterado no banco conectado.
- Nenhum token ou dado real foi criado, atualizado ou removido.
- A migration deve ser revisada e executada separadamente em ambiente controlado antes de usar o fluxo com a nova coluna.

## 13. Arquivos alterados

```text
server/modules/auth/recovery-token.ts
server/modules/auth/auth.repository.ts
server/modules/auth/auth.service.ts
shared/schema.ts
migrations/20260910_recovery_token_hash.sql
tests/unit/recovery-token-security.test.ts
docs/security/ETAPA_35_RECOVERY_TOKEN_SECURITY.md
```

## 14. Outros HIGH não tratados

Os outros HIGH da Etapa 33 não foram corrigidos nesta etapa:

1. logging integral de corpos de resposta HTTP;
2. exposição de configuração sensível em `company-config`;
3. bypass de rate limit por `X-Forwarded-For`;
4. métodos legados de pedidos sem ownership garantido;
5. inteligência comercial/logística sem escopo tenant explícito.

O HIGH da timeline operacional da Etapa 34 permanece corrigido.

## 15. NF-e/fiscal

Nenhum arquivo, schema ou comportamento de NF-e/fiscal foi alterado. Os warnings de build do validador fiscal são preexistentes.

## 16. Estado Git

Não foi criado commit.

As alterações desta etapa permanecem no working tree para revisão. A migration não foi aplicada.

## Painel final

| Item | Resultado |
|---|---|
| Etapas 1–34 | Preservadas; Etapa 34 aprovada |
| Etapa 35 | Correção implementada e validada em testes |
| HIGH restantes | 5 |
| MEDIUM | Não tratados |
| LOW | Não tratados |
| Testes direcionados | PASS — 6/6 |
| Testes completos | PASS — 372/372 |
| Check | PASS |
| Build | PASS |
| Workflow | PASS |
| Supabase | Conectado; sem alteração de dados |
| Git | Sem commit; alterações pendentes para revisão |
| NF-e/fiscal | Não alterado |

**Critério técnico atendido no código:** novos tokens não são persistidos em plaintext, tokens válidos continuam sendo consumidos pelo fluxo, adulterados/expirados/usados são rejeitados, o segredo não é registrado em logs e o consumo é vinculado ao registro do proprietário.

**Próxima etapa:** revisar e aplicar a migration de invalidação dos tokens antigos em ambiente controlado, antes de promover o fluxo para o schema atualizado.