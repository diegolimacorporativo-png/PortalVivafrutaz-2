# MT-3D — Inventário de Acessos Cross-Tenant

**Data:** 2026-05-08  
**Definição:** Qualquer acesso a dados de múltiplos tenants em uma única requisição, seja intencional (admin BI) ou via marker de auditoria.

---

## 1. Call Sites de `crossTenant()`

A função `crossTenant()` (definida em `server/core/tenant/scope.ts:136`) é um marker de auditoria — registra que o código está operando fora do escopo de um único tenant.

| # | Arquivo | Linha | Contexto |
|---|---|---|---|
| 1 | `server/routes/assistant.routes.ts` | 71 | Clara AI — análise de dados cross-tenant para treinamento |
| 2 | `server/routes/contracts-alerts.routes.ts` | 13 | Alertas de contratos — visão cross-tenant para gestores |
| 3 | `server/routes/executive-dashboard.routes.ts` | 22 | Dashboard executivo — KPIs de todas as empresas |
| 4 | `server/routes/order-cleanup.routes.ts` | 18 | Limpeza de pedidos — operação administrativa cross-tenant |
| 5 | `server/routes/order-cleanup.routes.ts` | 32 | Limpeza de pedidos — segunda operação |
| 6 | `server/routes/routes.ts` | 1057 | Admin — operação cross-tenant #1 |
| 7 | `server/routes/routes.ts` | 1062 | Admin — operação cross-tenant #2 |
| 8 | `server/routes/routes.ts` | 1591 | cron_alert_logs — leitura de logs de sistema |
| 9 | `server/routes/routes.ts` | 1628 | cron_alert_logs — leitura de log individual |

**Total:** 9 call sites

---

## 2. Acessos Cross-Tenant Intencionais SEM crossTenant()

Rotas que acessam dados de múltiplos tenants mas não usam o marker (acesso intencional documentado, gate de role suficiente):

| Rota | Arquivo | Justificativa | Gate |
|---|---|---|---|
| `GET /api/admin/audit` | `audit.routes.ts` | Auditoria do sistema inteiro | requireRole([MASTER,ADMIN,DEVELOPER,DIRECTOR]) + logSecurityEvent(CROSS_TENANT_READ) |
| `GET /api/admin/intelligence` | `admin-intelligence.routes.ts` | BI operacional global | requireSessionOrCompany + inline role + logSecurityEvent(CROSS_TENANT_READ, intent=BI_ANALYTICS) |
| `GET /api/reports/industrialized` | `reports.routes.ts` | Relatório cross-tenant por param | requireRole([ADMIN,DIRECTOR]) |
| `GET /api/admin/health` | `health.routes.ts` | Health check de sistema | requireRole([MASTER,ADMIN,DEVELOPER,DIRECTOR]) |
| `GET /api/saas/*` | `saas.routes.ts` | Gestão de assinaturas | inline role (MASTER/ADMIN/GESTOR_CONTRATOS) |
| `GET /api/users` | `users.routes.ts` | Lista global de usuários | requireRole([MASTER,ADMIN,DEVELOPER,DIRECTOR]) |
| Jobs background | `faturamento.cron.ts`, `auto-dispatch`, `outbox.worker` | Processamento cross-tenant com runWithTenant por item | SERVICE role / sem requisição HTTP |

---

## 3. Acessos de Sistema (Sem Tenant) — Tabelas Globais

Tabelas que não têm coluna de tenant por design — acesso legítimo para qualquer admin:

| Tabela | Lida em | Gate |
|---|---|---|
| `system_alerts` | `alert.routes.ts` | requireRole([MASTER,ADMIN,DEVELOPER,DIRECTOR]) |
| `system_policies` | `policy.routes.ts` | requireRole([MASTER,ADMIN,DEVELOPER,DIRECTOR]) |
| `audit_logs` | `audit.routes.ts` | requireRole([MASTER,ADMIN,DEVELOPER,DIRECTOR]) |
| `cron_alert_logs` | `routes.ts:1591,1628` | requireRole([MASTER,ADMIN,DIRECTOR]) + crossTenant() |
| `workflow_events` | `orders.outbox.worker.ts` | Processo interno (não HTTP) |
| `system_versions` | `system-versions.routes.ts` | inline role (MASTER/ADMIN/DEVELOPER/DIRECTOR) |

---

## 4. Tabelas Sem Coluna Tenant Direta (Ownership Inferida)

| Tabela | Coluna Owner | Estratégia de Isolamento |
|---|---|---|
| `nfe_emissoes` | Nenhuma | Via `orders.company_id` (subquery ou validateOrderTenant) |
| `workflow_events` | `payload.companyId` | Inserido com companyId do pedido; processado com context sintético |
| `nfe_training_logs` | N/A | Sistema de treinamento — sem dados de negócio por tenant |

---

## 5. Gaps de crossTenant() Marker (Aceitáveis)

Rotas que poderiam ter crossTenant() mas não têm — avaliadas como aceitáveis:

| Rota | Motivo de Ausência | Avaliação |
|---|---|---|
| `audit.routes.ts` | Usa logSecurityEvent(CROSS_TENANT_READ) como alternativa | ACEITÁVEL |
| `admin-intelligence.routes.ts` | logSecurityEvent(CROSS_TENANT_READ, intent=BI_ANALYTICS) | ACEITÁVEL |
| `reports.routes.ts` | ADMIN/DIRECTOR intencional — sem marker mas gateado | ACEITÁVEL |

**Recomendação futura:** Unificar usando crossTenant() + logSecurityEvent em todas as rotas cross-tenant para consistência. Fora do escopo MT-3D.
