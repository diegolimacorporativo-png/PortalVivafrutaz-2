# RC1_UX_REVIEW.md
> Revisão Completa de UX — Homologação Release 1  
> Data: 27 de julho de 2026  
> Metodologia: Auditoria estática de 100+ arquivos `.tsx` em `client/src/pages/` e `client/src/components/`  
> Escopo: UX, navegação, feedback, formulários, tabelas, layout, acessibilidade, responsividade  
> **Nenhum arquivo de produção foi alterado.**

---

## Legenda de Prioridade

| Símbolo | Significado |
|---|---|
| 🔴 | **Crítica** — bloqueia uso ou causa erro perceptível ao usuário |
| 🟠 | **Importante** — prejudica produtividade ou confiança no sistema |
| 🟡 | **Melhoria** — experiência notavelmente melhor com a correção |
| 🟢 | **Opcional** — polimento, nice-to-have |

---

## Sumário Executivo

| Categoria | 🔴 | 🟠 | 🟡 | 🟢 | Total |
|---|---|---|---|---|---|
| Navegação & Breadcrumbs | 1 | 3 | 4 | 2 | **10** |
| Formulários | 2 | 5 | 6 | 2 | **15** |
| Tabelas & Listas | 1 | 4 | 5 | 3 | **13** |
| Feedback & Estados | 3 | 6 | 4 | 1 | **14** |
| Layout & Visual | 0 | 5 | 7 | 4 | **16** |
| Acessibilidade | 1 | 4 | 3 | 2 | **10** |
| Responsividade | 1 | 3 | 3 | 1 | **8** |
| **Total** | **9** | **30** | **32** | **15** | **86** |

---

## 1. NAVEGAÇÃO & BREADCRUMBS

### UX-NAV-01 🔴
**`track.tsx` e `driver-map.tsx` — sem botão Voltar acessível**
- **Arquivo:** `client/src/pages/track.tsx`, `client/src/pages/driver-map.tsx`
- **Problema:** Páginas públicas de rastreamento e mapa dependem exclusivamente do botão do navegador para sair. Usuários em tablets/kiosks sem barra de navegação ficam presos.
- **Correção recomendada:** Adicionar link/botão "← Voltar" fixo no canto superior esquerdo.
- **Impacto:** Usuário preso na página sem saída visível.

### UX-NAV-02 🟠
**`test-clara.tsx` — navegação via `window.location.href`**
- **Arquivo:** `client/src/pages/test-clara.tsx`
- **Problema:** Usa `window.location.href = '/'` hardcoded para voltar ao início, quebrando o histórico de navegação do React Router e impossibilitando o botão Voltar do navegador.
- **Correção recomendada:** Substituir por `useLocation` do wouter ou `navigate('/')`.
- **Impacto:** Histórico de navegação quebrado; botão Voltar do navegador não funciona após sair.

### UX-NAV-03 🟠
**Breadcrumbs inconsistentes — profundidade variável entre páginas**
- **Arquivos:** `admin/categories.tsx`, `admin/users.tsx`, `admin/settings.tsx` (apenas título da página) vs. `admin/fiscal-config.tsx`, `admin/nfe.tsx` (caminho completo: `Gestão Fiscal > Configurações Fiscais`)
- **Problema:** Usuário não sabe onde está dentro da hierarquia do sistema em páginas sem breadcrumb completo.
- **Correção recomendada:** Padronizar `<BackHeader breadcrumb={[{ label: 'Seção pai', href: '/...' }, { label: 'Página atual' }]} />` em todas as páginas de segundo nível.
- **Impacto:** Desorientação em sessões longas, especialmente em fluxos de admin.

### UX-NAV-04 🟠
**`ProductModal.tsx` — sem botão Cancelar explícito**
- **Arquivo:** `client/src/pages/admin/products/dialogs/ProductModal.tsx`
- **Problema:** Modal de criar/editar produto tem apenas botão "Salvar". Para cancelar, o usuário precisa clicar no `X` do modal ou fora dele — comportamento não-óbvio, especialmente em formulários longos.
- **Correção recomendada:** Adicionar botão "Cancelar" ao lado de "Salvar" no rodapé do modal.
- **Impacto:** Usuários tentam "Salvar" e depois desfazer, ou fecham sem querer ao clicar fora.

### UX-NAV-05 🟠
**`settings.tsx` — formulário de troca de senha sem opção de cancelar**
- **Arquivo:** `client/src/pages/admin/settings.tsx`
- **Problema:** Formulário de alteração de senha inline na página de configurações não tem botão "Cancelar" para limpar os campos e restaurar o estado anterior.
- **Correção recomendada:** Adicionar botão "Cancelar" que limpa os campos e fecha/recolhe o formulário.
- **Impacto:** Usuário que mudou de ideia precisa limpar campos manualmente.

### UX-NAV-06 🟡
**Páginas de detalhe de entrega sem link direto para o pedido associado**
- **Arquivo:** `client/src/pages/client/order-history.tsx`, views de detalhe de entrega
- **Problema:** Na visualização de uma entrega, não há link rápido para o pedido de origem. Usuário navega de volta, filtra, localiza o pedido — múltiplos cliques desnecessários.
- **Correção recomendada:** Adicionar `<Link href="/admin/orders?id=X">Ver Pedido</Link>` no detalhe da entrega.
- **Impacto:** 3–5 cliques extras em fluxo frequente.

### UX-NAV-07 🟡
**Dashboard admin — sem estado de "página ativa" destacado no menu lateral**
- **Arquivo:** `client/src/components/Layout.tsx`
- **Problema:** O item de menu correspondente à página atual não tem diferenciação visual clara (fundo ativo, borda, peso de fonte) em todas as resoluções.
- **Correção recomendada:** Garantir classe `bg-primary/10 font-semibold` ou equivalente no item ativo do sidebar.
- **Impacto:** Usuário não sabe visualmente em qual seção está.

### UX-NAV-08 🟡
**Modais de criação rápida — formulário não reseta após salvar com sucesso**
- **Arquivos:** `admin/categories.tsx`, `admin/tasks.tsx`, `admin/logistics.tsx` (formulários inline)
- **Problema:** Após salvar um item, o formulário permanece preenchido com os dados anteriores. Para criar um segundo item, o usuário precisa apagar tudo manualmente.
- **Correção recomendada:** Chamar `resetForm()` / `setForm(initialState)` no `onSuccess` da mutation.
- **Impacto:** Erro frequente: usuário salva duplicata sem perceber.

### UX-NAV-09 🟡
**`not-found.tsx` (404) — mensagem genérica sem sugestão de destino**
- **Arquivo:** `client/src/pages/not-found.tsx`
- **Problema:** Página 404 tem apenas "Voltar ao Início". Não sugere rotas alternativas (Dashboard, Pedidos, Empresas) baseadas no contexto do usuário (admin vs. cliente).
- **Correção recomendada:** Detectar `user.role` e exibir 2–3 links contextuais.
- **Impacto:** Menor, mas melhora percepção de qualidade do produto.

### UX-NAV-10 🟢
**Falta de atalho de teclado global para busca rápida (`Cmd+K` / `Ctrl+K`)**
- **Problema:** Sistema não tem paleta de comandos ou busca global por atalho de teclado. Usuários power-users precisam navegar pelo mouse.
- **Correção recomendada:** Implementar `<CommandPalette>` com `Cmd+K` para navegação por teclado.
- **Impacto:** Feature desejável para usuários avançados. Não crítica para RC1.

### UX-NAV-11 🟢
**Ausência de "Breadcrumb home" clicável na primeira posição**
- **Problema:** Alguns breadcrumbs começam diretamente com o nome da seção sem um ícone/link "Home" ou "Dashboard" na primeira posição.
- **Correção recomendada:** Adicionar ícone `Home` clicável como primeiro item em todos os breadcrumbs.

---

## 2. FORMULÁRIOS

### UX-FORM-01 🔴
**Formulários de CRUD em `logistics.tsx` — sem feedback de erro inline, apenas toast**
- **Arquivo:** `client/src/pages/admin/logistics.tsx` (formulários de motoristas, veículos, rotas)
- **Problema:** Erros de validação (campo obrigatório, formato inválido) aparecem apenas como toast no canto da tela, que desaparece após 3 segundos. O campo com erro não é destacado. Usuário não sabe qual campo corrigir.
- **Correção recomendada:** Adicionar estado de erro por campo (`errors.fieldName`) com mensagem vermelha abaixo do input e borda `border-destructive` no campo inválido.
- **Impacto:** Usuário submete formulário inválido repetidamente sem identificar o problema.

### UX-FORM-02 🔴
**Confirmação de exclusão ausente em múltiplos fluxos críticos**
- **Arquivos:**
  - `admin/tasks.tsx` — deletar tarefa (sem dialog de confirmação)
  - `admin/logistics.tsx` — deletar motorista/veículo (sem dialog)
  - `admin/quotations.tsx` — deletar cotação (sem dialog)
  - `admin/banco.tsx` — deletar transação financeira (sem dialog)
- **Problema:** Clique único em botão de lixeira executa a exclusão imediatamente, sem confirmação. Não há como desfazer.
- **Correção recomendada:** Envolver cada ação de delete em `<AlertDialog>` com texto específico: "Deletar motorista João Silva? Esta ação não pode ser desfeita."
- **Impacto:** Exclusão acidental de dados de produção sem possibilidade de recuperação.

### UX-FORM-03 🟠
**Botões de submit sem estado de loading/spinner**
- **Arquivos:**
  - `admin/categories.tsx` — botão "Salvar" sem spinner durante `isPending`
  - `admin/settings.tsx` — botão "Alterar Senha" sem indicação de processamento
  - `admin/faturamento.tsx` — botão "Faturar" sem loader durante operação (pode demorar)
- **Problema:** Usuário clica no botão e não recebe feedback visual. Pode clicar múltiplas vezes, criando requisições duplicadas.
- **Correção recomendada:** `<Button disabled={isPending}>{isPending ? <Loader2 className="animate-spin" /> : null} Salvar</Button>`
- **Impacto:** Duplo-envio de formulários; sensação de sistema travado.

### UX-FORM-04 🟠
**`faturamento.tsx` — sem confirmação antes de faturar pedidos em lote**
- **Arquivo:** `client/src/pages/admin/faturamento.tsx`
- **Problema:** Ação "Faturar Selecionados" executa imediatamente em N pedidos sem pedir confirmação com o total selecionado.
- **Correção recomendada:** Dialog: "Faturar 12 pedidos selecionados? Esta ação enviará notificações para os clientes."
- **Impacto:** Faturamento acidental em lote de pedidos incorretos.

### UX-FORM-05 🟠
**Formulários sem indicação de campos obrigatórios**
- **Arquivos:** `admin/companies.tsx` (formulário de cadastro de empresa), `admin/products` (ProductModal), `admin/logistics.tsx` (form de motorista)
- **Problema:** Nenhum campo tem asterisco `*` ou texto "(obrigatório)". Usuário só descobre o campo obrigatório após tentar submeter.
- **Correção recomendada:** Adicionar `<span className="text-destructive ml-0.5">*</span>` após o label de campos required; ou texto `(obrigatório)` em `text-muted-foreground text-xs`.
- **Impacto:** Frustração em formulários com muitos campos, como cadastro de empresa.

### UX-FORM-06 🟠
**`inventory.tsx` — formulário de entrada de estoque muito denso**
- **Arquivo:** `client/src/pages/admin/inventory.tsx` (~L700)
- **Problema:** Modal `max-w-2xl` com 10+ campos verticais sem agrupamento visual ou separadores de seção. Campos de datas, quantidades e fornecedor aparecem como lista plana sem hierarquia.
- **Correção recomendada:** Dividir em seções com `<Separator />` e labels de grupo: "Produto", "Quantidades", "Fornecedor", "Datas".
- **Impacto:** Alta carga cognitiva; erros de preenchimento em campos errados.

### UX-FORM-07 🟠
**`purchase-planning.tsx` — input de data usa classes custom em vez do componente padrão**
- **Arquivo:** `client/src/pages/admin/purchase-planning.tsx` (~L510)
- **Problema:** `<input type="date" className="px-3 py-1.5 rounded-xl border-2 ...">` em vez de `<Input>`. Aparência inconsistente e não herda temas/dark mode.
- **Correção recomendada:** Substituir por `<Input type="date" />` do sistema de design.
- **Impacto:** Visual inconsistente; não funciona com dark mode futuro.

### UX-FORM-08 🟡
**`auth/login.tsx` — "Esqueci minha senha" sem spinner no botão de envio**
- **Arquivo:** `client/src/pages/auth/login.tsx`
- **Problema:** Botão de submit do formulário de recuperação de senha muda texto para "Enviando..." mas não tem spinner nem fica desabilitado, permitindo múltiplos cliques.
- **Correção recomendada:** `disabled={isPending}` + `<Loader2 className="animate-spin" />` no botão.

### UX-FORM-09 🟡
**Formulários inline de `logistics.tsx` não colapsam após salvar**
- **Arquivo:** `client/src/pages/admin/logistics.tsx`
- **Problema:** Formulários de criação (motorista, veículo) permanecem expandidos após salvar com sucesso. O usuário precisa clicar em "Cancelar" manualmente para fechar.
- **Correção recomendada:** Chamar `setShowForm(false)` e `resetForm()` no `onSuccess` de cada mutation.

### UX-FORM-10 🟡
**`companies.tsx` — formulário de cadastro sem máscara de CNPJ/telefone**
- **Arquivo:** `client/src/pages/admin/companies.tsx`
- **Problema:** Campos de CNPJ e telefone aceitam qualquer string sem formatação automática. Usuário digita `12345678000195` sem pontuação, criando dados inconsistentes no banco.
- **Correção recomendada:** Aplicar máscara `XX.XXX.XXX/XXXX-XX` para CNPJ e `(XX) XXXXX-XXXX` para telefone.

### UX-FORM-11 🟡
**`saas-dashboard.tsx` — formulário de novo contrato sem preview de valor total**
- **Arquivo:** `client/src/pages/admin/saas-dashboard.tsx`
- **Problema:** Ao preencher módulos e planos, não há cálculo em tempo real do valor total do contrato. Usuário só vê o total após salvar.
- **Correção recomendada:** Calcular e exibir subtotal/total conforme módulos são selecionados no formulário.

### UX-FORM-12 🟡
**`orders.tsx` — busca não busca por número de pedido diretamente**
- **Arquivo:** `client/src/pages/admin/orders.tsx`
- **Problema:** Campo de busca filtra por nome da empresa, mas não por número de pedido ou ID, forçando o usuário a lembrar o nome do cliente para localizar um pedido específico.
- **Correção recomendada:** Incluir `String(o.id)` e número do pedido no filtro de busca textual.

### UX-FORM-13 🟡
**`nfe.tsx` — emissão de NF-e sem resumo antes de confirmar**
- **Arquivo:** `client/src/pages/admin/nfe.tsx`
- **Problema:** Ao clicar em "Emitir NF-e", a emissão começa diretamente. Não há tela de revisão com destinatário, valor, CFOP e data antes de transmitir para a SEFAZ.
- **Correção recomendada:** Adicionar etapa de revisão com `AlertDialog` mostrando o resumo antes da transmissão.

### UX-FORM-14 🟢
**Placeholders ausentes em múltiplos campos de texto livre**
- **Arquivos:** Campos de observação em `logistics.tsx`, `companies.tsx`, `orders.tsx`
- **Problema:** Inputs de texto livre sem `placeholder` — usuário não sabe o formato esperado.
- **Correção recomendada:** `placeholder="Ex: Entregar apenas de manhã"` ou similar contextual.

### UX-FORM-15 🟢
**Falta de contador de caracteres em campos com limite**
- **Arquivos:** Campos `description` em `tasks.tsx`, `client-incidents.tsx`
- **Problema:** Campos com limite de caracteres no banco não exibem contador visual.
- **Correção recomendada:** `{value.length}/500` abaixo do textarea com cor `text-destructive` ao ultrapassar.

---

## 3. TABELAS & LISTAS

### UX-TABLE-01 🔴
**`banco.tsx` — lista de transações sem paginação (retorna todas)**
- **Arquivo:** `client/src/pages/admin/banco.tsx`
- **Problema:** `GET /api/bank/transactions` retorna todas as transações sem limit/offset. Com volume de 6+ meses de dados, a tabela pode ter centenas de linhas, travando a renderização.
- **Correção recomendada:** Implementar paginação no frontend com `page`/`pageSize` state enquanto backend não tem paginação; ou filtro obrigatório de período.
- **Impacto:** Freeze de UI em produção com dados reais.

### UX-TABLE-02 🟠
**`users.tsx` — tabela sem busca por nome ou e-mail**
- **Arquivo:** `client/src/pages/admin/users.tsx`
- **Problema:** Lista de usuários exibe todos em uma tabela sem campo de busca. Com 20+ usuários, localizar um específico requer scroll visual.
- **Correção recomendada:** Adicionar `<Input placeholder="Buscar por nome ou e-mail..." />` com filtro client-side.
- **Impacto:** Operação frequente (localizar usuário para editar permissão) demorada.

### UX-TABLE-03 🟠
**`tasks.tsx` — sem filtro por status ou responsável**
- **Arquivo:** `client/src/pages/admin/tasks.tsx`
- **Problema:** Lista de tarefas sem filtros. Com dezenas de tarefas, usuário não consegue ver apenas "Em andamento" ou tarefas do responsável X.
- **Correção recomendada:** Filtros por `status` (pendente/em andamento/concluído) e por `assignedTo`.

### UX-TABLE-04 🟠
**`client-incidents.tsx` — sem indicação de quantas ocorrências existem por status**
- **Arquivo:** `client/src/pages/admin/client-incidents.tsx`
- **Problema:** Aba de ocorrências não mostra badge com contagem por status (ex: "Abertas (3)"). Usuário precisa contar visualmente.
- **Correção recomendada:** Adicionar badge numérico nas tabs: `Abertas (3)`, `Respondidas (7)`.

### UX-TABLE-05 🟠
**`quotations.tsx` (logistics) — tabela sem ordenação por data/status**
- **Arquivo:** `client/src/pages/admin/logistics.tsx` (aba Cotações)
- **Problema:** Cotações listadas sem opção de ordenar por data de criação, status ou empresa. Cotação mais recente não está necessariamente no topo.
- **Correção recomendada:** Ordenação padrão por `createdAt DESC`; botões de sort nas colunas.

### UX-TABLE-06 🟡
**`orders.tsx` — estado vazio após filtro não informa que é o filtro a causa**
- **Arquivo:** `client/src/pages/admin/orders.tsx`
- **Problema:** Ao aplicar um filtro sem resultados, a tela exibe apenas "Nenhum pedido encontrado" sem mencionar os filtros ativos. Usuário fica confuso se não percebe os filtros aplicados.
- **Correção recomendada:** "Nenhum pedido encontrado com os filtros aplicados. [Limpar filtros]"

### UX-TABLE-07 🟡
**`products` — sem indicação de total de produtos cadastrados**
- **Arquivo:** `client/src/pages/admin/products/index.tsx`
- **Problema:** Lista de produtos sem contador total no header da tabela. Usuário não sabe quantos produtos existem no catálogo.
- **Correção recomendada:** `{products.length} produtos` ou `Mostrando X de Y` após paginação.

### UX-TABLE-08 🟡
**`logistics.tsx` — tabela de rotas sem indicador de rota ativa vs encerrada**
- **Arquivo:** `client/src/pages/admin/logistics.tsx` (aba Rotas)
- **Problema:** Rotas ativas e encerradas aparecem na mesma lista sem diferenciação visual clara. Status está em texto puro sem badge colorido.
- **Correção recomendada:** Badge colorido: `IN_PROGRESS` → verde, `COMPLETED` → azul, `CANCELLED` → vermelho.

### UX-TABLE-09 🟡
**`saas-dashboard.tsx` — lista de assinaturas sem paginação visível**
- **Arquivo:** `client/src/pages/admin/saas-dashboard.tsx`
- **Problema:** Tabela de assinaturas carrega todas de uma vez. Sem paginação ou indicador de total.
- **Correção recomendada:** Paginação com `pageSize=20` e indicador `1-20 de 47`.

### UX-TABLE-10 🟡
**Estados vazios genéricos — sem ação sugerida**
- **Arquivos:** `admin/tasks.tsx`, `admin/logistics.tsx`, `admin/quotations.tsx`
- **Problema:** Quando não há dados, exibe apenas "Nenhum item encontrado." sem botão de ação imediata.
- **Correção recomendada:** `<EmptyState icon={...} title="Nenhuma tarefa" description="Crie sua primeira tarefa" action={<Button>Nova Tarefa</Button>} />`

### UX-TABLE-11 🟢
**Falta de skeleton loading em tabelas — flash de "vazio" antes dos dados carregarem**
- **Arquivos:** `admin/companies.tsx`, `admin/products`, vários
- **Problema:** Durante o carregamento, a tabela exibe estado vazio por ~300ms antes dos dados chegarem, causando um flash visual.
- **Correção recomendada:** Skeleton rows durante `isLoading`: `<Skeleton className="h-10 w-full" />` repetido.

### UX-TABLE-12 🟢
**`banco.tsx` — sem resumo de saldo no topo da lista de transações**
- **Arquivo:** `client/src/pages/admin/banco.tsx`
- **Problema:** Usuário precisa somar visualmente as transações para entender o saldo do período filtrado.
- **Correção recomendada:** Card de resumo: "Entradas: R$ X | Saídas: R$ Y | Saldo: R$ Z" calculado dos dados filtrados.

### UX-TABLE-13 🟢
**Tabelas sem destaque de linha ao hover**
- **Arquivos:** Várias tabelas em `admin/`
- **Problema:** Algumas tabelas não têm `hover:bg-muted/50` nas linhas, dificultando acompanhar a linha visualmente.
- **Correção recomendada:** `<TableRow className="hover:bg-muted/50 cursor-pointer">` de forma consistente.

---

## 4. FEEDBACK & ESTADOS

### UX-FB-01 🔴
**`nfe.tsx` — erros da SEFAZ exibidos como string técnica ao usuário**
- **Arquivo:** `client/src/pages/admin/nfe.tsx`
- **Problema:** Erros retornados pela SEFAZ (ex: `"cStat: 561 - Rejeição: Código da UF do Emitente diverge..."`) são exibidos diretamente em toast ou na tela sem tradução. Usuário não fiscal não entende o que fazer.
- **Correção recomendada:** Mapear os códigos de rejeição mais comuns para mensagens em português com orientação de correção. Exibir código técnico em `<details>` colapsável.
- **Impacto:** Bloqueio operacional — usuário não consegue resolver o erro sem ajuda técnica.

### UX-FB-02 🔴
**`faturamento.tsx` — sem estado de erro visível quando carregamento falha**
- **Arquivo:** `client/src/pages/admin/faturamento.tsx`
- **Problema:** Quando `GET /api/faturamento/eligible` falha (rede, servidor), a tela exibe estado vazio idêntico ao "sem pedidos para faturar". Usuário não distingue erro de ausência de dados.
- **Correção recomendada:** Verificar `isError` da query e exibir `<Alert variant="destructive">Erro ao carregar pedidos. [Tentar novamente]</Alert>`.
- **Impacto:** Pedidos deixados de faturar porque o usuário acredita que não há nada pendente.

### UX-FB-03 🔴
**`orders.tsx` — exportação PDF/Excel sem feedback de progresso**
- **Arquivo:** `client/src/pages/admin/orders.tsx`
- **Problema:** Botões "Exportar PDF" e "Exportar Excel" processam no main thread sem nenhum indicador de progresso. Com muitos pedidos, a UI congela por vários segundos sem aviso.
- **Correção recomendada:** Exibir toast "Gerando arquivo..." com `<Loader2>` durante o processamento; desabilitar botão até concluir.
- **Impacto:** Usuário clica múltiplas vezes achando que travou; gera múltiplos downloads.

### UX-FB-04 🟠
**Mensagens de sucesso genéricas — sem contexto do que foi salvo**
- **Arquivos:** Múltiplos (padrão predominante em `admin/`)
- **Problema:** Toast "Salvo com sucesso" aparece em todos os contextos sem especificar o que foi salvo (qual empresa, qual produto, qual pedido).
- **Exemplos ruins:** "Salvo com sucesso", "Atualizado", "Operação concluída"
- **Exemplos bons:** "Empresa Supermercado Novo salva", "Produto Maçã Gala atualizado", "Pedido #1247 criado com sucesso"
- **Correção recomendada:** Incluir nome/ID da entidade na mensagem de sucesso de cada mutation.
- **Impacto:** Usuário não tem certeza se a ação correta foi executada.

### UX-FB-05 🟠
**`logistics-intelligence.tsx` — sem indicador de "última atualização"**
- **Arquivo:** `client/src/pages/admin/logistics-intelligence.tsx`
- **Problema:** Painel de inteligência logística se auto-atualiza a cada 5 minutos mas não exibe quando os dados foram carregados pela última vez. Usuário não sabe se está vendo dados atuais ou obsoletos.
- **Correção recomendada:** Exibir `Atualizado às HH:MM` e botão de refresh manual.

### UX-FB-06 🟠
**`saas-dashboard.tsx` — erro de carregamento de aba exibe página em branco**
- **Arquivo:** `client/src/pages/admin/saas-dashboard.tsx`
- **Problema:** Se qualquer das 7 queries de uma aba falhar, a aba renderiza vazia sem mensagem de erro. Usuário vê tela em branco e não sabe o motivo.
- **Correção recomendada:** Verificar `isError` por query e exibir `<Alert>` no lugar do conteúdo falho.

### UX-FB-07 🟠
**`companies.tsx` — exclusão de empresa sem aviso sobre dados dependentes**
- **Arquivo:** `client/src/pages/admin/companies.tsx`
- **Problema:** Dialog de confirmação de exclusão não informa que pedidos, entregas e histórico associados à empresa também serão afetados (ou impedirão a exclusão).
- **Correção recomendada:** "Deletar Supermercado Novo? Esta empresa possui 23 pedidos ativos. A exclusão pode ser impedida enquanto houver dados associados."

### UX-FB-08 🟠
**`fiscal.tsx` — operações de fechamento fiscal sem loader de longa duração**
- **Arquivo:** `client/src/pages/admin/fiscal.tsx`
- **Problema:** Fechamento de período fiscal pode demorar vários segundos. Não há progress bar ou mensagem de "processando" durante a operação.
- **Correção recomendada:** Modal de progresso: "Processando fechamento... Isso pode levar alguns segundos."

### UX-FB-09 🟠
**`nfe.tsx` — sem confirmação ao cancelar NF-e já emitida**
- **Arquivo:** `client/src/pages/admin/nfe.tsx`
- **Problema:** Ação de cancelamento de NF-e é disparada sem dialog de confirmação detalhado. Cancelar uma NF-e é irreversível e tem implicações fiscais.
- **Correção recomendada:** `<AlertDialog>` com: "Cancelar NF-e 35240701234567... ? Esta ação é irreversível e será transmitida para a SEFAZ. Informe o motivo (mínimo 15 caracteres)." com campo de motivo obrigatório.

### UX-FB-10 🟡
**Loading skeletons ausentes no dashboard admin durante carregamento inicial**
- **Arquivo:** `client/src/pages/admin/dashboard.tsx`
- **Problema:** Cards de KPI exibem `0` ou ficam vazios enquanto os dados carregam, causando visual "quebrado" por ~500ms.
- **Correção recomendada:** `<Skeleton className="h-8 w-24" />` nos lugares dos valores numéricos durante `isLoading`.

### UX-FB-11 🟡
**`client/create-order.tsx` — estado de sucesso após pedido não oferece próximos passos**
- **Arquivo:** `client/src/pages/client/create-order.tsx`
- **Problema:** Tela "Pedido Realizado!" exibe mensagem de sucesso mas não oferece ações contextuais imediatas: "Ver Histórico de Pedidos", "Fazer Novo Pedido", "Entrar em Contato".
- **Correção recomendada:** Adicionar botões de ação no estado de sucesso.

### UX-FB-12 🟡
**Toasts de erro sem botão "Tentar novamente"**
- **Arquivos:** Múltiplos — padrão geral
- **Problema:** Toasts de erro em mutations (`onError`) exibem a mensagem mas não oferecem ação de retry. Usuário precisa relembrar o que fez e repetir manualmente.
- **Correção recomendada:** Para operações idempotentes, adicionar `action: <ToastAction onClick={() => mutate(lastPayload)}>Tentar novamente</ToastAction>`.

### UX-FB-13 🟡
**`driver-panel.tsx` — sem feedback visual de confirmação após atualizar status de entrega**
- **Arquivo:** `client/src/pages/admin/driver-panel.tsx`
- **Problema:** Motorista atualiza status de uma entrega e não há confirmação clara de que foi salvo. Apenas o botão muda de aparência.
- **Correção recomendada:** Toast "Status atualizado: Entregue às 14:32" + animação de check no item.

### UX-FB-14 🟢
**Toasts de sucesso muito rápidos (3s) em operações críticas**
- **Arquivos:** `faturamento.tsx`, `nfe.tsx`, `fiscal.tsx`
- **Problema:** Operações financeiras e fiscais exibem toast que desaparece em 3 segundos, rápido demais para o usuário processar e confirmar que viu.
- **Correção recomendada:** Aumentar `duration` para 5000ms em toasts de operações críticas.

---

## 5. LAYOUT & CONSISTÊNCIA VISUAL

### UX-LAYOUT-01 🟠
**`driver-panel.tsx` — margin negativa `-mt-8` causa overflow em viewports pequenas**
- **Arquivo:** `client/src/pages/admin/driver-panel.tsx` (~L45)
- **Problema:** Uso de `-mt-8` hardcoded para sobrepor o header. Em viewports com header diferente (mobile, tablets), o conteúdo fica sobreposto ou cortado.
- **Correção recomendada:** Substituir por layout flexbox/grid que empurra o conteúdo abaixo do header de forma dinâmica.

### UX-LAYOUT-02 🟠
**Botões de ação inconsistentes — `variant` errado para mesma semântica**
- **Arquivos:**
  - `admin/purchase-planning.tsx` L743: "Atualizar" usa `variant="outline"` (deveria ser `"default"`)
  - `admin/logistics.tsx`: "Editar" usa tamanhos mistos (`size="sm"` em motoristas, padrão em rotas)
  - `admin/saas-dashboard.tsx`: "Salvar" e "Confirmar" com variantes invertidas em alguns modais
- **Problema:** Usuário não consegue identificar rapidamente qual botão é a ação primária.
- **Correção recomendada:** Padronizar: ação primária = `variant="default"`, ação secundária = `variant="outline"`, ação destrutiva = `variant="destructive"`.

### UX-LAYOUT-03 🟠
**Tamanhos de modal inconsistentes entre domínios**
- **Arquivos:**
  - `purchase-planning.tsx`: `max-w-sm`
  - `logistics.tsx`: `max-w-lg` para editar motorista, sem classe para editar rota
  - `sanitary.tsx`: `max-w-4xl` para avaliação
- **Problema:** Modais de complexidade similar têm tamanhos drasticamente diferentes. Cria sensação visual de inconsistência.
- **Correção recomendada:** Definir escala: simples = `max-w-md`, médio = `max-w-lg`, complexo = `max-w-2xl`, full = `max-w-4xl`. Aplicar conforme número de campos.

### UX-LAYOUT-04 🟠
**Inputs de tamanho inconsistente no mesmo contexto**
- **Arquivos:**
  - `inventory.tsx` L539: `h-8 w-36 text-sm` para datas
  - `purchase-planning.tsx` L510: classes custom `px-3 py-1.5 rounded-xl border-2`
  - `ProductModal.tsx`: `h-10` padrão
- **Problema:** Três tamanhos de input diferentes em páginas administrativas. Desalinhamento visual.
- **Correção recomendada:** Usar exclusivamente `<Input>` do shadcn/ui. Remover classes de tamanho customizadas.

### UX-LAYOUT-05 🟠
**`banco.tsx` — texto em `text-gray-400` para dados financeiros críticos**
- **Arquivo:** `client/src/pages/admin/banco.tsx` (~L145)
- **Problema:** Datas de transação e números de documento em `text-gray-400` (#9CA3AF) sobre fundo branco — contrast ratio ≈ 2.9:1, abaixo do mínimo WCAG AA (4.5:1 para texto normal).
- **Correção recomendada:** Trocar para `text-muted-foreground` (que usa a variável CSS do tema, ≥ 4.5:1) ou `text-gray-600`.

### UX-LAYOUT-06 🟡
**Hierarquia de headings quebrada em múltiplas páginas**
- **Arquivos:**
  - `Layout.tsx`: `<h1>` para logo/brand
  - `driver-map.tsx`: segundo `<h1>` para título da rota na mesma página
  - `client/create-order.tsx`: dois `<h1>` em estados diferentes do mesmo componente
  - `FiscalInvoiceOCR.tsx`: `<h3>` como título principal, pulando `<h1>` e `<h2>`
- **Problema:** Múltiplos `<h1>` por página e saltos de nível (`h3` sem `h2`) prejudicam screen readers e SEO.
- **Correção recomendada:** Um único `<h1>` por página (título da seção atual). Subtítulos em `<h2>`. Labels de card em `<h3>`.

### UX-LAYOUT-07 🟡
**`track.tsx` — padding excessivo em mobile (`p-12`, `p-10`)**
- **Arquivo:** `client/src/pages/track.tsx`
- **Problema:** Cards centrais usam `p-12` e `p-10`. Em telas de 375px, isso deixa apenas ~150px de largura útil para o conteúdo.
- **Correção recomendada:** `p-4 sm:p-8 md:p-12`.

### UX-LAYOUT-08 🟡
**`contracts.tsx` — stats cards com overflow em tablet portrait**
- **Arquivo:** `client/src/pages/admin/contracts.tsx` (~L30)
- **Problema:** `grid-cols-2 sm:grid-cols-3` para 6 cards de métricas. Em 768px portrait (iPad), os 3 cards por linha ficam comprimidos com texto truncado.
- **Correção recomendada:** `grid-cols-2 md:grid-cols-3 lg:grid-cols-6` com cards menores.

### UX-LAYOUT-09 🟡
**`driver-panel.tsx` — 6 botões de status em `grid-cols-2` causam overflow em iPhone SE**
- **Arquivo:** `client/src/pages/admin/driver-panel.tsx` (~L23)
- **Problema:** iPhone SE (375px) com `grid-cols-2` e textos longos como "Problema na Entrega" transbordam para fora do botão.
- **Correção recomendada:** `grid-cols-1 sm:grid-cols-2` ou truncar texto dos botões com tooltip.

### UX-LAYOUT-10 🟡
**Ausência de separador visual entre seções de formulários complexos**
- **Arquivos:** `admin/companies.tsx` (formulário de empresa), `admin/inventory.tsx` (formulário de entrada de estoque)
- **Problema:** Formulários com 8+ campos não têm `<Separator />` ou `<fieldset>` para agrupar campos relacionados visualmente.
- **Correção recomendada:** Usar `<Separator />` com título de grupo entre seções: "Informações Básicas / Contato / Endereço".

### UX-LAYOUT-11 🟡
**`ai-developer.tsx` — nomes de arquivo em `text-gray-300` em tema claro**
- **Arquivo:** `client/src/pages/admin/ai-developer.tsx` (~L50)
- **Problema:** `text-gray-300` (#D1D5DB) sobre fundo branco — contrast ratio ≈ 1.3:1, completamente ilegível. Visível apenas em dark mode.
- **Correção recomendada:** Trocar para `text-muted-foreground` ou `text-gray-600`.

### UX-LAYOUT-12 🟢
**`FiscalInvoiceOCR.tsx` — hierarquia `h3 → h4` sem `h2` intermediário**
- **Arquivo:** `client/src/components/FiscalInvoiceOCR.tsx`
- **Problema:** Componente usa `<h3>` como título principal do painel sem `<h2>` pai, criando hierarquia de heading semanticamente incorreta.
- **Correção recomendada:** Alterar títulos de seção para `<h2>` e subtítulos para `<h3>`.

### UX-LAYOUT-13 🟢
**Inconsistência no arredondamento de cards — mix de `rounded-lg` e `rounded-xl`**
- **Arquivos:** Distribuído em `admin/`
- **Problema:** Alguns cards usam `rounded-lg`, outros `rounded-xl`, outros `rounded-2xl` sem critério aparente.
- **Correção recomendada:** Padronizar: cards = `rounded-xl`, inputs = `rounded-md` (shadcn padrão), badges = `rounded-full`.

### UX-LAYOUT-14 🟢
**Ausência de `focus-visible` ring em elementos interativos customizados**
- **Arquivos:** `client-incidents.tsx` (cards clicáveis), `NfeDiagnosticsPanel.tsx` (tabs e expanders)
- **Problema:** Elementos clicáveis sem anel de foco visível ao navegar por teclado (Tab).
- **Correção recomendada:** Adicionar `focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring` em elementos interativos que não são `<Button>`.

### UX-LAYOUT-15 🟢
**Cores de status sem alternativa para usuários daltônicos**
- **Arquivos:** Badges de status em `orders.tsx`, `logistics.tsx`, `companies.tsx`
- **Problema:** Diferenciação de status baseada apenas em cor (verde = ok, vermelho = erro). Sem ícone ou texto auxiliar, daltônicos não distinguem.
- **Correção recomendada:** Acompanhar cor com ícone (`CheckCircle`, `XCircle`, `Clock`) em todos os badges de status.

### UX-LAYOUT-16 🟢
**Falta de `title` em ícones SVG usados como informação**
- **Arquivos:** Ícones de status em tabelas sem texto alternativo
- **Problema:** Ícones que comunicam estado (✓, ✗, ⚠) não têm `title` ou `aria-label` para screen readers.
- **Correção recomendada:** `<CheckCircle aria-label="Ativo" />` ou wrapper com `title`.

---

## 6. ACESSIBILIDADE

### UX-A11Y-01 🔴
**`Layout.tsx` — itens de menu sidebar sem suporte a teclado**
- **Arquivo:** `client/src/components/Layout.tsx` (~L125, L134, L150)
- **Problema:** Overlay do sidebar e itens de menu são `<div>` e `<li>` com `onClick` mas sem `role="button"`, `tabIndex={0}` ou `onKeyDown`. Usuários de teclado (Tab + Enter) não conseguem navegar pelo menu.
- **Correção recomendada:** Converter itens de menu para `<button>` ou adicionar `role="button" tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && handler()}`.
- **Impacto:** Inacessível para usuários com mobilidade reduzida que usam teclado.

### UX-A11Y-02 🟠
**`tasks.tsx` — botões de editar/deletar sem `aria-label`**
- **Arquivo:** `client/src/pages/admin/tasks.tsx` (~L150)
- **Problema:** Botões com apenas ícone (`<Pencil />`, `<Trash2 />`) sem `aria-label`. Screen reader anuncia apenas "botão" sem indicar a ação.
- **Correção recomendada:** `<Button aria-label="Editar tarefa Instalar sistema">`. Incluir nome do item no aria-label.

### UX-A11Y-03 🟠
**`logistics.tsx` — botões de ação em tabelas sem `aria-label`**
- **Arquivo:** `client/src/pages/admin/logistics.tsx` (~L160, L165)
- **Problema:** Botões de editar/excluir motorista e veículo sem label acessível.
- **Correção recomendada:** `aria-label="Editar motorista {driver.name}"` / `aria-label="Excluir veículo {vehicle.plate}"`.

### UX-A11Y-04 🟠
**`NfeDiagnosticsPanel.tsx` — tabs e expanders em `<div>` sem role**
- **Arquivo:** `client/src/components/NfeDiagnosticsPanel.tsx` (~L85, L120)
- **Problema:** Elementos de UI interativos (tabs, accordion) implementados com `<div onClick>` sem `role="tab"`, `role="tabpanel"`, `aria-expanded`, `aria-controls`.
- **Correção recomendada:** Usar componentes `<Tabs>` e `<Accordion>` do shadcn/ui que já implementam ARIA corretamente.

### UX-A11Y-05 🟠
**`client-incidents.tsx` — cards clicáveis sem `role` e sem suporte a teclado**
- **Arquivo:** `client/src/pages/admin/client-incidents.tsx` (~L347)
- **Problema:** `<Card onClick={navigate}>` sem `role="button"` nem `tabIndex`. Usuário de teclado não consegue selecionar uma ocorrência.
- **Correção recomendada:** Adicionar `role="button" tabIndex={0} onKeyDown={handleKeyDown}` ou envolver em `<button>`.

### UX-A11Y-06 🟡
**Formulários sem `<label>` explícito ou `htmlFor` em vários locais**
- **Arquivos:** Formulários inline em `logistics.tsx`, `purchase-planning.tsx`
- **Problema:** Alguns inputs têm apenas `placeholder` como label. Screen readers não associam o label ao campo.
- **Correção recomendada:** Todo `<Input>` deve ter `<Label htmlFor="fieldId">` correspondente.

### UX-A11Y-07 🟡
**Ausência de `lang="pt-BR"` no `<html>` tag**
- **Arquivo:** `client/index.html`
- **Problema:** `<html>` sem atributo `lang`. Screen readers usam idioma padrão (inglês) para pronúncia, afetando usuários com leitores de tela em português.
- **Correção recomendada:** `<html lang="pt-BR">` em `client/index.html`.

### UX-A11Y-08 🟡
**Modais sem foco automático no primeiro campo ao abrir**
- **Arquivos:** Modais em `logistics.tsx`, `categories.tsx`, `tasks.tsx`
- **Problema:** Ao abrir um modal, o foco permanece no botão que o abriu, não no primeiro campo do formulário. Usuário de teclado precisa dar Tab várias vezes para chegar ao primeiro campo.
- **Correção recomendada:** `autoFocus` no primeiro `<Input>` do modal, ou usar `initialFocus` do `<Dialog>` do shadcn.

### UX-A11Y-09 🟢
**`driver-map.tsx` — texto em `text-gray-400` para ETA e distância**
- **Arquivo:** `client/src/pages/driver-map.tsx` (~L100)
- **Problema:** Metadados de ETA e distância (`text-gray-400`) sobre fundo branco — contrast ratio 2.9:1, abaixo do WCAG AA.
- **Correção recomendada:** Trocar para `text-gray-600` (contrast ≈ 5.9:1).

### UX-A11Y-10 🟢
**Ausência de skip-link "Pular para o conteúdo principal"**
- **Arquivo:** `client/src/components/Layout.tsx`
- **Problema:** Sem link de skip navigation, usuários de teclado precisam atravessar todos os 20+ itens do menu a cada troca de página.
- **Correção recomendada:** `<a href="#main-content" className="sr-only focus:not-sr-only">Pular para conteúdo principal</a>` no topo do layout.

---

## 7. RESPONSIVIDADE

### UX-RESP-01 🔴
**`driver-panel.tsx` — 6 botões de status em grid fixo quebram em iPhone SE (375px)**
- **Arquivo:** `client/src/pages/admin/driver-panel.tsx`
- **Problema:** `grid-cols-2` com textos longos ("Problema na Entrega") transborda o layout em 375px, cortando texto e sobrepondo elementos.
- **Correção recomendada:** `grid-cols-1 xs:grid-cols-2` com `text-sm` e truncamento.

### UX-RESP-02 🟠
**`saas-dashboard.tsx` — tabela de assinaturas sem scroll horizontal em mobile**
- **Arquivo:** `client/src/pages/admin/saas-dashboard.tsx`
- **Problema:** Tabela larga com 6+ colunas não tem `overflow-x-auto` no container. Em mobile, colunas ficam espremidas ilegíveis.
- **Correção recomendada:** Envolver em `<div className="overflow-x-auto">`.

### UX-RESP-03 🟠
**`logistics.tsx` — tabela de rotas sem adaptação para mobile**
- **Arquivo:** `client/src/pages/admin/logistics.tsx` (aba Rotas)
- **Problema:** Tabela com 7 colunas visível em mobile sem scroll horizontal. Motoristas de delivery que usam celular não conseguem ver todas as informações da rota.
- **Correção recomendada:** `overflow-x-auto` + ocultar colunas menos críticas em `hidden sm:table-cell`.

### UX-RESP-04 🟠
**`track.tsx` — padding excessivo deixa área útil mínima em mobile**
- **Arquivo:** `client/src/pages/track.tsx`
- **Problema:** Página de rastreamento pública (acessada por QR code em etiquetas) usa `p-12`/`p-10` em mobile, deixando área de conteúdo de ~150px em iPhone SE.
- **Correção recomendada:** `p-4 sm:p-8 lg:p-12`.

### UX-RESP-05 🟡
**`contracts.tsx` — 6 cards de KPI em layout fixo comprimem em tablet**
- **Arquivo:** `client/src/pages/admin/contracts.tsx`
- **Problema:** `sm:grid-cols-3` em 6 cards causa compressão em tablets portrait (768px).
- **Correção recomendada:** `grid-cols-2 md:grid-cols-3 xl:grid-cols-6`.

### UX-RESP-06 🟡
**`admin/dashboard.tsx` — sidebar não colapsa em tablet (1024px)**
- **Arquivo:** `client/src/pages/admin/dashboard.tsx`, `client/src/components/Layout.tsx`
- **Problema:** Em tablets landscape (1024px), o sidebar ocupa espaço significativo sem modo colapsado, deixando o conteúdo principal estreito.
- **Correção recomendada:** Breakpoint de colapso em `lg:` com ícones apenas (modo mini-sidebar).

### UX-RESP-07 🟡
**Modais em fullscreen em mobile sem comportamento de sheet/drawer**
- **Arquivos:** Modais em `admin/logistics.tsx`, `admin/companies.tsx`
- **Problema:** Modais `max-w-lg` em mobile (375px) aparecem com margens muito pequenas ou sem margens, ocupando quase 100% da tela sem ser um proper bottom-sheet.
- **Correção recomendada:** Em mobile, converter modais complexos para `<Sheet side="bottom">` do shadcn para experiência nativa mobile.

### UX-RESP-08 🟢
**`ai-developer.tsx` — editor de código sem scroll horizontal em mobile**
- **Arquivo:** `client/src/pages/admin/ai-developer.tsx`
- **Problema:** Área de output de código sem `overflow-x-auto`, causando transbordamento horizontal em mobile.
- **Correção recomendada:** `<pre className="overflow-x-auto text-sm">`.

---

## Ranking de Itens por Impacto Imediato

### 🔴 9 Críticos — Recomendam correção antes do go-live

| ID | Descrição | Arquivo principal |
|---|---|---|
| UX-FB-01 | Erros da SEFAZ em código técnico ao usuário | `nfe.tsx` |
| UX-FB-02 | Faturamento: erro de carregamento indistinguível de "sem dados" | `faturamento.tsx` |
| UX-FB-03 | Exportação sem feedback de progresso / multi-clique | `orders.tsx` |
| UX-FORM-01 | Erros de formulário sem highlight do campo inválido | `logistics.tsx` |
| UX-FORM-02 | Deleções sem confirmação (motorista, veículo, tarefa, transação) | múltiplos |
| UX-TABLE-01 | Lista de transações bancárias sem paginação | `banco.tsx` |
| UX-A11Y-01 | Menu sidebar inacessível por teclado | `Layout.tsx` |
| UX-NAV-01 | `track.tsx` sem botão Voltar em kiosks/tablets | `track.tsx` |
| UX-RESP-01 | Botões de status do motorista quebram em iPhone SE | `driver-panel.tsx` |

---

## Mapa de Arquivos com Mais Issues

| Arquivo | 🔴 | 🟠 | 🟡 | 🟢 | Total |
|---|---|---|---|---|---|
| `admin/logistics.tsx` | 1 | 4 | 3 | 1 | **9** |
| `admin/nfe.tsx` | 1 | 2 | 2 | 0 | **5** |
| `admin/banco.tsx` | 1 | 1 | 1 | 1 | **4** |
| `admin/faturamento.tsx` | 1 | 1 | 1 | 0 | **3** |
| `admin/saas-dashboard.tsx` | 0 | 2 | 1 | 0 | **3** |
| `components/Layout.tsx` | 1 | 1 | 1 | 0 | **3** |
| `admin/driver-panel.tsx` | 1 | 1 | 1 | 0 | **3** |
| `track.tsx` | 1 | 0 | 1 | 0 | **2** |
| `admin/categories.tsx` | 0 | 1 | 1 | 0 | **2** |
| `admin/orders.tsx` | 1 | 0 | 1 | 0 | **2** |

---

*Documento gerado para uso exclusivo de homologação. Nenhum arquivo de produção foi modificado.*
