# VivafrutaZ ERP — Full Route Safety Audit

**Date:** 2026-05-03  
**Scope:** All API routes registered in `server/routes/` (55 route files) and the monolithic `server/routes/routes.ts` (3 730 lines).  
**Mode:** READ-ONLY analysis. No code changes.  
**Auditor:** Continuous-audit subagent (automated, human-reviewed)

---

## 1. Legend

| Column | Values |
|--------|--------|
| **Type** | CORE · SENSITIVE · SAFE · LEGACY · UNUSED |
| **Risk** | CRITICAL · HIGH · MEDIUM · LOW · SAFE |
| **MT** | Multi-tenant compliant? ✅ · ⚠️ partial · ❌ missing |
| **Guard** | Auth middleware in use |
| **Dup** | Duplicate coverage flag |

---

## 2. Authentication Guard Reference

| Guard | Meaning | Strength |
|-------|---------|----------|
| `requireAuthCore` + `requireRole([...])` | Session validated → role allowlisted → proceed | **Strong** (recommended) |
| `requireAuthCore` alone | Session validated, no role restriction | **Moderate** |
| `requireSessionOrCompany` | Accepts admin session OR company portal session | **Legacy / Weak** |
| Manual `if (!session.userId)` | Inline session check, no centralised middleware | **Legacy / Weak** |
| `tenantContext` alone | Resolves tenant principal, does NOT block unauthenticated callers | **Insufficient as sole guard** |
| _(none)_ | Completely unauthenticated | **OPEN** |

---

## 3. Complete Route Classification Matrix

### 3.1 — AUTHENTICATION / SESSION

| Route | Method | Type | Risk | MT | Guard | Notes |
|-------|--------|------|------|----|-------|-------|
| `/api/auth/login` | POST | CORE | LOW | ✅ | None (pre-auth) | Intentional. Brute-force protection desirable |
| `/api/auth/logout` | POST | CORE | LOW | ✅ | None | Intentional |
| `/api/auth/me` | GET | CORE | LOW | ✅ | Session read | Returns own session info |
| `/api/auth/company-login` | POST | CORE | LOW | ✅ | None (pre-auth) | Company portal entry |
| `/api/auth/change-password` | POST | CORE | MEDIUM | ✅ | `requireAuthCore` | Password mutation |

---

### 3.2 — SETTINGS (routes/settings.routes.ts)

> **⚠ CRITICAL FINDING**

| Route | Method | Type | Risk | MT | Guard | Notes |
|-------|--------|------|------|----|-------|-------|
| `/api/settings/:key` | GET | SENSITIVE | **CRITICAL** | ❌ | **NONE** | Any caller can read any system setting including `maintenance_mode`, `test_mode`, API keys stored as settings |
| `/api/settings/:key` | PUT | SENSITIVE | **CRITICAL** | ❌ | **NONE** | Any unauthenticated caller can overwrite any system setting. Can toggle maintenance mode, test mode, or any config key |
| `/api/company-config/logo` | GET | SAFE | LOW | ✅ | None (documented public) | Logo delivery for login screen |
| `/api/company-config` | GET | SAFE | MEDIUM | ❌ | **NONE** | Returns full company config incl. support info, DANFE issuer data |
| `/api/company-config` | PATCH | CORE | MEDIUM | ✅ | `requireAuthCore` + manual role | OK — mutates only with MASTER/ADMIN/DIRECTOR/DEVELOPER |

---

### 3.3 — ORDER EXCEPTIONS (routes/order-exceptions.routes.ts)

> **⚠ HIGH FINDING — Completely open write endpoints**

| Route | Method | Type | Risk | MT | Guard | Notes |
|-------|--------|------|------|----|-------|-------|
| `/api/order-exceptions` | GET | CORE | **HIGH** | ❌ | **NONE** | Returns all company exception rules |
| `/api/order-exceptions` | POST | SENSITIVE | **HIGH** | ❌ | **NONE** | Creates order exception for any companyId — no auth |
| `/api/order-exceptions/:id` | PUT | SENSITIVE | **HIGH** | ❌ | **NONE** | Updates any order exception — no auth |
| `/api/order-exceptions/:id` | DELETE | SENSITIVE | **HIGH** | ❌ | **NONE** | Deletes any order exception — no auth |

---

### 3.4 — REPORTS (routes/reports.routes.ts)

| Route | Method | Type | Risk | MT | Guard | Notes |
|-------|--------|------|------|----|-------|-------|
| `/api/reports/industrialized` | GET | SENSITIVE | **HIGH** | ❌ | **NONE** | Returns cross-tenant financial report data |
| `/api/reports/purchasing` | GET | SENSITIVE | **HIGH** | ❌ | **NONE** | Returns purchasing report — no auth |
| `/api/reports/financial` | GET | SENSITIVE | **HIGH** | ❌ | **NONE** | Returns financial report — no auth |

---

### 3.5 — WASTE CONTROL (routes/waste-control.routes.ts)

| Route | Method | Type | Risk | MT | Guard | Notes |
|-------|--------|------|------|----|-------|-------|
| `/api/waste-control` | GET | LEGACY | MEDIUM | ❌ | Manual `session.userId` check only | No `requireAuthCore`; no role guard |
| `/api/waste-control` | POST | LEGACY | MEDIUM | ❌ | Manual `session.userId` check only | Creates waste record; no role restriction |
| `/api/waste-control/:id` | PATCH | LEGACY | MEDIUM | ❌ | Manual `session.userId` check only | Mutates record; no role guard |

---

### 3.6 — FISCAL INVOICES (routes/fiscal-invoices.routes.ts)

| Route | Method | Type | Risk | MT | Guard | Notes |
|-------|--------|------|------|----|-------|-------|
| `/api/fiscal-invoices` | GET | LEGACY | MEDIUM | ❌ | Manual `session.userId` check | No `requireAuthCore`; no role guard; returns all invoices |
| `/api/fiscal-invoices/check-duplicate` | GET | LEGACY | LOW | ❌ | Manual `session.userId` check | Safe read |
| `/api/fiscal-invoices/:id` | GET | LEGACY | MEDIUM | ❌ | Manual `session.userId` check | No tenant validation |
| `/api/fiscal-invoices` | POST | LEGACY | MEDIUM | ❌ | Manual `session.userId` check | Creates invoice; no role guard |
| `/api/fiscal-invoices/:id` | DELETE | LEGACY | HIGH | ❌ | Manual `session.userId` check | Deletes fiscal record; no role guard |

---

### 3.7 — ANNOUNCEMENTS (routes/announcements.routes.ts)

| Route | Method | Type | Risk | MT | Guard | Notes |
|-------|--------|------|------|----|-------|-------|
| `/api/announcements` | GET | LEGACY | MEDIUM | ❌ | Manual `session.userId` check | No role guard; lists all announcements |
| `/api/announcements/active` | GET | LEGACY | LOW | ✅ | Manual `session.companyId` check | Scoped to company session — acceptable |
| `/api/announcements` | POST | LEGACY | MEDIUM | ❌ | Manual `session.userId` check | No `requireAuthCore` |
| `/api/announcements/:id` | PATCH | LEGACY | MEDIUM | ❌ | Manual `session.userId` check | No `requireAuthCore` |
| `/api/announcements/:id` | DELETE | LEGACY | MEDIUM | ❌ | Manual `session.userId` check | No `requireAuthCore` |

---

### 3.8 — EMAIL ROUTES (routes/email.routes.ts)

| Route | Method | Type | Risk | MT | Guard | Notes |
|-------|--------|------|------|----|-------|-------|
| `/api/email/schedules` | GET | LEGACY | LOW | ❌ | Manual `session.userId` | No `requireAuthCore` |
| `/api/email/schedules` | POST | LEGACY | MEDIUM | ❌ | Manual `session.userId` + role | MANAGER role not in standard list |
| `/api/email/schedules/:id` | PUT | LEGACY | MEDIUM | ❌ | Manual `session.userId` | No `requireAuthCore` |
| `/api/email/send-confirmation` | POST | SENSITIVE | MEDIUM | ✅ | `requireAuthCore` | OK |
| `/api/email/broadcast` | POST | SENSITIVE | HIGH | ⚠️ | `requireAuthCore` + manual role | Sends to all companies — MASTER/ADMIN only |

---

### 3.9 — NF-e / FISCAL (inline in routes.ts)

| Route | Method | Type | Risk | MT | Guard | Notes |
|-------|--------|------|------|----|-------|-------|
| `/api/nfe` | GET | CORE | MEDIUM | ⚠️ | `requireAuthCore` | No role check — any authenticated user sees all NF-e |
| `/api/nfe/:id` | GET | CORE | MEDIUM | ✅ | `requireAuthCore` + `validateOrderTenant` | Tenant-validated |
| `/api/nfe/can-emit/:orderId` | GET | CORE | **HIGH** | ⚠️ | **NONE** | No auth at all; calls `validateOrderTenant` (session-dependent — will return 401 if no session, but guard is missing) |
| `/api/nfe/preflight/:orderId` | GET | CORE | MEDIUM | ✅ | `requireAuthCore` + `tenantContext` | OK |
| `/api/nfe/eligible` | GET | SENSITIVE | **HIGH** | ❌ | **NONE** | Returns list of orders eligible for NF-e emission across ALL tenants. No auth. Leaks company-level fiscal data |
| `/api/nfe/cron/status` | GET | SENSITIVE | MEDIUM | ❌ | **NONE** | Returns cron state; no auth |
| `/api/nfe/cron/run` | POST | SENSITIVE | **HIGH** | ❌ | `requireAuthCore` only | No role guard — any authenticated user triggers billing cron |
| `/api/nfe/cron/history` | GET | SENSITIVE | MEDIUM | ❌ | **NONE** | Returns all cron runs; no auth |
| `/api/nfe/emitir` | POST | SENSITIVE | HIGH | ✅ | `requireAuthCore` + `validateOrderTenant` | Transmits to SEFAZ — well-guarded |
| `/api/nfe/:id/danfe` | GET | CORE | MEDIUM | ✅ | `requireAuthCore` + `validateOrderTenant` | OK |

---

### 3.10 — CRON ALERT MANAGEMENT (inline in routes.ts)

| Route | Method | Type | Risk | MT | Guard | Notes |
|-------|--------|------|------|----|-------|-------|
| `/api/cron/alerts/recipients` | GET | SENSITIVE | LOW | ✅ | `requireAuthCore` + `requireRole` | OK |
| `/api/cron/alerts/recipients` | PUT | SENSITIVE | MEDIUM | ✅ | `requireAuthCore` + `requireRole` + Zod validation | OK |
| `/api/cron/alerts/logs` | GET | SENSITIVE | LOW | ✅ | `requireAuthCore` + `requireRole` | OK |
| `/api/cron/alerts/analytics` | GET | SAFE | LOW | ✅ | `requireAuthCore` + `requireRole` | OK |
| `/api/cron/alerts/anomalies` | GET | SAFE | LOW | ✅ | `requireAuthCore` + `requireRole` | OK |
| `/api/cron/alerts/insights` | GET | SAFE | LOW | ✅ | `requireAuthCore` + `requireRole` | OK |
| `/api/cron/alerts/digest` | GET | SAFE | LOW | ✅ | `requireAuthCore` + `requireRole` | OK |
| `/api/cron/alerts/export` | GET | SAFE | LOW | ✅ | `requireAuthCore` + `requireRole` | OK |

---

### 3.11 — HEALTH (routes/health.routes.ts)

| Route | Method | Type | Risk | MT | Guard | Notes |
|-------|--------|------|------|----|-------|-------|
| `/api/health` | GET | SAFE | MEDIUM | ✅ | **NONE** (intentional liveness probe) | Exposes auth user count, DB ping, session store status — information leakage to unauthenticated callers |

---

### 3.12 — BACKUP (routes/backup.routes.ts)

| Route | Method | Type | Risk | MT | Guard | Notes |
|-------|--------|------|------|----|-------|-------|
| `/api/admin/backup` | GET | SENSITIVE | HIGH | ✅ | `requireSessionOrCompany` + manual role | LEGACY guard — should be `requireAuthCore + requireRole` |
| `/api/admin/backup/create` | POST | SENSITIVE | **CRITICAL** | ✅ | `requireSessionOrCompany` + manual role | LEGACY guard on a backup-creation endpoint |
| `/api/admin/backup/:id/restore` | POST | SENSITIVE | **CRITICAL** | ✅ | `requireSessionOrCompany` + manual role | LEGACY guard on restore |
| `/api/admin/backup/:id` | DELETE | SENSITIVE | HIGH | ✅ | `requireSessionOrCompany` + manual role | LEGACY guard |

---

### 3.13 — LOGS (routes/logs.routes.ts)

| Route | Method | Type | Risk | MT | Guard | Notes |
|-------|--------|------|------|----|-------|-------|
| `/api/admin/logs` | GET | SENSITIVE | HIGH | ❌ | `requireSessionOrCompany` + manual role | LEGACY guard; cross-tenant log dump |
| `/api/admin/logs/export` | GET | SENSITIVE | HIGH | ❌ | `requireSessionOrCompany` + manual role | LEGACY guard; CSV export of all logs |

---

### 3.14 — ADMIN INTELLIGENCE (routes/admin-intelligence.routes.ts)

| Route | Method | Type | Risk | MT | Guard | Notes |
|-------|--------|------|------|----|-------|-------|
| `/api/admin/intelligence` | GET | SENSITIVE | HIGH | ❌ | `requireSessionOrCompany` LEGACY + manual role | Reads ALL orders, ALL companies, ALL products cross-tenant for analysis |
| `/api/admin/intelligence/auto-fix` | POST | SENSITIVE | **HIGH** | ❌ | `requireSessionOrCompany` LEGACY + manual role | **Writes user roles to DB** (assigns LOGISTICS to any user missing a role). LEGACY guard on a write mutation |

---

### 3.15 — SYSTEM STATE (routes/system-state.routes.ts)

| Route | Method | Type | Risk | MT | Guard | Notes |
|-------|--------|------|------|----|-------|-------|
| `/api/admin/system-state` | GET | SENSITIVE | MEDIUM | ✅ | `requireAuthCore` + `requireRole` + `queryFirewall` + `runWithTenant` | **Well-guarded.** Best-practice reference implementation |

---

### 3.16 — SECURITY SUITE (security.routes.ts, security-events, security-alerts, security-overview, security-risk, security-analysis)

| Route | Method | Type | Risk | MT | Guard | Notes |
|-------|--------|------|------|----|-------|-------|
| `/api/admin/security/*` | ALL | SENSITIVE | MEDIUM | ✅ | `requireAuthCore` + `requireRole` | All guarded — OK |
| `/api/admin/security-events/*` | ALL | SENSITIVE | MEDIUM | ✅ | `requireAuthCore` + `requireRole` | OK |
| `/api/admin/security-alerts/*` | ALL | SENSITIVE | MEDIUM | ✅ | `requireAuthCore` + `requireRole` | OK |
| `/api/admin/security-overview/*` | ALL | SENSITIVE | MEDIUM | ✅ | `requireAuthCore` + `requireRole` | OK |
| `/api/admin/security-risk/*` | ALL | SENSITIVE | MEDIUM | ✅ | `requireAuthCore` + `requireRole` | OK |
| `/api/admin/security-analysis/*` | ALL | SENSITIVE | MEDIUM | ✅ | `requireAuthCore` + `requireRole` | OK |

---

### 3.17 — GOVERNANCE (routes/governance.routes.ts)

| Route | Method | Type | Risk | MT | Guard | Notes |
|-------|--------|------|------|----|-------|-------|
| `/api/admin/governance/summary` | GET | SENSITIVE | MEDIUM | ✅ | `requireAuthCore` + `requireRole` | Reads 9 static JSON files from `scripts/output/` — will 500 if any file is missing (fragile dependency) |

---

### 3.18 — AUDIT (routes/audit.routes.ts)

| Route | Method | Type | Risk | MT | Guard | Notes |
|-------|--------|------|------|----|-------|-------|
| `/api/admin/audit/*` | ALL | SENSITIVE | LOW | ✅ | `requireAuthCore` + `requireRole` | OK |

---

### 3.19 — POLICY (routes/policy.routes.ts)

| Route | Method | Type | Risk | MT | Guard | Notes |
|-------|--------|------|------|----|-------|-------|
| `/api/admin/policies/*` | ALL | SENSITIVE | LOW | ✅ | `requireAuthCore` + `requireRole` | OK |

---

### 3.20 — ALERT ENGINE (routes/alert.routes.ts)

| Route | Method | Type | Risk | MT | Guard | Notes |
|-------|--------|------|------|----|-------|-------|
| `/api/admin/alerts/*` | ALL | SENSITIVE | LOW | ✅ | `requireAuthCore` + `requireRole` | **DUP:** overlaps with `/api/admin/system-state` alert data |

---

### 3.21 — SAAS / BILLING (routes/saas.routes.ts)

| Route | Method | Type | Risk | MT | Guard | Notes |
|-------|--------|------|------|----|-------|-------|
| `/api/saas/modulos` | GET | SAFE | LOW | ✅ | **NONE** | Intentionally public — module catalog metadata |
| `/api/saas/planos` | GET | SAFE | LOW | ✅ | **NONE** | Plan listing; public catalog |
| `/api/saas/planos/:id/modulos` | GET | SAFE | LOW | ✅ | **NONE** | Modules per plan; public |
| `/api/saas/*` (mutating) | POST/PATCH/DELETE | SENSITIVE | HIGH | ✅ | `requireAuthCore` + `requireRole(['MASTER'])` | MASTER-only — OK |

---

### 3.22 — MASTER ROUTES (routes/master.routes.ts)

| Route | Method | Type | Risk | MT | Guard | Notes |
|-------|--------|------|------|----|-------|-------|
| `/api/master/*` | ALL | SENSITIVE | HIGH | ✅ | `requireAuthCore` + `requireRole(['MASTER'])` | Intentionally cross-tenant; MASTER-only — OK |

---

### 3.23 — EXECUTIVE DASHBOARD (routes/executive-dashboard.routes.ts)

| Route | Method | Type | Risk | MT | Guard | Notes |
|-------|--------|------|------|----|-------|-------|
| `/api/executive-dashboard/*` | ALL | SENSITIVE | HIGH | ✅ | `requireAuthCore` + `requireRole(['MASTER','ADMIN','DIRECTOR'])` | Intentionally cross-tenant; well-guarded |

---

### 3.24 — SYSTEM SYNC (routes/system-sync.routes.ts)

| Route | Method | Type | Risk | MT | Guard | Notes |
|-------|--------|------|------|----|-------|-------|
| `/api/admin/system-sync` | POST | SENSITIVE | HIGH | ✅ | `requireAuthCore` + `requireRole` + dual guard | **Dual-guarded** (middleware + inline). Reads all data cross-tenant. OK for intent |

---

### 3.25 — SYSTEM VERSIONS (routes/system-versions.routes.ts)

| Route | Method | Type | Risk | MT | Guard | Notes |
|-------|--------|------|------|----|-------|-------|
| `/api/system/versions` | GET | SENSITIVE | LOW | ✅ | `requireAuthCore` + manual role | OK |
| `/api/system/versions/current` | GET | SAFE | LOW | ✅ | **NONE** | Public — returns only version name |
| `/api/system/versions` | POST | SENSITIVE | MEDIUM | ✅ | `requireAuthCore` + manual role | OK |
| `/api/system/versions/:id` | PATCH | SENSITIVE | MEDIUM | ✅ | `requireAuthCore` + manual role | OK |
| `/api/system/versions/:id` | DELETE | SENSITIVE | HIGH | ✅ | `requireAuthCore` + manual role (MASTER/ADMIN/DEVELOPER only) | OK |
| `/api/system/apply-update` | POST | SENSITIVE | **HIGH** | ✅ | `requireAuthCore` + manual role | Can push version to ALL companies in one call |
| `/api/system/rollback` | POST | SENSITIVE | **HIGH** | ✅ | `requireAuthCore` + manual role | Rolls back any company to any version |
| `/api/system/update-logs` | GET | SAFE | LOW | ✅ | `requireAuthCore` + manual role | OK |
| `/api/system/updates` | GET | SAFE | LOW | ✅ | `requireAuthCore` + manual role | OK |

---

### 3.26 — LOGISTICS (routes/logistics.routes.ts)

| Route | Method | Type | Risk | MT | Guard | Notes |
|-------|--------|------|------|----|-------|-------|
| `/api/geo/cep/:cep` | GET | SAFE | LOW | ✅ | **NONE** | Public CEP lookup proxy — acceptable |
| `/api/geo/cep-basic/:cep` | GET | SAFE | LOW | ✅ | **NONE** | Same as above |
| `/api/deliveries` | GET | CORE | MEDIUM | ⚠️ | `tenantContext` only (NO `requireAuthCore`) | Tenant-scoped but no authentication wall — unauthenticated call with no session returns data for unscoped MASTER (tenantId=null), allowing full cross-tenant delivery dump |
| `/api/deliveries/:id` | GET | CORE | MEDIUM | ❌ | `requireAuthCore` only | No tenant validation on single delivery fetch |
| `/api/deliveries` | POST | CORE | MEDIUM | ✅ | `requireAuthCore` + `tenantContext` | OK |
| `/api/deliveries/:id` | PATCH | CORE | MEDIUM | ✅ | `requireAuthCore` + `tenantContext` | OK |
| `/api/routes/*` | ALL | CORE | MEDIUM | ✅ | `requireAuthCore` + `tenantContext` | OK |
| `/api/drivers/*` | ALL | CORE | MEDIUM | ✅ | `requireAuthCore` + `tenantContext` | OK |

---

### 3.27 — BANK ACCOUNTS (routes/bank.routes.ts)

| Route | Method | Type | Risk | MT | Guard | Notes |
|-------|--------|------|------|----|-------|-------|
| `/api/bank/accounts` | GET | SENSITIVE | MEDIUM | ✅ | `requireAuthCore` + `tenantContext` | Secrets masked — OK |
| `/api/bank/accounts` | POST | SENSITIVE | HIGH | ⚠️ | `requireAuthCore` + `tenantContext` | No role guard beyond auth — any authenticated user can create a bank account |
| `/api/bank/accounts/:id` | PATCH | SENSITIVE | HIGH | ⚠️ | `requireAuthCore` + `tenantContext` | No role guard |
| `/api/bank/accounts/:id` | DELETE | SENSITIVE | HIGH | ⚠️ | `requireAuthCore` + `tenantContext` | No role guard |
| `/api/bank/reconcile` | POST | SENSITIVE | HIGH | ⚠️ | `requireAuthCore` | No role guard on reconciliation action |

---

### 3.28 — SCOPE SIMULATIONS (routes/scope-simulations.routes.ts)

| Route | Method | Type | Risk | MT | Guard | Notes |
|-------|--------|------|------|----|-------|-------|
| `/api/scope-simulations` | GET/POST | CORE | LOW | ✅ | `requireAuthCore` + manual role | OK |
| `/api/scope-simulations/:id` | GET/PATCH/DELETE | CORE | LOW | ✅ | `requireAuthCore` + manual role | OK |
| `/api/scope-simulations/:id/convert` | POST | SENSITIVE | **HIGH** | ✅ | `requireAuthCore` + manual role (MASTER/ADMIN/DIRECTOR/DEVELOPER) | Creates a real company + contract scope items + hashed password — irreversible action; well-guarded but no audit trail of the specific user action |

---

### 3.29 — CLARA IA (routes/clara.routes.ts)

| Route | Method | Type | Risk | MT | Guard | Notes |
|-------|--------|------|------|----|-------|-------|
| `/api/clara/chat` | POST | SENSITIVE | MEDIUM | ✅ | `requireAuthCore` + `requireRole(['MASTER','ADMIN','DEVELOPER'])` | OK — restricted to admin roles |
| `/api/clara/learn` | POST | SENSITIVE | HIGH | ✅ | `requireAuthCore` + `requireRole(['MASTER','ADMIN','DEVELOPER'])` | Trains AI — well-guarded |
| `/api/clara/*` | ALL | SENSITIVE | MEDIUM | ✅ | `requireAuthCore` + `requireRole` | OK |

---

### 3.30 — AI ASSISTANT (routes/assistant.routes.ts)

| Route | Method | Type | Risk | MT | Guard | Notes |
|-------|--------|------|------|----|-------|-------|
| `/api/assistant/history` | GET | CORE | LOW | ✅ | `tenantContext` + tenant scoping | MASTER without `?empresaId` gets empty list — correct design |
| `/api/assistant/chat` | POST | SENSITIVE | MEDIUM | ✅ | `tenantContext` | Creates company via `createCompanyFromClaraAI` — uses provisioning service correctly |

---

### 3.31 — CLIENT INTELLIGENCE (routes/client-intelligence.routes.ts)

| Route | Method | Type | Risk | MT | Guard | Notes |
|-------|--------|------|------|----|-------|-------|
| `/api/commercial-intelligence` | GET | SENSITIVE | HIGH | ❌ | `requireSessionOrCompany` LEGACY + manual role | Cross-tenant: reads ALL orders and ALL companies to build analysis |
| `/api/financial-intelligence` | GET | SENSITIVE | HIGH | ❌ | `requireSessionOrCompany` LEGACY + manual role | Cross-tenant financial intelligence |
| `/api/logistics-intelligence` | GET | SENSITIVE | HIGH | ❌ | `requireSessionOrCompany` LEGACY + manual role | Cross-tenant logistics intelligence |

---

### 3.32 — PUSH NOTIFICATIONS (routes/push.routes.ts)

| Route | Method | Type | Risk | MT | Guard | Notes |
|-------|--------|------|------|----|-------|-------|
| `/api/push/vapid-public-key` | GET | SAFE | LOW | ✅ | **NONE** | Intentionally public — VAPID key is public by design |
| `/api/push/subscribe` | POST | SAFE | MEDIUM | ⚠️ | **NONE** | No auth required; fails-closed if no session resolves a companyId. Orphan subs would be ignored by the delivery logic, but no rate limiting |
| `/api/push/send` | POST | SENSITIVE | MEDIUM | ✅ | `requireAuthCore` + manual role | OK |

---

### 3.33 — TASKS (routes/tasks.routes.ts)

| Route | Method | Type | Risk | MT | Guard | Notes |
|-------|--------|------|------|----|-------|-------|
| `/api/tasks` | GET | CORE | LOW | ✅ | `requireAuthCore` + manual role | Non-admin sees own tasks only — OK |
| `/api/tasks` | POST | CORE | LOW | ✅ | `requireAuthCore` + manual role | OK |
| `/api/tasks/:id` | PATCH/DELETE | CORE | LOW | ✅ | `requireAuthCore` + manual role | OK |

---

### 3.34 — QUOTATIONS (routes/quotations.routes.ts)

| Route | Method | Type | Risk | MT | Guard | Notes |
|-------|--------|------|------|----|-------|-------|
| `/api/quotations` | ALL | CORE | LOW | ✅ | `requireAuthCore` + manual role | OK |

---

### 3.35 — SPECIAL ORDER REQUESTS (routes/special-order-requests.routes.ts)

| Route | Method | Type | Risk | MT | Guard | Notes |
|-------|--------|------|------|----|-------|-------|
| `/api/special-order-requests` | POST | CORE | MEDIUM | ⚠️ | **NONE** | Documented "public form" — any caller can submit a special order for any `companyId` without validation that the caller belongs to that company |
| `/api/special-order-requests` | GET | CORE | LOW | ✅ | `requireSessionOrCompany` LEGACY | OK for intent |
| `/api/special-order-requests/:id` | PATCH | CORE | LOW | ✅ | `requireAuthCore` | OK |

---

### 3.36 — SEARCH (routes/search.routes.ts)

| Route | Method | Type | Risk | MT | Guard | Notes |
|-------|--------|------|------|----|-------|-------|
| `/api/search` | GET | SENSITIVE | HIGH | ❌ | `requireAuthCore` only | No role guard; no tenant scoping — returns cross-tenant data (companies, products, orders, contracts) for any authenticated user |

---

### 3.37 — MARKETPLACE (routes/marketplace.routes.ts)

| Route | Method | Type | Risk | MT | Guard | Notes |
|-------|--------|------|------|----|-------|-------|
| `/api/marketplace/modulos` | GET | SAFE | LOW | ✅ | **NONE** | Public module catalog — acceptable |
| `/api/marketplace/modulos` | POST/PATCH/DELETE | SENSITIVE | MEDIUM | ✅ | `requireAuthCore` + manual role | OK |

---

### 3.38 — DATA IMPORT (inline routes.ts)

| Route | Method | Type | Risk | MT | Guard | Notes |
|-------|--------|------|------|----|-------|-------|
| `/api/import/preview` | POST | SENSITIVE | MEDIUM | ✅ | `requireAuthCore` + manual role | File upload; parses CSV/Excel in-memory; no disk write |
| `/api/import/execute` | POST | SENSITIVE | HIGH | ⚠️ | `requireAuthCore` only (actor check but no role) | Creates products and companies in bulk from uploaded data. No `requireRole` guard — any authenticated user can batch-import |

---

### 3.39 — ADDITIONAL WELL-GUARDED ROUTES

| Group | Guard Level | MT | Notes |
|-------|------------|-----|-------|
| `/api/admin/audit/*` | `requireAuthCore + requireRole` | ✅ | OK |
| `/api/admin/policies/*` | `requireAuthCore + requireRole` | ✅ | OK |
| `/api/admin/system-state` | `requireAuthCore + requireRole + queryFirewall` | ✅ | Best-practice |
| `/api/admin/companies/validate` | `requireAuthCore` + manual role | ✅ | OK |
| `/api/certificates/*` | `requireAuthCore` + manual role | ✅ | OK |
| `/api/system/versions/*` (most) | `requireAuthCore` + manual role | ✅ | OK |
| `/api/admin/system-sync` | `requireAuthCore + requireRole` dual guard | ✅ | OK (intentionally cross-tenant) |
| `/api/master/*` | `requireAuthCore + requireRole(['MASTER'])` | ✅ | OK |
| `/api/executive-dashboard/*` | `requireAuthCore + requireRole` | ✅ | OK |
| `/api/cron/alerts/*` | `requireAuthCore + requireRole` | ✅ | OK |
| `/api/admin/security*` | `requireAuthCore + requireRole` | ✅ | OK |
| `/api/clara/*` | `requireAuthCore + requireRole` | ✅ | OK |
| `/api/scope-simulations/*` | `requireAuthCore` + manual role | ✅ | OK |

---

## 4. Summary Risk Matrix

| Risk Level | Count | Key Routes |
|------------|-------|-----------|
| **CRITICAL** | 2 | `PUT /api/settings/:key` (no auth, writes any setting), `GET /api/settings/:key` (no auth, reads any setting) |
| **HIGH** | 18 | `/api/order-exceptions/*` (4), `/api/reports/*` (3), `/api/nfe/eligible`, `/api/nfe/cron/run` (no role), `/api/admin/intelligence/auto-fix`, `/api/import/execute` (no role), `/api/bank/accounts` (mutations, no role), `/api/search` (no tenant scope), `/api/admin/backup/*` (legacy guard), `/api/admin/logs/*` (legacy guard), `/api/system/apply-update`, `/api/system/rollback` |
| **MEDIUM** | 21 | Legacy-guarded routes, NFe cron status/history, `/api/deliveries` (tenantContext-only), `/api/health`, `/api/company-config`, `/api/special-order-requests` POST, `/api/push/subscribe`, `/api/email/*` (legacy), `/api/waste-control/*`, `/api/fiscal-invoices/*`, `/api/announcements/*` |
| **LOW / SAFE** | ~80 | All well-guarded admin/security/cron/policy/audit routes |

---

## 5. Multi-Tenant Compliance Summary

| Compliance Status | Count | Notes |
|------------------|-------|-------|
| ✅ Compliant | ~70% | Standard admin routes, executive dashboard, master routes |
| ⚠️ Partial | ~15% | Routes with auth but no tenant scoping (search, NF-e list, bank accounts) |
| ❌ Non-compliant | ~15% | Open routes, legacy-guarded cross-tenant reads |

---

## 6. Key Structural Problems

### Problem 1 — Settings API Has No Auth (CRITICAL)
`GET /api/settings/:key` and `PUT /api/settings/:key` have **zero authentication**. Any unauthenticated HTTP client can read or overwrite system settings including `maintenance_mode` and `test_mode`. These likely also store SMTP credentials or integration tokens depending on what callers write via `setSetting`.

**Affected file:** `server/routes/settings.routes.ts` lines 8–25

### Problem 2 — NF-e Eligible List Is Unauthenticated (HIGH)
`GET /api/nfe/eligible` executes a raw SQL query joining `orders` and `companies` and returns fiscal eligibility data for orders across **all tenants** with zero authentication.

**Affected file:** `server/routes/routes.ts` ~line 1391

### Problem 3 — Order Exceptions Are Completely Open (HIGH)
All four verbs on `/api/order-exceptions` require no authentication. Any caller can create, read, update, or delete order exception rules for any company.

**Affected file:** `server/routes/order-exceptions.routes.ts`

### Problem 4 — Reports API Is Unauthenticated (HIGH)
`/api/reports/industrialized`, `/api/reports/purchasing`, `/api/reports/financial` have no auth guard. They accept `companyId` as a query param and return financial/operational report data.

**Affected file:** `server/routes/reports.routes.ts`

### Problem 5 — `requireSessionOrCompany` Misused as Admin Guard (HIGH)
`requireSessionOrCompany` was designed to accept **either** an admin session or a company portal session. Using it to gate SENSITIVE admin-only routes (backup, logs, intelligence auto-fix) means a logged-in **company portal user** passes the middleware check. The role guard inside the handler is the only thing stopping them — but that pattern is fragile and inconsistent.

**Affected files:** `backup.routes.ts`, `logs.routes.ts`, `admin-intelligence.routes.ts`, `client-intelligence.routes.ts`

### Problem 6 — Auto-Fix Writes User Roles with Legacy Guard (HIGH)
`POST /api/admin/intelligence/auto-fix` actually calls `storage.updateUser(id, { role: 'LOGISTICS' })` on any user without a role. It is protected only by `requireSessionOrCompany` (legacy) + manual role check. A race condition or bypass of the manual check would allow arbitrary role assignment.

**Affected file:** `server/routes/admin-intelligence.routes.ts` line 389

### Problem 7 — NF-e Billing Cron Has No Role Guard (HIGH)
`POST /api/nfe/cron/run` uses only `requireAuthCore`. Any authenticated user (including LOGISTICS role) can manually trigger the NF-e billing cron, which writes `nfe_emissoes` records and potentially transmits documents to SEFAZ.

**Affected file:** `server/routes/routes.ts` ~line 1475

### Problem 8 — Search Is Cross-Tenant Without Tenant Scoping (HIGH)
`GET /api/search?q=...` with `requireAuthCore` only returns companies, products, orders, and contracts matching the query — **across all tenants**. A LOGISTICS user of Company A can search and retrieve Company B's data.

**Affected file:** `server/routes/search.routes.ts`

### Problem 9 — Import Execute Has No Role Guard (HIGH)
`POST /api/import/execute` only checks that the caller is authenticated (`actor` resolves). Any authenticated user can bulk-insert products and companies from uploaded data.

**Affected file:** `server/routes/routes.ts` ~line 1037

### Problem 10 — Governance Summary Will 500 If Output Files Missing (MEDIUM)
`GET /api/admin/governance/summary` `Promise.all`-reads 9 static JSON files from `scripts/output/`. If the governance scripts have not been run, every call returns a 500 with the file path exposed in the error message.

**Affected file:** `server/routes/governance.routes.ts`

### Problem 11 — Duplicate Alert Pipelines (MEDIUM / Architectural)
Three separate systems feed `systemState.alerts`:
1. `systemAlerts` DB table (persistent)
2. In-memory `alertEngine.ts` buffer (ephemeral)
3. `continuousAudit.ts` periodic scanner (ephemeral, 15 min)

Two endpoints expose alert data with different shapes:
- `GET /api/admin/alerts` (alert.routes.ts)
- `GET /api/admin/system-state` (system-state.routes.ts)

Consumers may see different alert counts depending on which endpoint they hit, and in-memory alerts are lost on restart.

### Problem 12 — `GET /api/deliveries` Uses `tenantContext` Without Auth (MEDIUM)
`tenantContext` resolves a principal from the session but does **not** reject unauthenticated callers. An unauthenticated request passes through `tenantContext` with `tenantId = null`, which causes the handler to return an unscoped delivery list.

**Affected file:** `server/routes/logistics.routes.ts` line 36

### Problem 13 — Health Endpoint Leaks Auth User Count (LOW)
`GET /api/health` is intentionally unauthenticated, but it exposes the count of authenticated sessions or users. This is minor OSINT exposure.

---

## 7. Remediation Priority Queue

| Priority | Action | Effort | Risk Eliminated |
|----------|--------|--------|-----------------|
| P0 | Add `requireAuthCore + requireRole(['MASTER','ADMIN'])` to `PUT /api/settings/:key` | Trivial | CRITICAL |
| P0 | Add `requireAuthCore + requireRole(['MASTER','ADMIN','DEVELOPER'])` to `GET /api/settings/:key` | Trivial | CRITICAL |
| P0 | Add `requireAuthCore` to `GET /api/nfe/eligible` | Trivial | HIGH |
| P0 | Add `requireAuthCore + requireRole(['MASTER','ADMIN','DIRECTOR'])` to all `/api/order-exceptions` mutating verbs | Small | HIGH |
| P0 | Add `requireAuthCore` to all `/api/reports/*` | Trivial | HIGH |
| P1 | Migrate `backup.routes.ts`, `logs.routes.ts` from `requireSessionOrCompany` to `requireAuthCore + requireRole` | Small | HIGH |
| P1 | Migrate `admin-intelligence.routes.ts` from `requireSessionOrCompany` to `requireAuthCore + requireRole` | Small | HIGH |
| P1 | Add `requireRole(['MASTER','ADMIN','DIRECTOR'])` to `POST /api/nfe/cron/run` | Trivial | HIGH |
| P1 | Add tenant scoping to `GET /api/search` | Medium | HIGH |
| P1 | Add `requireRole` to `POST /api/import/execute` | Trivial | HIGH |
| P1 | Add `requireRole` to `/api/bank/accounts` mutations | Trivial | HIGH |
| P2 | Add `requireAuthCore` to `GET /api/deliveries` (ahead of `tenantContext`) | Trivial | MEDIUM |
| P2 | Add tenant validation to `GET /api/deliveries/:id` | Small | MEDIUM |
| P2 | Replace manual `session.userId` checks in `waste-control`, `fiscal-invoices`, `announcements`, `email` with `requireAuthCore` | Medium | MEDIUM |
| P2 | Add `requireAuthCore` to `GET /api/nfe/cron/status` and `GET /api/nfe/cron/history` | Trivial | MEDIUM |
| P2 | Migrate `client-intelligence.routes.ts` from `requireSessionOrCompany` to `requireAuthCore + requireRole` | Small | MEDIUM |
| P3 | Consolidate duplicate alert pipelines into a single persistent source | Large | Architectural |
| P3 | Make `GET /api/admin/governance/summary` gracefully return empty data when output files are missing | Small | MEDIUM |
| P3 | Remove or reduce user count from `/api/health` response | Trivial | LOW |
| P3 | Add `requireAuthCore` + rate limiting to `POST /api/push/subscribe` | Small | LOW |

---

## 8. Patterns That Are Working Well (Keep)

1. **`requireAuthCore + requireRole([...])` double guard** — used in security suite, cron alerts, audit, policy, governance, clara routes. This is the standard to enforce everywhere.
2. **`validateOrderTenant` / `validateCompanyTenant`** — correctly applied on NF-e, order-level, and company-level operations.
3. **`queryFirewall` + `runWithTenant`** in `/api/admin/system-state` — best-practice reference implementation.
4. **`tenantWhere(table)`** in `assistant.routes.ts` — correct Drizzle-level tenant scope.
5. **Secret masking** in `bank.routes.ts` — `clientSecret` is always returned as `'***'`.
6. **Dual guard** in `system-sync.routes.ts` — middleware + inline check provides defence in depth.
7. **`createCompanyFromClaraAI` provisioning service** — Clara IA uses the dedicated provisioning service rather than calling `storage.createCompany` directly.

---

## 9. Route Type Final Counts

| Type | Count | Description |
|------|-------|-------------|
| CORE | ~95 | Standard business routes, well-guarded |
| SENSITIVE | ~35 | Admin/financial/audit routes |
| SAFE | ~20 | Intentionally public (vapid key, logo, version, CEP, saas catalog) |
| LEGACY | ~18 | Routes using `requireSessionOrCompany` or raw session check |
| UNUSED | 0 | All FASE 7.4 dead code was already removed (comments confirm) |

---

*End of audit — no code was modified during this analysis.*
