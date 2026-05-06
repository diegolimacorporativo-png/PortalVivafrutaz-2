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

export const pool = new Pool({
  connectionString,
  ssl: isSupabase ? { rejectUnauthorized: false } : undefined,
});

export const db = drizzle(pool, { schema });
