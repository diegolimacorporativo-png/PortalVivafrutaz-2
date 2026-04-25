# Users Module

Manages the internal `users` table (admins, operators, drivers, finance, etc.).
Companies (B2B clients) live in a separate table and are NOT handled here.

## Layout

```
users/
├── users.types.ts         re-exports User/InsertUser, defines SafeUser + DTOs
├── users.validation.ts    Zod schemas (extend insertUserSchema)
├── users.repository.ts    delegates to legacy storage facade
├── users.service.ts       business rules + audit logs
├── users.controller.ts    thin HTTP adapter
├── users.routes.ts        method/path → middleware → controller
└── index.ts               exports `definition` for the loader
```

## Shared layer usage

| Import | Source |
| ------ | ------ |
| `AppError`, `ConflictError`, `ForbiddenError`, `NotFoundError` | `shared/errors/AppError` |
| `asyncHandler` | `shared/utils/asyncHandler` |
| `validate` | `shared/middlewares/validate` |

`shared/utils/apiResponse` (`ok/created/noContent`) is intentionally deferred
— see **Backward-compat notes** below.

## Endpoints (mounted at `/api/users`)

| Method | Path             | Body / params schema     | Purpose                                    |
| ------ | ---------------- | ------------------------ | ------------------------------------------ |
| GET    | `/`              | —                        | List users (passwords masked as `"***"`)   |
| POST   | `/`              | `createUserSchema`       | Create user                                |
| PUT    | `/:id`           | `updateUserSchema`       | Update user (password `"***"` = no change) |
| DELETE | `/:id`           | —                        | Delete user                                |
| PUT    | `/:id/password`  | `changePasswordSchema`   | Privileged password change with audit log  |

## Architecture invariants

- **Controller** — thin HTTP adapter only. Pulls `req.body`/`req.params`, calls
  service, shapes response. No business logic, no Zod, no try/catch.
- **Service** — owns all business rules. No `req`/`res`. No direct storage
  access. Writes audit logs through the repository.
- **Repository** — single point of DB/storage access. Delegates to the legacy
  `storage` facade; direct Drizzle queries are the migration target when
  `storage` is split per-domain.
- **Validation** — happens in middleware (`validate` from `shared/middlewares`)
  before the controller is ever called.
- **Errors** — thrown as typed `AppError` subclasses; caught by the central
  `errorHandler` which produces `{ success: false, error }`.

## Backward-compat notes

- **Response shape**: returns RAW arrays/objects (not the `{success,data}`
  envelope) because the existing frontend in `client/src/pages/admin/users.tsx`
  consumes `res.json()` directly. Migrating to the standard envelope requires a
  paired frontend pass using `useSafeListQuery`/`useSafeQuery` so both the old
  and new shapes are tolerated during the transition window.
- **Auth**: CRUD routes do not enforce `requireAuth`, mirroring the legacy
  behaviour. The privileged password-change endpoint enforces the exact same
  role gate (`MASTER` / `ADMIN` / `DIRECTOR` / `DEVELOPER`) and emits the same
  `PASSWORD_CHANGE_BLOCKED` / `PASSWORD_CHANGED` security logs.

## Migrated from `server/routes/routes.ts`

| Legacy line | Endpoint                          |
| ----------- | --------------------------------- |
| 1678        | `GET    /api/users`               |
| 1686        | `POST   /api/users`               |
| 1695        | `PUT    /api/users/:id`           |
| 1710        | `DELETE /api/users/:id`           |
| 3249        | `PUT    /api/users/:id/password`  |

The legacy handlers stay in place; the modular router is mounted FIRST in
`server/app.ts`, so these paths now resolve to this module while every other
legacy route keeps working untouched.
