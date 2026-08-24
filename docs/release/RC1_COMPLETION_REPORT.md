# RC1 — Relatório de conclusão da Fase 1

**Data da validação:** 24/08/2026  
**Escopo:** validação da Fase 1 do workflow operacional de pedidos  
**Status:** concluída; pronta para planejamento da Fase 2

## Implementação validada

- A aprovação do pedido (`→ APPROVED`) cria a conta a receber dentro da
  mesma transação crítica do workflow.
- A criação da conta a receber é idempotente: uma conta existente para o
  pedido impede duplicidade em novas tentativas.
- A conta a receber não depende mais da transição `INVOICED`.
- A aprovação não gera automaticamente número de pré-nota.
- O pipeline operacional permanece disponível:
  `READY → INVOICED → SHIPPED → DELIVERED`.
- `INVOICED` representa operacionalmente **Liberado para entrega**.
- `INVOICED → SHIPPED` não exige NF, DANFE, pré-nota ou exportação para Bling.
- `SHIPPED → DELIVERED` continua independente de documento fiscal.
- As rotas e serviços fiscais existentes permanecem disponíveis para uso
  explícito quando necessário.
- A sincronização entre `workflow_status` e o status legado continua dentro
  da mesma transação.

## Última correção

Os rótulos operacionais de `INVOICED` foram ajustados para **Liberado para
entrega**, sem substituir os usos fiscais legítimos de “Faturado”. A
alteração foi aplicada nas telas e mensagens operacionais correspondentes.

## Arquivos relacionados

As regras e a execução da Fase 1 estão preservadas nos módulos de workflow,
serviço e transação de pedidos, além do repositório/serviço financeiro e das
rotas fiscais existentes. O teste focado da fase está em:

- `tests/unit/order-workflow-phase1.test.ts`

Não há alterações de código pendentes no working tree no momento da validação.
Os únicos arquivos não rastreados são anexos de contexto fornecidos pelo
usuário.

## Testes focados

Comando:

```text
npx tsx --test tests/unit/order-workflow-phase1.test.ts
```

Resultado:

- 4 testes executados;
- 4 aprovados;
- 0 falhas.

Os testes confirmam:

1. preservação de `INVOICED` e das transições operacionais;
2. possibilidade de `SHIPPED` com `fiscal_status = nota_pendente`, sem
   pré-nota, NF ou Bling;
3. bloqueio de aprovação para empresa inválida/bloqueada;
4. bloqueio de aprovação para empresa com cobrança vencida.

## Validações gerais

- `npm exec tsc -- --noEmit`: **PASSOU**.
- `npm run build`: **PASSOU**.
- `git diff --check`: **PASSOU**.
- Workflow `Start application`: **em execução**.
- Inicialização observada com `provider: supabase`; não houve execução de
  migração ou alteração de banco.

## Suíte unitária geral

`npm run test:unit` terminou com 128 testes aprovados e 10 falhas. As 10
falhas estão concentradas em `tests/unit/order-deadline.test.ts`: os testes
esperam `15:00 UTC`, enquanto o ambiente de execução retornou `16:00 UTC`
para o mesmo horário de negócio. Isso é um bloqueio externo de timezone/
ambiente, não uma falha observada na Fase 1.

## Critério principal

O caminho `READY → INVOICED → SHIPPED → DELIVERED` permanece permitido, e o
avanço logístico não fica condicionado à emissão de documento fiscal.

## Conta a receber

A conta a receber é criada na aprovação, com verificação de existência por
pedido para impedir duplicidade. O fluxo não espera `INVOICED` e não depende
de `INVOICED` para sua criação.

## Recursos fiscais

Os recursos fiscais continuam presentes, incluindo atualização fiscal,
geração explícita de pré-nota, DANFE/NF-e e exportação para Bling. A Fase 1
somente separa esses recursos do avanço operacional para expedição.

## Clara

Nenhum arquivo da Clara ou do assistente foi alterado nesta validação. A
política de escopo da Clara permanece intacta.

## Banco e bloqueios externos

- O banco `heliumdb` não foi acessado, alterado ou usado para corrigir testes.
- O workflow iniciou usando a configuração Supabase já existente.
- Permanece o bloqueio ambiental dos testes de prazo descrito acima:
  diferença de uma hora entre o horário UTC esperado pelos testes e o horário
  retornado pelo ambiente.
- A validação visual autenticada de Compras permanece não realizada por falta
  de sessão válida; isso não bloqueia a validação técnica da Fase 1.

## Próxima etapa

A Fase 1 está encerrada. A Fase 2 pode ser planejada separadamente, sem
refazer esta fase, alterar Clara ou alterar o banco `heliumdb`.

**FASE 1 CONCLUÍDA — PRONTO PARA PLANEJAR A FASE 2.**