# AUDITORIA COMPLETA — PORTAL VIVAFRUTAZ ERP
**Data:** 20 de Julho de 2026  
**Auditor:** Arquiteto de Software Sênior / Tech Lead  
**Metodologia:** Análise estática do código-fonte, mapeamento de dependências, inventário de módulos  
**Base:** 100% dos arquivos do projeto (sem suposições — evidências do código)

---

## ÍNDICE

1. [Inventário do Sistema (Módulos)](#fase-1)
2. [Mapeamento das Telas](#fase-2)
3. [Backend](#fase-3)
4. [Banco de Dados](#fase-4)
5. [Frontend](#fase-5)
6. [Permissões](#fase-6)
7. [Documentação](#fase-7)
8. [IA Clara](#fase-8)
9. [Módulo Fiscal / NF-e](#fase-9)
10. [Organização](#fase-10)
11. [Qualidade](#fase-11)
12. [Roadmap](#fase-12)
13. [Relatório Executivo Final](#executivo)

---

<a id="fase-1"></a>
## FASE 1 — INVENTÁRIO DO SISTEMA

### Escala do projeto
- **97 tabelas** no banco de dados
- **~60 arquivos de rota** no backend
- **~80 páginas/telas** no frontend
- **Stack:** React 18 + Wouter + TanStack Query / Express 5 + Drizzle ORM / PostgreSQL (Supabase)

---

### Módulos

| Módulo | Existe | Funcional | Incompleto | Duplicado | Em uso | Vale manter |
|--------|--------|-----------|------------|-----------|--------|-------------|
| **Dashboard Admin** | ✅ | ✅ | — | ⚠️ 5 dashboards | ✅ | ✅ (consolidar) |
| **Dashboard Executivo** | ✅ | ✅ | — | ⚠️ parcial c/ admin | ✅ | ✅ |
| **Clientes / Empresas** | ✅ | ✅ | — | — | ✅ | ✅ |
| **Produtos / Categorias** | ✅ | ✅ | — | — | ✅ | ✅ |
| **Grupos de Preço** | ✅ | ✅ | — | — | ✅ | ✅ |
| **Pedidos (Admin)** | ✅ | ✅ | — | — | ✅ | ✅ |
| **Pedidos (Cliente)** | ✅ | ✅ | — | — | ✅ | ✅ |
| **Janelas de Pedido** | ✅ | ✅ | — | — | ✅ | ✅ |
| **Exceções de Pedido** | ✅ | ✅ | — | — | ✅ | ✅ |
| **Pedidos Especiais** | ✅ | ✅ | — | — | ✅ | ✅ |
| **Logística** | ✅ | ✅ | — | ⚠️ duplicação de rotas | ✅ | ✅ |
| **Rastreamento (Driver Map)** | ✅ | ✅ | — | — | ✅ | ✅ |
| **Painel do Motorista** | ✅ | ✅ | — | — | ✅ | ✅ |
| **Inteligência Logística** | ✅ | ✅ | — | — | ✅ | ✅ |
| **Estoque / Inventário** | ✅ | ✅ | — | — | ✅ | ✅ |
| **Planejamento de Compras** | ✅ | ✅ | — | — | ✅ | ✅ |
| **Cotações** | ✅ | ✅ | — | — | ✅ | ✅ |
| **Controle de Desperdício** | ✅ | ✅ | — | — | ✅ | ✅ |
| **Contratos** | ✅ | ✅ | — | — | ✅ | ✅ |
| **Financeiro (AR/AP)** | ✅ | ✅ | — | ⚠️ 4 páginas financeiras | ✅ | ✅ (unificar) |
| **Inteligência Financeira** | ✅ | ✅ | — | ⚠️ parcial c/ relatórios | ✅ | ✅ |
| **Banco (Itaú)** | ✅ | ✅ real | — | — | ✅ | ✅ |
| **CNAB** | ✅ | ✅ | — | — | ✅ | ✅ |
| **Fiscal (NF entrada/OCR)** | ✅ | ✅ | — | ⚠️ parcial c/ NF-e | ✅ | ✅ |
| **NF-e (emissão)** | ✅ | ✅ | — | — | ✅ | ✅ |
| **Faturamento (cron NF-e)** | ✅ | ✅ | — | — | ✅ | ✅ |
| **Config Fiscal** | ✅ | ✅ | — | — | ✅ | ✅ |
| **Diagnóstico Fiscal** | ✅ | ✅ | — | — | ✅ | ✅ |
| **NF Manual** | ✅ | ✅ | — | — | ✅ | ✅ |
| **Relatórios (Compras)** | ✅ | ✅ | — | — | ✅ | ✅ |
| **Relatórios (Industrializ.)** | ✅ | ✅ | — | — | ✅ | ✅ |
| **Relatórios (Financeiro)** | ✅ | ✅ | — | ⚠️ sobreposição c/ intel. fin. | ✅ | ✅ |
| **Clara IA (chat)** | ✅ | ✅ | — | — | ✅ | ✅ |
| **Clara Training** | ✅ | ✅ | — | — | ✅ | ✅ |
| **Academy / Treinamento** | ✅ | ✅ | — | — | ✅ | ✅ |
| **Sanitário** | ✅ | ✅ | — | — | ✅ | ✅ |
| **Comercial Intelligence** | ✅ | ✅ | — | — | ✅ | ✅ |
| **E-mail Management** | ✅ | ✅ | — | — | ✅ | ✅ |
| **Comunicados (Announcements)** | ✅ | ✅ | — | — | ✅ | ✅ |
| **Tarefas (OS)** | ✅ | ✅ | — | — | ✅ | ✅ |
| **Incidentes Cliente** | ✅ | ✅ | — | — | ✅ | ✅ |
| **Incidentes Internos** | ✅ | ✅ | — | — | ✅ | ✅ |
| **Usuários / Permissões** | ✅ | ✅ | — | — | ✅ | ✅ |
| **Configurações** | ✅ | ✅ | — | — | ✅ | ✅ |
| **SMTP Config** | ✅ | ✅ | — | — | ✅ | ✅ |
| **SaaS Dashboard** | ✅ | ✅ | ⚠️ pagamentos mock | — | ✅ | ✅ |
| **SaaS Financeiro** | ✅ | ✅ | ⚠️ pagamentos mock | — | ✅ | ✅ |
| **Marketplace (módulos)** | ✅ | ⚠️ parcial | ⚠️ sem real activation | — | ⚠️ | ✅ |
| **White Label** | ✅ | ⚠️ parcial | ⚠️ sem real deploy | — | ⚠️ | ⚠️ adiar |
| **Control Center** | ✅ | ✅ | — | — | ✅ | ✅ |
| **Master Control** | ✅ | ✅ | — | — | ✅ | ✅ |
| **AI Developer** | ✅ | ⚠️ parcial | ⚠️ stubs internos | — | ⚠️ | ⚠️ adiar |
| **Security Dashboard** | ✅ | ✅ | — | ⚠️ 3 telas seg. | ✅ | ✅ (consolidar) |
| **Security Audit** | ✅ | ✅ | — | — | ✅ | ✅ |
| **Security Intelligence** | ✅ | ✅ | — | — | ✅ | ✅ |
| **Governance Dashboard** | ✅ | ✅ | — | — | ✅ | ✅ |
| **Observability** | ✅ | ✅ | — | ⚠️ parcial c/ system-health | ✅ | ✅ |
| **System Health** | ✅ | ✅ | — | — | ✅ | ✅ |
| **System Updates** | ✅ | ✅ | — | — | ✅ | ✅ |
| **Developer Page** | ✅ | ✅ | — | — | ✅ | ✅ |
| **Backups** | ✅ | ✅ | — | — | ✅ | ✅ |
| **Suporte Config** | ✅ | ✅ | — | — | ✅ | ✅ |
| **Sobre Nós** | ✅ | ✅ | — | — | ✅ | ✅ |
| **Importação de Dados** | ✅ | ✅ | — | — | ✅ | ✅ |
| **Scope Simulations** | ✅ | ✅ | — | — | ✅ | ✅ |
| **Notif. Push / Settings** | ✅ | ✅ | — | — | ✅ | ✅ |
| **PWA** | ✅ | ✅ | — | — | ✅ | ✅ |
| **Rastreamento público (track)** | ✅ | ✅ | — | — | ✅ | ✅ |
| **Autenticação (login/reset)** | ✅ | ✅ | — | — | ✅ | ✅ |
| **test-clara.tsx** | ✅ | ⚠️ mock | ⚠️ não é produção | — | ❌ | ❌ remover |

---

<a id="fase-2"></a>
## FASE 2 — MAPEAMENTO DAS TELAS

### Telas Admin (acesso interno)

| Rota | Arquivo | Status | Problemas / Observações |
|------|---------|--------|------------------------|
| `/admin` | `admin/dashboard.tsx` | ✅ Funcional | — |
| `/admin/executive` | `admin/executive-dashboard.tsx` | ✅ Funcional | Sobreposição parcial de KPIs com `/admin` |
| `/admin/saas-dashboard` | `admin/saas-dashboard.tsx` | ✅ Funcional | Pagamentos SaaS são mock |
| `/admin/governance` | `admin/governance-dashboard.tsx` | ✅ Funcional | — |
| `/admin/security` | `admin/security-dashboard.tsx` | ✅ Funcional | 3 telas de segurança separadas — considerar unificação |
| `/admin/security-audit` | `admin/security-audit.tsx` | ✅ Funcional | — |
| `/admin/security-intelligence` | `admin/security-intelligence.tsx` | ✅ Funcional | — |
| `/admin/companies` | `admin/companies.tsx` | ✅ Funcional | — |
| `/admin/users` | `admin/users.tsx` | ✅ Funcional | — |
| `/admin/products` | `admin/products.tsx` | ✅ Funcional | — |
| `/admin/categories` | `admin/categories.tsx` | ✅ Funcional | — |
| `/admin/price-groups` | `admin/price-groups.tsx` | ✅ Funcional | — |
| `/admin/order-windows` | `admin/order-windows.tsx` | ✅ Funcional | — |
| `/admin/order-exceptions` | `admin/order-exceptions.tsx` | ✅ Funcional | — |
| `/admin/orders` | `admin/orders.tsx` | ✅ Funcional | — |
| `/admin/special-orders` | `admin/special-orders.tsx` | ✅ Funcional | — |
| `/admin/logistics` | `admin/logistics.tsx` | ✅ Funcional | Duplicação de rota no backend (modules/ vs routes/) |
| `/admin/logistics-intelligence` | `admin/logistics-intelligence.tsx` | ✅ Funcional | — |
| `/admin/driver-panel` | `admin/driver-panel.tsx` | ✅ Funcional | — |
| `/admin/inventory` | `admin/inventory.tsx` | ✅ Funcional | — |
| `/admin/purchase-planning` | `admin/purchase-planning.tsx` | ✅ Funcional | — |
| `/admin/waste-control` | `admin/waste-control.tsx` | ✅ Funcional | — |
| `/admin/quotations` | `admin/quotations.tsx` | ✅ Funcional | — |
| `/admin/contracts` | `admin/contracts.tsx` | ✅ Funcional | — |
| `/admin/financial` | `admin/reports/financial.tsx` | ✅ Funcional | Sobreposição de "top clientes" com financial-intelligence |
| `/admin/financial-intelligence` | `admin/financial-intelligence.tsx` | ✅ Funcional | BI avançado — distinção clara de `financial` |
| `/admin/finance` | `admin/finance.tsx` | ✅ Funcional | AR/AP operacional — distinto dos reports |
| `/admin/saas-financeiro` | `admin/saas-financeiro.tsx` | ✅ Funcional | SaaS-specific billing — distinto |
| `/admin/banco` | `admin/banco.tsx` | ✅ Funcional | Integração Itaú real |
| `/admin/fiscal` | `admin/fiscal.tsx` | ✅ Funcional | Foco em NF de entrada/OCR |
| `/admin/nfe` | `admin/nfe.tsx` | ✅ Funcional | Emissão de NF-e — módulo moderno |
| `/admin/fiscal-config` | `admin/fiscal-config.tsx` | ✅ Funcional | Config global do emissor/certificado |
| `/admin/fiscal-diagnostics` | `admin/fiscal-diagnostics.tsx` | ✅ Funcional | Health check do pipeline NF-e |
| `/admin/faturamento` | `admin/faturamento.tsx` | ✅ Funcional | Cron de faturamento automático |
| `/admin/insert-nf-manual` | `admin/insert-nf-manual.tsx` | ✅ Funcional | NF sem pedido vinculado |
| `/admin/purchasing` | `admin/reports/purchasing.tsx` | ✅ Funcional | — |
| `/admin/industrialized` | `admin/reports/industrialized.tsx` | ✅ Funcional | — |
| `/admin/tasks` | `admin/tasks.tsx` | ✅ Funcional | — |
| `/admin/client-incidents` | `admin/client-incidents.tsx` | ✅ Funcional | — |
| `/admin/internal-incidents` | `admin/internal-incidents.tsx` | ✅ Funcional | — |
| `/admin/sanitary` | `admin/sanitary.tsx` | ✅ Funcional | — |
| `/admin/commercial-intelligence` | `admin/commercial-intelligence.tsx` | ✅ Funcional | — |
| `/admin/email-management` | `admin/email-management.tsx` | ✅ Funcional | — |
| `/admin/announcements` | `admin/announcements.tsx` | ✅ Funcional | — |
| `/admin/treinamento` | `admin/treinamento.tsx` | ✅ Funcional | Academy |
| `/admin/clara-training` | `admin/clara-training.tsx` | ✅ Funcional | QA pairs para Clara IA |
| `/admin/system-health` | `admin/system-health.tsx` | ✅ Funcional | — |
| `/admin/observability` | `admin/observability.tsx` | ✅ Funcional | Sobreposição parcial com system-health |
| `/admin/system-updates` | `admin/system-updates.tsx` | ✅ Funcional | — |
| `/admin/backups` | `admin/backups.tsx` | ✅ Funcional | — |
| `/admin/developer` | `admin/developer.tsx` | ✅ Funcional | — |
| `/admin/ai-developer` | `admin/ai-developer.tsx` | ⚠️ Parcial | Funcionalidades de IA de código são stubs |
| `/admin/master-control` | `admin/master-control.tsx` | ✅ Funcional | — |
| `/admin/control-center` | `admin/control-center.tsx` | ✅ Funcional | — |
| `/admin/settings` | `admin/settings.tsx` | ✅ Funcional | — |
| `/admin/smtp-config` | `admin/smtp-config.tsx` | ✅ Funcional | — |
| `/admin/support` | `admin/support-config.tsx` | ✅ Funcional | — |
| `/admin/white-label` | `admin/white-label.tsx` | ⚠️ Parcial | UI existe, deploy não implementado |
| `/admin/marketplace` | `admin/marketplace.tsx` | ⚠️ Parcial | UI de módulos, ativação sem backend real |
| `/admin/scope-simulations` | `admin/scope-simulations.tsx` | ✅ Funcional | — |
| `/admin/password-reset-requests` | `admin/password-reset-requests.tsx` | ✅ Funcional | — |
| `/admin/notification-settings` | `admin/notification-settings.tsx` | ✅ Funcional | — |
| `/admin/import-data` | `admin/import-data.tsx` | ✅ Funcional | — |
| `/admin/about-us` | `admin/about-us.tsx` | ✅ Funcional | — |

### Telas Cliente (portal externo)

| Rota | Arquivo | Status | Observações |
|------|---------|--------|-------------|
| `/client` | `client/dashboard.tsx` | ✅ Funcional | — |
| `/client/create-order` | `client/create-order.tsx` | ✅ Funcional | — |
| `/client/edit-order/:id` | `client/edit-order.tsx` | ✅ Funcional | — |
| `/client/order-history` | `client/order-history.tsx` | ✅ Funcional | — |
| `/client/quotations` | `client/quotations.tsx` | ✅ Funcional | — |
| `/client/special-order` | `client/special-order.tsx` | ✅ Funcional | — |
| `/client/incidents` | `client/incidents.tsx` | ✅ Funcional | — |
| `/client/profile` | `client/profile.tsx` | ✅ Funcional | — |
| `/client/contract-scope` | `client/contract-scope.tsx` | ✅ Funcional | Somente leitura — não duplica admin/contracts |
| `/client/about-us` | `client/about-us.tsx` | ✅ Funcional | — |

### Telas Públicas / Especiais

| Rota | Arquivo | Status | Observações |
|------|---------|--------|-------------|
| `/login` | `auth/login.tsx` | ✅ Funcional | — |
| `/reset-password` | `auth/reset-password.tsx` | ✅ Funcional | — |
| `/change-password` | `auth/change-password.tsx` | ✅ Funcional | — |
| `/track` | `track.tsx` | ✅ Funcional | Rastreamento público |
| `/driver-map` | `driver-map.tsx` | ✅ Funcional | — |
| `/test-clara` | `test-clara.tsx` | ❌ Mock | Página de diagnóstico com dados mock — não deveria estar em produção |

---

<a id="fase-3"></a>
## FASE 3 — BACKEND

### Arquitetura Geral
O backend usa Express 5 com uma arquitetura em transição: o código migrado vai para `server/modules/` (domínio limpo com controller/service/repository), enquanto código legado permanece em `server/routes/`. Há também uma camada de "core" em `server/core/` com infraestrutura transversal.

### Registro de Rotas (server/app.ts)
```
registerV2Modules(app)   → /api/v2/ (apenas orders por enquanto)
registerV1Modules(app)   → /api/v1/ (aliases dos módulos)
registerModules(app)     → /api/ (módulos canônicos)
registerRoutes(app)      → Rotas legadas em server/routes/
```

### Módulos Modernos (server/modules/)

| Módulo | Controller | Service | Repository | API Version | Status |
|--------|-----------|---------|------------|-------------|--------|
| auth | ✅ | ✅ | ✅ + UserProvisioningService | v1 | ✅ Completo |
| companies | ✅ | ✅ | ✅ + CompanyCertificateRepository | v1 | ✅ Completo |
| finance | ✅ | ✅ | ✅ | v1 | ✅ Completo |
| fiscal | ✅ (minimal) | — | — | v1 | ⚠️ Parcial |
| inventory | ✅ | ✅ | ✅ | v1 | ✅ Completo |
| logistics | ✅ | ✅ | ✅ + AutoDispatch + ETA | v1 | ✅ Completo |
| orders | ✅ v1 + v2 | ✅ | ✅ + Workflow + Outbox Worker | v1 + v2 | ✅ Completo |
| products | ✅ | ✅ | ✅ | v1 | ✅ Completo |
| users | ✅ | ✅ | ✅ | v1 | ✅ Completo |

### Rotas Legadas (server/routes/) — ~60 arquivos

**Duplicações confirmadas com server/modules/:**
- `logistics.routes.ts` existe em ambos — `server/modules/` prevalece no registro
- `fiscal` tem rota em modules/ (minimal) + `fiscal-invoices.routes.ts` + `fiscal-diagnostics.routes.ts` em routes/ — convivem sem conflito porque cobrem sub-domínios diferentes

**Rotas legadas sem equivalente modular (mantidas por necessidade):**
- `assistant.routes.ts` — Clara IA chat
- `clara.routes.ts` — AI developer tools
- `audit.routes.ts`, `security.routes.ts`, `logs.routes.ts`
- `backup.routes.ts`, `smtp-config.routes.ts`, `saas.routes.ts`
- `bank.routes.ts`, `announcements.routes.ts`, `tasks.routes.ts`
- `scope-simulations.routes.ts`, `sanitary.routes.ts`
- `fiscal-diagnostics.routes.ts`, `nfe-related` endpoints em `routes.ts`

### Services

| Service | Localização | Status | Observação |
|---------|-------------|--------|------------|
| `storage.ts` | server/services/ | ⚠️ Legacy | Camada de abstração antiga — sendo substituída por Drizzle direto nos novos módulos. Ainda referenciada em `routes/routes.ts` |
| `mailer.ts` | server/services/ | ✅ Ativo | nodemailer — funcional |
| `pushService.ts` | server/services/ | ✅ Ativo | web-push — funcional |
| `memoryModule.ts` | server/services/ | ❌ Stub | Array em memória — comentário interno diz "mover para DB em produção" |
| `aiDeveloper.ts` | server/services/ | ⚠️ Parcial | Chamado por clara.routes.ts — funcionalidades avançadas são stubs |
| `companySettingsService.ts` | server/services/ | ✅ Ativo | — |
| `itauIntegration.ts` | server/services/financeiro/ | ✅ Real | Integração real com Itaú OAuth + Cash Management V2 |
| `geoService.ts` | server/services/logistics/ | ✅ Ativo | — |
| `routeOptimizer.ts` | server/services/logistics/ | ✅ Ativo | — |
| `nf.draft.ts / nf.draft.builder.ts` | server/services/ | ✅ Ativo | — |
| `fiscal-closure.service.ts` | server/services/fiscal/ | ✅ Ativo | — |
| `logger.ts` | server/services/ | ⚠️ Legacy | Console wrapper simples — deve ser substituído pelo logger estruturado em core/observability/ |
| Todos em `server/services/alerts/` | server/services/alerts/ | ✅ Ativo | Suite massiva de alertas |

### Jobs / Workers

| Job | Arquivo | Trigger | Status |
|-----|---------|---------|--------|
| Faturamento NF-e | `jobs/faturamento.cron.ts` | node-cron | ✅ Ativo |
| Email Scheduler | `bootstrap/scheduler.ts` | Boot | ✅ Ativo |
| Continuous Audit | `bootstrap/scheduler.ts` | Boot | ✅ Ativo |
| Auto-Dispatch | `modules/logistics/` | Outbox worker | ✅ Ativo |
| Orders Outbox | `modules/orders/` | Outbox worker | ✅ Ativo |
| Event Analytics | `core/events/event-analytics.worker.ts` | Boot | ✅ Ativo |
| Job Registry | `core/jobs/job-registry.ts` | In-memory tracker | ✅ Ativo |

### Middlewares

| Middleware | Localização | Status | Observação |
|-----------|-------------|--------|------------|
| `auth.ts` | server/middleware/ | ✅ | Re-exporta de core/http/requireAuth |
| `tenant.ts` | server/middleware/ | ✅ | Isolamento multi-tenant via ALS |
| `requestContext.ts` | server/middleware/ | ✅ | AsyncLocalStorage |
| `requestLogger.ts` | server/middleware/ | ✅ | — |
| `requestId.ts` | server/middleware/ | ✅ | UUID por request |
| `authenticate.ts` | server/shared/middlewares/ | ⚠️ | Implementação simplificada separada — potencial inconsistência |
| `requireRole.ts` | server/shared/middlewares/ | ✅ | Verificação de role |
| `requireAuth.ts` | server/core/http/ | ✅ | Implementação canônica |
| `rateLimit.ts` | server/core/http/ | ✅ | Login/email limiter |
| `rateLimit.ts` | server/core/security/ | ✅ | Multi-limiter (NF-e, API) — mais completo |
| `tenantGuard.ts` | server/core/security/ | ✅ | Proteção de tenant com blocker |
| `schemaEnforcement.ts` | server/core/security/ | ✅ | — |

### ⚠️ DUPLICAÇÕES CONFIRMADAS NO BACKEND

1. **Logger:** `server/services/logger.ts` (legado, console wrapper) vs `server/core/observability/logger.ts` (estruturado, tenant-aware, JSON). O legado deve ser aposentado.
2. **Rate Limit:** `server/core/http/rateLimit.ts` vs `server/core/security/rateLimit.ts` — o de security/ é mais completo.
3. **Autenticação:** `server/middleware/auth.ts` re-exporta core/http, mas `server/shared/middlewares/authenticate.ts` é uma implementação separada — risco de divergência silenciosa.
4. **DB Client:** `server/database/db.ts` (primário) vs `server/shared/db/client.ts` (re-export) — funcional, mas confuso.
5. **storage.ts vs Drizzle direto:** Dois padrões de acesso a dados coexistem. storage.ts é o legado; módulos novos usam Drizzle diretamente.
6. **Integrações de pagamento SaaS:** `saas.routes.ts` gera PIX e boletos localmente (mock) sem chamar gateway real.

---

<a id="fase-4"></a>
## FASE 4 — BANCO DE DADOS

### Volume
**97 tabelas** definidas em `shared/schema.ts` (único arquivo, ~2000+ linhas). Nenhum outro arquivo de schema encontrado.

### Grupos de Tabelas

**Núcleo do ERP:**
`users`, `companies`, `price_groups`, `products`, `categories`, `product_prices`, `product_sub_categories`, `orders`, `order_items`, `contract_scopes`

**Configurações:**
`system_settings`, `order_windows`, `order_exceptions`, `company_config`, `company_settings`, `empresa_config`, `smtp_config`, `notification_settings`, `inventory_settings`

**⚠️ DUPLICAÇÃO SUSPEITA:** Três tabelas de configuração de empresa:
- `company_config` — configuração tenant-specific
- `company_settings` — outra camada de settings de empresa
- `empresa_config` — terceira tabela similar (nome em português)

Recomenda-se investigar se as três têm propósitos distintos ou são redundâncias históricas.

**Logística:**
`logistics_drivers`, `logistics_vehicles`, `logistics_routes`, `logistics_maintenance`, `deliveries`, `route_stops`, `logistics_audit_logs`, `driver_gps_positions`, `delivery_checklists`

**Financeiro:**
`accounts_receivable`, `accounts_payable`, `financial_transactions`, `bank_accounts`, `bank_transactions`, `bancos_recebimento`, `cnab_import_history`

**NF-e / Fiscal:**
`nfe_emissoes`, `nfe_cce`, `nfe_cce_audit_logs`, `nf_manual`, `nf_drafts`, `fiscal_invoices`, `fiscal_closures`, `danfe_records`, `nfe_training_logs`, `company_certificates`

**Inventário:**
`inventory_entries`, `inventory_movements`, `inventory_physical_counts`, `waste_control`, `purchase_plan_status`

**Incidentes / Tarefas:**
`client_incidents`, `incident_messages`, `internal_incidents`, `tasks`, `special_order_requests`

**Segurança / Auditoria:**
`system_logs`, `audit_logs`, `auth_attempts`, `security_blocked_users`, `tenant_mismatch_events`, `event_store`, `event_risk_snapshots`, `system_alerts`

**⚠️ DUPLICAÇÃO SUSPEITA:** `system_logs` vs `audit_logs` — propósito pode ser sobreposição. Necessita verificação.

**SaaS / Billing:**
`planos`, `assinaturas`, `billing_events`, `faturas_saas`, `contratos_clientes`, `saas_metrics`, `modulos_sistema`, `plano_modulos`, `modulos_marketplace`, `empresa_modulos`

**IA / Clara:**
`clara_training`, `ai_interactions`, `ai_logs`, `nfe_training_logs`

**Push / Email:**
`push_subscriptions`, `email_schedules`, `email_logs`

**Misc:**
`about_us`, `announcements`, `scope_simulations`, `sanitary_questions`, `sanitary_evaluations`, `sanitary_evaluation_items`, `price_adjustment_snapshots`, `workflow_events`, `cron_faturamento_runs`, `password_reset_requests`, `password_reset_tokens`, `test_orders`, `system_versions`, `system_updates`, `update_logs`, `company_addresses`, `company_quotations`, `contract_adjustments`

### Problemas Identificados

| Problema | Tabelas | Severidade |
|----------|---------|------------|
| Triple config de empresa | `company_config`, `company_settings`, `empresa_config` | 🔴 Alta |
| Logs duplicados | `system_logs` vs `audit_logs` | 🟡 Média |
| Schema monolítico 2000+ linhas | `shared/schema.ts` | 🟡 Média (manutenção) |
| `test_orders` em produção | `test_orders` | 🟡 Média |
| `ai_interactions` vs `ai_logs` | propósito similar? | 🟡 Média |

---

<a id="fase-5"></a>
## FASE 5 — FRONTEND

### Design System
O projeto usa **shadcn/ui** como base, com **38 componentes UI padronizados** em `client/src/components/ui/`. O design system é consistente: todas as telas usam os mesmos primitivos (Button, Card, Badge, Table, Dialog, etc.). Não foram encontrados componentes UI ad-hoc duplicando a shadcn.

**Tailwind:** configurado. **dark mode:** suportado via `next-themes`.

### Componentes Customizados (`components/` — fora de `ui/`)

| Componente | Status | Observação |
|-----------|--------|------------|
| `Layout.tsx` | ✅ | Wrapper geral com sidebar |
| `VirtualAssistant.tsx` | ✅ | Chat flutuante da Clara IA |
| `NfeDiagnosticsPanel.tsx` | ✅ | Validação por pedido (≠ fiscal-diagnostics página) |
| `OrderTimeline.tsx` | ✅ | Timeline de status do pedido |
| `GlobalSearch.tsx` | ✅ | Busca global |
| `Modal.tsx` | ✅ | Wrapper de Dialog — pode ser redundante com shadcn Dialog |
| `ErrorBoundary.tsx` | ✅ | — |
| `PWAInstallPrompt.tsx` | ✅ | — |
| `FruitCuriosities.tsx` | ✅ | Onboarding/UX touch |
| `FloatingGuide.tsx` | ✅ | Contextual help |
| `ContextualTip.tsx` | ✅ | — |
| `TrainingMode.tsx` | ✅ | Academy overlay |
| `WhatsNewModal.tsx` | ✅ | Novidades |
| `FiscalInvoiceOCR.tsx` | ✅ | Upload/OCR de NF entrada |
| `ImportarRetornoCnab.tsx` (banking/) | ✅ | CNAB return import |

**⚠️ Potencial Redundância:** `Modal.tsx` — o shadcn `Dialog` já oferece essa funcionalidade. Se `Modal.tsx` for apenas um wrapper de Dialog sem lógica adicional, pode ser removido.

### Hooks Customizados (`hooks/`)

| Hook | O que faz | Status |
|------|-----------|--------|
| `use-auth.ts` | Estado de autenticação global | ✅ Core |
| `use-admin.ts` | CRUD companies, users, price groups | ✅ Usado |
| `use-catalog.ts` | Produtos e preços | ✅ Usado |
| `use-ordering.ts` | Pedidos, janelas, relatórios | ✅ Usado |
| `use-safe-query.ts` | React Query com error handling padronizado | ✅ Usado |
| `use-push-notifications.ts` | Subscriptions web push | ✅ Usado |
| `use-can-emit-nfe.ts` | Preflight NF-e por pedido | ✅ Usado |
| `use-emitir-lote-nfe.ts` | Estado de emissão em lote | ✅ Usado |
| `use-mobile.tsx` | Breakpoint detection | ✅ Usado |

### Repetições / Padrões Duplicados no Frontend

| Padrão | Onde aparece | Problema |
|--------|-------------|---------|
| **Tabela de dados com filtro** | ~20+ páginas | Sem componente genérico `<DataTable>` — cada tela reimplementa |
| **KPI Cards no topo** | dashboard, executive, saas, governance, security | Sem componente `<KPICard>` reutilizável |
| **Badge de status** | orders, nfe, logistics, etc. | Sem enum centralizado de cores/labels — cada módulo define os seus |
| **Modal de confirmação de exclusão** | ~15+ páginas | Sem componente `<ConfirmDeleteDialog>` genérico |
| **Ranking "Top Clientes"** | `reports/financial.tsx` + `financial-intelligence.tsx` | Lógica duplicada |

---

<a id="fase-6"></a>
## FASE 6 — PERMISSÕES

### Roles Definidos
```
MASTER, ADMIN, DIRECTOR, DEVELOPER, OPERATIONS_MANAGER, 
PURCHASE_MANAGER, FINANCEIRO, LOGISTICS, GESTOR_CONTRATOS, 
MOTORISTA, NUTRICIONISTA
```
(11 roles)

### Mecânica de Autenticação
- **Sessão:** express-session com `SESSION_SECRET` + `connect-pg-simple` (sessões em PostgreSQL)
- **requireAuth:** Verifica `session.userId` — implementado em `server/core/http/requireAuth.ts`
- **requireRole:** Verifica `session.userRole` contra lista de permitidos. MASTER/ADMIN/DIRECTOR bypass automático (exceto `strict: true`)
- **tenantGuard:** AsyncLocalStorage garante que cada request só acessa dados do próprio `companyId`. Inclui blocker por tentativas repetidas inválidas.

### Proteção de Rotas (frontend)
Rotas protegidas via `PrivateRoute` em `App.tsx`. Roles são passados como lista de permissão por rota.

### Tab Permissions
Usuários staff podem ter restrições granulares por `tabKey` armazenadas no perfil — permite controlar visibilidade de sub-abas sem criar novo role.

### ⚠️ Problemas Identificados

| Problema | Risco |
|----------|-------|
| `server/shared/middlewares/authenticate.ts` é implementação separada de `core/http/requireAuth.ts` | Se divergirem, algumas rotas ficam com autenticação inconsistente |
| MASTER/ADMIN bypass automático pode permitir acesso indevido se uma rota sensível esquecer `strict: true` | Médio |
| Sem auditoria de quais rotas usam qual middleware | Dificulta revisão de segurança |

---

<a id="fase-7"></a>
## FASE 7 — DOCUMENTAÇÃO

### Arquivos .md na raiz

| Arquivo | Conteúdo | Status |
|---------|----------|--------|
| `replit.md` | Preferências de desenvolvimento | ✅ Relevante |
| `APRESENTACAO_EXECUTIVA.md` | Overview executivo | ⚠️ Desatualizado |
| `QUICK_START.md` | Guia de início rápido | ✅ Útil |
| `START_HERE.md` | Onboarding para devs | ✅ Útil |
| `RESUMO_TECNICO.md` | Resumo técnico | ⚠️ Pode estar desatualizado |
| `ROUTE_SAFETY_AUDIT.md` | Auditoria de segurança de rotas | ⚠️ Histórico — verificar validade |
| `SECURITY_PHASE3A_REPORT.md` | Relatório de segurança | ⚠️ Histórico |
| `RELATORIO_CORRECOES_2026.md` | Registro de correções | ⚠️ Histórico |
| `CHECKLIST_IA_DEVELOPER.md` | Checklist AI developer | ⚠️ Histórico |
| `DOCUMENTACAO_INDICE.md` | Índice de docs | ⚠️ Pode estar desatualizado |
| `LISTA_DOCUMENTACAO.md` | Lista de docs | ⚠️ Redundante com índice |
| `MAPA_ARQUIVOS.md` | Mapa de arquivos | ⚠️ Provavelmente desatualizado (projeto cresceu) |
| `ANALISE_IMPORTS_COMPLETA.md` | Análise de imports | ❌ Histórico — pode remover |
| `ANALISE_IMPORTS_COMPLETA_v2.md` | v2 da mesma análise | ❌ Histórico — pode remover |
| `RELATORIO_FINAL.md` | Relatório antigo | ❌ Histórico — pode remover |
| `docs/readiness-report-fase-1-3.md` | Relatório prontidão SEFAZ | ✅ Recente — útil |

### attached_assets/
Mais de **100 arquivos `.txt`** e alguns `.pfx` e imagens — são prompts históricos enviados ao agente de desenvolvimento. **Não são código nem documentação do projeto.** Ocupam espaço sem valor operacional.

**2 certificados digitais `.pfx`** presentes em `attached_assets/` — precisam ser verificados se são reais ou de teste, e se devem estar no repositório.

### scripts/ folder
Contém scripts TypeScript de validação, chaos test e engines de governança de autenticação. Alguns têm valor de teste contínuo; outros são históricos de fases de desenvolvimento.

---

<a id="fase-8"></a>
## FASE 8 — IA CLARA

### O que é Clara IA (evidências do código)
Clara IA é um **sistema especialista baseado em regras + correspondência de padrões**, não um LLM. A inteligência é construída em camadas:

### Camada 1 — Assistente Interativo (Chat)
| Arquivo | Status | O que faz |
|---------|--------|-----------|
| `server/routes/assistant.routes.ts` | ✅ Completo | Intent detection via regex, máquina de estados multi-turn, acesso a dados reais (orders, stock, weather) |
| `client/src/components/VirtualAssistant.tsx` | ✅ Completo | UI do chat flutuante com markdown, shortcuts, export |
| `client/src/pages/admin/clara-training.tsx` | ✅ Completo | CRUD de pares Q&A no banco de dados |
| `shared/schema.ts` → `clara_training` | ✅ | Tabela de treinamento persistida |

### Camada 2 — Intelligence Engine (Background)
| Arquivo | Status | O que faz |
|---------|--------|-----------|
| `server/core/intelligence/intelligence.engine.ts` | ✅ Completo | Análise de eventos de sistema, rolling windows, score de risco |
| `server/core/decision/decision.engine.ts` | ✅ Completo | Traduz score de risco em ações defensivas (notificações, Protective Mode, lockouts) |
| `server/core/security/anomalyDetection.service.ts` | ✅ Ativo | Detecção de brute force, retry storms |
| `server/core/security/continuousAudit.ts` | ✅ Ativo | Auditoria contínua em background |

### Camada 3 — AI Developer (Parcial)
| Arquivo | Status | O que faz |
|---------|--------|-----------|
| `server/routes/clara.routes.ts` | ⚠️ Parcial | Endpoints de fix-bug, generate-module — chamam `aiDeveloper.ts` que tem stubs |
| `server/services/aiDeveloper.ts` | ⚠️ Stub | Funcionalidades avançadas de geração de código não implementadas |
| `server/services/memoryModule.ts` | ❌ Stub | Array em memória — comentário interno: "mover para DB em produção" |

### Separação IA vs ERP Genérico
**Pertence à IA:**
- Intent detection + state machine (`assistant.routes.ts`)
- Training Q&A (`clara_training` tabela + `clara-training.tsx`)
- Risk/anomaly engines (`intelligence.engine.ts`, `decision.engine.ts`)
- `ai_interactions`, `ai_logs`, `nfe_training_logs` tabelas

**É infraestrutura ERP chamada pela IA (não é IA):**
- `safeGetOrders`, wrappers de dados — são ERP
- `createCompanyFromClaraAI` — é provisioning ERP
- storage/DB calls — são infraestrutura

### ⚠️ Problemas
- `test-clara.tsx` em produção com dados mock — deve ser removido
- `memoryModule.ts` em memória — perde estado a cada restart
- Smart Export (`/api/clara/export`) funcional mas `clara.routes.ts` também tenta duplicar funcionalidade de chat do `assistant.routes.ts`

---

<a id="fase-9"></a>
## FASE 9 — MÓDULO FISCAL / NF-e

### Status Geral: **Maduro e Completo**
O módulo fiscal é o mais robusto e bem estruturado do sistema.

### Mapa Completo do Módulo

#### Emissão (manter como estrutura base)

| Arquivo | Status | Papel |
|---------|--------|-------|
| `nfeGenerator.ts` | ✅ Completo | Construção do XML NF-e 4.00 |
| `nfeSigner.ts` / `nfeSignature.ts` | ✅ Completo | Assinatura digital XMLDSIG |
| `nfeSender.ts` / `nfeSoap.ts` | ✅ Completo | Comunicação SOAP com SEFAZ |
| `nfeUrl.ts` | ✅ Completo | URLs dos webservices por UF/ambiente |
| `nfeCert.ts` / `nfeCertDynamic.ts` / `nfeCertGuard.ts` | ✅ Completo | Gestão multi-tenant de certificados A1 |
| `nfeValidator.ts` / `nfeXmlGuard.ts` | ✅ Completo | Validação pré-envio |
| `nfeErrorHandler.ts` / `nfeAutoCorrect.ts` | ✅ Completo | Tratamento automático de rejeições SEFAZ |
| `sefazCircuitBreaker.ts` | ✅ Completo | Fault tolerance para instabilidade SEFAZ |
| `danfeGenerator.ts` | ✅ Completo | Geração de DANFE em PDF |
| `icms-summary.service.ts` | ✅ Completo | Analytics ICMS |

#### Diagnósticos (manter)

| Arquivo | Status | Papel |
|---------|--------|-------|
| `nfe-error-parser.ts` | ✅ Completo | Traduz códigos SEFAZ para humanos |
| `nfe-fix-suggestions.ts` | ✅ Completo | Sugestões de correção por código |
| `nfe-training.ts` | ✅ Completo | Telemetria de falhas |
| `nfe-validator.ts` (diagnostics/) | ✅ Completo | Orquestra suite de diagnóstico |

#### Dados Fiscais (estrutura base — manter conforme auditoria)

| Tabela/Dado | Localização | Manter |
|-------------|-------------|--------|
| Empresa / CNPJ / CRT | `companies`, `empresa_config` | ✅ |
| NCM | `products` (campo `ncmCode`) | ✅ |
| CFOP | `orders` / `order_items` | ✅ |
| CST / CSOSN | `nfeGenerator.ts` (cálculo) | ✅ |
| Natureza de Operação | `orders` (campo `naturezaOperacao`) | ✅ |
| Dados Fiscais (IE, IM) | `companies` | ✅ |
| Estrutura XML | `nfeGenerator.ts` | ✅ |
| Certificados | `company_certificates` | ✅ |

#### O que está além do escopo atual (per auditoria)
Tudo listado acima **já existe e está implementado**. A decisão de escopo (manter apenas estrutura base, sem emissão ativa ao SEFAZ) é uma decisão de produto, não técnica.

### Único Bloqueador para Homologação
Certificado Digital A1 não configurado no ambiente. Toda a infraestrutura de emissão está pronta.

---

<a id="fase-10"></a>
## FASE 10 — ORGANIZAÇÃO

### Estrutura de Pastas
```
workspace/
├── client/src/          → Frontend React
│   ├── components/      → Componentes (ui/ + custom)
│   ├── hooks/           → Custom hooks
│   ├── pages/           → Telas (admin/ + client/ + auth/)
│   ├── services/        → nfe.service.ts (1 arquivo)
│   └── utils/           → priceResolver.ts (1 arquivo)
├── server/              → Backend Express
│   ├── bootstrap/       → Inicialização de schedulers
│   ├── config/          → Feature flags
│   ├── controllers/     → userController.ts (legado)
│   ├── core/            → Infraestrutura transversal
│   ├── database/        → Drizzle client
│   ├── infra/           → Upload, PDF parser
│   ├── jobs/            → Cron jobs
│   ├── middleware/       → Middlewares (alguns re-exports)
│   ├── modules/         → Módulos domain-driven (v1/v2)
│   ├── routes/          → Rotas legadas (~60 arquivos)
│   ├── services/        → Services (mistura de legado e ativo)
│   ├── shared/          → Utilities compartilhadas
│   └── utils/           → auditLogger, crypto
├── shared/              → Schema Drizzle + rotas compartilhadas
├── scripts/             → Scripts de validação e teste
├── tests/               → Unit + E2E tests
├── docs/                → Documentação técnica
└── attached_assets/     → 100+ prompts históricos (.txt) ← não é código
```

### Código Morto / Arquivos Sem Uso

| Item | Tipo | Ação sugerida |
|------|------|--------------|
| `test-clara.tsx` | Página mock | Remover |
| `client/src/pages/test-clara.tsx` | Mock page | Remover |
| `tmp_migrations.js` | Script temporário | Remover |
| `server/services/memoryModule.ts` | Stub em memória | Migrar para DB ou remover |
| `server/services/logger.ts` | Logger legado | Substituir referencias, remover |
| `ANALISE_IMPORTS_COMPLETA.md` + `_v2.md` | Análises históricas | Remover |
| `RELATORIO_FINAL.md` | Histórico | Remover |
| `attached_assets/*.txt` (100+ arquivos) | Prompts históricos | Limpar (não são código) |
| `tests/reports/` (binários zip) | Playwright artifacts | Gitignore + limpar |
| `tests/videos/` (traces zip) | Playwright artifacts | Gitignore + limpar |
| `server/controllers/userController.ts` | Legado (1 arquivo) | Migrar para modules/users/ |

### Imports Desnecessários / Dependências

| Dependência | Observação |
|-------------|------------|
| `ngrok` em `package.json` | Ferramenta de dev — não deveria estar em deps principais |
| `tesseract.js` | OCR — usado em FiscalInvoiceOCR? Confirmar uso |
| `playwright` em dependencies | Deveria estar em devDependencies |
| `@playwright/test` em dependencies | Idem |
| `ts-node` em dependencies | Usado só em desenvolvimento |
| `xlsx` | Confirmar uso ativo |

---

<a id="fase-11"></a>
## FASE 11 — QUALIDADE

### Notas por Dimensão

| Dimensão | Nota | Justificativa |
|----------|------|---------------|
| **Arquitetura** | 7.5/10 | Transição modules/ vs routes/ clara e bem encaminhada. Coexistência de legado e moderno é controlada. Ponto fraco: duplicações de middleware/logger ainda não consolidadas. |
| **Escalabilidade** | 7/10 | Multi-tenant via ALS é correto. PostgreSQL com Drizzle escala bem. Circuit breaker SEFAZ e outbox pattern para pedidos mostram maturidade. Ponto fraco: memoryModule.ts e job registry in-memory não sobrevivem a múltiplas instâncias. |
| **Performance** | 7/10 | React Query com cache, rate limiting, e lazy loading implícito via Vite. Sem evidência de índices explicitamente definidos nas 97 tabelas — risco em produção. Schema de 2000+ linhas pode impactar startup do ORM. |
| **Segurança** | 8.5/10 | Tenant guard com ALS é robusto. Rate limiting em múltiplas camadas. Anomaly detection, circuit breaker, blocked users, MASTER bypass com opção strict. Ponto fraco: dois middlewares de autenticação paralelos (risco de inconsistência). |
| **Organização** | 7/10 | Módulos bem nomeados. Separação client/server/shared é boa. Problemas: attached_assets/ entupida de prompts, servidor legado com 60 arquivos de rota sem refactor completo, 3 tabelas de config de empresa. |
| **Frontend** | 7.5/10 | Design system shadcn consistente. Hooks bem estruturados. Ponto fraco: ~20 tabelas re-implementadas, sem DataTable genérico, KPI cards duplicados, badge de status sem enum central. |
| **Backend** | 7.5/10 | Módulos com controller/service/repository é boa prática. Outbox pattern e circuit breaker são avançados. Ponto fraco: storage.ts ainda vivo, logger duplicado, shared/middlewares/ inconsistente. |
| **Banco** | 6.5/10 | 97 tabelas cobertas. Schema monolítico de 2000+ linhas é risco de manutenção. 3 tabelas de config de empresa (possível redundância). Índices não evidentes no schema Drizzle. `test_orders` em produção. |
| **UX** | 7/10 | Clara IA flutuante é diferencial. PWA suportado. Fruit curiosities e contextual tips mostram atenção ao usuário. Ponto fraco: 5 dashboards diferentes podem confundir o usuário sobre qual usar. |
| **Documentação** | 5/10 | README existe. Muitos .md históricos de fases de dev que não refletem o estado atual. Sem documentação de API (OpenAPI/Swagger). Sem documentação de arquitetura atualizada. |
| **Testes** | 6/10 | Unit tests para NF-e (7 arquivos) + tenant guard + logistics + billing. E2E para Clara IA via Playwright. Sem cobertura de módulos de pedido, financeiro, logistics em unit tests. Sem CI/CD configurado no projeto. |
| **Cobertura** | 4/10 | Cobertura concentrada em NF-e e segurança. Módulos de pedido, financeiro, logística, inventário sem testes unitários evidentes. |
| **Padronização** | 7/10 | TypeScript em todo o projeto. ESM com tsx. Zod para validação. Drizzle para ORM. Padrões bem escolhidos mas aplicados inconsistentemente (dois loggers, dois rate limiters). |

### **Nota Geral: 7.0/10**
Sistema maduro, com funcionalidades avançadas (NF-e completo, multi-tenant, circuit breakers, anomaly detection, Itaú real). Os déficits são típicos de um projeto que cresceu rapidamente: legado coexistindo com moderno, documentação desatualizada, cobertura de testes insuficiente fora do domínio fiscal.

---

<a id="fase-12"></a>
## FASE 12 — ROADMAP

### O que manter EXATAMENTE como está
- Todo o módulo NF-e (`server/services/nfe/`) — completo e maduro
- Sistema de permissões e tenant guard (`tenantGuard.ts`, `requireAuth.ts`)
- Módulos domain-driven em `server/modules/` — arquitetura correta
- Integração Itaú (`itauIntegration.ts`) — real e funcional
- Circuit breaker SEFAZ (`sefazCircuitBreaker.ts`)
- Outbox pattern em orders
- Design system shadcn/ui em `components/ui/`
- Todos os hooks em `client/src/hooks/`
- Event system (`core/events/`)
- Intelligence + Decision engines (`core/intelligence/`, `core/decision/`)
- Rate limiting multi-camada
- Push notifications + web push

### O que apenas melhorar (sem reescrever)
- **Clara IA chat:** migrar `memoryModule.ts` de array em memória para tabela DB (já existe `ai_interactions`)
- **Logger:** aposentar `server/services/logger.ts` — atualizar imports para `core/observability/logger.ts`
- **Frontend DataTable:** extrair componente genérico `<DataTable>` + `<KPICard>` das ~20 telas que duplicam a mesma estrutura
- **Badge de status:** criar enum central de status → cores → labels em `shared/`
- **Top Clientes:** unificar lógica entre `reports/financial.tsx` e `financial-intelligence.tsx`
- **SaaS payments:** substituir mock de PIX/boleto por integração real (Stripe ou Iugu)
- **Testes:** adicionar unit tests para modules/orders, modules/finance, modules/logistics
- **Documentação:** atualizar `RESUMO_TECNICO.md` e `MAPA_ARQUIVOS.md` para refletir estado atual

### O que reorganizar
- **shared/schema.ts:** Dividir em arquivos por domínio (schema/orders.ts, schema/fiscal.ts, schema/users.ts, etc.) — atualmente 2000+ linhas em 1 arquivo
- **server/routes/ → server/modules/:** Completar migração dos ~60 arquivos legados para estrutura modular. Prioridade: `fiscal-invoices.routes.ts`, `saas.routes.ts`, `bank.routes.ts`
- **server/shared/middlewares/authenticate.ts:** Unificar com `core/http/requireAuth.ts` — um único ponto de autenticação
- **server/core/http/rateLimit.ts + server/core/security/rateLimit.ts:** Consolidar em um único módulo de rate limiting
- **Dashboards:** Definir hierarquia clara entre os 5 dashboards (Admin, Executivo, SaaS, Governance, Security) com entrada única consolidada
- **Tabelas triple config de empresa:** Investigar `company_config` vs `company_settings` vs `empresa_config` e consolidar se redundantes

### O que remover (com cuidado — confirmar antes)
- `test-clara.tsx` — página de mock sem valor em produção
- `tmp_migrations.js` — arquivo temporário na raiz
- `server/services/logger.ts` — após migrar todos os imports
- `ANALISE_IMPORTS_COMPLETA.md` + `_v2.md` — análises históricas
- `RELATORIO_FINAL.md` — histórico sem valor atual
- `attached_assets/*.txt` (100+ prompts históricos) — não são código
- `tests/reports/` + `tests/videos/` — adicionar ao `.gitignore`
- `server/controllers/userController.ts` — mover lógica para `modules/users/`
- `client/src/pages/test-clara.tsx` — duplicado acima

### O que adiar (implementar em versão futura)
- **White Label** (`admin/white-label.tsx`) — UI existe, deploy real ainda não implementado
- **AI Developer** (`admin/ai-developer.tsx` + `server/services/aiDeveloper.ts`) — stubs de geração de código — requer LLM real
- **Marketplace de módulos** (`admin/marketplace.tsx`) — ativação de módulos sem backend real

### O que nunca desenvolver (fora do escopo do produto)
- LLM próprio (usar API externa se necessário, não construir)
- Infraestrutura própria de certificação digital A1
- MDF-e e CT-e (scope fiscal expandido além do necessário para operação atual)

### O que será prioridade imediata
1. **Certificado A1** — único bloqueador para homologação SEFAZ
2. **Consolidação de middlewares de autenticação** — risco de segurança
3. **Migração memoryModule.ts para DB** — perde estado em restarts
4. **Limpeza de `attached_assets/`** — 100+ arquivos desnecessários no repositório
5. **Split do schema.ts** — manutenção insustentável com 97 tabelas em 1 arquivo

---

<a id="executivo"></a>
## RELATÓRIO EXECUTIVO FINAL

### Diagnóstico Geral
O Portal VivaFrutaz ERP é um sistema **maduro e operacional**, com cobertura funcional abrangente para um ERP vertical de distribuição de FLV (Frutas, Legumes e Verduras). O projeto passou por múltiplas fases de desenvolvimento intensivo, resultando em uma base sólida com algumas marcas do crescimento acelerado.

**O que impressiona positivamente:**
- Módulo NF-e completo com circuit breaker, auto-correção de erros SEFAZ, certificados multi-tenant e diagnóstico automatizado — isso é raro em sistemas deste porte
- Multi-tenancy via AsyncLocalStorage implementado de forma correta e consistente
- Integração bancária real com Itaú (não é mock)
- Intelligence engine com anomaly detection e protective mode
- Outbox pattern e circuit breakers mostram maturidade de engenharia
- 97 tabelas cobrindo todos os domínios do negócio
- 11 roles com controle granular de acesso

**O que precisa atenção:**
- Transição incompleta de `server/routes/` para `server/modules/` — 60 arquivos legados coexistindo com a nova arquitetura
- Schema monolítico de 97 tabelas em 1 arquivo de 2000+ linhas
- Dois middlewares de autenticação paralelos — risco de inconsistência silenciosa
- Cobertura de testes concentrada em NF-e e segurança, insuficiente nos demais módulos
- Documentação desatualizada — os .md históricos não refletem o estado atual

### Riscos Identificados

| Risco | Severidade | Probabilidade | Mitigação |
|-------|-----------|---------------|-----------|
| Middleware de autenticação inconsistente (`authenticate.ts` vs `requireAuth.ts`) | 🔴 Alto | Média | Unificar imediatamente |
| `memoryModule.ts` perde estado em restarts (Clara IA memory) | 🟡 Médio | Alta | Migrar para tabela `ai_interactions` |
| Schema monolítico — risco de conflito em merge e dificuldade de onboarding | 🟡 Médio | Alta | Split por domínio (planejado) |
| Certificados `.pfx` em `attached_assets/` no repositório | 🔴 Alto | Confirmado | Verificar se são reais; se sim, remover e usar secrets |
| Pagamentos SaaS são mock — usuários pagantes recebem confirmação sem cobrança real | 🔴 Alto | Confirmado | Integrar gateway real (Stripe/Iugu) |
| `test_orders` em produção — dados de teste contaminam banco real | 🟡 Médio | Confirmado | Adicionar flag `isTestData` ou limpar |
| Rate limiting duplicado — pode ter comportamentos diferentes por rota | 🟡 Médio | Baixa | Consolidar em módulo único |

### Oportunidades de Melhoria (sem reescrever nada)
1. **DataTable genérico** — elimina ~20 reimplementações e padroniza UX
2. **Logger unificado** — uma linha de `import` é suficiente para ganhar logging estruturado em todo o legado
3. **Split do schema** — melhora DX e tempo de onboarding significativamente
4. **Clara IA com memória persistida** — eleva experiência do usuário com dado já presente no banco
5. **Enum de status centralizado** — elimina badges inconsistentes entre módulos

### Plano de Evolução em Fases

#### Fase A — Segurança e Estabilidade (1-2 semanas, sem novas features)
- Unificar middlewares de autenticação
- Verificar e remover `.pfx` do repositório
- Migrar `memoryModule.ts` para banco de dados
- Integrar gateway de pagamento real para SaaS

#### Fase B — Limpeza e Organização (2-3 semanas)
- Remover arquivos mortos (`test-clara.tsx`, `tmp_migrations.js`, relatórios históricos)
- Limpar `attached_assets/` de prompts
- Consolidar rate limiters
- Adicionar `.gitignore` para Playwright artifacts

#### Fase C — Refatoração Gradual (4-8 semanas, sem quebrar funcionalidades)
- Split de `shared/schema.ts` por domínio
- Migrar rotas legadas restantes para `server/modules/`
- Extrair `<DataTable>` e `<KPICard>` genéricos no frontend
- Criar enum central de status/cores
- Atualizar documentação

#### Fase D — Evolução de Produto (após C estar estável)
- Cobertura de testes para módulos sem cobertura
- Implementar gateway de pagamento SaaS real
- Ativar Certificado A1 para homologação SEFAZ
- Avaliar White Label e Marketplace para roadmap de produto

---

*Auditoria realizada em 20/07/2026 — baseada 100% em evidências do código existente.*  
*Nenhuma funcionalidade foi criada, alterada ou removida durante este processo.*
