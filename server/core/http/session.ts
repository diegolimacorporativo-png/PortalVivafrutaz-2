/**
 * Shared `express-session` middleware factory.
 *
 * C4-FIX: Replaced MemoryStore (process-local, lost on restart, single-instance
 * only) with connect-pg-simple backed by the existing PostgreSQL pool. Sessions
 * now survive restarts and are consistent across multiple instances.
 *
 * The `sessions` table is auto-created by connect-pg-simple on first boot
 * (`createTableIfMissing: true`). Schema matches the library default:
 *   CREATE TABLE "session" (
 *     "sid" varchar NOT NULL COLLATE "default",
 *     "sess" json NOT NULL,
 *     "expire" timestamp(6) NOT NULL
 *   )
 *
 * Configuration values (cookie name, secret, maxAge, sameSite, etc.)
 * mirror the legacy MemoryStore setup byte-for-byte so existing sessions
 * with the old cookie still cleanly expire without compatibility issues.
 */
import expressSession, { type SessionOptions } from "express-session";
import connectPgSimple from "connect-pg-simple";
import { pool } from "../../database/db";

const PgSessionStore = connectPgSimple(expressSession);

export function createSessionMiddleware() {
  if (!process.env.SESSION_SECRET) {
    throw new Error("SESSION_SECRET não configurado");
  }
  const isProduction = process.env.NODE_ENV === "production";
  const options: SessionOptions = {
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    store: new PgSessionStore({
      pool,
      createTableIfMissing: true,
      // Prune expired sessions every 24h
      pruneSessionInterval: 60 * 60 * 24,
    }),
    cookie: {
      maxAge: 86400000,
      httpOnly: true,
      secure: isProduction,
      sameSite: "lax",
      path: "/",
    },
    name: "sessionId",
  };
  return expressSession(options);
}
