/**
 * FASE 2+3 — Observability routes (MASTER only).
 *
 * GET  /api/admin/observability/errors          — list operational errors
 * DELETE /api/admin/observability/errors        — clear error store
 * GET  /api/admin/observability/metrics         — current metrics snapshot
 * POST /api/admin/observability/metrics/reset   — reset metrics
 * GET  /api/admin/observability/jobs            — FASE 3.1 job registry
 * GET  /api/admin/observability/dead-letters    — FASE 3.1 outbox dead-letters
 * GET  /api/admin/observability/db-health       — FASE 3.5 Supabase/PG stats
 * GET  /api/admin/observability/restore-check   — FASE 3.4 schema integrity
 * GET  /api/admin/observability/fiscal          — FASE NF-e 1.2 T1205 fiscal store
 * POST /api/admin/observability/fiscal/reset    — FASE NF-e 1.2 T1205 reset fiscal store
 */

import type { Express } from "express";
import { requireAuth, requireRole } from "../core/http/requireAuth";
import { getErrors, clearErrors, errorCount } from "../core/observability/error-store";
import { getMetrics, resetMetrics } from "../core/observability/metrics";
import { getJobRegistry } from "../core/jobs/job-registry";
import { db, pool } from "../database/db";
import { sql } from "drizzle-orm";
import { workflowEvents } from "@shared/schema";
import { eq, desc, and, gt } from "drizzle-orm";
import { getFiscalSnapshot, resetFiscalStore } from "../core/nfe/fiscal-store";
import { getCircuitState } from "../services/nfe/sefazCircuitBreaker";

export function register(app: Express): void {
  // ── GET /api/admin/observability/errors ─────────────────────────────
  app.get(
    "/api/admin/observability/errors",
    requireAuth,
    requireRole(["MASTER"]),
    (req, res) => {
      const limit = Math.min(Number(req.query.limit ?? 200), 500);
      const severity = req.query.severity as string | undefined;

      let data = getErrors(limit);
      if (severity === "ERROR" || severity === "WARN") {
        data = data.filter((e) => e.severity === severity);
      }

      return res.json({
        success: true,
        data,
        meta: { total: errorCount(), returned: data.length },
      });
    },
  );

  // ── DELETE /api/admin/observability/errors ──────────────────────────
  app.delete(
    "/api/admin/observability/errors",
    requireAuth,
    requireRole(["MASTER"]),
    (_req, res) => {
      clearErrors();
      return res.json({ success: true, message: "Error store cleared" });
    },
  );

  // ── GET /api/admin/observability/metrics ────────────────────────────
  app.get(
    "/api/admin/observability/metrics",
    requireAuth,
    requireRole(["MASTER"]),
    (_req, res) => {
      return res.json({ success: true, data: getMetrics() });
    },
  );

  // ── POST /api/admin/observability/metrics/reset ─────────────────────
  app.post(
    "/api/admin/observability/metrics/reset",
    requireAuth,
    requireRole(["MASTER"]),
    (_req, res) => {
      resetMetrics();
      return res.json({ success: true, message: "Metrics reset" });
    },
  );

  // ── GET /api/admin/observability/jobs ── FASE 3.1 ───────────────────
  app.get(
    "/api/admin/observability/jobs",
    requireAuth,
    requireRole(["MASTER"]),
    (_req, res) => {
      const jobs = getJobRegistry();
      return res.json({
        success: true,
        data: jobs,
        meta: {
          total: jobs.length,
          running: jobs.filter((j) => j.isRunning).length,
          withErrors: jobs.filter((j) => j.totalErrors > 0).length,
        },
      });
    },
  );

  // ── GET /api/admin/observability/dead-letters ── FASE 3.1 ───────────
  app.get(
    "/api/admin/observability/dead-letters",
    requireAuth,
    requireRole(["MASTER"]),
    async (_req, res) => {
      try {
        const rows = await db
          .select({
            id: workflowEvents.id,
            orderId: workflowEvents.orderId,
            eventType: workflowEvents.eventType,
            retryCount: workflowEvents.retryCount,
            deadLetter: workflowEvents.deadLetter,
            errorMessage: workflowEvents.errorMessage,
            createdAt: workflowEvents.createdAt,
            nextRetryAt: workflowEvents.nextRetryAt,
          })
          .from(workflowEvents)
          .where(eq(workflowEvents.deadLetter, true))
          .orderBy(desc(workflowEvents.createdAt))
          .limit(200);

        const stuckRows = await db
          .select({
            id: workflowEvents.id,
            orderId: workflowEvents.orderId,
            eventType: workflowEvents.eventType,
            retryCount: workflowEvents.retryCount,
            deadLetter: workflowEvents.deadLetter,
            errorMessage: workflowEvents.errorMessage,
            createdAt: workflowEvents.createdAt,
            nextRetryAt: workflowEvents.nextRetryAt,
          })
          .from(workflowEvents)
          .where(
            and(
              eq(workflowEvents.deadLetter, false),
              gt(workflowEvents.retryCount, 2),
              sql`${workflowEvents.processedAt} IS NULL`,
            ),
          )
          .orderBy(desc(workflowEvents.retryCount))
          .limit(50);

        return res.json({
          success: true,
          data: { deadLetters: rows, stuckEvents: stuckRows },
          meta: { deadLetterCount: rows.length, stuckCount: stuckRows.length },
        });
      } catch (err: any) {
        return res.status(500).json({ success: false, error: err?.message ?? "db_error" });
      }
    },
  );

  // ── GET /api/admin/observability/db-health ── FASE 3.5 ──────────────
  app.get(
    "/api/admin/observability/db-health",
    requireAuth,
    requireRole(["MASTER"]),
    async (_req, res) => {
      try {
        const client = await pool.connect();
        try {
          const connResult = await client.query(`
            SELECT
              count(*) FILTER (WHERE state = 'active') AS active_connections,
              count(*) FILTER (WHERE state = 'idle') AS idle_connections,
              count(*) AS total_connections
            FROM pg_stat_activity
            WHERE datname = current_database()
          `);
          const sizeResult = await client.query(`
            SELECT pg_size_pretty(pg_database_size(current_database())) AS db_size,
                   pg_database_size(current_database()) AS db_size_bytes
          `);
          const lockResult = await client.query(`
            SELECT
              count(*) AS total_locks,
              count(*) FILTER (WHERE NOT granted) AS waiting_locks
            FROM pg_locks
          `);
          const tablesResult = await client.query(`
            SELECT
              relname AS table_name,
              n_live_tup AS live_rows,
              n_dead_tup AS dead_rows,
              pg_size_pretty(pg_total_relation_size(oid)) AS total_size
            FROM pg_stat_user_tables
            ORDER BY n_live_tup DESC
            LIMIT 10
          `);
          const slowResult = await client.query(`
            SELECT
              pid,
              now() - pg_stat_activity.query_start AS duration,
              query,
              state
            FROM pg_stat_activity
            WHERE query_start IS NOT NULL
              AND state != 'idle'
              AND (now() - pg_stat_activity.query_start) > interval '5 seconds'
              AND datname = current_database()
            ORDER BY duration DESC
            LIMIT 5
          `);
          const poolStats = {
            totalCount: (pool as any).totalCount ?? null,
            idleCount: (pool as any).idleCount ?? null,
            waitingCount: (pool as any).waitingCount ?? null,
          };
          return res.json({
            success: true,
            data: {
              connections: connResult.rows[0],
              storage: sizeResult.rows[0],
              locks: lockResult.rows[0],
              topTables: tablesResult.rows,
              slowQueries: slowResult.rows.map((r) => ({
                pid: r.pid,
                duration: r.duration,
                state: r.state,
                queryPreview: String(r.query ?? "").slice(0, 200),
              })),
              pool: poolStats,
              checkedAt: new Date().toISOString(),
            },
          });
        } finally {
          client.release();
        }
      } catch (err: any) {
        return res.status(500).json({ success: false, error: err?.message ?? "db_error" });
      }
    },
  );

  // ── GET /api/admin/observability/restore-check ── FASE 3.4 ──────────
  app.get(
    "/api/admin/observability/restore-check",
    requireAuth,
    requireRole(["MASTER"]),
    async (_req, res) => {
      const checks: Array<{ name: string; ok: boolean; detail?: string }> = [];

      try {
        await db.execute(sql`SELECT 1`);
        checks.push({ name: "db_connectivity", ok: true });
      } catch (err: any) {
        checks.push({ name: "db_connectivity", ok: false, detail: err?.message });
      }

      const criticalTables = [
        "users", "companies", "orders", "order_items", "products",
        "nfe_emissoes", "workflow_events", "sessions", "system_settings",
        "logistics_routes", "logistics_drivers",
      ];
      for (const table of criticalTables) {
        try {
          await db.execute(sql.raw(`SELECT 1 FROM ${table} LIMIT 1`));
          checks.push({ name: `table_${table}`, ok: true });
        } catch (err: any) {
          checks.push({ name: `table_${table}`, ok: false, detail: err?.message });
        }
      }

      try {
        await db.execute(sql`SELECT COUNT(*) FROM session WHERE expire < NOW() LIMIT 1`);
        checks.push({ name: "session_table", ok: true });
      } catch (err: any) {
        checks.push({ name: "session_table", ok: false, detail: err?.message });
      }

      try {
        await db.execute(sql`SELECT company_id FROM orders LIMIT 1`);
        checks.push({ name: "tenant_column_orders", ok: true });
      } catch (err: any) {
        checks.push({ name: "tenant_column_orders", ok: false, detail: err?.message });
      }

      try {
        await db.execute(sql`SELECT dead_letter FROM workflow_events LIMIT 1`);
        checks.push({ name: "dead_letter_column", ok: true });
      } catch (err: any) {
        checks.push({ name: "dead_letter_column", ok: false, detail: err?.message });
      }

      const allOk = checks.every((c) => c.ok);
      const failed = checks.filter((c) => !c.ok);

      return res.status(allOk ? 200 : 207).json({
        success: allOk,
        data: { checks, summary: { total: checks.length, passed: checks.filter((c) => c.ok).length, failed: failed.length } },
        message: allOk ? "Schema integrity OK" : `${failed.length} check(s) failed`,
      });
    },
  );

  // ── GET /api/admin/observability/fiscal ── FASE NF-e 1.2 T1205 ──────
  app.get(
    "/api/admin/observability/fiscal",
    requireAuth,
    requireRole(["MASTER"]),
    (_req, res) => {
      const snapshot = getFiscalSnapshot();
      const circuit = getCircuitState();
      return res.json({
        success: true,
        data: {
          ...snapshot,
          circuit: {
            state: circuit.state,
            failures: circuit.failures,
            isOpen: circuit.isOpen,
            openedAt: circuit.openedAt,
            totalOpenings: circuit.totalOpenings,
          },
        },
      });
    },
  );

  // ── POST /api/admin/observability/fiscal/reset ── FASE NF-e 1.2 ─────
  app.post(
    "/api/admin/observability/fiscal/reset",
    requireAuth,
    requireRole(["MASTER"]),
    (_req, res) => {
      resetFiscalStore();
      return res.json({ success: true, message: "Fiscal store reset" });
    },
  );
}
