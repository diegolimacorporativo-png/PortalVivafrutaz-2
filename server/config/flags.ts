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
