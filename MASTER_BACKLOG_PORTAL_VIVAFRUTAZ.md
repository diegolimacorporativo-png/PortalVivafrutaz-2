# MASTER BACKLOG — PORTAL VIVAFRUTAZ ERP
## VERSÃO 1.0 | Julho 2026
### Product Owner | Baseado nos documentos: AUDITORIA, AUDITORIA_FUNCIONAL, AUDITORIA_PRODUTO, GAP_MAP, PLANO_DIRETOR

> **Premissa:** Nenhuma funcionalidade nova foi inventada. Cada item deste backlog está fundamentado em evidências das auditorias e no escopo aprovado pelo Plano Diretor V1.
> **Módulos congelados:** NF-e · SEFAZ · PIX · Boletos · CNAB · Billing · SaaS · Marketplace · White-label — nenhum item destes módulos aparece neste backlog.

---

## LEGENDA

| Campo | Valores possíveis |
|---|---|
| **Prioridade** | 🔴 P0 Crítico · 🟠 P1 Alto · 🟡 P2 Médio · 🟢 P3 Baixo |
| **Fase** | F1 (0–90 dias) · F2 (90–180 dias) · F3 (180–270 dias) · F4 (270–360 dias) |
| **Complexidade** | XS (<1d) · S (1–2d) · M (3–5d) · L (1–2 sem) · XL (2–4 sem) |
| **Status** | 🔴 Não iniciado · 🟡 Em andamento · 🟢 Concluído · ⚫ Bloqueado |
| **Elimina** | ✂️Excel · 📱WhatsApp · 📄Papel · 🔁Retrabalho · 🖥️UX |

---

## ÍNDICE DE ÉPICOS

| ID | Épico | Fase | Prioridade |
|---|---|---|---|
| EP-01 | Segurança e Fundação Técnica | F1 | 🔴 P0 |
| EP-02 | Navegação e Módulos Congelados | F1 | 🔴 P0 |
| EP-03 | Comercial e CRM | F1/F2 | 🟠 P1 |
| EP-04 | Contratos e Clientes | F1/F2 | 🟠 P1 |
| EP-05 | Pedidos | F1/F2 | 🔴 P0 |
| EP-06 | Planejamento e Compras | F1/F2 | 🟠 P1 |
| EP-07 | Produção e Separação | F1 | 🔴 P0 |
| EP-08 | Conferência de Carga | F1 | 🔴 P0 |
| EP-09 | Logística e Entregas | F1/F2 | 🔴 P0 |
| EP-10 | Painel do Motorista | F1 | 🔴 P0 |
| EP-11 | Dashboard Operacional | F1/F2 | 🟠 P1 |
| EP-12 | Portal do Cliente | F3 | 🟠 P1 |
| EP-13 | Clara IA | F2/F4 | 🟡 P2 |
| EP-14 | Academy | F2 | 🟡 P2 |

---

---

# EP-01 — SEGURANÇA E FUNDAÇÃO TÉCNICA

**Objetivo:** Corrigir vulnerabilidades críticas identificadas na auditoria de segurança e consolidar a fundação técnica antes de qualquer desenvolvimento funcional.
**Gap resolvido:** ADR-007 · Auditoria de Segurança
**Fase:** F1 (pré-requisito de tudo)

---

## FT-01.01 — Remoção de Senha MASTER Hardcoded

**ID:** FT-01.01
**Objetivo:** Eliminar a senha `Master@2026!` hardcoded em `server/routes/routes.ts:3560`
**Problema que resolve:** Senha comprometida no repositório permite acesso total ao sistema por qualquer pessoa com acesso ao código
**Módulos:** server/routes/routes.ts · Banco de dados Supabase
**Critério de aceite:** Nenhuma senha em texto plano no código; seed usa variável de ambiente; credencial rotacionada no banco
**Prioridade:** 🔴 P0
**Complexidade:** S
**Dependências:** Nenhuma
**Estimativa:** 1 dia
**Status:** 🔴 Não iniciado
**Elimina:** — (segurança)

### US-01.01.01 — Rotação da credencial MASTER

**Como** MASTER do sistema
**Quero** que a senha padrão do usuário master seja gerada de forma segura e armazenada apenas no banco
**Para** eliminar o risco de acesso indevido via código exposto

**Critério de aceite:**
- [ ] Senha `Master@2026!` não existe em nenhum arquivo `.ts` do repositório
- [ ] Novo valor da senha está como secret (`MASTER_SEED_PASSWORD`) no ambiente
- [ ] Seed function lê `process.env.MASTER_SEED_PASSWORD` com fallback de geração aleatória segura
- [ ] Credencial rotacionada manualmente no Supabase antes do deploy
- [ ] Log de auditoria registra a rotação

**Prioridade:** 🔴 P0 | **Complexidade:** XS | **Estimativa:** 4h | **Status:** 🔴 Não iniciado

#### TK-01.01.01.01
**Título:** Remover senha hardcoded do seed em routes.ts
**Ação:** Substituir `password: "Master@2026!"` por `password: process.env.MASTER_SEED_PASSWORD ?? generateSecurePassword()`
**Arquivo:** server/routes/routes.ts ~linha 3560

#### TK-01.01.01.02
**Título:** Criar secret MASTER_SEED_PASSWORD no ambiente
**Ação:** Registrar secret via ferramenta de gestão de secrets do Replit
**Arquivo:** Ambiente (não código)

#### TK-01.01.01.03
**Título:** Rotacionar credencial no banco Supabase
**Ação:** Executar `UPDATE users SET password = [hash_nova_senha] WHERE email = 'master@vivafrutaz.com'` com nova senha forte
**Arquivo:** SQL / Supabase console

#### TK-01.01.01.04
**Título:** Verificar ausência de outras senhas hardcoded
**Ação:** `grep -rn "password.*=.*\"" server/ --include="*.ts"` e revisar todos os resultados
**Arquivo:** Varredura geral

---

## FT-01.02 — Proteção de Endpoints Públicos de Métricas

**ID:** FT-01.02
**Objetivo:** Adicionar autenticação aos endpoints `/api/nfe/dry-run/metrics` e `/api/nfe/dry-run/metrics/window` que estão públicos
**Problema que resolve:** Dados internos de operação NF-e expostos sem autenticação
**Módulos:** server/routes/routes.ts
**Critério de aceite:** Ambos os endpoints retornam 401 sem sessão válida
**Prioridade:** 🔴 P0
**Complexidade:** XS
**Dependências:** Nenhuma
**Estimativa:** 2h
**Status:** 🔴 Não iniciado

### US-01.02.01 — Proteger rotas de métricas internas

**Como** MASTER
**Quero** que as métricas de dry-run de NF-e exijam autenticação
**Para** não expor dados operacionais internos a usuários anônimos

**Critério de aceite:**
- [ ] GET `/api/nfe/dry-run/metrics` retorna 401 sem sessão
- [ ] GET `/api/nfe/dry-run/metrics/window` retorna 401 sem sessão
- [ ] Com sessão MASTER, ambos retornam 200

**Prioridade:** 🔴 P0 | **Complexidade:** XS | **Estimativa:** 2h | **Status:** 🔴 Não iniciado

#### TK-01.02.01.01
**Título:** Adicionar requireAuthCore às rotas de métricas dry-run
**Ação:** Inserir middleware `requireAuthCore` nos dois handlers em routes.ts (~linhas 1881–1903)

---

## FT-01.03 — Unificação de Middlewares de Autenticação

**ID:** FT-01.03
**Objetivo:** Consolidar `server/shared/middlewares/authenticate.ts` e `server/core/http/requireAuth.ts` em um único ponto canônico
**Problema que resolve:** Dois middlewares paralelos criam risco de acesso indevido se o middleware errado for usado em uma rota
**Módulos:** server/shared/middlewares/ · server/core/http/
**Critério de aceite:** Um único módulo de autenticação; todos os imports apontam para ele; testes passam
**Prioridade:** 🔴 P0
**Complexidade:** M
**Dependências:** Nenhuma
**Estimativa:** 3 dias
**Status:** 🔴 Não iniciado

### US-01.03.01 — Definir e aplicar middleware canônico

**Como** desenvolvedor
**Quero** um único middleware de autenticação usado em todas as rotas
**Para** eliminar inconsistências silenciosas de segurança

**Critério de aceite:**
- [ ] `requireAuthCore` de `server/core/http/requireAuth.ts` é o único middleware de autenticação
- [ ] `authenticate.ts` legado removido ou reduzido a re-export
- [ ] Nenhuma rota usa o middleware antigo diretamente
- [ ] Nenhum teste de segurança quebra após a mudança

**Prioridade:** 🔴 P0 | **Complexidade:** M | **Estimativa:** 3 dias | **Status:** 🔴 Não iniciado

#### TK-01.03.01.01
**Título:** Mapear todos os usos de authenticate.ts vs requireAuth.ts
**Ação:** `grep -rn "authenticate\|requireAuth\|requireAuthCore" server/ --include="*.ts"` e listar diferenças de comportamento

#### TK-01.03.01.02
**Título:** Padronizar todos os imports para requireAuthCore
**Ação:** Substituir todas as referências ao middleware legado pelo canônico

#### TK-01.03.01.03
**Título:** Marcar authenticate.ts como deprecated
**Ação:** Adicionar JSDoc `@deprecated` e re-exportar requireAuthCore

#### TK-01.03.01.04
**Título:** Rodar bateria de testes de segurança após mudança
**Ação:** `npm test -- tenantGuard` e verificar rotas críticas com curl

---

## FT-01.04 — Migração da Memória Clara IA para Banco de Dados

**ID:** FT-01.04
**Objetivo:** Migrar `server/services/memoryModule.ts` de array em memória para tabela `ai_interactions` já existente no banco
**Problema que resolve:** Clara IA perde todo o histórico de conversas a cada restart do servidor
**Módulos:** server/services/memoryModule.ts · tabela ai_interactions
**Critério de aceite:** Histórico de Clara persiste após restart; array em memória não é mais usado
**Prioridade:** 🟠 P1
**Complexidade:** M
**Dependências:** FT-01.03 (autenticação estável)
**Estimativa:** 3 dias
**Status:** 🔴 Não iniciado
**Elimina:** 🔁 Retrabalho (usuário perde contexto)

### US-01.04.01 — Persistir histórico de conversa da Clara

**Como** usuário interno
**Quero** que a Clara lembre do que conversamos na última sessão
**Para** não precisar repetir contexto a cada conversa

**Critério de aceite:**
- [ ] Mensagens de Clara são salvas na tabela `ai_interactions`
- [ ] Ao abrir nova conversa, Clara recupera as últimas N interações do banco
- [ ] Restart do servidor não apaga histórico
- [ ] Array em memória não é mais fonte primária de contexto

**Prioridade:** 🟠 P1 | **Complexidade:** M | **Estimativa:** 3 dias | **Status:** 🔴 Não iniciado

#### TK-01.04.01.01
**Título:** Inspecionar schema de ai_interactions
**Ação:** Verificar campos da tabela e confirmar se comporta mensagens por usuário e tenant

#### TK-01.04.01.02
**Título:** Adaptar memoryModule.ts para gravar em ai_interactions
**Ação:** Substituir push no array por INSERT em ai_interactions; manter interface pública

#### TK-01.04.01.03
**Título:** Adaptar leitura de histórico para SELECT em ai_interactions
**Ação:** `SELECT * FROM ai_interactions WHERE user_id = ? ORDER BY created_at DESC LIMIT 20`

#### TK-01.04.01.04
**Título:** Remover array em memória como fonte de dados
**Ação:** Garantir que memoryModule.ts não mantém estado entre requests

---

---

# EP-02 — NAVEGAÇÃO E MÓDULOS CONGELADOS

**Objetivo:** Ocultar todos os módulos congelados e SaaS da navegação lateral, simplificando a experiência do usuário operacional.
**Gap resolvido:** Auditoria de Produto · ADR-001 · ADR-002
**Fase:** F1 (pré-requisito de adoção)

---

## FT-02.01 — Ocultar Módulos Congelados da Sidebar

**ID:** FT-02.01
**Objetivo:** Remover do menu lateral os itens de NF-e, Faturamento, SaaS, Marketplace, White-label, AI Developer para todos os perfis exceto MASTER
**Problema que resolve:** Menu confuso com >50 itens, muitos irrelevantes para o usuário operacional
**Módulos:** client/src/components/Layout.tsx · client/src/App.tsx
**Critério de aceite:** Usuário com perfil não-MASTER não vê módulos congelados; MASTER acessa por URL direta ou menu "Sistema"
**Prioridade:** 🔴 P0
**Complexidade:** M
**Dependências:** Nenhuma
**Estimativa:** 3 dias
**Status:** 🔴 Não iniciado
**Elimina:** 🖥️ UX

### US-02.01.01 — Sidebar limpa para usuários operacionais

**Como** usuário com perfil ADMIN/OPERATOR/LOGISTICS
**Quero** ver apenas os módulos relevantes para minha função
**Para** encontrar rapidamente o que preciso sem navegar por dezenas de itens irrelevantes

**Critério de aceite:**
- [ ] Sidebar não exibe: NF-e, Faturamento, Fiscal, SaaS Dashboard, SaaS Financeiro, Marketplace, White-label, AI Developer, Diagnóstico Fiscal para não-MASTER
- [ ] MASTER e DEVELOPER têm acesso via seção "Sistema Avançado" no rodapé da sidebar
- [ ] Agrupamentos da sidebar refletem o fluxo operacional (Comercial / Pedidos / Operação / Logística / Inteligência / Sistema)
- [ ] Rota direta para módulo congelado redireciona para /admin se perfil não autorizado

**Prioridade:** 🔴 P0 | **Complexidade:** M | **Estimativa:** 3 dias | **Status:** 🔴 Não iniciado

#### TK-02.01.01.01
**Título:** Mapear todos os itens de menu e seu requisito de visibilidade por role
**Ação:** Criar constante `FROZEN_MODULE_ROUTES` e `ADVANCED_MODULE_ROUTES` com lista de rotas por categoria

#### TK-02.01.01.02
**Título:** Implementar lógica de filtragem de menu por role em Layout.tsx
**Ação:** `menuItems.filter(item => !FROZEN_MODULE_ROUTES.includes(item.path) || user.role === 'MASTER')`

#### TK-02.01.01.03
**Título:** Criar seção "Sistema Avançado" colapsável no rodapé da sidebar para MASTER/DEVELOPER
**Ação:** Accordion com módulos congelados visível apenas para roles autorizados

#### TK-02.01.01.04
**Título:** Reorganizar agrupamentos da sidebar seguindo fluxo operacional do Plano Diretor
**Ação:** Reordenar e renomear grupos: Comercial · Pedidos · Operação · Logística · Inteligência · Sistema

#### TK-02.01.01.05
**Título:** Adicionar guard de rota para módulos congelados
**Ação:** HOC `<FrozenModuleGuard>` que redireciona para /admin se role não autorizado

---

## FT-02.02 — Remoção de Arquivos Mortos

**ID:** FT-02.02
**Objetivo:** Remover `test-clara.tsx`, `tmp_migrations.js` e arquivos históricos sem valor
**Problema que resolve:** Confusão no codebase, risco de uso acidental de página mock em produção
**Módulos:** client/src/pages/test-clara.tsx · tmp_migrations.js
**Critério de aceite:** Arquivos removidos; nenhuma referência pendente no App.tsx
**Prioridade:** 🟠 P1
**Complexidade:** XS
**Dependências:** Nenhuma
**Estimativa:** 4h
**Status:** 🔴 Não iniciado

### US-02.02.01 — Limpar arquivos desnecessários do repositório

**Como** desenvolvedor
**Quero** que o repositório contenha apenas código relevante
**Para** evitar confusão durante manutenção e garantir que páginas mock não estejam acessíveis

**Critério de aceite:**
- [ ] `test-clara.tsx` removido; rota `/test-clara` retorna 404
- [ ] `tmp_migrations.js` removido da raiz
- [ ] Nenhuma referência a esses arquivos em App.tsx ou qualquer importação

**Prioridade:** 🟠 P1 | **Complexidade:** XS | **Estimativa:** 4h | **Status:** 🔴 Não iniciado

#### TK-02.02.01.01
**Título:** Remover test-clara.tsx e sua rota em App.tsx

#### TK-02.02.01.02
**Título:** Remover tmp_migrations.js da raiz

#### TK-02.02.01.03
**Título:** Mover playwright e ngrok para devDependencies em package.json

---

---

# EP-03 — COMERCIAL E CRM

**Objetivo:** Fortalecer o ciclo comercial, eliminando negociações de preço e cotações gerenciadas fora do sistema.
**Gap resolvido:** GAP-012 (Precificação sazonal em lote) · S-07 (pedidos fora da janela)
**Fase:** F1/F2

---

## FT-03.01 — Atualização de Preço Sazonal em Lote

**ID:** FT-03.01
**Objetivo:** Permitir atualização em lote de preços de produtos por categoria, eliminando a necessidade de atualizar produto a produto
**Problema que resolve:** GAP-012 — Admin perde 1–3h/semana atualizando preços de FLV individualmente quando há variação sazonal
**Módulos:** admin/products.tsx · admin/price-groups.tsx · server/modules/products/
**Critério de aceite:** Admin seleciona múltiplos produtos/categorias e aplica variação percentual ou valor fixo em lote
**Prioridade:** 🟠 P1
**Complexidade:** M
**Dependências:** Nenhuma
**Estimativa:** 4 dias
**Status:** 🔴 Não iniciado
**Elimina:** ✂️Excel · 🔁Retrabalho

### US-03.01.01 — Atualizar preços em lote por categoria

**Como** ADMIN ou OPERATIONS_MANAGER
**Quero** selecionar uma categoria de produto (ex: "Frutas") e aplicar um ajuste de +X% a todos os itens
**Para** não precisar abrir e salvar cada produto individualmente quando os preços de FLV mudam sazonalmente

**Critério de aceite:**
- [ ] Tela de produtos tem opção "Atualização em Lote"
- [ ] Admin seleciona: Categoria · Subcategoria · ou Produto específico
- [ ] Admin define: ajuste percentual (%) ou valor absoluto (R$)
- [ ] Preview mostra preço atual vs novo antes de confirmar
- [ ] Atualização é atômica — todos ou nenhum
- [ ] Log de auditoria registra quem alterou, quando e quais produtos

**Prioridade:** 🟠 P1 | **Complexidade:** M | **Estimativa:** 4 dias | **Status:** 🔴 Não iniciado

#### TK-03.01.01.01
**Título:** Criar endpoint `POST /api/products/bulk-price-update`
**Ação:** Aceita `{ categoryId?, productIds[], adjustment: { type: 'percent'|'fixed', value: number } }` e aplica em transação

#### TK-03.01.01.02
**Título:** Adicionar UI de seleção em lote na tela de produtos
**Ação:** Checkboxes em DataTable + painel de ação "Atualizar Preço"

#### TK-03.01.01.03
**Título:** Implementar preview de preços antes de confirmar
**Ação:** Modal com tabela: Produto | Preço Atual | Preço Novo | Diferença

#### TK-03.01.01.04
**Título:** Registrar evento de auditoria da atualização em lote
**Ação:** INSERT em audit_logs com payload completo de produtos alterados

---

## FT-03.02 — Conversão de Cotação em Contrato

**ID:** FT-03.02
**Objetivo:** Permitir que uma cotação aprovada seja convertida diretamente em contrato, sem redigitação de dados
**Problema que resolve:** Vendedor cria cotação, cliente aprova por WhatsApp, admin precisa criar contrato do zero novamente
**Módulos:** admin/quotations.tsx · admin/contracts.tsx · server/routes/
**Critério de aceite:** Botão "Converter em Contrato" na cotação aprovada; contrato pré-populado com dados da cotação
**Prioridade:** 🟡 P2
**Complexidade:** M
**Dependências:** FT-04.01 (Contratos estável)
**Estimativa:** 4 dias
**Status:** 🔴 Não iniciado
**Elimina:** 🔁Retrabalho · 📱WhatsApp

### US-03.02.01 — Converter cotação aprovada em contrato

**Como** ADMIN ou SALES
**Quero** clicar em "Converter em Contrato" na cotação aprovada
**Para** não precisar redigitar todos os itens e preços no módulo de contratos

**Critério de aceite:**
- [ ] Cotação com status "aprovada" exibe botão "Converter em Contrato"
- [ ] Ao clicar, abre formulário de contrato pré-preenchido com: empresa, grupo de preço, itens e valores da cotação
- [ ] Admin complementa apenas dados contratuais (vigência, cláusulas, reajuste)
- [ ] Cotação passa para status "contratada" após conversão
- [ ] Contrato gerado vincula referência à cotação de origem

**Prioridade:** 🟡 P2 | **Complexidade:** M | **Estimativa:** 4 dias | **Status:** 🔴 Não iniciado

#### TK-03.02.01.01
**Título:** Criar endpoint `POST /api/contracts/from-quotation/:quotationId`
**Ação:** Lê dados da cotação e cria rascunho de contrato; retorna ID do contrato criado

#### TK-03.02.01.02
**Título:** Adicionar botão "Converter em Contrato" em quotations.tsx
**Ação:** Visível apenas para cotações com status "aprovada"; navega para /admin/contracts/new?fromQuotation=:id

#### TK-03.02.01.03
**Título:** Pré-popular formulário de contrato com dados da cotação
**Ação:** useEffect lê query param `fromQuotation` e carrega dados via API

---

---

# EP-04 — CONTRATOS E CLIENTES

**Objetivo:** Fechar o ciclo de vida do contrato dentro do sistema, eliminando a dependência de planilha paralela para acompanhamento de vencimentos e renovações.
**Gap resolvido:** GAP-014 (IPCA automático) · S-11 (Excel para contratos)
**Fase:** F1/F2

---

## FT-04.01 — Alertas Automáticos de Vencimento de Contrato

**ID:** FT-04.01
**Objetivo:** Disparar alertas automáticos (e-mail + notificação in-app) quando contrato estiver próximo ao vencimento
**Problema que resolve:** Renovações perdidas por falta de acompanhamento; admin descobre vencimento tarde
**Módulos:** admin/contracts.tsx · server/jobs/ · sistema de notificações
**Critério de aceite:** Alerta disparado com 60, 30 e 15 dias de antecedência para contratos com prazo definido
**Prioridade:** 🔴 P0
**Complexidade:** M
**Dependências:** SMTP configurado
**Estimativa:** 4 dias
**Status:** 🔴 Não iniciado
**Elimina:** ✂️Excel · 🔁Retrabalho

### US-04.01.01 — Receber alerta de contrato próximo ao vencimento

**Como** ADMIN ou OPERATIONS_MANAGER
**Quero** receber uma notificação automática quando um contrato estiver próximo ao vencimento
**Para** não perder o prazo de renovação e manter a receita

**Critério de aceite:**
- [ ] Cron job diário verifica contratos com data_fim nos próximos 60, 30 e 15 dias
- [ ] Notificação in-app aparece no Dashboard e no módulo de Contratos
- [ ] E-mail enviado para ADMIN e DIRECTOR com lista de contratos a vencer
- [ ] Contrato já expirado aparece como alerta vermelho no Dashboard
- [ ] Notificação não se repete para o mesmo contrato no mesmo dia

**Prioridade:** 🔴 P0 | **Complexidade:** M | **Estimativa:** 4 dias | **Status:** 🔴 Não iniciado

#### TK-04.01.01.01
**Título:** Criar cron job de verificação de vencimentos
**Ação:** Novo job em server/jobs/contract-alerts.cron.ts rodando diariamente às 07:00

#### TK-04.01.01.02
**Título:** Criar lógica de query de contratos próximos ao vencimento
**Ação:** `SELECT * FROM contratos_clientes WHERE data_fim BETWEEN NOW() AND NOW() + INTERVAL '60 days' AND status = 'ativo'`

#### TK-04.01.01.03
**Título:** Implementar envio de e-mail de alerta de vencimento
**Ação:** Template de e-mail com lista de contratos e dias restantes

#### TK-04.01.01.04
**Título:** Exibir banner de alerta no Dashboard Operacional
**Ação:** Card "Contratos a vencer" com contagem e link para /admin/contracts?filter=expiring

#### TK-04.01.01.05
**Título:** Adicionar badge visual na listagem de contratos
**Ação:** Badge colorido por urgência: vermelho (<15d), laranja (<30d), amarelo (<60d)

---

## FT-04.02 — Aplicação Automática de Reajuste IPCA

**ID:** FT-04.02
**Objetivo:** Automatizar a aplicação do reajuste IPCA em contratos que estão há mais de 12 meses sem reajuste, eliminando a etapa manual de clicar em cada contrato
**Problema que resolve:** GAP-014 — Sistema calcula IPCA mas admin precisa aplicar manualmente contrato a contrato; contratos ficam meses sem reajuste
**Módulos:** admin/contracts.tsx · server/routes/
**Critério de aceite:** Opção de "aplicar reajuste em lote" para todos os contratos elegíveis com confirmação
**Prioridade:** 🟡 P2
**Complexidade:** M
**Dependências:** FT-04.01
**Estimativa:** 4 dias
**Status:** 🔴 Não iniciado
**Elimina:** 🔁Retrabalho

### US-04.02.01 — Aplicar reajuste IPCA em lote

**Como** ADMIN
**Quero** ver todos os contratos elegíveis para reajuste IPCA e aplicar em lote
**Para** não precisar abrir contrato por contrato e clicar em aplicar individualmente

**Critério de aceite:**
- [ ] Painel "Reajustes Pendentes" lista todos os contratos com >12 meses sem reajuste
- [ ] Exibe: empresa, data do último reajuste, % IPCA acumulado, valor atual, valor proposto
- [ ] Admin pode selecionar todos ou subset e clicar "Aplicar Reajuste em Lote"
- [ ] Confirmação mostra impacto total (receita antes vs depois)
- [ ] Histórico de reajuste registrado em `contract_adjustments`

**Prioridade:** 🟡 P2 | **Complexidade:** M | **Estimativa:** 4 dias | **Status:** 🔴 Não iniciado

#### TK-04.02.01.01
**Título:** Criar endpoint `POST /api/contracts/bulk-ipca-adjustment`
**Ação:** Aceita array de contractIds e aplica reajuste IPCA em transação

#### TK-04.02.01.02
**Título:** Criar painel "Reajustes Pendentes" em contracts.tsx
**Ação:** Aba ou seção com tabela de contratos elegíveis e ação em lote

---

---

# EP-05 — PEDIDOS

**Objetivo:** Digitalizar completamente o ciclo de pedidos, eliminando confirmações por WhatsApp e rastreando o status em tempo real.
**Gap resolvido:** S-07 (pedidos fora da janela) · GAP-009 (bloqueio de inadimplentes)
**Fase:** F1/F2

---

## FT-05.01 — Bloqueio Automático de Pedidos para Inadimplentes

**ID:** FT-05.01
**Objetivo:** Impedir automaticamente a criação de novos pedidos para clientes com parcelas em atraso há mais de X dias
**Problema que resolve:** GAP-009 — Admin precisa verificar manualmente inadimplência antes de aprovar pedidos; clientes inadimplentes continuam recebendo
**Módulos:** server/modules/orders/ · server/modules/finance/
**Critério de aceite:** Ao tentar criar pedido, sistema verifica inadimplência; se bloqueado, exibe motivo e bloqueia criação
**Prioridade:** 🟠 P1
**Complexidade:** M
**Dependências:** Módulo financeiro (AR/AP) em uso
**Estimativa:** 4 dias
**Status:** 🔴 Não iniciado
**Elimina:** 🔁Retrabalho

### US-05.01.01 — Impedir pedidos de clientes inadimplentes

**Como** sistema
**Quero** verificar automaticamente a situação financeira do cliente ao criar um pedido
**Para** proteger a VivaFrutaz de aumentar exposição com clientes que já não pagam

**Critério de aceite:**
- [ ] Ao criar pedido (admin ou cliente), sistema consulta AR pendente da empresa
- [ ] Se há AR vencido há mais de `CONFIG_INADIMPLENCIA_DIAS` dias (padrão: 15), pedido é bloqueado
- [ ] Mensagem clara exibe: "Pedido bloqueado — cliente com parcela em atraso desde [data]"
- [ ] ADMIN pode forçar aprovação com justificativa registrada em log
- [ ] Configuração `CONFIG_INADIMPLENCIA_DIAS` é ajustável em Configurações

**Prioridade:** 🟠 P1 | **Complexidade:** M | **Estimativa:** 4 dias | **Status:** 🔴 Não iniciado

#### TK-05.01.01.01
**Título:** Criar função `checkClientInadimplencia(companyId)` em finance service
**Ação:** Consulta `accounts_receivable` por `company_id` e `due_date < NOW() - INTERVAL 'X days'`

#### TK-05.01.01.02
**Título:** Integrar verificação no fluxo de criação de pedido
**Ação:** Chamar `checkClientInadimplencia` antes de INSERT em orders; retornar 422 com detalhe se bloqueado

#### TK-05.01.01.03
**Título:** Exibir feedback claro no portal do cliente e na tela admin de pedidos
**Ação:** Alert/toast com motivo do bloqueio e valor em atraso

#### TK-05.01.01.04
**Título:** Implementar override ADMIN com justificativa
**Ação:** Modal de confirmação para ADMIN forçar pedido; justificativa salva em audit_logs

#### TK-05.01.01.05
**Título:** Adicionar configuração de dias de carência em /admin/settings
**Ação:** Campo numérico salvo em `system_settings` com chave `inadimplencia_dias_bloqueio`

---

## FT-05.02 — Notificação de Status de Pedido ao Cliente

**ID:** FT-05.02
**Objetivo:** Enviar notificação automática ao cliente quando seu pedido muda de status (aprovado, em separação, saiu para entrega, entregue)
**Problema que resolve:** Cliente consulta status por WhatsApp; sem visibilidade, gera ansiedade e atendimento desnecessário
**Módulos:** server/modules/orders/ · sistema de notificações · Portal do Cliente
**Critério de aceite:** E-mail ou push notification enviado ao cliente em cada transição de status relevante
**Prioridade:** 🟠 P1
**Complexidade:** M
**Dependências:** SMTP ativo · FT-01.03
**Estimativa:** 4 dias
**Status:** 🔴 Não iniciado
**Elimina:** 📱WhatsApp

### US-05.02.01 — Receber notificação automática do status do meu pedido

**Como** CLIENT
**Quero** ser notificado automaticamente quando meu pedido mudar de status
**Para** não precisar enviar mensagem para a VivaFrutaz perguntando sobre meu pedido

**Critério de aceite:**
- [ ] E-mail enviado ao cliente para: APPROVED · PROCESSING (Em Separação) · SHIPPED · DELIVERED
- [ ] Push notification (se PWA instalado) nas mesmas transições
- [ ] E-mail tem template visual com logo VivaFrutaz, nome do cliente e detalhes do pedido
- [ ] Cliente pode desativar notificações em seu perfil
- [ ] Nenhum e-mail duplicado se o status mudar duas vezes no mesmo minuto

**Prioridade:** 🟠 P1 | **Complexidade:** M | **Estimativa:** 4 dias | **Status:** 🔴 Não iniciado

#### TK-05.02.01.01
**Título:** Criar event listener para transições de status de pedido
**Ação:** Usar event system existente (`core/events/`) para capturar `order.status.changed`

#### TK-05.02.01.02
**Título:** Criar templates de e-mail para cada status
**Ação:** 4 templates HTML em server/templates/: order-approved, order-processing, order-shipped, order-delivered

#### TK-05.02.01.03
**Título:** Implementar envio de push notification via web-push
**Ação:** Disparar push para subscription do cliente usando VAPID existente

#### TK-05.02.01.04
**Título:** Adicionar toggle de notificações no perfil do cliente
**Ação:** Campo `notification_preferences` em users; verificar antes de enviar

---

## FT-05.03 — Persistência do Carrinho Entre Dispositivos

**ID:** FT-05.03
**Objetivo:** Migrar carrinho de compras do `localStorage` para backend, permitindo sincronização entre dispositivos
**Problema que resolve:** Cliente monta carrinho no celular, acessa no computador e perde tudo
**Módulos:** client/src/pages/client/create-order.tsx · server/modules/orders/
**Critério de aceite:** Carrinho salvo no servidor; acessível em qualquer dispositivo com a mesma sessão
**Prioridade:** 🟡 P2
**Complexidade:** M
**Dependências:** Nenhuma
**Estimativa:** 4 dias
**Status:** 🔴 Não iniciado
**Elimina:** 🔁Retrabalho · 🖥️UX

### US-05.03.01 — Acessar meu carrinho em qualquer dispositivo

**Como** CLIENT
**Quero** que meu carrinho de pedido seja salvo mesmo se eu trocar de dispositivo
**Para** não perder o que já selecionei ao alternar entre celular e computador

**Critério de aceite:**
- [ ] Ao adicionar item ao carrinho, dados são salvos no backend (tabela `order_drafts` ou campo em orders)
- [ ] Ao abrir /client/create-order em outro dispositivo, carrinho é recuperado
- [ ] localStorage mantido como fallback para usuários deslogados (não aplicável — cliente sempre loga)
- [ ] Carrinho expirado automaticamente após 24h sem atividade

**Prioridade:** 🟡 P2 | **Complexidade:** M | **Estimativa:** 4 dias | **Status:** 🔴 Não iniciado

#### TK-05.03.01.01
**Título:** Criar tabela `order_drafts` no schema
**Ação:** Migração: `order_drafts (id, company_id, user_id, items jsonb, created_at, updated_at, expires_at)`

#### TK-05.03.01.02
**Título:** Criar endpoints CRUD de rascunho de pedido
**Ação:** `PUT /api/orders/draft`, `GET /api/orders/draft`, `DELETE /api/orders/draft`

#### TK-05.03.01.03
**Título:** Substituir localStorage por sync com backend em create-order.tsx
**Ação:** Auto-save a cada mudança de item; debounce 500ms para evitar excesso de requests

---

---

# EP-06 — PLANEJAMENTO E COMPRAS

**Objetivo:** Fechar o ciclo de compras dentro do sistema, eliminando o fluxo Excel + WhatsApp para pedido ao fornecedor.
**Gap resolvido:** GAP-003 (PO ao Fornecedor) · GAP-006 (Cadastro de Fornecedor) · GAP-010 (XML NF fornecedor) · GAP-019 (Preço custo) · GAP-020 (Histórico cotações)
**Fase:** F1/F2

---

## FT-06.01 — Cadastro de Fornecedor

**ID:** FT-06.01
**Objetivo:** Criar módulo de cadastro de fornecedores com CNPJ, contatos, produtos fornecidos e histórico de preços
**Problema que resolve:** GAP-006 — Toda negociação com fornecedor é pessoal (telefone/WhatsApp); nenhum dado fica no sistema
**Módulos:** Novo módulo admin/suppliers.tsx · server/routes/suppliers.routes.ts · nova tabela suppliers
**Critério de aceite:** Fornecedores cadastrados com produtos associados; histórico de preço acessível no planejamento
**Prioridade:** 🟠 P1
**Complexidade:** L
**Dependências:** Nenhuma
**Estimativa:** 1 semana
**Status:** 🔴 Não iniciado
**Elimina:** ✂️Excel · 📱WhatsApp

### US-06.01.01 — Cadastrar e consultar fornecedores

**Como** PURCHASE_MANAGER
**Quero** ter um cadastro de fornecedores com seus produtos e preços históricos
**Para** não precisar ligar para perguntar preço toda vez e ter onde registrar o histórico de negociação

**Critério de aceite:**
- [ ] Tela de fornecedores com: razão social, CNPJ, contato (WhatsApp/e-mail/telefone), produtos fornecidos
- [ ] Cada fornecedor tem lista de produtos que fornece com preço médio e último preço
- [ ] Histórico de cotações por fornecedor (data, produto, preço cotado, aceito/recusado)
- [ ] Vinculação de fornecedor a produto no cadastro do produto
- [ ] Busca por produto: "quem fornece Banana?"

**Prioridade:** 🟠 P1 | **Complexidade:** L | **Estimativa:** 1 semana | **Status:** 🔴 Não iniciado

#### TK-06.01.01.01
**Título:** Criar migração para tabela `suppliers`
**Ação:** `suppliers (id, name, cnpj, phone, email, whatsapp, address, notes, active, created_at)`

#### TK-06.01.01.02
**Título:** Criar migração para tabela `supplier_products`
**Ação:** `supplier_products (id, supplier_id, product_id, avg_price, last_price, last_purchase_date)`

#### TK-06.01.01.03
**Título:** Criar migração para tabela `supplier_quotes`
**Ação:** `supplier_quotes (id, supplier_id, product_id, quoted_price, quote_date, accepted, notes)`

#### TK-06.01.01.04
**Título:** Criar endpoints CRUD de fornecedores
**Ação:** GET/POST/PATCH/DELETE /api/suppliers + GET /api/suppliers/:id/products

#### TK-06.01.01.05
**Título:** Criar tela admin/suppliers.tsx
**Ação:** DataTable com fornecedores, modal de cadastro/edição, aba de histórico de cotações

#### TK-06.01.01.06
**Título:** Vincular fornecedor ao cadastro de produto
**Ação:** Campo "Fornecedores" em admin/products.tsx com seleção múltipla

---

## FT-06.02 — Geração de Pedido de Compra Formal ao Fornecedor

**ID:** FT-06.02
**Objetivo:** Criar funcionalidade de Pedido de Compra (PO) que consolida a lista do planejamento e permite envio formal ao fornecedor
**Problema que resolve:** GAP-003 — Após consolidação no planejamento de compras, lista vai para Excel e é enviada por WhatsApp/e-mail manual; sem rastreabilidade
**Módulos:** admin/purchase-planning.tsx · novo módulo de PO · server/routes/
**Critério de aceite:** PO criado a partir do planejamento; enviado por e-mail direto do sistema; status rastreado
**Prioridade:** 🟠 P1
**Complexidade:** L
**Dependências:** FT-06.01 (Cadastro de Fornecedor)
**Estimativa:** 1,5 semanas
**Status:** 🔴 Não iniciado
**Elimina:** ✂️Excel · 📱WhatsApp · 📄Papel

### US-06.02.01 — Criar e enviar Pedido de Compra ao fornecedor pelo sistema

**Como** PURCHASE_MANAGER
**Quero** transformar a lista de planejamento de compras em um Pedido de Compra formal e enviá-lo por e-mail diretamente do sistema
**Para** eliminar o processo de copiar para Excel e enviar por WhatsApp

**Critério de aceite:**
- [ ] Botão "Gerar PO" no módulo de Planejamento de Compras após o cutoff
- [ ] PO pré-populado com itens do planejamento consolidado
- [ ] PURCHASE_MANAGER seleciona fornecedor por produto e define quantidade/preço acordado
- [ ] PO enviado por e-mail ao fornecedor diretamente do sistema
- [ ] PO salvo com status: Rascunho · Enviado · Confirmado · Recebido
- [ ] PDF do PO gerado e disponível para download
- [ ] Itens do PO vinculados aos produtos para atualizar `avg_purchase_price`

**Prioridade:** 🟠 P1 | **Complexidade:** L | **Estimativa:** 1,5 semanas | **Status:** 🔴 Não iniciado

#### TK-06.02.01.01
**Título:** Criar migração para tabela `purchase_orders`
**Ação:** `purchase_orders (id, company_id, supplier_id, status, total, created_by, sent_at, confirmed_at, received_at, notes)`

#### TK-06.02.01.02
**Título:** Criar migração para tabela `purchase_order_items`
**Ação:** `purchase_order_items (id, po_id, product_id, quantity, unit_price, total_price, notes)`

#### TK-06.02.01.03
**Título:** Criar endpoint `POST /api/purchase-orders` e fluxo de status
**Ação:** CRUD completo + `POST /api/purchase-orders/:id/send` para disparo de e-mail

#### TK-06.02.01.04
**Título:** Criar tela admin/purchase-orders.tsx
**Ação:** Lista de POs com status, modal de criação a partir do planejamento

#### TK-06.02.01.05
**Título:** Integrar "Gerar PO" no módulo de Planejamento de Compras
**Ação:** Botão que abre modal de criação de PO com itens pré-carregados do planejamento

#### TK-06.02.01.06
**Título:** Implementar geração de PDF do PO
**Ação:** Usar pdfkit existente para gerar PDF com cabeçalho VivaFrutaz, fornecedor, itens e totais

#### TK-06.02.01.07
**Título:** Atualizar avg_purchase_price ao marcar PO como "Recebido"
**Ação:** UPDATE products SET avg_purchase_price = weighted average ao confirmar recebimento

---

## FT-06.03 — Alimentação Automática do Planejamento por Pedidos Confirmados

**ID:** FT-06.03
**Objetivo:** O planejamento de compras deve ser calculado automaticamente com base nos pedidos confirmados, sem necessidade de consolidação manual
**Problema que resolve:** PURCHASE_MANAGER consolida manualmente a demanda; planilha pode diferir dos pedidos reais
**Módulos:** admin/purchase-planning.tsx · server/routes/purchase-planning.routes.ts · server/modules/orders/
**Critério de aceite:** Planejamento mostra demanda agregada de todos os pedidos confirmados para o período; atualiza em tempo real
**Prioridade:** 🟡 P2
**Complexidade:** M
**Dependências:** FT-05.01
**Estimativa:** 5 dias
**Status:** 🔴 Não iniciado
**Elimina:** ✂️Excel · 🔁Retrabalho

### US-06.03.01 — Ver planejamento de compras calculado automaticamente

**Como** PURCHASE_MANAGER
**Quero** abrir o planejamento de compras e ver a demanda consolidada já calculada com base nos pedidos confirmados
**Para** não precisar fazer manualmente a soma de cada item por categoria

**Critério de aceite:**
- [ ] Planejamento de compras mostra: produto, quantidade demandada (soma dos pedidos), estoque atual, déficit (demanda - estoque)
- [ ] Dados atualizados automaticamente quando novos pedidos são aprovados
- [ ] Filtro por data de entrega/janela de pedido
- [ ] Exportação possível (mas não obrigatória) apenas como complemento, não como fluxo principal
- [ ] Alerta visual para produtos com déficit crítico

**Prioridade:** 🟡 P2 | **Complexidade:** M | **Estimativa:** 5 dias | **Status:** 🔴 Não iniciado

#### TK-06.03.01.01
**Título:** Criar view/query de consolidação de demanda por produto
**Ação:** `SELECT product_id, SUM(quantity) as demand FROM order_items JOIN orders ON... WHERE orders.status IN ('APPROVED','PROCESSING') AND delivery_date BETWEEN ? AND ?`

#### TK-06.03.01.02
**Título:** Cruzar demanda com estoque atual para calcular déficit
**Ação:** LEFT JOIN com inventory para `current_stock`; `deficit = MAX(0, demand - current_stock)`

#### TK-06.03.01.03
**Título:** Atualizar UI de purchase-planning.tsx para mostrar cálculo automático
**Ação:** Substituir inputs manuais por valores calculados com possibilidade de override manual

---

---

# EP-07 — PRODUÇÃO E SEPARAÇÃO

**Objetivo:** Digitalizar a ordem de produção e o romaneio de separação, eliminando papel e planilha do turno.
**Gap resolvido:** GAP-005 (Romaneio de Carga) · S-13 (Excel romaneio) · S-20 (Papel romaneio)
**Fase:** F1

---

## FT-07.01 — Ordem de Produção Digital

**ID:** FT-07.01
**Objetivo:** Criar tela de Ordem de Produção diária que substitui o papel impresso usado pela equipe de produção
**Problema que resolve:** Ordem de produção é impressa em papel a cada turno; sem visibilidade em tempo real do que foi produzido
**Módulos:** Novo admin/production.tsx · server/routes/production.routes.ts
**Critério de aceite:** Equipe de produção visualiza e atualiza status de produção por produto/turno diretamente na tela
**Prioridade:** 🔴 P0
**Complexidade:** L
**Dependências:** FT-06.03 (planejamento como base de produção)
**Estimativa:** 1 semana
**Status:** 🔴 Não iniciado
**Elimina:** 📄Papel · 🔁Retrabalho

### US-07.01.01 — Visualizar e atualizar ordem de produção digital

**Como** OPERATOR (produção)
**Quero** ver no tablet/tela o que precisa ser produzido hoje e marcar o que já foi feito
**Para** não depender de papel impresso que fica desatualizado assim que sai da impressora

**Critério de aceite:**
- [ ] Tela de Produção exibe: produto, quantidade necessária (do planejamento), quantidade já produzida, status (Pendente/Em andamento/Concluído)
- [ ] OPERATOR atualiza quantidade produzida em tempo real
- [ ] Gestor vê dashboard de produção: % concluído, pendências, alertas de atraso
- [ ] Histórico de produção por turno e data
- [ ] Quando produção de item é concluída, disponibiliza para Separação automaticamente

**Prioridade:** 🔴 P0 | **Complexidade:** L | **Estimativa:** 1 semana | **Status:** 🔴 Não iniciado

#### TK-07.01.01.01
**Título:** Criar migração para tabela `production_orders`
**Ação:** `production_orders (id, company_id, product_id, date, shift, quantity_planned, quantity_produced, status, created_by, updated_at)`

#### TK-07.01.01.02
**Título:** Criar endpoints de ordens de produção
**Ação:** GET /api/production-orders?date= · POST /api/production-orders · PATCH /api/production-orders/:id

#### TK-07.01.01.03
**Título:** Criar tela admin/production.tsx
**Ação:** Visão de cards por produto com barra de progresso; interface responsiva para tablet

#### TK-07.01.01.04
**Título:** Integrar geração automática de ordens de produção a partir do planejamento
**Ação:** Cron ou trigger que cria production_orders com base na demanda consolidada do dia

#### TK-07.01.01.05
**Título:** Atualizar status de disponibilidade no módulo de Separação quando produção concluída
**Ação:** Event `production.item.completed` → atualiza flag de disponibilidade em separação

---

## FT-07.02 — Romaneio Digital de Separação

**ID:** FT-07.02
**Objetivo:** Criar romaneio digital por pedido que substitui o papel impresso usado pela equipe de separação
**Problema que resolve:** GAP-005 — Separação é feita com papel impresso; erros não são rastreados; checklist de caixas não existe no sistema
**Módulos:** admin/orders.tsx · Novo componente de romaneio · server/routes/
**Critério de aceite:** Equipe de separação usa tela para conferir cada item do pedido; checklist digital substitui papel
**Prioridade:** 🔴 P0
**Complexidade:** L
**Dependências:** FT-07.01
**Estimativa:** 1 semana
**Status:** 🔴 Não iniciado
**Elimina:** 📄Papel · ✂️Excel · 🔁Retrabalho

### US-07.02.01 — Conferir separação de pedido no sistema sem papel

**Como** OPERATOR (separação)
**Quero** ver no tablet a lista de itens de cada pedido e marcar o que já separo
**Para** não precisar do papel impresso e ter confirmação digital de que cada item foi separado

**Critério de aceite:**
- [ ] Tela de Romaneio lista todos os pedidos com status APPROVED agrupados por rota/motorista
- [ ] Para cada pedido: lista de itens com quantidade, caixa de conferência (marcado/desmarcado)
- [ ] Status do pedido muda de APPROVED para PROCESSING quando separação é iniciada
- [ ] Status muda para READY automaticamente quando todos os itens são marcados como separados
- [ ] Divergência (item em falta) pode ser registrada com observação
- [ ] Gestor vê progresso de separação em tempo real no Dashboard

**Prioridade:** 🔴 P0 | **Complexidade:** L | **Estimativa:** 1 semana | **Status:** 🔴 Não iniciado

#### TK-07.02.01.01
**Título:** Criar migração para tabela `separation_records`
**Ação:** `separation_records (id, order_id, order_item_id, quantity_requested, quantity_separated, status, notes, separated_by, separated_at)`

#### TK-07.02.01.02
**Título:** Criar endpoints de romaneio
**Ação:** GET /api/orders/:id/romaneio · POST /api/orders/:id/separation-item · POST /api/orders/:id/separation-complete

#### TK-07.02.01.03
**Título:** Criar tela admin/romaneio.tsx com interface mobile-first
**Ação:** Cards de pedido com lista de itens; checkbox de confirmação por item; botão "Separação Concluída"

#### TK-07.02.01.04
**Título:** Atualizar workflow do pedido com transições de separação
**Ação:** APPROVED → (inicia separação) → PROCESSING → (todos itens separados) → READY

#### TK-07.02.01.05
**Título:** Criar visão consolidada de separação por rota para LOGISTICS
**Ação:** Painel com todos os pedidos de uma rota e status de separação para facilitar conferência de carga

---

---

# EP-08 — CONFERÊNCIA DE CARGA

**Objetivo:** Digitalizar a conferência de carga antes da saída do veículo, eliminando o checklist em papel.
**Gap resolvido:** S-20 (Papel conferência) · ADR-004
**Fase:** F1

---

## FT-08.01 — Checklist Digital de Conferência de Carga

**ID:** FT-08.01
**Objetivo:** Criar checklist digital que LOGISTICS usa para conferir a carga antes de liberar a saída do veículo
**Problema que resolve:** Conferência é feita em papel; erros de carga não são rastreados digitalmente; não há registro de quem conferiu
**Módulos:** admin/logistics.tsx · Novo componente de conferência · server/routes/
**Critério de aceite:** LOGISTICS usa tela para conferir carga; veículo só é liberado após checklist completo
**Prioridade:** 🔴 P0
**Complexidade:** L
**Dependências:** FT-07.02 (Romaneio concluído)
**Estimativa:** 1 semana
**Status:** 🔴 Não iniciado
**Elimina:** 📄Papel · 🔁Retrabalho

### US-08.01.01 — Realizar conferência digital de carga antes da saída

**Como** LOGISTICS
**Quero** conferir digitalmente a carga de cada veículo antes da saída
**Para** garantir que todos os pedidos estão corretos e ter registro de quem conferiu o quê

**Critério de aceite:**
- [ ] Tela de Conferência mostra rotas do dia com pedidos associados por veículo
- [ ] Para cada rota: lista de pedidos com status de separação
- [ ] LOGISTICS marca cada pedido como "conferido" no veículo
- [ ] Divergência registrada com tipo: item faltante · item errado · quantidade errada
- [ ] Somente após conferência completa, botão "Liberar Veículo" fica disponível
- [ ] Log de conferência registra: usuário, data/hora, veículo, ocorrências
- [ ] Dashboard mostra % de cargas conferidas vs pendentes

**Prioridade:** 🔴 P0 | **Complexidade:** L | **Estimativa:** 1 semana | **Status:** 🔴 Não iniciado

#### TK-08.01.01.01
**Título:** Criar migração para tabela `cargo_checks`
**Ação:** `cargo_checks (id, route_id, vehicle_id, checked_by, status, started_at, completed_at, notes)`

#### TK-08.01.01.02
**Título:** Criar migração para `cargo_check_items`
**Ação:** `cargo_check_items (id, cargo_check_id, order_id, status, divergence_type, divergence_notes)`

#### TK-08.01.01.03
**Título:** Criar endpoints de conferência de carga
**Ação:** POST /api/cargo-checks · PATCH /api/cargo-checks/:id/item · POST /api/cargo-checks/:id/release

#### TK-08.01.01.04
**Título:** Criar tela admin/cargo-check.tsx
**Ação:** Interface simples com rota, veículo, lista de pedidos e checkboxes; botão de liberação

#### TK-08.01.01.05
**Título:** Integrar liberação de veículo com disparo de roteiro para motorista
**Ação:** Ao liberar veículo, enviar push notification para motorista com rota do dia

---

---

# EP-09 — LOGÍSTICA E ENTREGAS

**Objetivo:** Fechar o ciclo de entrega dentro do sistema, eliminando WhatsApp como canal de comunicação operacional e papelada de entrega.
**Gap resolvido:** GAP-004 (Ocorrência motorista parcial) · GAP-007 (Foto + Assinatura) · GAP-011 (Escala motoristas)
**Fase:** F1/F2

---

## FT-09.01 — Escala Digital de Motoristas e Veículos

**ID:** FT-09.01
**Objetivo:** Criar escala semanal de motoristas e veículos no sistema, eliminando a planilha Excel de escala
**Problema que resolve:** GAP-011 — Escala de motoristas é gerenciada em Excel/WhatsApp; auto-dispatch não sabe quem está disponível
**Módulos:** admin/logistics.tsx · server/modules/logistics/
**Critério de aceite:** Escala cadastrada no sistema; auto-dispatch usa apenas motoristas/veículos escalados para o dia
**Prioridade:** 🟠 P1
**Complexidade:** M
**Dependências:** Nenhuma
**Estimativa:** 4 dias
**Status:** 🔴 Não iniciado
**Elimina:** ✂️Excel · 📱WhatsApp

### US-09.01.01 — Cadastrar escala semanal de motoristas

**Como** LOGISTICS
**Quero** registrar no sistema quais motoristas e veículos estão disponíveis em cada dia da semana
**Para** que o auto-dispatch só atribua entregas a motoristas que realmente estão trabalhando

**Critério de aceite:**
- [ ] Tela de Escala mostra calendário semanal com motoristas e veículos
- [ ] LOGISTICS define: motorista disponível, veículo associado, turno, observações
- [ ] Auto-dispatch verifica `driver_schedule` antes de atribuir rota
- [ ] Notificação push enviada ao motorista quando incluído na escala do dia
- [ ] Histórico de escalas mantido para análise de frequência/ausências

**Prioridade:** 🟠 P1 | **Complexidade:** M | **Estimativa:** 4 dias | **Status:** 🔴 Não iniciado

#### TK-09.01.01.01
**Título:** Criar migração para tabela `driver_schedules`
**Ação:** `driver_schedules (id, driver_id, vehicle_id, date, shift, status, notes, created_by)`

#### TK-09.01.01.02
**Título:** Atualizar auto-dispatch para consultar driver_schedules
**Ação:** Filtrar `logistics_drivers` por `driver_schedules.date = TODAY AND status = 'available'`

#### TK-09.01.01.03
**Título:** Criar UI de escala em logistics.tsx
**Ação:** Tabela semanal editável com motoristas nas linhas e dias nas colunas

#### TK-09.01.01.04
**Título:** Enviar notificação push ao motorista quando escalado
**Ação:** Push notification com "Você está escalado para amanhã — confira sua rota às 07:00"

---

## FT-09.02 — Comprovante Digital de Entrega com Foto

**ID:** FT-09.02
**Objetivo:** Permitir que o motorista capture foto da entrega e colete confirmação digital, eliminando papel e WhatsApp
**Problema que resolve:** GAP-007 — Motorista não tem campo para foto ou assinatura no sistema; tudo vai por WhatsApp
**Módulos:** admin/driver-panel.tsx · server/modules/logistics/ · tabela deliveries
**Critério de aceite:** Motorista captura foto ao confirmar entrega; foto vinculada ao pedido; cliente e VivaFrutaz têm acesso
**Prioridade:** 🔴 P0
**Complexidade:** L
**Dependências:** FT-09.01
**Estimativa:** 1 semana
**Status:** 🔴 Não iniciado
**Elimina:** 📱WhatsApp · 📄Papel

### US-09.02.01 — Tirar foto da entrega e registrar no sistema

**Como** MOTORISTA
**Quero** tirar uma foto da caixa entregue e registrar no sistema
**Para** ter prova digital de entrega sem precisar mandar foto por WhatsApp

**Critério de aceite:**
- [ ] Botão "Confirmar Entrega" no painel do motorista abre câmera do dispositivo
- [ ] Foto obrigatória para confirmar entrega; opcional para tentativa falha
- [ ] Foto salva com: timestamp, coordenadas GPS, motorista, pedido
- [ ] Após foto, botão de confirmação finaliza a entrega no sistema
- [ ] Foto acessível para: LOGISTICS (imediatamente) e CLIENT (via Portal do Cliente)
- [ ] Pedido atualizado para status DELIVERED automaticamente

**Prioridade:** 🔴 P0 | **Complexidade:** L | **Estimativa:** 1 semana | **Status:** 🔴 Não iniciado

#### TK-09.02.01.01
**Título:** Adicionar campo `delivery_photo_url` e `delivery_photo_gps` em tabela deliveries
**Ação:** Migração ALTER TABLE deliveries ADD COLUMN delivery_photo_url text, delivery_lat decimal, delivery_lng decimal

#### TK-09.02.01.02
**Título:** Implementar upload de foto em driver-panel.tsx via input type="file" / câmera
**Ação:** `<input type="file" accept="image/*" capture="environment">` com preview e confirmação

#### TK-09.02.01.03
**Título:** Criar endpoint de upload de foto de entrega
**Ação:** POST /api/logistics/deliveries/:id/photo — aceita multipart/form-data; salva em storage

#### TK-09.02.01.04
**Título:** Exibir foto de entrega na tela de acompanhamento de pedido para LOGISTICS
**Ação:** Expandir linha de pedido em logistics.tsx para mostrar foto e timestamp

#### TK-09.02.01.05
**Título:** Exibir foto de entrega no Portal do Cliente
**Ação:** Card "Entregue" em order-history.tsx com foto thumb e link para ampliação

---

## FT-09.03 — Notificação de ETA ao Cliente

**ID:** FT-09.03
**Objetivo:** Enviar notificação automática ao cliente quando o motorista sair para entrega e quando estiver próximo
**Problema que resolve:** Cliente não sabe quando vai receber; consulta por WhatsApp gera atendimento desnecessário
**Módulos:** admin/logistics.tsx · eta.service.ts · Portal do Cliente
**Critério de aceite:** Cliente recebe push/e-mail quando carga sai e quando está a ~30 min de distância
**Prioridade:** 🟠 P1
**Complexidade:** M
**Dependências:** FT-09.02
**Estimativa:** 4 dias
**Status:** 🔴 Não iniciado
**Elimina:** 📱WhatsApp

### US-09.03.01 — Receber notificação de quando minha entrega está chegando

**Como** CLIENT
**Quero** ser avisado quando o motorista sair para entrega e quando estiver próximo
**Para** não precisar ficar perguntando no WhatsApp e poder me organizar para receber

**Critério de aceite:**
- [ ] Push/e-mail enviado ao cliente quando pedido muda para SHIPPED
- [ ] Push/e-mail enviado quando ETA < 30 minutos (calculado por eta.service.ts)
- [ ] Mensagem inclui: nome do motorista, ETA estimado, link para rastreamento público /track
- [ ] Link /track mostra posição do veículo em tempo real

**Prioridade:** 🟠 P1 | **Complexidade:** M | **Estimativa:** 4 dias | **Status:** 🔴 Não iniciado

#### TK-09.03.01.01
**Título:** Criar listener para mudança de status SHIPPED
**Ação:** Event `order.status.changed` → quando status = SHIPPED, dispara notificação ETA inicial

#### TK-09.03.01.02
**Título:** Criar job de verificação de ETA próximo
**Ação:** Cron a cada 5 min: para cada pedido SHIPPED, calcular ETA; se < 30 min e notificação ainda não enviada, disparar

#### TK-09.03.01.03
**Título:** Incluir link de rastreamento na notificação
**Ação:** URL `/track?order={orderId}&token={trackingToken}` gerado para cada pedido

---

---

# EP-10 — PAINEL DO MOTORISTA

**Objetivo:** Transformar o painel do motorista em ferramenta completa de comunicação operacional, eliminando WhatsApp como canal de ocorrências.
**Gap resolvido:** GAP-004 (Ocorrência de entrega) · S-03/S-04/S-05 (WhatsApp motorista)
**Fase:** F1

---

## FT-10.01 — Registro de Ocorrência de Entrega pelo Motorista

**ID:** FT-10.01
**Objetivo:** Adicionar formulário de ocorrência estruturada no painel do motorista para substituir o WhatsApp
**Problema que resolve:** GAP-004 — Motorista registra ocorrências (cliente ausente, endereço errado, produto avariado) apenas por WhatsApp; sem histórico formal
**Módulos:** admin/driver-panel.tsx · server/modules/logistics/ · tabela logistics_audit_logs
**Critério de aceite:** Motorista registra ocorrência com categoria e foto diretamente no painel; gestor recebe alerta
**Prioridade:** 🔴 P0
**Complexidade:** M
**Dependências:** FT-09.02 (upload de foto)
**Estimativa:** 4 dias
**Status:** 🔴 Não iniciado
**Elimina:** 📱WhatsApp · 🔁Retrabalho

### US-10.01.01 — Registrar ocorrência de entrega sem sair do sistema

**Como** MOTORISTA
**Quero** registrar problemas de entrega diretamente no painel
**Para** não precisar mandar WhatsApp e ter o histórico salvo formalmente

**Critério de aceite:**
- [ ] Botão "Registrar Ocorrência" disponível em cada parada do painel do motorista
- [ ] Formulário com: tipo de ocorrência (cliente ausente / endereço errado / produto avariado / caixa faltante / outro), descrição livre, foto opcional
- [ ] Ocorrência vinculada ao pedido e ao cliente
- [ ] Alerta em tempo real para LOGISTICS e OPERATIONS_MANAGER
- [ ] Histórico de ocorrências por cliente acessível em companies.tsx

**Prioridade:** 🔴 P0 | **Complexidade:** M | **Estimativa:** 4 dias | **Status:** 🔴 Não iniciado

#### TK-10.01.01.01
**Título:** Criar migração para tabela `delivery_incidents`
**Ação:** `delivery_incidents (id, order_id, driver_id, type, description, photo_url, gps_lat, gps_lng, status, created_at)`

#### TK-10.01.01.02
**Título:** Adicionar formulário de ocorrência em driver-panel.tsx
**Ação:** Drawer/modal com select de tipo, textarea, input de foto; submit via API

#### TK-10.01.01.03
**Título:** Criar endpoint `POST /api/logistics/incidents`
**Ação:** Salva incident, vincula a order_id, dispara evento `delivery.incident.created`

#### TK-10.01.01.04
**Título:** Implementar notificação em tempo real para LOGISTICS
**Ação:** WebSocket push ou polling para notificar gestor de nova ocorrência

#### TK-10.01.01.05
**Título:** Exibir histórico de ocorrências por cliente em companies.tsx
**Ação:** Aba "Ocorrências de Entrega" na ficha da empresa com timeline de incidentes

---

---

# EP-11 — DASHBOARD OPERACIONAL

**Objetivo:** Consolidar os KPIs operacionais críticos em um único painel de controle, eliminando a necessidade de navegar por múltiplos módulos para ter visão do dia.
**Gap resolvido:** GAP-016/017 (Telas fragmentadas) · S-12/S-13 (Excel para relatórios)
**Fase:** F1/F2

---

## FT-11.01 — KPIs Operacionais em Tempo Real

**ID:** FT-11.01
**Objetivo:** Adicionar ao dashboard os KPIs que mais importam para a operação diária: pedidos pendentes, separação em andamento, entregas em rota, contratos a vencer
**Problema que resolve:** Dashboard atual foca em métricas genéricas; gestor não vê de forma rápida o que está bloqueado operacionalmente
**Módulos:** admin/dashboard.tsx · server/routes/ · admin/executive-dashboard.tsx
**Critério de aceite:** Dashboard mostra 6 KPIs operacionais com drill-down para módulo correspondente
**Prioridade:** 🟠 P1
**Complexidade:** M
**Dependências:** FT-07.01 · FT-07.02 · FT-08.01
**Estimativa:** 4 dias
**Status:** 🔴 Não iniciado
**Elimina:** ✂️Excel · 🔁Retrabalho

### US-11.01.01 — Ver situação operacional do dia em uma tela

**Como** ADMIN ou OPERATIONS_MANAGER
**Quero** abrir o dashboard e ver imediatamente o que está em andamento e o que está bloqueado
**Para** não precisar abrir Pedidos, Logística e Produção separadamente para ter visão do dia

**Critério de aceite:**
- [ ] Card: "Pedidos Hoje" — total, aprovados, pendentes aprovação, em separação, prontos
- [ ] Card: "Entregas Hoje" — em rota, entregues, com ocorrência
- [ ] Card: "Produção" — % concluída da ordem do dia
- [ ] Card: "Conferência" — cargas liberadas vs pendentes
- [ ] Card: "Contratos a Vencer" — contagem com link para filtro
- [ ] Card: "Inadimplência" — clientes bloqueados e valor total em atraso
- [ ] Cada card é clicável e navega para o módulo filtrado

**Prioridade:** 🟠 P1 | **Complexidade:** M | **Estimativa:** 4 dias | **Status:** 🔴 Não iniciado

#### TK-11.01.01.01
**Título:** Criar endpoint `GET /api/dashboard/operational-summary`
**Ação:** Query agregada retornando todos os KPIs em uma única chamada

#### TK-11.01.01.02
**Título:** Criar componente `<OperationalKPIGrid>` em dashboard.tsx
**Ação:** 6 cards com ícone, número, label, status colorido e link de drill-down

#### TK-11.01.01.03
**Título:** Adicionar filtro de data ao dashboard (hoje / semana / mês)
**Ação:** DateRangePicker no header do dashboard; persiste em localStorage

---

## FT-11.02 — Consolidação dos Dashboards

**ID:** FT-11.02
**Objetivo:** Reduzir de 5 dashboards separados para 1 dashboard com abas contextuais por role, conforme recomendação da Auditoria de Produto
**Problema que resolve:** 5 dashboards diferentes confundem o usuário sobre qual usar; dados sobrepostos entre eles
**Módulos:** admin/dashboard.tsx · admin/executive-dashboard.tsx
**Critério de aceite:** Um único ponto de entrada /admin que adapta conteúdo por role do usuário logado
**Prioridade:** 🟡 P2
**Complexidade:** M
**Dependências:** FT-11.01
**Estimativa:** 5 dias
**Status:** 🔴 Não iniciado
**Elimina:** 🖥️UX

### US-11.02.01 — Ter um único dashboard adaptado ao meu perfil

**Como** usuário interno
**Quero** que ao acessar /admin eu veja imediatamente os dados mais relevantes para meu perfil
**Para** não precisar decidir entre 5 dashboards diferentes

**Critério de aceite:**
- [ ] /admin mostra conteúdo diferente por role: ADMIN vê operacional + executivo; DIRECTOR vê executivo; LOGISTICS vê entregas; FINANCEIRO vê AR/AP
- [ ] Abas opcionais permitem trocar perspectiva sem sair da tela
- [ ] /admin/executive continua acessível mas é integrado como aba do dashboard principal
- [ ] Sem remoção de dados — reorganização de apresentação

**Prioridade:** 🟡 P2 | **Complexidade:** M | **Estimativa:** 5 dias | **Status:** 🔴 Não iniciado

#### TK-11.02.01.01
**Título:** Definir conteúdo de dashboard por role
**Ação:** Constante `DASHBOARD_SECTIONS_BY_ROLE` mapeando role → seções visíveis

#### TK-11.02.01.02
**Título:** Refatorar dashboard.tsx para renderização condicional por role
**Ação:** Composição de seções via `role ? <SectionA/> : <SectionB/>` evitando duplicação

---

---

# EP-12 — PORTAL DO CLIENTE

**Objetivo:** Fortalecer o Portal do Cliente para que o cliente consiga se autoatender sem precisar contatar a VivaFrutaz por WhatsApp para ações rotineiras.
**Gap resolvido:** S-08 (Cliente reporta problema por WhatsApp) · ADR-005
**Fase:** F3

---

## FT-12.01 — Onboarding Guiado do Cliente

**ID:** FT-12.01
**Objetivo:** Criar fluxo de onboarding para novos clientes ao acessar o portal pela primeira vez
**Problema que resolve:** Cliente não sabe o que pode fazer no portal; baixo engajamento; volta para WhatsApp por hábito
**Módulos:** client/ · auth/login.tsx
**Critério de aceite:** Novo cliente passa por tour de 4 passos na primeira sessão; pode ser acessado novamente em Perfil
**Prioridade:** 🟠 P1
**Complexidade:** M
**Dependências:** FT-09.03 (ETA) · FT-05.02 (notificações)
**Estimativa:** 4 dias
**Status:** 🔴 Não iniciado
**Elimina:** 📱WhatsApp · 🖥️UX

### US-12.01.01 — Descobrir o que posso fazer no portal na primeira vez

**Como** CLIENT novo
**Quero** ser guiado pelo portal na primeira vez que acesso
**Para** entender como fazer pedido, rastrear entrega e abrir chamado sem precisar ligar ou mandar WhatsApp

**Critério de aceite:**
- [ ] Modal de onboarding na primeira sessão com 4 steps: Fazer Pedido · Acompanhar Entrega · Ver Histórico · Abrir Chamado
- [ ] Cada step tem screenshot/gif animado e descrição curta
- [ ] Pode pular e retomar em Perfil > "Ver Tour"
- [ ] Flag `onboarding_completed` salva no perfil do usuário

**Prioridade:** 🟠 P1 | **Complexidade:** M | **Estimativa:** 4 dias | **Status:** 🔴 Não iniciado

#### TK-12.01.01.01
**Título:** Criar componente `<ClientOnboarding>` com Stepper
**Ação:** 4 steps com conteúdo estático + confetti/animação ao completar

#### TK-12.01.01.02
**Título:** Adicionar flag onboarding_completed em users e verificar no login
**Ação:** Migração: `ALTER TABLE users ADD COLUMN onboarding_completed boolean DEFAULT false`

#### TK-12.01.01.03
**Título:** Adicionar link "Ver Tour" em /client/profile
**Ação:** Botão que abre `<ClientOnboarding>` novamente

---

## FT-12.02 — Confirmação/Cancelamento de Pedido pelo Cliente

**ID:** FT-12.02
**Objetivo:** Permitir que o cliente confirme ou cancele pedido diretamente pelo portal dentro da janela de pedido
**Problema que resolve:** Cliente confirma pedido por WhatsApp; cancelamentos chegam tarde e informalmente
**Módulos:** client/create-order.tsx · client/order-history.tsx · server/modules/orders/
**Critério de aceite:** Cliente pode cancelar pedido até X horas antes do cutoff; cancelamento registrado com motivo
**Prioridade:** 🟠 P1
**Complexidade:** M
**Dependências:** FT-05.02 (notificações)
**Estimativa:** 4 dias
**Status:** 🔴 Não iniciado
**Elimina:** 📱WhatsApp

### US-12.02.01 — Cancelar meu pedido pelo portal

**Como** CLIENT
**Quero** cancelar meu pedido diretamente pelo portal enquanto a janela ainda está aberta
**Para** não precisar mandar WhatsApp para cancelar e ficar esperando alguém responder

**Critério de aceite:**
- [ ] Pedido com status CREATED tem botão "Cancelar Pedido" em order-history.tsx
- [ ] Pedido só pode ser cancelado se janela de pedido ainda estiver aberta
- [ ] Formulário de cancelamento solicita motivo (campo obrigatório)
- [ ] Ao cancelar, status muda para CANCELLED; ADMIN e OPERATIONS_MANAGER notificados
- [ ] Tentativa de cancelar após cutoff exibe mensagem explicativa e sugere abrir incidente

**Prioridade:** 🟠 P1 | **Complexidade:** M | **Estimativa:** 4 dias | **Status:** 🔴 Não iniciado

#### TK-12.02.01.01
**Título:** Criar endpoint `POST /api/orders/:id/client-cancel`
**Ação:** Valida janela aberta, muda status para CANCELLED, registra motivo, notifica equipe

#### TK-12.02.01.02
**Título:** Adicionar botão de cancelamento em client/order-history.tsx
**Ação:** Visível apenas para pedidos CREATED dentro da janela ativa; confirmação modal com campo de motivo

---

## FT-12.03 — Clara IA no Portal do Cliente

**ID:** FT-12.03
**Objetivo:** Disponibilizar versão simplificada da Clara IA no Portal do Cliente para responder dúvidas frequentes sobre pedidos, entregas e produtos
**Problema que resolve:** Cliente sem assistência no portal recorre ao WhatsApp para dúvidas simples
**Módulos:** client/ · server/routes/clara.routes.ts
**Critério de aceite:** Cliente acessa Clara via botão flutuante no portal; Clara responde sobre status de pedido, próxima janela, produtos disponíveis
**Prioridade:** 🟡 P2
**Complexidade:** M
**Dependências:** EP-13 (Clara IA melhorada)
**Estimativa:** 5 dias
**Status:** 🔴 Não iniciado
**Elimina:** 📱WhatsApp

### US-12.03.01 — Tirar dúvidas com a Clara no portal sem precisar ligar

**Como** CLIENT
**Quero** perguntar para a Clara sobre meu pedido, entrega e produtos
**Para** resolver minha dúvida na hora sem precisar esperar atendimento humano

**Critério de aceite:**
- [ ] Botão flutuante "Clara" disponível em todas as telas do portal do cliente
- [ ] Clara responde: status do meu último pedido, quando é a próxima janela de pedido, quais produtos estão disponíveis
- [ ] Clara não responde sobre financeiro, faturamento ou informações de outros clientes
- [ ] Contexto da conversa salvo para o turno atual

**Prioridade:** 🟡 P2 | **Complexidade:** M | **Estimativa:** 5 dias | **Status:** 🔴 Não iniciado

#### TK-12.03.01.01
**Título:** Criar escopo de acesso client-safe para Clara
**Ação:** Nova role `CLIENT` em clara.routes.ts com query restrita ao próprio companyId

#### TK-12.03.01.02
**Título:** Adicionar componente VirtualAssistant ao layout do portal do cliente
**Ação:** Reusar VirtualAssistant.tsx existente com configuração `scope: 'client'`

---

---

# EP-13 — CLARA IA

**Objetivo:** Evoluir a Clara de assistente consultiva para assistente acionável, com memória persistente e capacidade de criar tarefas a partir de análises.
**Gap resolvido:** GAP-015 (Memória Clara) · ADR-008
**Fase:** F2/F4

---

## FT-13.01 — Memória Persistente da Clara IA

**ID:** FT-13.01
**Objetivo:** Migrar memória de conversa de array em memória para banco de dados
**Problema que resolve:** GAP-015 — Clara perde contexto a cada restart; usuário precisa reexplicar contexto
**Módulos:** server/services/memoryModule.ts · tabela ai_interactions
**Critério de aceite:** Histórico de 20 últimas interações recuperado do banco a cada nova sessão
**Prioridade:** 🟠 P1
**Complexidade:** M
**Dependências:** FT-01.04 já cobre esta feature
**Estimativa:** 3 dias
**Status:** 🔴 Não iniciado (coberto por FT-01.04)
**Elimina:** 🔁Retrabalho

*Nota: Esta feature é tecnicamente idêntica a FT-01.04. Priorizar FT-01.04 como item de fundação técnica.*

---

## FT-13.02 — Clara Acionável — Criação de Tarefas a Partir de Análises

**ID:** FT-13.02
**Objetivo:** Clara identificar situações críticas (ex: risco de ruptura de estoque, cliente inadimplente) e oferecer criar uma tarefa diretamente
**Problema que resolve:** Clara dá análises corretas mas o usuário precisa ir a outro módulo para tomar ação; perde o contexto
**Módulos:** server/routes/clara.routes.ts · server/modules/ · admin/tasks.tsx
**Critério de aceite:** Clara detecta padrão crítico e oferece criar tarefa/alerta com um clique; tarefa aparece no módulo de Tarefas
**Prioridade:** 🟡 P2
**Complexidade:** L
**Dependências:** FT-13.01 · Dados operacionais de qualidade (F2)
**Estimativa:** 1 semana
**Status:** 🔴 Não iniciado

### US-13.02.01 — Clara cria tarefa a partir de uma análise com minha confirmação

**Como** ADMIN ou OPERATIONS_MANAGER
**Quero** que quando Clara identifica um problema, ela ofereça criar uma tarefa para ele
**Para** agir imediatamente sem precisar ir ao módulo de Tarefas manualmente

**Critério de aceite:**
- [ ] Clara detecta: risco de ruptura (estoque < demanda próximos 3 dias), inadimplência > 15 dias, contrato a vencer < 30 dias
- [ ] Oferece: "Quero criar uma tarefa para resolver isso?"
- [ ] Com confirmação do usuário, cria tarefa em admin/tasks com título, descrição, responsável sugerido e prazo
- [ ] Tarefa vinculada ao contexto (cliente, produto ou contrato específico)
- [ ] Sem confirmação do usuário, nenhuma ação é tomada (ADR-008)

**Prioridade:** 🟡 P2 | **Complexidade:** L | **Estimativa:** 1 semana | **Status:** 🔴 Não iniciado

#### TK-13.02.01.01
**Título:** Criar função `detectActionableInsights()` na Clara
**Ação:** Queries para: estoque crítico, inadimplência, contratos vencendo; formata sugestão estruturada

#### TK-13.02.01.02
**Título:** Implementar botão de confirmação em resposta da Clara
**Ação:** Resposta de Clara inclui `actionable: { type, data }` que o frontend renderiza como botão "Criar Tarefa"

#### TK-13.02.01.03
**Título:** Criar endpoint `POST /api/tasks/from-clara`
**Ação:** Aceita contexto da Clara, cria tarefa em tasks e retorna link

---

## FT-13.03 — Relatório Diário Automático da Clara

**ID:** FT-13.03
**Objetivo:** Clara gerar e enviar relatório diário de operação para ADMIN e DIRECTOR automaticamente às 18h
**Problema que resolve:** Relatório diário é compilado manualmente ou não existe; decisões baseadas em dados do dia anterior
**Módulos:** server/routes/clara.routes.ts · server/jobs/
**Critério de aceite:** E-mail diário enviado às 18h com resumo: pedidos do dia, entregas, ocorrências, inadimplência, próximos vencimentos
**Prioridade:** 🟡 P2
**Complexidade:** M
**Dependências:** FT-13.01 · KPIs estáveis (EP-11)
**Estimativa:** 4 dias
**Status:** 🔴 Não iniciado
**Elimina:** ✂️Excel · 🔁Retrabalho

### US-13.03.01 — Receber resumo do dia por e-mail sem precisar compilar

**Como** DIRECTOR ou ADMIN
**Quero** receber às 18h um resumo automático do que aconteceu no dia
**Para** não precisar abrir 5 módulos para entender como foi a operação

**Critério de aceite:**
- [ ] Cron job às 18h gera relatório com: total de pedidos do dia, entregas concluídas vs pendentes, ocorrências registradas, top 3 produtos do dia, clientes inadimplentes novos
- [ ] E-mail enviado para usuários com role ADMIN e DIRECTOR
- [ ] Template HTML bem formatado com VivaFrutaz branding
- [ ] Configurável em Settings: ativar/desativar, horário de envio

**Prioridade:** 🟡 P2 | **Complexidade:** M | **Estimativa:** 4 dias | **Status:** 🔴 Não iniciado

#### TK-13.03.01.01
**Título:** Criar cron job `daily-report.cron.ts` às 18:00
**Ação:** Agregar KPIs do dia, formatar template HTML, enviar via nodemailer

#### TK-13.03.01.02
**Título:** Criar configuração de relatório diário em /admin/settings
**Ação:** Toggle para ativar/desativar e campo de horário; salvo em system_settings

---

---

# EP-14 — ACADEMY

**Objetivo:** Transformar o Academy em repositório vivo de capacitação com trilhas por perfil, garantindo que toda nova funcionalidade tenha material correspondente.
**Gap resolvido:** ADR-009 · Alta rotatividade de equipe
**Fase:** F2

---

## FT-14.01 — Trilhas de Treinamento por Perfil

**ID:** FT-14.01
**Objetivo:** Organizar o conteúdo do Academy em trilhas específicas por perfil de usuário (Logística, Comercial, Operação, Financeiro)
**Problema que resolve:** Academy existe mas não tem organização por público; novo funcionário não sabe por onde começar
**Módulos:** admin/treinamento.tsx · server/routes/
**Critério de aceite:** Cada perfil tem trilha específica com sequência de conteúdos; progresso rastreado
**Prioridade:** 🟡 P2
**Complexidade:** M
**Dependências:** Nenhuma
**Estimativa:** 5 dias
**Status:** 🔴 Não iniciado

### US-14.01.01 — Seguir trilha de treinamento do meu perfil

**Como** novo usuário interno
**Quero** ver uma trilha de treinamento específica para minha função
**Para** aprender a usar o sistema na ordem certa, sem precisar pedir para alguém me ensinar

**Critério de aceite:**
- [ ] Academy tem categorias: Logística · Comercial · Operação · Financeiro · Administração
- [ ] Cada categoria tem sequência de módulos com: título, tipo (vídeo/texto/gif), duração estimada
- [ ] Usuário marca módulo como concluído; progresso exibido como barra
- [ ] ADMIN vê relatório de progresso de treinamento de toda a equipe
- [ ] Módulo novo pode ser adicionado a trilha sem reconfigurar todo o Academy

**Prioridade:** 🟡 P2 | **Complexidade:** M | **Estimativa:** 5 dias | **Status:** 🔴 Não iniciado

#### TK-14.01.01.01
**Título:** Criar migração para tabela `training_tracks` e `training_progress`
**Ação:** `training_tracks (id, role, title, order)` · `training_progress (user_id, module_id, completed_at)`

#### TK-14.01.01.02
**Título:** Reorganizar UI do Academy com abas por perfil
**Ação:** Tabs em treinamento.tsx: Logística | Comercial | Operação | Financeiro | Administração

#### TK-14.01.01.03
**Título:** Criar painel de progresso de treinamento para ADMIN
**Ação:** Tabela de usuários x módulos com % de conclusão; acessível em treinamento.tsx para ADMIN

---

---

# RESUMO EXECUTIVO DO BACKLOG

## Distribuição por Fase

| Fase | Épicos | Features | Período |
|---|---|---|---|
| **F1 — Consolidar Operação** | EP-01, EP-02, EP-07, EP-08, EP-09 (parcial), EP-10, EP-11 (parcial) | 14 features | 0–90 dias |
| **F2 — Eliminar Controles Paralelos** | EP-03, EP-04, EP-05 (parcial), EP-06, EP-09 (parcial), EP-11 (parcial), EP-13, EP-14 | 12 features | 90–180 dias |
| **F3 — Portal do Cliente** | EP-12 | 3 features | 180–270 dias |
| **F4 — Clara IA Integrada** | EP-13 (FT-13.02, 13.03 avançados) | 2 features | 270–360 dias |

## Distribuição por Prioridade

| Prioridade | Features | Razão |
|---|---|---|
| 🔴 P0 Crítico | 11 | Segurança + eliminação de papel/WhatsApp no fluxo principal |
| 🟠 P1 Alto | 14 | Eliminar controles paralelos principais |
| 🟡 P2 Médio | 6 | Melhorias de UX e automação |
| 🟢 P3 Baixo | 0 | Nenhum item desnecessário no V1 |

## Distribuição por Eliminação de Controle Paralelo

| Controle eliminado | Features que eliminam |
|---|---|
| 📱 WhatsApp | FT-03.02, FT-05.02, FT-07.02, FT-08.01, FT-09.02, FT-09.03, FT-10.01, FT-12.02, FT-12.03 |
| ✂️ Excel | FT-03.01, FT-04.01, FT-06.01, FT-06.02, FT-06.03, FT-09.01, FT-11.01, FT-13.03 |
| 📄 Papel | FT-07.01, FT-07.02, FT-08.01, FT-09.02 |
| 🔁 Retrabalho | FT-03.01, FT-04.02, FT-05.01, FT-05.03, FT-06.03, FT-11.01, FT-13.01 |
| 🖥️ UX | FT-02.01, FT-05.03, FT-11.02, FT-12.01 |

## Os 5 Pontos de Saída do Portal — Cobertura

> Do GAP MAP: "O Portal será maduro quando esses cinco pontos de saída deixarem de existir."

| Ponto de Saída | Feature que resolve | Fase |
|---|---|---|
| Após planejamento → Excel/WhatsApp ao fornecedor | FT-06.02 (PO Digital) | F2 |
| Após auto-dispatch → WhatsApp com motorista | FT-08.01 (Checklist) + FT-10.01 (Ocorrências) | F1 |
| Durante entrega → WhatsApp/papel para ocorrências/foto | FT-09.02 (Foto) + FT-10.01 (Ocorrências) | F1 |
| Após faturamento → Excel para conciliação | *Congelado — Fase 6 (NF-e + Bancário)* | F6 |
| Após inadimplência → E-mail/telefone para cobrança | FT-05.01 (Bloqueio) — cobrança ativa na F6 | F2/F6 |

## Sequência Recomendada de Entrega — Fase 1

```
Semana 1–2:   EP-01 (Segurança) + EP-02 (Navegação)
Semana 3–4:   EP-07 FT-07.02 (Romaneio) + EP-08 FT-08.01 (Conferência)
Semana 5–6:   EP-10 FT-10.01 (Ocorrências motorista) + EP-09 FT-09.02 (Foto entrega)
Semana 7–8:   EP-07 FT-07.01 (Produção digital) + EP-09 FT-09.01 (Escala)
Semana 9–10:  EP-04 FT-04.01 (Alertas contrato) + EP-11 FT-11.01 (KPIs Dashboard)
Semana 11–12: EP-05 FT-05.02 (Notificações pedido) + EP-09 FT-09.03 (ETA cliente)
```

## Critério de "Done" Global (Definition of Done)

Toda feature concluída deve ter:
- [ ] Código revisado e sem erros TypeScript
- [ ] Endpoint com autenticação `requireAuthCore` e verificação de tenant
- [ ] Teste funcional documentado (manual ou automatizado)
- [ ] Log de auditoria para ações críticas
- [ ] Material no Academy para o perfil que usará a feature (ADR-009)
- [ ] Nenhum módulo congelado habilitado como efeito colateral

---

*Documento gerado em Julho de 2026.*
*Product Owner — Portal VivaFrutaz.*
*Baseado em: AUDITORIA_VIVAFRUTAZ_ERP.md · AUDITORIA_FUNCIONAL_VIVAFRUTAZ_ERP.md · AUDITORIA_PRODUTO_VIVAFRUTAZ_ERP.md · GAP_MAP_VIVAFRUTAZ_ERP.md · PLANO_DIRETOR_PORTAL_VIVAFRUTAZ_V1.md*
*Nenhuma funcionalidade foi inventada. Todos os itens têm evidência nas auditorias.*
