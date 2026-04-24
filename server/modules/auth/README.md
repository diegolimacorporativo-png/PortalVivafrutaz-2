# Auth Module

Owns the authentication surface: login (admin OR company), session lookup,
logout, forgot-password, and the unauthorized-access security log.

## Layout

```
auth/
├── auth.types.ts         re-exports User/Company, defines LoginInput/LoginOutcome
├── auth.validation.ts    Zod schemas (loginSchema reuses api.auth.login.input)
├── auth.repository.ts    delegates to legacy storage facade
├── auth.service.ts       business rules + bcrypt + lockout + audit logs
├── auth.controller.ts    thin HTTP adapter, owns session save/destroy
├── auth.routes.ts        method/path → controller
└── index.ts              exports `definition` for the loader
```

## Endpoints (mounted at `/api/auth`)

| Method | Path                | Purpose                                            |
| ------ | ------------------- | -------------------------------------------------- |
| POST   | `/login`            | Admin OR company login (`type: 'admin'\|'company'`) |
| GET    | `/me`               | Returns `{user}` or `{company}` for current session |
| POST   | `/logout`           | Destroys the session                               |
| POST   | `/forgot-password`  | Client-portal password-reset request               |
| POST   | `/log-unauthorized` | Best-effort log of an unauthorized-route attempt   |

## Behaviour preserved verbatim

- **Session writes**: admin login sets `session.userId` + `session.userType
  = 'admin'`; company login sets `session.companyId` + `session.userType
  = 'company'`. Saved via `req.session.save(...)` BEFORE responding so the
  immediate `/me` round-trip from the frontend sees the cookie.
- **Account lockout**: 3 wrong attempts → `isLocked = true`, status `423`,
  Portuguese message identical to legacy, plus an `ACCOUNT_LOCKED` log per
  ADMIN/DIRECTOR/DEVELOPER user (best-effort).
- **Plaintext-to-bcrypt upgrade**: legacy seeded passwords are upgraded on
  first correct login.
- **Maintenance mode**: blocks company logins (status `503`, body
  `{message: 'MAINTENANCE_MODE'}`); admin/staff login is never blocked.
- **Security-by-obscurity**: any malformed login body returns
  `{message: 'Usuário ou senha incorretos.'}` (status 400) — Zod details are
  never exposed.
- **Audit logs**: `LOGIN`, `LOGIN_FAILED`, `LOGIN_BLOCKED`, `ACCOUNT_LOCKED`,
  `UNAUTHORIZED_ACCESS` are written through the repository so the
  security-logs UI keeps working unchanged.
- **Response format**: raw `{user}` / `{company}` on success and raw
  `{message}` on failure — NOT the `{success,data}` / `{success,error}`
  envelope used by `finance`. Matches `useAuth` and the login page exactly.

## Migrated from `server/routes/routes.ts`

| Legacy line | Endpoint                          |
| ----------- | --------------------------------- |
| 1331        | `POST /api/auth/login`            |
| 1487        | `GET  /api/auth/me`               |
| 1503        | `POST /api/auth/logout`           |
| 1576        | `POST /api/auth/forgot-password`  |
| 3370        | `POST /api/auth/log-unauthorized` |

The legacy handlers stay in place; the modular router is mounted FIRST in
`server/app.ts`, so these paths now resolve to this module while every other
legacy route keeps working untouched.
