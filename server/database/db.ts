import dotenv from "dotenv";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "@shared/schema";

dotenv.config();

const { Pool } = pg;

const _pid = process.pid;
const _env = process.env.NODE_ENV ?? "development";
const _ts = () => new Date().toISOString();

// ─────────────────────────────────────────────────────────────────────────────
// FAIL-FAST: SUPABASE_DATABASE_URL é obrigatória em TODOS os ambientes.
// DATABASE_URL (Replit/heliumdb) NUNCA é usado como fallback.
// ─────────────────────────────────────────────────────────────────────────────

const supabaseUrl = process.env.SUPABASE_DATABASE_URL;

if (!supabaseUrl) {
  console.error("[SUPABASE_REQUIRED]", {
    reason: "SUPABASE_DATABASE_URL não configurada. O sistema não pode iniciar sem ela.",
    fallback_used: "nenhum — fallback para DATABASE_URL é proibido",
    action: "Configure o secret SUPABASE_DATABASE_URL e reinicie.",
    env: _env,
    pid: _pid,
    ts: _ts(),
  });
  console.error("[BOOT_VALIDATION_FAIL]", {
    fails: ["SUPABASE_DATABASE_URL ausente"],
    env: _env,
    pid: _pid,
    ts: _ts(),
  });
  process.exit(1);
}

// Validações de hardening: bloquear URLs proibidas
const BLOCKED_PATTERNS: Array<{ pattern: RegExp | string; reason: string }> = [
  { pattern: /^sqlite/i,                      reason: "SQLite proibido" },
  { pattern: /:memory:/i,                     reason: "banco em memória proibido" },
  { pattern: /heliumdb/i,                     reason: "banco Replit (heliumdb) proibido" },
  { pattern: /localhost.*543[0-9]/,           reason: "PostgreSQL local proibido" },
  { pattern: /127\.0\.0\.1.*543[0-9]/,        reason: "PostgreSQL local proibido" },
  { pattern: /^(?!postgresql:\/\/|postgres:\/\/)/, reason: "protocolo não-PostgreSQL proibido" },
];

for (const { pattern, reason } of BLOCKED_PATTERNS) {
  const matched = typeof pattern === "string"
    ? supabaseUrl.includes(pattern)
    : pattern.test(supabaseUrl);

  if (matched) {
    console.error("[BOOT_VALIDATION_FAIL]", {
      reason,
      pattern: pattern.toString(),
      env: _env,
      pid: _pid,
      ts: _ts(),
    });
    process.exit(1);
  }
}

console.log("[DB_PROVIDER_SELECTED]", {
  provider: "supabase",
  source: "SUPABASE_DATABASE_URL",
  ssl: true,
  env: _env,
  pid: _pid,
  ts: _ts(),
});

console.log("[BOOT_VALIDATION_OK]", {
  provider: "supabase",
  env: _env,
  pid: _pid,
  ts: _ts(),
});

export const pool = new Pool({
  connectionString: supabaseUrl,
  ssl: { rejectUnauthorized: false },
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
});

// Apply statement_timeout on every new connection so no query can hang
// indefinitely and block a pool slot. 30 s covers all legitimate use cases
// (including backup reads and NF-e status queries); adjust per heavy path if
// needed.  This does NOT affect Supabase serverless — only our pool.
pool.on("connect", (client) => {
  client.query("SET statement_timeout = '30s'").catch((err) => {
    console.warn("[DB_STATEMENT_TIMEOUT_SET_FAILED]", {
      error: err?.message,
      ts: new Date().toISOString(),
    });
  });
});

export const db = drizzle(pool, { schema });
