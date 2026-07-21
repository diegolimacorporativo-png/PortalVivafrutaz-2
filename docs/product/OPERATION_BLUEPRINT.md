# OPERATION BLUEPRINT V1
## Portal VivaFrutaz ERP — Mapa Operacional Completo

> **Data:** 2026-07-21
> **Status:** Referência oficial para todas as próximas funcionalidades do Portal
> **Perspectiva:** Consultor de Operações — como a VivaFrutaz trabalha hoje e como trabalhará no ERP
> **Restrição:** Documento exclusivamente operacional. Nenhum código foi alterado.

---

## SUMÁRIO

1. [Contexto do Negócio](#contexto-do-negócio)
2. [COMERCIAL](#1-comercial)
3. [CLIENTE](#2-cliente)
4. [PLANEJAMENTO](#3-planejamento)
5. [PRODUÇÃO](#4-produção)
6. [LOGÍSTICA](#5-logística)
7. [PÓS-VENDA](#6-pós-venda)
8. [Mapa de Módulos × Operações](#mapa-de-módulos--operações)
9. [Indicadores Consolidados](#indicadores-consolidados)
10. [Automações Futuras Prioritárias](#automações-futuras-prioritárias)

---

## CONTEXTO DO NEGÓCIO

A **VivaFrutaz** é uma empresa de distribuição B2B de frutas, legumes e verduras (FLV) que atende pessoas jurídicas — restaurantes, hotéis, hospitais, escolas, condomínios corporativos e similares.

**Modelo de cliente:**

| Tipo | Descrição | Volume típico |
|------|-----------|---------------|
| **Contratual** | Escopo fixo semanal (produtos + quantidades + preços negociados por contrato). Pedido gerado automaticamente pelo sistema. | 60–80% da receita |
| **Mensal** | Pedido sob demanda dentro de janelas de tempo. Preço por tabela ou grupo de preço. | 20–40% da receita |

**Ciclo operacional base:** semanal. A semana começa na segunda com a consolidação dos pedidos e encerra na sexta (ou sábado) com as entregas concluídas e as notas fiscais emitidas.

**Atores internos:**

| Papel | Função no ERP |
|-------|---------------|
| MASTER | Acesso total — configurações, planos, dados sensíveis |
| ADMIN | Gestão operacional completa |
| DIRECTOR | Relatórios, aprovações financeiras |
| FINANCE | Faturamento, contas a receber/pagar, NF-e |
| OPERATOR | Pedidos, separação, conferência |
| DRIVER | Registro de entrega via app/portal |
| CLIENT | Portal do cliente — pedidos e consultas |

---

## 1. COMERCIAL

### 1.1 Prospecção

**Quem executa:** ADMIN / DIRECTOR
**Tempo estimado:** 1–5 dias por lead (externo ao ERP)

**Como é hoje (fora do ERP):**
Prospecção acontece por indicação, WhatsApp e visita presencial. Não existe funil estruturado. O vendedor anota em planilha ou caderno.

**Como será no ERP:**
O ERP registra o prospect como empresa em status `prospect` antes da formalização. Dados básicos (CNPJ, razão social, contato, tipo de cliente previsto) são capturados na tela de cadastro de empresa.

**Telas envolvidas:**
- Cadastro de Empresa (status: `prospect`) — módulo Companies
- Clara IA — sugestões de produtos por perfil de cliente

**Módulos participantes:** Companies

**Documentos:** —

**Decisões tomadas:**
- Qual o perfil do prospect? (contratual ou mensal)
- Qual o volume estimado?
- Qual a região de entrega?

**Informações que entram:**
- CNPJ, razão social, nome fantasia, endereço, contato comercial
- Tipo previsto de cliente, região, volume estimado

**Informações que saem:**
- Empresa cadastrada com status `prospect`
- Sugestão inicial de escopo contratual (futura automação via IA)

**Indicadores:**
- Número de prospects ativos
- Taxa de conversão prospect → cliente
- Tempo médio de conversão

**Automações futuras:**
- Consulta automática de CNPJ via Receita Federal ao digitar o número
- Score automático de perfil de cliente baseado em CNPJ + setor + tamanho
- Alerta de prospect sem atividade há N dias

---

### 1.2 Orçamento

**Quem executa:** ADMIN / DIRECTOR
**Tempo estimado:** 30 minutos – 2 horas

**Como é hoje:**
Orçamento montado manualmente em planilha Excel ou enviado por e-mail com PDF improvisado. Preços calculados na mão.

**Como será no ERP:**
O ADMIN monta um escopo contratual provisório (produtos + quantidades + dias de entrega) para o prospect. O sistema calcula o valor semanal e mensal estimado automaticamente com base na tabela de preços do grupo selecionado.

**Telas envolvidas:**
- Empresa → aba Escopo Contratual (Contract Scopes)
- Catálogo de Produtos com preços por grupo
- Relatório de Proposta (futuro)

**Módulos participantes:** Companies, Products

**Documentos:** Proposta Comercial (futuro — PDF gerado pelo sistema)

**Decisões tomadas:**
- Quais produtos? Quais quantidades por dia?
- Qual grupo de preço aplicável?
- Qual modelo de faturamento? (mensal/semanal/por pedido)

**Informações que entram:**
- Lista de produtos desejados
- Quantidades por dia da semana
- Grupo de preço ou preços negociados individualmente

**Informações que saem:**
- Valor estimado semanal e mensal
- Escopo provisório salvo no sistema

**Indicadores:**
- Ticket médio de orçamentos emitidos
- Taxa de aceite de orçamentos

**Automações futuras:**
- Geração de PDF de proposta comercial com logo VivaFrutaz
- Envio automático de proposta por e-mail direto do ERP
- Comparação de preços com histórico de contratos similares

---

### 1.3 Negociação

**Quem executa:** ADMIN / DIRECTOR
**Tempo estimado:** 1–10 dias (negociação externa)

**Como é hoje:**
Negociação por WhatsApp e reunião presencial. Ajustes de preço são feitos informalmente. Não há registro histórico.

**Como será no ERP:**
Ajustes de escopo e preço são versionados como `contract_adjustments`. Cada revisão fica registrada com data, motivo e aprovador. O sistema mantém histórico completo de negociações.

**Telas envolvidas:**
- Empresa → Ajustes Contratuais
- Histórico de versões do escopo

**Módulos participantes:** Companies

**Documentos:** Histórico de ajustes (interno)

**Decisões tomadas:**
- Aceitar ou rejeitar contra-proposta do cliente?
- Ajustar preço individual ou reindexar por IPCA?
- Conceder desconto pontual ou alterar grupo de preço?

**Informações que entram:**
- Preços propostos pelo cliente
- Justificativa do ajuste
- Percentual de reajuste

**Informações que saem:**
- Ajuste registrado com aprovador e data
- Escopo atualizado com novo preço

**Indicadores:**
- Número de rodadas de negociação por contrato
- Delta de preço entre proposta inicial e contrato final

**Automações futuras:**
- Notificação automática ao DIRECTOR quando desconto superar X%
- Sugestão de reajuste IPCA automático na época de aniversário do contrato

---

### 1.4 Contrato

**Quem executa:** ADMIN / MASTER
**Tempo estimado:** 30 minutos – 1 dia

**Como é hoje:**
Contrato em Word/PDF assinado fisicamente ou por WhatsApp. Não existe gestão de vencimento.

**Como será no ERP:**
O contrato é formalizado no módulo Companies: tipo de cliente definido como `contratual`, escopo de produtos fixado, datas de início e fim registradas em `contratos_clientes`. O sistema alerta sobre vencimentos próximos.

**Telas envolvidas:**
- Empresa → Dados Contratuais (tipo, modelo, datas)
- Empresa → Escopo Contratual (produtos + quantidades + preços)
- Empresa → Configuração de Entrega (dias da semana, horários, endereço)

**Módulos participantes:** Companies

**Documentos:**
- Contrato de fornecimento (externo ao ERP — futuro: upload de PDF)
- Escopo contratual digital (dentro do ERP)

**Decisões tomadas:**
- Tipo de faturamento: por pedido, mensal, semanal?
- Janela de pedido: quais dias e horários o cliente pode alterar?
- Endereço de entrega e restrições de acesso
- GPS habilitado?

**Informações que entram:**
- Dados completos da empresa (CNPJ, endereço, contato fiscal)
- Escopo de produtos com preços e quantidades por dia
- Datas de vigência
- Configuração de entrega (dias, horários, endereço GPS)

**Informações que saem:**
- Empresa ativa no sistema como cliente contratual
- Escopo registrado e pronto para geração automática de pedidos
- Alerta de vencimento programado

**Indicadores:**
- Contratos ativos por tipo
- Valor médio de contrato (MRR — Monthly Recurring Revenue)
- Contratos vencendo nos próximos 30/60/90 dias

**Automações futuras:**
- Alerta automático 60 dias antes do vencimento do contrato
- Proposta de renovação pré-preenchida com histórico de consumo
- Assinatura digital integrada (DocuSign ou similar)

---

### 1.5 Implantação

**Quem executa:** ADMIN / OPERATOR
**Tempo estimado:** 1–3 dias

**Como é hoje:**
O cliente começa a fazer pedidos pelo WhatsApp ou planilha. O operador lança no sistema manualmente.

**Como será no ERP:**
Após a formalização do contrato, o ADMIN configura o acesso do cliente ao Portal (criação de usuário com role CLIENT), valida o endereço de entrega no mapa, confirma o GPS da empresa se aplicável e realiza um pedido de teste para validar o fluxo completo antes da primeira entrega real.

**Telas envolvidas:**
- Usuários → Criar usuário tipo CLIENT vinculado à empresa
- Empresa → Validar endereço (GPS/mapa)
- Pedidos → Criar pedido teste
- Logística → Validar rota de entrega

**Módulos participantes:** Companies, Users, Orders, Logistics

**Documentos:** —

**Decisões tomadas:**
- Qual usuário(s) do cliente terá acesso ao portal?
- O endereço de entrega está correto no mapa?
- O cliente precisa de treinamento no portal?

**Informações que entram:**
- E-mail e dados do usuário do cliente
- Confirmação do endereço GPS
- Dados do motorista/rota prevista

**Informações que saem:**
- Usuário do cliente criado e notificado
- Empresa apta a receber pedidos

**Indicadores:**
- Tempo médio de implantação (assinatura → primeira entrega)
- Taxa de erros na primeira semana do cliente

**Automações futuras:**
- E-mail de boas-vindas automático com link de acesso ao portal
- Checklist de implantação com progresso visível para o ADMIN

---

## 2. CLIENTE

### 2.1 Pedido Recorrente (Clientes Contratuais)

**Quem executa:** Sistema (automático) — revisão pelo OPERATOR
**Tempo estimado:** Geração: instantânea (automação). Revisão: 5–15 minutos por semana

**Como é hoje:**
Alguém da equipe lança manualmente os pedidos recorrentes toda semana, consultando o contrato em planilha. Processo lento e sujeito a erro.

**Como será no ERP:**
Para clientes contratuais, o sistema gera automaticamente os pedidos da semana via `generateOrdersFromScope` — um pedido por dia de entrega, com os produtos, quantidades e preços já definidos no escopo contratual. O OPERATOR apenas revisa e aprova.

**Ciclo semanal de geração:**
```
Segunda-feira (manhã)
│
├─ Sistema gera pedidos CREATED para todos os clientes contratuais
│   (um pedido por dia de entrega da semana)
│
├─ OPERATOR revisa: produtos, quantidades, endereço
│
└─ OPERATOR transita: CREATED → PENDING_APPROVAL → APPROVED
```

**Telas envolvidas:**
- Pedidos → Lista da semana (filtro por status CREATED)
- Pedido → Detalhes e itens
- Estoque → Reserva automática

**Módulos participantes:** Companies (geração do escopo), Orders, Inventory

**Documentos:** —

**Decisões tomadas:**
- Os itens do escopo estão corretos para esta semana?
- Há alguma exceção (feriado, cliente viajando, produto indisponível)?

**Informações que entram:**
- Escopo contratual vigente (produtos, quantidades, preços)
- Dia da semana + data de entrega calculada

**Informações que saem:**
- Pedido CREATED por cliente por dia de entrega
- Reserva de estoque (na transição para APPROVED)

**Indicadores:**
- Pedidos gerados automaticamente vs. lançados manualmente
- Taxa de conformidade (pedido gerado sem alteração humana)
- Volume total da semana (kg e R$)

**Automações futuras:**
- Geração automática por cron job toda segunda-feira às 06h00
- Notificação ao OPERATOR quando pedidos estão prontos para revisão
- Alerta de produto em falta no escopo antes da geração

---

### 2.2 Pedido Extraordinário (Clientes Mensais e Solicitações Avulsas)

**Quem executa:** CLIENT (portal) ou OPERATOR (em nome do cliente)
**Tempo estimado:** 5–20 minutos por pedido

**Como é hoje:**
Cliente envia pedido por WhatsApp. Operador lança no sistema. Processo manual e com risco de esquecimento.

**Como será no ERP:**
O cliente acessa o portal e monta seu pedido dentro da janela de tempo vigente (`order_windows`). Seleciona produtos do catálogo, informa quantidades, confirma endereço e envia. O OPERATOR recebe e revisa antes de aprovar.

**Restrições do sistema:**
- Só é possível fazer pedido dentro da janela aberta (`orderOpenDate` ≤ hoje ≤ `orderCloseDate`)
- Empresas com exceção registrada (`order_exceptions`) podem pedir fora da janela
- Preço segue a prioridade: escopo contratual > grupo de preço > preço base do produto

**Telas envolvidas:**
- Portal do Cliente → Novo Pedido
- Catálogo de Produtos (filtrado por disponibilidade e plano)
- Pedidos → Lista de pedidos do cliente

**Módulos participantes:** Orders, Products, Companies

**Documentos:** —

**Decisões tomadas:**
- Quais produtos e quantidades nesta semana?
- Data de entrega desejada (sugestão do sistema baseada em deliveryConfigJson)
- Observações especiais (ex.: "entregar antes das 8h")

**Informações que entram:**
- Produtos selecionados + quantidades
- Data de entrega solicitada
- Endereço de entrega (padrão ou alternativo)

**Informações que saem:**
- Pedido CREATED aguardando aprovação
- Notificação para o OPERATOR

**Indicadores:**
- Pedidos por cliente por período
- Ticket médio por pedido extraordinário
- Taxa de pedidos fora da janela (exceções)

**Automações futuras:**
- Notificação push/WhatsApp para cliente quando pedido for aprovado
- Sugestão de produtos baseada em histórico (IA)
- Pré-preenchimento do pedido com o último pedido do cliente

---

### 2.3 Alterações de Pedido

**Quem executa:** CLIENT (portal) ou OPERATOR (por telefone/WhatsApp)
**Tempo estimado:** 2–10 minutos

**Como é hoje:**
Cliente liga ou manda mensagem. Operador altera na planilha ou no sistema sem rastrear o que mudou.

**Como será no ERP:**
Alterações são permitidas apenas em pedidos com status `CREATED` ou `PENDING_APPROVAL`. Após aprovação (`APPROVED`), o pedido está bloqueado — qualquer alteração requer cancelamento e novo pedido. Todas as alterações ficam registradas com data/hora e usuário responsável.

**Telas envolvidas:**
- Pedido → Editar itens (apenas em CREATED/PENDING_APPROVAL)
- Histórico de alterações do pedido

**Módulos participantes:** Orders

**Documentos:** —

**Decisões tomadas:**
- A alteração é possível dentro do prazo?
- O produto alterado tem estoque disponível?
- A alteração afeta o faturamento desta semana?

**Informações que entram:**
- Produto alterado (adição, remoção ou mudança de quantidade)
- Motivo da alteração (futuro campo obrigatório)

**Informações que saem:**
- Pedido atualizado
- Log de alteração com timestamp e usuário

**Indicadores:**
- Taxa de pedidos alterados antes da aprovação
- Motivos mais frequentes de alteração

**Automações futuras:**
- Notificação ao OPERATOR quando cliente alterar pedido já enviado
- Bloqueio automático de alteração quando o pedido entrar em separação

---

### 2.4 Cancelamentos

**Quem executa:** ADMIN / OPERATOR (autorizado)
**Tempo estimado:** 2–5 minutos

**Como é hoje:**
Cancelamento informal. Produto pode ter sido separado e o estoque não retorna ao sistema corretamente.

**Como será no ERP:**
O sistema permite cancelamento (`CANCELLED`) a qualquer status anterior a `SHIPPED`. Ao cancelar um pedido que já estava `APPROVED` (com estoque debitado), o sistema reverte automaticamente o movimento de estoque (`EXIT` → cancelado, estoque retorna). O cancelamento é registrado com motivo obrigatório.

**Status permitidos para cancelamento:**
`CREATED`, `PENDING_APPROVAL`, `APPROVED`, `PROCESSING`, `READY`, `INVOICED`

**Telas envolvidas:**
- Pedido → Botão Cancelar (com campo de motivo obrigatório)
- Estoque → Movimento de estorno automático

**Módulos participantes:** Orders, Inventory, Finance (estorno de contas a receber se já faturado)

**Documentos:** —

**Decisões tomadas:**
- Motivo do cancelamento (cliente solicitou / produto em falta / erro operacional)
- Se já faturado: emitir NF-e de cancelamento?

**Informações que entram:**
- Motivo do cancelamento
- Usuário que cancelou

**Informações que saem:**
- Pedido com status `CANCELLED`
- Estoque revertido (se aplicável)
- Conta a receber marcada como cancelada (se aplicável)

**Indicadores:**
- Taxa de cancelamento por cliente, por produto, por motivo
- Pedidos cancelados após aprovação (impacto operacional)

**Automações futuras:**
- Notificação automática ao cliente quando pedido for cancelado
- Relatório semanal de cancelamentos com impacto financeiro

---

## 3. PLANEJAMENTO

### 3.1 Consolidação Semanal

**Quem executa:** OPERATOR / ADMIN
**Tempo estimado:** 30 minutos – 2 horas (segunda-feira)

**Como é hoje:**
Alguém soma manualmente todos os pedidos recebidos em planilha para saber quanto de cada produto precisará ser comprado e separado. Processo lento e com risco de erro.

**Como será no ERP:**
O sistema consolida automaticamente todos os pedidos aprovados da semana. O OPERATOR acessa o painel de consolidação e vê, por produto, a quantidade total demandada, o estoque disponível e o quanto precisa ser comprado.

**Telas envolvidas:**
- Painel de Consolidação Semanal (futuro — dados já existem nos pedidos aprovados)
- Pedidos → Filtro por semana + status APPROVED
- Estoque → Posição atual por produto

**Módulos participantes:** Orders, Inventory, Products

**Documentos:** Lista de necessidades semanais (interno)

**Decisões tomadas:**
- Todos os pedidos da semana foram aprovados?
- Há produto sem estoque suficiente?
- Algum cliente precisa de ajuste antes da compra?

**Informações que entram:**
- Todos os pedidos APPROVED da semana
- Estoque atual de cada produto

**Informações que saem:**
- Quantidade necessária por produto para a semana
- Delta: necessário − estoque = compra necessária
- Lista de compras para o setor de abastecimento

**Indicadores:**
- Volume total da semana (kg e R$) por produto e categoria
- % de demanda coberta pelo estoque atual
- Variação semana a semana por produto

**Automações futuras:**
- Relatório de consolidação gerado automaticamente toda segunda às 07h00
- Alerta se produto com pedido aprovado tiver estoque zero
- Comparação automática com semana anterior (sazonalidade)

---

### 3.2 Previsão de Demanda

**Quem executa:** ADMIN / DIRECTOR
**Tempo estimado:** 15–30 minutos por semana

**Como é hoje:**
Previsão feita na intuição do operador ou responsável de compras. Sem dados históricos organizados.

**Como será no ERP:**
O sistema calcula a demanda projetada com base no histórico de pedidos de cada produto nas últimas 4–8 semanas, ajustado por sazonalidade e contratos ativos. Clara IA pode sugerir ajustes e identificar padrões.

**Telas envolvidas:**
- Relatórios → Demanda histórica por produto
- Clara IA → "Qual a previsão para a próxima semana?"
- Estoque → Posição + giro de estoque

**Módulos participantes:** Orders, Inventory, Products (Analytics — futuro)

**Documentos:** —

**Decisões tomadas:**
- Qual o volume a comprar para a próxima semana?
- Quais produtos têm risco de falta?
- Quais têm risco de sobra (perecível — perda)?

**Informações que entram:**
- Histórico de pedidos das últimas semanas
- Contratos ativos com escopo definido (demanda garantida)
- Sazonalidade (verão/inverno, datas comemorativas)

**Informações que saem:**
- Previsão de demanda por produto
- Alertas de risco de falta ou sobra

**Indicadores:**
- Acurácia da previsão vs. realizado
- % de produtos com ruptura de estoque
- % de produtos com sobra > 10% da previsão

**Automações futuras:**
- Modelo de previsão automático com histórico de 12 semanas
- Alertas proativos de risco de ruptura baseados em contratos + janelas
- Clara IA com previsão de demanda em linguagem natural

---

### 3.3 Compras

**Quem executa:** ADMIN / OPERATOR designado
**Tempo estimado:** 30 minutos – 2 horas por semana

**Como é hoje:**
Responsável liga para fornecedores por WhatsApp ou telefone, negocia preços na hora e faz pedidos informalmente. Sem registro de histórico de preços pagos.

**Como será no ERP:**
Com base na lista de necessidades da consolidação semanal, o responsável registra os pedidos de compra no sistema. Ao receber a mercadoria, registra a entrada no estoque com NF do fornecedor, atualizando automaticamente o preço médio ponderado.

**Telas envolvidas:**
- Estoque → Nova Entrada (vinculada à NF do fornecedor)
- Fiscal → Importação de NF de entrada (OCR de XML)
- Relatórios → Histórico de preços por produto/fornecedor

**Módulos participantes:** Inventory, Fiscal

**Documentos:**
- NF do fornecedor (entrada no sistema via XML ou manual)
- Pedido de compra (futuro módulo Compras)

**Decisões tomadas:**
- Qual fornecedor para cada produto esta semana?
- O preço está dentro do esperado vs. histórico?
- Quantidade a comprar (demanda prevista + margem de segurança)?

**Informações que entram:**
- Produto, quantidade, preço unitário
- Fornecedor, data de entrega prevista
- NF do fornecedor (CNPJ emitente, número, valor)

**Informações que saem:**
- Estoque atualizado com nova quantidade
- Preço médio ponderado recalculado
- Custo de mercadoria disponível para margem

**Indicadores:**
- Custo médio de compra por produto (semana a semana)
- Variação de preço por fornecedor
- Lead time de entrega por fornecedor

**Automações futuras:**
- Módulo de Compras com pedidos de compra formais
- Comparação automática de preços entre fornecedores cadastrados
- Importação automática de NF-e de entrada via SEFAZ (manifestação do destinatário)

---

### 3.4 Fornecedores

**Quem executa:** ADMIN
**Tempo estimado:** Cadastro inicial: 15 minutos. Manutenção: eventual

**Como é hoje:**
Fornecedores registrados apenas em contato de celular ou planilha. Sem histórico de compras, preços ou avaliações.

**Como será no ERP:**
Fornecedores cadastrados com CNPJ, contato, produtos fornecidos e histórico de compras e preços. O sistema permite avaliar desempenho (preço, prazo, qualidade) ao longo do tempo.

**Telas envolvidas:**
- Fornecedores → Cadastro (futuro módulo)
- Estoque → Entradas vinculadas a fornecedor

**Módulos participantes:** Inventory, Fiscal

**Documentos:** Cadastro de fornecedor

**Decisões tomadas:**
- Este fornecedor é confiável para produto perecível?
- Qual o prazo de pagamento negociado?

**Informações que entram:**
- CNPJ, razão social, contato, produtos
- Prazo de pagamento, forma de pagamento preferida

**Informações que saem:**
- Fornecedor cadastrado e disponível para vínculo com entradas de estoque

**Indicadores:**
- Número de fornecedores ativos por categoria
- Score de avaliação de fornecedor (preço + prazo + qualidade)

**Automações futuras:**
- Módulo de Fornecedores com cotação automática por produto
- Alerta quando fornecedor principal está inadimplente na entrega

---

## 4. PRODUÇÃO

### 4.1 Separação

**Quem executa:** OPERATOR
**Tempo estimado:** 30 minutos – 3 horas (dependendo do volume)

**Como é hoje:**
Operador imprime os pedidos ou anota em caderno e vai pegando os produtos no estoque manualmente. Sem conferência sistemática.

**Como será no ERP:**
O OPERATOR transita o pedido de `APPROVED` para `PROCESSING`. O sistema exibe a lista de separação por pedido (produto, quantidade, unidade). O operador separa físicamente e confirma item a item no sistema.

**Telas envolvidas:**
- Pedidos → Fila de Separação (status APPROVED, ordenados por rota/cliente)
- Pedido → Lista de Itens para separação
- Pedido → Transição APPROVED → PROCESSING

**Módulos participantes:** Orders, Inventory

**Documentos:** Lista de separação por pedido (impressa ou no tablet)

**Decisões tomadas:**
- A quantidade disponível no estoque bate com o pedido?
- Produto está em conformidade? (aparência, prazo de validade, temperatura)
- É necessário substituir algum produto? (fora de estoque, não conforme)

**Informações que entram:**
- Lista de itens do pedido aprovado
- Posição de estoque em tempo real

**Informações que saem:**
- Pedido em status `PROCESSING`
- Confirmação de cada item separado
- Registro de qualquer substituição ou divergência

**Indicadores:**
- Tempo médio de separação por pedido
- Taxa de divergência na separação (item não disponível vs. pedido)
- Número de substituições por semana

**Automações futuras:**
- Roteiro de separação otimizado por posição de armazenagem
- Leitura de código de barras para confirmar item correto
- Alerta automático quando produto em separação está com prazo próximo do vencimento

---

### 4.2 Conferência

**Quem executa:** OPERATOR (pessoa diferente da separação, idealmente)
**Tempo estimado:** 10–30 minutos por lote

**Como é hoje:**
Conferência informal, feita pelo mesmo operador que separou. Sem registro.

**Como será no ERP:**
Um segundo OPERATOR confere os itens separados contra a lista do pedido. Qualquer divergência é registrada no sistema. O pedido só avança para `READY` após conferência validada.

**Telas envolvidas:**
- Pedido → Conferência de itens (tela de check por item)
- Pedido → Transição PROCESSING → READY

**Módulos participantes:** Orders

**Documentos:** —

**Decisões tomadas:**
- Os itens conferem com o pedido (produto, quantidade, qualidade)?
- Há produto danificado que precisa de substituição?

**Informações que entram:**
- Lista de itens separados
- Resultado de cada item (conforme / não conforme / substituído)

**Informações que saem:**
- Pedido em status `READY` (pronto para embarque)
- Registro de não-conformidades

**Indicadores:**
- Taxa de não-conformidade na conferência
- Pedidos que voltaram para separação após conferência

**Automações futuras:**
- Fotografar item não conforme direto no ERP (evidência)
- Integração com balança para confirmação automática de peso

---

### 4.3 Embalagem

**Quem executa:** OPERATOR
**Tempo estimado:** 5–20 minutos por pedido

**Como é hoje:**
Embalagem sem padronização. Etiqueta de identificação feita a mão ou não feita.

**Como será no ERP:**
Após conferência, o pedido é embalado e a etiqueta é gerada pelo sistema com: nome do cliente, endereço de entrega, código do pedido, data de entrega e lista de itens. Impressão direta da tela do pedido.

**Telas envolvidas:**
- Pedido → Imprimir Etiqueta / Romaneio de Caixa
- Pedido → Status READY (embalado e identificado)

**Módulos participantes:** Orders

**Documentos:** Etiqueta de identificação da caixa/caixote

**Decisões tomadas:**
- Quantas embalagens para este pedido?
- Precisa de embalagem especial (temperatura, frágil)?

**Informações que entram:**
- Dados do pedido (cliente, endereço, itens)
- Número de volumes

**Informações que saem:**
- Etiqueta impressa com QR Code do pedido (futuro)
- Número de volumes registrado no pedido

**Indicadores:**
- Número médio de volumes por pedido
- Tempo de embalagem por volume

**Automações futuras:**
- Geração de etiqueta com QR Code para rastreio
- Associação de volume a rota automaticamente ao embalar

---

### 4.4 Qualidade (Vigilância Sanitária)

**Quem executa:** OPERATOR designado (inspetor de qualidade)
**Tempo estimado:** 20–60 minutos por avaliação

**Como é hoje:**
Verificação informal ou não realizada sistematicamente. Sem registro formal.

**Como será no ERP:**
O sistema oferece um checklist estruturado de Vigilância Sanitária com categorias: Pessoal, Higiene, Temperatura, Armazenamento, Equipamentos e Geral. O inspetor cria uma avaliação, responde item a item (Conforme / Não Conforme / Não Aplicável) com observações, e o sistema calcula o score final.

**Fluxo da avaliação:**
```
1. Criar avaliação → status: em_andamento
2. Sistema preenche automaticamente todos os itens da categoria selecionada
3. Inspetor responde cada item (C / NC / NA) + observação
4. Concluir avaliação → sistema calcula score
5. Relatório gerado
```

**Telas envolvidas:**
- Qualidade → Nova Avaliação Sanitária
- Qualidade → Checklist de avaliação (item a item)
- Qualidade → Relatório de avaliação

**Módulos participantes:** Sanitary

**Documentos:**
- Relatório de Avaliação Sanitária (PDF — futuro)
- Histórico de avaliações por período

**Decisões tomadas:**
- A operação está em conformidade para hoje?
- Quais itens não conformes precisam de ação corretiva imediata?
- A operação deve ser suspensa por risco sanitário?

**Informações que entram:**
- Resultado de cada item do checklist (C/NC/NA)
- Observações e fotos (futuro)
- Data, hora e responsável pela avaliação

**Informações que saem:**
- Score de conformidade (% de itens conformes)
- Lista de não-conformidades com prioridade
- Histórico de evolução da qualidade operacional

**Indicadores:**
- Score médio de conformidade sanitária
- Número de não-conformidades por categoria
- Evolução do score semana a semana
- Frequência de avaliações realizadas

**Automações futuras:**
- Alerta automático quando score abaixo de 80%
- Notificação ao ADMIN quando item de temperatura for NC
- Relatório mensal de conformidade sanitária para a gestão

---

## 5. LOGÍSTICA

### 5.1 Romaneio

**Quem executa:** ADMIN / OPERATOR
**Tempo estimado:** 15–30 minutos

**Como é hoje:**
Romaneio feito em planilha ou papel. Alocação de pedidos por rota é manual e baseada em conhecimento do operador.

**Como será no ERP:**
O sistema agrupa os pedidos `READY` por região/rota e gera o romaneio. O "Route Assistant" e "Smart Route Plan" otimizam a sequência de entrega minimizando distância e tempo. O OPERATOR confirma e imprime o romaneio.

**Telas envolvidas:**
- Logística → Planejar Rota do Dia
- Logística → Simulação de Dia (ver todos os pedidos e distâncias)
- Logística → Route Assistant / Smart Route Plan
- Logística → Romaneio (listagem por rota com endereços e pedidos)

**Módulos participantes:** Logistics, Orders

**Documentos:** Romaneio de entrega (lista de paradas ordenadas com pedidos e endereços)

**Decisões tomadas:**
- Quantas rotas para o dia?
- Qual motorista e veículo para cada rota?
- Qual a sequência de paradas mais eficiente?
- Algum pedido especial com horário restrito?

**Informações que entram:**
- Pedidos READY do dia com endereços de entrega
- Frota disponível (veículos + capacidade)
- Motoristas disponíveis
- Horários de restrição de entrega por cliente

**Informações que saem:**
- Rotas criadas com paradas sequenciadas
- Motorista e veículo alocados por rota
- Romaneio impresso ou enviado ao motorista

**Indicadores:**
- Número de rotas por dia
- Pedidos por rota
- Distância total percorrida por rota
- Tempo estimado vs. realizado

**Automações futuras:**
- Otimização automática de rotas com Google Maps API
- Sugestão automática de "melhor motorista" para cada rota (Best Driver)
- Envio do romaneio direto para o celular do motorista

---

### 5.2 Motorista

**Quem executa:** DRIVER
**Tempo estimado:** Briefing pré-rota: 10–15 minutos

**Como é hoje:**
Motorista recebe romaneio em papel. Sem rastreamento em tempo real. Sem registro de ocorrências de entrega.

**Como será no ERP:**
O motorista acessa o portal com login DRIVER. Visualiza sua rota do dia, a sequência de paradas e os pedidos de cada parada. Registra cada entrega no sistema (confirmação, foto, assinatura do recebedor). O GPS registra a posição em tempo real.

**Telas envolvidas:**
- Portal do Motorista → Rota do Dia
- Portal do Motorista → Parada → Confirmar Entrega
- GPS → Posição em tempo real (visível para o ADMIN)

**Módulos participantes:** Logistics, Orders

**Documentos:** —

**Decisões tomadas:**
- Consegui entregar? (sim / não-conforme / cliente ausente)
- Preciso registrar ocorrência?

**Informações que entram:**
- Rota atribuída (paradas, pedidos, endereços)
- Confirmação de entrega por parada

**Informações que saem:**
- Status de entrega por pedido (entregue / tentativa / ocorrência)
- Posição GPS registrada

**Indicadores:**
- % de entregas realizadas na primeira tentativa
- Tempo médio por parada
- Aderência à rota planejada (desvios)

**Automações futuras:**
- App mobile nativo para o motorista (offline-first)
- Assinatura digital do recebedor na entrega
- Foto obrigatória na confirmação de entrega

---

### 5.3 Rota

**Quem executa:** Sistema + ADMIN (monitoramento)
**Tempo estimado:** Monitoramento contínuo durante o dia de entrega

**Como é hoje:**
Sem rastreamento. O ADMIN só sabe o status das entregas quando o motorista manda mensagem.

**Como será no ERP:**
O ADMIN acompanha todas as rotas em tempo real no painel de logística. Vê a posição GPS de cada motorista, o status de cada parada (pendente / entregue / ocorrência) e o progresso da rota.

**Telas envolvidas:**
- Logística → Painel de Rotas em Andamento (mapa + lista)
- Logística → Detalhes da rota (paradas e status)
- GPS → Posições em tempo real

**Módulos participantes:** Logistics

**Documentos:** —

**Decisões tomadas:**
- Alguma rota está atrasada e precisa de intervenção?
- Motorista está desviando da rota prevista?
- Pedido com problema requer redistribuição?

**Informações que entram:**
- Posições GPS dos motoristas
- Confirmações de entrega enviadas pelos motoristas

**Informações que saem:**
- Status em tempo real de cada rota e parada
- Alertas de atraso ou desvio

**Indicadores:**
- % de rotas concluídas no prazo
- Número de ocorrências por rota
- Tempo médio de rota

**Automações futuras:**
- Alerta automático quando rota está > 30 min atrasada
- Notificação ao cliente quando motorista está a X paradas de distância
- Recalculo automático de rota após ocorrência

---

### 5.4 Entrega

**Quem executa:** DRIVER (confirmação) + Sistema (atualização de status)
**Tempo estimado:** 2–10 minutos por parada

**Como é hoje:**
Motorista entrega, cliente assina o papel. Sem atualização do sistema no ato.

**Como será no ERP:**
O motorista confirma a entrega no portal. O sistema transita automaticamente o pedido para `DELIVERED`, sincroniza o registro em `deliveries` para `entregue`, registra o timestamp, dispara notificação ao cliente e gera o log de auditoria `DELIVERY_COMPLETED`.

**Fluxo de confirmação:**
```
Motorista confirma entrega
      ↓
Sistema: pedido SHIPPED → DELIVERED
      ↓
Sistema: deliveries → entregue + delivered_at
      ↓
Outbox Worker: push notification "Pedido Entregue" ao cliente
      ↓
Log: DELIVERY_COMPLETED em system_logs
```

**Telas envolvidas:**
- Portal do Motorista → Confirmar Entrega (com foto e observação)
- Pedido → Linha do tempo de status (visível para o cliente)

**Módulos participantes:** Orders, Logistics

**Documentos:** Comprovante de entrega (futuro: PDF com assinatura digital)

**Decisões tomadas:**
- Entrega realizada com sucesso?
- Houve recusa, ausência ou problema?
- Produto foi devolvido? (registrar ocorrência)

**Informações que entram:**
- Confirmação do motorista (sim/não)
- Foto do recebimento (futuro)
- Nome e assinatura do recebedor (futuro)
- Observação de ocorrência (se houver)

**Informações que saem:**
- Pedido `DELIVERED`
- Notificação ao cliente
- Dado disponível para faturamento (NF-e após entrega)

**Indicadores:**
- % de entregas confirmadas no dia
- Pedidos com ocorrência na entrega
- Tempo médio entre saída e entrega

**Automações futuras:**
- NF-e emitida automaticamente após confirmação de entrega
- Pesquisa de satisfação disparada automaticamente após entrega

---

## 6. PÓS-VENDA

### 6.1 Ocorrências

**Quem executa:** OPERATOR / ADMIN (triagem e resolução)
**Tempo estimado:** 5–30 minutos por ocorrência

**Como é hoje:**
Cliente reclama por WhatsApp. Sem registro formal. Sem histórico por cliente.

**Como será no ERP:**
Ocorrências registradas no sistema com tipo, descrição, pedido vinculado e status de resolução. O ADMIN acompanha o backlog de ocorrências e registra a resolução adotada.

**Tipos de ocorrência:**
- Produto não entregue
- Produto entregue com qualidade não conforme
- Quantidade divergente
- Entrega no endereço errado
- Devolução
- Reclamação de preço/cobrança

**Telas envolvidas:**
- Ocorrências → Nova Ocorrência (vinculada ao pedido)
- Ocorrências → Fila de resolução
- Pedido → Aba de Ocorrências

**Módulos participantes:** Orders (futura feature de Ocorrências)

**Documentos:** Registro de ocorrência com histórico de resolução

**Decisões tomadas:**
- É necessário reentrega? crédito? devolução?
- Quem foi responsável pela falha? (separação, embalagem, motorista)
- Isso afeta o faturamento?

**Informações que entram:**
- Tipo de ocorrência
- Descrição do problema
- Pedido afetado
- Fotos (futuro)

**Informações que saem:**
- Ocorrência registrada e atribuída
- Resolução documentada
- Crédito ou reentrega programada (se aplicável)

**Indicadores:**
- Número de ocorrências por semana
- Taxa de ocorrência por cliente
- Taxa de ocorrência por motorista
- Tempo médio de resolução
- Custo de ocorrências (produto reposto + logística)

**Automações futuras:**
- Abertura de ocorrência pelo cliente diretamente no portal
- Alerta ao ADMIN quando mesmo cliente tem 3+ ocorrências no mês
- Relatório de causas-raiz de ocorrências para melhoria de processo

---

### 6.2 Satisfação

**Quem executa:** Sistema (automático) + ADMIN (análise)
**Tempo estimado:** Envio: automático. Análise: 15 minutos/semana

**Como é hoje:**
Satisfação medida informalmente. Não há pesquisa sistemática.

**Como será no ERP:**
Após cada entrega confirmada, o sistema dispara automaticamente uma pesquisa de satisfação (NPS ou CSAT) para o cliente via e-mail ou portal. O ADMIN vê o painel de NPS consolidado.

**Telas envolvidas:**
- Portal do Cliente → Avaliação de entrega (1–5 estrelas + comentário)
- Relatórios → Painel de Satisfação / NPS

**Módulos participantes:** Orders (futuro: módulo Satisfação)

**Documentos:** —

**Decisões tomadas:**
- Cliente com NPS baixo precisa de contato proativo?
- Padrão de insatisfação indica problema sistêmico?

**Informações que entram:**
- Nota de satisfação (1–5 ou NPS 0–10)
- Comentário livre do cliente

**Informações que saem:**
- Score NPS/CSAT por cliente e consolidado
- Alertas de clientes insatisfeitos (nota ≤ 2)

**Indicadores:**
- NPS geral da empresa
- CSAT por entregador, por rota, por produto
- Evolução de satisfação semana a semana
- % de clientes Promotores / Neutros / Detratores

**Automações futuras:**
- E-mail automático de pesquisa após entrega confirmada
- Alerta imediato ao ADMIN quando nota ≤ 2
- Dashboard de NPS em tempo real

---

### 6.3 Renovação de Contrato

**Quem executa:** ADMIN / DIRECTOR
**Tempo estimado:** 1–5 dias (negociação + formalização)

**Como é hoje:**
Sem processo formal de renovação. Contratos vencem sem aviso e o cliente continua por inércia.

**Como será no ERP:**
O sistema alerta sobre contratos vencendo nos próximos 60 e 30 dias. O ADMIN inicia o processo de renovação, revisa o escopo baseado no histórico de consumo real e propõe ajustes.

**Telas envolvidas:**
- Dashboard → Alertas de contratos a vencer
- Empresa → Dados contratuais → Renovar
- Empresa → Histórico de consumo (últimas 12 semanas)

**Módulos participantes:** Companies, Orders

**Documentos:** Proposta de renovação

**Decisões tomadas:**
- Renovar nas mesmas condições ou renegociar?
- O escopo atual reflete o consumo real?
- Reajuste de preço (IPCA)?

**Informações que entram:**
- Data de vencimento do contrato atual
- Histórico de consumo real das últimas semanas
- Índice de reajuste aplicável

**Informações que saem:**
- Proposta de renovação com novo escopo e preços
- Contrato renovado (novas datas e valores)

**Indicadores:**
- Taxa de renovação de contratos
- Churn de contratos por período
- Variação de ticket médio na renovação

**Automações futuras:**
- Alerta automático 60 dias antes do vencimento
- Proposta de renovação pré-preenchida com histórico de consumo
- Comparação automática: escopo contratual vs. consumo real

---

### 6.4 Reajustes

**Quem executa:** ADMIN / DIRECTOR
**Tempo estimado:** 1–2 horas para processar todos os clientes

**Como é hoje:**
Reajustes comunicados por WhatsApp. Sem controle de quem foi notificado ou aceitou. Sem cálculo automático do novo valor.

**Como será no ERP:**
O sistema calcula o reajuste por IPCA (ou índice configurado) sobre o escopo contratual de cada cliente. Gera um e-mail automático para cada cliente com os novos valores. Registra o ajuste em `contract_adjustments` com data, percentual e aprovador.

**Telas envolvidas:**
- Empresa → Reajuste Contratual (percentual + motivo)
- Empresa → Histórico de Ajustes
- E-mail automático gerado pelo sistema

**Módulos participantes:** Companies

**Documentos:** E-mail de notificação de reajuste (gerado pelo ERP)

**Decisões tomadas:**
- Qual o percentual de reajuste?
- Quando entra em vigor?
- Quais clientes são exceção (negociação individualizada)?

**Informações que entram:**
- Índice de reajuste (IPCA ou negociado)
- Data de vigência
- Justificativa

**Informações que saem:**
- Novo escopo contratual com preços atualizados
- E-mail enviado ao cliente com detalhamento
- `contract_adjustment` registrado com auditoria completa

**Indicadores:**
- % de contratos reajustados no período
- Impacto do reajuste no faturamento (antes vs. depois)
- Número de clientes que solicitaram renegociação após o reajuste

**Automações futuras:**
- Reajuste em lote para todos os clientes de um mesmo grupo de preço
- Cálculo automático do IPCA com base em API oficial
- Agendamento de reajuste futuro com data de vigência

---

## MAPA DE MÓDULOS × OPERAÇÕES

| Operação | Companies | Orders | Products | Inventory | Logistics | Finance | Fiscal | Sanitary |
|----------|-----------|--------|----------|-----------|-----------|---------|--------|----------|
| Prospecção | ✅ | — | — | — | — | — | — | — |
| Orçamento | ✅ | — | ✅ | — | — | — | — | — |
| Negociação | ✅ | — | — | — | — | — | — | — |
| Contrato | ✅ | — | — | — | ✅ | — | — | — |
| Implantação | ✅ | ✅ | — | — | ✅ | — | — | — |
| Pedido Recorrente | ✅ | ✅ | ✅ | ✅ | — | — | — | — |
| Pedido Extraordinário | ✅ | ✅ | ✅ | — | — | — | — | — |
| Alterações | — | ✅ | — | — | — | — | — | — |
| Cancelamentos | — | ✅ | — | ✅ | — | ✅ | — | — |
| Consolidação Semanal | — | ✅ | ✅ | ✅ | — | — | — | — |
| Previsão | — | ✅ | ✅ | ✅ | — | — | — | — |
| Compras | — | — | ✅ | ✅ | — | — | ✅ | — |
| Fornecedores | — | — | — | ✅ | — | — | ✅ | — |
| Separação | — | ✅ | — | ✅ | — | — | — | — |
| Conferência | — | ✅ | — | — | — | — | — | — |
| Embalagem | — | ✅ | — | — | — | — | — | — |
| Qualidade (Sanitária) | — | — | — | ✅ | — | — | — | ✅ |
| Romaneio | — | ✅ | — | — | ✅ | — | — | — |
| Motorista | — | — | — | — | ✅ | — | — | — |
| Rota | — | — | — | — | ✅ | — | — | — |
| Entrega | — | ✅ | — | — | ✅ | — | — | — |
| Ocorrências | — | ✅ | — | — | ✅ | — | — | — |
| Satisfação | — | ✅ | — | — | — | — | — | — |
| Renovação | ✅ | ✅ | — | — | — | — | — | — |
| Reajustes | ✅ | — | ✅ | — | — | ✅ | — | — |

---

## INDICADORES CONSOLIDADOS

### Comercial
| Indicador | Frequência | Fonte |
|-----------|-----------|-------|
| Número de clientes ativos | Semanal | Companies |
| MRR (Receita Recorrente Mensal) | Mensal | Companies + Orders |
| Taxa de conversão prospect → cliente | Mensal | Companies |
| Contratos vencendo em 60 dias | Semanal (alerta) | Companies |
| Taxa de renovação | Trimestral | Companies |
| Churn de contratos | Mensal | Companies |

### Operacional
| Indicador | Frequência | Fonte |
|-----------|-----------|-------|
| Volume total da semana (kg e R$) | Semanal | Orders |
| Pedidos gerados automaticamente vs. manual | Semanal | Orders |
| Taxa de pedidos alterados antes da aprovação | Semanal | Orders |
| Taxa de cancelamento | Semanal | Orders |
| Tempo médio de ciclo (pedido → entrega) | Semanal | Orders + Logistics |
| % de estoque com ruptura | Diário | Inventory |
| % de entregas realizadas no prazo | Diário | Logistics |
| Score médio de conformidade sanitária | Semanal | Sanitary |

### Financeiro
| Indicador | Frequência | Fonte |
|-----------|-----------|-------|
| Faturamento da semana | Semanal | Finance |
| Contas a receber em aberto | Diário | Finance |
| Ticket médio por pedido | Semanal | Orders + Finance |
| Custo médio de produto (preço médio ponderado) | Semanal | Inventory |
| Margem bruta por produto | Mensal | Orders + Inventory |

### Qualidade e Satisfação
| Indicador | Frequência | Fonte |
|-----------|-----------|-------|
| NPS geral | Mensal | Futuro módulo Satisfação |
| Taxa de ocorrências por 100 entregas | Semanal | Futuro módulo Ocorrências |
| Tempo médio de resolução de ocorrência | Semanal | Futuro módulo Ocorrências |
| Score sanitário médio | Semanal | Sanitary |

---

## AUTOMAÇÕES FUTURAS PRIORITÁRIAS

Ordenadas por impacto operacional estimado:

| Prioridade | Automação | Módulo | Impacto |
|------------|-----------|--------|---------|
| 🔴 P1 | Geração automática de pedidos contratuais (cron toda segunda às 06h00) | Companies + Orders | Elimina lançamento manual semanal |
| 🔴 P1 | NF-e emitida automaticamente após confirmação de entrega | Fiscal + Orders | Elimina passo manual de emissão |
| 🔴 P1 | Alerta de contratos a vencer (60/30 dias) | Companies | Evita perda de contrato por esquecimento |
| 🟠 P2 | Pesquisa de satisfação automática após entrega | Orders + futuro | Coleta NPS sem esforço humano |
| 🟠 P2 | Alerta de ruptura de estoque antes da separação | Inventory + Orders | Evita falha na entrega por falta de produto |
| 🟠 P2 | Envio do romaneio ao celular do motorista | Logistics | Elimina papel e agiliza saída da frota |
| 🟠 P2 | Notificação ao cliente quando pedido aprovado | Orders | Reduz chamadas de acompanhamento |
| 🟡 P3 | Consulta automática de CNPJ na Receita Federal | Companies | Agiliza cadastro de novo cliente |
| 🟡 P3 | Notificação ao cliente quando motorista a X paradas | Logistics | Melhora experiência de entrega |
| 🟡 P3 | Reajuste IPCA automático com API oficial | Companies | Elimina cálculo manual |
| 🟡 P3 | Abertura de ocorrência pelo cliente no portal | futuro | Reduz volume de WhatsApp |
| 🔵 P4 | App mobile nativo para o motorista (offline-first) | Logistics | Funciona sem internet no caminhão |
| 🔵 P4 | Score automático de perfil de cliente (IA) | Companies | Qualifica prospects mais rapidamente |
| 🔵 P4 | Previsão de demanda com modelo histórico (IA) | Orders + Inventory | Otimiza compras e reduz perda |
| 🔵 P4 | Cotação automática entre fornecedores | futuro módulo Compras | Reduz custo de mercadoria |

---

*Documento gerado como referência oficial para o desenvolvimento de funcionalidades do Portal VivaFrutaz ERP.*
*Nenhum código foi alterado durante a elaboração deste documento.*
