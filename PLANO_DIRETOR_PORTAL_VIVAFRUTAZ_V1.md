# PLANO DIRETOR — PORTAL VIVAFRUTAZ ERP
## VERSÃO 1.0 | Julho 2026
### Documento de Referência Oficial

> Este documento é a fonte única de verdade para toda evolução futura do Portal VivaFrutaz.
> Nenhum desenvolvimento deve ser iniciado sem respeitar as decisões aqui registradas.

---

## SUMÁRIO

1. [Visão do Produto](#capítulo-1--visão-do-produto)
2. [Escopo Oficial da Versão 1](#capítulo-2--escopo-oficial-da-versão-1)
3. [Módulos Congelados](#capítulo-3--módulos-congelados)
4. [Destino de Cada Módulo](#capítulo-4--destino-de-cada-módulo)
5. [Backlog Estratégico](#capítulo-5--backlog-estratégico)
6. [Regras de Evolução](#capítulo-6--regras-de-evolução)
7. [Arquitetura Funcional](#capítulo-7--arquitetura-funcional)
8. [Roadmap](#capítulo-8--roadmap)
9. [Decisões Oficiais (ADRs)](#capítulo-9--decisões-oficiais-adrs)

---

## CAPÍTULO 1 — VISÃO DO PRODUTO

### Missão do Portal

O Portal VivaFrutaz é o sistema operacional digital da VivaFrutaz — a espinha dorsal que conecta comercial, produção, logística e cliente em um único fluxo rastreável, eliminando controles paralelos (Excel, WhatsApp, papel) e dando visibilidade em tempo real para cada etapa da operação.

### Problema que Resolve

A VivaFrutaz opera hoje com fragmentação de informação:

| Processo | Ferramenta atual | Problema |
|---|---|---|
| Gestão de contratos | Excel / WhatsApp | Sem rastreabilidade, retrabalho na renovação |
| Pedidos diários | WhatsApp / planilha | Sem histórico, sem confirmação formal |
| Planejamento de produção | Excel / papel | Sem visibilidade consolidada |
| Separação e conferência | Papel físico | Sem registro digital, erros não rastreados |
| Logística e entrega | WhatsApp / telefone | Sem ETA, sem prova de entrega |
| Comunicação com cliente | WhatsApp | Sem portal, sem autonomia para o cliente |

O Portal resolve esses problemas centralizando cada processo em uma única plataforma com fluxo encadeado e dados compartilhados entre departamentos.

### Usuários do Sistema

| Perfil | Papel | Acesso |
|---|---|---|
| **MASTER** | Dono do sistema / TI | Total — configurações, backups, seed |
| **ADMIN** | Gestor da operação | Todos os módulos V1 |
| **DIRECTOR** | Diretor comercial/operacional | Dashboard, comercial, relatórios |
| **SALES** | Equipe comercial | Empresas, contratos, cotações, pedidos |
| **OPERATOR** | Produção / separação | Planejamento, produção, conferência |
| **LOGISTICS** | Logística / entregadores | Logistics, motoristas, entregas |
| **FINANCEIRO** | Financeiro | Faturamento, contas, relatórios |
| **BUYER** | Compras | Planejamento de compras, estoque |
| **DRIVER** | Motorista | Painel do motorista (app simplificado) |
| **CLIENT** | Cliente externo | Portal do Cliente (V1) |

### Processos que o Portal Cobre (V1)

1. Comercial (prospecção, CRM, cotações)
2. Gestão de clientes e contratos
3. Pedidos (janelas, exceções, pedidos especiais)
4. Planejamento de produção
5. Produção e separação
6. Conferência de cargas
7. Logística e entregas
8. Dashboard operacional e indicadores
9. Academy (treinamento interno)
10. Clara IA (assistente operacional)
11. Portal do Cliente (consulta e pedidos)

### Processos FORA da V1

- Emissão de NF-e para o fisco (congelado — ver Cap. 3)
- Integração bancária / cobrança automática (congelado)
- Marketplace multi-tenant / SaaS (congelado)
- CT-e, MDF-e, SPED (congelado)
- Módulo financeiro avançado / DRE automático (Fase 6)
- Integrações com ERPs externos (fora de escopo)
- App mobile nativo (fora de escopo V1)

---

## CAPÍTULO 2 — ESCOPO OFICIAL DA VERSÃO 1

### Módulos Ativos da V1

| # | Módulo | Descrição |
|---|---|---|
| 1 | **Operação Interna** | Configurações, usuários, saúde do sistema, logs |
| 2 | **Comercial** | Empresas, prospecção, CRM, grupos de preço |
| 3 | **CRM** | Histórico de relacionamento com clientes |
| 4 | **Clientes** | Cadastro, contratos, escopos, renovações |
| 5 | **Contratos** | Gestão de vigência, itens contratados, renovação |
| 6 | **Pedidos** | Pedidos diários, janelas, exceções, especiais |
| 7 | **Planejamento** | Planejamento de compras e produção |
| 8 | **Produção** | Controle de produção e separação |
| 9 | **Separação** | Conferência de caixas e itens por pedido |
| 10 | **Conferência** | Validação de cargas antes da saída |
| 11 | **Logística** | Roteirização, motoristas, rastreamento |
| 12 | **Entregas** | Comprovação de entrega, ETA, ocorrências |
| 13 | **Dashboard** | Painel executivo e operacional em tempo real |
| 14 | **Academy** | Treinamento interno, vídeos, materiais |
| 15 | **Clara IA** | Assistente operacional, comercial e financeiro |
| 16 | **Portal do Cliente** | Consulta de pedidos, histórico, comunicação |

### Critério de Inclusão na V1

Um módulo está na V1 se:
- Resolve um problema real e recorrente da operação atual
- Elimina um controle paralelo (Excel, WhatsApp ou papel)
- Tem um dono identificado na empresa
- Pode ser entregue e usado sem depender de módulos congelados

---

## CAPÍTULO 3 — MÓDULOS CONGELADOS

Módulos congelados permanecem no código-fonte mas ficam **invisíveis na interface** e **inacessíveis via rotas** para usuários padrão. Eles só podem ser reativados por decisão formal (novo ADR).

### Lista de Módulos Congelados

#### 🔒 FISCAL — NF-e / SEFAZ / CT-e / MDF-e

**Módulos:** `server/modules/fiscal`, `server/modules/nfe`, rotas `/api/nfe/*`, `/api/fiscal/*`, páginas `nfe.tsx`, `nfe-dashboard.tsx`

**Por que congelado:**
- A operação da VivaFrutaz na V1 não depende de emissão fiscal automatizada pelo portal
- NF-e envolve certificado digital, homologação SEFAZ, manutenção de série/número e obrigações legais que requerem foco dedicado
- A infra técnica já existe e foi auditada (incluindo sequence atômica e idempotência), mas ativar sem processo fiscal maduro gera risco jurídico
- Requer treinamento específico da equipe financeira e validação contábil

**Condição para descongelar:** Fase 5 do Roadmap, com validação contábil e homologação em ambiente SEFAZ

---

#### 🔒 GATEWAY DE PAGAMENTO — PIX / Boletos / CNAB

**Módulos:** `server/modules/billing`, `server/routes/bank.routes.ts`, `ImportarRetornoCnab.tsx`

**Por que congelado:**
- Integração bancária requer homologação com banco emissor e cadastro de convênio
- O fluxo de cobrança atual da VivaFrutaz é manual e gerenciado externamente
- Risco de cobranças duplicadas ou não processadas sem operação financeira madura no portal
- Depende de NF-e para ciclo completo

**Condição para descongelar:** Fase 6, após módulo financeiro operacional e NF-e ativa

---

#### 🔒 BILLING / ASSINATURA INTERNA

**Módulos:** `server/modules/billing/subscription.middleware.ts`, rotas `/api/billing/*`, `/api/saas/*`

**Por que congelado:**
- O sistema tem infraestrutura de billing multi-tenant (para SaaS), mas a VivaFrutaz é um único tenant
- O middleware de assinatura pode bloquear funcionalidades indevidamente se mal configurado
- Não há produto SaaS ativo para comercializar na V1

**Condição para descongelar:** Decisão estratégica de transformar o portal em produto SaaS (fora do escopo V1)

---

#### 🔒 MARKETPLACE / MÓDULOS ATIVÁVEIS

**Módulos:** `client/src/pages/marketplace.tsx`, rotas `/api/marketplace/*`

**Por que congelado:**
- O marketplace foi concebido para ativação de módulos pagos por cliente (SaaS)
- Na V1, todos os módulos são internos e não há modelo de comercialização por módulo
- Interface confusa para usuários que esperam um ERP operacional

**Condição para descongelar:** Decisão de go-to-market como SaaS

---

#### 🔒 WHITE-LABEL / MULTI-TENANT

**Módulos:** `server/routes/whitelabel.routes.ts`, configurações de tema por empresa

**Por que congelado:**
- Recurso para clientes SaaS que querem sua própria identidade visual
- Na V1 a VivaFrutaz é o único tenant
- Manter ativo adiciona complexidade de UI sem benefício operacional

**Condição para descongelar:** Expansão SaaS

---

#### 🔒 SAAS DASHBOARD

**Módulos:** `client/src/pages/saas-dashboard.tsx`, rotas `/api/saas/*`

**Por que congelado:**
- Painel de métricas de produto SaaS (MRR, churn, tenants)
- Irrelevante para operação interna da VivaFrutaz na V1

**Condição para descongelar:** Expansão SaaS

---

## CAPÍTULO 4 — DESTINO DE CADA MÓDULO

| Módulo | Objetivo | Status Atual | Valor para Operação | Destino | Justificativa |
|---|---|---|---|---|---|
| **Dashboard** | Visibilidade executiva em tempo real | Funcional, parcial | Alto | **Melhorar** | Adicionar KPIs operacionais (taxa de entrega, separação pendente, inadimplência) |
| **Empresas (CRM)** | Cadastro e gestão de clientes B2B | Funcional | Alto | **Manter** | Base de todo o fluxo comercial |
| **Cotações** | Geração de propostas comerciais | Funcional | Médio | **Melhorar** | Falta aprovação digital e conversão automática em contrato |
| **Grupos de Preço** | Tabelas de preços por cliente | Funcional | Alto | **Manter** | Elimina negociação avulsa por WhatsApp |
| **Contratos** | Vigência, escopos, itens contratados | Funcional, incompleto | Alto | **Melhorar** | Falta alertas de vencimento, renovação digital e assinatura |
| **Produtos** | Catálogo com preços e categorias | Funcional | Alto | **Manter** | Core do negócio |
| **Pedidos** | Registro diário de pedidos por cliente | Funcional | Crítico | **Melhorar** | Falta confirmação por cliente e status em tempo real |
| **Janelas de Pedido** | Horário de corte por cliente/rota | Funcional | Alto | **Manter** | Elimina exceções manuais |
| **Exceções** | Pedidos fora do padrão | Funcional | Médio | **Manter** | Formaliza processos que hoje são via WhatsApp |
| **Pedidos Especiais** | Solicitações de itens não catalogados | Funcional | Médio | **Manter** | Substitui contato direto com vendedor |
| **Planejamento de Compras** | Projeção de necessidades de compra | Parcial | Alto | **Melhorar** | Falta integração com produção e estoque em tempo real |
| **Inventário / Estoque** | Controle de entrada e saída | Funcional | Alto | **Manter** | Base para planejamento e perdas |
| **Controle de Perdas** | Registro de descarte e avaria | Parcial | Médio | **Melhorar** | Falta relatório de tendência por produto |
| **Produção** | Ordens de produção e separação | Parcial | Crítico | **Melhorar** | Digitalizar processo hoje feito em papel |
| **Conferência** | Validação da carga antes da saída | Parcial | Crítico | **Melhorar** | Eliminar papel e foto de WhatsApp como comprovante |
| **Logística** | Rotas, veículos, motoristas | Funcional | Alto | **Melhorar** | Falta roteirização automática e comprovante digital de entrega |
| **Painel do Motorista** | Interface mobile simplificada | Funcional | Alto | **Manter** | Elimina WhatsApp entre logística e motorista |
| **Entregas / ETA** | Rastreamento e confirmação de entrega | Parcial | Alto | **Melhorar** | Falta assinatura digital e foto de entrega |
| **Logística Intelligence** | Análise de performance de rotas | Parcial | Médio | **Reorganizar** | Consolidar em Clara IA como painel analítico |
| **Clara IA** | Assistente operacional e comercial | Funcional | Alto | **Melhorar** | Expandir base de treinamento; tornar respostas acionáveis |
| **Academy / Treinamento** | Capacitação da equipe interna | Funcional, básico | Médio | **Melhorar** | Adicionar trilhas por perfil (logística, comercial, produção) |
| **Portal do Cliente** | Consulta, histórico, pedidos | Parcial | Alto | **Melhorar** | Entregar autonomia ao cliente; eliminar consultas por WhatsApp |
| **Usuários e Permissões** | Gestão de acesso | Funcional | Crítico | **Manter** | Já possui RBAC robusto |
| **Saúde do Sistema** | Monitoramento de performance | Funcional | Médio | **Manter** | Visibilidade técnica adequada |
| **Backups** | Cópia de segurança do banco | Funcional | Alto | **Manter** | Garantia de continuidade operacional |
| **SMTP / Notificações** | E-mails transacionais | Funcional | Médio | **Manter** | Usado para alertas e recuperação de senha |
| **Segurança / Auditoria** | Logs de acesso e ações | Funcional | Alto | **Manter** | Obrigatório para rastreabilidade |
| **NF-e / SEFAZ** | Emissão de nota fiscal eletrônica | Funcional, maduro | — | **Congelar** | Infra pronta; aguarda Fase 5 |
| **Faturamento / CNAB** | Boletos e retorno bancário | Parcial | — | **Congelar** | Aguarda Fase 6 |
| **SaaS Dashboard** | Métricas de produto SaaS | Funcional | — | **Ocultar** | Fora do escopo V1 |
| **Marketplace** | Ativação de módulos pagos | Funcional | — | **Ocultar** | Fora do escopo V1 |
| **White-label** | Temas por tenant | Funcional | — | **Ocultar** | Fora do escopo V1 |
| **Billing / Assinatura** | Gestão de planos pagos | Funcional | — | **Ocultar** | Fora do escopo V1 |
| **AI Developer** | Ferramenta de desenvolvimento assistido | Funcional | — | **Ocultar** | Uso interno de TI apenas; ocultar da operação |
| **CT-e / MDF-e** | Conhecimento de transporte eletrônico | Não implementado | — | **Descontinuar V1** | Fora do escopo; reativar apenas se necessário legal |

---

## CAPÍTULO 5 — BACKLOG ESTRATÉGICO

> Organizado por categoria de eliminação de problema. Sem criação de funcionalidades novas — apenas priorização dos gaps identificados nas auditorias.

---

### 📊 Categoria 1: Eliminar Excel

| Prioridade | Gap | Módulo Afetado | Impacto |
|---|---|---|---|
| 🔴 CRÍTICO | Planejamento de compras ainda exportado para planilha | Planejamento | Equipe de compras opera fora do sistema |
| 🔴 CRÍTICO | Controle de produção registrado em Excel por turno | Produção | Sem visibilidade em tempo real para gestão |
| 🟡 ALTO | Relatório de perdas exportado e manipulado externamente | Estoque | Dados de descarte não confiáveis |
| 🟡 ALTO | Acompanhamento de contratos em planilha paralela | Contratos | Risco de renovações perdidas |
| 🟢 MÉDIO | Consolidação de indicadores operacionais em Excel | Dashboard | Decisões atrasadas por falta de visibilidade |

---

### 📱 Categoria 2: Eliminar WhatsApp

| Prioridade | Gap | Módulo Afetado | Impacto |
|---|---|---|---|
| 🔴 CRÍTICO | Clientes confirmam pedidos por WhatsApp | Pedidos / Portal do Cliente | Sem rastreabilidade, cancelamentos não registrados |
| 🔴 CRÍTICO | Motoristas recebem roteiro por WhatsApp | Logística / Painel do Motorista | Informação perdida, sem confirmação de leitura |
| 🔴 CRÍTICO | Ocorrências de entrega reportadas por foto no WhatsApp | Entregas | Sem registro formal, sem histórico por cliente |
| 🟡 ALTO | Vendedores negociam preços por WhatsApp fora do sistema | CRM / Cotações | Preços acordados não refletidos no contrato |
| 🟡 ALTO | Cliente consulta histórico de pedido por WhatsApp | Portal do Cliente | Custo de atendimento elevado |
| 🟢 MÉDIO | Alertas de pedido pendente enviados por WhatsApp manual | Notificações | Risco de atrasos por falha humana |

---

### 📄 Categoria 3: Eliminar Papel

| Prioridade | Gap | Módulo Afetado | Impacto |
|---|---|---|---|
| 🔴 CRÍTICO | Romaneio de separação impresso e assinado manualmente | Separação / Conferência | Sem rastreabilidade digital por caixa |
| 🔴 CRÍTICO | Comprovante de entrega físico assinado pelo cliente | Entregas | Sem prova digital, disputas sem evidência |
| 🟡 ALTO | Ordem de produção diária impressa no turno | Produção | Sem atualização em tempo real |
| 🟡 ALTO | Checklist de conferência de carga em papel | Conferência | Erros não registrados digitalmente |
| 🟢 MÉDIO | Recebimento de mercadoria anotado em caderno | Inventário | Lançamento retroativo no sistema |

---

### ♻️ Categoria 4: Eliminar Retrabalho

| Prioridade | Gap | Módulo Afetado | Impacto |
|---|---|---|---|
| 🔴 CRÍTICO | Dados de pedido digitados 3x (WhatsApp → planilha → sistema) | Pedidos | Custo de tempo e risco de erro |
| 🔴 CRÍTICO | Preços renegociados por WhatsApp exigem atualização manual no sistema | Cotações / Contratos | Divergência entre contrato e faturamento |
| 🟡 ALTO | Relatório de entregas compilado manualmente ao fim do dia | Logística / Dashboard | Dado obsoleto no momento da decisão |
| 🟡 ALTO | Contrato renovado exige novo cadastro completo | Contratos | Sem aproveitamento do histórico existente |
| 🟢 MÉDIO | Treinamento de novos funcionários refeito a cada contratação sem material padrão | Academy | Alta curva de onboarding |

---

### 🖥️ Categoria 5: Melhorar UX

| Prioridade | Gap | Módulo Afetado | Impacto |
|---|---|---|---|
| 🟡 ALTO | Sidebar com módulos congelados visíveis confundem usuários operacionais | Navegação global | Baixa adoção do sistema |
| 🟡 ALTO | Fluxo de criação de pedido tem muitas etapas não guiadas | Pedidos | Erros de lançamento |
| 🟡 ALTO | Portal do Cliente sem onboarding — cliente não sabe o que pode fazer | Portal do Cliente | Baixo engajamento |
| 🟢 MÉDIO | Dashboard não tem filtro por data ou por rota | Dashboard | Dificuldade de análise situacional |
| 🟢 MÉDIO | Clara IA responde mas não gera ação direta (ex: criar pedido, abrir tarefa) | Clara IA | Potencial de IA subaproveitado |

---

### ⚙️ Categoria 6: Automatizar Processo

| Prioridade | Gap | Módulo Afetado | Impacto |
|---|---|---|---|
| 🔴 CRÍTICO | Nenhum alerta automático de contrato próximo ao vencimento | Contratos | Perda de renovação sem ação proativa |
| 🔴 CRÍTICO | Planejamento de compras não alimentado automaticamente por pedidos confirmados | Planejamento | Compras feitas por estimativa |
| 🟡 ALTO | Sem disparo automático de roteiro para motorista ao fechar carga | Logística | Atraso na comunicação de saída |
| 🟡 ALTO | Sem notificação de ETA ao cliente | Portal do Cliente | Cliente sem visibilidade |
| 🟢 MÉDIO | Relatório diário de operação não gerado automaticamente | Dashboard / Clara IA | Gestão reativa |

---

## CAPÍTULO 6 — REGRAS DE EVOLUÇÃO

As regras abaixo são **obrigatórias** para qualquer desenvolvimento no Portal VivaFrutaz a partir desta versão.

### Regra 1 — Problema Real Primeiro
Nenhuma funcionalidade pode ser criada sem identificar o problema operacional que resolve e o controle paralelo que elimina (Excel, WhatsApp, papel ou retrabalho). Funcionalidades que não eliminam nada são vetadas.

### Regra 2 — Dono Obrigatório
Toda funcionalidade deve ter um dono nomeado na empresa (ex: "Responsável: Gerente de Logística"). Sem dono, sem desenvolvimento.

### Regra 3 — Sem Duplicação de Módulo
Antes de criar qualquer tela ou endpoint, verificar se já existe algo equivalente. Reutilizar e melhorar é preferível a criar. Módulos duplicados serão consolidados, não mantidos em paralelo.

### Regra 4 — Reutilização de Componentes
Todo componente de UI deve ser verificado no design system existente antes de ser criado. Componentes novos só são criados se não houver equivalente reutilizável.

### Regra 5 — Módulos Congelados São Intocáveis para Usuário
Qualquer módulo da lista de congelados (Cap. 3) não pode aparecer na navegação, não pode receber link direto e não pode ser acessado por perfis operacionais. Só MASTER pode acessar para manutenção técnica.

### Regra 6 — Fluxo antes de Interface
Nenhuma tela pode ser criada sem que o fluxo operacional completo esteja mapeado. UX que não reflete um processo real não será desenvolvida.

### Regra 7 — Dado Gerado Uma Vez
Nenhum dado deve ser inserido duas vezes no sistema. Se um dado existe em um módulo, o próximo módulo do fluxo deve consumi-lo automaticamente. Reentrada de dados é um bug de processo.

### Regra 8 — Segurança por Padrão
Todo novo endpoint deve ter autenticação (`requireAuthCore`), verificação de tenant e autorização por perfil (RBAC). Endpoints públicos são exceção e exigem aprovação explícita.

### Regra 9 — Teste antes de Entregar
Nenhuma funcionalidade crítica (pedidos, entregas, contratos) é entregue sem teste funcional documentado. Funcionalidades de suporte podem ter teste simplificado.

### Regra 10 — Fases do Roadmap São Sequenciais
Nenhum módulo de Fase 2 pode ser iniciado sem que os entregáveis de Fase 1 estejam em produção e validados pela equipe. Urgências comerciais não justificam pular fases.

---

## CAPÍTULO 7 — ARQUITETURA FUNCIONAL

### Fluxo Principal de Valor

```
COMERCIAL
    │
    ▼
CLIENTE ──────────────────────────────────────────────────────────────────────┐
    │                                                                         │
    ▼                                                                         │
CONTRATO (escopos, preços, vigência)                                         │
    │                                                                         │
    ▼                                                                         │
PEDIDO (janela de corte, itens, quantidades)                                 │
    │                                                                         │
    ▼                                                                         │
PLANEJAMENTO (consolidação de pedidos → necessidade de compra + produção)    │
    │                                                                         │
    ▼                                                                         │
PRODUÇÃO (ordens de produção por produto/turno)                              │
    │                                                                         │
    ▼                                                                         │
SEPARAÇÃO (montagem de caixas por pedido/rota)                               │
    │                                                                         │
    ▼                                                                         │
CONFERÊNCIA (validação da carga antes da saída)                              │
    │                                                                         │
    ▼                                                                         │
LOGÍSTICA (roteiro, veículo, motorista)                                      │
    │                                                                         │
    ▼                                                                         │
ENTREGA (comprovante digital, ETA ao cliente) ───────────────────────────────┘
    │
    ▼
INDICADORES (dashboard executivo e operacional)
    │
    ▼
RENOVAÇÃO (alerta de vencimento → nova proposta comercial)
    │
    └────────────────────────────────────────────────────► COMERCIAL (ciclo)
```

### Como Cada Módulo Conversa com os Demais

| Módulo Origem | Dado Gerado | Módulo Destino | Como Consome |
|---|---|---|---|
| Comercial | Lead qualificado | CRM / Empresas | Cria registro de empresa |
| CRM / Empresas | Cliente ativo | Contratos | Vincula empresa ao contrato |
| Contratos | Escopos e preços | Pedidos | Pré-popula itens disponíveis |
| Pedidos confirmados | Volume por item/data | Planejamento | Consolida necessidade de produção e compra |
| Planejamento | Ordem de produção | Produção | Dispara ordens por turno |
| Produção | Itens produzidos | Separação | Disponibiliza para montagem de caixas |
| Separação | Caixas montadas por pedido | Conferência | Lista para verificação |
| Conferência | Carga aprovada | Logística | Libera saída do veículo |
| Logística | Roteiro e motorista | Painel do Motorista | Mostra rota e entregas do dia |
| Entrega | Comprovante digital | Pedido / Portal Cliente | Atualiza status para "entregue" |
| Todos | Eventos e métricas | Dashboard | KPIs em tempo real |
| Todos | Dúvidas e análises | Clara IA | Responde com dados contextuais |
| Entregas / Pedidos | Histórico e status | Portal do Cliente | Autoatendimento |
| Contratos | Data de vencimento | Sistema de alertas | Disparo proativo de renovação |

### Separação de Camadas

```
PORTAL DO CLIENTE (acesso externo, autenticado por e-mail/token)
    ↓
PORTAL INTERNO (acesso por perfil RBAC — ADMIN, SALES, OPERATOR, LOGISTICS...)
    ↓
API REST (Express — autenticação obrigatória em todos os endpoints)
    ↓
SERVIÇOS DE DOMÍNIO (regras de negócio por módulo)
    ↓
REPOSITÓRIO (storage.ts — único ponto de acesso ao banco)
    ↓
BANCO DE DADOS (PostgreSQL / Supabase — multi-schema, tenant-safe)
```

---

## CAPÍTULO 8 — ROADMAP

### FASE 1 — Consolidar Operação (Agora → 90 dias)
**Objetivo:** Todos os processos do fluxo principal rodando 100% no sistema, sem controles paralelos obrigatórios.

**Entregáveis:**
- [ ] Ocultar todos os módulos congelados da navegação
- [ ] Produção: digitalizar ordem de produção diária (eliminar papel)
- [ ] Separação: romaneio digital por pedido (eliminar papel impresso)
- [ ] Conferência: checklist digital de carga (eliminar papel)
- [ ] Logística: disparo automático de roteiro para motorista (eliminar WhatsApp)
- [ ] Entregas: comprovante digital com foto (eliminar papel de entrega)
- [ ] Contratos: alerta automático de vencimento (eliminar perda de renovação)
- [ ] Dashboard: KPIs operacionais em tempo real (eliminar compilação manual)
- [ ] Segurança: corrigir senha MASTER hardcoded, proteger endpoints públicos

**Critério de sucesso:** Operação de um dia completo (pedido → entrega) sem WhatsApp ou papel como meio principal.

---

### FASE 2 — Eliminar Controles Paralelos (90 → 180 dias)
**Objetivo:** Excel, WhatsApp e papel deixam de ser opção, não apenas deixam de ser obrigatórios.

**Entregáveis:**
- [ ] Planejamento de compras alimentado automaticamente por pedidos confirmados
- [ ] Relatório de perdas integrado ao estoque (sem exportação para Excel)
- [ ] Renovação de contrato com aproveitamento de histórico e confirmação digital
- [ ] Notificação de ETA ao cliente via portal (sem WhatsApp)
- [ ] Relatório diário automático gerado por Clara IA
- [ ] Trilhas de treinamento no Academy por perfil de usuário

**Critério de sucesso:** Nenhum departamento usa planilha ou WhatsApp como ferramenta principal de trabalho.

---

### FASE 3 — Portal do Cliente (180 → 270 dias)
**Objetivo:** Cliente consegue se autoatender sem contato com a VivaFrutaz para ações rotineiras.

**Entregáveis:**
- [ ] Portal do Cliente com onboarding guiado
- [ ] Cliente confirma/cancela pedido pelo portal
- [ ] Cliente consulta histórico de pedidos e faturas
- [ ] Cliente rastreia entrega em tempo real (ETA)
- [ ] Cliente solicita cotação de novo item pelo portal
- [ ] Clara IA disponível no Portal do Cliente (FAQ + consultas simples)

**Critério de sucesso:** 70% das consultas de clientes resolvidas sem intervenção da equipe.

---

### FASE 4 — Clara IA Integrada (270 → 360 dias)
**Objetivo:** Clara IA deixa de ser consultiva e passa a ser acionável.

**Entregáveis:**
- [ ] Clara cria tarefas diretamente a partir de análises (ex: "há risco de ruptura de estoque — criar ordem de compra?")
- [ ] Clara identifica padrões de churn e dispara alerta para comercial
- [ ] Clara sugere otimização de rotas com base em histórico de entregas
- [ ] Clara Academy responde dúvidas de uso do próprio sistema

**Critério de sucesso:** Clara IA é usada ativamente por pelo menos 3 departamentos diferentes toda semana.

---

### FASE 5 — Fiscal (Opcional, conforme demanda legal)
**Objetivo:** Emissão de NF-e integrada ao fluxo de entrega.

**Pré-requisitos:**
- Validação contábil e jurídica
- Homologação em ambiente SEFAZ
- Treinamento da equipe financeira
- Revisão do certificado digital

**Entregáveis:**
- [ ] Descongelar módulo NF-e
- [ ] Integrar emissão de NF-e ao fechamento de pedido
- [ ] DANFE gerado e enviado ao cliente automaticamente
- [ ] Gestão de série e número de forma auditada

---

### FASE 6 — Financeiro Avançado (Opcional, conforme demanda)
**Objetivo:** Ciclo financeiro completo dentro do portal.

**Pré-requisitos:**
- NF-e ativa (Fase 5)
- Convênio bancário ativo

**Entregáveis:**
- [ ] Descongelar módulo de boletos / PIX
- [ ] Contas a receber integradas ao pedido
- [ ] DRE automático por período
- [ ] Conciliação bancária via CNAB

---

## CAPÍTULO 9 — DECISÕES OFICIAIS (ADRs)

As ADRs (Architecture Decision Records) abaixo são **permanentes** e só podem ser revisadas por nova ADR que as substitua explicitamente.

---

### ADR-001 — Foco Exclusivo na Operação da VivaFrutaz
**Data:** Julho 2026
**Decisão:** O Portal VivaFrutaz é e permanecerá, na V1, um sistema ERP operacional focado exclusivamente nos processos internos da VivaFrutaz. Não é um produto SaaS comercializável nesta versão.
**Consequência:** Módulos SaaS, Marketplace e White-label ficam congelados. Toda UX é projetada para o usuário interno da VivaFrutaz, não para um usuário genérico.

---

### ADR-002 — NF-e Permanece Congelada até a Fase 5
**Data:** Julho 2026
**Decisão:** O módulo NF-e, apesar de tecnicamente maduro (sequence atômica, idempotência, concorrência resolvidas), não será ativado para uso operacional até a Fase 5 do Roadmap.
**Consequência:** Rotas `/api/nfe/*` permanecem acessíveis somente para MASTER. Frontend NF-e fica oculto da navegação para todos os outros perfis.

---

### ADR-003 — Integrações Bancárias Permanecem Congeladas até a Fase 6
**Data:** Julho 2026
**Decisão:** PIX, Boletos, CNAB e qualquer integração com instituição financeira ficam congelados até a Fase 6, após validação do módulo financeiro e da NF-e.
**Consequência:** Middleware de billing/assinatura não bloqueia acesso operacional. Módulo de cobrança automática não é exposto.

---

### ADR-004 — Eliminação Gradual de Excel, WhatsApp e Papel
**Data:** Julho 2026
**Decisão:** Toda nova funcionalidade deve obrigatoriamente eliminar ou reduzir o uso de um controle paralelo existente (Excel, WhatsApp ou papel). Funcionalidades que não eliminam nada não serão desenvolvidas.
**Consequência:** O Backlog Estratégico (Cap. 5) é a referência para priorização. Funcionalidades "nice to have" são vetadas em favor de substitutos diretos de controles manuais.

---

### ADR-005 — Portal do Cliente Faz Parte da V1
**Data:** Julho 2026
**Decisão:** O Portal do Cliente é um entregável oficial da V1 (Fase 3). O cliente externo tem acesso autenticado para consulta de pedidos, histórico e rastreamento de entrega.
**Consequência:** A arquitetura de autenticação deve suportar dois públicos distintos: usuário interno (RBAC por perfil) e usuário externo (cliente, acesso limitado ao seu próprio histórico).

---

### ADR-006 — Dado Gerado Uma Vez
**Data:** Julho 2026
**Decisão:** Nenhum módulo pode exigir que o usuário reinsira dados já existentes no sistema. O fluxo de dados deve ser unidirecional e encadeado (Comercial → Contrato → Pedido → Produção → Entrega).
**Consequência:** Qualquer quebra neste encadeamento é classificada como bug de processo e tem prioridade de correção equivalente a bug crítico.

---

### ADR-007 — Segurança por Padrão em Todo Endpoint
**Data:** Julho 2026
**Decisão:** Todo endpoint da API requer autenticação, verificação de tenant e autorização por perfil. Exceções (rotas públicas) precisam de aprovação explícita documentada.
**Consequência:** A senha MASTER hardcoded (identificada na auditoria de segurança) deve ser removida antes do início da Fase 1. Endpoints de métricas NF-e sem autenticação devem ser protegidos como pré-requisito da Fase 1.

---

### ADR-008 — Clara IA Como Camada Analítica, Não Como Substituta de Módulos
**Data:** Julho 2026
**Decisão:** Clara IA é uma camada de inteligência sobre os dados gerados pelos módulos operacionais. Não substitui nenhum módulo, não cria dados sem confirmação humana e não acessa sistemas externos sem autorização.
**Consequência:** Clara IA só pode ser tão boa quanto os dados que os módulos operacionais alimentam. A qualidade dos dados operacionais é pré-requisito para a Fase 4.

---

### ADR-009 — Academy Como Produto Vivo
**Data:** Julho 2026
**Decisão:** O Academy não é um repositório estático. Todo módulo novo ou atualizado deve ter um conteúdo correspondente no Academy (vídeo, guia ou FAQ) antes de entrar em produção.
**Consequência:** Nenhuma funcionalidade é "entregue" sem material de capacitação disponível para o perfil que vai usá-la.

---

## APÊNDICE — GLOSSÁRIO

| Termo | Definição |
|---|---|
| **Módulo Congelado** | Módulo existente no código, invisível na UI e inacessível para usuários operacionais |
| **Módulo Oculto** | Similar a congelado; a distinção é que "oculto" pode ser ativado por configuração sem nova ADR |
| **Controle Paralelo** | Ferramenta externa (Excel, WhatsApp, papel) usada para suprir uma lacuna do sistema |
| **Fluxo Principal** | Sequência Comercial → Entrega → Indicadores → Renovação |
| **Clara IA** | Assistente de inteligência artificial integrado ao ERP para consultas e análises operacionais |
| **Portal do Cliente** | Interface web para o cliente externo consultar seus pedidos e histórico |
| **ADR** | Architecture Decision Record — decisão de arquitetura registrada formalmente |
| **V1** | Versão 1 do Portal — escopo definido neste documento |
| **Gap** | Lacuna entre o processo ideal e o que o sistema atual suporta |

---

*Documento gerado em Julho de 2026.*
*Próxima revisão prevista: Outubro de 2026 (ao final da Fase 1).*
*Proprietário: CTO / Product Owner VivaFrutaz.*
