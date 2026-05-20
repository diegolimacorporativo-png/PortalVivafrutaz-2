import { defineConfig } from "drizzle-kit";

// Prefer SUPABASE_DATABASE_URL (production Supabase) over DATABASE_URL (Replit local).
// This ensures db:push targets the correct database.
const dbUrl = process.env.SUPABASE_DATABASE_URL || process.env.DATABASE_URL;
if (!dbUrl) {
  throw new Error("SUPABASE_DATABASE_URL or DATABASE_URL must be set");
}

export default defineConfig({
  out: "./migrations",
  schema: "./shared/schema.ts",
  dialect: "postgresql",
  dbCredentials: {
    url: dbUrl,
    ssl: !!process.env.SUPABASE_DATABASE_URL,
  },
});
