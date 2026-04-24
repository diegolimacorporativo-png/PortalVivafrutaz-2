import expressSession, { type SessionOptions } from "express-session";
import MemoryStore from "memorystore";

/**
 * Shared `express-session` middleware factory.
 *
 * Architecture decision: session is a cross-cutting concern that EVERY
 * modular router and the legacy router need access to. Historically the
 * middleware was mounted inside `registerRoutes` (legacy routes), which
 * meant any modular router mounted BEFORE it received `req.session ===
 * undefined` and crashed on session reads/writes (e.g. `/api/auth/logout`).
 *
 * By centralising the factory here and mounting it in `app.ts` BEFORE the
 * module loader, every router shares the same session store and cookie
 * config — exact parity with the legacy setup is required so existing
 * sessions remain valid across the refactor.
 *
 * The configuration values (cookie name, secret, maxAge, sameSite, etc.)
 * mirror the legacy block from `server/routes/routes.ts` byte-for-byte.
 */
const SessionStore = MemoryStore(expressSession);

export function createSessionMiddleware() {
  const isProduction = process.env.NODE_ENV === "production";
  const options: SessionOptions = {
    secret: process.env.SESSION_SECRET || "super-secret-key",
    resave: false,
    saveUninitialized: false,
    store: new SessionStore({ checkPeriod: 86400000 }),
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
