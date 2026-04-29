# VivaFrutaz B2B Ordering ERP SaaS

## Overview
VivaFrutaz is a B2B corporate fruit ordering ERP SaaS platform in Brazilian Portuguese (PT-BR). It offers a comprehensive solution for managing fruit ordering processes, featuring a dual-portal system for administrators and client companies. The platform supports role-based access, time-windowed ordering, detailed reporting, and advanced logistics with GPS tracking. Key capabilities include NF-e 4.00 fiscal emission, AI-powered operational intelligence (Clara IA), White Label customization per company, robust SaaS plan management, and a Marketplace de Módulos. The project aims to streamline B2B fruit procurement, enhance operational efficiency, and provide scalable solutions for businesses in Brazil.

## User Preferences
Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend Architecture
- **Framework**: React with TypeScript and Vite.
- **Routing**: Wouter, with `ProtectedRoute` for access control.
- **State Management**: TanStack React Query for server state.
- **UI Components**: shadcn/ui (New York style) based on Radix UI, styled with Tailwind CSS (green/orange palette).
- **Forms**: React Hook Form with Zod validation.
- **Charts**: Recharts for data visualization.
- **Authentication**: `useAuth` hook and `ProtectedRoute` manage session types and access.
- **PWA Support**: Manifest and service worker for offline capabilities.
- **Push Notifications**: Integrated system for event-driven notifications.

### Backend Architecture
- **Runtime**: Node.js with Express 5.
- **Language**: TypeScript.
- **Session Management**: `express-session` with `memorystore`, mounted centrally in `server/app.ts` via `core/http/session.ts` BEFORE the module loader so every modular and legacy router shares the same session store.
- **API Design**: Centralized, typed API definitions with Zod schemas for validation.
- **Storage Layer**: `IStorage` interface implemented using Drizzle ORM and PostgreSQL.
- **Modular ERP Layout** (`server/`):
  - `index.ts` — bootstrap only (env, listen)
  - `app.ts` — Express app factory: parsers, security, request log, module loader, legacy routes, central error handler
  - `core/` — shared infrastructure: `errors/AppError`, `errors/errorHandler`, `http/asyncHandler`, `http/apiResponse`, `http/requireAuth`, `validation/validateRequest`
  - `modules/<domain>/` — one folder per ERP domain (`auth`, `users`, `finance`, `sales`, `inventory`, `purchases`, `logistics`, `reports`, `ai`); each contains `*.routes.ts`, `*.controller.ts`, `*.service.ts`, `*.repository.ts`, `*.validation.ts`, `*.types.ts`, `index.ts`
  - `modules/index.ts` — central loader; modules are mounted BEFORE the legacy `routes/routes.ts` so migrated paths take precedence and unmigrated ones keep working
- **Migration status**: `auth`, `companies`, `finance`, `logistics`, `orders`, `products`, and `users` modules are fully refactored under `server/modules/`. **`logistics` module** owns 32 endpoints under `/api/logistics/*` (drivers, vehicles, routes, route-stops, maintenance CRUD; route-assistant, suggest-route, day-orders, simulate-day, calculate-distance, audit-logs, deliveries report, geo/cep, smart-search, best-driver, route-insertion, smart-route-plan). Preserves four distinct legacy auth strategies bit-for-bit (logAuth role-based, session-only, admin-only, no-auth) — no router-wide gate; each handler enforces its own. Repository delegates to `services/storage` (no Drizzle ownership yet) to avoid drift with cross-cutting callers (driver panel, public tracking, delivery checklist). The `logisticsAudit` helper stays in `routes.ts` because the unmigrated `/api/deliveries/:id/checklist` endpoint still calls it; the now-unused `LOGISTICS_ADMIN_ROLES` and `checkLogisticsPermissions` helpers were removed. Excluded from this scope: `/api/logistics-intelligence/*` (separate prefix, kept inline). Tests live at `tests/unit/logistics.test.ts` (project convention — `npm test` globs `tests/unit/*.test.ts`); 10 tests cover all four auth gates, validation parity, happy paths, and the legacy `Não autorizado` quirk on route-assistant. `auth` and `users` intentionally preserve their legacy raw response shapes (`{user}`/`{company}` and raw arrays) because the existing frontend Zod-parses those shapes; `finance`, `orders`, and `companies` use the new envelope. `companies` covers CRUD + `/my/preferred-order-type`, `/delivery-suggestions`, contract-scopes CRUD, contract-info PATCH, contract-adjustments CRUD + send-email, generate-orders-from-scope, addresses CRUD + set-primary, gps-status, gps-toggle (router applies `tenantContext`; repository uses `assertCompanyAccess(id)` since `companies.id` IS the tenant; sub-resource tables use `tenantWhere()`; `gps-toggle` keeps the legacy MASTER/ADMIN/DIRECTOR role gate). The legacy `routes/routes.ts` was reduced from 10,630 → 10,221 lines after deleting the 19 migrated handlers; out-of-scope siblings (`/api/admin/companies/validate`, `/api/company-config*`, `/api/company-settings*`, `/api/contracts/alerts`, `/api/master/companies/:id/assinatura`) intentionally remain in the legacy file. All companies frontend consumers (`finance`, `white-label`, `system-updates`, `fiscal`, `email-management`, `saas-dashboard`, `contracts`, `quotations`, `companies`, `dashboard`, `logistics`, `announcements`, `nfe`, `master-control`, `marketplace`, plus `hooks/use-admin.ts`) use `normalizeList`/`normalizeOne` from `client/src/lib/normalizeResponse.ts` (typically via `select: normalizeList` on `useQuery`). `users` covers list/create/update/delete/changePassword via the modular router mounted at `/api/users` (and `/api/v1/users`); the privileged `POST /api/admin/users/:id/unlock` endpoint also delegates to `usersController.unlock` from a thin one-line route in `routes.ts` (its `/api/admin/...` path doesn't fit the users router's base). The previous inline duplicates of `GET/POST /api/users`, `PUT/DELETE /api/users/:id`, and `PUT /api/users/:id/password` in `routes.ts` were dead code (Express resolved the modular router first) and have been removed; their behaviour parity (Portuguese messages, audit logs, role gates, the `newPassword.trim().length < 3` validation) is preserved by the service+validation layers. Next modules to migrate: sales, inventory, purchases. **Behaviour change to be aware of**: the migrated companies router enforces `tenantContext` on every endpoint; the legacy CRUD allowed unauthenticated `GET /api/companies`, which has now been closed. This is a deliberate security tightening, not a regression. **Known parity drift (pre-existing, project-wide)**: the central `errorHandler` returns `{success:false, error:{message, code}}` for all `AppError`s, while several legacy frontend pages still read `d.message` at the top level after `await res.json()`. This affected the users module since it was first mounted (the unlock migration in this session inherits the same envelope). A follow-up either flattens the error body for legacy paths or migrates remaining frontend pages to `useSafeQuery`/`normalizeResponse`.
- **Standardized response envelope** (new modules unless legacy shape is required): `{ success: true, data, meta? }` or `{ success: false, error: { message, code, details? } }`. Helpers live in `server/core/http/apiResponse.ts` (`ok`, `created`, `noContent`, `fail`).
- **Auth model in new modules** — three building blocks composed per route:
  1. `requireAuth` (`server/core/http/requireAuth.ts`) — session-only.
  2. `requireAuthOrService` (`server/middleware/serviceAuth.ts`) — accepts session OR a valid `x-api-key` header (matched against `INTERNAL_API_KEY`, constant-time compare). Sets `req.isService = true` on the service path. Used for **read** endpoints that need to be reachable by cron jobs / GPS daemon / NF-e poller / third-party integrations without a human session.
  3. `tenantContext` (`server/middleware/tenant.ts`) — pins the tenant via AsyncLocalStorage. Three branches: company portal (forced from session), admin (forced from session, cross-tenant admins may target via `X-Empresa-Id`/`?empresaId=N`), and **service** (when `req.isService` is true and no session exists, reads tenant from `X-Empresa-Id`/`?empresaId=N`; null is allowed for cross-tenant tooling). Session callers can never override tenant via query/header. Service callers MUST go through `requireAuthOrService` first — `tenantContext` alone still rejects anonymous traffic.
  4. **Write endpoints intentionally omit `requireAuthOrService`**, so service tokens cannot create / update / delete in the migrated modules. Companies module follows this rule strictly: only `GET /` and other reads accept the API key; all POST/PUT/PATCH/DELETE require a real human session. The role gate on `gps-toggle` (MASTER/ADMIN/DIRECTOR) is enforced inside the service layer and cannot be satisfied by a service token.
- **`INTERNAL_API_KEY` secret**: required for the service-auth path. If unset, the middleware silently disables service mode (any provided `x-api-key` is ignored) and the system behaves as session-only — safe default for environments with no service consumers.

### Data Storage
- **Database**: PostgreSQL, accessed via Drizzle ORM.
- **Key Tables**: `users`, `companies`, `products`, `orders`, `system_settings`, `nfe_emissoes`, `bank_accounts`, `scope_simulations`, `planos`, `assinaturas`, `billing_events`, among others, to support all core features.

### Authentication & Authorization
- Session-based authentication with `express-session`.
- Role-based access control for `admin` (ADMIN, OPERATIONS_MANAGER, PURCHASE_MANAGER, LOGISTICS, FINANCEIRO, DIRECTOR, DEVELOPER, MASTER) and `company` user types, enforced by `ProtectedRoute` and `tabPermissions`.
- Account lockout mechanism after failed login attempts.

### Core Features
- **Dual Portal System**: Separate interfaces for client companies and internal administration.
- **Role-Based Access**: Granular permissions across various user roles.
- **Price Management**: Dynamic pricing via price groups and administrative fees.
- **Ordering System**: Time-windowed orders, special orders, cart functionality, and order workflow management. Includes a controlled state machine (`workflowStatus`) with 8 states (CREATED → PENDING_APPROVAL → APPROVED → INVOICED → SHIPPED → DELIVERED, plus REJECTED/CANCELLED), RBAC-gated transitions, and business rule enforcement (customer active, no overdue AR, invoice present before shipping). Driven via `POST /api/orders/:id/transition`. Fully additive — legacy `status` field and all existing endpoints untouched.
- **Reporting & Exports**: Comprehensive purchasing and financial reports, CSV export, DANFE Internal PDF, ERP Bling Export, and Fiscal Export Module (XML/XLSX).
- **Logistics Module**: Route, driver, vehicle management, maintenance, quotations, and a Route Assistant with geocoding for optimized delivery. GPS tracking and control per plan.
- **Contratual Client Module**: Dedicated experience for contract clients, including scope viewing, change requests, and restricted ordering.
- **Virtual Assistant (Clara IA)**: AI-powered assistant for queries, smart exports, intelligence modules (commercial risk, financial forecast), and a trainable chat mode. Includes an automated diagnostics and bug-fixing feature.
- **Incident Management**: Tracks client and internal incidents.
- **White Label**: Company-specific branding and customization.
- **SaaS Multi-Tenant Platform**: Master control panel for managing companies, plans, subscriptions, billing, and users within a multi-tenant SaaS environment.
- **NF-e 4.00 Emission Module**: Full XML generation, SEFAZ transmission, DANFE PDF, and cancellation capabilities.
- **Itaú Bank Integration**: Bank account management, OAuth2 authentication, statement fetching, boleto issuance, and reconciliation.
- **AI Developer Module**: No-LLM tool for system health monitoring, API testing, code analysis (Auto Corrigir), E2E user flow simulation, documentation generation, and module scaffolding.
- **Advanced Permissions System**: Granular flag-based permissions configurable per user.
- **Login Security & Account Lockout**: Automated account locking after multiple failed login attempts with admin unlock capability.
- **Security Logs**: Centralized logging and viewing of security events (login attempts, account lockouts, frontend errors).
- **Simulação de Escopo Comercial**: Module for managing B2B prospect simulations, including company info, dynamic scope builder, and financial analysis, with conversion to client functionality.
- **Central de Treinamento**: In-app training guide with quick start, module documentation, SaaS plans, and FAQ.
- **Inventory Module**: Comprehensive system for managing inventory entries, movements, physical counts, and low-stock alerts.
- **Maintenance Mode**: System-wide maintenance mode with client-side blocking and staff access.
- **Per-User Test Mode**: Allows individual users to operate in a test environment without affecting live data.

## STEP 9.3F.6 — Alertas Inteligentes (additive, isolated)
- **DB**: column `cron_alert_logs.suppressed boolean default false notNull`.
- **Backend services** (new, isolated):
  - `server/services/alerts.intelligence.ts` — `INTELLIGENCE_CONFIG` (CHANNEL_WARNING_RATE=0.75, SUPPRESSION_THRESHOLD=8) + `buildAnomalies` (current vs baseline) + `buildInsights` (rules R1–R5).
  - `server/services/alerts.smart.ts` — `emitAlertSmart` wrapper that suppresses repeats over threshold and persists `suppressed=true` with `rate_limited=false` and empty `results` (does NOT touch `emitAlert`).
- **Cron migration**: `server/jobs/faturamento.cron.ts` calls `emitAlertSmart` instead of `emitAlert` (only place migrated).
- **Endpoints (auth: MASTER/ADMIN/DIRECTOR)**:
  - `GET /api/cron/alerts/anomalies?currentHours=1..168&baselineDays=1..90`
  - `GET /api/cron/alerts/insights?windowHours=1..720`
  - `GET /api/cron/alerts/logs` — extended additively to include `suppressed`.
- **Frontend** (`client/src/pages/admin/faturamento.tsx`):
  - New "Insights inteligentes" card BEFORE the analytics card with 24h/7d/30d window selector and 30s refetch.
  - "🛑 Suprimido" badge in audit list when `log.suppressed === true`.
- **Untouched**: `emitAlert`, `/api/cron/alerts/analytics`, anti-spam rate-limiting, all other cron jobs and modules.

## External Dependencies

### Core Infrastructure
- **PostgreSQL**: Primary relational database.
- **Node.js / Express 5**: Backend runtime and web application framework.

### Key npm Packages
- `drizzle-orm`, `drizzle-zod`, `drizzle-kit`: ORM and database schema tools.
- `@tanstack/react-query`: Data fetching and state management.
- `react-hook-form`, `zod`: Form management and validation.
- `recharts`: Charting library.
- `jspdf`, `jspdf-autotable`: Client-side PDF generation.
- `qrcode`: QR code generation.
- `xlsx`: Excel file handling.
- `pdfkit`, `node-forge`, `xml-crypto`: Server-side PDF generation and NF-e digital signature.
- `axios`: HTTP client for external APIs (e.g., Itaú Bank, SEFAZ NFeAutorizacao4).
- `nanoid`, `uuid`: Unique ID generators.

### Fonts
- Plus Jakarta Sans and Outfit via Google Fonts CDN.

### NF-e SEFAZ Transmission (FASE 3)
- **Mock vs Production switch**: `NFE_SEFAZ_MODE=mock` (default) keeps the simulated authorization; `NFE_SEFAZ_MODE=production` triggers real SEFAZ POST.
- **Sender** (`server/services/nfe/nfeSender.ts`): existing multi-UF dispatcher (SP/MG/RJ/RS/PR/SC + GO default), reconciles UF/ambiente from the signed XML, builds the SOAP 1.2 envelope, and POSTs via `axios` with mTLS `https.Agent`. FASE 3 added an env-driven cert auto-loader: when the caller does not pass `certPem`/`certKey` and `NFE_CERT_PATH` (or `NFE_CERT_BASE64`) is set, it loads the A1 certificate via `nfeCert.getCertificado()` automatically — legacy callers (e.g. `routes.ts:6458` invoking `enviarNFeSEFAZ(xml, uf, tpAmb)`) start transmitting to real SEFAZ with no signature change.
- **Helpers added in FASE 3** (additive only, no existing code removed):
  - `nfeCert.ts` — reads PFX from `NFE_CERT_PATH` (file) or `NFE_CERT_BASE64` (Replit Secrets-friendly), with `CERT_PATH`/`CERT_PASSWORD` as legacy aliases. Returns `{ pfx, passphrase, certPem, keyPem, source }`.
  - `nfeSigner.ts` — env-driven thin wrapper around `nfeSignature.assinarXML` (the real PFX/XMLDSig implementation lives there; this file just removes the need to plumb cert path/senha through every caller).
  - `nfeSoap.ts` — exports `montarEnvelope(xml)` for callers that need the bare SOAP envelope outside the sender.
  - `nfeUrl.ts` — exports `getSefazUrl(uf, ambiente)` and `ufsSuportadas()` mirroring the multi-UF map in the sender.
- **Required env vars for production**: `NFE_SEFAZ_MODE=production`, `NFE_CERT_PATH` (or `NFE_CERT_BASE64`), `NFE_CERT_PASSWORD`. Optional: `NFE_UF`, `NFE_AMBIENTE` (the sender prefers values detected from the signed XML).
- **Guarantees preserved**: `gerarNFeXML` and the XML structure are untouched; mock mode is unchanged; no return contract changed; multi-tenant scoping intact.

### NF-e Per-Tenant Certificates (FASE 3.2)
- **Goal**: each tenant uploads its own A1 certificate via API; the sender picks it up automatically at transmission time. ENV-based cert remains as a global fallback.
- **Schema**: `companyCertificates` table (1:1 with `companies.id` via FK with `ON DELETE CASCADE`). Columns: `id`, `companyId` (unique), `certBase64`, `certPassword`, `createdAt`, `updatedAt`. Password stored in plaintext for now — at-rest encryption is FASE 3.3.
- **Repository**: `server/modules/companies/companyCertificate.repository.ts` exposes `getByCompanyId`, `upsert`, `deleteByCompanyId`. Tenant filtering is the caller's responsibility; the loader (`nfeCertDynamic`) and the routes both pin tenant via `requireTenantId()` first.
- **HTTP endpoints** (legacy `routes.ts`, near the NF-e block): `POST /api/company/certificate` (upload — accepts `{ certBase64, password }`), `GET /api/company/certificate` (status — never returns the cert/password, only `{ configured, id, companyId, createdAt, updatedAt }`), `DELETE /api/company/certificate`. All three guarded by `tenantContext + requireTenant` — anonymous = 401 with the standard envelope; company-portal sessions can only manage their own cert; admins target via `?empresaId=N` / `X-Empresa-Id`.
- **Dynamic loader**: `server/services/nfe/nfeCertDynamic.ts` reads the row for the tenant pinned in AsyncLocalStorage via `currentTenantId()` (returns `null` outside ALS — never throws — so workers / cron without context fall through to ENV cleanly).
- **Sender chain** (`enviarNFeSEFAZ`, in order): (1) manual `certPem`/`certKey` from the caller → (2) tenant cert from DB → (3) ENV cert (FASE 3) → (4) no mTLS (SEFAZ rejects, behaviour unchanged). The DB step uses the new `getCertificado({ pfxBuffer, password, source })` overload added to `nfeCert.ts`. Logs: `[NFE_CERT_FROM_DB]` (with `tenantId` only — never the password) on hit, `[NFE_CERT_DB_LOAD_FAIL]` on PFX/passphrase errors.
- **Verified**: with no DB cert and no ENV cert, mock mode keeps returning the exact same `{status:'autorizada', cStat:'100', xMotivo:'... [MOCK]'}` response; the dynamic loader returns `null` cleanly both with a tenant pinned (no row) and outside ALS (no context).

### NF-e Cert Password Encryption at Rest (FASE 3.3)
- **Goal**: encrypt `companyCertificates.certPassword` so a DB dump never leaks usable PFX passwords. Schema unchanged, function signatures unchanged, NF-e flow unchanged, legacy plaintext rows from FASE 3.2 keep working.
- **Required secret**: `NFE_CERT_SECRET` (Replit Secret, ≥32 chars). Loss of this secret means encrypted passwords become unrecoverable; legacy plaintext rows survive.
- **Algorithm**: AES-256-GCM. Key = `SHA-256(NFE_CERT_SECRET)`. IV = 12 random bytes per op. AuthTag = 16 bytes. Storage format = `enc:v1:base64(iv ‖ tag ‖ ciphertext)`.
- **Why a `enc:v1:` prefix instead of try/catch fallback?** A naive "try decrypt, on failure assume plaintext" silently masks real corruption / wrong-key errors and would push garbage into SEFAZ. The prefix is a deterministic discriminator: legacy rows (no prefix) are passthrough, prefixed rows MUST decrypt or throw. The `:v1:` allows future scheme rotation (chacha20-poly1305, Argon2id KDF, etc.) without breaking existing rows.
- **Util**: `server/utils/crypto.ts` exposes `encrypt(text)`, `decrypt(text)`, `isEncrypted(value)`, `decryptOrPassthrough(value)`. Throws if `NFE_CERT_SECRET` is missing or shorter than 32 chars; key is cached in-process after first use.
- **Repository**: `companyCertificateRepository.upsert` always calls `encrypt(input.certPassword)` before writing — callers MUST pass plaintext. Confirmed via DB inspection that stored values start with `enc:v1:` and differ from the input.
- **Loader**: `nfeCertDynamic.getCertificadoDinamico` calls `decryptOrPassthrough(row.certPassword)` so both new (cifrado) and legacy (plaintext from FASE 3.2 deploys) rows resolve to the correct PFX password. Exposes `isLegacyPlaintext(value)` for an optional admin/cron lazy-migration job (re-save plaintext rows via `upsert` to promote them).
- **Smoke-tested end-to-end** (10/10 passing): round-trip encrypt/decrypt; IV is fresh per call; `isEncrypted` discriminator correct on both shapes; `decryptOrPassthrough` handles both shapes; tampering with the ciphertext throws (no silent failure); repository writes ciphertext (verified raw row in DB starts with `enc:v1:`); loader returns the original plaintext password; legacy plaintext row inserted directly is read transparently; cleanup OK.

### NF-e Cert Legacy Migration (FASE 3.4)
- **Goal**: bulk-migrate any `companyCertificates.certPassword` rows still in plaintext (left over from FASE 3.2 deploys) to the `enc:v1:` format. Schema unchanged, no rows removed, NF-e flow unchanged.
- **Function**: `migrateLegacyCertificates()` (named export from `companyCertificate.repository.ts`) returns `{ total, migrated }`. Iterates the table once, skips rows where `isEncrypted(certPassword)` is true (idempotency — never double-encrypts), and rewrites the rest via `encrypt()` + `UPDATE … WHERE id = ?`.
- **Endpoint**: `POST /api/admin/certificates/migrate-legacy` — guarded by `requireAuthCore + requireRole(['MASTER'])` (cross-tenant scan, no `tenantContext`). Returns `{ success: true, total, migrated }` on hit, `500 { success: false, error: { code: 'MIGRATION_FAILED', message } }` on error. Logs `[CERT_MIGRATION_DONE]` / `[CERT_MIGRATION_ERROR]` (no secrets in either).
- **Verified**: anonymous → 401; with a plaintext row in the table, run 1 → `{ total: 1, migrated: 1 }`, raw DB row now starts with `enc:v1:`; run 2 → `{ total: 1, migrated: 0 }` (idempotent, no re-encryption); loader correctly decrypts the migrated row back to the original passphrase.

### Multi-Tenant Read Hardening (FASE 6)
- **Goal**: close the remaining cross-tenant read leaks on order/NF-e GET endpoints. Defense-in-depth — every "fetch this resource by id" route must validate the active tenant BEFORE hitting the storage layer, so an attacker cannot ID-swap to inspect another company's data.
- **Helpers (pre-existing, untouched)**: `validateOrderTenant(orderId)` and `safeGetOrder(orderId)` from `server/core/security/tenantGuard.ts`. Both pull the active tenant via `requireTenantId()` (ALS), call `storage.getOrder` once, compare `companyId`, and on mismatch log `[SECURITY] TENANT_MISMATCH | requestId=… | orderId=… | details=Tenant mismatch tenant=… orderCompanyId=…` + throw `ForbiddenError` (403). Missing → `NotFoundError` (404). No tenant in context → `UnauthorizedError` (401).
- **Audit of existing routes** (already protected; unchanged): `GET /api/orders/:id`, `GET /api/nfe/:id`, `GET /api/nfe/can-emit/:orderId`, `GET /api/nfe/preflight/:orderId`, `GET /api/nfe/:id/danfe`, `GET /api/nfe/:id/xml`, `GET /api/nfe/fiscal-data/:orderId`, `GET /api/nfe/diagnostics/:orderId`.
- **Gaps closed in this phase** (added `await validateOrderTenant(id)` before any storage read, no other change):
  - `GET /api/orders/:id/timeline` — `OrdersController.timeline` (`server/modules/orders/orders.controller.ts`).
  - `GET /api/orders/:id/danfe-logs` — `OrdersController.listDanfeLogs` (same file).
  - `GET /api/nfe/:orderId/historico` — `server/routes/routes.ts` (was relying only on a repo-level JOIN; the JOIN returned `[]` for cross-tenant attempts, but that allowed an attacker to distinguish "alheio" from "inexistente" and silently leaked existence). Now returns explicit 403 + `[SECURITY]` log.
- **Strict invariants**: storage.ts not touched; service logic not touched; response shape not touched (the guard only fails-fast before the existing handler runs). The errorHandler central já mapeia `AppError → status` para o controller; em `routes.ts` capturamos `AppError` e devolvemos `res.status(e.status).json({ message })` mantendo o envelope antigo.
- **Verified** (real cross-tenant E2E with a temp order in DB):
  - Same tenant → `safeGetOrder` returns `{ items, order }` (shape preserved).
  - Cross tenant → `ForbiddenError` 403 + `[SECURITY] TENANT_MISMATCH … tenant=10000 orderCompanyId=1` printed to stderr.
  - No tenant context → `UnauthorizedError` 401.
  - Not-found order → `NotFoundError` 404.
  - HTTP smoke: anonymous on `/api/orders/:id`, `/api/orders/:id/timeline`, `/api/orders/:id/danfe-logs`, `/api/nfe/:id/historico` → all 401 (auth gate). NF-e emission flow untouched (cron + manual emit still pass through the same `validateOrderTenant` they always called).
  - TypeScript baseline unchanged (16 pre-existing errors, 0 new).

### NF-e Cert Audit (FASE 3.4.1)
- **Goal**: read-only operational view of the certificate fleet — confirm the FASE 3.4 migration result and diagnose pending tenants without touching the DB. Strictly aggregate metrics, no sensitive fields.
- **Function**: `auditCertificates()` (named export from `companyCertificate.repository.ts`) returns `{ total, encrypted, legacy, lastUpdatedAt: string|null }`. Counts `isEncrypted` rows vs the rest, picks the max `updatedAt` across the fleet, ISO-formats it. No side effects.
- **Endpoint**: `GET /api/admin/certificates/audit` — guarded by `requireAuthCore + requireRole(['MASTER'])`. Returns `{ success: true, data: { total, encrypted, legacy, lastUpdatedAt } }`. Never returns `certPassword`, `certBase64`, or even `companyId` — only the four aggregate counters. Logs `[CERT_AUDIT]` on hit, `[CERT_AUDIT_ERROR]` on failure.
- **Verified**: empty table → `{0,0,0,null}`; with 1 encrypted row → `{1,1,0,<iso>}`; after migrate (already encrypted) → unchanged (`legacy === 0`, `encrypted === total`); two consecutive calls produce identical output (idempotent); response shape contains exactly `encrypted,lastUpdatedAt,legacy,total` — confirmed no sensitive field leaks.