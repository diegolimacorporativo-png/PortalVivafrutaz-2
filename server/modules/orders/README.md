# Orders module

Structural migration of the orders endpoints out of the monolithic
`server/routes/routes.ts` into the standard module layout used by `finance`
and `users`.

## Layout

| File                    | Responsibility                                   |
| ----------------------- | ------------------------------------------------ |
| `index.ts`              | Module definition `{ name, basePath, router }`.  |
| `orders.routes.ts`      | HTTP wiring (method + path + middleware chain).  |
| `orders.controller.ts`  | Thin HTTP adapter — req in, envelope out.        |
| `orders.service.ts`     | Business rules / orchestration. No HTTP.         |
| `orders.repository.ts`  | Persistence. Currently delegates to `storage`.   |
| `orders.types.ts`       | Re-exports + module DTOs.                        |
| `orders.validation.ts`  | Zod schemas for params / query / body.           |

## Migration status

| Endpoint                              | Status      | Owner             |
| ------------------------------------- | ----------- | ----------------- |
| `GET    /api/orders`                  | ✅ migrated | this module       |
| `GET    /api/orders/:id`              | ✅ migrated | this module       |
| `GET    /api/companies/:id/orders`    | ⏳ legacy   | `routes/routes.ts`|
| `POST   /api/orders`                  | 🚧 legacy   | `routes/routes.ts`|
| `PATCH  /api/orders/:id`              | 🚧 legacy   | `routes/routes.ts`|
| `DELETE /api/orders/:id`              | 🚧 legacy   | `routes/routes.ts`|
| `DELETE /api/orders/bulk`             | 🚧 legacy   | `routes/routes.ts`|
| `*      /api/orders/:id/*` (actions)  | 🚧 legacy   | `routes/routes.ts`|

The migrated GETs return the standard envelope:

```json
{ "success": true, "data": [ ... ] }            // list
{ "success": true, "data": { "order": {...}, "items": [ ... ] } }   // detail
```

Frontend callers must run responses through `normalizeList` / `normalizeOne`
(or use `useSafeListQuery` / `useSafeQuery`) to be tolerant of both the new
envelope and the legacy raw shape during the migration window.

## Why some routes are still legacy

`POST /api/orders` and the other mutation/action endpoints carry significant
side-effects (push notifications, transactional emails, auto-logistics
delivery creation, accounts-receivable seeding, duplicate-submit window,
maintenance/test-mode interception, fiscal export to Bling, NFE pre-number
generation, …). Per the migration brief, business rules and workflow logic
move in a separate, dedicated pass — this iteration is structural only.

## Sibling-path safety

The legacy router still owns `GET /api/orders/export` and
`GET /api/orders/reopen-requests`. The controller's `ensureNumericId` guard
on `/:id` calls `next()` when the segment isn't a positive integer, letting
Express continue down the middleware chain and reach those legacy handlers.
