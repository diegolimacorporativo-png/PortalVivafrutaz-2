---
name: Internal incidents tenant scope
description: Security boundary for internal incidents, including RBAC, ownership, and assignee validation.
---

Internal incidents are staff-only. Listing may use an explicit global scope for the existing global roles, but create, update, and delete require a concrete tenant resolved by `tenantContext`. Every tenant-bound mutation must include the incident ID and tenant ID in the database predicate. PATCH accepts only workflow fields; `empresaId`, creator fields, and arbitrary columns are never client-controlled.

An assigned user must have `users.empresaId` equal to the incident tenant. The server derives the assignee name from that user instead of trusting `assignedToName` from the request.

**Why:** Incident IDs, tenant identifiers, and assignee IDs are client-controlled inputs. Unscoped operations or cross-tenant user selection can expose or mutate another company's internal data.

**How to apply:** Keep authorization and tenant resolution at the route boundary, use scoped storage methods for list/update/delete, return 404 for an incident outside the resolved tenant, and require a tenant for all writes.