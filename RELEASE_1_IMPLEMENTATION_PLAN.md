# PORTAL VIVAFRUTAZ ERP
# RELEASE 1.0 — PLANO DE IMPLEMENTAÇÃO
## Versão 1.0 | Julho 2026
### CTO · Tech Lead · Product Owner

> **Base:** AUDITORIA_VIVAFRUTAZ_ERP · AUDITORIA_FUNCIONAL · AUDITORIA_PRODUTO · GAP_MAP · PLANO_DIRETOR_V1 · MASTER_BACKLOG
> **Regra:** Nenhuma funcionalidade nova. Escopo exclusivo do backlog existente.
> **Módulos congelados:** NF-e · SEFAZ · PIX · Boletos · CNAB · Billing · SaaS · Marketplace · White-label

---

## SUMÁRIO

1. [ETAPA 1 — Grafo de Dependências](#etapa-1--grafo-de-dependências)
2. [ETAPA 2 — Releases](#etapa-2--releases)
3. [ETAPA 3 — Sprints](#etapa-3--sprints)
4. [ETAPA 4 — Bloqueadores](#etapa-4--bloqueadores)
5. [ETAPA 5 — Ordem Ideal de Desenvolvimento](#etapa-5--ordem-ideal-de-desenvolvimento)
6. [ETAPA 6 — Detalhamento Técnico por Sprint](#etapa-6--detalhamento-técnico-por-sprint)
7. [ETAPA 7 — Roadmap Visual](#etapa-7--roadmap-visual)

---

---

# ETAPA 1 — GRAFO DE DEPENDÊNCIAS

## Mapa Completo de Dependências entre Features

```
CAMADA 0 — SEM DEPENDÊNCIAS (podem iniciar imediatamente)
──────────────────────────────────────────────────────────
FT-01.01  Senha MASTER hardcoded
FT-01.02  Endpoints públicos de métricas
FT-01.03  Unificação de middlewares de autenticação
FT-02.01  Sidebar — ocultar módulos congelados
FT-02.02  Remoção de arquivos mortos
FT-03.01  Atualização de preço sazonal em lote
FT-04.01  Alertas de vencimento de contrato  ←  requer SMTP configurado
FT-05.03  Carrinho persistente entre dispositivos
FT-06.01  Cadastro de fornecedor
FT-09.01  Escala digital de motoristas
FT-14.01  Trilhas de treinamento por perfil

CAMADA 1 — DEPENDEM DE CAMADA 0
──────────────────────────────────────────────────────────
FT-01.04  Clara memória → banco         depende de  FT-01.03
FT-05.02  Notificação de status pedido  depende de  FT-01.03 + SMTP
FT-06.02  Pedido de Compra (PO)         depende de  FT-06.01
FT-07.02  Romaneio digital separação    depende de  FT-07.01*
FT-09.02  Foto comprovante entrega      depende de  FT-09.01
FT-04.02  Reajuste IPCA em lote         depende de  FT-04.01

  * FT-07.01 depende de FT-06.03, mas pode ser parcialmente implementado
    em paralelo com layout/UI enquanto FT-06.03 não está pronta.

CAMADA 1b — DEPENDEM DE PEDIDOS ESTÁVEIS
──────────────────────────────────────────────────────────
FT-06.03  Planejamento automático       depende de  pedidos confirmados funcionando
FT-05.01  Bloqueio inadimplente         depende de  módulo financeiro (AR) em uso
FT-03.02  Cotação → Contrato            depende de  FT-04.01

CAMADA 2 — DEPENDEM DE CAMADA 1
──────────────────────────────────────────────────────────
FT-07.01  Ordem de produção digital     depende de  FT-06.03
FT-08.01  Checklist conferência carga   depende de  FT-07.02
FT-10.01  Ocorrências motorista         depende de  FT-09.02 (upload foto)
FT-09.03  Notificação ETA ao cliente    depende de  FT-09.02
FT-13.01  Clara memória persistente     = FT-01.04 (idêntico — priorizar FT-01.04)
FT-13.03  Relatório diário Clara        depende de  FT-13.01 + FT-11.01

CAMADA 3 — DEPENDEM DE CAMADA 2
──────────────────────────────────────────────────────────
FT-11.01  KPIs operacionais dashboard   depende de  FT-07.01 + FT-07.02 + FT-08.01
FT-13.02  Clara acionável               depende de  FT-13.01 + dados F2

CAMADA 4 — DEPENDEM DE CAMADA 3
──────────────────────────────────────────────────────────
FT-11.02  Consolidação dashboards       depende de  FT-11.01
FT-12.01  Onboarding portal cliente     depende de  FT-09.03 + FT-05.02
FT-12.02  Cancelamento pedido cliente   depende de  FT-05.02
FT-12.03  Clara no portal cliente       depende de  FT-13.01 (EP-13 completo)
```

## Tabela de Dependências — Referência Rápida

| Feature | Depende de | Bloqueia |
|---|---|---|
| FT-01.01 | — | — |
| FT-01.02 | — | — |
| FT-01.03 | — | FT-01.04 · FT-05.02 |
| FT-01.04 | FT-01.03 | FT-13.01 · FT-12.03 |
| FT-02.01 | — | — |
| FT-02.02 | — | — |
| FT-03.01 | — | — |
| FT-03.02 | FT-04.01 | — |
| FT-04.01 | SMTP ativo | FT-04.02 · FT-03.02 |
| FT-04.02 | FT-04.01 | — |
| FT-05.01 | AR em uso | — |
| FT-05.02 | FT-01.03 + SMTP | FT-12.01 · FT-12.02 |
| FT-05.03 | — | — |
| FT-06.01 | — | FT-06.02 |
| FT-06.02 | FT-06.01 | — |
| FT-06.03 | Pedidos confirmados | FT-07.01 |
| FT-07.01 | FT-06.03 | FT-07.02 · FT-11.01 |
| FT-07.02 | FT-07.01 | FT-08.01 · FT-11.01 |
| FT-08.01 | FT-07.02 | FT-11.01 |
| FT-09.01 | — | FT-09.02 |
| FT-09.02 | FT-09.01 | FT-09.03 · FT-10.01 |
| FT-09.03 | FT-09.02 | FT-12.01 |
| FT-10.01 | FT-09.02 | — |
| FT-11.01 | FT-07.01+07.02+08.01 | FT-11.02 · FT-13.03 |
| FT-11.02 | FT-11.01 | — |
| FT-12.01 | FT-09.03 + FT-05.02 | — |
| FT-12.02 | FT-05.02 | — |
| FT-12.03 | FT-13.01 (EP-13) | — |
| FT-13.01 | = FT-01.04 | FT-13.02 · FT-13.03 · FT-12.03 |
| FT-13.02 | FT-13.01 + dados F2 | — |
| FT-13.03 | FT-13.01 + FT-11.01 | — |
| FT-14.01 | — | — |

---

---

# ETAPA 2 — RELEASES

## RELEASE 1.0 — Fundação Segura + Núcleo Digital
**Período:** Sprint 1–4 (semanas 1–8)
**Objetivo:** Corrigir vulnerabilidades críticas de segurança e digitalizar o fluxo físico principal (separação → conferência → motorista → entrega), eliminando papel e WhatsApp da operação diária.

**Por que esta é a Release 1.0:**
- P0 de segurança (senha hardcoded, endpoints públicos) não podem ir para produção sem correção
- Romaneio + Conferência + Foto de Entrega são os três pontos de maior atrito operacional atual
- Resultados visíveis para a equipe em ≤8 semanas geram adesão ao sistema
- Tudo que está aqui tem dependência zero ou resolve dependências das releases seguintes

**Features incluídas:**
- FT-01.01 · FT-01.02 · FT-01.03 (Segurança)
- FT-02.01 · FT-02.02 (Navegação)
- FT-04.01 (Alertas contrato)
- FT-07.02 (Romaneio digital)
- FT-08.01 (Conferência de carga)
- FT-09.01 (Escala motoristas)
- FT-09.02 (Foto de entrega)
- FT-10.01 (Ocorrências motorista)

**Critério de done da Release 1.0:**
Um dia completo (pedido confirmado → separado → conferido → entregue com foto) sem uso de papel ou WhatsApp como meio principal.

---

## RELEASE 1.1 — Eliminar Controles Paralelos
**Período:** Sprint 5–8 (semanas 9–16)
**Objetivo:** Eliminar Excel como ferramenta paralela de planejamento, compras e relatório. Fechar o loop de comunicação com o cliente via sistema.

**Por que vem depois da 1.0:**
- Depende de FT-07.01 (produção) e FT-06.03 (planejamento) que requerem dados de pedidos estáveis
- Clara memória (FT-01.04) habilita melhor experiência de IA que sustenta relatório diário
- KPIs do dashboard só fazem sentido após Romaneio + Conferência estarem ativos

**Features incluídas:**
- FT-01.04 (Clara memória banco)
- FT-06.01 · FT-06.02 (Fornecedor + PO Digital)
- FT-06.03 (Planejamento automático)
- FT-07.01 (Ordem de produção digital)
- FT-05.02 (Notificação status pedido)
- FT-09.03 (ETA ao cliente)
- FT-11.01 (KPIs operacionais dashboard)

**Critério de done da Release 1.1:**
Nenhum departamento precisa de Excel ou WhatsApp para o fluxo padrão do dia. Planejamento alimentado por pedidos confirmados. Dashboard mostra realidade operacional em tempo real.

---

## RELEASE 1.2 — Comercial + Inteligência Operacional
**Período:** Sprint 9–11 (semanas 17–22)
**Objetivo:** Fechar o ciclo comercial completo dentro do sistema e habilitar Clara IA como parceira de decisão com relatórios automáticos.

**Por que vem depois da 1.1:**
- Bloqueio de inadimplente (FT-05.01) requer módulo financeiro operacional
- IPCA lote (FT-04.02) requer alertas de contrato funcionando
- Clara relatório diário (FT-13.03) requer KPIs operacionais estáveis
- Cotação → Contrato (FT-03.02) requer contratos maduros

**Features incluídas:**
- FT-03.01 (Preço sazonal em lote)
- FT-03.02 (Cotação → Contrato)
- FT-04.02 (IPCA lote)
- FT-05.01 (Bloqueio inadimplente)
- FT-05.03 (Carrinho persistente)
- FT-11.02 (Consolidação dashboards)
- FT-13.03 (Relatório diário Clara)
- FT-14.01 (Trilhas Academy)

**Critério de done da Release 1.2:**
Ciclo comercial completo no sistema. Gestor recebe relatório diário às 18h sem compilar nada. ADMIN tem um único dashboard adaptado ao seu perfil.

---

## RELEASE 2.0 — Portal do Cliente + Clara IA Acionável
**Período:** Sprint 12–14 (semanas 23–28)
**Objetivo:** Entregar o Portal do Cliente maduro e evoluir Clara de consultiva para acionável, completando o escopo da V1 conforme Plano Diretor.

**Por que é uma Release 2.0 e não 1.x:**
- Representa uma mudança de público (usuário externo, não interno)
- Clara acionável (FT-13.02) é Fase 4 do roadmap — requer dados de qualidade gerados pelas releases anteriores
- Impacto direto na experiência do cliente final: risco de imagem se entregue com bugs

**Features incluídas:**
- FT-12.01 (Onboarding portal cliente)
- FT-12.02 (Cancelamento de pedido pelo cliente)
- FT-12.03 (Clara no portal cliente)
- FT-13.02 (Clara acionável)

**Critério de done da Release 2.0:**
70% das consultas de clientes resolvidas sem intervenção da equipe. Clara cria tarefas a partir de análises com confirmação humana.

---

---

# ETAPA 3 — SPRINTS

## Estrutura de Sprint Adotada

| Campo | Valor |
|---|---|
| Duração | 2 semanas |
| Cerimônias | Planning (4h) · Daily (15min) · Review (2h) · Retro (1h) |
| Velocidade estimada | 10–14 story points por sprint |
| Escala de esforço | XS=1pt · S=2pt · M=5pt · L=8pt · XL=13pt |

---

## SPRINT 1 — Fundação de Segurança
**Semanas 1–2 | Release 1.0**
**Objetivo:** Eliminar todas as vulnerabilidades críticas de segurança e limpar a base de código antes de qualquer desenvolvimento funcional.

| Feature | Estimativa | Pontos |
|---|---|---|
| FT-01.01 Senha MASTER hardcoded | 1 dia | 2 |
| FT-01.02 Endpoints públicos métricas | 2h | 1 |
| FT-01.03 Unificação middleware autenticação | 3 dias | 5 |
| FT-02.02 Remoção arquivos mortos | 4h | 1 |
| **Total** | **~5 dias** | **9 pts** |

**Critério de aceite do Sprint:**
- [ ] `grep -rn "Master@2026!" server/` retorna zero resultados
- [ ] GET `/api/nfe/dry-run/metrics` retorna 401 sem sessão
- [ ] GET `/api/nfe/dry-run/metrics/window` retorna 401 sem sessão
- [ ] `grep -rn "authenticate" server/ --include="*.ts"` aponta apenas para re-export
- [ ] `test-clara.tsx` e `tmp_migrations.js` removidos; rotas retornam 404
- [ ] Todos os imports de middleware apontam para `requireAuthCore`

**Riscos:**
- FT-01.03 pode quebrar rotas que usavam middleware legado com comportamento diferente → mitigar com teste de regressão em todas as rotas protegidas
- Rotação de senha MASTER requer janela de manutenção → coordenar com equipe

**Dependências de entrada:** Nenhuma
**Dependências de saída:** FT-01.04 · FT-05.02 (ambas requerem FT-01.03)

---

## SPRINT 2 — Sidebar + Romaneio + Escala de Motoristas
**Semanas 3–4 | Release 1.0**
**Objetivo:** Simplificar a navegação para o usuário operacional e entregar o romaneio digital de separação — primeira eliminação de papel da operação.

| Feature | Estimativa | Pontos |
|---|---|---|
| FT-02.01 Sidebar — ocultar módulos congelados | 3 dias | 5 |
| FT-09.01 Escala digital de motoristas | 4 dias | 5 |
| **Total** | **~7 dias** | **10 pts** |

**Critério de aceite do Sprint:**
- [ ] Usuário com role OPERATOR não vê NF-e, Faturamento, SaaS, Marketplace, White-label na sidebar
- [ ] MASTER vê seção "Sistema Avançado" colapsável com módulos congelados
- [ ] Acesso direto por URL a módulo congelado por não-MASTER redireciona para /admin
- [ ] Sidebar reagrupada em: Comercial · Pedidos · Operação · Logística · Inteligência · Sistema
- [ ] Tela de escala semanal funcional com motoristas e veículos por dia
- [ ] Auto-dispatch filtra apenas motoristas com escala ativa no dia corrente
- [ ] Push notification enviada ao motorista quando escalado

**Riscos:**
- FT-02.01: rotas de módulos congelados podem ter referências diretas em outros componentes → varredura com `grep -rn "nfe\|billing\|saas\|marketplace" client/src`
- FT-09.01: tabela `driver_schedules` nova requer migração sem quebrar `logistics_drivers` existente

**Dependências de entrada:** FT-01.03 (Sprint 1)
**Dependências de saída:** FT-09.02 requer FT-09.01

---

## SPRINT 3 — Conferência de Carga + Foto de Entrega
**Semanas 5–6 | Release 1.0**
**Objetivo:** Digitalizar os dois maiores pontos de papel/WhatsApp na logística: conferência de carga antes da saída e comprovante digital de entrega.

| Feature | Estimativa | Pontos |
|---|---|---|
| FT-09.02 Foto comprovante de entrega | 1 semana | 8 |
| FT-08.01 Checklist digital conferência | 1 semana | 8 |
| **Total** | **~10 dias paralelos** | **16 pts*** |

*Executados em paralelo por duas frentes (Backend/Frontend divididos)

**Critério de aceite do Sprint:**
- [ ] Botão "Confirmar Entrega" abre câmera do dispositivo no painel do motorista
- [ ] Foto obrigatória para confirmar entrega; timestamp + GPS gravados
- [ ] Foto acessível imediatamente por LOGISTICS; vinculada ao pedido
- [ ] Pedido atualizado para DELIVERED automaticamente após foto
- [ ] Tela de conferência mostra rotas do dia com pedidos por veículo
- [ ] Divergências registradas com tipo (item faltante · errado · quantidade errada)
- [ ] Botão "Liberar Veículo" disponível apenas após conferência completa
- [ ] Log de conferência: usuário · data/hora · veículo · ocorrências

**Riscos:**
- Upload de foto em dispositivo móvel: testar `input[capture=environment]` em Android e iOS Safari
- Armazenamento de fotos: verificar bucket de storage existente no Supabase e limite de tamanho
- FT-08.01 depende de FT-07.02 (Romaneio) — mas o Romaneio está em Sprint 4; para este sprint, a conferência pode usar os pedidos APPROVED como lista base, sem esperar separação completa

**Dependências de entrada:** FT-09.01 (Sprint 2) para FT-09.02
**Dependências de saída:** FT-10.01 requer FT-09.02 · FT-11.01 requer FT-08.01

---

## SPRINT 4 — Romaneio Digital + Ocorrências + Alertas de Contrato
**Semanas 7–8 | Release 1.0**
**Objetivo:** Fechar o fluxo de separação com romaneio digital, habilitar comunicação estruturada de ocorrências pelo motorista e implementar alertas automáticos de vencimento de contrato.

| Feature | Estimativa | Pontos |
|---|---|---|
| FT-07.02 Romaneio digital de separação | 1 semana | 8 |
| FT-10.01 Registro de ocorrências motorista | 4 dias | 5 |
| FT-04.01 Alertas automáticos vencimento contrato | 4 dias | 5 |
| **Total** | **~10 dias com sobreposição** | **18 pts*** |

*FT-10.01 e FT-04.01 podem rodar em paralelo pelo mesmo desenvolvedor (backend/frontend alternados)

**Critério de aceite do Sprint:**
- [ ] Tela Romaneio lista pedidos APPROVED agrupados por rota/motorista
- [ ] Checklist por item; status muda APPROVED→PROCESSING ao iniciar, →READY ao concluir
- [ ] Divergência de separação registrada com observação
- [ ] Gestor vê progresso de separação em tempo real
- [ ] Botão "Registrar Ocorrência" disponível por parada no painel do motorista
- [ ] Tipos de ocorrência: cliente ausente · endereço errado · produto avariado · caixa faltante · outro
- [ ] Alerta em tempo real para LOGISTICS ao registrar ocorrência
- [ ] Cron job diário verifica contratos a vencer em 60, 30 e 15 dias
- [ ] E-mail + notificação in-app para contratos próximos ao vencimento
- [ ] Badge colorido (vermelho/laranja/amarelo) na listagem de contratos

**Riscos:**
- FT-07.02: separação_records depende de order_items existentes — validar schema atual
- FT-04.01: SMTP precisa estar configurado em produção antes do deploy → verificar `system_settings` para configuração SMTP
- Cron job em ambiente de produção (Supabase): confirmar suporte a pg_cron ou usar node-cron no servidor

**Dependências de entrada:** FT-09.02 (Sprint 3) para FT-10.01
**Dependências de saída:** FT-06.03 → FT-07.01 → FT-11.01 (cadeia iniciada aqui com FT-07.02)

---

## SPRINT 5 — Clara Memória + Planejamento Automático
**Semanas 9–10 | Release 1.1**
**Objetivo:** Migrar a memória da Clara para banco de dados (eliminando perda de contexto) e conectar o planejamento de compras aos pedidos confirmados.

| Feature | Estimativa | Pontos |
|---|---|---|
| FT-01.04 Clara memória → banco | 3 dias | 5 |
| FT-06.03 Planejamento alimentado por pedidos | 5 dias | 5 |
| **Total** | **~8 dias** | **10 pts** |

**Critério de aceite do Sprint:**
- [ ] Restart do servidor não apaga histórico de conversa da Clara
- [ ] Clara recupera últimas 20 interações do banco ao iniciar nova sessão
- [ ] Array em memória em `memoryModule.ts` não é mais fonte primária
- [ ] Planejamento mostra: produto · demanda (soma pedidos) · estoque atual · déficit
- [ ] Dados atualizam quando novo pedido é aprovado
- [ ] Alerta visual para produtos com déficit crítico

**Riscos:**
- FT-01.04: schema de `ai_interactions` pode precisar de campo `company_id` para multi-tenant → verificar antes de implementar
- FT-06.03: JOIN entre order_items e inventory pode ser lento sem índice — criar índice em `product_id` em ambas as tabelas

**Dependências de entrada:** FT-01.03 (Sprint 1) para FT-01.04
**Dependências de saída:** FT-07.01 requer FT-06.03 · FT-13.01 = FT-01.04

---

## SPRINT 6 — Ordem de Produção Digital + Cadastro de Fornecedor
**Semanas 11–12 | Release 1.1**
**Objetivo:** Digitalizar a ordem de produção diária (eliminar papel do turno) e criar o cadastro de fornecedores como base para o PO Digital.

| Feature | Estimativa | Pontos |
|---|---|---|
| FT-07.01 Ordem de produção digital | 1 semana | 8 |
| FT-06.01 Cadastro de fornecedor | 1 semana | 8 |
| **Total** | **~10 dias paralelos** | **16 pts*** |

*Executados em paralelo — FT-07.01 é backend-heavy, FT-06.01 é CRUD novo

**Critério de aceite do Sprint:**
- [ ] Tela de Produção exibe: produto · qtd necessária · qtd produzida · status por turno
- [ ] OPERATOR atualiza quantidade produzida em tempo real via tablet/tela
- [ ] Ao concluir item, flag de disponibilidade atualizada para Separação
- [ ] Cron/trigger gera production_orders automaticamente a partir do planejamento
- [ ] Fornecedores cadastrados com razão social, CNPJ, contato, produtos fornecidos
- [ ] Histórico de cotações por fornecedor
- [ ] Busca "quem fornece X produto?"
- [ ] Vinculação de fornecedor no cadastro de produto

**Riscos:**
- FT-07.01: evento `production.item.completed` → separação requer que o event system (core/events/) já esteja funcional
- FT-06.01: 3 novas tabelas (suppliers, supplier_products, supplier_quotes) — migrations devem ser idempotentes

**Dependências de entrada:** FT-06.03 (Sprint 5) para FT-07.01
**Dependências de saída:** FT-06.02 requer FT-06.01 · FT-11.01 requer FT-07.01

---

## SPRINT 7 — PO Digital + Notificações de Pedido + KPIs Dashboard
**Semanas 13–14 | Release 1.1**
**Objetivo:** Fechar o ciclo de compras com Pedido de Compra formal ao fornecedor e entregar o dashboard operacional com KPIs em tempo real.

| Feature | Estimativa | Pontos |
|---|---|---|
| FT-06.02 Pedido de Compra (PO) ao fornecedor | 1,5 semanas | 8 |
| FT-05.02 Notificação status pedido ao cliente | 4 dias | 5 |
| FT-11.01 KPIs operacionais dashboard | 4 dias | 5 |
| **Total** | **~14 dias sobrepostos** | **18 pts*** |

*FT-05.02 e FT-11.01 rodam em paralelo; FT-06.02 é maior e cobre as 2 semanas

**Critério de aceite do Sprint:**
- [ ] PO criado a partir do planejamento com fornecedor selecionado
- [ ] PO enviado por e-mail diretamente do sistema para o fornecedor
- [ ] Status do PO: Rascunho · Enviado · Confirmado · Recebido
- [ ] PDF do PO gerado e disponível para download
- [ ] avg_purchase_price atualizado ao marcar PO como "Recebido"
- [ ] E-mail ao cliente para: APPROVED · PROCESSING · SHIPPED · DELIVERED
- [ ] Push notification nas mesmas transições (se PWA instalado)
- [ ] Nenhum e-mail duplicado para o mesmo status no mesmo minuto
- [ ] Dashboard com 6 cards: Pedidos · Entregas · Produção · Conferência · Contratos · Inadimplência
- [ ] Cada card clicável → módulo filtrado correspondente
- [ ] Filtro de data no dashboard (hoje / semana / mês)

**Riscos:**
- FT-06.02: geração de PDF requer pdfkit funcionando — confirmar dependência instalada e funcionando
- FT-05.02: web-push VAPID precisa de chaves configuradas como secrets → verificar existência
- FT-11.01: query de `GET /api/dashboard/operational-summary` pode ser lenta sem views materializadas → considerar cache de 60s

**Dependências de entrada:** FT-06.01 (Sprint 6) para FT-06.02 · FT-01.03 (Sprint 1) + SMTP para FT-05.02 · FT-07.01 + FT-07.02 + FT-08.01 para FT-11.01
**Dependências de saída:** FT-09.03 requer FT-05.02 · FT-11.02 requer FT-11.01 · FT-13.03 requer FT-11.01

---

## SPRINT 8 — ETA ao Cliente + Preço Sazonal + Bloqueio Inadimplente
**Semanas 15–16 | Release 1.2**
**Objetivo:** Fechar a comunicação com o cliente (ETA) e implementar os principais controles comerciais (preço sazonal e bloqueio de inadimplente).

| Feature | Estimativa | Pontos |
|---|---|---|
| FT-09.03 Notificação ETA ao cliente | 4 dias | 5 |
| FT-03.01 Preço sazonal em lote | 4 dias | 5 |
| FT-05.01 Bloqueio automático inadimplente | 4 dias | 5 |
| **Total** | **~10 dias sobrepostos** | **15 pts** |

**Critério de aceite do Sprint:**
- [ ] Push/e-mail ao cliente quando pedido muda para SHIPPED
- [ ] Push/e-mail quando ETA < 30 minutos
- [ ] Link `/track?order=X&token=Y` incluído na notificação
- [ ] Tela de produtos tem opção "Atualização em Lote"
- [ ] Preview de preços (atual vs novo) antes de confirmar
- [ ] Atualização atômica com log de auditoria
- [ ] Sistema verifica inadimplência ao criar pedido
- [ ] Pedido bloqueado se AR vencido > CONFIG_INADIMPLENCIA_DIAS (padrão 15)
- [ ] ADMIN pode forçar aprovação com justificativa registrada
- [ ] Configuração de dias ajustável em Configurações

**Riscos:**
- FT-09.03: job de ETA a cada 5 min pode sobrecarregar servidor com muitas rotas ativas → implementar com debounce por pedido
- FT-05.01: módulo financeiro (AR) precisa estar em uso real — se não houver dados em `accounts_receivable`, o bloqueio sempre passa

**Dependências de entrada:** FT-09.02 (Sprint 3) para FT-09.03
**Dependências de saída:** FT-12.01 requer FT-09.03 · FT-12.02 requer FT-05.02

---

## SPRINT 9 — Contratos Avançados + Academy + Carrinho Persistente
**Semanas 17–18 | Release 1.2**
**Objetivo:** Completar o ciclo de contratos com reajuste IPCA automatizado e conversão de cotação, lançar trilhas do Academy e persistir o carrinho.

| Feature | Estimativa | Pontos |
|---|---|---|
| FT-04.02 Reajuste IPCA em lote | 4 dias | 5 |
| FT-03.02 Cotação → Contrato | 4 dias | 5 |
| FT-14.01 Trilhas de treinamento Academy | 5 dias | 5 |
| FT-05.03 Carrinho persistente | 4 dias | 5 |
| **Total** | **~12 dias sobrepostos** | **20 pts*** |

*Executar em duas frentes: FT-04.02 + FT-03.02 (comercial) e FT-14.01 + FT-05.03 (produto/UX)

**Critério de aceite do Sprint:**
- [ ] Painel "Reajustes Pendentes" lista contratos com >12 meses sem reajuste
- [ ] Bulk apply IPCA com confirmação mostrando impacto de receita
- [ ] Histórico em `contract_adjustments`
- [ ] Cotação com status "aprovada" exibe botão "Converter em Contrato"
- [ ] Contrato pré-populado com dados da cotação; status da cotação → "contratada"
- [ ] Academy com 5 categorias: Logística · Comercial · Operação · Financeiro · Administração
- [ ] Progresso do usuário rastreado por módulo
- [ ] ADMIN vê relatório de progresso de toda a equipe
- [ ] Carrinho salvo no backend; acessível em qualquer dispositivo
- [ ] Carrinho expira após 24h sem atividade

**Riscos:**
- FT-03.02: pré-popular formulário de contrato requer mapeamento cuidadoso entre campos de cotação e contrato — analisar schema antes

**Dependências de entrada:** FT-04.01 (Sprint 4) para FT-04.02 e FT-03.02
**Dependências de saída:** — (Sprint de conclusão da Release 1.2)

---

## SPRINT 10 — Dashboard Consolidado + Relatório Diário Clara
**Semanas 19–20 | Release 1.2**
**Objetivo:** Unificar os dashboards em um ponto único por perfil e ativar o relatório diário automático da Clara, encerrando a Release 1.2.

| Feature | Estimativa | Pontos |
|---|---|---|
| FT-11.02 Consolidação dashboards | 5 dias | 5 |
| FT-13.03 Relatório diário automático Clara | 4 dias | 5 |
| **Total** | **~9 dias** | **10 pts** |

**Critério de aceite do Sprint:**
- [ ] /admin mostra conteúdo por role: ADMIN (operacional+executivo) · DIRECTOR (executivo) · LOGISTICS (entregas) · FINANCEIRO (AR/AP)
- [ ] Abas opcionais permitem trocar perspectiva
- [ ] Sem remoção de dados — reorganização de apresentação
- [ ] Cron job às 18h gera relatório com: pedidos · entregas · ocorrências · top 3 produtos · inadimplência nova
- [ ] E-mail enviado para ADMIN e DIRECTOR com template HTML VivaFrutaz
- [ ] Configurável em Settings (ativar/desativar, horário)

**Riscos:**
- FT-11.02: DIRECTOR pode ter visualização diferente de ADMIN — validar com usuários antes de implementar para evitar retrabalho
- FT-13.03: e-mail às 18h em horário de Brasília requer timezone correto no cron (`TZ=America/Sao_Paulo`)

**Dependências de entrada:** FT-11.01 (Sprint 7) para ambos · FT-13.01/FT-01.04 (Sprint 5) para FT-13.03

---

## SPRINT 11 — Portal do Cliente: Onboarding + Cancelamento
**Semanas 21–22 | Release 2.0**
**Objetivo:** Entregar o Portal do Cliente com onboarding guiado e capacidade de cancelamento de pedido, iniciando a Release 2.0.

| Feature | Estimativa | Pontos |
|---|---|---|
| FT-12.01 Onboarding guiado do cliente | 4 dias | 5 |
| FT-12.02 Cancelamento de pedido pelo cliente | 4 dias | 5 |
| **Total** | **~8 dias** | **10 pts** |

**Critério de aceite do Sprint:**
- [ ] Modal de onboarding na primeira sessão com 4 steps (Pedido · Entrega · Histórico · Chamado)
- [ ] Pode pular e retomar em Perfil > "Ver Tour"
- [ ] Flag `onboarding_completed` salva no perfil
- [ ] Botão "Cancelar Pedido" disponível para pedidos CREATED dentro da janela ativa
- [ ] Cancelamento solicita motivo (obrigatório)
- [ ] ADMIN e OPERATIONS_MANAGER notificados ao cancelar
- [ ] Tentativa após cutoff exibe mensagem explicativa

**Riscos:**
- FT-12.01: gifAnimado/screenshots nos steps podem aumentar tempo de carregamento → otimizar para mobile-first

**Dependências de entrada:** FT-05.02 (Sprint 7) · FT-09.03 (Sprint 8) para FT-12.01 · FT-05.02 para FT-12.02

---

## SPRINT 12 — Clara Acionável + Clara no Portal Cliente
**Semanas 23–24 | Release 2.0**
**Objetivo:** Evoluir a Clara para modo acionável e disponibilizar versão simplificada no Portal do Cliente, completando o escopo da V1.

| Feature | Estimativa | Pontos |
|---|---|---|
| FT-13.02 Clara acionável — criação de tarefas | 1 semana | 8 |
| FT-12.03 Clara no portal do cliente | 5 dias | 5 |
| **Total** | **~10 dias** | **13 pts** |

**Critério de aceite do Sprint:**
- [ ] Clara detecta: ruptura de estoque · inadimplência >15d · contrato vencendo <30d
- [ ] Oferece criar tarefa com confirmação humana obrigatória
- [ ] Tarefa criada com título, descrição, responsável sugerido, prazo e vínculo de contexto
- [ ] Sem confirmação, nenhuma ação é tomada (ADR-008)
- [ ] Botão flutuante "Clara" em todas as telas do portal cliente
- [ ] Clara responde sobre: status do meu último pedido · próxima janela · produtos disponíveis
- [ ] Clara não acessa dados de outros clientes (scope: client com company_id restrito)

**Riscos:**
- FT-13.02: detecção de padrões requer dados de qualidade coletados nas releases anteriores — executar apenas quando F2 tiver ≥4 semanas de dados reais
- FT-12.03: prompt de escopo CLIENT da Clara deve ser cuidadosamente testado para não vazar dados de outros clientes

**Dependências de entrada:** FT-13.01/FT-01.04 (Sprint 5) para ambos · FT-12.01 + FT-12.02 (Sprint 11)

---

---

# ETAPA 4 — BLOQUEADORES

## B-01 — MIDDLEWARE DE AUTENTICAÇÃO (FT-01.03)
**Bloqueia:** FT-01.04 · FT-05.02
**Por quê:** Dois middlewares paralelos (`authenticate.ts` e `requireAuthCore`) criam comportamento imprevisível. Qualquer feature nova construída sobre o middleware errado herda a insegurança.
**Solução:** FT-01.03 deve ser o **primeiro item técnico executado**, antes de qualquer outra feature.
**Prazo para desbloqueio:** Sprint 1

## B-02 — SMTP NÃO CONFIGURADO
**Bloqueia:** FT-04.01 (Alertas contrato) · FT-05.02 (Notificações pedido) · FT-06.02 (PO por e-mail) · FT-13.03 (Relatório Clara)
**Por quê:** Sem SMTP ativo, qualquer feature que envia e-mail falha silenciosamente ou quebra o fluxo.
**Solução:** Antes do Sprint 4, verificar `system_settings` para SMTP. Se não configurado, adicionar como tarefa de infra fora do sprint (2h de setup com Resend ou SendGrid via secrets).
**Prazo para desbloqueio:** Pré-Sprint 4

## B-03 — MÓDULO FINANCEIRO (AR) SEM USO REAL
**Bloqueia:** FT-05.01 (Bloqueio inadimplente)
**Por quê:** A verificação de inadimplência consulta `accounts_receivable`. Se a tabela está vazia ou desatualizada, o bloqueio nunca dispara.
**Solução:** Validar com a equipe financeira se AR está sendo alimentado. Se não, FT-05.01 deve ser postergada para quando o módulo estiver em uso — ou implementada com flag de "simulação" durante testes.
**Prazo para desbloqueio:** Confirmar no Sprint 7 antes de alocar FT-05.01 ao Sprint 8

## B-04 — DADOS DE QUALIDADE PARA CLARA IA ACIONÁVEL (FT-13.02)
**Bloqueia:** FT-13.02 (Clara acionável)
**Por quê:** Clara acionável detecta padrões (ruptura de estoque, inadimplência, contratos vencendo). Esses padrões só são detectáveis com pelo menos 4–6 semanas de dados reais gerados pelos módulos operacionais.
**Solução:** FT-13.02 só é iniciada no Sprint 12, após Release 1.1 estar em produção e gerando dados. Não antecipar.
**Prazo para desbloqueio:** Sprint 12 (após ≥4 semanas de dados de R1.1)

## B-05 — PLANEJAMENTO SEM PEDIDOS CONFIRMADOS (FT-06.03 → FT-07.01)
**Bloqueia:** FT-06.03 (Planejamento automático) e por consequência FT-07.01 (Produção digital)
**Por quê:** FT-06.03 depende de `order_items JOIN orders WHERE status IN ('APPROVED','PROCESSING')`. Se os pedidos não estiverem sendo aprovados formalmente no sistema, o planejamento retorna vazio.
**Solução:** Confirmar com a equipe que o fluxo de aprovação de pedidos está ativo antes de implementar FT-06.03. Adicionar dado de seed de teste se necessário.
**Prazo para desbloqueio:** Sprint 5

## B-06 — STORAGE DE FOTO SEM BUCKET CONFIGURADO (FT-09.02)
**Bloqueia:** FT-09.02 (Foto de entrega) e por consequência FT-10.01 (Ocorrências)
**Por quê:** Upload de foto requer bucket de storage no Supabase configurado com políticas de acesso corretas.
**Solução:** Verificar se bucket de storage existe antes do Sprint 3. Se não, criar bucket `delivery-photos` com política de leitura pública e escrita autenticada. Tarefa de infra: 1h.
**Prazo para desbloqueio:** Pré-Sprint 3

## B-07 — MÓDULOS QUE PRECISAM SER REORGANIZADOS ANTES
**Por quê:** Antes de construir FT-11.01 (KPIs Dashboard), os módulos de Produção (FT-07.01), Romaneio (FT-07.02) e Conferência (FT-08.01) precisam existir e estar gerando dados reais.
**Impacto:** Não há como mostrar "% de produção concluída" se não existe tabela `production_orders`.
**Solução:** Sequência estrita — nenhum sprint pode pular um pré-requisito.

## B-08 — REFATORAÇÕES OBRIGATÓRIAS ANTES DE NOVAS FEATURES
| Refatoração | Quando | Por quê |
|---|---|---|
| Unificação de middleware (FT-01.03) | Sprint 1 (imediato) | Todo endpoint novo herda a decisão |
| Migração memória Clara (FT-01.04) | Sprint 5 | Histórico perdido a cada restart invalida testes de F2 |
| Reorganização sidebar (FT-02.01) | Sprint 2 | Novas telas devem ser adicionadas já nos grupos corretos |
| Schema `ai_interactions` + tenant | Sprint 5 | Antes de persistir qualquer dado de IA |

---

---

# ETAPA 5 — ORDEM IDEAL DE DESENVOLVIMENTO

```
SPRINT 1  ──► Segurança
              FT-01.01 · FT-01.02 · FT-01.03 · FT-02.02
              ↓
              Fundação técnica segura para todo o desenvolvimento futuro

SPRINT 2  ──► Navegação + Escala de Motoristas
              FT-02.01 · FT-09.01
              ↓
              Sidebar limpa; auto-dispatch funcional

SPRINT 3  ──► Conferência + Foto de Entrega
              FT-08.01 · FT-09.02
              ↓
              Primeiro papel eliminado; primeiro WhatsApp eliminado

SPRINT 4  ──► Romaneio + Ocorrências + Contratos
              FT-07.02 · FT-10.01 · FT-04.01
              ↓
              Fluxo físico completo digitalizado; contratos monitorados

              ═══ RELEASE 1.0 ENTREGUE ═══

SPRINT 5  ──► Clara Memória + Planejamento Automático
              FT-01.04 · FT-06.03
              ↓
              Clara com memória; compras guiadas por dados reais

SPRINT 6  ──► Ordem de Produção + Fornecedores
              FT-07.01 · FT-06.01
              ↓
              Papel do turno eliminado; cadastro de fornecedor pronto

SPRINT 7  ──► PO Digital + Notificações + KPIs
              FT-06.02 · FT-05.02 · FT-11.01
              ↓
              Excel de compras eliminado; cliente notificado; dashboard real

              ═══ RELEASE 1.1 ENTREGUE ═══

SPRINT 8  ──► ETA + Preço Sazonal + Inadimplência
              FT-09.03 · FT-03.01 · FT-05.01
              ↓
              WhatsApp de entrega eliminado; comercial mais ágil

SPRINT 9  ──► Contratos Avançados + Academy + Carrinho
              FT-04.02 · FT-03.02 · FT-14.01 · FT-05.03
              ↓
              IPCA automatizado; cotação integrada; equipe treinada

SPRINT 10 ──► Dashboard Consolidado + Relatório Clara
              FT-11.02 · FT-13.03
              ↓
              Um dashboard por perfil; relatório chega sem compilação manual

              ═══ RELEASE 1.2 ENTREGUE ═══

SPRINT 11 ──► Portal do Cliente
              FT-12.01 · FT-12.02
              ↓
              Cliente se autoatende; cancelamentos formais

SPRINT 12 ──► Clara Acionável + Clara no Portal
              FT-13.02 · FT-12.03
              ↓
              Clara cria tarefas com confirmação; cliente tem IA no portal

              ═══ RELEASE 2.0 ENTREGUE ═══
```

---

---

# ETAPA 6 — DETALHAMENTO TÉCNICO POR SPRINT

---

## SPRINT 1 — Segurança

**Objetivo:** Eliminar vulnerabilidades P0 antes de qualquer desenvolvimento funcional.

### Arquivos Afetados
```
server/routes/routes.ts                    → FT-01.01: remover senha hardcoded ~linha 3560
server/shared/middlewares/authenticate.ts  → FT-01.03: marcar como @deprecated / re-export
server/core/http/requireAuth.ts            → FT-01.03: middleware canônico
client/src/pages/test-clara.tsx            → FT-02.02: remover
client/src/App.tsx                         → FT-02.02: remover rota /test-clara
tmp_migrations.js                          → FT-02.02: remover da raiz
package.json                               → FT-02.02: playwright/ngrok → devDependencies
```

### Banco Envolvido
```sql
-- FT-01.01: rotação de senha (executar manualmente no Supabase)
UPDATE users
SET password = '[bcrypt_hash_nova_senha]'
WHERE email = 'master@vivafrutaz.com';
```

### APIs
```
GET /api/nfe/dry-run/metrics         → adicionar requireAuthCore
GET /api/nfe/dry-run/metrics/window  → adicionar requireAuthCore
```

### Backend
- Substituir `password: "Master@2026!"` por `process.env.MASTER_SEED_PASSWORD ?? generateSecurePassword()`
- Varredura completa: `grep -rn "password.*=.*\"" server/ --include="*.ts"`
- Substituir todos os imports de `authenticate` pelo canônico `requireAuthCore`
- Adicionar JSDoc `@deprecated` em `authenticate.ts`

### Frontend
- Remover `<Route path="/test-clara" component={TestClara} />` de App.tsx
- Remover import de `test-clara.tsx`

### Testes
```bash
# Verificar ausência de senha hardcoded
grep -rn "Master@2026\!" server/ --include="*.ts"  # deve retornar vazio

# Verificar proteção dos endpoints
curl -X GET https://$REPLIT_DEV_DOMAIN/api/nfe/dry-run/metrics
# Esperado: 401 Unauthorized

# Verificar middleware unificado
grep -rn "from.*authenticate" server/ --include="*.ts"
# Deve apontar apenas para re-export do requireAuthCore
```

### Critério de Aceite
- [ ] Zero senhas hardcoded no código
- [ ] Métricas NF-e retornam 401 sem sessão
- [ ] Um único módulo de autenticação ativo
- [ ] Arquivos mortos removidos; rotas retornam 404

### Checklist QA
- [ ] Login com usuário MASTER funciona normalmente após rotação de senha
- [ ] Login com usuário não-MASTER funciona normalmente
- [ ] Rota `/test-clara` retorna 404
- [ ] Rota `/api/nfe/dry-run/metrics` retorna 401 sem sessão
- [ ] Rota `/api/nfe/dry-run/metrics` retorna 200 com sessão MASTER
- [ ] Nenhuma rota operacional quebrada após unificação de middleware
- [ ] `npm run build` sem erros TypeScript

---

## SPRINT 2 — Sidebar + Escala de Motoristas

**Objetivo:** Limpeza de navegação e base de escala para auto-dispatch funcional.

### Arquivos Afetados
```
client/src/components/Layout.tsx           → FT-02.01: lógica de filtragem por role
client/src/App.tsx                         → FT-02.01: FrozenModuleGuard nas rotas
client/src/constants/frozenModules.ts      → FT-02.01: novo arquivo com listas de rotas
server/modules/logistics/                  → FT-09.01: novo arquivo de schedule service
migrations/YYYYMMDD_driver_schedules.sql   → FT-09.01: nova tabela
client/src/pages/admin/logistics.tsx       → FT-09.01: UI de escala semanal
```

### Banco Envolvido
```sql
-- FT-09.01
CREATE TABLE driver_schedules (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id   uuid NOT NULL REFERENCES logistics_drivers(id),
  vehicle_id  uuid REFERENCES vehicles(id),
  date        date NOT NULL,
  shift       varchar(20) DEFAULT 'full',  -- morning/afternoon/full
  status      varchar(20) DEFAULT 'available',
  notes       text,
  created_by  uuid REFERENCES users(id),
  created_at  timestamptz DEFAULT now()
);
CREATE INDEX idx_driver_schedules_date ON driver_schedules(date);
```

### APIs
```
GET  /api/driver-schedules?date=YYYY-MM-DD
POST /api/driver-schedules
PATCH /api/driver-schedules/:id
DELETE /api/driver-schedules/:id
```

### Backend
- Constante `FROZEN_MODULE_ROUTES` em `constants/frozenModules.ts`
- HOC `<FrozenModuleGuard>` redireciona não-MASTER para /admin
- `autoDispatchService.getAvailableDrivers(date)` filtra por `driver_schedules`
- Push notification ao motorista quando incluído na escala

### Frontend
- `menuItems.filter()` baseado em role e FROZEN_MODULE_ROUTES
- Accordion "Sistema Avançado" colapsável no rodapé da sidebar para MASTER/DEVELOPER
- Reordenar grupos: Comercial · Pedidos · Operação · Logística · Inteligência · Sistema
- Tabela semanal de escala: motoristas nas linhas, dias nas colunas, editável

### Testes
```bash
# Testar filtragem de sidebar por role
# Login como OPERATOR e verificar que sidebar não tem itens de NF-e

# Testar auto-dispatch com escala
# Criar escala para motorista no dia, verificar que auto-dispatch o inclui
# Remover da escala, verificar que auto-dispatch o exclui
```

### Critério de Aceite
- [ ] Usuário OPERATOR não vê módulos congelados
- [ ] MASTER vê seção colapsável com módulos avançados
- [ ] Acesso direto por URL a rota congelada → redirect para /admin
- [ ] Escala criada; auto-dispatch usa apenas escalados

### Checklist QA
- [ ] Cada role testado: ADMIN · SALES · OPERATOR · LOGISTICS · FINANCEIRO
- [ ] Nenhum link para NF-e, Faturamento, SaaS visível para não-MASTER
- [ ] MASTER consegue acessar módulos congelados pela sidebar
- [ ] Auto-dispatch não sugere motorista não escalado
- [ ] Push notification chega ao motorista ao ser adicionado à escala

---

## SPRINT 3 — Conferência + Foto de Entrega

**Objetivo:** Eliminar papel e WhatsApp do circuito de conferência de carga e comprovante de entrega.

### Arquivos Afetados
```
migrations/YYYYMMDD_cargo_checks.sql       → FT-08.01: tabelas de conferência
migrations/YYYYMMDD_delivery_photo.sql     → FT-09.02: campos de foto em deliveries
server/routes/cargo-check.routes.ts        → FT-08.01: novo arquivo de rotas
server/routes/delivery-photo.routes.ts     → FT-09.02: upload de foto
client/src/pages/admin/cargo-check.tsx     → FT-08.01: nova tela
client/src/pages/admin/driver-panel.tsx    → FT-09.02: botão de câmera + confirmação
client/src/pages/admin/logistics.tsx       → FT-09.02: exibição de foto na listagem
```

### Banco Envolvido
```sql
-- FT-08.01
CREATE TABLE cargo_checks (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  route_id     uuid NOT NULL,
  vehicle_id   uuid NOT NULL,
  checked_by   uuid REFERENCES users(id),
  status       varchar(20) DEFAULT 'pending', -- pending/in_progress/completed
  started_at   timestamptz,
  completed_at timestamptz,
  notes        text,
  created_at   timestamptz DEFAULT now()
);

CREATE TABLE cargo_check_items (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cargo_check_id    uuid NOT NULL REFERENCES cargo_checks(id),
  order_id          uuid NOT NULL REFERENCES orders(id),
  status            varchar(20) DEFAULT 'pending', -- pending/checked/divergence
  divergence_type   varchar(50),
  divergence_notes  text
);

-- FT-09.02
ALTER TABLE deliveries
  ADD COLUMN delivery_photo_url text,
  ADD COLUMN delivery_lat       decimal(10,8),
  ADD COLUMN delivery_lng       decimal(11,8),
  ADD COLUMN photo_taken_at     timestamptz;
```

### APIs
```
POST  /api/cargo-checks
GET   /api/cargo-checks/:id
PATCH /api/cargo-checks/:id/item        → marcar item conferido / divergência
POST  /api/cargo-checks/:id/release     → liberar veículo
POST  /api/logistics/deliveries/:id/photo  → upload multipart/form-data
GET   /api/logistics/deliveries/:id/photo  → URL da foto
```

### Backend
- Middleware de upload: `multer` ou solução de upload direto para Supabase Storage
- Bucket `delivery-photos` com política de acesso (LOGISTICS lê, DRIVER escreve)
- Ao liberar veículo (`/release`): emitir evento `cargo.vehicle.released` → push para motorista
- Validação: `completed_at` só pode ser preenchido se todos os `cargo_check_items` têm status ≠ pending

### Frontend
- `cargo-check.tsx`: cards de rota/veículo → lista de pedidos → checkboxes → modal de divergência → botão Liberar
- `driver-panel.tsx`: `<input type="file" accept="image/*" capture="environment">` com preview
- Exibir foto thumbnail na linha do pedido em `logistics.tsx`

### Testes
```bash
# Testar upload de foto em mobile
# Abrir driver-panel em dispositivo móvel, tirar foto, verificar upload

# Testar conferência
# Criar cargo_check, marcar todos os itens, verificar que liberar fica disponível
# Tentar liberar com item pendente — deve bloquear

# Testar GPS na foto
# Verificar que lat/lng são capturados junto com a foto
```

### Critério de Aceite
- [ ] Foto obrigatória para confirmar entrega
- [ ] Foto acessível imediatamente por LOGISTICS
- [ ] Pedido → DELIVERED automaticamente após foto
- [ ] Liberar veículo bloqueado até conferência completa
- [ ] Divergências registradas com tipo e nota

### Checklist QA
- [ ] Upload de foto funcional em Android Chrome
- [ ] Upload de foto funcional em iOS Safari
- [ ] Foto com GPS: lat/lng gravados na entrega
- [ ] Foto sem GPS (permissão negada): entrega ainda funciona, lat/lng = null
- [ ] Conferência: liberar veículo com item pendente → botão desabilitado
- [ ] Conferência: liberar veículo com todos conferidos → libera e notifica motorista
- [ ] Foto visível para LOGISTICS em logistics.tsx
- [ ] Foto visível para CLIENT no portal (preparado, será habilitado em Sprint 11)

---

## SPRINT 4 — Romaneio + Ocorrências + Alertas de Contrato

**Objetivo:** Fechar o fluxo de separação digitalmente, estruturar comunicação de ocorrências e alertar renovações de contrato.

### Arquivos Afetados
```
migrations/YYYYMMDD_separation_records.sql  → FT-07.02
migrations/YYYYMMDD_delivery_incidents.sql  → FT-10.01
server/jobs/contract-alerts.cron.ts         → FT-04.01: novo cron job
server/routes/romaneio.routes.ts            → FT-07.02: novo
server/routes/incidents.routes.ts           → FT-10.01: novo
client/src/pages/admin/romaneio.tsx         → FT-07.02: nova tela mobile-first
client/src/pages/admin/driver-panel.tsx     → FT-10.01: formulário de ocorrência
client/src/pages/admin/contracts.tsx        → FT-04.01: badge de urgência
client/src/pages/admin/dashboard.tsx        → FT-04.01: card "Contratos a Vencer"
```

### Banco Envolvido
```sql
-- FT-07.02
CREATE TABLE separation_records (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id            uuid NOT NULL REFERENCES orders(id),
  order_item_id       uuid NOT NULL,
  quantity_requested  decimal NOT NULL,
  quantity_separated  decimal DEFAULT 0,
  status              varchar(20) DEFAULT 'pending', -- pending/separated/divergence
  notes               text,
  separated_by        uuid REFERENCES users(id),
  separated_at        timestamptz
);

-- FT-10.01
CREATE TABLE delivery_incidents (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id    uuid NOT NULL REFERENCES orders(id),
  driver_id   uuid NOT NULL,
  type        varchar(50) NOT NULL, -- absent/wrong_address/damaged/missing_box/other
  description text,
  photo_url   text,
  gps_lat     decimal(10,8),
  gps_lng     decimal(11,8),
  status      varchar(20) DEFAULT 'open', -- open/resolved
  created_at  timestamptz DEFAULT now()
);
CREATE INDEX idx_delivery_incidents_order ON delivery_incidents(order_id);
```

### APIs
```
GET  /api/orders/:id/romaneio
POST /api/orders/:id/separation-item
POST /api/orders/:id/separation-complete

POST /api/logistics/incidents
GET  /api/logistics/incidents?orderId=
GET  /api/companies/:id/incidents     → histórico por cliente

GET  /api/contracts/expiring?days=60  → contratos a vencer
```

### Backend
- Cron job `contract-alerts.cron.ts`: diário às 07:00 BRT
- Query: `SELECT * FROM contratos_clientes WHERE data_fim BETWEEN NOW() AND NOW() + INTERVAL '60 days' AND status = 'ativo'`
- Enviar e-mail para ADMIN e DIRECTOR com template HTML de lista de contratos
- Transição de status de pedido: APPROVED → (inicia separação) → PROCESSING → (todos separados) → READY
- Evento `delivery.incident.created` → WebSocket push para LOGISTICS

### Frontend
- `romaneio.tsx`: cards de pedido por rota, itens com checkbox, botão "Separação Concluída"
- `driver-panel.tsx`: drawer de ocorrência com select de tipo + textarea + foto opcional
- `contracts.tsx`: badge colorido (vermelho/laranja/amarelo) por urgência de vencimento
- `dashboard.tsx`: card "Contratos a Vencer" com contagem e link filtrado

### Testes
```bash
# Testar romaneio
# Marcar todos os itens de um pedido → verificar status = READY
# Marcar divergência → verificar registro e observação

# Testar ocorrência
# Registrar ocorrência no driver-panel → verificar push para LOGISTICS
# Verificar histórico de ocorrências em companies/:id

# Testar cron de contratos
# Criar contrato com data_fim em 14 dias → executar cron → verificar e-mail + badge
```

### Critério de Aceite
- [ ] Status APPROVED → PROCESSING → READY via romaneio
- [ ] Ocorrência registrada com categoria e nota; LOGISTICS notificado
- [ ] Cron diário dispara alertas de contratos a vencer
- [ ] Badge colorido na listagem de contratos
- [ ] Card no dashboard com contagem de contratos a vencer

### Checklist QA
- [ ] Romaneio com todos os itens marcados → pedido = READY
- [ ] Romaneio com divergência → pedido = PROCESSING (não avança para READY)
- [ ] Ocorrência salva com type, description, vinculada ao order_id
- [ ] Alerta de contrato não dispara duas vezes no mesmo dia para o mesmo contrato
- [ ] Badge vermelho para contratos < 15 dias
- [ ] Badge laranja para contratos < 30 dias
- [ ] Badge amarelo para contratos < 60 dias
- [ ] E-mail de alerta de contrato recebido por ADMIN e DIRECTOR

---

## SPRINT 5 — Clara Memória + Planejamento Automático

**Objetivo:** Persistência de contexto da Clara e planejamento de compras guiado por dados reais.

### Arquivos Afetados
```
server/services/memoryModule.ts              → FT-01.04: substituir array por banco
migrations/YYYYMMDD_ai_interactions_fix.sql  → FT-01.04: garantir campo company_id
server/routes/purchase-planning.routes.ts    → FT-06.03: atualizar endpoint
client/src/pages/admin/purchase-planning.tsx → FT-06.03: UI com cálculo automático
```

### Banco Envolvido
```sql
-- FT-01.04: verificar e adicionar campos se necessário
ALTER TABLE ai_interactions
  ADD COLUMN IF NOT EXISTS company_id uuid,
  ADD COLUMN IF NOT EXISTS session_id varchar(100);
CREATE INDEX IF NOT EXISTS idx_ai_interactions_user ON ai_interactions(user_id, created_at DESC);

-- FT-06.03: view de planejamento
CREATE OR REPLACE VIEW purchase_planning_view AS
SELECT
  oi.product_id,
  p.name AS product_name,
  p.category,
  SUM(oi.quantity) AS demand,
  COALESCE(inv.current_stock, 0) AS current_stock,
  GREATEST(0, SUM(oi.quantity) - COALESCE(inv.current_stock, 0)) AS deficit
FROM order_items oi
JOIN orders o ON o.id = oi.order_id
JOIN products p ON p.id = oi.product_id
LEFT JOIN inventory inv ON inv.product_id = oi.product_id
WHERE o.status IN ('APPROVED', 'PROCESSING')
GROUP BY oi.product_id, p.name, p.category, inv.current_stock;
```

### APIs
```
GET /api/purchase-planning/auto?dateFrom=&dateTo=  → retorna view de planejamento
```

### Backend
- `memoryModule.ts`: `addMessage()` → INSERT em `ai_interactions`; `getHistory()` → SELECT com LIMIT 20 ORDER BY created_at DESC
- Remover array `[]` de estado em memória
- Planejamento: cruzar demand com `inventory.current_stock`; destacar produtos com `deficit > 0`

### Frontend
- `purchase-planning.tsx`: substituir inputs manuais por cálculo automático; override manual permitido com indicação visual
- Alerta visual para produtos com déficit (badge vermelho na linha)

### Testes
```bash
# Testar memória Clara
# Conversar com Clara; reiniciar servidor; abrir nova conversa → Clara menciona contexto anterior

# Testar planejamento
# Criar pedido aprovado com 100 unidades de produto X (estoque=30) → planejamento mostra déficit=70
```

### Critério de Aceite
- [ ] Histórico de Clara persiste após restart
- [ ] Planejamento mostra demanda · estoque · déficit calculados automaticamente
- [ ] Atualiza quando novo pedido é aprovado

### Checklist QA
- [ ] Clara recupera últimas 20 interações ao abrir nova sessão
- [ ] Clara com company_id correto (não mistura contexto entre tenants)
- [ ] Planejamento com pedidos aprovados: déficit correto calculado
- [ ] Planejamento sem pedidos: mostra demanda = 0, sem erro
- [ ] Override manual de quantidade funciona e mantém indicação visual de "editado"

---

## SPRINTS 6–12 — Padrão de Documentação

> Os sprints 6 a 12 seguem o mesmo padrão de detalhamento dos Sprints 1–5 acima.
> Por questões de tamanho do documento, os campos principais estão listados abaixo de forma compacta.
> O detalhamento completo pode ser expandido em documento específico por sprint conforme necessidade da equipe.

### Sprint 6 — Produção Digital + Fornecedores
| Campo | Detalhe |
|---|---|
| **Arquivos principais** | `migrations/*_production_orders.sql` · `migrations/*_suppliers.sql` · `admin/production.tsx` (novo) · `admin/suppliers.tsx` (novo) |
| **Banco** | Tabelas: `production_orders` · `supplier_products` · `supplier_quotes` |
| **APIs** | GET/POST/PATCH `/api/production-orders` · CRUD `/api/suppliers` · GET `/api/suppliers/:id/products` |
| **Testes críticos** | Cron gera production_orders a partir do planejamento · Busca "quem fornece X?" retorna correto |

### Sprint 7 — PO Digital + Notificações + Dashboard
| Campo | Detalhe |
|---|---|
| **Arquivos principais** | `migrations/*_purchase_orders.sql` · `admin/purchase-orders.tsx` (novo) · `core/events/` (listener de status) · `admin/dashboard.tsx` (KPI cards) |
| **Banco** | Tabelas: `purchase_orders` · `purchase_order_items` |
| **APIs** | CRUD `/api/purchase-orders` · POST `/:id/send` · GET `/api/dashboard/operational-summary` |
| **Testes críticos** | PO enviado por e-mail ao fornecedor · avg_purchase_price atualizado ao receber PO · 6 KPI cards corretos no dashboard |

### Sprint 8 — ETA + Preço Sazonal + Bloqueio Inadimplente
| Campo | Detalhe |
|---|---|
| **Arquivos principais** | `server/jobs/eta-checker.cron.ts` (novo) · `admin/products.tsx` (bulk action) · `server/modules/finance/inadimplencia.service.ts` (novo) |
| **Banco** | `system_settings` com chave `inadimplencia_dias_bloqueio` |
| **APIs** | POST `/api/products/bulk-price-update` · POST `/api/orders/:id` (verificação inadimplência) · Cron ETA |
| **Testes críticos** | Push ETA < 30 min enviado corretamente · Preview de preços antes de confirmar bulk · Pedido bloqueado para inadimplente |

### Sprint 9 — Contratos Avançados + Academy + Carrinho
| Campo | Detalhe |
|---|---|
| **Arquivos principais** | `admin/contracts.tsx` (aba reajustes) · `admin/quotations.tsx` (botão converter) · `admin/treinamento.tsx` (tabs por perfil) · `migrations/*_order_drafts.sql` |
| **Banco** | Tabelas: `training_tracks` · `training_progress` · `order_drafts` · `contract_adjustments` |
| **APIs** | POST `/api/contracts/bulk-ipca-adjustment` · POST `/api/contracts/from-quotation/:id` · PUT/GET `/api/orders/draft` |
| **Testes críticos** | Impacto de receita exibido antes de aplicar IPCA · Cotação convertida cria contrato pré-preenchido · Carrinho persistido ao trocar dispositivo |

### Sprint 10 — Dashboard Consolidado + Relatório Clara
| Campo | Detalhe |
|---|---|
| **Arquivos principais** | `admin/dashboard.tsx` (refatoração por role) · `server/jobs/daily-report.cron.ts` (novo) · `server/templates/daily-report.html` (novo) |
| **Banco** | `system_settings` com chave `daily_report_enabled` e `daily_report_time` |
| **APIs** | Cron 18:00 BRT (`TZ=America/Sao_Paulo`) |
| **Testes críticos** | Dashboard ADMIN vs DIRECTOR vs LOGISTICS mostra seções corretas · E-mail de relatório com dados reais do dia |

### Sprint 11 — Portal do Cliente
| Campo | Detalhe |
|---|---|
| **Arquivos principais** | `client/src/components/ClientOnboarding.tsx` (novo) · `client/src/pages/client/order-history.tsx` (botão cancelar) · `migrations/*_onboarding_flag.sql` |
| **Banco** | `ALTER TABLE users ADD COLUMN onboarding_completed boolean DEFAULT false` |
| **APIs** | POST `/api/orders/:id/client-cancel` (valida janela aberta) |
| **Testes críticos** | Onboarding aparece apenas na primeira sessão · Cancelamento bloqueado após cutoff · Motivo obrigatório no cancelamento |

### Sprint 12 — Clara Acionável + Clara no Portal
| Campo | Detalhe |
|---|---|
| **Arquivos principais** | `server/routes/clara.routes.ts` (scope CLIENT + detectActionableInsights) · `admin/tasks.tsx` (integração) · Portal: botão flutuante Clara |
| **Banco** | Tabelas: `tasks` (existente ou novo) para tarefas criadas pela Clara |
| **APIs** | POST `/api/tasks/from-clara` · GET `/api/clara/client` (escopo restrito) |
| **Testes críticos** | Clara não cria tarefa sem confirmação humana · Clara CLIENT não acessa dados de outras empresas · Detecção de ruptura de estoque com dados reais |

---

---

# ETAPA 7 — ROADMAP VISUAL

```
JULHO 2026                                              DEZEMBRO 2026
│                                                                     │
▼                                                                     ▼

SEM 01  SEM 02  SEM 03  SEM 04  SEM 05  SEM 06  SEM 07  SEM 08
████████████████                                                    Sprint 1: Segurança
                ████████████████                                    Sprint 2: Sidebar + Escala
                                ████████████████                    Sprint 3: Conferência + Foto
                                                ████████████████    Sprint 4: Romaneio + Ocorrências + Contratos
                                                                │
                                                     ┌──────────┘
                                              ╔══════════════════════════╗
                                              ║   RELEASE 1.0 — semana 8 ║
                                              ╚══════════════════════════╝

SEM 09  SEM 10  SEM 11  SEM 12  SEM 13  SEM 14  SEM 15  SEM 16
████████████████                                                    Sprint 5: Clara Memória + Planejamento
                ████████████████                                    Sprint 6: Produção Digital + Fornecedores
                                ████████████████                    Sprint 7: PO Digital + Notificações + KPIs
                                                ████████████████    Sprint 8: ETA + Preço Sazonal + Inadimplência
                                                                │
                                                     ┌──────────┘
                                              ╔══════════════════════════╗
                                              ║   RELEASE 1.1 — semana 16║
                                              ╚══════════════════════════╝

SEM 17  SEM 18  SEM 19  SEM 20  SEM 21  SEM 22  SEM 23  SEM 24
████████████████                                                    Sprint 9: Contratos + Academy + Carrinho
                ████████████████                                    Sprint 10: Dashboard Consolidado + Clara Relatório
                                ████████████████                    Sprint 11: Portal do Cliente
                                                ████████████████    Sprint 12: Clara Acionável + Clara no Portal
                                                                │
                                              ┌─────────────────┘
                              ╔═══════════════════════════════════╗
                              ║  RELEASE 1.2 — semana 20          ║
                              ╚═══════════════════════════════════╝
                                                ╔══════════════════════════╗
                                                ║  RELEASE 2.0 — semana 24 ║
                                                ╚══════════════════════════╝


LEGENDA DE MÓDULOS POR SPRINT
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Sprint 1  ████  Segurança (P0)       FT-01.01 · FT-01.02 · FT-01.03 · FT-02.02
Sprint 2  ████  Navegação            FT-02.01 · FT-09.01
Sprint 3  ████  Logística Física     FT-08.01 · FT-09.02
Sprint 4  ████  Operação Digital     FT-07.02 · FT-10.01 · FT-04.01
          ─────────────────── RELEASE 1.0 ────────────────────────────────

Sprint 5  ████  Inteligência Base    FT-01.04 · FT-06.03
Sprint 6  ████  Produção + Compras   FT-07.01 · FT-06.01
Sprint 7  ████  Comercial Digital    FT-06.02 · FT-05.02 · FT-11.01
Sprint 8  ████  Comercial Avançado   FT-09.03 · FT-03.01 · FT-05.01
          ─────────────────── RELEASE 1.1 ────────────────────────────────

Sprint 9  ████  Contratos + Academy  FT-04.02 · FT-03.02 · FT-14.01 · FT-05.03
Sprint 10 ████  Consolidação         FT-11.02 · FT-13.03
          ─────────────────── RELEASE 1.2 ────────────────────────────────

Sprint 11 ████  Portal Cliente       FT-12.01 · FT-12.02
Sprint 12 ████  Clara IA Completa    FT-13.02 · FT-12.03
          ─────────────────── RELEASE 2.0 ────────────────────────────────


MAPA DE ELIMINAÇÃO DE CONTROLES PARALELOS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📄 PAPEL       ████████ Eliminado na semana 8 (Sprint 4 — Romaneio completo)
📱 WHATSAPP    ████████████████ Eliminado na semana 16 (Sprint 8 — ETA cliente)
✂️ EXCEL       ████████████████████ Eliminado na semana 20 (Sprint 10 — Relatório automático)
🔁 RETRABALHO  ████████████████████████ Eliminado na semana 20 (ciclo comercial fechado)
🖥️ UX          ████████████████████████████████ Melhorado continuamente até semana 24


MARCOS CRÍTICOS (Gates de Qualidade)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Semana 1  ·  GATE SEGURANÇA: zero senhas hardcoded, endpoints protegidos
Semana 8  ·  GATE R1.0: um dia completo (pedido→entrega) sem WhatsApp ou papel
Semana 16 ·  GATE R1.1: nenhum departamento usa planilha como ferramenta principal
Semana 20 ·  GATE R1.2: gestão recebe relatório diário automático; dashboard unificado
Semana 24 ·  GATE R2.0: 70% das consultas de clientes resolvidas sem intervenção da equipe
```

---

## RESUMO EXECUTIVO

| Métrica | Valor |
|---|---|
| Total de features | 31 |
| Total de sprints | 12 |
| Duração total | 24 semanas (6 meses) |
| Releases | 4 (1.0 · 1.1 · 1.2 · 2.0) |
| Features P0 | 11 — entregues nas primeiras 8 semanas |
| Papel eliminado | Semana 8 |
| WhatsApp eliminado | Semana 16 |
| Excel eliminado | Semana 20 |
| Portal Cliente ativo | Semana 22 |
| Clara IA acionável | Semana 24 |

## Regras de Ouro deste Plano

1. **Sprint 1 é inegociável** — nenhuma feature funcional antes da segurança
2. **Nenhum sprint pula dependência** — a ordem é sequencial por design técnico, não burocracia
3. **SMTP configurado antes do Sprint 4** — ou FT-04.01, FT-05.02 e FT-13.03 não entram
4. **FT-13.02 só em Sprint 12** — Clara acionável requer dados reais acumulados
5. **Módulos congelados não são tocados** — NF-e · PIX · CNAB · SaaS · Marketplace · White-label

---

*Documento gerado em Julho de 2026.*
*CTO · Tech Lead · Product Owner — Portal VivaFrutaz.*
*Baseado exclusivamente no MASTER_BACKLOG_PORTAL_VIVAFRUTAZ.md e PLANO_DIRETOR_PORTAL_VIVAFRUTAZ_V1.md.*
*Nenhuma funcionalidade nova foi criada. Todas as features têm rastreabilidade ao backlog existente.*
