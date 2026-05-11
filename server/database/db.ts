import dotenv from "dotenv";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "@shared/schema";

dotenv.config();

const { Pool } = pg;

// Em produção, exigir banco externo (Supabase) para evitar uso acidental do banco local.
if (process.env.NODE_ENV === "production" && !process.env.SUPABASE_DATABASE_URL) {
  throw new Error(
    "[DB] SUPABASE_DATABASE_URL é obrigatória em produção. Configure o secret antes de iniciar.",
  );
}

// Prefer SUPABASE_DATABASE_URL (external/persistent) over the Replit-managed DATABASE_URL.
const connectionString = process.env.SUPABASE_DATABASE_URL || process.env.DATABASE_URL;

console.log("[DB] DATABASE_URL presente:", !!process.env.DATABASE_URL);
console.log("[DB] SUPABASE_DATABASE_URL presente:", !!process.env.SUPABASE_DATABASE_URL);

if (!connectionString) {
  throw new Error(
    "DATABASE_URL não configurada. Configure SUPABASE_DATABASE_URL ou DATABASE_URL.",
  );
}

const isSupabase =
  !!process.env.SUPABASE_DATABASE_URL ||
  (connectionString.includes("supabase") || connectionString.includes("pooler.supabase"));

if (isSupabase) {
  console.log("[DB] Conectando ao Supabase (SSL ativado)...");
} else {
  console.log("[DB] Conectando ao banco local Replit...");
}

// T802 — Pool protection: cap connections, prevent idle leaks, fail fast on
// connection exhaustion so the app surfaces errors early instead of queueing
// requests indefinitely. Values are conservative defaults compatible with
// Supabase's pooler (max 10 per app instance) and Replit's Postgres.
// idleTimeoutMillis: close idle connections after 30s to release Supabase slots.
// connectionTimeoutMillis: fail within 5s rather than hanging indefinitely.
export const pool = new Pool({
  connectionString,
  ssl: isSupabase ? { rejectUnauthorized: false } : undefined,
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
});

export const db = drizzle(pool, { schema });
