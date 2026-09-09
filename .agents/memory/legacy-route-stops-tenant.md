---
name: Legacy route stops authorization
description: Tenant and role policy for the legacy route-stops API.
---

The legacy route-stops surface must authorize through `route_stops.route_id`
and the referenced logistics route's `empresa_id`. Treat `route_stops.company_id`
as legacy/snapshot data, not as the source of truth for ownership.

**Why:** The old handlers accepted route and stop identifiers without session,
tenant, or ownership checks, allowing public reads and ID-based cross-tenant
mutations. A stop's company field may also be absent or stale in older data.

**How to apply:** Require an authenticated logistics role, resolve the route
inside the tenant before every operation, constrain updates/deletes by both
route and stop ID, derive ownership fields on create, and allow global access
only for explicitly global `MASTER`/`DIRECTOR` actors. Unbound administrative
profiles must fail closed.