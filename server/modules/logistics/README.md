# Logistics module

Owns all `/api/logistics/*` endpoints: drivers, vehicles, routes, route stops,
maintenance, and the analytical/planning endpoints (route assistant, day
orders, simulate-day, smart-route-plan, calculate-distance, geo/cep,
smart-search, best-driver, route-insertion, audit-logs, deliveries report).

## Layout

```
logistics/
├── logistics.types.ts       Re-exports schema types + view-model interfaces
├── logistics.repository.ts  Thin pass-through over services/storage
├── logistics.service.ts     Pure business logic (no Express)
├── logistics.controller.ts  HTTP adapter; per-endpoint auth gates
├── logistics.routes.ts      Wires method+path → controller
├── index.ts                 `definition` consumed by server/modules/index.ts
└── README.md                You are here.
```

## Endpoints (32)

| Method | Path                                      | Auth model       |
|--------|-------------------------------------------|------------------|
| GET    | /api/logistics/drivers                    | logAuth          |
| POST   | /api/logistics/drivers                    | logAuth          |
| PATCH  | /api/logistics/drivers/:id                | logAuth          |
| DELETE | /api/logistics/drivers/:id                | logAuth          |
| GET    | /api/logistics/vehicles                   | logAuth          |
| POST   | /api/logistics/vehicles                   | logAuth          |
| PATCH  | /api/logistics/vehicles/:id               | logAuth          |
| DELETE | /api/logistics/vehicles/:id               | logAuth          |
| GET    | /api/logistics/routes                     | logAuth          |
| POST   | /api/logistics/routes                     | logAuth          |
| PATCH  | /api/logistics/routes/:id                 | logAuth          |
| DELETE | /api/logistics/routes/:id                 | logAuth          |
| GET    | /api/logistics/maintenance                | logAuth          |
| POST   | /api/logistics/maintenance                | logAuth          |
| PATCH  | /api/logistics/maintenance/:id            | logAuth          |
| DELETE | /api/logistics/maintenance/:id            | logAuth          |
| GET    | /api/logistics/route-assistant            | session-only     |
| POST   | /api/logistics/suggest-route              | session-only     |
| GET    | /api/logistics/day-orders                 | session-only     |
| POST   | /api/logistics/simulate-day               | session-only     |
| POST   | /api/logistics/calculate-distance         | none             |
| GET    | /api/logistics/audit-logs                 | admin-only       |
| GET    | /api/logistics/reports/deliveries         | session-only     |
| GET    | /api/logistics/routes/:routeId/stops      | none             |
| POST   | /api/logistics/routes/:routeId/stops      | none             |
| PATCH  | /api/logistics/routes/:routeId/stops/:id  | none             |
| DELETE | /api/logistics/routes/:routeId/stops/:id  | none             |
| GET    | /api/logistics/geo/cep/:cep               | none             |
| GET    | /api/logistics/smart-search               | none             |
| GET    | /api/logistics/best-driver                | none             |
| POST   | /api/logistics/route-insertion            | none             |
| GET    | /api/logistics/smart-route-plan           | session-only     |

`logAuth` allows: MASTER, ADMIN, DIRECTOR, DEVELOPER, OPERATIONS_MANAGER, LOGISTICS.
`admin-only` allows: MASTER, ADMIN, DIRECTOR, LOGISTICS, DEVELOPER.

## Design notes

- **Behaviour preservation is the only contract.** Every response shape,
  error message, and status code mirrors the legacy inline handlers in
  `server/routes/routes.ts` exactly. The frontend reads `{ message }` raw
  (not the v2 envelope) for these endpoints, so we do not normalise.
- **Repository delegates to legacy storage.** This module does not own its
  Drizzle queries — it forwards to `services/storage` to avoid drift with
  the many cross-cutting call sites (driver panel, public tracking,
  delivery checklist) that share the same tables. Pulling queries into
  Drizzle here is a future incremental task.
- **No router-wide auth.** Six endpoints are intentionally public (geo
  helpers, distance calc, smart search, best-driver, route-insertion,
  route-stops CRUD); each handler enforces its own gate.
- **External services** (`viacep`, `nominatim`, `routeOptimizer`) are
  imported dynamically — same as the legacy code — so cold paths don't pay
  the import cost.
