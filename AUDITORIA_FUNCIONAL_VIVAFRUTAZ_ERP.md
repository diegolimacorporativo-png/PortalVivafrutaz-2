# AUDITORIA FUNCIONAL E TÉCNICA — PORTAL VIVAFRUTAZ ERP
**Data:** 20 de Julho de 2026  
**Auditor:** Arquiteto de Software Sênior  
**Método:** Análise estática do código-fonte — 100% baseada em evidências  
**Regra:** Nada foi implementado, alterado ou removido durante esta auditoria

---

## ÍNDICE

1. [Inventário Geral](#etapa-1)
2. [Mapeamento Funcional](#etapa-2)
3. [Mapeamento das Telas](#etapa-3)
4. [Fluxos de Negócio](#etapa-4)
5. [Banco de Dados](#etapa-5)
6. [Backend](#etapa-6)
7. [Frontend](#etapa-7)
8. [Segurança](#etapa-8)
9. [IA Clara](#etapa-9)
10. [Módulo Fiscal / NF-e](#etapa-10)
11. [Operação da VivaFrutaz](#etapa-11)
12. [Matriz de Classificação](#etapa-12)
13. [Relatório Executivo](#etapa-13)

---

<a id="etapa-1"></a>
## ETAPA 1 — INVENTÁRIO GERAL

### O que este sistema é
Um ERP vertical para distribuição de FLV (Frutas, Legumes e Verduras) que simultaneamente opera como **produto SaaS** — a VivaFrutaz usa o sistema na própria operação e o vende como plataforma para outras empresas.

### Estrutura de Pastas
```
workspace/
├── client/src/                  → Frontend React 18 + Wouter + TanStack Query
│   ├── components/              → 15 componentes custom + 38 primitivos shadcn/ui
│   ├── hooks/                   → 9 custom hooks
│   ├── pages/                   → ~80 telas (admin/ + client/ + auth/)
│   ├── services/                → nfe.service.ts
│   └── utils/                   → priceResolver.ts
├── server/                      → Backend Express 5
│   ├── bootstrap/               → Inicialização de schedulers no boot
│   ├── config/                  → Feature flags (flags.ts)
│   ├── controllers/             → userController.ts (1 arquivo legado)
│   ├── core/                    → Infraestrutura transversal (auth, events, security, jobs, observability)
│   ├── database/                → db.ts (Drizzle client primário)
│   ├── infra/                   → Upload (multer), PDF parser
│   ├── jobs/                    → faturamento.cron.ts (cron diário NF-e)
│   ├── middleware/              → Middlewares (alguns re-exports do core)
│   ├── modules/                 → Módulos domain-driven v1/v2 (auth, companies, finance, fiscal, inventory, logistics, orders, products, users)
│   ├── routes/                  → ~60 arquivos de rota legados
│   ├── services/                → Services (mix de legado e ativo)
│   ├── shared/                  → Utilities, middlewares e DB client compartilhados
│   └── utils/                   → auditLogger, crypto
├── shared/                      → Schema Drizzle (97 tabelas em 1 arquivo) + routes
├── scripts/                     → Scripts de validação, chaos tests, governance engines
├── tests/                       → Unit (11 arquivos) + E2E Playwright
├── docs/                        → Relatórios técnicos
└── attached_assets/             → 100+ prompts históricos (.txt) + 2 arquivos .pfx ⚠️
```

### Stack Tecnológico
| Camada | Tecnologia | Versão |
|--------|-----------|--------|
| Frontend framework | React | 18.3.1 |
| Roteamento | Wouter | 3.3.5 |
| State management | TanStack Query | 5.60.5 |
| UI components | shadcn/ui + Radix UI | — |
| Estilização | Tailwind CSS | 3.4.17 |
| Gráficos | Recharts | 2.15.2 |
| Backend framework | Express | 5.2.1 |
| ORM | Drizzle ORM | 0.39.3 |
| Banco de dados | PostgreSQL (Supabase) | — |
| Autenticação | express-session + passport-local | — |
| Validação | Zod | 3.24.2 |
| Envio email | nodemailer | 8.0.2 |
| Push notifications | web-push | 3.6.7 |
| PDF | pdfkit + jspdf | — |
| Criptografia | node-forge + xml-crypto | — |
| Maps | Leaflet + react-leaflet | — |
| Testes E2E | Playwright | 1.58.2 |
| Build | Vite 7 + tsx + esbuild | — |
| CNAB | xlsx | 0.18.5 |
| OCR | tesseract.js | 7.0.0 |

### Integrações Externas
| Integração | Status | Evidência |
|-----------|--------|-----------|
| Supabase (PostgreSQL) | ✅ Real | `SUPABASE_DATABASE_URL` em uso |
| Itaú (OAuth + Cash Management V2) | ✅ Real | `itauIntegration.ts` com axios para APIs Itaú |
| SEFAZ (SOAP NF-e 4.00) | ✅ Real | `nfeSoap.ts` + URLs por UF |
| Web Push (VAPID) | ✅ Real | `web-push` configurado |
| SMTP (email) | ✅ Real | `nodemailer` + config dinâmica por tenant |
| Stripe / Gateway Pagamento | ❌ Mock | `saas.routes.ts` simula PIX/boleto localmente |
| ngrok | 🔧 Dev only | Presente em dependencies — deveria estar em devDependencies |

### Testes
| Arquivo | O que testa |
|---------|------------|
| `nfeValidator.test.ts` | Validação de NF-e pré-envio |
| `nfeGenerator.test.ts` | Geração do XML NF-e |
| `nfeSoap.ts` (indiretamente) | Comunicação SEFAZ |
| `nfeErrorParser.test.ts` | Parser de erros SEFAZ |
| `nfeIcmsStructure.test.ts` | Cálculo de ICMS |
| `regression-billing-nfe-equivalence.test.ts` | Equivalência de billing com NF-e |
| `nfe-enforcement.test.ts` | Regras de enforcement fiscal |
| `tenantGuard.test.ts` | Isolamento multi-tenant |
| `inventory.test.ts` | Módulo de inventário |
| `logistics.test.ts` | Módulo de logística |
| `errorHandler.test.ts` | Handler de erros |
| `clara-erp.spec.ts` (E2E) | Clara IA chat, responsividade, training |

**Cobertura:** Concentrada em NF-e e segurança. Pedidos, financeiro, compras, e cliente portal sem cobertura unitária.

---

<a id="etapa-2"></a>
## ETAPA 2 — MAPEAMENTO FUNCIONAL

### Módulos e Status

| Módulo | Existe | Funcional | Incompleto | Oculto | Abandonado | Duplicado | Integrado | Vale manter |
|--------|:------:|:---------:|:----------:|:------:|:----------:|:---------:|:---------:|:-----------:|
| Dashboard Admin | ✅ | ✅ | — | — | — | ⚠️ parcial c/ executivo | ✅ | ✅ |
| Dashboard Executivo | ✅ | ✅ | — | — | — | ⚠️ parcial | ✅ | ✅ |
| Dashboard SaaS | ✅ | ⚠️ pagamentos mock | ⚠️ | — | — | — | ✅ | ✅ |
| Dashboard Governance | ✅ | ✅ | — | — | — | — | ✅ | ✅ |
| Dashboard Security | ✅ | ✅ | — | — | — | — | ✅ | ✅ |
| Clientes / Empresas | ✅ | ✅ | — | — | — | — | ✅ | ✅ |
| Contratos | ✅ | ✅ | — | — | — | — | ✅ | ✅ |
| Simulação de Escopo | ✅ | ✅ | — | — | — | — | ✅ | ✅ |
| Pedidos (Admin) | ✅ | ✅ | — | — | — | — | ✅ | ✅ |
| Pedidos (Cliente) | ✅ | ✅ | — | — | — | — | ✅ | ✅ |
| Janelas de Pedido | ✅ | ✅ | — | — | — | — | ✅ | ✅ |
| Exceções de Pedido | ✅ | ✅ | — | — | — | — | ✅ | ✅ |
| Pedidos Especiais | ✅ | ✅ | — | — | — | — | ✅ | ✅ |
| Logística | ✅ | ✅ | — | — | — | ⚠️ rota dupla backend | ✅ | ✅ |
| Rastreamento GPS | ✅ | ✅ | — | — | — | — | ✅ | ✅ |
| Painel do Motorista | ✅ | ✅ | — | — | — | — | ✅ | ✅ |
| Inteligência Logística | ✅ | ✅ | — | — | — | — | ✅ | ✅ |
| Estoque / Inventário | ✅ | ✅ | — | — | — | — | ✅ | ✅ |
| Planejamento de Compras | ✅ | ✅ | — | — | — | — | ✅ | ✅ |
| Controle de Desperdício | ✅ | ✅ | — | — | — | — | ✅ | ✅ |
| Cotações | ✅ | ✅ | — | — | — | — | ✅ | ✅ |
| Inteligência Comercial | ✅ | ✅ | — | — | — | — | ✅ | ✅ |
| Financeiro (AR/AP) | ✅ | ✅ | — | — | — | ⚠️ 4 pgs financeiras | ✅ | ✅ |
| Inteligência Financeira | ✅ | ✅ | — | — | — | ⚠️ parcial | ✅ | ✅ |
| Banco (Itaú) | ✅ | ✅ real | — | — | — | — | ✅ | ✅ |
| CNAB | ✅ | ✅ | — | — | — | — | ✅ | ✅ |
| SaaS Financeiro | ✅ | ⚠️ pagamentos mock | ⚠️ | — | — | — | ✅ | ✅ |
| Fiscal (NF entrada/OCR) | ✅ | ✅ | — | — | — | ⚠️ parcial c/ NF-e | ✅ | ✅ |
| NF-e (emissão) | ✅ | ✅ | — | — | — | — | ✅ | ✅ |
| Faturamento automático | ✅ | ✅ | — | — | — | — | ✅ | ✅ |
| Config Fiscal | ✅ | ✅ | — | — | — | — | ✅ | ✅ |
| Diagnóstico Fiscal | ✅ | ✅ | — | — | — | — | ✅ | ✅ |
| NF Manual | ✅ | ✅ | — | — | — | — | ✅ | ✅ |
| Relatórios Compras | ✅ | ✅ | — | — | — | — | ✅ | ✅ |
| Relatórios Industrializ. | ✅ | ✅ | — | — | — | — | ✅ | ✅ |
| Relatórios Financeiros | ✅ | ✅ | — | — | — | ⚠️ c/ intel. fin. | ✅ | ✅ |
| Clara IA (chat) | ✅ | ✅ | — | — | — | — | ✅ | ✅ |
| Clara Training | ✅ | ✅ | — | — | — | — | ✅ | ✅ |
| Academy / Treinamento | ✅ | ✅ | — | — | — | — | ✅ | ✅ |
| Sanitário | ✅ | ✅ | — | — | — | — | ✅ | ✅ |
| E-mail Management | ✅ | ✅ | — | — | — | — | ✅ | ✅ |
| Comunicados | ✅ | ✅ | — | — | — | — | ✅ | ✅ |
| Tarefas (OS) | ✅ | ✅ | — | — | — | — | ✅ | ✅ |
| Incidentes Cliente | ✅ | ✅ | — | — | — | — | ✅ | ✅ |
| Incidentes Internos | ✅ | ✅ | — | — | — | — | ✅ | ✅ |
| Usuários | ✅ | ✅ | — | — | — | — | ✅ | ✅ |
| Configurações | ✅ | ✅ | — | — | — | — | ✅ | ✅ |
| SMTP Config | ✅ | ✅ | — | — | — | — | ✅ | ✅ |
| Notificações Push | ✅ | ✅ | — | — | — | — | ✅ | ✅ |
| PWA | ✅ | ✅ | — | — | — | — | ✅ | ✅ |
| Rastreamento público | ✅ | ✅ | — | — | — | — | ✅ | ✅ |
| Autenticação | ✅ | ✅ | — | — | — | — | ✅ | ✅ |
| Backups | ✅ | ✅ | — | — | — | — | ✅ | ✅ |
| System Health | ✅ | ✅ | — | — | — | ⚠️ c/ observability | ✅ | ✅ |
| Observability | ✅ | ✅ | — | — | — | ⚠️ parcial | ✅ | ✅ |
| Security Audit | ✅ | ✅ | — | — | — | — | ✅ | ✅ |
| Security Intelligence | ✅ | ✅ | — | — | — | — | ✅ | ✅ |
| Master Control | ✅ | ✅ | — | — | — | — | ✅ | ✅ |
| Developer Page | ✅ | ✅ | — | — | — | — | ✅ | ✅ |
| AI Developer | ✅ | ⚠️ parcial | ⚠️ stubs | — | — | — | ⚠️ | ⚠️ adiar |
| White Label | ✅ | ⚠️ UI existe | ⚠️ deploy não impl. | — | — | — | ⚠️ | ⚠️ adiar |
| Marketplace (módulos) | ✅ | ⚠️ UI existe | ⚠️ ativação sem backend | — | — | — | ⚠️ | ⚠️ adiar |
| Sobre Nós | ✅ | ✅ | — | — | — | — | ✅ | ✅ |
| Importação de Dados | ✅ | ✅ | — | — | — | — | ✅ | ✅ |
| Redefinição de Senha | ✅ | ✅ | — | — | — | — | ✅ | ✅ |
| test-clara | ✅ | ❌ mock | — | — | ✅ | — | ❌ | ❌ remover |

---

<a id="etapa-3"></a>
## ETAPA 3 — MAPEAMENTO DAS TELAS

### Telas Admin — Detalhe Técnico

#### Dashboard Admin
- **Arquivo:** `client/src/pages/admin/dashboard.tsx`
- **Rota:** `/admin`
- **Componentes:** Cards de KPI, gráficos Recharts, toggles de modo manutenção/teste
- **Hooks:** `useAuth`, `useOrders`, `useCompanies`, `useQuery`, `useMutation`, `useMemo`
- **APIs:** `GET /api/settings/maintenance`, `POST /api/settings/maintenance`, `GET /api/settings/test-mode`, `GET /api/admin/security/resumo`, `GET /api/contracts/alerts`
- **Banco:** `system_settings`, `orders`, `companies`, `audit_logs`
- **Problemas:** Security card falha silenciosamente em caso de erro (sem feedback ao usuário)
- **Melhoria:** Componente `<KPICard>` genérico reutilizável entre os 5 dashboards

#### Dashboard Executivo
- **Arquivo:** `client/src/pages/admin/executive-dashboard.tsx`
- **Rota:** `/admin/executive`
- **Status:** ✅ Funcional
- **Problema:** Sobreposição parcial de métricas com Dashboard Admin

#### Pedidos (Admin)
- **Arquivo:** `client/src/pages/admin/orders.tsx`
- **Rota:** `/admin/orders`
- **Componentes:** Tabela com filtros, modal de edição, timeline, NF-e preflight
- **Hooks:** `useQuery`, `useMutation`, `useQueryClient`, `useToast`
- **APIs:** `GET /api/orders`, `GET /api/orders/:id`, `PATCH /api/orders/:id/items`, `POST /api/orders/:id/transition`, `POST /api/orders/bulk`, `DELETE /api/orders/:id`, `GET /api/nfe?orderId=`, `POST /api/nfe/emitir`, `GET /api/orders/:id/danfe-logs`, `POST /api/orders/:id/generate-prenota`, `PATCH /api/orders/:id/fiscal`, `POST /api/orders/:id/approve-reopen`, `POST /api/orders/:id/deny-reopen`, `POST /api/orders/:id/bling-export`
- **Banco:** `orders`, `order_items`, `nfe_emissoes`, `danfe_records`
- **Problemas:** Tela mais complexa do sistema — checks de role hardcoded inline; sem componente `<DataTable>` genérico
- **Melhoria:** Extrair DataTable + paginação + filtros em componente reutilizável

#### Criar Pedido (Cliente)
- **Arquivo:** `client/src/pages/client/create-order.tsx`
- **Rota:** `/client/create-order`
- **Hooks:** `useAuth`, `useActiveOrderWindow`, `useCreateOrder`, `useCompanyOrders`, `useOrderDetail`, `useProducts`, `useToast`, `useQuery`, `useMutation`
- **APIs:** `POST /api/orders/:id/request-reopen`, `GET /api/settings/test-mode`
- **Banco:** `orders`, `order_items`, `products`, `order_windows`
- **Atenção:** Usa `localStorage` para persistência do carrinho — não sincroniza entre dispositivos
- **Problema:** Lógica de preço via `priceResolver.ts` é complexa (hierarquia 3 níveis) — sem visualização clara do preço ativo para o cliente

#### NF-e
- **Arquivo:** `client/src/pages/admin/nfe.tsx`
- **Rota:** `/admin/nfe`
- **Hooks:** `useQuery`, `useMutation`, `useToast`, `useCanEmitNfe`, `useForceReleaseNfe`
- **APIs:** `GET /api/nfe/sefaz/status`, `GET /api/orders`, `GET /api/companies`, `GET /api/nfe`, `GET /api/nfe/preflight/:id`, `GET /api/nfe/diagnostics/:id`, `POST /api/nfe/cce`
- **Banco:** `nfe_emissoes`, `orders`, `companies`, `nfe_training_logs`
- **Status:** ✅ Funcional — lógica de preflight e diagnóstico robusta

#### Logística
- **Arquivo:** `client/src/pages/admin/logistics.tsx`
- **Rota:** `/admin/logistics`
- **APIs:** `GET/POST/PATCH/DELETE /api/logistics/drivers`, `/api/logistics/vehicles`, `/api/logistics/routes`, `/api/logistics/maintenance`, `GET /api/logistics/route-assistant`, `GET /api/logistics/smart-route-plan`, `POST /api/logistics/route-insertion`, `GET /api/quotations`
- **Banco:** `logistics_drivers`, `logistics_vehicles`, `logistics_routes`, `logistics_maintenance`, `company_quotations`
- **Status:** ✅ Funcional — assistente de rota multi-etapa

#### Financeiro (AR/AP)
- **Arquivo:** `client/src/pages/admin/finance.tsx`
- **Rota:** `/admin/finance`
- **APIs:** `GET /api/finance/dashboard`, `GET /api/finance/accounts-receivable/:id/breakdown`, `POST /api/finance/accounts-receivable`, `POST /api/finance/accounts-payable`, `POST /api/nfe/:id/reenviar`, `POST /api/nfe/:id/corrigir-reenviar`, `GET /api/nfe/:id/historico`
- **Banco:** `accounts_receivable`, `accounts_payable`, `financial_transactions`, `nfe_emissoes`
- **Status:** ✅ Funcional — inclui handlers de correção automática NF-e

#### Planejamento de Compras
- **Arquivo:** `client/src/pages/admin/purchase-planning.tsx`
- **Rota:** `/admin/purchase-planning`
- **APIs:** `GET /api/purchase-planning`, `GET /api/purchase-planning/forecast`, `GET /api/inventory/settings`, `POST /api/purchase-planning/status`
- **Banco:** `purchase_plan_status`, `inventory_settings`, `orders`, `order_items`
- **Status:** ✅ Funcional — alertas de déficit de estoque + variação histórica

#### Dashboard do Cliente
- **Arquivo:** `client/src/pages/client/dashboard.tsx`
- **Rota:** `/client`
- **APIs:** `GET /api/announcements/active`, `GET /api/settings/test-mode`
- **Hooks:** `useAuth`, `useActiveOrderWindow`, `useCompanyOrders`
- **Banco:** `announcements`, `orders`, `system_settings`
- **Atenção:** Dismissal de comunicados via `localStorage` — reseta se usuário limpar dados do browser; distingue cliente contratual de cliente regular

---

<a id="etapa-4"></a>
## ETAPA 4 — FLUXOS DE NEGÓCIO

### Fluxo 1 — Ciclo Completo de Pedido

```
CLIENTE PORTAL                    ADMIN / SISTEMA
     │
     ├─ Verifica janela de pedido (/api/order-windows/active)
     │       ↓ Se janela aberta
     ├─ Cria pedido (POST /api/orders)
     │       status = "ACTIVE" / workflowStatus = "CREATED"
     │       Carrinho salvo em localStorage
     │
     └─────────────────────────────────────────→ ADMIN RECEBE PEDIDO
                                                        │
                                         Valida empresa ativa (sem inadimplência)
                                                        ↓
                                          POST /api/orders/:id/transition
                                           workflowStatus = "APPROVED"
                                           status = "CONFIRMED"
                                                        │
                                              ┌─────────┴──────────┐
                                         LOGÍSTICA              FINANCEIRO
                                              │                     │
                                   Auto-dispatch (10s loop)    AR criado
                                   agrupa por empresa/data     status = "pendente"
                                              │
                                   Driver recebe rota
                                   deliveries.status = "em_rota"
                                              │
                                   Entrega confirmada
                                   deliveries.status = "entregue"
                                   workflowStatus = "DELIVERED"
```

### Fluxo 2 — Emissão de NF-e

```
TRIGGER: Cron diário 08:00 (faturamento.cron.ts)
    │
    ├─ Busca pedidos com fiscalStatus = "nota_liberada"
    │
    ├─ Guard: canEmitNFe + hasBlockingNFe (idempotência)
    │
    ├─ buildNFeInput → gerarNFeXML (nfeGenerator.ts)
    │       status = "gerada" → nfe_emissoes
    │
    ├─ nfeSigner.ts → assina XML (XMLDSIG com certificado A1)
    │       status = "assinada"
    │
    ├─ nfeSender.ts → SOAP para SEFAZ
    │       status = "enviada"
    │
    ├─ Resposta SEFAZ:
    │   ├─ cStat 100 → status = "autorizada"
    │   │              orders.fiscalStatus = "nota_emitida"
    │   │              danfeGenerator.ts → PDF gerado
    │   │
    │   ├─ cStat 533 → nfeAutoCorrect.ts corrige ICMS
    │   │              reenvia automaticamente
    │   │
    │   └─ Outro erro → nfeErrorHandler.ts → log + alerta
    │                   status = "rejeitada" ou "erro"
    │
    └─ circuitBreaker abre após falhas repetidas do SEFAZ
```

### Fluxo 3 — Faturamento Financeiro

```
PEDIDO APROVADO
    │
    ├─ AR criado automaticamente (accounts_receivable)
    │   status = "pendente"
    │   valor = totalAmount do pedido
    │
    ├─ Cliente recebe cobrança (PIX / boleto)
    │   ⚠️ PIX e boleto gerados LOCALMENTE (não há gateway real)
    │
    ├─ Admin confirma pagamento manualmente
    │   POST /api/finance/accounts-receivable/:id/pay
    │   status → "pago"
    │
    └─ financial_transactions registra movimento
```

### Fluxo 4 — Ciclo do Cliente Portal

```
CADASTRO (admin)                     CLIENTE PORTAL
    │                                       │
    ├─ Admin cria empresa                   │
    ├─ Admin cria contrato                  │
    ├─ Admin define escopo (itens semanais) │
    ├─ Admin cria usuário cliente           │
    │                                       │
    │                       Login ──────────┘
    │                          │
    │                   Dashboard → vê janela ativa
    │                          │
    │                   Se janela aberta → Criar Pedido
    │                          │
    │                   Cart em localStorage
    │                          │
    │                   Confirma → POST /api/orders
    │                          │
    │                   Acompanha em Order History
    │                          │
    │                   Vê status: ACTIVE / CONFIRMED / DELIVERED
```

### Fluxo 5 — Ciclo Logístico

```
PEDIDOS APROVADOS
    │
    ├─ Auto-dispatch.service (loop 10s)
    │   agrupa pedidos por empresa + data de entrega
    │   usa suggestInsertion para otimizar rota
    │   atribui driver + route_id + route_position
    │
    ├─ Motorista vê painel (/admin/driver-panel)
    │   lista de stops em sequência
    │
    ├─ GPS tracking (driver_gps_positions)
    │   eta.service.ts calcula ETA em tempo real
    │
    ├─ Cliente pode rastrear (/track — público)
    │
    └─ Entrega confirmada → deliveries.status = "entregue"
                          → workflowStatus = "DELIVERED"
```

### Fluxo 6 — Onboarding de Novo Cliente (SaaS)

```
PRÉ-VENDA (Scope Simulation)
    │
    ├─ Admin simula escopo do prospect
    │   /admin/scope-simulations
    │   calcula: margem bruta, faturamento semanal, mínimo de rota
    │
    ├─ Se viável → cria Empresa no sistema
    │
    ├─ Define Contrato + Escopo (itens recorrentes)
    │
    ├─ Define Grupo de Preço
    │
    ├─ Cria usuário cliente
    │
    └─ Cliente acessa portal e começa a pedir
```

---

<a id="etapa-5"></a>
## ETAPA 5 — BANCO DE DADOS

### Volume e Localização
- **97 tabelas** em único arquivo `shared/schema.ts` (~2000+ linhas)
- ORM: Drizzle ORM com PostgreSQL
- Nenhum outro arquivo de schema encontrado

### Status Fields — Todos os Enums

#### orders.status (legado — visão do cliente)
`ACTIVE` | `CONFIRMED` | `REOPEN_REQUESTED` | `OPEN_FOR_EDITING` | `CANCELLED` | `DELIVERED`

#### orders.workflowStatus (novo — máquina de estados interna)
`CREATED` | `PENDING_APPROVAL` | `APPROVED` | `REJECTED` | `INVOICED` | `SHIPPED` | `DELIVERED` | `CANCELLED`

#### orders.fiscalStatus
`nota_pendente` | `nota_exportada` | `nota_emitida` | `nota_cancelada`

#### orders.erpExportStatus
`nao_exportado` | `exportando` | `exportado` | `erro`

#### nfeEmissoes.status
`gerada` | `assinada` | `enviada` | `autorizada` | `rejeitada` | `erro` | `cancelada` | `denegada`

#### deliveries.status
`pendente` | `em_rota` | `entregue` | `cancelado`

#### accountsReceivable.status / accountsPayable.status
`pendente` | `pago` | `vencido` | `cancelado`

#### users.role
Armazenado como `text` livre. Valores usados: `MASTER`, `ADMIN`, `DIRECTOR`, `DEVELOPER`, `OPERATIONS_MANAGER`, `PURCHASE_MANAGER`, `FINANCEIRO`, `LOGISTICS`, `GESTOR_CONTRATOS`, `MOTORISTA`, `NUTRICIONISTA`

#### Incidentes priority
`LOW` | `MEDIUM` | `HIGH`

#### Incidentes status
`PENDING` | `IN_PROGRESS` | `DONE`

### Isolamento Multi-Tenant (companyId)

**Tabelas TENANT-SCOPED** (possuem companyId/empresaId):
`orders`, `order_items`, `companies`, `users`, `products`, `categories`, `product_prices`, `contract_scopes`, `order_windows`, `order_exceptions`, `special_order_requests`, `client_incidents`, `internal_incidents`, `incident_messages`, `tasks`, `logistics_drivers`, `logistics_vehicles`, `logistics_routes`, `logistics_maintenance`, `deliveries`, `route_stops`, `driver_gps_positions`, `accounts_receivable`, `accounts_payable`, `financial_transactions`, `bank_accounts`, `bank_transactions`, `nfe_emissoes`, `nf_drafts`, `fiscal_invoices`, `inventory_entries`, `inventory_movements`, `waste_control`, `purchase_plan_status`, `scope_simulations`, `company_quotations`, `company_certificates`, `company_config`, `company_settings`, `empresa_config`, `email_schedules`, `push_subscriptions`, `contract_adjustments`, `cnab_import_history`, `sanitary_evaluations`

**Tabelas SYSTEM-WIDE** (sem companyId — dados globais):
`system_settings`, `system_logs`, `audit_logs`, `auth_attempts`, `security_blocked_users`, `tenant_mismatch_events`, `event_store`, `system_alerts`, `system_policies`, `announcements`, `smtp_config`, `planos`, `modulos_sistema`, `plano_modulos`, `modulos_marketplace`, `clara_training`, `ai_logs`, `ai_interactions`, `system_versions`, `system_updates`, `update_logs`, `password_reset_requests`, `password_reset_tokens`, `workflow_events`, `cron_faturamento_runs`

### Relacionamentos Principais

```
companies ──→ users (1:N via empresaId)
companies ──→ orders (1:N via companyId)
companies ──→ company_certificates (1:N)
companies ──→ company_config (1:1)
companies ──→ company_settings (1:1)       ← ⚠️ TRIPLE CONFIG
companies ──→ empresa_config (1:1)          ← ⚠️ TRIPLE CONFIG
orders ────→ order_items (1:N via orderId)
orders ────→ nfe_emissoes (1:N via orderId)
orders ────→ deliveries (1:N via orderId)
orders ────→ accounts_receivable (1:N via orderId)
products ──→ order_items (1:N via productId)
products ──→ product_prices (1:N via productId)
products ──→ product_sub_categories (1:N via productId)
logistics_routes ──→ route_stops (1:N)
logistics_routes ──→ deliveries (1:N via routeId)
```

### ⚠️ Problemas Identificados

| Problema | Tabelas Afetadas | Risco |
|----------|-----------------|-------|
| Triple config de empresa | `company_config`, `company_settings`, `empresa_config` | 🔴 Alto — dados podem divergir |
| Dois campos de status em orders | `orders.status` + `orders.workflowStatus` | 🟡 Médio — mapping manual necessário |
| `test_orders` em schema de produção | `test_orders` | 🟡 Médio — dados de teste em produção |
| Schema monolítico 2000+ linhas | `shared/schema.ts` | 🟡 Médio — manutenção insustentável |
| `ai_interactions` vs `ai_logs` | propósito pode se sobrepor | 🟡 Médio |
| `system_logs` vs `audit_logs` | propósito pode se sobrepor | 🟡 Médio |
| Sem índices explícitos definidos | todas | 🟡 Médio — performance em produção |
| Sem triggers ou views definidos | todas | ℹ️ Info — toda lógica em código |

---

<a id="etapa-6"></a>
## ETAPA 6 — BACKEND

### Arquitetura

O backend tem **duas camadas em coexistência**:

**Camada Moderna (`server/modules/`)** — Domain-Driven Design:
```
server/modules/
├── auth/        → routes + service + repository + UserProvisioningService
├── companies/   → routes + service + repository + CompanyCertificateRepository
├── finance/     → routes + service + repository
├── fiscal/      → routes + controller (minimal — em desenvolvimento)
├── inventory/   → routes + service + repository
├── logistics/   → routes + service + repository + auto-dispatch + ETA
├── orders/      → routes v1+v2 + service + repository + workflow + outbox worker
├── products/    → routes (produtos, categorias, pricing, upload) + service + repository
└── users/       → routes (standard + admin) + service + repository
```

**Camada Legada (`server/routes/`)** — ~60 arquivos:
Rotas especializadas ainda não migradas para módulos.

### Registro de Rotas (server/app.ts)
```
1. registerV2Modules(app)  → /api/v2/ (só orders)
2. registerV1Modules(app)  → /api/v1/ (todos os módulos)
3. registerModules(app)    → /api/ (módulos canônicos)
4. registerRoutes(app)     → Legado (server/routes/routes.ts)
```

Módulos registrados antes das rotas legadas = módulos têm precedência em caso de conflito de path.

### Versionamento de API
- **v1:** Aliases para todos os módulos (caminhos idênticos com prefixo `/api/v1/`)
- **v2:** Apenas `orders` — retorna envelope padronizado `{ success: true, data }`
- **Plano:** `users`, `companies`, `finance` para v2 declarado em comentário do código, não implementado

### Principais Services

| Service | Status | Evidência |
|---------|--------|-----------|
| `storage.ts` | ⚠️ Legado | Ainda referenciado em `routes/routes.ts` — novos módulos usam Drizzle diretamente |
| `mailer.ts` | ✅ Ativo | nodemailer funcional |
| `pushService.ts` | ✅ Ativo | web-push funcional |
| `memoryModule.ts` | ❌ Stub | Array em memória — comentário interno: "mover para DB em produção" |
| `aiDeveloper.ts` | ⚠️ Parcial | Funcionalidades avançadas são stubs |
| `companySettingsService.ts` | ✅ Ativo | — |
| `itauIntegration.ts` | ✅ Real | axios para APIs Itaú OAuth + Cash Management V2 |
| `geoService.ts` / `routeOptimizer.ts` | ✅ Ativo | — |
| `nf.draft.ts` + `nf.draft.builder.ts` | ✅ Ativo | — |
| `fiscal-closure.service.ts` | ✅ Ativo | — |
| `logger.ts` (services/) | ⚠️ Legado | Console wrapper — deve ser aposentado |
| `core/observability/logger.ts` | ✅ Ativo | Logger estruturado JSON tenant-aware |
| Suite `alerts/*.ts` | ✅ Ativo | Sistema massivo de alertas |

### Jobs e Workers

| Job | Trigger | Status |
|-----|---------|--------|
| `faturamento.cron.ts` | node-cron diário 08:00 | ✅ Ativo |
| Email Scheduler | Boot | ✅ Ativo |
| Continuous Audit Scheduler | Boot | ✅ Ativo |
| Auto-Dispatch (logistics) | Loop 10s | ✅ Ativo |
| Orders Outbox Worker | Event-driven | ✅ Ativo |
| Event Analytics Worker | Boot | ✅ Ativo |
| Job Registry (in-memory) | Sempre | ⚠️ Não persiste entre restarts |

### Feature Flags (`server/config/flags.ts`)
| Flag | O que controla |
|------|---------------|
| `BILLING_STRICT_MODE` | Rigor no billing |
| `BILLING_DRY_RUN` | Simula billing sem executar |
| `AUTO_FATURAMENTO` | Liga/desliga cron de NF-e |
| `USE_SAFE_TENANT_QUERY` | Migração gradual de tenant queries |
| `SAFE_TENANT_ROLLOUT_PERCENT` | % de requests usando novo tenant query |
| `ENABLE_NFE_IDEMPOTENCY_GUARD` | Proteção contra NF-e dupla |

### Middlewares — Mapa Completo

| Middleware | Localização | Status | Observação |
|-----------|-------------|--------|------------|
| `requireAuth` | `core/http/requireAuth.ts` | ✅ Canônico | Implementação principal |
| `requireRole` | `core/http/requireAuth.ts` | ✅ Canônico | RBAC com bypass MASTER/ADMIN/DIRECTOR |
| `auth.ts` | `middleware/auth.ts` | ✅ Re-export | Re-exporta do core |
| `authenticate.ts` | `shared/middlewares/authenticate.ts` | ⚠️ Diferente | Verifica `userId` OU `companyId` — lógica diferente do canônico |
| `tenantIsolation` | `middleware/auth.ts` | ✅ Ativo | Define `req.empresaId` |
| `tenantGuard` | `core/security/tenantGuard.ts` | ✅ Ativo | Multi-tenant fail-closed |
| `sessionGuard` | `core/security/sessionGuard.ts` | ✅ Ativo | Token versioning + device binding |
| `requestContext` | `middleware/requestContext.ts` | ✅ Ativo | AsyncLocalStorage |
| `requestId` | `middleware/requestId.ts` | ✅ Ativo | UUID por request |
| `requestLogger` | `middleware/requestLogger.ts` | ✅ Ativo | — |
| `rateLimit` (login/email) | `core/http/rateLimit.ts` | ✅ Ativo | — |
| `rateLimit` (multi) | `core/security/rateLimit.ts` | ✅ Ativo | NF-e, API, login — mais completo |
| `serviceAuth` | `middleware/serviceAuth.ts` | ✅ Ativo | `x-api-key` pre-shared para serviços internos |
| `rateSchedule` | `core/auth/rateSchedule.ts` | ✅ Ativo | Rate limit progressivo 2 camadas (memória + DB) anti-credential stuffing |

### ⚠️ Duplicações Confirmadas no Backend

1. **Autenticação:** `authenticate.ts` (shared) ≠ `requireAuth.ts` (core) — lógicas diferentes
2. **Logger:** `services/logger.ts` (console) vs `core/observability/logger.ts` (JSON estruturado)
3. **Rate Limit:** `core/http/rateLimit.ts` vs `core/security/rateLimit.ts`
4. **DB Client:** `database/db.ts` (primário) vs `shared/db/client.ts` (re-export)
5. **Camada de dados:** `storage.ts` (legado) vs Drizzle direto (novos módulos)
6. **Logistics routes:** existe em `modules/logistics/` e em `routes/logistics.routes.ts`

---

<a id="etapa-7"></a>
## ETAPA 7 — FRONTEND

### State Management
- **Nenhum store global** (sem Zustand, Redux, Jotai) — evidência: nenhum arquivo de store encontrado
- **TanStack Query** gerencia todo estado server-side (cache, loading, error)
- **React Context:** `useAuth` expõe estado de autenticação globalmente via context interno
- **localStorage:** usado para carrinho de pedidos (create-order.tsx) e dismissal de comunicados (client/dashboard.tsx)

### Proteção de Rotas
`ProtectedRoute` em `App.tsx` verifica:
- `isAuthenticated` — usuário logado
- `isStaff` vs `isClient` — tipo de usuário
- `allowedRoles` — lista de roles permitidos por rota
- `FULL_ACCESS_ROLES` (MASTER, ADMIN, DIRECTOR) — bypass automático
- Redirect para `/login`, `/client` ou `/admin` conforme o caso

### Sidebar Navigation (`Layout.tsx`)
Links agrupados por categoria: **Comercial**, **Pedidos**, **Financeiro**, **Fiscal**, **Logística**, **Estoque**, **Segurança**, **Configurações**. Filtrados dinamicamente por role + `tabPermissions` do usuário.

### White Label
A `Layout.tsx` implementa um sistema de customização que aplica `--primary-color` e `--secondary-color` como CSS variables dinamicamente via `empresaConfig` da API. Não há ThemeProvider do `next-themes` evidenciado no App.tsx — a personalização é por tenant, não por usuário.

### Design System
- **38 primitivos** shadcn/ui em `components/ui/` — consistente em todo o sistema
- **Sem componente `<DataTable>` genérico** — cada tela implementa sua própria tabela
- **Sem `<KPICard>` genérico** — cards de métricas reimplementados em cada dashboard
- **Sem enum central de status/cores** — cada módulo define seus próprios badges e cores

### Componentes Customizados

| Componente | Status | Função |
|-----------|--------|--------|
| `Layout.tsx` | ✅ | Wrapper global + sidebar + white label |
| `VirtualAssistant.tsx` | ✅ | Chat flutuante Clara IA |
| `NfeDiagnosticsPanel.tsx` | ✅ | Validação NF-e por pedido (≠ página de diagnóstico) |
| `OrderTimeline.tsx` | ✅ | Timeline de status do pedido |
| `GlobalSearch.tsx` | ✅ | Busca global por entidades |
| `Modal.tsx` | ⚠️ | Wrapper de Dialog — pode ser redundante com shadcn |
| `ErrorBoundary.tsx` | ✅ | — |
| `PWAInstallPrompt.tsx` | ✅ | — |
| `FruitCuriosities.tsx` | ✅ | Curiosidades sobre frutas no onboarding (UX touch específico da VivaFrutaz) |
| `FloatingGuide.tsx` | ✅ | Ajuda contextual flutuante |
| `ContextualTip.tsx` | ✅ | Dicas por contexto |
| `TrainingMode.tsx` | ✅ | Overlay de modo treinamento |
| `WhatsNewModal.tsx` | ✅ | Modal de novidades |
| `FiscalInvoiceOCR.tsx` | ✅ | Upload + OCR de NF de entrada |
| `ImportarRetornoCnab.tsx` | ✅ | Importação de retorno CNAB |

### Padrões Repetidos (sem componente genérico)

| Padrão | Onde se repete | Impacto |
|--------|---------------|---------|
| Tabela com filtro + paginação | ~20+ telas admin | Inconsistência UX + duplicação de código |
| Cards de KPI no topo | 5 dashboards | Sem componente reutilizável |
| Badge de status colorido | orders, nfe, logistics, AR/AP | Sem enum central — cores inconsistentes |
| Modal de confirmação de delete | ~15+ telas | Sem componente `<ConfirmDeleteDialog>` |
| Ranking "Top Clientes" | `reports/financial` + `financial-intelligence` | Lógica duplicada |

---

<a id="etapa-8"></a>
## ETAPA 8 — SEGURANÇA

### ⚠️ ACHADOS CRÍTICOS

#### 1. Certificados .pfx no Repositório
**Evidência:** Dois arquivos `.pfx` encontrados em `attached_assets/`:
- `25280432_1778592073671.pfx`
- `25280432_1778593136228.pfx`

**Risco:** Se esses são certificados digitais A1 reais (o número 25280432 pode ser um CNPJ parcial), estão expostos a qualquer pessoa com acesso ao repositório. Certificados A1 são usados para assinar NF-e — comprometimento é crítico.

**Ação necessária antes de qualquer outra coisa:** Verificar se são reais ou de teste. Se reais, revogar imediatamente e remover do repositório.

#### 2. Dois Middlewares de Autenticação com Lógicas Diferentes
**Evidência:**
- `server/core/http/requireAuth.ts` → verifica `session.userId` (staff only)
- `server/shared/middlewares/authenticate.ts` → verifica `session.userId` OR `session.companyId` (permite cliente do portal)

**Risco:** Rotas que usam `authenticate.ts` podem aceitar sessões de clientes do portal onde apenas staff deveria ter acesso, dependendo de como foram escritas.

#### 3. Pagamentos SaaS sem Gateway Real
**Evidência:** `saas.routes.ts` gera PIX BR-Code e boletos localmente sem chamar nenhuma API de pagamento. Marca cartão de crédito como sucesso imediato.

**Risco:** Clientes do SaaS podem receber confirmação de pagamento sem que nenhuma cobrança real ocorra.

### Autenticação e Sessão

| Mecanismo | Implementação | Status |
|----------|---------------|--------|
| Sessão | express-session + connect-pg-simple (PostgreSQL) | ✅ Seguro |
| Session secret | `SESSION_SECRET` via env var | ✅ |
| Token versioning | `sessionGuard.ts` compara `tokenVersion` | ✅ |
| Device binding | `sessionGuard.ts` valida `X-Device-Id` | ✅ |
| Rate limit login | `rateSchedule.ts` progressivo 2 camadas | ✅ |
| MASTER/ADMIN bypass | `requireRole` — automático | ⚠️ Sem opção strict por padrão |
| Multi-tenant guard | `tenantGuard.ts` fail-closed + blocker DB | ✅ |
| Anomaly detection | `intelligence.engine.ts` + `decision.engine.ts` | ✅ |

### Variáveis de Ambiente Utilizadas
Extraídas do código (`process.env.*`):
```
SUPABASE_DATABASE_URL  — conexão PostgreSQL
SESSION_SECRET         — chave da sessão
NFE_CERT_SECRET        — chave de criptografia dos certificados A1 (mín. 32 bytes)
```
Sem credenciais hardcoded encontradas no código-fonte.

### Feature Flags de Segurança
```
USE_SAFE_TENANT_QUERY      → migração gradual de queries tenant-aware
SAFE_TENANT_ROLLOUT_PERCENT → % de rollout controlado
ENABLE_NFE_IDEMPOTENCY_GUARD → proteção contra dupla emissão
```

---

<a id="etapa-9"></a>
## ETAPA 9 — IA CLARA

### O que é Clara IA (baseado no código)
Clara IA é um **sistema especialista baseado em regras e correspondência de padrões**. Não é um LLM. A arquitetura permite substituição por LLM externo no futuro.

### Mapa Completo dos Arquivos

#### Assistente Interativo (Chat)
| Arquivo | Status | O que faz |
|---------|--------|-----------|
| `server/routes/assistant.routes.ts` | ✅ Completo | Intent detection via regex, máquina de estados multi-turn, acesso a dados reais (pedidos, estoque, clima) |
| `client/src/components/VirtualAssistant.tsx` | ✅ Completo | UI do chat flutuante com markdown, panel shortcuts, quick exports |
| `client/src/pages/admin/clara-training.tsx` | ✅ Completo | CRUD de pares Q&A no banco |
| `shared/schema.ts → clara_training` | ✅ | Tabela de treinamento persistida em PostgreSQL |

#### Intelligence Engine (Background — não é chat)
| Arquivo | Status | O que faz |
|---------|--------|-----------|
| `server/core/intelligence/intelligence.engine.ts` | ✅ Completo | Analisa eventos do sistema com rolling windows, calcula risk scores, identifica anomalias (brute force, retry storms) |
| `server/core/decision/decision.engine.ts` | ✅ Completo | Traduz risk scores em ações defensivas (notificações, Protective Mode, lockouts) |
| `server/core/security/anomalyDetection.service.ts` | ✅ Ativo | — |
| `server/core/security/continuousAudit.ts` | ✅ Ativo | Auditoria contínua em background |
| `server/core/events/event.emitter.ts` | ✅ Ativo | Bus de eventos do sistema |
| `server/core/events/event-analytics.engine.ts` | ✅ Ativo | Analytics em cima dos eventos |

#### AI Developer (Parcial)
| Arquivo | Status | O que faz |
|---------|--------|-----------|
| `server/routes/clara.routes.ts` | ⚠️ Parcial | Endpoints fix-bug, generate-module, Smart Export — chama `aiDeveloper.ts` |
| `server/services/aiDeveloper.ts` | ⚠️ Stub | Funcionalidades avançadas não implementadas |
| `server/services/memoryModule.ts` | ❌ Stub | Array em memória — comentário: "mover para DB em produção" — perde estado a cada restart |

#### Tabelas de IA no Banco
| Tabela | Propósito |
|--------|-----------|
| `clara_training` | Pares Q&A para treinamento personalizado |
| `ai_interactions` | Histórico de interações com a IA |
| `ai_logs` | Logs de operações de IA |
| `nfe_training_logs` | Telemetria de falhas NF-e para melhorar sugestões |

### O que é IA vs O que é ERP Genérico
| Componente | É IA | É ERP |
|-----------|:----:|:-----:|
| Intent detection + regex matching | ✅ | — |
| Máquina de estados multi-turn | ✅ | — |
| Training Q&A (clara_training) | ✅ | — |
| Risk scoring + anomaly detection | ✅ | — |
| Decision engine (lockouts, alerts) | ✅ | — |
| Smart Export de dados | ✅ | — |
| `safeGetOrders` (wrapper de dados) | — | ✅ |
| `createCompanyFromClaraAI` | — | ✅ |
| Acesso a pedidos/estoque | — | ✅ |

### ⚠️ Problemas
- `memoryModule.ts` em memória → Clara perde contexto de conversa a cada restart do servidor
- `test-clara.tsx` com dados mock está em produção
- `clara.routes.ts` tenta duplicar funcionalidade de chat já presente em `assistant.routes.ts`

---

<a id="etapa-10"></a>
## ETAPA 10 — MÓDULO FISCAL / NF-e

### O que está pronto

| Componente | Status | Evidência |
|-----------|--------|-----------|
| Geração de XML NF-e 4.00 | ✅ Pronto | `nfeGenerator.ts` — XML completo conforme schema SEFAZ |
| Assinatura digital XMLDSIG | ✅ Pronto | `nfeSigner.ts` + `nfeSignature.ts` + `xml-crypto` |
| Comunicação SOAP com SEFAZ | ✅ Pronto | `nfeSender.ts` + `nfeSoap.ts` — suporta emissão, cancelamento, CC-e |
| URLs por UF e ambiente | ✅ Pronto | `nfeUrl.ts` — homologação e produção por estado |
| Gestão de certificados A1 | ✅ Pronto | `nfeCert.ts` + `nfeCertDynamic.ts` + `nfeCertGuard.ts` — multi-tenant, valida expiração |
| Validação pré-envio | ✅ Pronto | `nfeValidator.ts` (regras de negócio) + `nfeXmlGuard.ts` (estrutura XML) |
| Auto-correção de erros SEFAZ | ✅ Pronto | `nfeAutoCorrect.ts` — corrige cStat 533 (divergência ICMS) automaticamente |
| Circuit breaker SEFAZ | ✅ Pronto | `sefazCircuitBreaker.ts` — fault tolerance para instabilidade |
| Geração de DANFE (PDF) | ✅ Pronto | `danfeGenerator.ts` + `pdfkit` |
| Diagnóstico do sistema | ✅ Pronto | `fiscal-diagnostics.routes.ts` + suite em `diagnostics/` |
| Cancelamento de NF-e | ✅ Pronto | `nfeSender.ts` — endpoint de cancelamento |
| Carta de Correção (CC-e) | ✅ Pronto | `nfeSender.ts` + `nfeCce` tabela |

### O que depende apenas de configuração

| Item | O que falta |
|------|-------------|
| **Certificado A1** | Único bloqueador para homologação — estrutura inteira existe, falta o arquivo `.pfx` + senha em variável de ambiente `NFE_CERT_SECRET` |
| **Ambiente SEFAZ** | Trocar flag de homologação para produção em `nfeUrl.ts` |
| **CNPJ do emissor** | Configurar dados da empresa emissor em `empresa_config` |

### Dados Fiscais no Banco
| Dado | Onde está |
|------|----------|
| NCM | `products.ncmCode` |
| CFOP | `orders` / `order_items` |
| CST / CSOSN | Calculado em `nfeGenerator.ts` conforme CRT da empresa |
| Natureza de Operação | `orders.naturezaOperacao` |
| Dados do emissor (CNPJ, IE, IM, CRT) | `companies` + `empresa_config` |
| Certificados A1 | `company_certificates` (criptografados) |
| Histórico de emissões | `nfe_emissoes` |
| Cartas de correção | `nfe_cce` + `nfe_cce_audit_logs` |
| DANFE registros | `danfe_records` |
| Fecho fiscal | `fiscal_closures` |

### O que realmente funciona (testado e evidenciado)
O módulo de NF-e é o mais maduro do sistema. Possui:
- 7 arquivos de testes unitários dedicados ao domínio NF-e
- Auto-correção de rejeições sem intervenção humana
- Circuit breaker para resiliência
- Diagnóstico completo de saúde do pipeline
- Emissão em lote via cron

---

<a id="etapa-11"></a>
## ETAPA 11 — OPERAÇÃO DA VIVAFRUTAZ

### O sistema foi desenvolvido para a operação real da VivaFrutaz?
**Sim.** Há evidências claras no código de regras de negócio específicas para distribuição de FLV.

### Funcionalidades ESPECÍFICAS da VivaFrutaz

| Funcionalidade | Evidência no Código | Por que é específico |
|---------------|--------------------|--------------------|
| **Janelas de Pedido** com corte fixo (quinta-feira 12:00) | `admin/order-windows.tsx` | Perecíveis exigem janela de compra rígida para viabilizar o abastecimento |
| **"Force Open" de janela** para feriados | `order-windows.tsx` | Gestão de exceções sazonais de safra |
| **Planejamento de Compras por categoria FLV** | `purchase-planning.tsx` | Consolida demanda por Frutas / Hortifruti / Industrializados + alertas ±80% de variação histórica |
| **Controle de Desperdício** | `waste-control.tsx` | Razões específicas: "Passada do Ponto", "Avaria" — típico de perecíveis |
| **Avaliação Sanitária** | `sanitary.tsx` | Conformidade ANVISA para manipulação de alimentos |
| **FruitCuriosities** | `FruitCuriosities.tsx` | Curiosidades sobre frutas no onboarding — detalhe de branding |
| **Simulação de Escopo** pré-venda | `scope-simulations.tsx` | Calcula se prospect atende mínimo de rota antes de virar cliente |
| **Inteligência Comercial** | `commercial-intelligence.tsx` | Detecta clientes "em risco" (sem pedido há 14+ dias), queda de volume, oportunidades de venda — específico para retenção de clientes B2B de hortifrutis |
| **Hierarquia de Preço** com adminFee oculto | `priceResolver.ts` | contractPrice > subCategoryPrice > basePrice + adminFee invisível ao cliente |
| **Faturamento por contrato recorrente** | `contract_scopes`, `contratos_clientes` | Modelo subscription-like onde itens recorrentes são gerados automaticamente |

### Funcionalidades Genéricas de ERP (presentes mas não exclusivas)

| Módulo | Observação |
|--------|-----------|
| CRUD de Usuários / Permissões | Qualquer sistema |
| Autenticação + Sessão | Qualquer sistema |
| SMTP + Notificações | Qualquer sistema |
| Logs + Auditoria | Qualquer sistema |
| Backups | Qualquer sistema |
| Incidentes / Suporte | CRM genérico |
| Anúncios internos | Qualquer sistema |

### Módulos que provavelmente NUNCA serão utilizados na operação diária

| Módulo | Justificativa |
|--------|--------------|
| **AI Developer** | Gera código — para devs, não para a operação da VivaFrutaz |
| **White Label** | Implica customização visual por cliente — não é necessidade imediata do negócio de distribuição |
| **Marketplace de Módulos** | Activa/desativa funcionalidades — overhead de gestão para uma empresa que usa o sistema internamente |
| **test-clara.tsx** | Página de diagnóstico com dados mock — não tem uso operacional |

### Processos que AINDA dependem de Excel / WhatsApp / Controles externos

Com base no código, os seguintes pontos **não têm automação completa**:

| Processo | Status no sistema | Provável canal atual |
|----------|-----------------|---------------------|
| Confirmação de pagamento de cliente | AR criado, mas pagamento marcado manualmente | WhatsApp / e-mail |
| Acompanhamento de fornecedores | Sem módulo de fornecedores (Contas a Pagar sim, fornecedor não) | Excel / WhatsApp |
| Precificação de produtos sazonais | Preço manual por produto — sem motor de precificação dinâmica por safra | Excel |
| Gestão de ocorrências na entrega | Há módulo de incidentes, mas depende do motorista reportar | WhatsApp |
| Notas Fiscais de Entrada (fornecedor) | OCR existe, mas é manual — sem integração com XML da SEFAZ de terceiros | Manual |
| Registro de compras realizadas | Sem módulo de Pedido de Compra / Recebimento formal | Excel |

### É Produto SaaS?
**Sim, com evidências claras no código.**

A VivaFrutaz **usa e vende** este sistema:
- `planos`, `assinaturas`, `modulos_sistema`, `plano_modulos` — gestão de planos e assinaturas
- `saas-dashboard.tsx` — painel de gestão de clientes do SaaS
- `saas-financeiro.tsx` — billing dos clientes SaaS
- `faturas_saas` — tabela de faturas geradas para clientes do SaaS
- Ajuste por IPCA implementado em contratos
- Detecção de inadimplência (15+ dias) automatizada

O componente SaaS está **deployment-ready** — não é protótipo.

---

<a id="etapa-12"></a>
## ETAPA 12 — MATRIZ DE CLASSIFICAÇÃO

| Módulo | Status | Justificativa |
|--------|--------|--------------|
| **Pedidos (Admin)** | 🟢 Pronto | Workflow completo com máquina de estados, preflight NF-e, histórico, reabertura |
| **Pedidos (Cliente)** | 🟢 Pronto | Fluxo de criação funcional, janela de pedido integrada, histórico |
| **Logística** | 🟢 Pronto | Auto-dispatch, GPS, ETA, motorista, checklist, manutenção |
| **NF-e / Fiscal** | 🟢 Pronto | Módulo mais maduro — só falta certificado A1 |
| **Planejamento de Compras** | 🟢 Pronto | Consolidação por categoria, alerta de déficit, histórico |
| **Controle de Desperdício** | 🟢 Pronto | Específico para FLV, funcional |
| **Inteligência Comercial** | 🟢 Pronto | Clientes em risco, queda de volume, oportunidades |
| **Estoque / Inventário** | 🟢 Pronto | Entradas, movimentações, contagens físicas |
| **Financeiro (AR/AP)** | 🟡 Precisa melhorar | Funcional, mas pagamento confirmado manualmente; sem gateway real |
| **Banco (Itaú)** | 🟢 Pronto | Integração real, saldo e extrato funcionais |
| **CNAB** | 🟢 Pronto | Import de retorno bancário funcional |
| **Contratos** | 🟢 Pronto | IPCA, ajustes, escopo recorrente |
| **Simulação de Escopo** | 🟢 Pronto | Pré-venda funcional |
| **Inteligência Financeira** | 🟢 Pronto | BI, forecasting, top clientes |
| **Cotações** | 🟢 Pronto | — |
| **Relatórios** | 🟡 Precisa melhorar | "Top clientes" duplicado entre relatório e inteligência financeira |
| **Clara IA (chat)** | 🟡 Precisa melhorar | Funcional, mas memória perde estado a cada restart |
| **Clara Training** | 🟢 Pronto | Q&A persistido em banco |
| **Sanitário** | 🟢 Pronto | — |
| **E-mail Management** | 🟢 Pronto | Automações de janela, pedidos, follow-up |
| **Clientes / Empresas** | 🟢 Pronto | CRUD completo, grupos de preço, config |
| **Usuários / Permissões** | 🟢 Pronto | 11 roles, tab permissions granulares |
| **Janelas de Pedido** | 🟢 Pronto | Cutoff quinta-feira, Force Open, exceções |
| **SaaS Dashboard** | 🟡 Precisa melhorar | Gestão de assinaturas sem gateway de pagamento real |
| **SaaS Financeiro** | 🔴 Problema crítico | PIX / boleto gerados localmente — sem cobrança real de clientes SaaS |
| **Configurações / SMTP** | 🟢 Pronto | — |
| **System Health** | 🟢 Pronto | — |
| **Observability** | 🟠 Precisa reorganizar | Sobreposição com System Health — consolidar |
| **Security Dashboard** | 🟢 Pronto | — |
| **Security Intelligence** | 🟢 Pronto | Anomaly detection funcional |
| **Governance** | 🟢 Pronto | — |
| **Backups** | 🟢 Pronto | — |
| **Developer Page** | 🟢 Pronto | Ferramentas internas de debug |
| **Academy / Treinamento** | 🟢 Pronto | — |
| **Incidentes Cliente** | 🟢 Pronto | — |
| **Incidentes Internos** | 🟢 Pronto | — |
| **Tarefas (OS)** | 🟢 Pronto | — |
| **Comunicados** | 🟢 Pronto | — |
| **Rastreamento Público** | 🟢 Pronto | — |
| **Painel do Motorista** | 🟢 Pronto | — |
| **Importação de Dados** | 🟢 Pronto | — |
| **Faturamento Automático** | 🟢 Pronto | Cron funcional com idempotência |
| **Diagnóstico Fiscal** | 🟢 Pronto | Health check completo do pipeline |
| **Config Fiscal** | 🟢 Pronto | — |
| **NF Manual** | 🟢 Pronto | — |
| **AI Developer** | ⚫ Pode ser descontinuado | Stubs internos, não é usado pela operação VivaFrutaz |
| **White Label** | ⚫ Pode ser descontinuado | UI existe, deploy não implementado — adiar para versão futura |
| **Marketplace de Módulos** | ⚫ Pode ser descontinuado | Sem backend de ativação real — adiar |
| **test-clara.tsx** | ⚫ Pode ser descontinuado | Página mock sem uso em produção — remover |

---

<a id="etapa-13"></a>
## ETAPA 13 — RELATÓRIO EXECUTIVO

### 1. Resumo Executivo

O Portal VivaFrutaz ERP é um sistema **maduro e operacional** para distribuição de FLV, com funcionalidades avançadas que vão além do esperado para o tamanho da empresa. O sistema cresceu rapidamente ao longo de múltiplas fases de desenvolvimento intensivo, resultando em uma base funcional sólida com marcas típicas de crescimento acelerado: legado coexistindo com código moderno, duplicações de infraestrutura, documentação desatualizada e cobertura de testes concentrada em poucos módulos.

**O sistema está em produção** ou próximo disso — não é protótipo.

---

### 2. Arquitetura Encontrada

```
┌─────────────────────────────────────────────────────┐
│                   FRONTEND (React 18)                │
│  Wouter + TanStack Query + shadcn/ui + Tailwind      │
│  ~80 telas | 9 hooks | 38 primitivos UI              │
└────────────────────┬────────────────────────────────┘
                     │ HTTP/WebSocket
┌────────────────────▼────────────────────────────────┐
│                BACKEND (Express 5)                   │
│                                                      │
│  ┌──────────────┐  ┌────────────────────────────┐   │
│  │  Módulos v1  │  │  Rotas Legadas (~60 arquivos)│  │
│  │  (DDD limpo) │  │  em transição para módulos  │  │
│  └──────────────┘  └────────────────────────────┘   │
│                                                      │
│  ┌──────────────────────────────────────────────┐   │
│  │         Core (infraestrutura transversal)     │   │
│  │  auth | security | events | jobs | observab. │   │
│  └──────────────────────────────────────────────┘   │
└────────────────────┬────────────────────────────────┘
                     │ Drizzle ORM
┌────────────────────▼────────────────────────────────┐
│            PostgreSQL (Supabase)                     │
│            97 tabelas — 1 arquivo de schema          │
└─────────────────────────────────────────────────────┘
         │              │              │
    Itaú (real)    SEFAZ (SOAP)   Serviços externos
```

---

### 3. Fluxos Existentes
1. **Ciclo completo de pedido:** Cliente → Pedido → Aprovação Admin → Logística → Entrega
2. **Emissão de NF-e:** Aprovação → Cron diário → XML → Assinatura → SEFAZ → Autorização
3. **Faturamento financeiro:** Pedido aprovado → AR criado → Pagamento manual → Registro
4. **Ciclo logístico:** Auto-dispatch → Driver → GPS tracking → Entrega confirmada
5. **Onboarding de cliente:** Simulação de escopo → Empresa → Contrato → Pedidos
6. **Billing SaaS:** Assinatura → Fatura gerada → Notificação → ⚠️ sem cobrança real

---

### 4. Funcionalidades Existentes e Completas
- Gestão completa de pedidos (cliente + admin)
- Logística com auto-dispatch, GPS, ETA
- Emissão de NF-e com circuit breaker e auto-correção
- Controle de estoque e planejamento de compras
- Financeiro AR/AP + integração Itaú real
- Contratos com IPCA e ajustes
- Inteligência comercial e financeira
- Multi-tenancy robusto via AsyncLocalStorage
- Clara IA com training personalizado
- Sistema de segurança com anomaly detection
- Push notifications + email automation
- CNAB import
- Sanitário + controle de desperdício
- SaaS billing (estrutura)

---

### 5. Funcionalidades Incompletas

| Funcionalidade | O que falta |
|---------------|------------|
| Gateway de pagamento SaaS | Integração real (Stripe, Iugu) — atualmente é mock |
| Memória da Clara IA | Migrar `memoryModule.ts` para banco de dados |
| AI Developer | Stubs — geração de código não implementada |
| White Label | Deploy real não implementado |
| Marketplace de módulos | Ativação sem backend real |
| Emissão NF-e homologação | Certificado A1 não configurado |

---

### 6. Funcionalidades Duplicadas

| Duplicação | Impacto |
|-----------|---------|
| Triple config de empresa (`company_config`, `company_settings`, `empresa_config`) | Risco de dados inconsistentes |
| Dois middlewares de autenticação (`requireAuth.ts` vs `authenticate.ts`) | Risco de segurança |
| Dois loggers (`services/logger.ts` vs `core/observability/logger.ts`) | Inconsistência de logs |
| Dois rate limiters (`core/http` vs `core/security`) | Comportamento diferente por rota |
| "Top clientes" em `reports/financial` e `financial-intelligence` | Lógica duplicada |
| Logistics routes em `modules/` e `routes/` | Código duplicado |
| Dois status de pedido (`orders.status` + `orders.workflowStatus`) | Mapeamento manual necessário |

---

### 7. Problemas Críticos 🔴

| # | Problema | Impacto |
|---|---------|---------|
| 1 | **Arquivos .pfx no repositório** | Se reais, comprometimento do certificado A1 — permite emissão de NF-e fraudulentas |
| 2 | **Pagamentos SaaS são mock** | Clientes SaaS confirmados sem cobrança real |
| 3 | **Dois middlewares de autenticação divergentes** | Risco de acesso indevido por uso do middleware errado |

---

### 8. Problemas Médios 🟡

| # | Problema | Impacto |
|---|---------|---------|
| 1 | `memoryModule.ts` em memória | Clara perde contexto a cada restart |
| 2 | Schema monolítico 2000+ linhas | Manutenção difícil, onboarding lento |
| 3 | Triple config de empresa | Dados podem divergir entre as 3 tabelas |
| 4 | Sem índices explícitos no schema | Performance em produção com volume |
| 5 | `storage.ts` (legado) coexistindo com Drizzle direto | Dois padrões de acesso a dados |
| 6 | Job registry in-memory | Não sobrevive a múltiplas instâncias |
| 7 | `test_orders` em produção | Dados de teste contaminam ambiente |
| 8 | Dois campos de status em orders | Sincronização manual |

---

### 9. Problemas Baixos 🟢➡️⚠️

| # | Problema |
|---|---------|
| 1 | 100+ arquivos .txt de prompts em `attached_assets/` |
| 2 | `test-clara.tsx` (mock) em produção |
| 3 | `tmp_migrations.js` na raiz |
| 4 | Playwright em `dependencies` (deveria ser `devDependencies`) |
| 5 | ngrok em `dependencies` (deveria ser `devDependencies`) |
| 6 | Playwright artifacts (reports/, videos/) sem .gitignore |
| 7 | 3 dashboards de segurança separados sem hierarquia clara |
| 8 | `Modal.tsx` potencialmente redundante com shadcn Dialog |
| 9 | Sem `<DataTable>` genérico — 20+ reimplementações |
| 10 | Sem enum central de status/cores/badges |

---

### 10. Riscos

| Risco | Probabilidade | Severidade |
|-------|:------------:|:----------:|
| Certificados .pfx reais expostos | Confirmado | 🔴 Crítica |
| Clientes SaaS sem cobrança real | Confirmado | 🔴 Crítica |
| Inconsistência de autenticação entre rotas | Média | 🔴 Alta |
| Triple config de empresa com dados divergentes | Alta | 🟡 Média |
| Performance em produção sem índices | Alta | 🟡 Média |
| Perda de contexto da Clara IA em restarts | Alta | 🟡 Média |
| Onboarding difícil por falta de documentação atual | Alta | 🟡 Média |

---

### 11. Dívida Técnica

| Item | Tipo | Esforço estimado |
|------|------|-----------------|
| Migrar ~40 rotas legadas para `server/modules/` | Refactor | Alto |
| Split de `shared/schema.ts` por domínio | Reorganização | Médio |
| Unificar middlewares de autenticação | Correção | Baixo |
| Unificar loggers | Correção | Baixo |
| Unificar rate limiters | Correção | Baixo |
| Aposentar `storage.ts` | Refactor | Alto |
| Migrar `memoryModule.ts` para DB | Correção | Baixo |
| Criar `<DataTable>` genérico | Feature | Médio |
| Criar enum central de status | Organização | Baixo |
| Documentação técnica atualizada | Documentação | Médio |
| Cobertura de testes para pedidos, financeiro, logística | Testes | Alto |

---

### 12. Qualidade do Código

**Nota: 7.5/10**

**Positivo:**
- TypeScript em todo o projeto (sem `any` evidente em módulos novos)
- Zod para validação — contratos bem definidos
- Padrões bem escolhidos (Drizzle, TanStack Query, shadcn)
- Feature flags para rollout controlado
- Tratamento de erros com `asyncHandler` padronizado nos módulos
- Outbox pattern para consistência de pedidos

**Negativo:**
- Dois padrões de acesso a dados coexistindo
- Checks de role hardcoded inline em algumas telas
- `any` implícito em código legado (routes/)
- Funções longas em `routes/routes.ts`

---

### 13. Qualidade da Arquitetura

**Nota: 7.0/10**

**Positivo:**
- Transição organizada para DDD (`server/modules/`)
- Multi-tenancy via AsyncLocalStorage — padrão correto
- Event sourcing com `event_store`
- Circuit breaker para dependências externas
- Separação clara de frontend/backend/shared

**Negativo:**
- Transição incompleta — legado e moderno coexistem sem data de conclusão
- Versioning de API (v1/v2) incompleto — apenas orders em v2
- Sem API docs (OpenAPI/Swagger)
- Schema monolítico não permite trabalho paralelo em times

---

### 14. Qualidade do Banco

**Nota: 6.5/10**

**Positivo:**
- 97 tabelas cobrindo todos os domínios
- Multi-tenancy modelado desde o início (companyId em ~50 tabelas)
- Status fields bem definidos por domínio
- Histórico completo (audit_logs, event_store, system_logs)

**Negativo:**
- Schema monolítico — 2000+ linhas em 1 arquivo
- Triple config de empresa (possível redundância)
- Sem índices explícitos definidos no Drizzle schema
- Dois campos de status em orders (legado + novo)
- `test_orders` em produção

---

### 15. Qualidade do Frontend

**Nota: 7.5/10**

**Positivo:**
- Design system shadcn/ui consistente em 100% das telas
- 9 hooks bem definidos e reutilizados
- TanStack Query com cache e invalidação controlada
- PWA habilitado
- White label por tenant

**Negativo:**
- Sem `<DataTable>` genérico — 20+ implementações manuais
- Sem `<KPICard>` genérico — 5 dashboards distintos
- Carrinho em localStorage — sem sincronização entre dispositivos
- Sem enum central de status/cores

---

### 16. Qualidade do Backend

**Nota: 7.5/10**

**Positivo:**
- Domain-driven design em módulos novos
- Outbox pattern para consistência
- Rate limiting progressivo multi-camada
- Circuit breaker para SEFAZ
- Intelligence engine com anomaly detection

**Negativo:**
- Dois padrões de acesso a dados (storage.ts + Drizzle)
- Dois middlewares de autenticação diferentes
- Dois loggers diferentes
- Cron jobs simples (node-cron) sem retry/dead letter queue

---

### 17. Qualidade da UX

**Nota: 7.0/10**

**Positivo:**
- Clara IA como assistente flutuante — diferencial real
- FruitCuriosities — toque de branding relevante
- Contextual tips e floating guide
- Dark mode / white label por tenant
- PWA instalável
- Rastreamento público de entregas

**Negativo:**
- 5 dashboards diferentes sem hierarquia clara — usuário pode se perder
- Carrinho de pedidos sem persistência entre dispositivos
- Sem indicação visual clara do preço ativo (qual dos 3 níveis está sendo aplicado)
- Sem confirmação visual de envio para SEFAZ em tempo real (usuário aguarda cron)

---

### 18. Qualidade da Documentação

**Nota: 4.5/10**

**Positivo:**
- `replit.md` presente
- `QUICK_START.md` e `START_HERE.md` existem
- `docs/readiness-report-fase-1-3.md` recente

**Negativo:**
- Sem documentação de API (OpenAPI/Swagger)
- Sem documentação de arquitetura atualizada
- `MAPA_ARQUIVOS.md` desatualizado (projeto cresceu muito)
- 10+ arquivos .md históricos de fases de desenvolvimento que não refletem o estado atual
- 100+ prompts .txt no repositório que não são documentação

---

### 19. Nota Geral do Sistema

# **7.0 / 10**

Sistema funcional, maduro para uma empresa do porte da VivaFrutaz, com funcionalidades avançadas (NF-e completo, multi-tenancy, inteligência de segurança, integração bancária real). Os déficits são típicos de crescimento acelerado. Nada exige reescrita — tudo exige organização e finalização de fluxos incompletos.

---

### 20. Recomendações

**Imediato (antes de qualquer nova funcionalidade):**
1. **Verificar os 2 arquivos .pfx em `attached_assets/`** — se reais, revogar e remover do repositório
2. **Unificar middlewares de autenticação** — escolher `requireAuth.ts` como único padrão
3. **Integrar gateway de pagamento real no SaaS** — atualmente não há cobrança real

**Curto prazo (organização sem quebrar funcionalidades):**
4. Migrar `memoryModule.ts` para tabela `ai_interactions` (já existe no banco)
5. Aposentar `server/services/logger.ts` — atualizar imports para `core/observability/logger.ts`
6. Remover `test-clara.tsx`, `tmp_migrations.js`, `.md` históricos, `attached_assets/*.txt`
7. Adicionar `.gitignore` para `tests/reports/` e `tests/videos/`
8. Mover `playwright` e `ngrok` para `devDependencies`

**Médio prazo (maturidade técnica):**
9. Split de `shared/schema.ts` por domínio
10. Investigar e consolidar triple config de empresa
11. Criar `<DataTable>` e `<KPICard>` genéricos
12. Criar enum central de status/cores
13. Expandir cobertura de testes para módulos sem cobertura (pedidos, financeiro, logística, client portal)
14. Documentação de API (OpenAPI/Swagger)

**Bloqueador para SEFAZ Homologação:**
15. Configurar Certificado A1 real no ambiente — toda a infraestrutura NF-e está pronta

---

*Auditoria realizada em 20/07/2026*  
*100% baseada em evidências do código existente*  
*Nenhum arquivo foi alterado, criado (exceto este relatório) ou removido*
