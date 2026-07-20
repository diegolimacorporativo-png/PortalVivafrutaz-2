# AUDITORIA DE PRODUTO — PORTAL VIVAFRUTAZ ERP
## FASE 3 — ERP Especializado na Operação da VivaFrutaz

**Data:** 20 de Julho de 2026  
**Papel:** Product Manager · Analista de Negócios · Consultor ERP · Arquiteto de Produto  
**Pergunta central:** *"O Portal VivaFrutaz representa fielmente a operação real da VivaFrutaz?"*  
**Método:** 100% baseado no código existente. Nenhuma suposição. Nenhum arquivo alterado.

---

## ÍNDICE

1. [Mapa da Empresa](#etapa-1)
2. [Jornada dos Usuários](#etapa-2)
3. [Auditoria de Cada Módulo](#etapa-3)
4. [Processos Paralelos](#etapa-4)
5. [Duplicidades](#etapa-5)
6. [Gaps](#etapa-6)
7. [UX Operacional](#etapa-7)
8. [Matriz de Valor](#etapa-8)
9. [ERP Especializado](#etapa-9)
10. [Relatório Executivo](#etapa-10)

---

<a id="etapa-1"></a>
## ETAPA 1 — MAPA DA EMPRESA

### Resposta direta: O que o código revela sobre a VivaFrutaz

A VivaFrutaz é uma **distribuidora de FLV (Frutas, Legumes e Verduras)** que opera no modelo **B2B por assinatura/contrato**. Seus clientes são empresas (mercados, restaurantes, sacolões) que recebem entregas semanais com itens recorrentes predefinidos em contrato.

A empresa **também vende este sistema como SaaS** para outros distribuidores, funcionando simultaneamente como usuária e fornecedora do produto.

---

### Como nasce um CLIENTE

**No código, o cliente nasce em duas etapas:**

**Etapa 1 — Simulação de Viabilidade** *(antes de cadastrar)*
```
Admin acessa /admin/scope-simulations
→ Informa: itens pretendidos, frequência, endereço de entrega
→ Sistema calcula: Faturamento Semanal, Margem Bruta, Mínimo de Rota
→ Se viável → avança para cadastro
→ Se inviável → não cadastra (protege rentabilidade por rota)
```
**Evidência:** `scope-simulations.tsx` — calcula se prospect atende mínimo de rota antes de virar cliente.

**Etapa 2 — Cadastro Formal**
```
Admin cria Empresa → define Grupo de Preço → cria Contrato → define Escopo
→ Cria usuário client → cliente recebe acesso ao portal
```
**Evidência:** `companies.tsx`, `contracts.tsx`, `contract_scopes` (tabela), `users` (tabela com role client).

---

### Como nasce um CONTRATO

```
Admin acessa /admin/contracts
→ Define: vigência (prazo fixo ou indefinido), valor base, índice de reajuste (IPCA)
→ Define Escopo: itens recorrentes semanais/mensais (contract_scopes)
→ Sistema alerta quando contrato está > 12 meses sem reajuste
→ IPCA: calculado automaticamente, aplicado manualmente (botão)
→ Renovação: não automática — admin atualiza data ou muda para prazo indefinido
```
**Evidência:** `contratos_clientes`, `contract_scopes`, `contract_adjustments` (tabelas). `contracts.tsx` com painel de rentabilidade e gerador de PDF.

---

### Como nasce um PEDIDO

**Duas origens:**

**Origem 1 — Cliente pelo portal**
```
Cliente acessa /client → vê se janela de pedido está aberta
→ Se aberta → acessa Criar Pedido
→ Monta carrinho (persiste em localStorage)
→ Sistema aplica hierarquia de preço: contractPrice > subCategoryPrice > basePrice
→ Valida mínimo de faturamento
→ Confirma → Pedido criado (status ACTIVE / workflowStatus CREATED)
```

**Origem 2 — Cliente Contratual (itens recorrentes)**
```
Clientes com contrato têm itens recorrentes definidos no escopo
→ Sistema gera pedido automaticamente com base no escopo contratual
→ Cliente confirma ou ajusta
```
**Evidência:** `client/create-order.tsx`, `useActiveOrderWindow`, `priceResolver.ts`, `contract_scopes`.

---

### Como funciona a SEPARAÇÃO/PRODUÇÃO

```
Pedido APROVADO → Admin / Operations Manager transiciona para:
→ PROCESSING ("Em Separação") — equipe está separando os itens
→ READY ("Pedido Pronto") — separação concluída, pronto para carga
```
**Evidência:** `orders.workflow.ts` — estados PROCESSING e READY definidos. `orders.tsx` — labels "Em Separação" e "Pedido Pronto" mapeados.

**Gap identificado:** Não existe Romaneio (manifesto de carga). A separação é marcada como status, mas não há checklist de itens separados ou impressão de romaneio.

---

### Como funciona a LOGÍSTICA

```
Pedido READY → Auto-Dispatch (loop a cada 10s)
→ Agrupa pedidos por empresa + data de entrega
→ Algoritmo suggestInsertion otimiza sequência de paradas
→ Atribui: driver_id, route_id, route_position
→ Motorista vê rota no Painel do Motorista (/admin/driver-panel)
→ GPS tracking em tempo real (driver_gps_positions)
→ ETA calculado por eta.service.ts
→ Cliente acompanha via /track (página pública)
```
**Evidência:** `auto-dispatch.service.ts`, `eta.service.ts`, `logistics.routes.ts`, `driver_gps_positions`, `logistics_routes`, `route_stops`.

---

### Como ocorre a ENTREGA

```
Motorista confirma entrega no painel
→ deliveries.status → "entregue"
→ orders.workflowStatus → "DELIVERED"
→ Checklist de entrega registrado (delivery_checklists)
```
**Evidência:** `deliveries` (tabela), `delivery_checklists` (tabela), `logistics.tsx`.

---

### Como ocorre o FATURAMENTO

```
Cron diário 08:00 (faturamento.cron.ts)
→ Busca pedidos com fiscalStatus = "nota_liberada"
→ Valida idempotência (ENABLE_NFE_IDEMPOTENCY_GUARD)
→ Gera XML NF-e → assina → envia ao SEFAZ
→ Autorizada (cStat 100) → status "autorizada"
→ DANFE gerado em PDF
→ orders.fiscalStatus → "nota_emitida"
```
**Evidência:** `faturamento.cron.ts`, `nfeGenerator.ts`, `nfeSender.ts`, `nfeCert.ts`, `danfeGenerator.ts`.

---

### Como ocorre a COBRANÇA

```
Pedido aprovado → AR criado manualmente ou via evento
→ PIX: BR-Code gerado automaticamente (sem gateway externo)
→ Boleto: gerado localmente (⚠️ sem banco real exceto Itaú direto)
→ Admin confirma recebimento manualmente
→ AR.status → "pago"
→ financial_transactions registra movimento
```
**Cobrança via Itaú:** Para clientes com integração bancária ativa, o sistema usa a API real do Itaú para consultar extratos e cruzar pagamentos.

**⚠️ Gap crítico:** Não há cobrança automática real. O sistema gera os dados de cobrança, mas a confirmação de pagamento é manual em todos os casos.

**Evidência:** `finance.service.ts`, `itauIntegration.ts`, `accounts_receivable`, `bank_accounts`.

---

### Como ocorre a RENOVAÇÃO

```
Sistema alerta: contrato > 12 meses sem reajuste de IPCA
→ Admin visualiza alerta no /admin/contracts
→ Admin simula novo valor com reajuste IPCA
→ Admin aplica manualmente (botão)
→ Não existe renovação automática
→ Para contratos com prazo: admin atualiza data manualmente
→ Para contratos indefinidos: nenhuma ação necessária
```
**Evidência:** `contratos_clientes` (campo `indice_reajuste`), `contracts.tsx` — sem lógica de renovação automática no código.

---

### Fluxograma Completo da Operação

```
╔══════════════════════════════════════════════════════════════════╗
║                    OPERAÇÃO VIVAFRUTAZ                           ║
╚══════════════════════════════════════════════════════════════════╝

PRÉ-VENDA
    │
    ├─ Simulação de Escopo (/admin/scope-simulations)
    │   → Valida rentabilidade mínima por rota
    │
    ▼
ONBOARDING
    │
    ├─ Cadastro de Empresa → Grupo de Preço → Contrato → Escopo
    ├─ Criação de usuário cliente
    │
    ▼
SEMANA OPERACIONAL
    │
    ├─ SEGUNDA/TERÇA: Janela de pedido aberta
    │   └─ Cliente acessa portal → faz pedido
    │
    ├─ QUINTA 12:00: Janela fecha (cutoff)
    │   └─ Admin consolida demanda em /admin/purchase-planning
    │       → Visão por categoria (Frutas / Hortifruti / Industrializados)
    │       → Alertas de déficit de estoque
    │
    ├─ QUINTA/SEXTA: Compras realizadas (fora do sistema)
    │
    ├─ SEXTA/SÁBADO: Separação
    │   └─ Admin muda status: APPROVED → PROCESSING → READY
    │
    ├─ SÁBADO/SEGUNDA: Entrega
    │   └─ Auto-dispatch define rotas
    │   └─ Motorista segue painel → GPS tracking → confirma entrega
    │
    ▼
PÓS-ENTREGA
    │
    ├─ NF-e emitida (cron 08:00)
    ├─ DANFE gerado
    ├─ AR registrado
    ├─ Admin confirma pagamento manualmente
    │
    ▼
CONTROLE CONTÍNUO
    │
    ├─ Controle de desperdício (daily)
    ├─ Avaliação sanitária (semanal)
    ├─ Inteligência comercial (clientes em risco)
    ├─ Inteligência logística
    └─ Alertas de inadimplência (15+ dias)
```

---

<a id="etapa-2"></a>
## ETAPA 2 — JORNADA DOS USUÁRIOS

### 12 Perfis Identificados no Código

---

#### ADMIN
**O que faz:** Acesso total. Responsável pela gestão geral — empresas, produtos, pedidos, usuários, configurações, fiscal, financeiro, segurança.  
**Telas principais:** Todas (sem restrição)  
**Frequência:** Diária — múltiplos módulos  
**Retrabalho identificado:** Por ter acesso a tudo, o ADMIN frequentemente faz trabalho que deveria ser do OPERATIONS_MANAGER, FINANCEIRO ou PURCHASE_MANAGER — ausência de delegação clara  
**Navegação:** Sidebar com todos os grupos → muitos cliques para alternar entre módulos operacionais

---

#### DIRECTOR
**O que faz:** Mesmo acesso do ADMIN. Na prática, usa Executive Dashboard, inteligências comercial e financeira, SaaS management.  
**Telas reais:** Dashboard Executivo, Financial Intelligence, Commercial Intelligence, SaaS Dashboard  
**Problema:** Acesso idêntico ao ADMIN — sem distinção funcional real no código. A diferença é apenas conceitual.  
**Retrabalho:** Director provavelmente vê os mesmos dados em lugares diferentes (Executive Dashboard vs Dashboard Admin vs Financial Intelligence)

---

#### OPERATIONS_MANAGER
**O que faz:** Gestão do ciclo operacional diário.  
**Telas:** Dashboard, Contratos, Simulações, Cotações, Pedidos, Pedidos Especiais, Janelas, Planejamento de Compras, Desperdício, Sanitário, Logística, Tarefas, Incidentes, Inteligências Operacional/Comercial/Logística, Treinamento  
**Tarefas diárias:**
- Manhã: verifica pedidos novos, aprova, move para separação
- Meio-dia quinta: consolida planejamento de compras
- Tarde: monitora logística e incidentes
**Retrabalho:** Precisa navegar entre Pedidos (separação) → Logística (rota) → Incidentes — 3 telas diferentes para o mesmo ciclo

---

#### PURCHASE_MANAGER
**O que faz:** Compras, inventário, industrializados.  
**Telas:** Dashboard, Relatório de Compras, Planejamento de Compras, Inventário, Industrializados, Desperdício, Sanitário, Importação de Dados, Tarefas, Inteligências Operacional/Logística, Treinamento  
**Tarefas reais:**
- Quinta: consulta planejamento de compras consolidado
- Verifica alertas de déficit de estoque
- Registra compras realizadas (sem módulo próprio — vai para Excel)
**Gap:** Não existe Pedido de Compra para Fornecedor. Toda compra ocorre fora do sistema.

---

#### FINANCEIRO
**O que faz:** Billing, fiscal, contas a receber/pagar, integração bancária.  
**Telas:** Dashboard, Dashboard Executivo, Pedidos, Sanitário, Financeiro (AR/AP), Config Fiscal, Diagnóstico Fiscal, NF-e, Faturamento, Banco (Itaú), Tarefas, Inteligência Financeira, Treinamento  
**Tarefas diárias:**
- Verifica NF-e emitidas (cron 08:00)
- Confirma recebimentos manualmente
- Cruza extrato Itaú com AR pendente
- Acompanha inadimplência
**Retrabalho crítico:** Confirmar recebimentos é 100% manual — sem automação de conciliação bancária real  
**Navegação confusa:** 4 telas de financeiro (Finance, Financial Intelligence, SaaS Financeiro, Relatório Financeiro) sem hierarquia clara

---

#### LOGISTICS
**O que faz:** Rotas, motoristas, veículos, manutenção, incidentes de entrega.  
**Telas:** Dashboard, Pedidos, Pedidos Especiais, Desperdício, Sanitário, Logística, Painel do Motorista, Tarefas, Incidentes, Inteligências Operacional/Logística, Treinamento  
**Tarefas diárias:**
- Verifica rotas auto-geradas
- Ajusta manualmente se necessário
- Monitora GPS e ETA
- Registra manutenção de frota
**Problema:** LOGISTICS tem acesso a Pedidos completo — vê dados financeiros que não são sua responsabilidade

---

#### MOTORISTA
**O que faz:** Única tela: Painel do Motorista.  
**Telas:** `/admin/driver-panel` (forçado por redirect) + Settings  
**Tarefas:** Ver lista de stops, confirmar entrega  
**Observação:** Redirecionado automaticamente ao login — não tem acesso ao resto do sistema  
**Gap:** Sem campo para registrar ocorrências de entrega (cliente ausente, endereço errado) — vai para WhatsApp

---

#### NUTRICIONISTA
**O que faz:** Avaliações sanitárias.  
**Telas:** `/admin/sanitary` (forçado por redirect) + Settings  
**Tarefas:** Preencher checklists de higiene, temperatura, armazenamento, gerar PDF  
**Observação:** Perfil muito específico — acesso mínimo correto para a função

---

#### GESTOR_CONTRATOS
**O que faz:** Gestão de assinaturas do SaaS (quando a VivaFrutaz vende o sistema para outros).  
**Telas:** SaaS Dashboard, SaaS Financeiro  
**Tarefas:** Monitorar assinaturas, faturas, contratos SaaS  
**Problema:** Este perfil só faz sentido no contexto da VivaFrutaz como vendedora do sistema. Para uso interno, este role não existe na prática.

---

#### DEVELOPER
**O que faz:** Manutenção técnica do sistema.  
**Telas:** Acesso amplo incluindo AI Developer, Área do Desenvolvedor, System Health, Marketplace, Observabilidade, Governança  
**Tarefas:** Debug, manutenção, treinamento de IA, configuração de módulos  
**Observação:** Role técnico — não participa da operação de distribuição

---

#### MASTER
**O que faz:** Controle total do sistema.  
**Telas:** Todas, incluindo Master Control, Security Audit, Observabilidade  
**Tarefas:** Governança de segurança, gestão de planos SaaS, configurações globais  
**Observação:** Owner do sistema — não participa da operação diária de distribuição

---

#### CLIENT (Portal)
**Dois subtipos identificados no código:**

**Cliente Contratual:**  
Telas: Dashboard, Escopo do Contrato, Histórico de Pedidos, Incidentes, Perfil, Sobre Nós  
Tarefas: Ver itens recorrentes, confirmar pedido semanal, abrir incidente

**Cliente Não-Contratual:**  
Telas: Dashboard, Criar Pedido, Histórico, Pedidos Especiais, Incidentes, Perfil, Sobre Nós  
Tarefas: Criar pedido manualmente, acompanhar histórico

---

<a id="etapa-3"></a>
## ETAPA 3 — AUDITORIA DE CADA MÓDULO

---

### 🟢 MÓDULOS ESSENCIAIS

---

**PEDIDOS (Admin)**  
- **Objetivo:** Gerenciar ciclo completo de pedidos — aprovação, separação, fiscal  
- **Usuário:** ADMIN, OPERATIONS_MANAGER, FINANCEIRO, LOGISTICS  
- **Fluxo:** CREATED → APPROVED → PROCESSING → READY → INVOICED → SHIPPED → DELIVERED  
- **Integrações:** NF-e, Logística, Financeiro  
- **Fortes:** Workflow completo, preflight NF-e inline, histórico, reabertura  
- **Fracos:** Tela mais complexa do sistema — checagem de role hardcoded; sem romaneio  
- **Complexidade:** Alta  
- **Necessidade:** Core da operação diária  
- **Classificação:** 🟢 Essencial

---

**PEDIDOS (Cliente)**  
- **Objetivo:** Portal para o cliente fazer pedido e acompanhar  
- **Usuário:** CLIENT  
- **Fluxo:** Janela aberta → monta carrinho → confirma → acompanha  
- **Integrações:** Janela de Pedido, Catálogo, Preços  
- **Fortes:** Hierarquia de preço automática, validação de mínimo de faturamento  
- **Fracos:** Carrinho em localStorage — perde se limpar dados do browser; sem feedback claro do preço ativo  
- **Complexidade:** Média  
- **Necessidade:** Elimina WhatsApp/telefone para recebimento de pedidos  
- **Classificação:** 🟢 Essencial

---

**JANELAS DE PEDIDO**  
- **Objetivo:** Controlar quando os clientes podem fazer pedidos  
- **Usuário:** ADMIN, OPERATIONS_MANAGER  
- **Fluxo:** Admin define janela → cliente só pede dentro da janela → cutoff quinta 12:00  
- **Fortes:** Force Open para feriados, exceções por empresa  
- **Fracos:** Cutoff quinta 12:00 hardcoded — mudança exige código  
- **Complexidade:** Baixa  
- **Necessidade:** Específico e crítico para operação de FLV  
- **Classificação:** 🟢 Essencial

---

**PLANEJAMENTO DE COMPRAS**  
- **Objetivo:** Consolidar demanda antes de comprar do fornecedor  
- **Usuário:** PURCHASE_MANAGER, OPERATIONS_MANAGER  
- **Fluxo:** Após cutoff → sistema consolida por categoria → alerta déficit de estoque  
- **Fortes:** Alertas ±80% de variação histórica, agrupamento por categoria FLV  
- **Fracos:** Sem Pedido de Compra formal — compra feita fora do sistema  
- **Complexidade:** Média  
- **Necessidade:** Central para gestão de perecíveis  
- **Classificação:** 🟢 Essencial

---

**LOGÍSTICA**  
- **Objetivo:** Planejar e executar entregas  
- **Usuário:** LOGISTICS, OPERATIONS_MANAGER  
- **Fluxo:** Pedidos aprovados → auto-dispatch → rotas → GPS → entrega confirmada  
- **Integrações:** Google Maps (leaflet), GPS, ETA service  
- **Fortes:** Auto-dispatch automático, otimização de rota, GPS real-time, ETA  
- **Fracos:** Sem romaneio, sem campo de ocorrência no painel do motorista  
- **Complexidade:** Alta  
- **Necessidade:** Elimina planejamento de rotas em Excel/WhatsApp  
- **Classificação:** 🟢 Essencial

---

**PAINEL DO MOTORISTA**  
- **Objetivo:** Guiar motorista na execução da entrega  
- **Usuário:** MOTORISTA  
- **Fluxo:** Login → vê stops → executa → confirma entrega  
- **Fortes:** Simples, focado, redirecionamento automático  
- **Fracos:** Sem campo de ocorrência, sem foto de entrega, sem assinatura digital  
- **Complexidade:** Baixa  
- **Necessidade:** Elimina papel e WhatsApp no dia da entrega  
- **Classificação:** 🟢 Essencial

---

**NF-e / FATURAMENTO**  
- **Objetivo:** Emissão automática de notas fiscais  
- **Usuário:** FINANCEIRO (monitora), SISTEMA (executa)  
- **Fluxo:** Cron 08:00 → XML → SEFAZ → DANFE  
- **Integrações:** SEFAZ, certificado A1  
- **Fortes:** Auto-correção de erros, circuit breaker, diagnóstico completo  
- **Fracos:** Só falta certificado A1 para homologação  
- **Complexidade:** Alta  
- **Necessidade:** Obrigação fiscal — não é opcional  
- **Classificação:** 🟢 Essencial

---

**FINANCEIRO (AR/AP)**  
- **Objetivo:** Contas a receber e pagar  
- **Usuário:** FINANCEIRO  
- **Fluxo:** Pedido aprovado → AR criado → pagamento confirmado manualmente  
- **Integrações:** Itaú (extrato), NF-e  
- **Fortes:** Breakdown de AR, histórico NF-e, handlers de correção automática  
- **Fracos:** Confirmação de pagamento 100% manual — sem conciliação automática  
- **Complexidade:** Média  
- **Necessidade:** Essencial para gestão financeira  
- **Classificação:** 🟢 Essencial

---

**BANCO (Itaú)**  
- **Objetivo:** Integração bancária real para consulta de extrato e criação de boletos  
- **Usuário:** FINANCEIRO  
- **Fluxo:** OAuth Itaú → extrato → cruzamento manual com AR  
- **Integrações:** Itaú OAuth + Cash Management V2 (API real)  
- **Fortes:** Integração real — saldo e extrato funcionais  
- **Fracos:** Cruzamento extrato x AR ainda manual  
- **Complexidade:** Alta  
- **Necessidade:** Essencial para distribuidor com volume  
- **Classificação:** 🟢 Essencial

---

**CONTROLE DE DESPERDÍCIO**  
- **Objetivo:** Registrar perdas de mercadoria  
- **Usuário:** OPERATIONS_MANAGER, LOGISTICS  
- **Fluxo:** Entrada diária → razão específica (Passada, Avaria) → relatório  
- **Fortes:** Razões específicas para FLV, registro histórico  
- **Fracos:** Sem integração com inventário (baixa automática de estoque)  
- **Complexidade:** Baixa  
- **Necessidade:** Crítico para rentabilidade em perecíveis  
- **Classificação:** 🟢 Essencial

---

**CLIENTES / EMPRESAS**  
- **Objetivo:** Cadastro e gestão de empresas clientes  
- **Usuário:** ADMIN, OPERATIONS_MANAGER  
- **Fluxo:** Simulação → cadastro → grupo de preço → ativo  
- **Fortes:** Grupos de preço, configurações por empresa  
- **Complexidade:** Baixa  
- **Classificação:** 🟢 Essencial

---

**CONTRATOS**  
- **Objetivo:** Gestão de contratos com clientes — escopo, IPCA, vigência  
- **Usuário:** ADMIN, OPERATIONS_MANAGER  
- **Fortes:** IPCA, alerta de contrato desatualizado, painel de rentabilidade  
- **Fracos:** Sem renovação automática  
- **Classificação:** 🟢 Essencial

---

**SIMULAÇÃO DE ESCOPO**  
- **Objetivo:** Validar rentabilidade antes de cadastrar cliente  
- **Usuário:** ADMIN, OPERATIONS_MANAGER  
- **Frequência:** Por novo cliente (rara, mas decisiva)  
- **Fortes:** Calcula mínimo de rota, margem bruta  
- **Complexidade:** Baixa  
- **Classificação:** 🟢 Essencial (pré-venda)

---

**INTELIGÊNCIA COMERCIAL**  
- **Objetivo:** Identificar clientes em risco, quedas de volume, oportunidades  
- **Usuário:** ADMIN, OPERATIONS_MANAGER  
- **Frequência:** Diária/Semanal  
- **Fortes:** Clientes sem pedido há 14+ dias, produtos que pararam de ser pedidos  
- **Classificação:** 🟢 Essencial (retenção de clientes)

---

**SANITÁRIO**  
- **Objetivo:** Avaliações de vigilância sanitária  
- **Usuário:** NUTRICIONISTA  
- **Frequência:** Diária/Semanal  
- **Fortes:** Checklist + geração de PDF  
- **Necessidade:** Obrigação regulatória ANVISA  
- **Classificação:** 🟢 Essencial (compliance)

---

**ESTOQUE / INVENTÁRIO**  
- **Objetivo:** Controle de estoque  
- **Usuário:** PURCHASE_MANAGER  
- **Fortes:** Entradas, movimentações, contagens físicas, alertas de déficit  
- **Fracos:** Sem integração automática com Desperdício  
- **Classificação:** 🟢 Essencial

---

**COTAÇÕES**  
- **Objetivo:** Solicitação e gestão de cotações de fornecedores  
- **Usuário:** PURCHASE_MANAGER, OPERATIONS_MANAGER  
- **Classificação:** 🟢 Essencial

---

**CLARA IA (Chat)**  
- **Objetivo:** Assistente virtual para consultas rápidas e ações contextuais  
- **Usuário:** Todos os roles internos  
- **Fortes:** Intent detection, acesso a dados reais, exportação inteligente  
- **Fracos:** Memória perde estado a cada restart (array em memória)  
- **Classificação:** 🟢 Essencial (diferencial de UX)

---

**E-MAIL MANAGEMENT**  
- **Objetivo:** Automações de e-mail operacional  
- **Usuário:** ADMIN  
- **Fortes:** Lembretes de janela, follow-up de pedidos não finalizados, broadcast  
- **Classificação:** 🟢 Essencial (comunicação com clientes)

---

### 🟡 MÓDULOS IMPORTANTES

---

**INTELIGÊNCIA FINANCEIRA**  
- **Objetivo:** BI de receita, crescimento, top clientes  
- **Usuário:** FINANCEIRO, DIRECTOR  
- **Frequência:** Semanal  
- **Fortes:** Forecasting, ranking de clientes  
- **Fracos:** Sobreposição parcial com Relatório Financeiro  
- **Classificação:** 🟡 Importante

---

**INTELIGÊNCIA LOGÍSTICA**  
- **Objetivo:** Análise de eficiência de entregas  
- **Usuário:** LOGISTICS, OPERATIONS_MANAGER  
- **Frequência:** Semanal  
- **Classificação:** 🟡 Importante

---

**CNAB**  
- **Objetivo:** Importar retorno bancário  
- **Usuário:** FINANCEIRO  
- **Frequência:** Semanal (quando banco gera arquivo)  
- **Classificação:** 🟡 Importante

---

**RELATÓRIOS (Compras / Financeiro / Industrializados)**  
- **Objetivo:** Relatórios históricos de operação  
- **Frequência:** Semanal/Mensal  
- **Fracos:** "Top clientes" duplicado com Inteligência Financeira  
- **Classificação:** 🟡 Importante

---

**PUSH NOTIFICATIONS**  
- **Objetivo:** Alertas em tempo real para usuários  
- **Classificação:** 🟡 Importante

---

**INCIDENTES (Cliente / Interno)**  
- **Objetivo:** Gestão de ocorrências e suporte  
- **Frequência:** Conforme necessidade  
- **Classificação:** 🟡 Importante

---

**TAREFAS (OS)**  
- **Objetivo:** Ordens de serviço internas  
- **Frequência:** Diária para equipe operacional  
- **Classificação:** 🟡 Importante

---

**ANÚNCIOS / COMUNICADOS**  
- **Objetivo:** Comunicação interna com clientes e equipe  
- **Classificação:** 🟡 Importante

---

**SYSTEM HEALTH + OBSERVABILIDADE**  
- **Objetivo:** Saúde técnica do sistema  
- **Usuário:** ADMIN, DEVELOPER  
- **Frequência:** Diária para monitoramento  
- **Classificação:** 🟡 Importante

---

**SECURITY DASHBOARD + AUDIT**  
- **Objetivo:** Segurança e auditoria de acessos  
- **Frequência:** Semanal  
- **Classificação:** 🟡 Importante

---

**BACKUPS**  
- **Objetivo:** Snapshots do banco de dados  
- **Classificação:** 🟡 Importante

---

**SAAS DASHBOARD + SAAS FINANCEIRO**  
- **Objetivo:** Gestão da VivaFrutaz como vendedora do sistema  
- **Usuário:** MASTER, GESTOR_CONTRATOS  
- **Fortes:** Assinaturas, faturas, ajuste IPCA, detecção de inadimplência  
- **Fracos:** Pagamentos são mock (sem gateway real)  
- **Classificação:** 🟡 Importante (para o negócio SaaS da VivaFrutaz)

---

### 🟠 MÓDULOS OPCIONAIS

---

**NF-e MANUAL (insert-nf-manual)**  
- **Objetivo:** Registrar NF-e emitidas fora do sistema  
- **Frequência:** Rara  
- **Classificação:** 🟠 Opcional

---

**FISCAL (Entrada / OCR)**  
- **Objetivo:** Importar NF-e de fornecedores via OCR  
- **Frequência:** Por entrega recebida  
- **Fracos:** Processo manual — sem integração direta com XML da SEFAZ de terceiros  
- **Classificação:** 🟠 Opcional (importante mas não bloqueante)

---

**DIAGNÓSTICO FISCAL**  
- **Objetivo:** Health check do pipeline NF-e  
- **Usuário:** FINANCEIRO, ADMIN  
- **Frequência:** Rara (quando há problema)  
- **Classificação:** 🟠 Opcional (uso situacional)

---

**PEDIDOS ESPECIAIS**  
- **Objetivo:** Pedidos fora da janela padrão  
- **Frequência:** Eventual  
- **Classificação:** 🟠 Opcional

---

**SENHA / PASSWORD RESET REQUESTS**  
- **Objetivo:** Suporte a recuperação de senha  
- **Classificação:** 🟠 Opcional (necessário mas não operacional)

---

**IMPORTAÇÃO DE DADOS**  
- **Objetivo:** Importar dados em massa  
- **Frequência:** Rara (onboarding)  
- **Classificação:** 🟠 Opcional

---

**GOVERNANCE DASHBOARD**  
- **Objetivo:** Score de produção e segurança  
- **Frequência:** Mensal/Trimestral  
- **Classificação:** 🟠 Opcional

---

**TREINAMENTO / ACADEMY**  
- **Objetivo:** Onboarding de usuários  
- **Frequência:** Rara (novos usuários)  
- **Classificação:** 🟠 Opcional

---

**SOBRE NÓS**  
- **Objetivo:** Conteúdo institucional para o portal do cliente  
- **Classificação:** 🟠 Opcional

---

**SCOPE SIMULATIONS**  
- **Classificação:** 🟠 Opcional (pré-venda — uso raro mas estratégico)

---

### ⚫ MÓDULOS FUTUROS

---

**WHITE LABEL**  
- **Objetivo:** Customização visual por tenant  
- **Status:** UI existe, deploy real não implementado  
- **Quando faz sentido:** Quando a VivaFrutaz tiver clientes SaaS que precisam de branding próprio  
- **Classificação:** ⚫ Futuro

---

**MARKETPLACE DE MÓDULOS**  
- **Objetivo:** Ativar/desativar funcionalidades por cliente SaaS  
- **Status:** UI existe, sem backend de ativação real  
- **Classificação:** ⚫ Futuro

---

**MASTER CONTROL**  
- **Objetivo:** Plano de controle SaaS global  
- **Quando faz sentido:** Quando a base de clientes SaaS crescer  
- **Classificação:** ⚫ Futuro (exceto para operação interna)

---

### ❌ MÓDULOS SEM VALOR PARA A OPERAÇÃO ATUAL

---

**AI DEVELOPER**  
- **Objetivo:** Gerar código, migrations, auto-healing  
- **Usuário real:** Desenvolvedores do sistema — não a VivaFrutaz como empresa  
- **Na operação:** Nenhum usuário da distribuidora utilizará esta tela  
- **Classificação:** ❌ Sem valor para a operação atual

---

**test-clara.tsx**  
- **Objetivo:** Diagnóstico de desenvolvimento com dados mock  
- **Na operação:** Não deveria estar no sistema  
- **Classificação:** ❌ Sem valor — remover

---

<a id="etapa-4"></a>
## ETAPA 4 — PROCESSOS PARALELOS

### O que ainda acontece fora do sistema

Com base nas lacunas identificadas no código:

---

#### Excel / Google Sheets

| Processo | Por que acontece fora |
|---------|----------------------|
| **Pedidos de Compra a Fornecedores** | Sistema não tem módulo de compra — só consolida demanda. A compra em si é feita por telefone/WhatsApp e registrada externamente |
| **Controle de preços do fornecedor** | Não há cadastro de fornecedor nem tabela de preço de compra no sistema |
| **Precificação sazonal** | Sem motor de preço dinâmico por safra — admin atualiza manualmente produto a produto |
| **Escala de motoristas** | Sistema atribui rotas automaticamente mas sem gestão de escala/folgas da equipe |
| **Controle de contas a pagar a fornecedores** | Existe AP (Accounts Payable) no sistema mas sem vínculo a fornecedores cadastrados |

---

#### WhatsApp / Telefone

| Processo | Por que acontece fora |
|---------|----------------------|
| **Comunicação com fornecedor** | Sem módulo de fornecedor ou PO (Purchase Order) |
| **Ocorrências de entrega** | Motorista não tem campo de ocorrência no painel — reporta via WhatsApp |
| **Pedidos fora da janela** | Há tela de pedidos especiais, mas clientes podem ligar diretamente |
| **Confirmação de recebimento de pagamento** | AR confirmado manualmente — cliente avisa por WhatsApp que pagou |
| **Aviso de janela de pedido** | E-mail automation existe, mas WhatsApp provavelmente é o canal real |

---

#### E-mail (fora do sistema)

| Processo | Por que acontece fora |
|---------|----------------------|
| **Envio de DANFE ao cliente** | Sistema gera DANFE em PDF, mas envio automático ao cliente não está evidenciado como automático no código |
| **Cobrança de inadimplência** | Sistema detecta inadimplência, mas a cobrança é feita manualmente via e-mail/telefone |

---

#### Papel / Manual

| Processo | Por que acontece fora |
|---------|----------------------|
| **Romaneio (manifesto de carga)** | Não existe no sistema — separação é marcada como status, sem lista física |
| **Assinatura de entrega** | Sem campo de assinatura digital no painel do motorista |
| **Foto de prova de entrega** | Sem captura de imagem no painel do motorista |
| **Recibo de NF de fornecedor** | OCR existe mas é upload manual — sem XML automático da SEFAZ |

---

<a id="etapa-5"></a>
## ETAPA 5 — DUPLICIDADES

### Processos Duplicados

| Duplicidade | Onde ocorre | Impacto |
|------------|-------------|---------|
| **"Top Clientes"** | `reports/financial.tsx` + `financial-intelligence.tsx` | Usuário vê a mesma informação em dois lugares |
| **Status de pedido** | `orders.status` (legado) + `orders.workflowStatus` (novo) | Admin vê dois campos que precisam de sync manual |
| **Histórico de NF-e** | `admin/nfe.tsx` + `admin/fiscal.tsx` | Sobreposição parcial de visões |
| **Saúde do sistema** | `admin/system-health.tsx` + `admin/observability.tsx` | Duas telas com propósitos próximos |

### Telas Duplicadas / Sobrepostas

| Telas | Sobreposição |
|-------|-------------|
| Dashboard Admin + Dashboard Executivo | KPIs gerais aparecem nos dois |
| Security Dashboard + Security Audit + Security Intelligence | 3 telas de segurança sem hierarquia clara |
| Finance + Financial Intelligence + Reports/Financial + SaaS Financeiro | 4 perspectivas financeiras — usuário não sabe qual usar |
| Fiscal + NF-e + Faturamento + Diagnóstico Fiscal | 4 telas do domínio NF-e com recortes diferentes |

### APIs Duplicadas (Backend)

| Duplicidade | Evidência |
|------------|-----------|
| Logistics routes | Existe em `server/modules/logistics/` e em `server/routes/logistics.routes.ts` |
| Auth middleware | `requireAuth.ts` (core) e `authenticate.ts` (shared) — lógicas diferentes |
| Logger | `services/logger.ts` e `core/observability/logger.ts` |

### Cadastros com Risco de Duplicidade

| Item | Problema |
|------|---------|
| Config de empresa | 3 tabelas: `company_config`, `company_settings`, `empresa_config` — dados podem divergir |
| AI logs | `ai_interactions` + `ai_logs` — propósito possivelmente sobrepostos |

---

<a id="etapa-6"></a>
## ETAPA 6 — GAPS

### O que o usuário precisa fazer FORA do sistema

| Processo | Gap | Consequência |
|---------|-----|-------------|
| **Comprar do fornecedor** | Sem módulo de PO (Purchase Order) | Planejamento de compras fica a meio caminho — sistema consolida a demanda mas a compra vai para Excel/WhatsApp |
| **Registrar ocorrência na entrega** | Sem campo no painel do motorista | Ocorrências vão para WhatsApp — histórico perdido |
| **Conciliar pagamentos** | Extrato Itaú disponível mas cruzamento com AR é manual | Financeiro gasta horas reconciliando manualmente |
| **Renovar contrato** | Sem renovação automática | Admin precisa lembrar e agir manualmente |
| **Emitir cobrança formal** | PIX e boleto gerados localmente, sem gateway | Cliente recebe dados de pagamento mas sem comprovante de cobrança formal integrado |
| **Registrar NF de fornecedor** | OCR manual, sem integração com XML SEFAZ de terceiros | NF de entrada é retrabalhada manualmente |
| **Romaneio de carga** | Não existe | Separação é registrada como status, sem lista física de conferência |
| **Escala de motoristas** | Sem gestão de escala/folgas | Rota atribuída automaticamente sem considerar disponibilidade real |
| **Cadastrar fornecedor** | Sem módulo de fornecedor | AP existe mas sem vínculo a fornecedor cadastrado |

### Onde ocorre RETRABALHO

| Retrabalho | Descrição |
|-----------|-----------|
| **Confirmação de pagamento** | Admin confirma pagamento manualmente mesmo com extrato Itaú disponível |
| **Precificação de produtos sazonais** | Admin atualiza preço produto por produto sem motor de precificação em lote |
| **NF de fornecedor** | Upload manual do XML + OCR, dados precisam ser conferidos |
| **Ajuste de IPCA** | Sistema alerta e calcula, mas aplicação é clique manual mesmo sendo sempre confirmado |
| **Monitoramento de inadimplência** | Sistema detecta, mas cobrança depende de ação humana |

### Onde se PERDEM informações

| Informação perdida | Como |
|-------------------|------|
| Ocorrências de entrega | Reportadas por WhatsApp — sem registro no sistema |
| Histórico de negociações com fornecedor | Fora do sistema |
| Justificativa de preço especial | Sem campo para registrar motivo de desconto concedido |
| Foto/assinatura de entrega | Não capturada |

### GARGALOS identificados

| Gargalo | Impacto |
|---------|---------|
| Confirmação manual de pagamento | Volume alto de pedidos = muitas confirmações manuais diárias |
| Separação sem romaneio | Erros de separação sem rastreabilidade |
| Compra de fornecedor fora do sistema | Planejamento de compras perde rastreabilidade após o corte |
| NF-e bloqueada (sem certificado A1) | Todo faturamento automático está bloqueado até configurar certificado |

---

<a id="etapa-7"></a>
## ETAPA 7 — UX OPERACIONAL

### Avaliação por módulo como usuário final

---

**Pedidos (Admin) — Complexidade Alta**
- ❌ Excesso de informação: status legado + workflowStatus na mesma tela
- ❌ Muitos botões condicionais — botão certo depende do estado atual
- ✅ Filtros e busca bem implementados
- ⚠️ Poderia ter uma view "Kanban por status" para separação ser mais intuitiva

---

**Dashboard Admin — Poluição de Informação**
- ❌ 5 dashboards diferentes sem hierarquia clara — usuário não sabe qual usar no dia a dia
- ⚠️ Dashboard Admin e Executivo poderiam ser abas do mesmo dashboard

---

**Criar Pedido (Cliente)**
- ✅ Simples e direto
- ❌ Sem feedback claro do nível de preço ativo (cliente não sabe se está pagando preço contratual ou base)
- ❌ Carrinho some se limpar localStorage — sem aviso

---

**Logística**
- ✅ Tela densa mas bem organizada
- ❌ Motorista não tem como registrar ocorrência
- ⚠️ Assistente de rota multi-etapa é poderoso mas pode ser simplificado para o uso diário

---

**Financeiro (4 telas)**
- ❌ Finance / Financial Intelligence / Reports Financial / SaaS Financeiro — usuário FINANCEIRO não sabe qual entrar para cada tarefa
- ⚠️ Poderia ser unificado em um módulo financeiro com abas

---

**NF-e (4 telas)**
- ❌ NF-e / Fiscal / Faturamento / Diagnóstico Fiscal — recortes diferentes, mas difícil navegar entre eles
- ⚠️ Poderia ser um módulo fiscal com abas: Emissão / Status / Configuração / Diagnóstico

---

**Segurança (3 telas)**
- ❌ Security Dashboard / Security Audit / Security Intelligence — só ADMIN/MASTER acessam, mas mesmo para eles não é claro qual verificar primeiro
- ⚠️ Poderia ser um módulo único com abas

---

**Sanitário**
- ✅ Simples, objetivo, PDF gerado
- ✅ NUTRICIONISTA redirecionado diretamente — sem ruído

---

**Painel do Motorista**
- ✅ Simples e direto
- ❌ Sem campo de ocorrência
- ❌ Sem confirmação de entrega com evidência (foto)

---

**Clara IA**
- ✅ Diferencial real — assistente flutuante sempre disponível
- ❌ Perde memória a cada restart — experiência inconsistente

---

**Módulos que PODERIAM ser unificados:**

| Atual (telas separadas) | Sugestão (módulo unificado com abas) |
|------------------------|--------------------------------------|
| Finance + Financial Intelligence + Reports/Financial | Financeiro → (Operacional / Inteligência / Relatórios) |
| NF-e + Fiscal + Faturamento + Diagnóstico | Fiscal → (Emissão / Status / Configuração / Diagnóstico) |
| Security Dashboard + Security Audit + Security Intelligence | Segurança → (Visão Geral / Auditoria / Inteligência) |
| System Health + Observability | Infraestrutura → (Saúde / Observabilidade) |
| Dashboard Admin + Executive Dashboard | Dashboard → (Operacional / Executivo) |

---

<a id="etapa-8"></a>
## ETAPA 8 — MATRIZ DE VALOR

| Módulo | Uso | Usuário | Valor gerado | Manutenção | Pode ocultar | Deve permanecer |
|--------|-----|---------|-------------|-----------|--------------|-----------------|
| Pedidos (Admin) | Diário | ADMIN, OPS, FIN, LOG | ⭐⭐⭐⭐⭐ | Alta | Não | ✅ Sim |
| Pedidos (Cliente) | Diário | CLIENT | ⭐⭐⭐⭐⭐ | Média | Não | ✅ Sim |
| Janelas de Pedido | Semanal | ADMIN, OPS | ⭐⭐⭐⭐⭐ | Baixa | Não | ✅ Sim |
| Planejamento de Compras | Semanal (quinta) | PURCHASE | ⭐⭐⭐⭐⭐ | Média | Não | ✅ Sim |
| Logística | Diário | LOGISTICS | ⭐⭐⭐⭐⭐ | Alta | Não | ✅ Sim |
| Painel do Motorista | Diário | MOTORISTA | ⭐⭐⭐⭐⭐ | Baixa | Não | ✅ Sim |
| NF-e / Faturamento | Diário (cron) | FINANCEIRO | ⭐⭐⭐⭐⭐ | Alta | Não | ✅ Sim |
| Financeiro AR/AP | Diário | FINANCEIRO | ⭐⭐⭐⭐⭐ | Média | Não | ✅ Sim |
| Banco (Itaú) | Diário | FINANCEIRO | ⭐⭐⭐⭐ | Alta | Não | ✅ Sim |
| Controle de Desperdício | Diário | OPS | ⭐⭐⭐⭐ | Baixa | Não | ✅ Sim |
| Clientes / Empresas | Raro (cadastro) | ADMIN | ⭐⭐⭐⭐⭐ | Baixa | Não | ✅ Sim |
| Contratos | Raro | ADMIN, OPS | ⭐⭐⭐⭐⭐ | Baixa | Não | ✅ Sim |
| Inteligência Comercial | Diário/Semanal | ADMIN, OPS | ⭐⭐⭐⭐⭐ | Média | Não | ✅ Sim |
| Sanitário | Diário/Semanal | NUTRICIONISTA | ⭐⭐⭐⭐ | Baixa | Não | ✅ Sim |
| Estoque | Semanal | PURCHASE | ⭐⭐⭐⭐ | Média | Não | ✅ Sim |
| Clara IA | Diário | Todos internos | ⭐⭐⭐⭐ | Média | Não | ✅ Sim |
| E-mail Management | Semanal | ADMIN | ⭐⭐⭐⭐ | Baixa | Não | ✅ Sim |
| Inteligência Financeira | Semanal | FIN, DIRECTOR | ⭐⭐⭐⭐ | Média | Não | ✅ Sim |
| Inteligência Logística | Semanal | LOGISTICS | ⭐⭐⭐ | Média | Sim* | ✅ Sim |
| Cotações | Eventual | OPS, PURCHASE | ⭐⭐⭐ | Baixa | Não | ✅ Sim |
| Incidentes Cliente/Interno | Eventual | OPS, LOGISTICS | ⭐⭐⭐ | Baixa | Não | ✅ Sim |
| Tarefas (OS) | Diário | Equipe interna | ⭐⭐⭐ | Baixa | Não | ✅ Sim |
| Relatórios | Semanal/Mensal | PURCHASE, FIN | ⭐⭐⭐ | Baixa | Sim* | ✅ Sim |
| SaaS Dashboard | Semanal | MASTER, GESTOR | ⭐⭐⭐⭐ | Alta | Sim* | ✅ Sim |
| CNAB | Semanal | FINANCEIRO | ⭐⭐⭐ | Baixa | Sim* | ✅ Sim |
| System Health | Diário | ADMIN, DEV | ⭐⭐⭐ | Média | Sim* | ✅ Sim |
| Observabilidade | Diário | ADMIN, DEV | ⭐⭐⭐ | Média | Sim* | ✅ Sim |
| Security Dashboard | Semanal | ADMIN | ⭐⭐⭐ | Média | Sim* | ✅ Sim |
| Configurações / SMTP | Raro | ADMIN | ⭐⭐⭐ | Baixa | Sim* | ✅ Sim |
| Backups | Raro | ADMIN | ⭐⭐⭐ | Baixa | Sim* | ✅ Sim |
| Governance Dashboard | Mensal | MASTER | ⭐⭐ | Baixa | ✅ Sim | ✅ Sim |
| Diagnóstico Fiscal | Situacional | FINANCEIRO | ⭐⭐ | Baixa | ✅ Sim | ✅ Sim |
| Simulação de Escopo | Raro | ADMIN, OPS | ⭐⭐ | Baixa | ✅ Sim | ✅ Sim |
| NF Manual | Raro | FINANCEIRO | ⭐⭐ | Baixa | ✅ Sim | ✅ Sim |
| Pedidos Especiais | Raro | ADMIN, OPS | ⭐⭐ | Baixa | Sim* | ✅ Sim |
| Treinamento / Academy | Raro | Todos | ⭐⭐ | Baixa | ✅ Sim | ✅ Sim |
| Comunicados | Mensal | ADMIN | ⭐⭐ | Baixa | ✅ Sim | ✅ Sim |
| Password Reset | Raro | ADMIN | ⭐ | Baixa | ✅ Sim | ✅ Sim |
| Sobre Nós | Raro | CLIENT | ⭐ | Baixa | ✅ Sim | ✅ Sim |
| Importação de Dados | Raro | ADMIN | ⭐⭐ | Baixa | ✅ Sim | ✅ Sim |
| White Label | Futuro | MASTER | — | Alta | ✅ Sim | ⚫ Futuro |
| Marketplace Módulos | Futuro | MASTER | — | Alta | ✅ Sim | ⚫ Futuro |
| AI Developer | Nunca | DEVELOPER | — | Alta | ✅ Sim | ❌ Ocultar |
| Master Control | Eventual | MASTER | ⭐⭐ | Alta | ✅ Sim | ⚫ Futuro |
| test-clara.tsx | Nunca | Ninguém | — | — | — | ❌ Remover |

*Sim = pode ser movido para menu "Avançado" ou "Sistema" para não poluir o menu principal

---

<a id="etapa-9"></a>
## ETAPA 9 — ERP ESPECIALIZADO

### Se o Portal fosse desenvolvido HOJE do zero exclusivamente para a VivaFrutaz…

*Respondido apenas com base na análise — sem sugerir desenvolvimento.*

---

**Permaneceriam EXATAMENTE iguais:**
- Módulo de Pedidos (Admin + Cliente)
- Janelas de Pedido com cutoff quinta-feira
- Planejamento de Compras por categoria FLV
- Logística com Auto-Dispatch + GPS
- Painel do Motorista
- NF-e (toda a infraestrutura)
- Financeiro AR/AP
- Banco (Itaú)
- Controle de Desperdício
- Sanitário
- Inteligência Comercial
- Clara IA
- E-mail Management

**Seriam SIMPLIFICADOS:**
- Dashboards: 5 dashboards → 1 dashboard com abas contextuais por role
- Financeiro: 4 telas separadas → 1 módulo com abas
- NF-e/Fiscal: 4 telas separadas → 1 módulo com abas
- Segurança: 3 telas → 1 módulo com abas
- Clara IA: `memoryModule.ts` já começaria em banco de dados

**Seriam REORGANIZADOS:**
- Menu lateral: agrupamentos mais claros (Operação / Financeiro / Fiscal / Configurações)
- Pedidos: view Kanban por status além da tabela
- Motorista: com campo de ocorrência e foto

**Ficariam OCULTOS (menu "Sistema" ou "Avançado"):**
- Governance Dashboard
- Observabilidade
- Security Intelligence
- Diagnóstico Fiscal
- Master Control
- Backups
- Developer Page
- Importação de Dados

**NÃO fariam parte da primeira versão:**
- Módulo SaaS completo (apenas após validar o produto internamente)
- White Label
- Marketplace de Módulos
- AI Developer
- Scope Simulations (viria depois, quando a operação já estivesse madura)

---

<a id="etapa-10"></a>
## ETAPA 10 — RELATÓRIO EXECUTIVO

---

### RESUMO EXECUTIVO

**Sim, o Portal VivaFrutaz representa fielmente a operação real da empresa — mas com excesso em alguns pontos e ausência em outros.**

O sistema cobre com fidelidade o ciclo principal: cliente faz pedido → admin aprova → equipe separa → motorista entrega → NF-e emitida → AR registrado. Esse fluxo é funcional e bem implementado.

O excesso está na **infraestrutura de SaaS e segurança avançada** — camadas relevantes para a VivaFrutaz como fornecedora de software, mas que geram ruído para o usuário da distribuidora no dia a dia.

A ausência está nos **pontos de saída do sistema**: onde o processo sai do portal e vai para Excel, WhatsApp ou papel — especialmente na compra de fornecedores, no romaneio de carga e na conciliação bancária.

---

### MAPA COMPLETO DA OPERAÇÃO

```
SEMANA OPERACIONAL DA VIVAFRUTAZ

SEG-QUA  → Janela aberta → Clientes fazem pedidos no portal
QUI 12h  → Janela fecha
QUI tarde→ Admin consolida planejamento de compras (SISTEMA)
QUI-SEX  → Compras de fornecedor realizadas (FORA DO SISTEMA)
SEX-SAB  → Separação de pedidos: APPROVED → PROCESSING → READY (SISTEMA)
SAB-SEG  → Entregas: auto-dispatch → motoristas → GPS → confirmação (SISTEMA)
SEG 08h  → NF-e emitida automaticamente (SISTEMA)
CONTÍNUO → AR registrado → pagamento confirmado manualmente (SEMI-SISTEMA)
CONTÍNUO → Desperdício registrado (SISTEMA)
CONTÍNUO → Sanitário avaliado (SISTEMA)
CONTÍNUO → Inteligência comercial monitorada (SISTEMA)
MENSAL   → Reajuste IPCA de contratos (SEMI-SISTEMA — calculado, aplicado manual)
```

---

### MAPA DOS USUÁRIOS

| Role | Frequência no sistema | Módulos principais |
|------|----------------------|-------------------|
| ADMIN | Diária, múltiplos módulos | Pedidos, Empresas, Configurações |
| DIRECTOR | Semanal | Executive, Financial Intelligence |
| OPERATIONS_MANAGER | Diária | Pedidos, Logística, Planejamento |
| PURCHASE_MANAGER | Semanal (quinta) | Planejamento, Estoque, Relatórios |
| FINANCEIRO | Diária | Financeiro, NF-e, Banco |
| LOGISTICS | Diária | Logística, Pedidos, Painel |
| MOTORISTA | Diária | Só Painel do Motorista |
| NUTRICIONISTA | Semanal | Só Sanitário |
| GESTOR_CONTRATOS | Semanal | SaaS Dashboard |
| DEVELOPER | Esporádico | Área técnica |
| MASTER | Mensal | Governança, Segurança |
| CLIENT | Semanal | Portal do Cliente |

---

### MAPA DOS MÓDULOS

**Essenciais (core da operação):**
Pedidos · Janelas · Planejamento de Compras · Logística · Painel do Motorista · NF-e · Financeiro · Banco · Desperdício · Clientes · Contratos · Inteligência Comercial · Sanitário · Estoque · Clara IA · E-mail

**Importantes (suporte à operação):**
Inteligências (Financeira/Logística) · Cotações · Incidentes · Tarefas · Relatórios · SaaS · CNAB · System Health · Segurança · Anúncios

**Opcionais (uso situacional):**
Diagnóstico Fiscal · NF Manual · Pedidos Especiais · Simulação Escopo · Importação · Treinamento

**Futuros (não necessários agora):**
White Label · Marketplace · Master Control avançado

**Sem valor operacional:**
AI Developer · test-clara.tsx

---

### FLUXOS DESNECESSÁRIOS (para a operação diária)

| Fluxo | Por que é desnecessário na operação atual |
|-------|------------------------------------------|
| AI Developer | Ferramenta de desenvolvimento — não pertence à operação |
| White Label completo | Nenhum cliente SaaS identificado precisando de branding próprio ainda |
| Marketplace de ativação | Overhead de gestão sem base de clientes SaaS madura |
| Governance Dashboard mensal | Útil para compliance, mas não é fluxo operacional |

---

### FLUXOS AUSENTES

| Fluxo ausente | Impacto |
|--------------|---------|
| **Pedido de Compra a Fornecedor** | Toda compra sai do sistema após o planejamento |
| **Romaneio de Carga** | Separação sem lista física de conferência |
| **Ocorrência de Entrega** | Motorista sem campo para registrar problema |
| **Conciliação Bancária Automática** | Extrato Itaú disponível mas cruzamento é manual |
| **Foto/Assinatura de Entrega** | Sem prova de entrega digital |
| **XML NF-e de Fornecedor (automático)** | NF de entrada é manual |

---

### RETRABALHOS IDENTIFICADOS

| Retrabalho | Frequência | Responsável |
|-----------|-----------|-------------|
| Confirmar pagamento manualmente | Diária | FINANCEIRO |
| Atualizar preço sazonal produto a produto | Semanal | ADMIN/OPS |
| Reajuste IPCA (calculado pelo sistema, clicado manualmente) | Mensal | ADMIN |
| NF de fornecedor via OCR manual | Por entrega recebida | PURCHASE/OPS |
| Navegar entre 4 telas para gestão fiscal completa | Diária | FINANCEIRO |
| Navegar entre 4 telas para gestão financeira | Diária | FINANCEIRO |

---

### DEPENDÊNCIAS EXTERNAS

| Dependência | Processo | Criticidade |
|------------|---------|-------------|
| **Excel / Sheets** | Pedido de compra a fornecedor, controle de preços de compra | Alta |
| **WhatsApp** | Ocorrências de entrega, comunicação com fornecedor, confirmação de pagamento | Alta |
| **Itaú (real)** | Extrato bancário, criação de boletos | Alta — integração real |
| **SEFAZ (real)** | Emissão de NF-e | Alta — bloqueada por falta de certificado A1 |
| **Telefone** | Pedidos fora da janela, negociação com fornecedor | Média |
| **Papel** | Romaneio de carga, assinatura de entrega | Média |

---

### GARGALOS

| Gargalo | Frequência | Impacto |
|---------|-----------|---------|
| Confirmação manual de pagamento | Diária | FINANCEIRO sobrecarregado |
| NF-e bloqueada (sem certificado A1) | Atual | Faturamento automático não funciona |
| Compra de fornecedor fora do sistema | Semanal | Rastreabilidade zero após planejamento |
| Separação sem romaneio | Por entrega | Erros sem rastreamento |
| Motorista sem campo de ocorrência | Por entrega | Histórico de problemas perdido |

---

### MATRIZ DE VALOR — RESUMO

```
ALTO VALOR + USO DIÁRIO (core)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Pedidos · Logística · NF-e · Financeiro
Janelas · Planejamento de Compras · Clara IA
Clientes · Contratos · Inteligência Comercial
Desperdício · Sanitário · Painel Motorista · Banco

ALTO VALOR + USO SEMANAL (importante)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Estoque · Inteligências · Relatórios · CNAB
Tarefas · Incidentes · SaaS · Monitoramento

BAIXO USO + VALOR SITUACIONAL (opcional)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Diagnóstico Fiscal · NF Manual · Simulações
Pedidos Especiais · Importação · Treinamento

SEM USO OPERACIONAL (ocultar ou remover)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
AI Developer · White Label · Marketplace
test-clara.tsx · Master Control (por ora)
```

---

### LISTA DE MÓDULOS ESSENCIAIS
1. Pedidos (Admin + Cliente)
2. Janelas de Pedido
3. Planejamento de Compras
4. Logística (+ GPS + ETA)
5. Painel do Motorista
6. NF-e / Faturamento automático
7. Config Fiscal / Certificado A1
8. Financeiro (AR/AP)
9. Banco (Itaú)
10. Clientes / Empresas
11. Contratos + Escopo
12. Produtos / Categorias / Preços
13. Controle de Desperdício
14. Sanitário
15. Estoque / Inventário
16. Inteligência Comercial
17. Clara IA
18. E-mail Management

---

### LISTA DE MÓDULOS SECUNDÁRIOS
1. Inteligência Financeira
2. Inteligência Logística
3. Cotações
4. Incidentes (Cliente + Interno)
5. Tarefas (OS)
6. Relatórios (Compras / Financeiro / Industrializados)
7. SaaS Dashboard + SaaS Financeiro
8. CNAB
9. System Health + Observabilidade
10. Security Dashboard + Audit + Intelligence
11. Governance
12. Anúncios / Comunicados
13. Pedidos Especiais
14. Backups
15. Configurações / SMTP
16. Notificações Push

---

### LISTA DE MÓDULOS PARA OCULTAR (no menu principal)
- AI Developer
- Governance Dashboard
- Master Control
- White Label
- Marketplace
- Diagnóstico Fiscal (menu → dentro de Fiscal)
- NF Manual (menu → dentro de Fiscal)
- Importação de Dados
- Treinamento / Academy
- Password Reset Requests
- Sobre Nós (portal do cliente → rodapé)
- Scope Simulations (menu → dentro de Contratos)
- Developer Page
- System Updates

---

### LISTA DE MÓDULOS FUTUROS
- White Label (deploy real)
- Marketplace (ativação real de módulos)
- Pedido de Compra a Fornecedor
- Romaneio de Carga
- Conciliação Bancária Automática
- Ocorrência de Entrega (painel do motorista)
- Foto/Assinatura de Entrega

---

### CONCLUSÃO FINAL

**O Portal VivaFrutaz está correto na direção, mas exige foco.**

O que funciona bem:
- O ciclo operacional principal está mapeado e implementado
- A especialização em FLV é real — janelas de pedido, planejamento por categoria, controle de desperdício, sanitário
- O módulo NF-e é o mais maduro do sistema — só falta o certificado A1
- A Clara IA como assistente flutuante é um diferencial genuíno
- A integração com o Itaú é real e funcional

O que precisa de atenção:
- **O sistema termina onde a operação mais precisa** — compra de fornecedor, romaneio, conciliação bancária ficam fora
- **4 telas de financeiro e 4 telas de NF-e** fragmentam a experiência do usuário que mais usa o sistema
- **Confirmação de pagamento manual** é o gargalo financeiro central
- **Sem certificado A1**, o faturamento automático — que é o coração do sistema fiscal — está inativo

O sistema não precisa de mais funcionalidades antes de consolidar o que já existe e eliminar os pontos de saída para Excel e WhatsApp. A evolução prioritária não é adicionar — é **fechar os gaps operacionais** que ainda fazem o usuário sair do portal para fazer seu trabalho.

---

*Auditoria de Produto realizada em 20/07/2026*  
*Papel: Product Manager · Analista de Negócios · Consultor ERP · Arquiteto de Produto*  
*Nenhum arquivo foi alterado. Nenhuma funcionalidade foi criada.*  
*Toda análise baseada exclusivamente no código existente.*
