---
name: Order exceptions tenant scope
description: Authorization and ownership rules for the order-exceptions CRUD and company check.
---

Order exceptions are tenant-owned by `companyId`. Tenant-bound users must not be able to select a different company through body fields, IDs, or company-check paths. CRUD mutations must constrain the database operation by both exception ID and the current tenant; global listing or mutation is reserved for explicitly global roles.

**Why:** The legacy routes listed all rows, trusted `companyId` from the request body, and updated/deleted by ID alone, allowing cross-tenant reads and mutations.

**How to apply:** Keep `ADMIN` tenant-bound when linked to a company. Only `MASTER` and tenantless `DIRECTOR` may select a target company or use an intentionally global list. Preserve `401` for unauthenticated requests, `403` for disallowed roles, and `404` for hidden cross-tenant resources.