import { defineConfig } from "drizzle-kit";

// The application is intentionally coupled to the external Supabase database.
// Never fall back to Replit's runtime-managed DATABASE_URL.
const dbUrl = process.env.SUPABASE_DATABASE_URL;
if (!dbUrl) {
  throw new Error("SUPABASE_DATABASE_URL must be set");
}

export default defineConfig({
  out: "./migrations",
  schema: "./shared/schema.ts",
  dialect: "postgresql",
  dbCredentials: {
    url: dbUrl,
    ssl: true,
  },
});
