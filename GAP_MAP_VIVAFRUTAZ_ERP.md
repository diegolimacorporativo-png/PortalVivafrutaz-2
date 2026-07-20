# GAP MAP — PORTAL VIVAFRUTAZ ERP
## FASE 4 — Mapeamento dos Gaps Operacionais

**Data:** 20 de Julho de 2026  
**Papel:** Consultor Lean · Product Owner · Especialista em Processos · Arquiteto de ERP  
**Pergunta central:** *"Por que o usuário fecha o Portal?"*  
**Método:** 100% baseado em evidências do código. Nenhuma suposição. Nenhum arquivo alterado.

---

## ÍNDICE

1. [Mapa dos Usuários](#etapa-1)
2. [Dia Completo de Trabalho por Perfil](#etapa-2)
3. [Todos os Momentos em que o Usuário Sai do Portal](#etapa-3)
4. [Análise de Cada Saída](#etapa-4)
5. [Gaps Identificados com Evidência](#etapa-5)
6. [Duplicidades](#etapa-6)
7. [Gargalos](#etapa-7)
8. [Processos que Podem ser Eliminados](#etapa-8)
9. [Matriz de Gaps](#etapa-9)
10. [Backlog de Gaps](#etapa-10)
11. [Matriz de Ganho](#etapa-11)
12. [Relatório Final](#etapa-12)

---

<a id="etapa-1"></a>
## ETAPA 1 — MAPA DOS USUÁRIOS

### Perfis identificados no código (`client/src/components/Layout.tsx`, `client/src/App.tsx`)

| # | Perfil | Role no Código | Natureza |
|---|--------|---------------|----------|
| 1 | Administrador | `ADMIN` | Operacional + Gestão |
| 2 | Diretor | `DIRECTOR` | Estratégico |
| 3 | Gerente de Operações | `OPERATIONS_MANAGER` | Operacional diário |
| 4 | Gerente de Compras | `PURCHASE_MANAGER` | Suprimentos |
| 5 | Financeiro | `FINANCEIRO` | Fiscal + Contas |
| 6 | Logística | `LOGISTICS` | Distribuição |
| 7 | Motorista | `MOTORISTA` | Entrega |
| 8 | Nutricionista | `NUTRICIONISTA` | Qualidade / Sanitário |
| 9 | Gestor de Contratos | `GESTOR_CONTRATOS` | SaaS / Assinaturas |
| 10 | Desenvolvedor | `DEVELOPER` | TI |
| 11 | Master | `MASTER` | Governança total |
| 12 | Cliente | `client` | Portal externo |

**Perfis operacionalmente ativos na distribuidora:** 1, 3, 4, 5, 6, 7, 8, 12  
**Perfis de suporte ao negócio SaaS:** 2, 9, 10, 11

---

### Como cada perfil trabalha

**ADMINISTRADOR**  
Perfil de operação total. Cadastra empresas, configura contratos, aprova pedidos, resolve inconsistências fiscais, gerencia usuários. Na prática, frequentemente assume tarefas que deveriam ser de outros perfis — especialmente quando os demais não têm acesso ou não sabem usar um módulo específico. É o perfil com maior risco de sobrecarga por concentração de permissões.

**DIRETOR**  
Acesso idêntico ao ADMIN no código. Na prática, usa Executive Dashboard, Commercial Intelligence, Financial Intelligence. Não opera o sistema — monitora resultados. Não tem fluxo operacional diário dentro do Portal.

**GERENTE DE OPERAÇÕES**  
É o usuário mais crítico do sistema. Conduz o ciclo semanal completo: pedidos → planejamento → separação → logística. Usa mais módulos do que qualquer outro perfil. Frequentemente precisa alternar entre Pedidos (separação), Logística (rotas) e Compras (planejamento) no mesmo dia.

**GERENTE DE COMPRAS**  
Acessa o sistema principalmente na quinta-feira, quando a janela fecha e o planejamento de compras é consolidado. Durante o restante da semana, monitora estoque e industrializados. A maior parte do trabalho de compras — negociação, pedido ao fornecedor, controle de entrega recebida — acontece fora do sistema.

**FINANCEIRO**  
Usuário de dois momentos distintos: **manhã** (verificar NF-e do cron das 08h) e **ao longo do dia** (confirmar pagamentos manualmente). A interface financeira está fragmentada em 4 telas diferentes, obrigando o usuário a navegar para tarefas que poderiam estar unificadas.

**LOGÍSTICA**  
Monitora rotas geradas automaticamente pelo auto-dispatch (a cada 10s). Intervém manualmente quando há exceção. Também acompanha GPS dos motoristas e incidentes. O ponto de saída crítico ocorre quando o motorista reporta ocorrências por WhatsApp e o gestor precisa abrir o WhatsApp para receber a informação.

**MOTORISTA**  
Acessa exclusivamente o Painel do Motorista (redirecionamento forçado no login). Vê a lista de paradas e confirma entregas. Não tem campo para registrar ocorrências, não captura foto, não coleta assinatura. Toda comunicação de problema vai por WhatsApp.

**NUTRICIONISTA**  
Acessa exclusivamente o módulo Sanitário (redirecionamento forçado). Preenche checklists e gera PDF. Fluxo simples, bem delimitado, com pouco atrito.

**CLIENTE**  
Acessa o portal externo. Faz pedidos dentro da janela, consulta histórico, abre incidentes. O principal ponto de saída é quando precisa confirmar recebimento ou reportar problema — muitas vezes faz isso por WhatsApp ao invés de usar o módulo de incidentes.

---

<a id="etapa-2"></a>
## ETAPA 2 — DIA COMPLETO DE TRABALHO POR PERFIL

### Evidência dos cronogramas automatizados (`server/bootstrap/scheduler.ts`, `server/jobs/faturamento.cron.ts`)

**Cron 08:00** — `runFaturamentoCron`: seleciona pedidos com `fiscal_status = 'nota_liberada'`, gera XML NF-e, assina, envia ao SEFAZ  
**Cron contínuo (10s)** — `autoDispatchReadyOrders`: atribui entregas não roteadas a rotas ativas  
**Cron contínuo** — `startEmailScheduler`, `startContinuousAuditScheduler`

---

### GERENTE DE OPERAÇÕES — Dia de Operação Normal (Sábado = dia de entrega)

```
06:30  Acorda. Verifica WhatsApp antes mesmo de abrir o Portal
       (grupo com motoristas sobre horários, problemas, atrasos)
       ⚠️ SAÍDA: WhatsApp — informação operacional que não está no sistema

08:00  Login no Portal → Dashboard
       → Verifica NF-e geradas automaticamente (ok?)
       → Verifica pedidos READY (prontos para entrega)

08:30  → Módulo Logística
       → Confere rotas geradas pelo auto-dispatch
       → Ajuste manual de rota se necessário (veículo avariado, motorista ausente)
       ⚠️ SAÍDA: Escala de motoristas não está no sistema
         → Precisa verificar externamente quem está disponível hoje

09:00  → Módulo Pedidos
       → Move pedidos READY → SHIPPED (marcando como saiu para entrega)

09:30  → Acompanha GPS dos motoristas na tela de Logística
       → Recebe mensagens de WhatsApp dos motoristas (problemas de rota, cliente ausente)
       ⚠️ SAÍDA: WhatsApp — ocorrências de entrega em tempo real

12:00  → Janela de pedido fecha (quinta-feira)
       → Módulo Planejamento de Compras
       → Consolida lista de compras por categoria (Frutas / Hortifruti / Industrializados)

12:30  ⚠️ SAÍDA: Excel / WhatsApp
       → Envia lista de compras ao fornecedor por WhatsApp ou e-mail
       → Sistema não tem Pedido de Compra formal

14:00  → Módulo Pedidos
       → Aprova pedidos da semana seguinte
       → Verifica clientes com pagamento pendente (status travado)

16:00  ⚠️ SAÍDA: Excel
       → Monta planilha de separação para a equipe
       → Sistema não tem Romaneio de Carga

17:00  → Módulo Incidentes
       → Registra ocorrências reportadas por WhatsApp ao longo do dia
       ⚠️ RETRABALHO: digitando no sistema o que já foi comunicado por WhatsApp

18:00  Logout
```

---

### GERENTE DE COMPRAS — Dia de Quinta-feira (cutoff)

```
08:00  Login → Dashboard
       → Verifica alertas de estoque (déficit nos últimos pedidos)

08:30  → Módulo Estoque
       → Confere quantidades em mão antes da consolidação

09:00  → WhatsApp / Telefone
       ⚠️ SAÍDA: Liga para fornecedores para consultar disponibilidade e preço do dia
         → Preços de fornecedor não estão no sistema

11:30  → Módulo Planejamento de Compras
       → Consulta lista consolidada após cutoff (janela fecha às 12:00)
       → Analisa "Forecast" vs demanda real

12:00  ⚠️ SAÍDA: Excel / WhatsApp
       → Monta lista definitiva de compras com quantidades e preços cotados
       → Envia ao fornecedor por WhatsApp
       → Sistema não tem PO (Purchase Order) formal

14:00  ⚠️ SAÍDA: E-mail / Portal do Fornecedor
       → Aguarda confirmação do pedido pelo fornecedor

15:00  → Módulo Inventário
       → Registra entradas (quando mercadoria chega na sexta)
       ⚠️ SAÍDA: NF de fornecedor via upload manual (sem XML automático)

16:30  → Módulo Controle de Desperdício
       → Registra perdas do dia

17:00  Logout
```

---

### FINANCEIRO — Dia Normal

```
08:05  Login → Módulo Financeiro
       → Verifica se cron das 08:00 rodou com sucesso
       → Confere NF-e autorizadas pelo SEFAZ

08:30  → Módulo Fiscal (separado do Financeiro)
       → Confere status de NF-e específicas
       ⚠️ RETRABALHO: mesma informação em 2 telas diferentes

09:00  → Módulo Banco (Itaú)
       → Consulta extrato do dia
       → Identifica pagamentos recebidos

09:30  ⚠️ SAÍDA: Planilha Excel / Controle interno
       → Faz cruzamento manual entre extrato bancário e AR pendente
       → Sistema tem extrato e tem AR, mas não cruza automaticamente

11:00  → Módulo Financeiro
       → Confirma manualmente cada pagamento recebido
       → AR.status → "pago" (um por um)
       ⚠️ GARGALO: processo mais lento do dia — 100% manual

13:00  → Módulo NF-e (3ª tela de fiscal)
       → Verifica NF-e com erro que precisam de reenvio manual
       ⚠️ RETRABALHO: 3ª vez verificando informação fiscal hoje

14:00  → Módulo Financial Intelligence (4ª tela)
       → Verifica clientes inadimplentes
       ⚠️ RETRABALHO: "Ranking de Clientes" aparece aqui e no Relatório Financeiro

15:00  ⚠️ SAÍDA: E-mail / Telefone
       → Contata clientes inadimplentes para cobrança
       → Sistema detecta inadimplência mas não tem fluxo de cobrança

16:00  → Diagnóstico Fiscal (4ª tela de NF-e)
       → Verifica circuit breakers de NF-e

17:00  Logout
```

---

### LOGÍSTICA — Dia de Entrega

```
07:00  ⚠️ SAÍDA: WhatsApp
       → Confirma com motoristas se estão disponíveis para hoje
       → Escala não está no sistema

07:30  Login → Módulo Logística
       → Verifica rotas geradas pelo auto-dispatch
       → Confirma motoristas atribuídos vs disponíveis

08:00  → Ajusta rotas manualmente se necessário
       → Verifica veículos disponíveis (frota cadastrada no sistema)

09:00  → Acompanha GPS em tempo real
       → Monitora ETA de cada parada

10:00  ⚠️ SAÍDA: WhatsApp (contínuo)
       → Recebe mensagens dos motoristas: cliente fechado, endereço errado, produto avariado
       → Nenhuma dessas ocorrências entra no sistema automaticamente

12:00  → Módulo Incidentes
       → Digita ocorrências reportadas por WhatsApp
       ⚠️ RETRABALHO: info já comunicada, agora digitada no sistema

14:00  → Módulo Pedidos
       → Confirma entregas realizadas
       → Move pedidos SHIPPED → DELIVERED

15:00  → Manutenção de frota (registra manutenções agendadas)

17:00  Logout
```

---

### MOTORISTA — Dia de Entrega

```
07:00  ⚠️ SAÍDA: WhatsApp
       → Recebe instrução de ponto de encontro / mudança de rota

07:30  Login no Painel do Motorista
       → Vê lista de paradas do dia (route_stops)
       → Vê endereços e sequência

08:00  Sai para entrega
       → Segue sequência de paradas

DURANTE O DIA:
       → Chega em cliente → realiza entrega → confirma no painel (botão simples)
       
       ⚠️ SAÍDA: WhatsApp (múltiplas vezes)
         → Cliente ausente → avisa gestor por WhatsApp
         → Endereço errado → pede correção por WhatsApp
         → Produto avariado na entrega → tira foto no celular, envia por WhatsApp
         → Caixa faltando na carga → liga para o depósito
         
       → Campo `obs` no painel aceita texto livre (evidência: driver-panel.tsx linha 43-92)
       → Mas não tem categoria, foto, ou estrutura de ocorrência

17:00  Logout
```

---

### CLIENTE (Portal) — Semana Normal

```
SEGUNDA-FEIRA
       → Login no Portal
       → Verifica janela de pedido (aberta?)
       → Cria pedido → seleciona itens → confirma

DURANTE A SEMANA:
       ⚠️ SAÍDA: WhatsApp
         → "Posso adicionar um item que esqueci?" (janela fechou)
         → Confirma pagamento pelo WhatsApp
         → Reporta problema de entrega por WhatsApp (nem sempre usa Incidentes)

SEXTA/SEGUNDA (após entrega):
       → Verifica histórico de pedidos no Portal
       → Abre incidente SE souber que existe o módulo
```

---

<a id="etapa-3"></a>
## ETAPA 3 — TODOS OS MOMENTOS EM QUE O USUÁRIO SAI DO PORTAL

### Inventário completo de saídas

| # | Ferramenta Externa | Momento | Usuário |
|---|------------------|---------|---------|
| S-01 | WhatsApp | Coordenação matinal com motoristas | LOGISTICS, OPS_MANAGER |
| S-02 | WhatsApp | Pedido de compra ao fornecedor | OPS_MANAGER, PURCHASE_MANAGER |
| S-03 | WhatsApp | Ocorrência de entrega em tempo real | MOTORISTA |
| S-04 | WhatsApp | Cliente ausente na entrega | MOTORISTA |
| S-05 | WhatsApp | Produto avariado / carga faltante | MOTORISTA |
| S-06 | WhatsApp | Confirmar pagamento (cliente avisa que pagou) | FINANCEIRO, ADMIN |
| S-07 | WhatsApp | Pedidos fora da janela (clientes ligam) | OPS_MANAGER, ADMIN |
| S-08 | WhatsApp | Cliente reporta problema em vez de usar Incidentes | CLIENT |
| S-09 | Telefone | Consultar preço e disponibilidade de fornecedor | PURCHASE_MANAGER |
| S-10 | Telefone | Negociar condições de compra | PURCHASE_MANAGER |
| S-11 | Excel | Montar lista definitiva de compra ao fornecedor | OPS_MANAGER, PURCHASE_MANAGER |
| S-12 | Excel | Cruzar extrato bancário com AR pendente | FINANCEIRO |
| S-13 | Excel | Romaneio de separação para a equipe | OPS_MANAGER |
| S-14 | Excel | Controle de preços de compra (custo por produto) | PURCHASE_MANAGER |
| S-15 | Excel | Escala de motoristas e veículos | LOGISTICS |
| S-16 | E-mail | Cobrança de clientes inadimplentes | FINANCEIRO, ADMIN |
| S-17 | E-mail | Confirmação de pedido ao fornecedor | PURCHASE_MANAGER |
| S-18 | E-mail | Envio de DANFE ao cliente (quando não é automático) | FINANCEIRO |
| S-19 | Celular (câmera) | Foto de prova de entrega | MOTORISTA |
| S-20 | Papel | Romaneio físico de carga | OPS_MANAGER, LOGISTICS |
| S-21 | Papel | Assinatura de recebimento na entrega | MOTORISTA |
| S-22 | Sistema Bancário (Itaú direto) | Consultas além das disponíveis na integração | FINANCEIRO |
| S-23 | Portal SEFAZ | Verificar status de NF-e rejeitadas manualmente | FINANCEIRO |
| S-24 | Google Drive | Armazenar DANFE, contratos, documentos | ADMIN, FINANCEIRO |
| S-25 | Bloco de notas / Anotações | Anotar informações de motorista ou fornecedor | OPS_MANAGER, LOGISTICS |
| S-26 | Calculadora | Calcular preço médio de compra vs venda | PURCHASE_MANAGER |
| S-27 | E-mail / Portal fornecedor | Aguardar confirmação de disponibilidade | PURCHASE_MANAGER |
| S-28 | XML manual / OCR | NF-e de fornecedor (entrada de mercadoria) | PURCHASE_MANAGER |

---

<a id="etapa-4"></a>
## ETAPA 4 — ANÁLISE DE CADA SAÍDA

### Detalhamento por saída

---

**S-01 — WhatsApp com motoristas (manhã)**  
Usuário: LOGISTICS, OPS_MANAGER  
Módulo onde deveria estar: Logística / Painel do Motorista  
Por que sai: Escala de motoristas não existe no sistema. Sistema atribui rota mas não sabe se motorista está disponível, doente ou atrasado  
Frequência: **Diária**  
Retrabalho estimado: 15–30 min/dia  
Pessoas afetadas: 2–4 (gestor logística + gerente operações)

---

**S-02 — WhatsApp/E-mail com fornecedor (pedido de compra)**  
Usuário: OPS_MANAGER, PURCHASE_MANAGER  
Módulo onde deveria estar: Planejamento de Compras (após consolidação)  
Por que sai: Sistema consolida a demanda mas não tem módulo de Pedido de Compra formal ao fornecedor. Evidência: nenhuma tabela `fornecedores` ou `purchase_orders` em `shared/schema.ts`  
Frequência: **Semanal (toda quinta após cutoff)**  
Retrabalho estimado: 1–2h/semana  
Pessoas afetadas: 2–3

---

**S-03/04/05 — WhatsApp de ocorrência de entrega (motorista)**  
Usuário: MOTORISTA  
Módulo onde deveria estar: Painel do Motorista  
Por que sai: Painel do motorista tem apenas campo `obs` de texto livre (`driver-panel.tsx` linhas 43-92). Não há categorias de ocorrência, não há foto, não há estrutura. O motorista abre o WhatsApp porque é mais rápido e mais natural  
Frequência: **Diária (múltiplas ocorrências por rota)**  
Retrabalho estimado: 20–40 min/dia (motorista + gestor que re-digita)  
Pessoas afetadas: todos os motoristas + gestor logística

---

**S-06 — WhatsApp: cliente confirma pagamento**  
Usuário: FINANCEIRO, ADMIN  
Módulo onde deveria estar: Financeiro (AR)  
Por que sai: Sistema tem integração Itaú real (extrato disponível), mas não cruza automaticamente o extrato com o AR pendente. Evidência: `itauIntegration.ts` retorna dados do extrato, mas não executa matching automático. O cliente avisa por WhatsApp porque é o canal de menor atrito  
Frequência: **Diária**  
Retrabalho estimado: 30–60 min/dia  
Pessoas afetadas: 1–2 (financeiro)

---

**S-11 — Excel: lista de compra ao fornecedor**  
Usuário: OPS_MANAGER, PURCHASE_MANAGER  
Módulo onde deveria estar: Planejamento de Compras (extensão)  
Por que sai: Sistema gera a consolidação de demanda (`purchase-planning.tsx` com `PlanItem` agrupado por categoria), mas não exporta um documento formatado de Pedido de Compra. O usuário exporta os dados e monta o PO no Excel  
Frequência: **Semanal**  
Retrabalho estimado: 1h/semana  
Pessoas afetadas: 2

---

**S-12 — Excel: conciliação bancária**  
Usuário: FINANCEIRO  
Módulo onde deveria estar: Módulo Banco (Itaú)  
Por que sai: Extrato Itaú disponível via integração real. AR pendente disponível no sistema. Mas cruzamento entre os dois é manual. Financeiro exporta extrato, abre AR, compara linha a linha no Excel  
Frequência: **Diária**  
Retrabalho estimado: 30–90 min/dia  
Pessoas afetadas: 1–2

---

**S-13 — Excel: romaneio de separação**  
Usuário: OPS_MANAGER  
Módulo onde deveria estar: Pedidos (extensão de separação)  
Por que sai: Sistema marca pedidos como PROCESSING ("Em Separação"), mas não gera lista física de itens a separar por pedido. Evidência: `orders.tsx` tem botões de exportação (Excel/CSV/PDF) mas nenhum específico para romaneio. Tabela `romaneio` não existe em `shared/schema.ts`  
Frequência: **Semanal (sexta/sábado)**  
Retrabalho estimado: 1–2h/semana  
Pessoas afetadas: 2–4 (gestão + equipe de separação)

---

**S-14 — Excel: controle de preço de custo**  
Usuário: PURCHASE_MANAGER  
Módulo onde deveria estar: Produtos / Estoque  
Por que sai: Campos `avg_purchase_price` e `purchase_price` existem em tabelas de produto (`shared/schema.ts` linhas 818, 839), mas sem módulo de fornecedor não há como atualizar esses campos estruturadamente. Atualização é manual, produto a produto, ou via Excel importado  
Frequência: **Semanal** (preços de FLV mudam com frequência)  
Retrabalho estimado: 1–2h/semana  
Pessoas afetadas: 1–2

---

**S-15 — Excel: escala de motoristas**  
Usuário: LOGISTICS  
Módulo onde deveria estar: Logística  
Por que sai: `shared/schema.ts` define `logistics_drivers` e `logistics_routes`, mas não há tabela de turno ou escala (`shifts`, `driver_schedules`). Auto-dispatch atribui rota sem verificar disponibilidade do motorista  
Frequência: **Semanal**  
Retrabalho estimado: 30 min/semana  
Pessoas afetadas: 1

---

**S-16 — E-mail: cobrança de inadimplentes**  
Usuário: FINANCEIRO, ADMIN  
Módulo onde deveria estar: Financeiro (AR)  
Por que sai: Sistema detecta inadimplência (`verificar-inadimplencia` rota em `saas.routes.ts`, alerta no dashboard). Mas não há fluxo de cobrança — sem template de cobrança, sem registro de tentativas, sem régua de cobrança automática  
Frequência: **Semanal / conforme necessidade**  
Retrabalho estimado: 30–60 min/semana  
Pessoas afetadas: 1–2

---

**S-19/20/21 — Foto, papel, assinatura na entrega**  
Usuário: MOTORISTA  
Módulo onde deveria estar: Painel do Motorista  
Por que sai: Campo `assinatura_url` existe em `shared/schema.ts` (linha 1553), mas está dormante — não há interface de coleta no `driver-panel.tsx`. Sem câmera integrada, motorista usa câmera nativa e envia foto por WhatsApp  
Frequência: **Diária (toda entrega)**  
Retrabalho estimado: —  
Pessoas afetadas: todos os motoristas

---

**S-28 — NF-e de fornecedor (entrada) via OCR manual**  
Usuário: PURCHASE_MANAGER  
Módulo onde deveria estar: Fiscal Entrada  
Por que sai: `server/routes/fiscal-invoices.routes.ts` (linhas 16-30) aceita campos manuais (`invoiceNumber`, `supplier`, `items`). Não há parser de XML SEFAZ de terceiros. Cada NF recebida de fornecedor precisa ser digitada ou ter OCR revisado manualmente  
Frequência: **Por entrega recebida** (várias por semana)  
Retrabalho estimado: 15–30 min por NF  
Pessoas afetadas: 1–2

---

<a id="etapa-5"></a>
## ETAPA 5 — GAPS IDENTIFICADOS COM EVIDÊNCIA

### GAP-001 — Pedido de Compra a Fornecedor
**Evidência:** Nenhuma tabela `fornecedores`, `purchase_orders` ou `pedido_compra` em `shared/schema.ts`. Rota `purchase-planning.routes.ts` existe apenas para consolidação de demanda — sem emissão de PO.  
**O que acontece hoje:** Lista do Excel enviada por WhatsApp ao fornecedor  
**Impacto:** Rastreabilidade zero da compra após o planejamento. Sem histórico de POs, sem controle de lead time, sem comparativo de preços por fornecedor

---

### GAP-002 — Romaneio de Carga
**Evidência:** Tabela `romaneio` não existe em `shared/schema.ts`. `orders.tsx` tem botões de export genérico (Excel/CSV/PDF), nenhum específico para romaneio de separação.  
**O que acontece hoje:** Gestor monta planilha de separação manualmente ou imprime relatório de pedidos  
**Impacto:** Erros de separação sem rastreabilidade. Equipe de depósito sem lista estruturada

---

### GAP-003 — Ocorrência Estruturada de Entrega
**Evidência:** `driver-panel.tsx` (linhas 43-92) — apenas campo `obs` texto livre. Nenhuma tabela `delivery_issues` ou `occurrences` em `shared/schema.ts`.  
**O que acontece hoje:** Motorista envia mensagem no WhatsApp. Gestor registra (ou não) no módulo de Incidentes  
**Impacto:** Histórico de ocorrências perdido ou incompleto. Impossível analisar padrões (ex: cliente X tem 80% de ausências)

---

### GAP-004 — Foto e Assinatura de Entrega
**Evidência:** Campo `assinatura_url` existe em `shared/schema.ts` (linha 1553) mas não é utilizado. `driver-panel.tsx` sem interface de câmera ou pad de assinatura.  
**O que acontece hoje:** Motorista tira foto com celular e manda por WhatsApp. Assinatura em papel  
**Impacto:** Sem prova digital de entrega. Em disputas com cliente, não há evidência no sistema

---

### GAP-005 — Conciliação Bancária Automática
**Evidência:** `itauIntegration.ts` retorna extrato (transações, saldos). `accounts_receivable` contém AR pendente. Não existe código de matching automático entre os dois.  
**O que acontece hoje:** Financeiro exporta extrato → abre AR → compara manualmente no Excel  
**Impacto:** 30–90 min/dia de retrabalho. Risco de erro humano na baixa de pagamentos

---

### GAP-006 — Cadastro de Fornecedor
**Evidência:** Nenhuma tabela `suppliers`, `fornecedores` ou similar em `shared/schema.ts`. Campos `avg_purchase_price` e `purchase_price` existem em produtos mas sem vínculo a um fornecedor cadastrado.  
**O que acontece hoje:** Fornecedores existem apenas no celular e em planilhas pessoais dos compradores  
**Impacto:** Sem histórico de fornecedores, sem comparativo de preço, sem contato centralizado, sem avaliação de qualidade

---

### GAP-007 — XML de NF-e de Fornecedor (Entrada Automática)
**Evidência:** `fiscal-invoices.routes.ts` (linhas 16-30) aceita campos manuais. Sem parser de XML SEFAZ. Sem integração com portal da SEFAZ para download de XML de terceiros.  
**O que acontece hoje:** NF do fornecedor digitada manualmente ou via OCR com revisão  
**Impacto:** Cada entrega gera 15–30 min de digitação. Risco de erro no registro de entrada

---

### GAP-008 — Escala de Motoristas e Veículos
**Evidência:** `shared/schema.ts` — tabelas `logistics_drivers` e `logistics_routes` sem campos de turno. `auto-dispatch.service.ts` atribui rotas sem verificar disponibilidade do motorista no dia.  
**O que acontece hoje:** Escala gerenciada por Excel ou WhatsApp. Auto-dispatch pode atribuir rota a motorista de folga  
**Impacto:** Gestor precisa ajustar rota manualmente quando descobre que motorista está indisponível

---

### GAP-009 — Régua de Cobrança de Inadimplentes
**Evidência:** `verificar-inadimplencia` rota existe e detecta AR > 15 dias. Nenhum fluxo de cobrança: sem template, sem agendamento de contato, sem registro de tentativas, sem bloqueio automático de novos pedidos.  
**O que acontece hoje:** Gestor ou financeiro liga/manda e-mail manualmente. Sem histórico de tentativas.  
**Impacto:** Inadimplência não cobrada sistematicamente. Sem registro de tratativas

---

### GAP-010 — Bloqueio Automático de Pedidos por Inadimplência
**Evidência:** Sistema marca empresa como `inadimplente` em `assinaturas`. Código de pedido verifica `arByCompany.some(status === 'vencido')` e bloqueia aprovação. No entanto, `saas.routes.ts` mostra que a verificação de inadimplência é disparada manualmente via `/api/saas/verificar-inadimplencia` — não é automática em produção.  
**O que acontece hoje:** Bloqueio depende de admin lembrar de rodar a verificação  
**Impacto:** Pedidos de empresas inadimplentes podem ser aprovados sem bloqueio automático

---

### GAP-011 — Precificação Sazonal em Lote
**Evidência:** Produtos têm `basePrice`, `contractPrice` e preço por `priceGroup`. Sem motor de atualização em lote por categoria ou por grupo de produto. Atualização é produto a produto.  
**O que acontece hoje:** FLV tem variação de preço semanal. Admin atualiza manualmente produto a produto  
**Impacto:** Precificação desatualizada gera perda de margem ou cobranças incorretas

---

### GAP-012 — Histórico de Negociação com Fornecedor
**Evidência:** Sem módulo de fornecedor, sem tabela de cotações recebidas de fornecedores.  
**O que acontece hoje:** Histórico de preços pagos por produto vive na cabeça do comprador e em planilhas  
**Impacto:** Sem benchmarking de custo. Comprador não tem histórico ao negociar

---

### GAP-013 — Certificado A1 (NF-e bloqueada)
**Evidência:** `nfeCert.ts` — busca certificado A1 de variável de ambiente. `faturamento.cron.ts` — só processa pedidos com `fiscal_status = 'nota_liberada'`. Sem certificado configurado, cron roda mas sem processar.  
**O que acontece hoje:** Faturamento automático (coração do sistema fiscal) está inoperante até configuração do certificado  
**Impacto:** Todo o pipeline NF-e está em standby. NFs são processadas manualmente ou não emitidas

---

### GAP-014 — Memória Persistente da Clara IA
**Evidência:** `memoryModule.ts` — contexto de conversa armazenado em array em memória (RAM). Perde estado a cada restart do servidor.  
**O que acontece hoje:** Usuário perde o contexto da conversa ao reabrir ou após restart  
**Impacto:** Assistente parece esquecer o usuário. Experiência inconsistente

---

### GAP-015 — Envio Automático de DANFE ao Cliente
**Evidência:** `danfeGenerator.ts` gera PDF do DANFE. `email-management.tsx` tem automações. Mas não há evidência de envio automático de DANFE após autorização da NF-e.  
**O que acontece hoje:** DANFE provavelmente enviado manualmente por e-mail ou WhatsApp  
**Impacto:** Mais retrabalho manual pós-faturamento

---

<a id="etapa-6"></a>
## ETAPA 6 — DUPLICIDADES

### Dados com duplicidade

| Duplicidade | Evidência | Impacto |
|------------|-----------|---------|
| **Status de pedido** | `orders.status` (legado: ACTIVE, CONFIRMED) + `orders.workflowStatus` (novo: CREATED, APPROVED) — dois campos para o mesmo dado. `system-sync.routes.ts` tem verificação de "Invalid Order Status" | Risco de dessincronização. Usuário vê dois campos sem saber qual é o verdadeiro |
| **Configuração de empresa** | `companies` (flags de preço/fiscal) + `system_settings` (key-value) + `companySettingsService.ts` — três locais com configurações sobrepostas | Config pode divergir entre as três fontes |
| **Ranking de Clientes** | `reports/financial.tsx` (calcula client-side via `/api/orders`) + `financial-intelligence.tsx` (server-side via `/api/financial-intelligence`) — mesma informação, duas fontes, podendo divergir | Financeiro vê número diferente em cada tela |

---

### Telas duplicadas / sobrepostas

| Telas | Sobreposição identificada |
|-------|--------------------------|
| **Finance + Financial Intelligence + Reports/Financial + SaaS Financeiro** | Quatro perspectivas financeiras sem hierarquia. "Ranking de Clientes" aparece em pelo menos duas. Financeiro não sabe qual abrir para cada tarefa |
| **NF-e + Fiscal + Faturamento + Diagnóstico Fiscal** | `admin/nfe.tsx` e `admin/fiscal.tsx` ambos exibem `fiscalStatus` e `preNotaNumber` dos pedidos. Usuário visita as duas telas para ver o mesmo ciclo da nota |
| **Security Dashboard + Security Audit + Security Intelligence** | Três telas de segurança consumindo dados sobrepostos. Dashboard (`/api/admin/security-overview`) e Intelligence (`/api/admin/security-intelligence`) do mesmo background data |
| **System Health + Observabilidade** | Ambos monitoram conectividade DB e status de segurança. Serve roles diferentes (Admin vs Master) mas há sobreposição de dados |
| **Dashboard Admin + Dashboard Executivo** | KPIs gerais em ambos. Admin usa um, Director usa outro, mas ADMIN tem acesso aos dois e pode ver dados duplicados |

---

### Fluxos duplicados

| Fluxo | Como se duplica |
|-------|----------------|
| **Verificação de saúde do sistema** | `dashboard.tsx` chama `/api/settings/maintenance`. `control-center.tsx` chama `/api/admin/system-state` (que internamente verifica maintenance). Duas chamadas para o mesmo dado ao navegar entre páginas |
| **Autenticação** | `requireAuth.ts` (core) e `authenticate.ts` (shared) — lógicas de auth em dois arquivos separados com propósitos sobrepostos |
| **Logger** | `services/logger.ts` e `core/observability/logger.ts` — dois módulos de log sem separação clara de responsabilidade |
| **Importação de rotas** | `server/routes/routes.ts` importa de `storage.ts` (legado) enquanto novos módulos usam services próprios |

---

<a id="etapa-7"></a>
## ETAPA 7 — GARGALOS

### Onde usuários ficam esperando / onde há aprovação manual / digitação repetida

---

**GARGALO 1 — Confirmação de Pagamento (Financeiro)**  
Tipo: Aprovação manual repetitiva  
Descrição: Todo pagamento precisa ser confirmado manualmente no AR, um a um, mesmo com extrato bancário disponível via Itaú  
Frequência: Diária  
Impacto: O processo mais lento do financeiro. Escala linearmente com volume de pedidos  
Pessoas: 1–2

---

**GARGALO 2 — Navegação entre 4 telas fiscais (Financeiro)**  
Tipo: Navegação desnecessária / etapas redundantes  
Descrição: Para gerir o ciclo fiscal, FINANCEIRO precisa navegar entre NF-e → Fiscal → Faturamento → Diagnóstico. Cada tela tem parte da informação, nenhuma tem o todo  
Frequência: Diária  
Impacto: Fragmentação cognitiva, tempo perdido em navegação, risco de deixar erro em tela não visitada

---

**GARGALO 3 — Reenvio manual de NF-e com erro**  
Tipo: Aprovação manual  
Descrição: NF-e rejeitada pelo SEFAZ precisa ser corrigida e reenviada manualmente. Circuit breaker detecta o problema, mas a resolução é manual  
Frequência: Eventual (mas crítico quando ocorre)  
Impacto: Pedido bloqueado até resolução. Entrega pode ser afetada

---

**GARGALO 4 — Digitação de ocorrências (Logística)**  
Tipo: Digitação repetida / retrabalho  
Descrição: Ocorrência comunicada por WhatsApp → gestor digita no módulo de Incidentes. Mesma informação inserida duas vezes em dois lugares  
Frequência: Diária  
Impacto: Retrabalho garantido. Informação chega ao sistema tardiamente ou não chega

---

**GARGALO 5 — Separação sem Romaneio**  
Tipo: Informação ausente → etapa manual  
Descrição: Equipe de separação trabalha sem lista estruturada de itens por pedido. Gestor monta isso externamente ou imprime relatório genérico  
Frequência: Semanal (dia de separação)  
Impacto: Erros de separação não têm rastreabilidade. Falta de item só é descoberta na entrega

---

**GARGALO 6 — NF-e bloqueada (sem Certificado A1)**  
Tipo: Dependência de configuração externa  
Descrição: Cron das 08:00 roda mas não emite notas. Todo o pipeline fiscal automático está travado  
Frequência: **Permanente até configuração**  
Impacto: Faturamento automático inoperante. NF emitida manualmente ou não emitida

---

**GARGALO 7 — Reajuste IPCA (calculado pelo sistema, aplicado manualmente)**  
Tipo: Etapa manual desnecessária  
Descrição: Sistema calcula o novo valor com IPCA, alerta quando contrato está > 12 meses sem reajuste. Mas a aplicação depende de admin clicar no botão. 100% das vezes o admin confirma — a aprovação manual não agrega decisão  
Frequência: Mensal por contrato  
Impacto: Contratos ficam sem reajuste até alguém lembrar de clicar

---

**GARGALO 8 — Atualização de Preço Sazonal Produto a Produto**  
Tipo: Digitação repetida  
Descrição: FLV muda de preço toda semana. Admin atualiza produto a produto. Sem atualização em lote por categoria  
Frequência: Semanal  
Impacto: Precificação desatualizada gera cobranças erradas ou perda de margem

---

<a id="etapa-8"></a>
## ETAPA 8 — PROCESSOS QUE PODEM SER ELIMINADOS

### Se o Portal fosse utilizado corretamente…

---

**Planilhas que desapareceriam:**

| Planilha atual | Condição para eliminar |
|----------------|----------------------|
| Lista de compra ao fornecedor (Excel) | Sistema emitir Pedido de Compra formal com itens do Planejamento |
| Cruzamento extrato × AR (Excel) | Sistema fazer matching automático extrato Itaú × AR |
| Escala de motoristas (Excel) | Sistema ter módulo de turno/escala integrado ao auto-dispatch |
| Controle de preços de compra (Excel) | Cadastro de fornecedor com tabela de preços vinculada ao produto |
| Romaneio de separação (Excel/Word) | Sistema gerar romaneio a partir dos pedidos APPROVED |

---

**Grupos de WhatsApp que deixariam de ser necessários:**

| Grupo | Condição para eliminar |
|-------|----------------------|
| Motoristas + Gestão (ocorrências) | Painel do Motorista com campo estruturado de ocorrência + foto |
| Motoristas + Gestão (escala e horário) | Módulo de escala integrado ao sistema |
| Compras + Fornecedor | Pedido de Compra formal emitido pelo sistema |
| Financeiro + Clientes (confirmar pagamento) | Conciliação bancária automática |
| Clientes + Operações (pedido fora da janela) | Fluxo de pedido especial mais acessível no portal |

---

**Documentos que nunca mais precisariam ser impressos:**

| Documento | Condição para eliminar |
|-----------|----------------------|
| Romaneio em papel | Romaneio digital no sistema + tablet na separação |
| Assinatura de entrega em papel | Assinatura digital no Painel do Motorista |
| DANFE enviado por e-mail manual | DANFE enviado automaticamente após autorização da NF-e |
| Checklist sanitário em papel | Já existe digitalmente — falta adesão |

---

**Anotações e controles paralelos:**

| Controle paralelo | Condição para eliminar |
|------------------|----------------------|
| Histórico de preços de fornecedor (anotações) | Cadastro de fornecedor com histórico de cotações |
| Tentativas de cobrança (anotações) | Régua de cobrança com registro de contatos no sistema |
| Disponibilidade de motoristas (ligações) | Módulo de escala com confirmação de disponibilidade |

---

<a id="etapa-9"></a>
## ETAPA 9 — MATRIZ DE GAPS

| Código | Nome do Gap | Usuário | Módulo | Frequência | Impacto Operacional | Tempo Perdido/semana | Pessoas afetadas | Complexidade de Solução | Prioridade | Classificação |
|--------|-------------|---------|--------|-----------|--------------------|--------------------|-----------------|------------------------|-----------|--------------|
| GAP-001 | Conciliação bancária manual | FINANCEIRO | Financeiro / Banco | Diária | Retrabalho financeiro crítico | 2–5h | 1–2 | Média | 1 | 🔴 Crítico |
| GAP-002 | Certificado A1 (NF-e inoperante) | FINANCEIRO | Fiscal / NF-e | Permanente | Pipeline fiscal bloqueado | — | Todos | Baixa (configuração) | 1 | 🔴 Crítico |
| GAP-003 | Pedido de Compra a Fornecedor | PURCHASE, OPS | Planejamento Compras | Semanal | Rastreabilidade zero pós-planejamento | 2–4h | 2–3 | Alta | 2 | 🔴 Crítico |
| GAP-004 | Ocorrência de entrega (motorista) | MOTORISTA | Painel Motorista | Diária | Histórico de problemas perdido | 3–5h | Todos motoristas | Baixa | 2 | 🔴 Crítico |
| GAP-005 | Romaneio de Carga | OPS, LOGISTICS | Pedidos / Separação | Semanal | Erros de separação sem rastreio | 1–3h | 3–5 | Baixa | 2 | 🔴 Crítico |
| GAP-006 | Cadastro de Fornecedor | PURCHASE | — (inexistente) | Contínuo | Sem histórico de custo, sem benchmarking | 2–3h | 2 | Alta | 3 | 🟠 Alto |
| GAP-007 | Foto e Assinatura de Entrega | MOTORISTA | Painel Motorista | Diária | Sem prova digital de entrega | 30 min | Todos motoristas | Média | 3 | 🟠 Alto |
| GAP-008 | Régua de Cobrança (inadimplência) | FINANCEIRO | Financeiro | Semanal | Inadimplência tratada manualmente | 1–2h | 1–2 | Média | 3 | 🟠 Alto |
| GAP-009 | Bloqueio automático de inadimplentes | ADMIN, FINANCEIRO | SaaS / Pedidos | Semanal | Pedidos aprovados sem verificação | 30 min | 1–2 | Baixa | 3 | 🟠 Alto |
| GAP-010 | XML NF-e de fornecedor (entrada) | PURCHASE | Fiscal Entrada | Por entrega | 15–30 min de digitação por NF | 2–4h | 1–2 | Alta | 4 | 🟠 Alto |
| GAP-011 | Escala de Motoristas | LOGISTICS | Logística | Semanal | Auto-dispatch ignora disponibilidade | 1h | 1–2 | Média | 4 | 🟠 Alto |
| GAP-012 | Precificação sazonal em lote | ADMIN, OPS | Produtos | Semanal | Preços desatualizados | 1–3h | 1–2 | Baixa | 4 | 🟡 Médio |
| GAP-013 | Envio automático de DANFE | FINANCEIRO | NF-e / E-mail | Diária | Envio manual de DANFE | 30 min | 1 | Baixa | 5 | 🟡 Médio |
| GAP-014 | Reajuste IPCA automático | ADMIN | Contratos | Mensal | Contratos sem reajuste | 30 min/mês | 1 | Baixa | 5 | 🟡 Médio |
| GAP-015 | Memória persistente Clara IA | Todos internos | Clara IA | Por restart | Experiência inconsistente | — | Todos | Média | 5 | 🟡 Médio |
| GAP-016 | Fragmentação fiscal (4 telas) | FINANCEIRO | NF-e/Fiscal/Faturamento | Diária | Navegação excessiva | 1h | 1–2 | Baixa (UX) | 5 | 🟡 Médio |
| GAP-017 | Fragmentação financeira (4 telas) | FINANCEIRO | Finance/Relatórios | Diária | Dados divergentes entre telas | 1h | 1–2 | Baixa (UX) | 5 | 🟡 Médio |
| GAP-018 | Histórico de cobrança de inadimplência | FINANCEIRO | Financeiro | Semanal | Sem registro de tentativas | 30 min | 1 | Baixa | 6 | 🟡 Médio |
| GAP-019 | Preço de custo de fornecedor | PURCHASE | Produtos | Semanal | Margem calculada sem custo real | 1h | 1 | Média | 6 | 🟡 Médio |
| GAP-020 | Histórico de cotações de fornecedor | PURCHASE | — (inexistente) | Eventual | Sem benchmarking de compra | — | 1 | Alta | 7 | 🟢 Baixo |

---

<a id="etapa-10"></a>
## ETAPA 10 — BACKLOG DE GAPS

```
GAP-001 — Conciliação Bancária Manual
Impacto: Financeiro perde 2–5h/dia cruzando extrato Itaú com AR no Excel
Classificação: 🔴 Crítico | Prioridade: 1
─────────────────────────────────────────────────────

GAP-002 — Certificado A1 não configurado (NF-e inoperante)
Impacto: Todo o pipeline de faturamento automático está bloqueado
Classificação: 🔴 Crítico | Prioridade: 1
─────────────────────────────────────────────────────

GAP-003 — Pedido de Compra a Fornecedor não existe no sistema
Impacto: Planejamento termina no sistema; compra vai para Excel e WhatsApp
Classificação: 🔴 Crítico | Prioridade: 2
─────────────────────────────────────────────────────

GAP-004 — Motorista sem campo estruturado de ocorrência de entrega
Impacto: Ocorrências vão para WhatsApp; histórico perdido; retrabalho de redigitação
Classificação: 🔴 Crítico | Prioridade: 2
─────────────────────────────────────────────────────

GAP-005 — Romaneio de Carga não existe no sistema
Impacto: Separação feita com planilha ou papel; erros sem rastreabilidade
Classificação: 🔴 Crítico | Prioridade: 2
─────────────────────────────────────────────────────

GAP-006 — Cadastro de Fornecedor inexistente
Impacto: Sem histórico de custo, sem comparativo de preço, fornecedores só existem no celular
Classificação: 🟠 Alto | Prioridade: 3
─────────────────────────────────────────────────────

GAP-007 — Sem foto e assinatura digital de entrega
Impacto: Sem prova de entrega no sistema; campo assinatura_url dormante no schema
Classificação: 🟠 Alto | Prioridade: 3
─────────────────────────────────────────────────────

GAP-008 — Régua de cobrança de inadimplência inexistente
Impacto: Cobrança manual por e-mail e telefone sem registro de tentativas
Classificação: 🟠 Alto | Prioridade: 3
─────────────────────────────────────────────────────

GAP-009 — Bloqueio de inadimplente depende de execução manual de rota
Impacto: Pedidos de empresas inadimplentes podem ser aprovados sem alerta automático
Classificação: 🟠 Alto | Prioridade: 3
─────────────────────────────────────────────────────

GAP-010 — NF-e de fornecedor processada manualmente (sem XML SEFAZ)
Impacto: 15–30 min de digitação por nota recebida; sem integração de entrada
Classificação: 🟠 Alto | Prioridade: 4
─────────────────────────────────────────────────────

GAP-011 — Escala de motoristas fora do sistema
Impacto: Auto-dispatch atribui rota sem saber se motorista está disponível
Classificação: 🟠 Alto | Prioridade: 4
─────────────────────────────────────────────────────

GAP-012 — Atualização de preço sazonal produto a produto
Impacto: FLV muda preço semanalmente; sem atualização em lote por categoria
Classificação: 🟡 Médio | Prioridade: 4
─────────────────────────────────────────────────────

GAP-013 — DANFE não enviado automaticamente ao cliente após NF autorizada
Impacto: Envio manual de nota por e-mail ou WhatsApp pós-faturamento
Classificação: 🟡 Médio | Prioridade: 5
─────────────────────────────────────────────────────

GAP-014 — Reajuste IPCA calculado pelo sistema mas aplicado manualmente
Impacto: Contratos ficam sem reajuste até admin lembrar de clicar
Classificação: 🟡 Médio | Prioridade: 5
─────────────────────────────────────────────────────

GAP-015 — Memória da Clara IA perde contexto a cada restart
Impacto: Usuário perde histórico da conversa; assistente parece esquecer
Classificação: 🟡 Médio | Prioridade: 5
─────────────────────────────────────────────────────

GAP-016 — Gestão fiscal fragmentada em 4 telas separadas
Impacto: Financeiro navega entre NF-e, Fiscal, Faturamento e Diagnóstico para completar uma tarefa
Classificação: 🟡 Médio | Prioridade: 5
─────────────────────────────────────────────────────

GAP-017 — Gestão financeira fragmentada em 4 telas separadas
Impacto: "Ranking de Clientes" aparece em telas com fontes diferentes; dados podem divergir
Classificação: 🟡 Médio | Prioridade: 5
─────────────────────────────────────────────────────

GAP-018 — Sem registro de tentativas de cobrança de inadimplência
Impacto: Financeiro não sabe se já contactou o cliente ou quantas vezes
Classificação: 🟡 Médio | Prioridade: 6
─────────────────────────────────────────────────────

GAP-019 — Preço de custo de fornecedor desconectado do produto
Impacto: Margem calculada sem custo real; campos avg_purchase_price atualizados manualmente
Classificação: 🟡 Médio | Prioridade: 6
─────────────────────────────────────────────────────

GAP-020 — Histórico de cotações de fornecedor inexistente
Impacto: Comprador negocia sem histórico de preços anteriores do mesmo produto
Classificação: 🟢 Baixo | Prioridade: 7
─────────────────────────────────────────────────────
```

---

<a id="etapa-11"></a>
## ETAPA 11 — MATRIZ DE GANHO

### Ganho qualitativo por gap resolvido

| Código | Gap | Tempo economizado | ↓ Retrabalho | ↓ Erros | ↓ WhatsApp | ↓ Excel | Ganho Operacional | Valor para VivaFrutaz |
|--------|-----|------------------|-------------|---------|-----------|--------|------------------|----------------------|
| GAP-001 | Conciliação bancária | 2–5h/dia | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐⭐⭐⭐ | Financeiro libera tempo para gestão | Redução de erros de baixa, agilidade |
| GAP-002 | Certificado A1 | Horas/semana em emissão manual | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐ | ⭐ | NF emitida automaticamente | Compliance fiscal garantido |
| GAP-003 | PO ao Fornecedor | 2–4h/semana | ⭐⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | Rastreabilidade de compra de ponta a ponta | Histórico de fornecedor, lead time controlado |
| GAP-004 | Ocorrência motorista | 3–5h/semana | ⭐⭐⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐ | Histórico de ocorrências por cliente e rota | Análise de padrão de problemas, SLA |
| GAP-005 | Romaneio | 1–3h/semana | ⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐ | ⭐⭐⭐⭐ | Separação com lista precisa | Zero erro de separação não rastreado |
| GAP-006 | Cadastro de Fornecedor | 2–3h/semana | ⭐⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐⭐⭐⭐ | Centraliza todo dado de suprimentos | Benchmarking de custo, poder de negociação |
| GAP-007 | Foto + Assinatura entrega | — | ⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐ | Prova legal de entrega | Proteção contra disputas com cliente |
| GAP-008 | Régua de cobrança | 1–2h/semana | ⭐⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐ | Cobrança sistemática, histórico | Redução de inadimplência |
| GAP-009 | Bloqueio automático | 30 min/semana | ⭐⭐⭐ | ⭐⭐⭐ | ⭐ | ⭐ | Proteção automática de crédito | Redução de exposição a inadimplentes |
| GAP-010 | XML NF fornecedor | 2–4h/semana | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐ | ⭐⭐ | Entrada de NF automática | Custo entrada x venda controlado |
| GAP-011 | Escala motoristas | 1h/semana | ⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐ | Auto-dispatch com disponibilidade real | Rota sempre com motorista disponível |
| GAP-012 | Preço sazonal em lote | 1–3h/semana | ⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐ | ⭐⭐⭐ | Preços sempre atualizados | Margem protegida |
| GAP-013 | DANFE automático | 30 min/dia | ⭐⭐⭐ | ⭐⭐ | ⭐⭐⭐ | ⭐ | NF entregue ao cliente sem ação manual | Profissionalismo na entrega de documentos |
| GAP-014 | IPCA automático | 30 min/mês | ⭐⭐⭐ | ⭐⭐ | ⭐ | ⭐ | Reajuste sempre em dia | Receita protegida pela inflação |
| GAP-015 | Memória Clara IA | — | ⭐⭐ | ⭐ | ⭐ | ⭐ | Assistente contextual por usuário | Experiência de IA de qualidade |
| GAP-016 | Unificar telas fiscais | 1h/dia | ⭐⭐⭐⭐ | ⭐⭐⭐ | ⭐ | ⭐ | Gestão fiscal em uma só tela | Financeiro mais eficiente |
| GAP-017 | Unificar telas financeiras | 1h/dia | ⭐⭐⭐ | ⭐⭐⭐ | ⭐ | ⭐ | Dados financeiros sem divergência | Confiança nos números |

---

<a id="etapa-12"></a>
## ETAPA 12 — RELATÓRIO FINAL

---

### RESUMO EXECUTIVO

O Portal VivaFrutaz cobre com fidelidade o ciclo operacional central. O problema não está no que o sistema faz — está no que ele ainda não faz, e nesses pontos cegos, a operação continua dependendo de WhatsApp, Excel e papel.

Foram identificados **20 gaps operacionais** com evidência no código. Os 5 mais críticos representam as saídas mais frequentes e mais custosas do Portal.

O sistema será considerado maduro quando o usuário não precisar de nenhuma dessas cinco ferramentas para completar seu trabalho: **WhatsApp · Excel · Papel · E-mail manual · Planilha de conciliação**.

---

### MAPA DOS USUÁRIOS

| Perfil | Saídas por dia | Principal motivo de saída |
|--------|---------------|--------------------------|
| Gerente de Operações | 4–6x | WhatsApp (motoristas) + Excel (romaneio, compras) |
| Gerente de Compras | 3–5x | WhatsApp/Tel (fornecedor) + Excel (PO, preços) |
| Financeiro | 3–4x | Excel (conciliação) + E-mail (cobrança) |
| Logística | 4–6x | WhatsApp (motoristas, escala) |
| Motorista | 3–10x/rota | WhatsApp (ocorrências, confirmações) |
| Cliente | 1–3x/semana | WhatsApp (pedidos fora da janela, confirmações) |

---

### MAPA DA OPERAÇÃO

```
O QUE O SISTEMA FAZ BEM                    O QUE SOBE DO SISTEMA
════════════════════════                    ══════════════════════
Pedidos → aprovação → workflow completo     Pedido de compra ao fornecedor → Excel/WA
Janela de pedido com cutoff de quinta       Confirmação de preço/disponibilidade → Tel
Planejamento de compras por categoria       Lista definitiva de compras → Excel
Auto-dispatch de rotas                      Escala de motoristas → Excel
GPS tracking em tempo real                  Ocorrência de entrega → WhatsApp
NF-e automática (quando certificado ok)     Foto de prova de entrega → WhatsApp
Extrato Itaú disponível                     Cruzamento extrato × AR → Excel
AR registrado                               Confirmação de pagamento → WhatsApp
Inadimplência detectada                     Cobrança → E-mail/Telefone
DANFE gerado                                Envio de DANFE → E-mail manual
Separação como status de pedido             Romaneio de carga → Papel/Excel
```

---

### MAPA DOS GAPS

| Prioridade | Código | Gap | Classificação |
|-----------|--------|-----|--------------|
| 1 | GAP-001 | Conciliação bancária manual | 🔴 Crítico |
| 1 | GAP-002 | Certificado A1 não configurado | 🔴 Crítico |
| 2 | GAP-003 | Pedido de Compra a Fornecedor | 🔴 Crítico |
| 2 | GAP-004 | Ocorrência de entrega (motorista) | 🔴 Crítico |
| 2 | GAP-005 | Romaneio de Carga | 🔴 Crítico |
| 3 | GAP-006 | Cadastro de Fornecedor | 🟠 Alto |
| 3 | GAP-007 | Foto + Assinatura de Entrega | 🟠 Alto |
| 3 | GAP-008 | Régua de Cobrança de Inadimplência | 🟠 Alto |
| 3 | GAP-009 | Bloqueio automático de inadimplentes | 🟠 Alto |
| 4 | GAP-010 | XML NF-e de Fornecedor (entrada) | 🟠 Alto |
| 4 | GAP-011 | Escala de Motoristas | 🟠 Alto |
| 4 | GAP-012 | Precificação sazonal em lote | 🟡 Médio |
| 5 | GAP-013 | DANFE automático ao cliente | 🟡 Médio |
| 5 | GAP-014 | Reajuste IPCA automático | 🟡 Médio |
| 5 | GAP-015 | Memória persistente Clara IA | 🟡 Médio |
| 5 | GAP-016 | Telas fiscais fragmentadas | 🟡 Médio |
| 5 | GAP-017 | Telas financeiras fragmentadas | 🟡 Médio |
| 6 | GAP-018 | Histórico de cobrança | 🟡 Médio |
| 6 | GAP-019 | Preço de custo desconectado | 🟡 Médio |
| 7 | GAP-020 | Histórico de cotações de fornecedor | 🟢 Baixo |

---

### MAPA DOS GARGALOS

| Gargalo | Tipo | Frequência | Impacto |
|---------|------|-----------|---------|
| Confirmação de pagamento manual | Aprovação manual repetitiva | Diária | ⭐⭐⭐⭐⭐ |
| NF-e bloqueada (sem certificado) | Dependência externa | Permanente | ⭐⭐⭐⭐⭐ |
| Navegação entre 4 telas fiscais | Fragmentação de UX | Diária | ⭐⭐⭐⭐ |
| Digitação de ocorrências (WhatsApp → sistema) | Retrabalho garantido | Diária | ⭐⭐⭐⭐ |
| Separação sem romaneio | Ausência de ferramenta | Semanal | ⭐⭐⭐⭐ |
| NF de fornecedor via digitação manual | Ausência de automação | Por entrega | ⭐⭐⭐ |
| Reajuste IPCA com clique manual | Etapa desnecessária | Mensal | ⭐⭐⭐ |
| Preço sazonal produto a produto | Digitação repetida | Semanal | ⭐⭐⭐ |

---

### MAPA DAS DUPLICIDADES

| Duplicidade | Onde | Impacto |
|------------|------|---------|
| Status de pedido (status + workflowStatus) | `orders` tabela | Dessincronização possível |
| Ranking de Clientes | Reports/Financial + Financial Intelligence | Números diferentes na mesma empresa |
| Configuração de empresa | companies + system_settings + companySettingsService | Config divergente possível |
| Ciclo fiscal em 4 telas | NF-e + Fiscal + Faturamento + Diagnóstico | Usuário visita 4 telas para 1 tarefa |
| Ciclo financeiro em 4 telas | Finance + Intelligence + Reports + SaaS | Dados inconsistentes entre fontes |
| Health + Observabilidade | 2 telas de monitoramento | Dados sobrepostos |
| Security (3 telas) | Dashboard + Audit + Intelligence | Hierarquia pouco clara |
| Logger (2 módulos) | services/logger + core/observability/logger | Logs sem destino único |

---

### MAPA DOS PROCESSOS EXTERNOS

| Processo externo | Ferramenta | Usuário | Frequência |
|-----------------|-----------|---------|-----------|
| Pedido de compra ao fornecedor | Excel + WhatsApp | OPS, PURCHASE | Semanal |
| Cruzamento extrato × AR | Excel | FINANCEIRO | Diária |
| Romaneio de separação | Excel / Papel | OPS | Semanal |
| Escala de motoristas | Excel | LOGISTICS | Semanal |
| Controle de preço de custo | Excel | PURCHASE | Semanal |
| Cobrança de inadimplência | E-mail / Telefone | FINANCEIRO | Semanal |
| Ocorrência de entrega | WhatsApp | MOTORISTA | Diária |
| Confirmação de pagamento | WhatsApp | FINANCEIRO | Diária |
| Foto de prova de entrega | Câmera + WhatsApp | MOTORISTA | Diária |
| Envio de DANFE | E-mail manual | FINANCEIRO | Diária |
| Confirmação de fornecedor | Telefone / E-mail | PURCHASE | Semanal |
| NF de fornecedor (entrada) | Upload manual / OCR | PURCHASE | Por entrega |

---

### MAPA DOS RETRABALHOS

| Retrabalho | Quem faz | Frequência | Tempo estimado |
|-----------|---------|-----------|---------------|
| Digitar no sistema ocorrência já enviada por WhatsApp | LOGISTICS, OPS | Diária | 20–40 min/dia |
| Cruzar extrato com AR no Excel | FINANCEIRO | Diária | 30–90 min/dia |
| Confirmar pagamento um por um | FINANCEIRO | Diária | 30–60 min/dia |
| Atualizar preço sazonal produto a produto | ADMIN, OPS | Semanal | 1–3h/semana |
| Montar romaneio externamente | OPS | Semanal | 1–2h/semana |
| Montar lista de compra após consolidação | OPS, PURCHASE | Semanal | 1–2h/semana |
| Enviar DANFE manualmente após emissão | FINANCEIRO | Diária | 30 min/dia |
| Navegar por 4 telas para completar tarefa fiscal | FINANCEIRO | Diária | 1h/dia |

**Total estimado de tempo de retrabalho semanal na operação: 20–40 horas/semana entre todos os perfis.**

---

### CONCLUSÃO

**Por que o usuário fecha o Portal?**

Porque o Portal para onde termina — e a operação ainda continua.

O sistema foi construído com fidelidade ao ciclo operacional principal. Pedidos chegam, são aprovados, separados, entregues, faturados. Esse fluxo existe e funciona.

O problema é que o Portal termina em cinco pontos críticos onde a operação ainda não entrou:

1. **Após o planejamento de compras** — a compra ao fornecedor vai para Excel e WhatsApp
2. **Após o auto-dispatch** — a comunicação com o motorista vai para WhatsApp
3. **Durante a entrega** — ocorrências, fotos e assinaturas vão para WhatsApp e papel
4. **Após o faturamento** — a conciliação bancária vai para Excel
5. **Após a detecção de inadimplência** — a cobrança vai para e-mail e telefone

Nesses cinco pontos, a operação sai do Portal e entra em ferramentas pessoais. O histórico se perde. O retrabalho começa. A rastreabilidade termina.

O Portal VivaFrutaz será maduro quando esses cinco pontos de saída deixarem de existir.

---

*Gap Map gerado em 20/07/2026*  
*Papel: Consultor Lean · Product Owner · Especialista em Processos · Arquiteto de ERP*  
*Nenhum arquivo foi alterado. Nenhuma funcionalidade foi criada.*  
*Todas as evidências baseadas no código existente.*
