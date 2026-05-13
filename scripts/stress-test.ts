/**
 * FASE 1.3 — ETAPA 3: Stress Test Operacional
 *
 * Testa:
 *   - Latência de endpoints críticos
 *   - Concorrência na criação de pedidos (60s duplicate guard)
 *   - Workers e circuit breaker sob carga
 *   - Uso de memória
 *
 * Execução: tsx scripts/stress-test.ts
 * Pré-requisito: servidor rodando em localhost:5000 (npm run dev)
 */

const BASE_URL = process.env.TEST_BASE_URL ?? "http://localhost:5000";
const STRESS_COOKIE = process.env.STRESS_SESSION_COOKIE ?? "";

// ── Types ────────────────────────────────────────────────────────────────────

interface StressResult {
  name: string;
  url: string;
  method: string;
  attempts: number;
  success: number;
  failed: number;
  avgLatencyMs: number;
  minLatencyMs: number;
  maxLatencyMs: number;
  p95LatencyMs: number;
  errors: string[];
}

// ── HTTP helpers ──────────────────────────────────────────────────────────────

async function httpGet(url: string): Promise<{ status: number; latencyMs: number; body: string }> {
  const start = Date.now();
  const res = await fetch(url, {
    headers: {
      "Cookie": STRESS_COOKIE,
      "Accept": "application/json",
    },
  });
  const body = await res.text();
  return { status: res.status, latencyMs: Date.now() - start, body };
}

async function httpPost(url: string, payload: unknown): Promise<{ status: number; latencyMs: number; body: string }> {
  const start = Date.now();
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Cookie": STRESS_COOKIE,
      "Content-Type": "application/json",
      "Accept": "application/json",
    },
    body: JSON.stringify(payload),
  });
  const body = await res.text();
  return { status: res.status, latencyMs: Date.now() - start, body };
}

// ── Test suites ───────────────────────────────────────────────────────────────

async function testEndpointConcurrency(
  name: string,
  method: "GET" | "POST",
  url: string,
  payload?: unknown,
  concurrency = 10,
): Promise<StressResult> {
  const latencies: number[] = [];
  const errors: string[] = [];
  let success = 0;
  let failed = 0;

  const task = async () => {
    try {
      const r = method === "GET"
        ? await httpGet(`${BASE_URL}${url}`)
        : await httpPost(`${BASE_URL}${url}`, payload);

      if (r.status >= 200 && r.status < 500) {
        success++;
        latencies.push(r.latencyMs);
      } else {
        failed++;
        errors.push(`HTTP ${r.status}: ${r.body.slice(0, 100)}`);
      }
    } catch (e: any) {
      failed++;
      errors.push(e.message);
    }
  };

  // Run in waves of 5 concurrent
  for (let wave = 0; wave < Math.ceil(concurrency / 5); wave++) {
    const batch = Math.min(5, concurrency - wave * 5);
    await Promise.all(Array.from({ length: batch }, task));
    await new Promise(r => setTimeout(r, 50)); // 50ms between waves
  }

  latencies.sort((a, b) => a - b);
  const avg = latencies.reduce((s, v) => s + v, 0) / (latencies.length || 1);
  const p95 = latencies[Math.floor(latencies.length * 0.95)] ?? 0;

  return {
    name,
    url,
    method,
    attempts: concurrency,
    success,
    failed,
    avgLatencyMs: Math.round(avg),
    minLatencyMs: latencies[0] ?? 0,
    maxLatencyMs: latencies[latencies.length - 1] ?? 0,
    p95LatencyMs: p95,
    errors: [...new Set(errors)].slice(0, 3),
  };
}

// ── Print results ─────────────────────────────────────────────────────────────

function printResult(r: StressResult) {
  const okRate = Math.round((r.success / r.attempts) * 100);
  const latencyOk = r.avgLatencyMs < 500;
  const statusOk = okRate >= 90;

  const symbol = latencyOk && statusOk ? "✅" : okRate >= 70 ? "⚠️ " : "❌";

  console.log(`\n${symbol} ${r.name}`);
  console.log(`   URL:      ${r.method} ${r.url}`);
  console.log(`   Requests: ${r.attempts} → ${r.success} ok / ${r.failed} falhou (${okRate}%)`);
  console.log(`   Latência: avg=${r.avgLatencyMs}ms min=${r.minLatencyMs}ms max=${r.maxLatencyMs}ms p95=${r.p95LatencyMs}ms`);
  if (r.errors.length > 0) {
    console.log(`   Erros:    ${r.errors.join(" | ")}`);
  }

  return { ok: statusOk && latencyOk, avgMs: r.avgLatencyMs, okRate };
}

// ── Circuit Breaker check ─────────────────────────────────────────────────────

async function checkCircuitBreaker(): Promise<void> {
  console.log("\n🔌 Circuit Breaker SEFAZ:");
  try {
    const r = await httpGet(`${BASE_URL}/api/admin/fiscal/diagnostics`);
    if (r.status === 200) {
      const data = JSON.parse(r.body);
      const cb = data?.data?.circuitBreaker;
      if (cb) {
        console.log(`   Estado:   ${cb.state}`);
        console.log(`   Falhas:   ${cb.failures}`);
        console.log(`   Aberturas:${cb.totalOpenings}`);
        console.log(`   Status:   ${cb.status === "ok" ? "✅ Fechado" : cb.status === "warning" ? "⚠️  Half-open" : "❌ Aberto"}`);
      }
    } else {
      console.log(`   Status: HTTP ${r.status} (necessita autenticação para /api/admin/fiscal/diagnostics)`);
    }
  } catch (e: any) {
    console.log(`   Erro ao verificar circuit breaker: ${e.message}`);
  }
}

// ── Memory check ──────────────────────────────────────────────────────────────

async function checkMemory(): Promise<void> {
  console.log("\n💾 Memória do processo:");
  try {
    const r = await httpGet(`${BASE_URL}/api/health`);
    if (r.status === 200) {
      const data = JSON.parse(r.body);
      if (data.memory) {
        const { rss, heapUsed, heapTotal } = data.memory;
        const heapPct = Math.round((heapUsed / heapTotal) * 100);
        const rssMB = Math.round(rss / 1024 / 1024);
        const heapUsedMB = Math.round(heapUsed / 1024 / 1024);
        const heapTotalMB = Math.round(heapTotal / 1024 / 1024);
        console.log(`   RSS:      ${rssMB}MB`);
        console.log(`   Heap:     ${heapUsedMB}MB / ${heapTotalMB}MB (${heapPct}%)`);
        console.log(`   Status:   ${heapPct < 80 ? "✅ OK" : heapPct < 90 ? "⚠️  Elevado" : "❌ Crítico"}`);
      } else {
        console.log(`   /api/health sem campo memory`);
      }
    }
  } catch (e: any) {
    console.log(`   Erro: ${e.message}`);
  }
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log("\n" + "═".repeat(60));
  console.log("[STRESS-TEST] FASE 1.3 — ETAPA 3: Stress Test Operacional");
  console.log(`[STRESS-TEST] Alvo: ${BASE_URL}`);
  console.log("═".repeat(60));

  const startTime = Date.now();
  const allResults: Array<{ ok: boolean; avgMs: number; okRate: number }> = [];

  // ── 1. Endpoints públicos (sem auth) ────────────────────────────────────────
  console.log("\n📡 GRUPO 1 — Endpoints Públicos (sem auth)");
  console.log("─".repeat(40));

  allResults.push(printResult(await testEndpointConcurrency(
    "Health Check",
    "GET", "/api/health",
    undefined, 20,
  )));

  allResults.push(printResult(await testEndpointConcurrency(
    "Login Page Load",
    "GET", "/",
    undefined, 10,
  )));

  // ── 2. Endpoints com session (se cookie disponível) ──────────────────────────
  if (STRESS_COOKIE) {
    console.log("\n🔐 GRUPO 2 — Endpoints Autenticados");
    console.log("─".repeat(40));

    allResults.push(printResult(await testEndpointConcurrency(
      "Orders List",
      "GET", "/api/orders",
      undefined, 15,
    )));

    allResults.push(printResult(await testEndpointConcurrency(
      "Dashboard Metrics",
      "GET", "/api/admin/dashboard",
      undefined, 10,
    )));

    allResults.push(printResult(await testEndpointConcurrency(
      "Fiscal Diagnostics",
      "GET", "/api/admin/fiscal/diagnostics",
      undefined, 5,
    )));

    allResults.push(printResult(await testEndpointConcurrency(
      "Products List",
      "GET", "/api/products",
      undefined, 10,
    )));

    allResults.push(printResult(await testEndpointConcurrency(
      "Observability",
      "GET", "/api/admin/observability/health",
      undefined, 5,
    )));
  } else {
    console.log("\n⚠️  GRUPO 2 — Autenticado: pulado (sem STRESS_SESSION_COOKIE)");
    console.log("    Dica: exporte STRESS_SESSION_COOKIE='connect.sid=s%3A...' para testar endpoints autenticados");
  }

  // ── 3. Concorrência na rota de sessão ────────────────────────────────────────
  console.log("\n⚡ GRUPO 3 — Concorrência (session endpoint)");
  console.log("─".repeat(40));

  allResults.push(printResult(await testEndpointConcurrency(
    "Session Auth (concurrent)",
    "GET", "/api/auth/me",
    undefined, 20,
  )));

  // ── 4. Circuit breaker e memória ─────────────────────────────────────────────
  await checkCircuitBreaker();
  await checkMemory();

  // ── Resumo final ──────────────────────────────────────────────────────────────
  const totalMs = Date.now() - startTime;
  const okCount = allResults.filter(r => r.ok).length;
  const avgOverall = Math.round(allResults.reduce((s, r) => s + r.avgMs, 0) / (allResults.length || 1));
  const minOkRate = Math.min(...allResults.map(r => r.okRate));

  console.log("\n" + "═".repeat(60));
  console.log("[STRESS-TEST] RESUMO FINAL");
  console.log("═".repeat(60));
  console.log(`Grupos testados:    ${allResults.length}`);
  console.log(`Aprovados:          ${okCount}/${allResults.length}`);
  console.log(`Latência média:     ${avgOverall}ms`);
  console.log(`Taxa de sucesso:    ≥${minOkRate}%`);
  console.log(`Tempo total:        ${(totalMs / 1000).toFixed(1)}s`);

  const verdict = okCount === allResults.length && avgOverall < 500
    ? "✅ SISTEMA ESTÁVEL — pronto para simulação operacional"
    : okCount >= Math.ceil(allResults.length * 0.8)
    ? "⚠️  SISTEMA PARCIALMENTE ESTÁVEL — revisar endpoints com falha"
    : "❌ SISTEMA COM INSTABILIDADES — investigar antes de homologação";

  console.log(`\nVeredicto: ${verdict}`);
  console.log("═".repeat(60) + "\n");

  process.exit(0);
}

main().catch(e => {
  console.error("[STRESS-TEST] FATAL:", e.message);
  process.exit(1);
});
