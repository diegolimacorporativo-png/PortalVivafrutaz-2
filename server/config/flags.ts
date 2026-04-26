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
