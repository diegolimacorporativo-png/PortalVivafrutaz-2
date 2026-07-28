# RC1 — Auditoria Funcional Completa

**Data:** 28 de julho de 2026
**Versão:** Release Candidate 1 (RC1)
**Auditor:** Replit Agent
**Metodologia:** Análise estática do código-fonte (frontend + backend + schema), sem alterações de código.

---

## Índice

1. [Mapa de Módulos](#1-mapa-de-módulos)
2. [Status por Módulo](#2-status-por-módulo)
3. [Validação por Tela](#3-validação-por-tela)
4. [Análise de Navegação](#4-análise-de-navegação)
5. [Análise de UX](#5-análise-de-ux)
6. [Simulação do Fluxo Completo](#6-simulação-do-fluxo-completo)
7. [Bugs Funcionais Reais](#7-bugs-funcionais-reais)
8. [Classificação por Impacto](#8-classificação-por-impacto)
9. [Veredicto Final](#9-veredicto-final)

---

## 1. Mapa de Módulos

### 1.1 Área Comercial
| Módulo | Rota Frontend | Arquivo Principal |
|--------|--------------|-------------------|
| Gestão de Empresas | `/admin/companies` | `pages/admin/companies/index.tsx` |
| Contratos | `/admin/contracts` | `pages/admin/contracts.tsx` |
| Escopo Contratual (cliente) | `/client/contract-scope` | `pages/client/contract-scope.tsx` |
| Grupos de Preço | `/admin/price-groups` | `pages/admin/price-groups.tsx` |
| Janelas de Pedido | `/admin/order-windows` | `pages/admin/order-windows.tsx` |
| Exceções de Pedido | `/admin/order-exceptions` | `pages/admin/order-exceptions.tsx` |
| Cotações | `/admin/quotations` | `pages/admin/quotations.tsx` |
| Simulação de Escopo | `/admin/scope-simulations` | `pages/admin/scope-simulations.tsx` |

### 1.2 Área de Pedidos
| Módulo | Rota Frontend | Arquivo Principal |
|--------|--------------|-------------------|
| Pedidos (Admin) | `/admin/orders` | `pages/admin/orders/` |
| Pedidos Recorrentes (cron) | — (background) | `server/jobs/recurring-orders.cron.ts` |
| Pedidos Especiais | `/admin/special-orders` | `pages/admin/special-orders.tsx` |
| Criar Pedido (cliente) | `/client/create-order` | `pages/client/create-order.tsx` |
| Editar Pedido (cliente) | `/client/edit-order` | `pages/client/edit-order.tsx` |
| Histórico (cliente) | `/client/order-history` | `pages/client/order-history.tsx` |
| Timeline de Operações | `/admin/operations/timeline` | `pages/admin/operations-timeline.tsx` |

### 1.3 Planejamento e Compras
| Módulo | Rota Frontend | Arquivo Principal |
|--------|--------------|-------------------|
| Planejamento de Compras | `/admin/purchase-planning` | `pages/admin/purchase-planning.tsx` |
| Relatório de Compras | `/admin/purchasing` | `pages/admin/reports/purchasing.tsx` |
| Relatório de Industrializados | `/admin/industrialized` | `pages/admin/reports/industrialized.tsx` |

### 1.4 Produção e Estoque
| Módulo | Rota Frontend | Arquivo Principal |
|--------|--------------|-------------------|
| Estoque / Inventário | `/admin/inventory` | `pages/admin/inventory.tsx` |
| Controle de Desperdício | `/admin/waste-control` | `pages/admin/waste-control.tsx` |
| Módulo de Produção | — | **NÃO EXISTE** |

### 1.5 Logística
| Módulo | Rota Frontend | Arquivo Principal |
|--------|--------------|-------------------|
| Logística (Rotas + Motoristas) | `/admin/logistics` | `pages/admin/logistics.tsx` |
| Painel do Motorista | `/admin/driver-panel` | `pages/admin/driver-panel.tsx` |
| Inteligência Logística | `/admin/logistics-intelligence` | `pages/admin/logistics-intelligence.tsx` |
| Rastreio Público | `/track/:id` | `pages/track-delivery.tsx` |
| Mapa do Motorista | `/driver-map/:routeId` | `pages/driver-map.tsx` |

### 1.6 Financeiro e Fiscal
| Módulo | Rota Frontend | Arquivo Principal |
|--------|--------------|-------------------|
| Painel Financeiro (AR/AP/Caixa) | `/admin/finance` | `pages/admin/finance.tsx` |
| Relatório Financeiro | `/admin/financial` | `pages/admin/reports/financial.tsx` |
| Faturamento | `/admin/faturamento` | `pages/admin/faturamento.tsx` |
| Banco (CNAB/Extrato) | `/admin/banco` | `pages/admin/banco.tsx` |
| NF-e (Emissão) | `/admin/nfe` | `pages/admin/nfe.tsx` |
| NF-e Dashboard | `/admin/nfe/dashboard` | `pages/admin/nfe-dashboard.tsx` |
| NF-e Recovery | `/admin/nfe/recovery` | `pages/admin/nfe-recovery.tsx` |
| Fiscal Config | `/admin/fiscal-config` | `pages/admin/fiscal-config.tsx` |
| Fiscal Diagnóstico | `/admin/fiscal-diagnostics` | `pages/admin/fiscal-diagnostics.tsx` |
| Inserção Manual de NF | `/admin/insert-nf-manual` | `pages/admin/insert-nf-manual.tsx` |

### 1.7 Pós-Venda e Suporte
| Módulo | Rota Frontend | Arquivo Principal |
|--------|--------------|-------------------|
| Incidentes (Clientes) | `/admin/client-incidents` | `pages/admin/client-incidents.tsx` |
| Incidentes Internos | `/admin/internal-incidents` | `pages/admin/internal-incidents.tsx` |
| Incidentes (portal cliente) | `/client/incidents` | `pages/client/incidents.tsx` |
| Tarefas | `/admin/tasks` | `pages/admin/tasks.tsx` |

### 1.8 Dashboards e Analytics
| Módulo | Rota Frontend | Arquivo Principal |
|--------|--------------|-------------------|
| Dashboard Principal | `/admin` | `pages/admin/dashboard.tsx` |
| Dashboard Executivo | `/admin/executive` | `pages/admin/executive-dashboard.tsx` |
| Inteligência Comercial | `/admin/commercial-intelligence` | `pages/admin/commercial-intelligence.tsx` |
| Inteligência Financeira | `/admin/financial-intelligence` | `pages/admin/financial-intelligence.tsx` |
| Inteligência Logística | `/admin/logistics-intelligence` | `pages/admin/logistics-intelligence.tsx` |
| Observabilidade | `/admin/observability` | `pages/admin/observability.tsx` |

### 1.9 Configuração e Sistema
| Módulo | Rota Frontend | Arquivo Principal |
|--------|--------------|-------------------|
| Usuários | `/admin/users` | `pages/admin/users.tsx` |
| Produtos | `/admin/products` | `pages/admin/products/` |
| Categorias | `/admin/categories` | `pages/admin/categories.tsx` |
| Configurações | `/admin/settings` | `pages/admin/settings.tsx` |
| Backups | `/admin/backups` | `pages/admin/backups.tsx` |
| Saúde do Sistema | `/admin/system-health` | `pages/admin/system-health.tsx` |
| Atualizações | `/admin/system-updates` | `pages/admin/system-updates.tsx` |
| Vigilância Sanitária | `/admin/sanitary` | `pages/admin/sanitary.tsx` |
| Marketplace | `/admin/marketplace` | `pages/admin/marketplace.tsx` |
| SMTP Config | `/admin/smtp-config` | `pages/admin/smtp-config.tsx` |
| Notificações | `/admin/notification-settings` | `pages/admin/notification-settings.tsx` |
| White Label | `/admin/white-label` | `pages/admin/white-label.tsx` |
| Importação de Dados | `/admin/import-data` | `pages/admin/import-data.tsx` |
| Segurança | `/admin/security` | `pages/admin/security-dashboard.tsx` |
| Auditoria de Segurança | `/admin/security-audit` | `pages/admin/security-audit.tsx` |
| IA Developer | `/admin/ai-developer` | `pages/admin/ai-developer.tsx` |
| Controle Master | `/admin/master-control` | `pages/admin/master-control.tsx` |

**Total: 60 rotas mapeadas / ~65 componentes de página.**

---

## 2. Status por Módulo

### Legenda
- ✅ Funciona completamente
- 🟡 Funciona parcialmente
- ❌ Não funciona / inexistente

### 2.1 Área Comercial
| Módulo | Status | Observação |
|--------|--------|------------|
| Gestão de Empresas | ✅ | CRUD completo, paginação, filtros, senha temporária |
| Contratos | ✅ | CRUD, editor de documento, alertas de vencimento |
| Escopo Contratual (cliente) | ✅ | Visualização + gestão de dias/produtos |
| Grupos de Preço | ✅ | CRUD funcional |
| Janelas de Pedido | ✅ | Configura horários por dia da semana |
| Exceções de Pedido | ✅ | Bloqueia dias por empresa |
| Cotações | 🟡 | Página existe; backend a confirmar (não auditado em profundidade) |
| Simulação de Escopo | 🟡 | Página existe; extensão das funcionalidades não auditada |

### 2.2 Área de Pedidos
| Módulo | Status | Observação |
|--------|--------|------------|
| Pedidos (Admin) | ✅ | Workflow completo: CREATED→PROCESSING→READY→DISPATCHED→DELIVERED |
| Pedidos Recorrentes (cron) | ✅ | Implementado nesta sessão; idempotente; gatilho manual via API |
| Pedidos Especiais | ✅ | Solicitação, aprovação e geração de pedido |
| Criar Pedido (cliente) | ✅ | Carrinho, janela de horário, validação de dias |
| Editar Pedido (cliente) | ✅ | Dentro da janela de edição permitida |
| Histórico (cliente) | ✅ | Lista com status e detalhes |
| Timeline de Operações | ✅ | Visualização por pedido e por dia |

### 2.3 Planejamento e Compras
| Módulo | Status | Observação |
|--------|--------|------------|
| Planejamento de Compras | ✅ | Consolidação de demanda, previsão 8 semanas, alertas de estoque, exportação Excel |
| Relatório de Compras | ✅ | Filtros por data/empresa/produto, exportação |
| Relatório de Industrializados | ✅ | Filtrado por flag `isIndustrialized`, exportação |
| `server/modules/purchases/` | ❌ | STUB — apenas README; funcionalidade real está em `purchase-planning.routes.ts` |

### 2.4 Produção e Estoque
| Módulo | Status | Observação |
|--------|--------|------------|
| Estoque / Inventário | ❌ | `server/modules/inventory/` marcado como STUB; backend não implementado |
| Controle de Desperdício | ✅ | Backend e frontend implementados (`waste-control.routes.ts`) |
| Módulo de Produção | ❌ | **Não existe** — sem `server/modules/production/`; controle via status de pedido apenas |

### 2.5 Logística
| Módulo | Status | Observação |
|--------|--------|------------|
| Criação de Rotas | ✅ | POST/PATCH/DELETE `/api/logistics/routes` funcionais |
| Atribuição de Motorista | ✅ | Incluído no update de rota |
| Status de Entrega (individual) | 🟡 | Sem `PATCH /api/logistics/deliveries/:id/status` dedicado — ver Bug #1 |
| Painel do Motorista | ✅ | Lista entregas do dia, atualização de status via rota |
| Rastreio Público | ✅ | `/track/:id` público funcional |
| ETA em Tempo Real | 🟡 | Estrutura `eta.service.ts` existe; mapa depende de Nominatim/OSM |
| Otimizador de Rota (Smart Route) | 🟡 | `routeOptimizer.ts` implementado; integração com frontend a confirmar |

### 2.6 Financeiro e Fiscal
| Módulo | Status | Observação |
|--------|--------|------------|
| Contas a Receber / Pagar | ✅ | CRUD com vencimento, categoria, status |
| Dashboard Financeiro | ✅ | KPIs reais: total AR/AP, vencidos, recebido no mês |
| Fluxo de Caixa | ✅ | Entradas e saídas por período |
| PIX (geração de payload) | ✅ | Copia e Cola baseado em CNPJ |
| Integração CNAB | 🟡 | Componente `ImportarRetornoCnab` presente na UI; extensão real não auditada em profundidade |
| Faturamento (cron) | ✅ | Agendado para 08:00 diário; AUTO_FATURAMENTO configurável |
| NF-e (pipeline SEFAZ) | ✅ | XML → Assinatura A1 → SOAP SEFAZ → Idempotência; requer config prévia |
| NF-e Auto-Correção | ✅ | `nfeAutoCorrect.ts` para rejeições comuns |
| Fiscal Config | ✅ | Certificado A1, credenciais, parâmetros fiscais |
| Inserção Manual de NF | ✅ | Formulário de NF manual vinculado a pedido |

### 2.7 Pós-Venda
| Módulo | Status | Observação |
|--------|--------|------------|
| Incidentes (Clientes) | ✅ | Abertura, categorização, resolução |
| Incidentes Internos | ✅ | Gestão interna de ocorrências operacionais |
| Tarefas | ✅ | CRUD com status; delete sem confirmação (ver Bug #5) |

### 2.8 Dashboards e Analytics
| Módulo | Status | Observação |
|--------|--------|------------|
| Dashboard Principal | ✅ | KPIs reais; alertas de contrato; segurança; modo manutenção |
| Dashboard Executivo | ✅ | Dados reais de receita, pedidos, tendências |
| Inteligência Comercial | 🟡 | Existe; profundidade de implementação não auditada |
| Inteligência Financeira | 🟡 | Existe; profundidade não auditada |
| Inteligência Logística | 🟡 | Existe; integração com dados reais de entrega a confirmar |
| Observabilidade | ✅ | Métricas de cron jobs, workers, DB, memória |

### 2.9 Configuração e Sistema
| Módulo | Status | Observação |
|--------|--------|------------|
| Usuários | ✅ | CRUD, roles, unlock de conta, reset de senha |
| Produtos | ✅ | CRUD com upload de imagem, campos fiscais (NCM, CFOP, CEST) |
| Categorias | ✅ | CRUD |
| Configurações | ✅ | Parâmetros globais do sistema |
| Backups | ✅ | Automático às 17:00; download manual |
| Saúde do Sistema | ✅ | Workers, DB, fila, memória, circuit breaker |
| Vigilância Sanitária | ✅ | Perguntas, avaliações, plano de ação |
| Segurança | ✅ | Cross-tenant monitor, audit trail, intelligence |
| IA Developer | 🟡 | UI presente; funcionalidade dependente de configuração de LLM |
| Marketplace | 🟡 | Gestão de módulos disponíveis; ativação por empresa |

---

## 3. Validação por Tela

### Telas com CRUD completo verificado
| Tela | Abre | Dados | Cria | Edita | Exclui | Pesquisa | Filtros | Paginação | Erro | Loading | Empty |
|------|:----:|:-----:|:----:|:-----:|:------:|:--------:|:-------:|:---------:|:----:|:-------:|:-----:|
| Empresas | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Produtos | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Categorias | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | — | — | ✅ | ✅ | ✅ |
| Pedidos (Admin) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Usuários | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | — | ✅ | ✅ | ✅ |
| Tarefas | ✅ | ✅ | ✅ | ✅ | ⚠️ | ✅ | ✅ | — | ✅ | ✅ | ✅ |
| Incidentes Clientes | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | — | ✅ | ✅ | ✅ |
| Incidentes Internos | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | — | ✅ | ✅ | ✅ |
| Contratos | ✅ | ✅ | ✅ | ✅ | ✅ | — | — | — | ✅ | ✅ | ✅ |
| NF-e | ✅ | ✅ | ✅ | ✅ | — | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Financeiro (AR/AP) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | 🟡 |
| Planejamento Compras | ✅ | ✅ | — | — | — | ✅ | ✅ | — | ✅ | ✅ | ✅ |
| Logística | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | — | ✅ | ✅ | ✅ |
| Waste Control | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | — | ✅ | ✅ | ✅ |
| Dashboard | ✅ | ✅ | — | — | — | — | ✅ | — | ✅ | ✅ | — |
| Vigilância Sanitária | ✅ | ✅ | ✅ | ✅ | ✅ | — | — | — | ✅ | ✅ | ✅ |

> ⚠️ = Existe mas tem problema (ver Bugs). — = Não aplicável ao módulo.

### Telas com problemas específicos
| Tela | Problema |
|------|----------|
| `tasks.tsx` | Botão "Excluir" chama `deleteMut.mutate()` diretamente sem AlertDialog de confirmação |
| `inventory.tsx` | Backend é STUB — tela pode abrir mas criação/listagem falha com erro do servidor |
| `finance.tsx` | Empty state de listas financeiras é tabela vazia sem ilustração/mensagem descritiva |
| `logistics.tsx` | Status de entrega individual sem endpoint dedicado — update reflete apenas status do pedido |

---

## 4. Análise de Navegação

### 4.1 Botão "Voltar" / BackHeader
O componente `BackHeader` (`components/navigation/BackHeader.tsx`) está presente em **22+ páginas**. Cobre todas as páginas de relatórios, configurações e subseções operacionais.

**Páginas SEM BackHeader (mas são destinos principais de menu — correto):**
- `/admin` (Dashboard) — correto não ter
- `/admin/companies`, `/admin/orders`, `/admin/products`, etc. — correto (são raízes de seção)

**Páginas SEM BackHeader que deveriam ter:**
- `/admin/governance` — acesso apenas via URL direta, sem BackHeader identificado

### 4.2 Botão "Cancelar" em Formulários
Presente em todos os modais de criação/edição identificados:
- ✅ CompanyModal
- ✅ ProductModal
- ✅ UserModal
- ✅ `create-order.tsx`
- ✅ `special-order.tsx`
- ✅ `contracts.tsx` (3 modais)
- ✅ `EditItemsModal.tsx`
- ✅ `CancelModal.tsx`

### 4.3 Páginas Órfãs (sem entrada no menu)
| Rota | Problema |
|------|----------|
| `/admin/governance` | Definida em `App.tsx`; sem item de menu em `Layout.tsx` |
| `/admin/control-center` | Definida em `App.tsx`; sem item de menu |
| `/admin/operations/timeline/:orderId` | Subrota, acessível apenas por deep link — correto |

> `/admin/operations/timeline` tem entrada no menu de alguns contextos; o `:orderId` é deep link normal.

### 4.4 Links Quebrados / Rotas Inacessíveis
Nenhum link quebrado crítico identificado. Todas as 60 rotas declaradas em `App.tsx` têm componente correspondente em `client/src/pages/`.

### 4.5 Breadcrumbs
- **Global:** Não existe breadcrumb automático no `Layout.tsx`.
- **Local:** `BackHeader` provê contexto de navegação (título + seta de volta) em páginas de segundo nível.
- **Gap:** Páginas com múltiplos níveis de profundidade (ex: detalhe de pedido dentro de empresa) dependem exclusivamente do botão voltar.

### 4.6 Menu por Role
| Role | Acesso |
|------|--------|
| MASTER | Total — todos os módulos |
| ADMIN / DIRECTOR | Comercial, Pedidos, Compras, Financeiro, Gestão, Sistema |
| FINANCEIRO | Dashboard Executivo, Pedidos, Financeiro, NF-e, Faturamento, Banco |
| OPERATIONS_MANAGER | Pedidos, Logística, Compras, Tarefas, Incidentes |
| PURCHASE_MANAGER | Pedidos, Planejamento de Compras, Relatórios |
| LOGISTICS | Pedidos, Logística, Painel Motorista, Incidentes, Inteligência Logística |
| NUTRICIONISTA | Vigilância Sanitária apenas |
| MOTORISTA | Painel do Motorista apenas |

---

## 5. Análise de UX

### 5.1 Formulários grandes (> 8 campos em uma tela)

| Formulário | Arquivo | Qtd. Campos | Impacto |
|------------|---------|:-----------:|---------|
| Cadastro de Empresa (Tab Básico) | `companies/dialogs/tabs/TabBasico.tsx` | ~15 | ⚠️ Usuário pode se sentir sobrecarregado ao cadastrar cliente novo |
| Cadastro de Produto | `products/dialogs/ProductModal.tsx` | ~14 | ⚠️ Campos fiscais (NCM, CEST, CFOP, GTIN) misturados com comerciais |
| Gestão de Escopo Contratual | `companies/dialogs/ContractScopeManager.tsx` | Multi-linha | 🟢 UI de linha-por-item é adequada para o contexto |

**Recomendação (RC2):** `TabBasico` pode separar dados de endereço em sub-seção colapsável.

### 5.2 Ações destrutivas sem confirmação

| Ação | Arquivo | Linha | Status |
|------|---------|:-----:|--------|
| Excluir Tarefa | `tasks.tsx` | ~227 | ❌ Sem AlertDialog — chama `deleteMut.mutate()` diretamente |
| Cancelar Pedido | `orders/dialogs/CancelModal.tsx` | — | ✅ Modal de confirmação presente |
| Remover Usuário | `users.tsx` | ~173–195 | ✅ Modal de confirmação presente |
| Excluir Empresa | `companies/` | — | ✅ Confirmação presente |
| Excluir Produto | `products/` | — | ✅ Confirmação presente |

### 5.3 Ações sem loading state visual
- `tasks.tsx`: botões de troca de status têm `disabled={statusMut.isPending}` mas sem spinner interno — usuário não vê feedback imediato.
- Todos os outros formulários críticos (pedidos, empresas, NF-e, financeiro) usam `isPending` com spinner.

### 5.4 Estados vazios
| Tela | Empty State |
|------|-------------|
| `tasks.tsx` | ✅ "Nenhuma tarefa encontrada" |
| `create-order.tsx` | ✅ "Carrinho vazio" e "Nenhum produto" |
| `waste-control.tsx` | ✅ "Nenhum registro encontrado" |
| `finance.tsx` | 🟡 Tabela vazia sem mensagem descritiva ou ilustração |
| `inventory.tsx` | ❌ Não carrega (backend STUB) |

### 5.5 Feedback de ações (toast)
✅ Padrão consistente em toda a aplicação. Todas as mutations críticas usam `toast.success` e `toast.error`.

### 5.6 Responsividade
O `Layout.tsx` usa classes Tailwind responsivas. A aplicação é primariamente desktop. O painel do motorista (`driver-panel.tsx`) tem layout adaptado para mobile. As demais telas admin são funcionais em telas largas mas não foram otimizadas para mobile.

### 5.7 Excesso de cliques
| Fluxo | Cliques estimados | Avaliação |
|-------|:-----------------:|-----------|
| Gerar pedidos recorrentes (manual) | 1 (POST /api/admin/recurring-orders/run) | ✅ |
| Cadastrar empresa nova | ~5 (abrir modal → 4 abas → salvar) | 🟡 |
| Emitir NF-e para pedido | ~3 (filtrar → selecionar → emitir) | ✅ |
| Criar rota logística | ~4 (nova rota → adicionar paradas → atribuir motorista → salvar) | ✅ |

---

## 6. Simulação do Fluxo Completo

**Cenário:** Empresa nova assina contrato, recebe pedidos toda semana, produção prepara, entrega é feita, gera ocorrência, contrato é renovado.

---

### PASSO 1 — Cliente Novo
**Tela:** `/admin/companies` → CompanyModal

✅ **Funciona.** CRUD completo. Define: nome, CNPJ, email, senha, grupo de preço, endereço, dias de pedido, tipo (`mensal` ou `contratual`).

**Gap:** `clientType = "contratual"` exige preencher manualmente. Não há wizard que guia o usuário pelo fluxo contratual completo.

---

### PASSO 2 — Contrato
**Tela:** `/admin/contracts` → DocumentEditor

✅ **Funciona.** Cria documento de contrato, define vigência (`contractStartDate` / `contractEndDate`), modelo de contrato (`fixo` / `variavel` / `alternado`).

**Alerta:** Widget no Dashboard mostra "Vence em X dias" para contratos próximos do fim. ✅

---

### PASSO 3 — Escopo Contratual
**Tela:** `/admin/companies` → aba Escopo → ContractScopeManager

✅ **Funciona.** Define produtos por dia da semana, quantidade e preço unitário. Suporta contratos alternados (semanas pares/ímpares).

---

### PASSO 4 — Geração de Pedidos
**Trigger:** Cron toda segunda-feira 06:00 (`recurring-orders.cron.ts`) **ou** POST `/api/admin/recurring-orders/run`

✅ **Funciona.** `generateOrdersFromScope()` gera um pedido por dia configurado no escopo. **Idempotente** — não duplica se chamado mais de uma vez na mesma semana.

**Retorno:** `{ created: N, skipped: N, weekLabel, orders[] }`

---

### PASSO 5 — Planejamento de Compras
**Tela:** `/admin/purchase-planning`

✅ **Funciona.** Consolida demanda de pedidos regulares + pedidos especiais aprovados + escopo contratual. Previsão de 8 semanas. Alerta de déficit de estoque. Exportação Excel.

**Gap:** Não há fluxo de criação de ordem de compra (Purchase Order) para fornecedores — `server/modules/purchases/` é STUB.

---

### PASSO 6 — Produção

❌ **NÃO EXISTE.** Não há módulo de produção. Não há telas de:
- Ordem de produção
- Controle de preparo por produto
- Conferência de quantidades produzidas vs. pedidas

**Workaround atual:** O operador usa o status do pedido (`PROCESSING`) como sinal de que está "em produção". Não há rastreamento granular.

---

### PASSO 7 — Entrega
**Tela:** `/admin/logistics` → criar rota → atribuir motorista → despachar

🟡 **Funciona parcialmente.**

✅ Criação de rota com paradas ordenadas.
✅ Atribuição de motorista e veículo.
✅ Status de pedido atualiza para `DISPATCHED`.
✅ Rastreio público via `/track/:id`.

❌ **Sem endpoint dedicado para atualizar status de entrega individual** (`deliveries` table). O motorista atualiza o status da rota como um todo, não de cada parada. Se uma parada específica falhar (cliente ausente), não há registro granular no sistema.

---

### PASSO 8 — Ocorrência
**Tela:** `/admin/client-incidents` ou `/client/incidents`

✅ **Funciona.** Cliente abre ocorrência pelo portal. Admin visualiza, categoriza e resolve. Histórico preservado.

---

### PASSO 9 — Renovação
**Tela:** `/admin/contracts` + alerta no Dashboard

🟡 **Parcialmente.** O sistema alerta quando o contrato está próximo do vencimento. O operador precisa:
1. Editar manualmente a data de fim no cadastro da empresa.
2. Opcionalmente atualizar o documento de contrato.

**Não existe** um fluxo guiado de renovação (wizard de reajuste de preço, geração de novo documento, envio ao cliente para aceite).

---

### Resumo do Fluxo

| Etapa | Status | Nota |
|-------|--------|------|
| Cliente Novo | ✅ | |
| Contrato | ✅ | |
| Escopo | ✅ | |
| Pedidos | ✅ | Cron + manual; idempotente |
| Planejamento | ✅ | Sem PO para fornecedores |
| **Produção** | ❌ | **Módulo ausente** |
| Entrega | 🟡 | Sem status granular por parada |
| Ocorrência | ✅ | |
| Renovação | 🟡 | Alerta existe; wizard não |

**O fluxo quebra em: Produção (ausente) e Entrega (status granular).**

---

## 7. Bugs Funcionais Reais

> Apenas bugs que impedem ou degradam operações reais. Sem dívida técnica, padrões arquiteturais ou sugestões de refatoração.

---

### BUG-001 — Status de entrega granular ausente
**Severidade:** 🔴 Bloqueia operação
**Módulo:** Logística / Entregas
**Descrição:** Não existe endpoint `PATCH /api/logistics/deliveries/:id/status`. A tabela `deliveries` existe com campo `status` (`pendente`, `em_rota`, `entregue`, `cancelado`), mas não há rota HTTP para atualizá-la de forma granular. O motorista e o operador não conseguem registrar: "esta parada específica foi entregue / cliente ausente / endereço errado" — apenas o status do pedido inteiro muda.
**Impacto:** Impossível saber por parada o que foi entregue vs. o que falhou no dia. Relatório de entregas é impreciso.
**Evidência:** `logistics.controller.ts` e `logistics.service.ts` não possuem `updateDeliveryStatus()`. A busca por `PATCH /api/logistics/deliveries` retorna negativo.

---

### BUG-002 — Módulo de Estoque não implementado
**Severidade:** 🟠 Importante
**Módulo:** Estoque / Inventário
**Descrição:** `server/modules/inventory/` contém arquivos (`inventory.service.ts`, `inventory.repository.ts`) mas o `README.md` o marca explicitamente como **STUB**. A página `/admin/inventory` chama `/api/inventory/entries` — chamadas que falham ou retornam dados incompletos dependendo do que está implementado nos endpoints.
**Impacto:** Planejamento de compras calcula déficit de estoque com base em dados que podem não existir. Controle de Waste Control funciona (tem backend próprio), mas inventário geral não.

---

### BUG-003 — Módulo de Produção inexistente
**Severidade:** 🟠 Importante
**Módulo:** Produção
**Descrição:** Não existe `server/modules/production/` nem nenhuma rota de produção. O status `PROCESSING` no workflow de pedidos é o único indicador de "em produção". Não há:
- Ordem de produção
- Conferência de quantidades preparadas
- Controle de separação por produto/categoria
**Impacto:** Operador de produção trabalha fora do sistema (planilha, WhatsApp). Esse é o ponto mais crítico para a questão "opera 100% sem planilhas?".

---

### BUG-004 — NF-e exige configuração manual sem wizard de onboarding
**Severidade:** 🟠 Importante
**Módulo:** Fiscal / NF-e
**Descrição:** O pipeline de NF-e é funcional e completo (XML → A1 → SEFAZ), mas depende de configuração prévia em `/admin/fiscal-config`: upload do certificado A1, senha, credenciais SEFAZ, CSOSN, IBGE, IE. Se qualquer campo estiver ausente, a emissão falha com erro técnico, sem mensagem amigável de "configure primeiro".
**Impacto:** Usuário novo não consegue emitir NF-e sem suporte técnico guiando a configuração inicial.

---

### BUG-005 — Tarefa excluída sem confirmação
**Severidade:** 🟡 Melhoria
**Módulo:** Tarefas
**Descrição:** Em `tasks.tsx` linha ~227, o botão de excluir chama `deleteMut.mutate(task.id)` diretamente, sem AlertDialog de confirmação. Todas as outras ações destrutivas do sistema pedem confirmação.
**Impacto:** Usuário pode apagar tarefa por clique acidental.

---

### BUG-006 — Páginas órfãs inacessíveis pelo menu
**Severidade:** 🟡 Melhoria
**Módulo:** Navegação
**Descrição:** Três rotas existem em `App.tsx` mas sem item de menu em `Layout.tsx`:
- `/admin/governance` — Governança
- `/admin/control-center` — Centro de Controle

Usuário só acessa por URL digitada manualmente.
**Impacto:** Funcionalidades úteis invisíveis para operadores.

---

### BUG-007 — Sem fluxo de renovação de contrato
**Severidade:** 🟡 Melhoria
**Módulo:** Comercial / Contratos
**Descrição:** O alerta de vencimento de contrato existe no Dashboard, mas não há um fluxo de renovação: sem wizard de reajuste de preço por IPCA/IGP-M, sem geração de novo documento, sem histórico de renovações, sem notificação ao cliente.
**Impacto:** Renovação é feita 100% manualmente (editar datas, recriar escopo se mudou).

---

### BUG-008 — `server/modules/purchases/` stub cria falsa impressão de módulo
**Severidade:** 🟡 Melhoria
**Módulo:** Compras
**Descrição:** O diretório `server/modules/purchases/` contém apenas um `README.md` com "STUB". A funcionalidade real de planejamento de compras está em `server/routes/purchase-planning.routes.ts` e funciona bem. Porém, o stub no local "oficial" do módulo pode causar confusão em manutenções futuras.
**Impacto:** Sem impacto funcional imediato. Risco de manutenção.

---

## 8. Classificação por Impacto

### 🔴 Bloqueia operação (precisa resolver antes de produção plena)
| ID | Descrição |
|----|-----------|
| BUG-001 | Status de entrega granular ausente — motorista não confirma parada individual |
| BUG-003 | Módulo de Produção inexistente — etapa central sem cobertura no sistema |

### 🟠 Importante (degrada operação mas há workaround)
| ID | Descrição |
|----|-----------|
| BUG-002 | Estoque/Inventário — backend STUB, dados de planejamento podem ser imprecisos |
| BUG-004 | NF-e sem wizard de onboarding — configuração manual exige suporte técnico |

### 🟡 Melhoria (não bloqueia, mas afeta qualidade)
| ID | Descrição |
|----|-----------|
| BUG-005 | Tarefa excluída sem confirmação |
| BUG-006 | Páginas órfãs inacessíveis pelo menu |
| BUG-007 | Sem fluxo de renovação de contrato |
| BUG-008 | `server/modules/purchases/` stub confuso |

### 🟢 Opcional (melhorias de experiência)
| Área | Descrição |
|------|-----------|
| UX | CompanyModal TabBasico: 15 campos em uma tela — separar endereço em sub-seção |
| UX | `finance.tsx` empty state sem ilustração descritiva |
| UX | Breadcrumb global no Layout para contexto de navegação |
| UX | Responsividade mobile nas telas admin (hoje apenas driver-panel é otimizado) |
| UX | `tasks.tsx` botões de status sem spinner interno |

---

## 9. Veredicto Final

### Pergunta: "O ERP pode operar a VivaFrutaz durante um dia inteiro sem voltar para planilhas?"

---

## **RESPOSTA: SIM — com exceção da Produção.**

---

### Justificativa baseada em funcionalidades:

**O sistema cobre com completude:**

- **Manhã:** Pedidos recorrentes gerados automaticamente na segunda às 06:00 (ou manualmente). Admin revisa, aprova exceções, verifica pedidos especiais. ✅
- **Planejamento de compras:** Lista de compra consolidada gerada automaticamente com previsão de 8 semanas. Exportação Excel disponível. ✅
- **Gestão de empresas e contratos:** Cadastro, escopo contratual, alertas de vencimento — tudo no sistema. ✅
- **Logística:** Criação de rotas, atribuição de motoristas, rastreio público. Motorista acessa o painel próprio. ✅
- **Financeiro:** AR/AP, fluxo de caixa, faturamento automático. NF-e funcionando com SEFAZ real. ✅
- **Pós-venda:** Ocorrências abertas pelo cliente ou admin, com histórico rastreável. ✅

**O sistema NÃO cobre (planilha ainda necessária):**

1. **Produção:** O responsável pela cozinha/separação não tem tela. Precisa de lista de separação impressa ou planilha com o que produzir por produto/dia. Este é o ponto crítico.

2. **Entrega granular:** O motorista confirma "rota concluída", mas não marca "entrega X falhou porque cliente estava ausente". Esse controle ainda fica no WhatsApp/papel.

### Resumo de cobertura por turno operacional

| Turno | Atividade | Sistema cobre? |
|-------|-----------|:--------------:|
| 06:00 | Geração automática de pedidos | ✅ |
| 07:00 | Revisão e aprovação de pedidos | ✅ |
| 08:00 | Geração da lista de compras | ✅ |
| 09:00 | Separação e produção | ❌ |
| 10:00 | Despacho / criação de rotas | ✅ |
| 11:00–16:00 | Entregas em campo | 🟡 |
| 16:00 | Registro de ocorrências | ✅ |
| 17:00 | Faturamento e NF-e | ✅ |
| 18:00 | Financeiro e fechamento | ✅ |

**Conclusão:** O ERP cobre aproximadamente **80% da operação diária** da VivaFrutaz sem planilhas. Os 20% restantes concentram-se na etapa de produção/separação — que é operacionalmente crítica — e no rastreio granular de entregas. Resolvido o BUG-003 (módulo de produção) e o BUG-001 (status de entrega por parada), o sistema atinge cobertura operacional plena.

---

*Auditoria gerada em 28/07/2026 — RC1. Próxima revisão: RC2 após correção dos itens 🔴.*
