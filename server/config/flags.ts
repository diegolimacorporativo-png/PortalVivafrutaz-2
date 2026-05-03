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
 * FASE MT-1 — Safe tenant query rollout.
 *
 * Controla a migração gradual das queries globais (getOrders, getUsers,
 * getDrivers, getRoutes) para versões com filtro SQL obrigatório por tenant.
 *
 * FASE 1  — Criar métodos *Safe (sem mexer nos legados).           ✅ DONE
 * FASE 2  — Feature flags aqui.                                    ✅ DONE
 * FASE 3  — Router: USE_SAFE_TENANT_QUERY=false → legacy ou shadow ✅ DONE
 * FASE 4  — Shadow validation: roda os dois e loga divergências.   ✅ DONE
 * FASE 5  — Rollout gradual: SAFE_TENANT_ROLLOUT_PERCENT (0..100). ✅ DONE
 * FASE 6  — Remover legacy (pós validação total).                  🔲 PENDENTE
 *
 * ROLLOUT SEGURO:
 *   1. Manter USE_SAFE_TENANT_QUERY=false por 24-72h (modo shadow).
 *      Monitorar logs [SAFE_QUERY_DIVERGENCE] — deve ser 0 divergências.
 *   2. Subir SAFE_TENANT_ROLLOUT_PERCENT=10, depois 50, depois 100.
 *   3. Quando estiver em 100% sem divergências, ligar USE_SAFE_TENANT_QUERY=true.
 *   4. Acompanhar [SAFE_QUERY_ACTIVE] nos logs por 24h.
 *   5. Em emergência: ligar USE_SAFE_TENANT_QUERY=false e reiniciar.
 *      A flag é lida no runtime — não precisa de redeploy.
 *
 * KILL SWITCH: setar USE_SAFE_TENANT_QUERY=false nas env vars e reiniciar.
 */

/**
 * Quando true, TODAS as queries de uso/limite usam filtro SQL por tenant.
 * Quando false (DEFAULT SEGURO), roda em modo shadow: executa os dois caminhos,
 * compara e loga divergências, mas NÃO altera o comportamento para o usuário.
 */
export const USE_SAFE_TENANT_QUERY =
  process.env.USE_SAFE_TENANT_QUERY === "true";

/**
 * Percentual de tenants (0-100) que usam queries safe quando
 * USE_SAFE_TENANT_QUERY=false (modo shadow/rollout gradual).
 * Determinismo: o mesmo companyId recebe sempre o mesmo tratamento.
 * Padrão: 0 — apenas shadow (nenhum tenant em modo safe ainda).
 */
export const SAFE_TENANT_ROLLOUT_PERCENT = Math.min(
  100,
  Math.max(
    0,
    Number(process.env.SAFE_TENANT_ROLLOUT_PERCENT ?? "0"),
  ),
);

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
