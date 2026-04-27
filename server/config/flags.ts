/**
 * STEP 9.2Z.1 — Feature flags do faturamento.
 *
 * Controle de rollout para regras de bloqueio que ainda estão sendo
 * validadas. NUNCA altere o default sem coordenar com o time financeiro:
 * ligar `BILLING_STRICT_MODE = true` em produção sem aviso bloqueia
 * imediatamente toda emissão de NF semanal/mensal antes do fechamento
 * do ciclo.
 *
 * Para ligar:
 *   1. Confirmar com financeiro qual ciclo (semanal/mensal) deve passar
 *      a bloquear.
 *   2. Mudar a constante para `true`.
 *   3. Reiniciar o workflow.
 *   4. Acompanhar `[NFE_BLOCKED_BY_CYCLE]` nos logs por 24h.
 *
 * Para desligar em emergência: voltar para `false` e reiniciar — o
 * override manual do admin ("Liberar agora") continua funcionando
 * independente desta flag.
 */

export const BILLING_STRICT_MODE = false;

/**
 * STEP 9.2Z.1B — Modo dry-run para o bloqueio de ciclo.
 *
 * Quando `true`, a engine roda toda a lógica de bloqueio por ciclo (semanal /
 * mensal) e LOGA `[NFE_DRY_RUN_BLOCK]` para cada pedido que SERIA bloqueado,
 * mas NÃO bloqueia de fato — apenas observa. Combine com
 * `BILLING_STRICT_MODE = false` por 24–72h, leia os logs, e só então
 * decida se vale ligar `BILLING_STRICT_MODE = true`.
 *
 * Custo: 1 console.warn por pedido elegível, sem efeito colateral.
 */
export const BILLING_DRY_RUN = true;

/**
 * STEP 9.3C — Automação de emissão de NF-e via cron.
 *
 * Quando `true`, o cron diário (08:00) emite automaticamente as NF-es de todos
 * os pedidos elegíveis que passarem no canEmitNFe.
 *
 * ROLLOUT SEGURO:
 *   1. Deixar `false` por 24-72h — observar logs [CRON_FATURAMENTO_DRY]
 *   2. Validar que os pedidos listados são os esperados
 *   3. Mudar para `true` e reiniciar
 *   4. Acompanhar [CRON_FATURAMENTO] nos logs
 *
 * Para emergência: voltar para `false` e reiniciar — o controle manual
 * da Central de Faturamento continua funcionando independente desta flag.
 */
export const AUTO_FATURAMENTO = false;

/**
 * FASE 18 — Guard de idempotência de NF-e (GAP 2 — duplicação sequencial).
 *
 * Quando true, BLOQUEIA emissão de nova NF-e para pedidos com qualquer
 * NF-e em status: gerada, assinada, enviada, autorizada, rejeitada, erro.
 *
 * Quando false (DEFAULT), roda em modo DRY-RUN: NÃO bloqueia, mas LOGA
 * `[NFE_IDEMPOTENCY_DRY_RUN]` para cada pedido que SERIA bloqueado. Isso
 * permite validar a regra em produção antes de ativar o bloqueio real.
 *
 * KILL SWITCH (sem redeploy):
 *   1. Definir ENABLE_NFE_IDEMPOTENCY_GUARD=false nas env vars.
 *   2. Reiniciar o workflow.
 *   3. Comportamento volta para dry-run instantaneamente.
 *
 * Para ativar:
 *   1. Definir ENABLE_NFE_IDEMPOTENCY_GUARD=true nas env vars.
 *   2. Reiniciar o workflow.
 *
 * Escopo: resolve apenas duplicação SEQUENCIAL (GAP 2).
 * NÃO resolve concorrência (GAP 1 e GAP 7).
 */
export const ENABLE_NFE_IDEMPOTENCY_GUARD =
  process.env.ENABLE_NFE_IDEMPOTENCY_GUARD === "true";
