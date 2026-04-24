# Auth Module — `STUB`

## Scope when implemented
- Login / logout (employee + company portal)
- Session lifecycle, password reset flow, login lockout

## What to migrate from `server/routes/routes.ts`
- All `/api/auth/*` routes
- The session/Passport setup currently inside `registerRoutes`

## Files to create (mirror the finance module)
```
auth.types.ts | auth.repository.ts | auth.service.ts
auth.controller.ts | auth.routes.ts | auth.validation.ts | index.ts
```
Then add `authModule` to `MODULES` in `server/modules/index.ts`.
