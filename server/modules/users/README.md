# Users Module

Manages the internal `users` table (admins, operators, drivers, finance, etc.).
Companies (B2B clients) live in a separate table and are NOT handled here.

## Layout

```
users/
├── users.types.ts         re-exports User/InsertUser, defines SafeUser
├── users.validation.ts    Zod schemas (extend insertUserSchema)
├── users.repository.ts    delegates to legacy storage facade
├── users.service.ts       business rules + audit logs
├── users.controller.ts    thin HTTP adapter
├── users.routes.ts        method/path → middleware → controller
└── index.ts               exports `definition` for the loader
```

## Endpoints (mounted at `/api/users`)

| Method | Path             | Purpose                                    |
| ------ | ---------------- | ------------------------------------------ |
| GET    | `/`              | List users (passwords masked as `"***"`)   |
| POST   | `/`              | Create user                                |
| PUT    | `/:id`           | Update user (password `"***"` = no change) |
| DELETE | `/:id`           | Delete user                                |
| PUT    | `/:id/password`  | Privileged password change with audit log  |

## Backward-compat notes

- **Response shape**: returns RAW arrays/objects (not the `{success,data}`
  envelope) because the existing frontend in `client/src/pages/admin/users.tsx`
  consumes `res.json()` directly. Switching to the standard envelope is a
  follow-up, paired with a frontend update.
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
