# VivaFrutaz — Corporate fruit ordering platform (ERP) with orders, invoicing, logistics, billing, and analytics.

## Run & Operate
- **Dev:** `npm run dev` (starts Express + Vite on port 5000)
- **Build:** `npm run build`
- **Production:** `npm start`
- **DB push:** `npm run db:push`
- **Typecheck:** `npm run check`
- **Required env vars:** `DATABASE_URL` (Replit Postgres, auto-set), optionally `SUPABASE_DATABASE_URL` for production external DB. Optional: `ITAU_CLIENT_ID`, `ITAU_CLIENT_SECRET`, `ITAU_AGENCIA`, `ITAU_CONTA`, `ITAU_AMBIENTE`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `BILLING_WEBHOOK_SECRET`

## Stack
- **Runtime:** Node.js 20, TypeScript (tsx for dev, esbuild for prod)
- **Backend:** Express v5
- **Frontend:** React 18 + Vite 7 + TailwindCSS v3 + shadcn/ui (Radix)
- **ORM:** Drizzle ORM + drizzle-kit (PostgreSQL)
- **Validation:** Zod
- **Auth:** Custom session-based (express-session + connect-pg-simple + bcryptjs)
- **Routing (client):** Wouter
- **State:** TanStack Query v5

## Where things live
- `server/` — Express backend
- `client/src/` — React frontend
- `shared/schema.ts` — Drizzle schema (source of truth for DB)
- `server/modules/` — Domain modules (auth, orders, billing, fiscal, logistics, inventory, finance)
- `server/core/` — Security, session, errors, events
- `server/routes/routes.ts` — Route registration
- `vite.config.ts` — Vite config

## Architecture decisions
- Dev server runs Vite in middleware mode inside the same Express process (no separate port)
- Sessions stored in PostgreSQL via connect-pg-simple; tokenVersion in DB enables global logout
- Production DB requires `SUPABASE_DATABASE_URL`; dev uses Replit's `DATABASE_URL`
- Module system: v1/v2 API versioning with `registerModules`, `registerV1Modules`, `registerV2Modules`
- Background workers (outbox, auto-dispatch, billing cron, faturamento, analytics, alerts) start on server boot
- **API 404 guard placement**: `vite.middlewares` (Connect server) swallows ALL unmatched requests — Express middleware registered after `registerRoutes()` in `buildApp()` is never reached for unmatched routes. Guard must live in `server/vite.ts` **before** `app.use(vite.middlewares)` (dev) and inside the `/{*path}` handler in `server/static.ts` (prod).

## Product
- Multi-tenant ERP for fruit distribution companies
- Customer portal (Portal do Cliente) + internal team access (Acesso da Equipe)
- Orders, NF-e fiscal invoicing, logistics dispatch, inventory, billing/subscriptions, financial reports
- AI assistant (Clara), push notifications, email alerts, PDF/XLSX export

## User preferences
_Populate as you build_

## Gotchas
- `tsx` is installed locally — use `tsx` directly (not `npx tsx`) in scripts
- Production mode enforces `SUPABASE_DATABASE_URL` — will throw on startup without it; use Replit's `DATABASE_URL` for dev
- SMTP config is loaded from DB first, env vars as fallback
- VAPID keys missing = push notifications silently disabled (logged at startup)

## Pointers
- DB schema: `shared/schema.ts`
- Auth flow: `server/modules/auth/`
- Session config: `server/core/http/session.ts`
