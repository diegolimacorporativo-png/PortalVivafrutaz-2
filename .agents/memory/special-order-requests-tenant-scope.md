---
name: Special order requests tenant scope
description: Authorization and tenant rules for customer special-order requests.
---

The special-order form is an authenticated company-portal flow, not a public form. Its tenant comes only from the company session; a submitted `companyId` is ignored. Administrative listing is authenticated and role-gated: tenant-bound users see their tenant, while only the module's explicit global roles may use global or selected-tenant access. ID-based approval must use `id + companyId` for tenant-bound users.

**Why:** The customer UI sends a company identifier for convenience, but that value is client-controlled; the old administrative GET was public and the approval path loaded and updated requests globally.

**How to apply:** Preserve the company-session-only POST, resolve tenant through `tenantContext`, keep view and manage role sets distinct, and return not-found for inaccessible tenant-bound IDs.