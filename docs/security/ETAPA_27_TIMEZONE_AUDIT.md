# ETAPA 27 — AUDITORIA E CORREÇÃO UTC/BRT DOS PRAZOS

**Data:** 10 de setembro de 2026  
**Escopo:** correção determinística dos testes de deadline UTC/BRT  
**Banco:** nenhuma escrita executada  
**Deploy:** não realizado  

## 1. Causa do problema

Os testes de `tests/unit/order-deadline.test.ts` já utilizavam strings ISO com
`Z` e comparações por `toISOString()`. Portanto, eles não dependiam do timezone
local da máquina.

O desvio estava na implementação:

- os testes e a regra comercial existente esperavam **12:00 BRT**;
- 12:00 BRT corresponde a **15:00 UTC**;
- as implementações cliente e servidor estavam configuradas como **13:00 BRT
  / 16:00 UTC**.

Assim, a causa foi um erro de uma hora na implementação, não uma interpretação
incorreta de timezone nos testes.

## 2. Correção aplicada

Foi alterado somente o horário de corte da regra:

- de `16:00 UTC` para `15:00 UTC`;
- de `13:00 BRT` para `12:00 BRT`.

O cálculo de dois dias úteis anteriores permaneceu inalterado e continua usando
`setUTCDate`, `getUTCDay` e `setUTCHours`, sem depender do timezone da máquina.

Também foram atualizados os comentários e exemplos correspondentes para evitar
documentação conflitante.

## 3. Arquivos alterados

- `client/src/lib/order-deadline.ts`
  - horário de corte e documentação ajustados para 12:00 BRT/15:00 UTC.
- `server/utils/orderDeadline.ts`
  - horário de corte e documentação ajustados para 12:00 BRT/15:00 UTC.
- `docs/security/ETAPA_27_TIMEZONE_AUDIT.md`
  - este relatório.

O arquivo `tests/unit/order-deadline.test.ts` não precisou ser alterado: as
expectativas já representavam a regra correta de 12:00 BRT.

Não foram alterados:

- `docs/security/ETAPA_26_AUDITORIA_FINAL.md`;
- NF-e ou fiscal;
- financeiro;
- inventory;
- logistics;
- deliveries;
- GPS;
- Android;
- tenant context;
- RBAC;
- autenticação;
- banco;
- schema ou migrations.

## 4. Regra de negócio preservada

A regra permanece:

> Alterações, cancelamentos e reaberturas são permitidos até 12:00 BRT do
> segundo dia útil anterior à entrega, inclusive o instante limite.

A representação interna determinística é:

```text
12:00 BRT = 15:00 UTC
```

O limite continua inclusivo porque a decisão permanece `now <= deadline`.

Não foi adicionada dependência e nenhuma API pública foi alterada.

## 5. Testes antes da correção

Com a implementação anterior:

```text
Testes: 344
Passaram: 334
Falharam: 10
```

As falhas eram as expectativas de deadline calculado em `16:00 UTC` quando os
testes esperavam `15:00 UTC`. Os demais cenários da suíte continuavam passando.

## 6. Testes depois da correção

Após ajustar as duas implementações:

```text
Testes: 344
Passaram: 344
Falharam: 0
Cancelados: 0
Ignorados: 0
```

Todos os casos de:

- segunda a sexta;
- antes, exatamente no limite e depois do limite;
- fim de semana;
- mudança de mês;
- mudança de ano;
- estrutura do retorno;

passaram.

## 7. Resultado de `npm run check`

Falhou por problema ambiental preexistente:

```text
server/app.ts:3:18 - error TS2307: Cannot find module 'cors'
```

Não foi instalada nem alterada a dependência, pois isso estaria fora do escopo
da Etapa 27.

## 8. Resultado de `npm run build`

Falhou na compilação do servidor pelo mesmo problema:

```text
Could not resolve "cors"
server/app.ts:3:17
```

O build do frontend foi concluído antes da falha do servidor. Foram exibidos
somente warnings existentes sobre chunks grandes, imports dinâmicos/estáticos e
`import.meta` no bundle CommonJS, além do erro de `cors`.

## 9. Resultado de `git diff --check`

Passou sem erros.

## 10. Falhas residuais

As falhas residuais não são relacionadas a UTC/BRT:

1. `cors` não está disponível para o TypeScript/esbuild em
   `server/app.ts`.
2. O workflow `Start application` permanece falho enquanto essa dependência
   ambiental não for resolvida.

Nenhuma dessas falhas foi corrigida nesta etapa para respeitar o escopo.

## 11. Banco e áreas protegidas

- Nenhuma escrita real no banco foi executada.
- Nenhuma migration foi criada.
- Nenhum schema foi alterado.
- Nenhum deploy foi realizado.
- NF-e/fiscal, financeiro, inventory, logistics, deliveries, GPS, Android,
  tenant context, RBAC e autenticação não foram modificados.

## 12. Estado Git esperado

Não foi criado commit. O diff contém somente a correção de prazo nas duas
implementações e este relatório, além de arquivos não rastreados que já estavam
presentes no workspace.

## 13. Conclusão

A falha de timezone foi corrigida na origem: as implementações agora usam
explicitamente 15:00 UTC, equivalente a 12:00 BRT, sem depender do timezone da
máquina de execução.

Os 344 testes unitários passam. O `check` e o `build` continuam bloqueados
exclusivamente pela dependência ausente `cors`, uma falha não relacionada à
correção UTC/BRT.