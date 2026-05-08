# MT-3D — Inventário Completo de Rotas

**Data:** 2026-05-08  
**Total de arquivos de rota:** 59 (em `server/routes/` + `server/modules/*/`)

---

## Legenda

- **Auth Gate:** middleware de autenticação na rota/router
- **Role Gate:** controle de autorização por role
- **Tenant Gate:** isolamento de tenant (tenantContext, requireTenant, etc.)
- **Cross-Tenant:** acesso intencional a dados multi-tenant (gateado por MASTER/ADMIN)

---

## 1. Rotas em `server/routes/`

| Arquivo | Auth Gate | Role Gate | Tenant Gate | Observações |
|---|---|---|---|---|
| `about-us.routes.ts` | — | — | — | Conteúdo público |
| `admin-intelligence.routes.ts` | requireSessionOrCompany | inline (MASTER/ADMIN/DIRECTOR/OPERATIONS_MANAGER/PURCHASE_MANAGER/LOGISTICS) | logSecurityEvent CAMADA-2 | Cross-tenant BI intencional, logado |
| `alert.routes.ts` | requireAuthCore | requireRole([MASTER,ADMIN,DEVELOPER,DIRECTOR]) | — | system_alerts, sem tenant |
| `announcements.routes.ts` | varies | varies | — | Anúncios de sistema |
| `assistant.routes.ts` | requireAuthCore | — | tenantContext + crossTenant() | Clara AI — MT-3B |
| `audit.routes.ts` | requireAuthCore | requireRole([MASTER,ADMIN,DEVELOPER,DIRECTOR]) | logSecurityEvent CROSS_TENANT_READ | Auditoria cross-tenant intencional |
| `backup.routes.ts` | requireAuthCore | inline (MASTER/ADMIN) | — | Backup de sistema |
| `bank.routes.ts` | requireAuthCore | requireRole([ADMIN,FINANCE]) | tenantContext + requireTenant | Full isolation |
| `certificates.routes.ts` | requireAuthCore | varies | — | Certificados |
| `clara.routes.ts` | requireAuthCore | varies | varies | Clara AI legacy |
| `client-contract-scope.routes.ts` | requireAuthCore | varies | varies | Contratos de cliente |
| `client-intelligence.routes.ts` | requireAuthCore | varies | varies | BI de cliente |
| `company-validate.routes.ts` | requireAuthCore | varies | — | Validação de empresa |
| `contracts-alerts.routes.ts` | requireAuthCore | requireRole([MASTER,ADMIN,DIRECTOR,GESTOR_CONTRATOS]) | crossTenant() marker | MT-3C fix |
| `email.routes.ts` | session.userId check | inline (MASTER/ADMIN/MANAGER) | — | Manual auth — equivalente funcional |
| `email-scheduler.ts` | session.userId check | inline | — | Scheduler de email |
| `empresa-config.routes.ts` | requireAuthCore | varies | — | Config de empresa |
| `event.routes.ts` | requireAuthCore | varies | — | Eventos de sistema |
| `executive-dashboard.routes.ts` | requireAuthCore | requireRole([MASTER,ADMIN,DIRECTOR]) | crossTenant() marker | MT-3C fix |
| `fiscal-invoices.routes.ts` | requireAuth | requireRole | tenantContext + requireTenant | Full isolation |
| `geocode.routes.ts` | requireAuthCore | — | — | Geocodificação pública |
| `governance.routes.ts` | requireAuthCore | requireRole | — | Governança |
| `health.routes.ts` | `/health`: público; `/api/admin/health`: requireAuthCore + requireRole | [MASTER,ADMIN,DEVELOPER,DIRECTOR] | — | Liveness probe público por design |
| `incidents.routes.ts` | requireAuthCore | varies | — | Incidentes |
| `logistics.routes.ts` | Delegado a `logistics.routes.ts` do módulo | vide módulo | vide módulo | |
| `logs.routes.ts` | requireAuthCore | requireRole | — | Logs de sistema |
| `marketplace.routes.ts` | requireAuthCore | inline (MASTER/ADMIN/DEVELOPER/DIRECTOR) | — | Sistema-nível |
| `master.routes.ts` | requireAuthCore | requireRole([MASTER]) | — | Master admin |
| `order-cleanup.routes.ts` | requireAuthCore | requireRole | crossTenant() markers (2x) | MT-3B fix |
| `order-exceptions.routes.ts` | requireAuthCore | varies | varies | Exceções de pedido |
| `order-windows.routes.ts` | requireAuthCore | varies | varies | Janelas de entrega |
| `password-reset-requests.routes.ts` | varies | — | — | Pré-auth flow |
| `policy.routes.ts` | requireAuthCore | requireRole([MASTER,ADMIN,DEVELOPER,DIRECTOR]) | — | system_policies, sem tenant |
| `price-groups.routes.ts` | requireAuthCore | requireRole | — | Grupos de preço |
| `product-prices.routes.ts` | requireAuthCore | requireRole | — | Preços de produto |
| `purchase-planning.routes.ts` | requireAuth | requireRole | tenantContext + requireTenant | Full isolation |
| `push.routes.ts` | requireAuthCore | varies | — | Push notifications |
| `quotations.routes.ts` | requireAuthCore | inline (MASTER/ADMIN/DIRECTOR/DEVELOPER/OPERATIONS_MANAGER/LOGISTICS) | — | Cotações — inline role check |
| `reports.routes.ts` | requireAuthCore | requireRole([ADMIN,DIRECTOR]) | companyId param | Cross-tenant via param — ADMIN intencional |
| `saas.routes.ts` | requireAuthCore | inline (MASTER/ADMIN/GESTOR_CONTRATOS) per-handler | — | SaaS billing — full inline role coverage |
| `sanitary.routes.ts` | requireAuthCore | inline (ADMIN/DIRECTOR/DEVELOPER/NUTRICIONISTA/OPERATIONS_MANAGER) | — | Sanitário — inline role check |
| `scope-simulations.routes.ts` | requireAuthCore | inline SCOPE_ROLES | — | Simulações de escopo |
| `search.routes.ts` | requireAuthCore | — | varies | Busca |
| `security.routes.ts` | requireAuthCore | inline (MASTER/ADMIN/DEVELOPER/DIRECTOR) | — | Desbloqueio de contas |
| `security-alerts.routes.ts` | requireAuth | requireRole([MASTER,ADMIN,DEVELOPER,DIRECTOR]) | — | Alertas de segurança |
| `security-analysis.routes.ts` | requireAuth | requireRole([MASTER,ADMIN]) | — | Análise de segurança |
| `security-events.routes.ts` | requireAuth | requireRole([MASTER,ADMIN]) | — | Eventos de segurança |
| `security-overview.routes.ts` | requireAuth | requireRole([MASTER,ADMIN]) | — | Overview de segurança |
| `security-risk.routes.ts` | requireAuth | requireRole([MASTER,ADMIN]) | — | Risco de segurança |
| `settings.routes.ts` | requireAuthCore | requireRole([MASTER]) para settings globais; sem role para company-config | — | Settings de empresa sem requireRole — LOW risk |
| `smtp-config.routes.ts` | requireAuthCore | varies | — | Configuração SMTP |
| `smtp-test.routes.ts` | requireAuthCore | varies | — | Teste SMTP |
| `special-order-requests.routes.ts` | requireAuthCore | varies | varies | Pedidos especiais |
| `system-state.routes.ts` | requireAuthCore | requireRole([MASTER,ADMIN,DEVELOPER,DIRECTOR]) | — | Estado do sistema |
| `system-sync.routes.ts` | requireAuthCore | varies | — | Sync de sistema |
| `system-versions.routes.ts` | requireAuthCore | inline (MASTER/ADMIN/DEVELOPER/DIRECTOR) per-handler | — | Versões do sistema |
| `tasks.routes.ts` | requireAuthCore | varies | varies | Tarefas |
| `waste-control.routes.ts` | requireAuth | requireRole | tenantContext + requireTenant | Full isolation |
| `routes.ts` | varies por endpoint | varies por endpoint | tenantContext seletivo | Arquivo principal — ~3778 linhas |

---

## 2. Rotas em `server/modules/`

| Módulo | Router | Auth | Tenant | Status |
|---|---|---|---|---|
| `auth/auth.routes.ts` | Express router | Pré-auth (login/logout/register) | N/A | ✅ |
| `orders/orders.routes.ts` | Express router | requireAuth router-wide | tenantContext + withTenantScope router-wide | ✅ FULL |
| `finance/finance.routes.ts` | Express router | requireAuth router-wide | withTenantScope router-wide | ✅ FULL |
| `users/users.routes.ts` | Express router | requireAuth por rota | requireRole por rota | ✅ FULL |
| `logistics/logistics.routes.ts` | Express router | Per-handler (4 estratégias) | tenantContext condicional | ✅ ADEQUATE |
| `billing/` | varies | varies | varies | Interna |
| `inventory/` | varies | varies | varies | Interna |

---

## 3. Rotas Sem tenantContext (Intencionais)

Rotas que acessam dados cross-tenant com justificativa documentada:

| Rota | Justificativa | Gate |
|---|---|---|
| `/api/admin/audit` | Auditoria do sistema inteiro | requireRole([MASTER,ADMIN,DEVELOPER,DIRECTOR]) |
| `/api/admin/intelligence` | BI operacional global | requireSessionOrCompany + inline role + logSecurityEvent |
| `/api/executive-dashboard` | Dashboard executivo cross-tenant | requireRole([MASTER,ADMIN,DIRECTOR]) + crossTenant() |
| `/api/admin/alerts` | Alertas de sistema | requireRole([MASTER,ADMIN,DEVELOPER,DIRECTOR]) |
| `/api/admin/policies` | Políticas de sistema | requireRole([MASTER,ADMIN,DEVELOPER,DIRECTOR]) |
| `/api/master/modulos-sistema` | Catálogo de módulos | requireRole([MASTER,ADMIN,...]) |
| `/api/saas/*` | Gerenciamento de assinaturas | inline role (MASTER/ADMIN/GESTOR_CONTRATOS) |
| `/api/reports/*` | Relatórios com companyId param | requireRole([ADMIN,DIRECTOR]) |
| `/api/contracts/alerts` | Alertas de contratos | requireRole([MASTER,ADMIN,DIRECTOR,GESTOR_CONTRATOS]) + crossTenant() |
