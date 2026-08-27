# VivaFrutaz PNPM workspace migration

## Purpose

The ERP remains the reference application. This migration adds workspace
boundaries without moving runtime files or changing the current entry points.

## Workspace packages

| Workspace | Current responsibility |
|---|---|
| `@vivafrutaz/web` | React/Vite Web and PWA under `client/` |
| `@vivafrutaz/api` | Express/TypeScript API and workers under `server/` |
| `@vivafrutaz/shared` | Shared schema and contracts under `shared/` |

The root package remains the compatibility shell because the current Vite
configuration, server build, Cloudflare asset build, tests, and Replit
workflow all intentionally resolve paths from the repository root.

## Preserved contracts

- `npm run dev` remains the development entry point.
- `npm run build` still builds `client/` with Vite and `server/index.ts` with
  esbuild into `dist/`.
- The Cloudflare Worker remains in `worker/` and continues to proxy the Node
  backend.
- No database or schema operation is part of this migration.
- Authentication, sessions, PWA assets, Service Worker, maps, routes,
  deliveries, `DriverGpsReporter`, and `POST /api/driver/gps` are unchanged.

## Future extraction rule

Physical moves into `apps/` or independent package dependency graphs require a
separate migration with import-graph, build, deployment, and runtime parity
validation. They are deliberately not part of this compatibility-first pass.