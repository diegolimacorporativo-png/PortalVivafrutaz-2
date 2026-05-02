# VivaFrutaz B2B Ordering ERP SaaS

## Overview
VivaFrutaz is a B2B corporate fruit ordering ERP SaaS platform in Brazilian Portuguese (PT-BR). It provides a comprehensive solution for managing fruit ordering processes through a dual-portal system for administrators and client companies. Key features include role-based access, time-windowed ordering, detailed reporting, advanced logistics with GPS tracking, NF-e 4.00 fiscal emission, AI-powered operational intelligence (Clara IA), White Label customization, robust SaaS plan management, and a Marketplace de Módulos. The project aims to streamline B2B fruit procurement, enhance operational efficiency, and offer scalable solutions for businesses in Brazil.

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
- **Runtime**: Node.js with Express 5, TypeScript.
- **Session Management**: `express-session` with **`connect-pg-simple`** (PostgreSQL-backed, survives restarts, `createTableIfMissing: true`). Sessions table auto-created on first boot. Replaced prior MemoryStore (C4-fix).
- **Graceful Shutdown**: SIGTERM/SIGINT handlers drain the HTTP server then close the DB pool with a 15-second force-exit safety net.
- **API Design**: Centralized, typed API definitions with Zod schemas for validation.
- **Storage Layer**: `IStorage` interface implemented using Drizzle ORM and PostgreSQL. `getOrders`, `getProducts`, `getUsers` have a default `LIMIT 1000` to prevent OOM on large datasets.
- **Modular ERP Layout**: Organized into `server/modules/<domain>/` for maintainability and scalability, with `auth`, `companies`, `finance`, `logistics`, `orders`, `products`, and `users` modules fully refactored.
- **Standardized Response Envelope**: New modules use `{ success: true, data, meta? }` or `{ success: false, error: { message, code, details? } }`.
- **Authentication Model**: Built with `requireAuth` (session-only), `requireAuthOrService` (session or API key for read-only access), and `tenantContext` for multi-tenancy. Write endpoints intentionally omit service authentication.
- **Security Enhancements**: Password hashes are excluded from authentication responses. Multi-tenant read hardening implemented on order/NF-e GET endpoints to prevent cross-tenant data leaks. Legacy certificate passwords are encrypted at rest using AES-256-GCM.

### Data Storage
- **Database**: PostgreSQL, accessed via Drizzle ORM.
- **Key Tables**: `users`, `companies`, `products`, `orders`, `system_settings`, `nfe_emissoes`, `companyCertificates`, `nfe_cce` (CC-e history, FASE 14.2), and others to support core features.

### Route Decomposition (FASE 8.8B)
- Monolithic `server/routes/routes.ts` is being decomposed one domain at a time into `server/routes/<domain>.routes.ts` files.
- Each extracted file exports `register(app: Express)` (sync) or `async function register(app: Express)` (async, for domains using top-level `await import(...)`).
- Completed extractions: `tasks`, `quotations`, `waste-control`, `order-exceptions`, `bank` (Banco Itaú, 13 routes, −220 lines).
- `routes.ts` current size: ~3612 lines (down from ~7738 original).

### CC-e Persistence (FASE 14.2)
- `nfe_cce` table added to `shared/schema.ts` and created in DB via `npm run db:push`.
- `createNfeCce` / `getNfeCceHistory` added to `IStorage` + `DatabaseStorage` in `server/services/storage.ts`.
- `POST /api/nfe/:id/cce` and `GET /api/nfe/:id/cce` now persist to PostgreSQL instead of in-memory `cceHistory` map.

### Authentication & Authorization
- Session-based authentication with `express-session` backed by PostgreSQL (`connect-pg-simple`).
- Role-based access control for `admin` and `company` user types, enforced by `ProtectedRoute` and `tabPermissions`.
- Account lockout mechanism after failed login attempts.
- **Security audit fixes applied (FASE 14.X):**
  - C1: `GET /api/admin/logs` now requires `requireAuth + requireRole(['MASTER','ADMIN','DEVELOPER','DIRECTOR'])`.
  - C2: All `/api/v1/users` CRUD routes now require `requireAuth + requireRole(['MASTER','ADMIN'])`.
  - C3: `POST /api/auth/revoke-sessions` now requires `requireAuth`.
  - BUG-01: `isLocked` check moved **before** L1/L2 rate-limit consumption in both admin and company login flows.
  - BUG-02: Admin unblock endpoint now also resets `isLocked + loginAttempts` on `users`/`companies` tables.
  - BUG-03: `security.blocker.ts::blockUser` converted to `async` with static import and awaited DB write.
  - BUG-04: Company login now emits `logAuthEvent` for `LOGIN_BLOCKED_LOCKED` and `LOGIN_BLOCKED_INACTIVE`.
  - BUG-05: Device-binding enforcement now activates for client-sent `X-Device-Id` headers (sessions with `srv-*` server-generated IDs remain unenforced for backward compat).
  - BUG-06: `validateSession` catch block is now **fail-closed** (`{ valid: false }` on DB error).
  - BUG-07: `getCompanySecurityProfile` no longer issues a second global `getAuthAttempts` query; brute-force signal derived from already-fetched company rows.
  - BUG-08: NF-e period-closure guard is now **fail-closed** (returns HTTP 503 on internal error instead of bypassing the fiscal check).
  - BUG-09: On startup, any NF-e stuck in `fiscal_status='enviando'` is recovered to `'erro'` (crash-safe reset).
  - BUG-10: ViaCEP IBGE lookup catch block now emits a structured `console.warn` instead of silently swallowing errors.
  - N+1 `/api/nfe/eligible`: replaced per-row `canEmitNFe` calls (500 SQL JOINs) with one batch JOIN + JS-level `getFaturamentoContext`.
  - N+1 `billing.service.ts`: replaced per-item `db.query.products.findFirst` loop with single `inArray` batch query + Map lookup.

### Core Features
- **Dual Portal System**: Separate interfaces for client companies and internal administration.
- **Role-Based Access**: Granular permissions across various user roles.
- **Price Management**: Dynamic pricing via price groups and administrative fees.
- **Ordering System**: Time-windowed orders, special orders, cart functionality, and workflow management with a controlled state machine and RBAC-gated transitions.
- **Reporting & Exports**: Comprehensive purchasing and financial reports, CSV export, DANFE Internal PDF, ERP Bling Export, and Fiscal Export Module (XML/XLSX).
- **Logistics Module**: Route, driver, vehicle management, maintenance, quotations, and a Route Assistant with geocoding for optimized delivery and GPS tracking.
- **Contratual Client Module**: Dedicated experience for contract clients, including scope viewing and change requests.
- **Virtual Assistant (Clara IA)**: AI-powered assistant for queries, smart exports, intelligence modules (commercial risk, financial forecast), and automated diagnostics.
- **Incident Management**: Tracks client and internal incidents.
- **White Label**: Company-specific branding and customization.
- **SaaS Multi-Tenant Platform**: Master control panel for managing companies, plans, subscriptions, and billing.
- **NF-e 4.00 Emission Module**: Full XML generation, SEFAZ transmission, DANFE PDF, and cancellation capabilities, including per-tenant certificate management and encryption.
- **Itaú Bank Integration**: Bank account management, OAuth2 authentication, statement fetching, boleto issuance, and reconciliation.
- **AI Developer Module**: Tool for system health monitoring, API testing, code analysis, E2E user flow simulation, documentation generation, and module scaffolding.
- **Advanced Permissions System**: Granular flag-based permissions.
- **Login Security & Account Lockout**: Automated account locking with admin unlock.
- **Security Logs**: Centralized logging of security events.
- **Simulação de Escopo Comercial**: Module for managing B2B prospect simulations.
- **Central de Treinamento**: In-app training guide.
- **Inventory Module**: Comprehensive system for managing inventory.
- **Maintenance Mode**: System-wide maintenance mode.
- **Per-User Test Mode**: Allows individual users to operate in a test environment.

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

### NF-e SEFAZ Transmission
- **SEFAZ Integration**: Handles NF-e 4.00 transmission, supporting mock and production modes, multi-UF dispatch, and mTLS `https.Agent`.
- **Certificate Management**: Environment-driven auto-loader for A1 certificates, dynamic per-tenant certificate management via API, and at-rest encryption of certificate passwords.

### Security Observability (Fase 7.1 + 7.2 + 11)
- **In-Memory Event Store**: `server/core/security/securityLogger.ts` — circular buffer (max 1000 events) for `RATE_LIMITED`, `HIGH_RISK_ACTION`, and `CRITICAL_ACTION` events. Zero DB dependency. Also forwards every event to the FASE 11 alert engine via `pushAlert`.
- **Admin Endpoint — Events**: `GET /api/admin/security/events` (MASTER/ADMIN only) — returns `{ events, total, topIPs, summary }` from the live buffer.
- **Analyzer** (Fase 7.2): `server/core/security/securityAnalyzer.ts` — pure-analysis layer, zero side effects.
  - `analyzeSecurity()` — aggregates events by IP, computes per-type counts, and assigns risk level: `LOW / MEDIUM / HIGH / CRITICAL`.
  - `detectSpike()` — counts events in last 60 s and flags `spike: true` when count > 50.
  - Risk thresholds: CRITICAL (≥5 critical or ≥20 rateLimit+1 critical), HIGH (≥3 critical or ≥10 rateLimit), MEDIUM (≥1 critical or ≥5 rateLimit), LOW otherwise.
- **Admin Endpoint — Analysis**: `GET /api/admin/security/analysis` (MASTER/ADMIN only) — returns `{ analysis: IPAnalysis[], spike: SpikeReport, total }`.
- **Integration**: `server/core/security/rateLimit.ts` calls `logSecurityEvent` at every rate-limit block, high-risk action, and critical action.
- **Alert Engine** (Fase 11): `server/core/security/alertEngine.ts` — in-memory deduplicating alert buffer (max 200 entries, 60 s window).
  - `pushAlert(type, message)` — fire-and-forget; deduplicates by type within the window, enforces cap, never throws.
  - `getAlerts()` — evicts expired entries, returns active alerts sorted by severity then recency.
  - Classification: CRITICAL (CRITICAL/FINANCIAL), HIGH (AFTER_CREATE/NFE_*/TENANT_MISMATCH), MEDIUM (SECURITY/FAILED/ERROR), LOW (everything else).
- **Admin Endpoint — Alerts**: `GET /api/admin/security/alerts` (MASTER/ADMIN/DEVELOPER/DIRECTOR) — returns `{ success, data: AlertEvent[], total }` from the live buffer.
- **Route Files**: `server/routes/security-events.routes.ts`, `server/routes/security-analysis.routes.ts`, and `server/routes/security-alerts.routes.ts` — all registered in `routes.ts`.

### Multi-Tenant Read Hardening
- **Tenant Guard**: Utilizes `validateOrderTenant` and `safeGetOrder` to ensure tenant isolation by validating the active tenant before any storage read, preventing cross-tenant data access.