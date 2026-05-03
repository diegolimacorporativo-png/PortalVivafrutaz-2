/**
 * FASE MT-1 — Safe Tenant Query Router.
 *
 * Orquestra a migração gradual das queries globais para versões com filtro
 * SQL obrigatório por tenant. Três modos de operação:
 *
 * MODE A — LEGACY (USE_SAFE_TENANT_QUERY=false, ROLLOUT_PERCENT=0)
 *   Roda somente a query legacy. Comportamento atual inalterado.
 *   Shadow validation ativa: loga divergências sem impactar o request.
 *
 * MODE B — ROLLOUT GRADUAL (USE_SAFE_TENANT_QUERY=false, ROLLOUT_PERCENT>0)
 *   Para os tenants no percentual de rollout: usa safe query diretamente.
 *   Para os demais: legacy + shadow validation.
 *   Determinístico: o mesmo companyId recebe sempre o mesmo tratamento.
 *
 * MODE C — SAFE TOTAL (USE_SAFE_TENANT_QUERY=true)
 *   Usa somente safe queries. Cross-tenant data é impossível por construção.
 *   Shadow validation desligada (sem overhead).
 *
 * KILL SWITCH: setar USE_SAFE_TENANT_QUERY=false nas env vars + reiniciar.
 *
 * Logs produzidos:
 *   [SAFE_QUERY_ACTIVE]      — companyId usando safe query (modo B ou C)
 *   [SAFE_QUERY_SHADOW]      — shadow validation rodando (modo A ou B legacy)
 *   [SAFE_QUERY_DIVERGENCE]  — ⚠️ contagens divergem entre legacy e safe
 *   [SAFE_QUERY_SHADOW_ERR]  — erro interno no shadow (nunca impacta request)
 */

import { storage } from "../../services/storage";
import {
  USE_SAFE_TENANT_QUERY,
  SAFE_TENANT_ROLLOUT_PERCENT,
} from "../../config/flags";
import type { Order, User, LogisticsDriver, LogisticsRoute } from "@shared/schema";

// ── Rollout determinism ────────────────────────────────────────────────────────

/**
 * Determina se um companyId está no bucket de rollout safe.
 * Usa módulo simples para ser determinístico e uniforme.
 * companyId % 100 < ROLLOUT_PERCENT → true (usa safe query).
 */
function isInSafeRollout(companyId: number): boolean {
  if (SAFE_TENANT_ROLLOUT_PERCENT <= 0) return false;
  if (SAFE_TENANT_ROLLOUT_PERCENT >= 100) return true;
  return companyId % 100 < SAFE_TENANT_ROLLOUT_PERCENT;
}

// ── Shadow validation helpers ──────────────────────────────────────────────────

async function runShadow<T>(
  queryName: string,
  companyId: number,
  safeFn: () => Promise<T[]>,
  legacyResult: T[],
): Promise<void> {
  try {
    const safeResult = await safeFn();
    if (safeResult.length !== legacyResult.length) {
      console.warn(`[SAFE_QUERY_DIVERGENCE] query=${queryName} companyId=${companyId} legacyCount=${legacyResult.length} safeCount=${safeResult.length}`);
    }
  } catch (err: any) {
    console.error(`[SAFE_QUERY_SHADOW_ERR] query=${queryName} companyId=${companyId} error=${err?.message}`);
  }
}

// ── Public routing functions ───────────────────────────────────────────────────

/**
 * Roteador seguro para getOrders.
 * Quando ativado, usa getOrdersSafe(companyId) — filtro SQL obrigatório.
 * Em shadow mode, compara contagens entre legacy e safe sem impactar o request.
 */
export async function routeGetOrders(companyId: number): Promise<Order[]> {
  if (USE_SAFE_TENANT_QUERY || isInSafeRollout(companyId)) {
    console.debug(`[SAFE_QUERY_ACTIVE] query=getOrders companyId=${companyId} mode=${USE_SAFE_TENANT_QUERY ? "SAFE_TOTAL" : "ROLLOUT"}`);
    return storage.getOrdersSafe(companyId);
  }

  const legacyResult = await storage.getOrders(companyId);
  console.debug(`[SAFE_QUERY_SHADOW] query=getOrders companyId=${companyId} legacyCount=${legacyResult.length}`);
  void runShadow("getOrders", companyId, () => storage.getOrdersSafe(companyId), legacyResult);
  return legacyResult;
}

/**
 * Roteador seguro para getUsers.
 * Filtra por empresaId (campo de tenant dos usuários do ERP).
 */
export async function routeGetUsers(empresaId: number): Promise<User[]> {
  if (USE_SAFE_TENANT_QUERY || isInSafeRollout(empresaId)) {
    console.debug(`[SAFE_QUERY_ACTIVE] query=getUsers empresaId=${empresaId} mode=${USE_SAFE_TENANT_QUERY ? "SAFE_TOTAL" : "ROLLOUT"}`);
    return storage.getUsersSafe(empresaId);
  }

  const legacyResult = await storage.getUsers();
  const filtered = legacyResult.filter((u: any) => u.empresaId === empresaId);
  console.debug(`[SAFE_QUERY_SHADOW] query=getUsers empresaId=${empresaId} legacyCount=${filtered.length}`);
  void runShadow("getUsers", empresaId, () => storage.getUsersSafe(empresaId), filtered);
  return filtered;
}

/**
 * Roteador seguro para getDrivers.
 * Filtra por empresaId (campo de tenant dos motoristas).
 */
export async function routeGetDrivers(empresaId: number): Promise<LogisticsDriver[]> {
  if (USE_SAFE_TENANT_QUERY || isInSafeRollout(empresaId)) {
    console.debug(`[SAFE_QUERY_ACTIVE] query=getDrivers empresaId=${empresaId} mode=${USE_SAFE_TENANT_QUERY ? "SAFE_TOTAL" : "ROLLOUT"}`);
    return storage.getDriversSafe(empresaId);
  }

  const legacyResult = await storage.getDrivers();
  const filtered = legacyResult.filter((d: any) => d.empresaId === empresaId);
  console.debug(`[SAFE_QUERY_SHADOW] query=getDrivers empresaId=${empresaId} legacyCount=${filtered.length}`);
  void runShadow("getDrivers", empresaId, () => storage.getDriversSafe(empresaId), filtered);
  return filtered;
}

/**
 * Roteador seguro para getRoutes.
 * Filtra por empresaId (campo de tenant das rotas).
 */
export async function routeGetRoutes(empresaId: number): Promise<LogisticsRoute[]> {
  if (USE_SAFE_TENANT_QUERY || isInSafeRollout(empresaId)) {
    console.debug(`[SAFE_QUERY_ACTIVE] query=getRoutes empresaId=${empresaId} mode=${USE_SAFE_TENANT_QUERY ? "SAFE_TOTAL" : "ROLLOUT"}`);
    return storage.getRoutesSafe(empresaId);
  }

  const legacyResult = await storage.getRoutes();
  const filtered = legacyResult.filter((r: any) => r.empresaId === empresaId);
  console.debug(`[SAFE_QUERY_SHADOW] query=getRoutes empresaId=${empresaId} legacyCount=${filtered.length}`);
  void runShadow("getRoutes", empresaId, () => storage.getRoutesSafe(empresaId), filtered);
  return filtered;
}
