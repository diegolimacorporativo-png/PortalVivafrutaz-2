# ETAPA 36 — Segurança do logging HTTP

**Data:** 10 de setembro de 2026  
**Escopo:** somente o HIGH de logging integral de respostas HTTP  
**Modo:** correção direcionada, sem migration, sem alteração de dados e sem deploy

## 1. Mecanismo vulnerável encontrado

O achado H-03 da Etapa 33 estava confirmado em `server/app.ts`.

O middleware global para rotas `/api`:

1. substituía `res.json`;
2. capturava o objeto completo da resposta;
3. serializava o objeto com `JSON.stringify`;
4. anexava o conteúdo ao `console.log`.

Consequentemente, qualquer resposta de API contendo token, senha, configuração, PII, valor financeiro, GPS ou outro dado operacional podia ser copiada para os logs do workflow e demais sinks de observabilidade.

Também foi identificado um risco diretamente relacionado no `server/middleware/requestLogger.ts`: o logger registrava `req.originalUrl`, incluindo query strings. Isso poderia expor capabilities em URLs, como tokens de recuperação.

O `audit-logger` persistido no banco foi auditado separadamente e não era o mecanismo que capturava o response body. Ele foi preservado.

## 2. Exemplo do risco

Uma resposta legítima como:

```json
{
  "status": "ok",
  "token": "valor-sensivel",
  "password": "valor-sensivel",
  "data": "dados-operacionais"
}
```

era transformada em conteúdo de log pelo middleware global. O mesmo ocorria com respostas de rotas administrativas, financeiras, logísticas e de configuração.

Uma URL com query string contendo uma capability também podia aparecer no logger de entrada.

Os valores acima são apenas ilustrativos; nenhum segredo real foi usado no relatório ou nos testes.

## 3. Correção aplicada

### 3.1 Response logger seguro

O comportamento vulnerável foi extraído para:

```text
server/middleware/responseLogger.ts
```

O novo logger:

- não intercepta `res.json`;
- não intercepta `res.send`;
- não serializa response body;
- registra apenas método, path sem query string, status, duração, request ID e tamanho quando `Content-Length` estiver disponível;
- mantém o logging operacional para rotas `/api`.

`server/app.ts` agora monta esse middleware seguro.

### 3.2 Request logger

`server/middleware/requestLogger.ts` passou a registrar `req.path` em vez de `req.originalUrl`.

Assim, query strings não são gravadas automaticamente. O método, a rota, o status, a duração e o request ID continuam disponíveis para investigação.

### 3.3 Error handling

Para erros inesperados de servidor:

- o log não serializa o objeto de erro;
- o console registra apenas status e tipo técnico do erro;
- a resposta HTTP usa mensagem genérica;
- o operational error store recebe uma mensagem segura;
- stack trace continua restrita ao modo não produção conforme a política existente.

Erros operacionais conhecidos e seus contratos HTTP foram preservados.

## 4. O que continua sendo registrado

- método HTTP;
- path sem query string;
- status HTTP;
- duração;
- request ID/correlation ID;
- tamanho da resposta quando disponível;
- tipo técnico do erro inesperado;
- eventos estruturados do audit logger existente.

## 5. O que passou a ser bloqueado

O middleware global não registra mais:

- response body completo;
- tokens;
- senhas;
- hashes;
- cookies ou `Set-Cookie`;
- `Authorization`;
- API keys;
- secrets;
- certificados;
- dados financeiros;
- CPF/documentos;
- payloads completos;
- query strings com capabilities;
- stack/message bruto de erro inesperado no console.

Não foi adicionada blacklist como proteção. O desenho remove a captura automática do conteúdo e mantém somente metadados allowlisted.

## 6. Testes direcionados

Arquivo:

```text
tests/unit/http-logging-security.test.ts
```

Resultado:

```text
16 testes direcionados com os testes de errorHandler
16 aprovados
0 falhas
```

Cobertura específica:

1. resposta normal não grava body integral;
2. resposta com token não aparece no log;
3. resposta com password não aparece no log;
4. `Set-Cookie`/Cookie não aparece no log;
5. `Authorization` não aparece no log;
6. dados sensíveis sintéticos não aparecem no log;
7. método/status/duração continuam registrados;
8. erros continuam registrados sem conteúdo sensível;
9. audit logger continua persistindo evento estruturado;
10. não existe caminho de interceptação de `res.json`/response body no middleware;
11. query strings não aparecem no request logger;
12. rota real `/api/health` continua funcionando e observável.

O teste de contrato existente de `errorHandler` também foi atualizado para confirmar mensagem genérica em erro 500 inesperado.

Valores sintéticos usados nos testes:

```text
TEST_SECRET_TOKEN
TEST_PASSWORD
TEST_API_KEY
TEST_SESSION_ID
TEST_CERTIFICATE
TEST_CPF
TEST_BANK_ACCOUNT
```

Nenhum valor real foi usado.

## 7. Validações

```text
npm run check
PASS

npm run build
PASS

npm test
378 testes
378 aprovados
0 falhas

git diff --check
PASS
```

O build emitiu somente warnings preexistentes sobre chunks grandes/imports dinâmicos e `import.meta` no bundle CommonJS do validador fiscal.

## 8. Workflow

O workflow `Start application` permaneceu em execução durante a validação.

Confirmado:

- provider Supabase selecionado no boot;
- validação de boot concluída;
- aplicação pronta;
- rota `/api/health` preservada.

## 9. Supabase

- Nenhuma migration foi executada.
- Nenhum schema foi alterado no banco conectado.
- Nenhum dado real foi criado, atualizado ou removido.
- A migration da Etapa 35 continua pendente e não foi alterada nesta etapa.

## 10. Arquivos alterados

```text
server/app.ts
server/middleware/responseLogger.ts
server/middleware/requestLogger.ts
server/core/errors/errorHandler.ts
tests/unit/http-logging-security.test.ts
tests/unit/errorHandler.test.ts
docs/security/ETAPA_36_HTTP_LOGGING_SECURITY.md
```

## 11. Outros HIGH não tratados

Os demais HIGH da Etapa 33 não foram corrigidos nesta etapa:

1. exposição de configuração sensível para roles amplas;
2. bypass de rate limit por `X-Forwarded-For`;
3. mutações legadas de pedidos sem ownership garantido;
4. timeline/inteligência global sem contrato explícito de escopo.

As correções das Etapas 34 e 35 permanecem fora do escopo desta etapa. A etapa 35 continua com a migration de schema pendente por decisão explícita de não alterar dados reais automaticamente.

## 12. Etapa 35 intacta

A arquitetura de recovery tokens da Etapa 35 não foi alterada:

- digest SHA-256;
- token original não persistido;
- consumo atômico de uso único;
- envio pelo mailer existente;
- ausência de token em logs.

A migration `migrations/20260910_recovery_token_hash.sql` não foi executada.

## 13. NF-e/fiscal

Nenhum arquivo, schema ou comportamento de NF-e/fiscal foi alterado.

Os warnings do validador fiscal no build são preexistentes.

## 14. Estado Git

Não foi criado commit.

Não houve deploy.

As alterações permanecem no working tree para revisão.

## Painel final

| Item | Resultado |
|---|---|
| Etapas 1–35 | Preservadas; Etapa 34 validada; Etapa 35 intacta com migration pendente |
| Etapa 36 | Correção implementada e validada |
| HIGH restantes | 4 |
| MEDIUM | Não tratados |
| LOW | Não tratados |
| Testes direcionados | PASS — 16/16 |
| Testes completos | PASS — 378/378 |
| Check | PASS |
| Build | PASS |
| Workflow | PASS |
| Supabase | Conectado; sem alteração de dados |
| Git | Sem commit; alterações pendentes para revisão |
| NF-e/FISCAL | Não alterado |
| Próxima etapa | Corrigir o próximo HIGH aprovado, sem executar a migration da Etapa 35 automaticamente |

**Critério de aprovação atendido:** o servidor não registra mais response body integral; tokens, senhas, headers sensíveis e query capabilities não aparecem nesses logs; método/status/duração/tamanho continuam disponíveis; erros inesperados não expõem o conteúdo bruto; e o audit logger existente continua funcionando.