---
name: Client incidents tenant scope
description: Ownership and global-role rules for the customer incident module.
---

Customer incidents are tenant-bound at the HTTP boundary. Company sessions and admins with `user.empresaId` can only read or mutate rows from that tenant; only explicitly global roles may use an unpinned global scope or select another tenant. ID-based update, delete, response, message, and mark-read flows must verify incident ownership, preferably in the same database predicate for mutations. Client-supplied `companyId` is ignored when a tenant is already resolved.

**Why:** Incident IDs and body company identifiers are client-controlled, so an unscoped lookup or mutation can cross company boundaries even when the list endpoint is filtered.

**How to apply:** Keep tenant resolution at the route boundary, pass company IDs into repository predicates, and return a non-disclosing not-found response when a scoped tenant cannot see the incident.