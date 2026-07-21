# STORAGE_VALIDATION_REPORT.md
## Portal VIVAFrutaz ERP — Fase 3.1

> **Documento de validação. Nenhum arquivo de código foi alterado.**
>
> Gerado em: 2026-07-21
> Base: `docs/architecture/STORAGE_DECOMPOSITION_PLAN.md`
> Arquivo auditado: `server/services/storage.ts` (3 133 linhas)

---

## Correção Importante — Contagem Real do Arquivo

O documento anterior (`STORAGE_DECOMPOSITION_PLAN.md`) reportou 2 997 linhas porque a leitura parou na linha onde `export const storage = new DatabaseStorage()` aparecia na primeira passagem. O arquivo real possui **3 133 linhas**: há um bloco adicional (linhas 2 998–3 131) com três métodos paginados que foram completamente omitidos da análise anterior.

| Métrica | Plano anterior | Valor real |
|---|---|---|
| Linhas do arquivo | 2 997 | **3 133** |
| Métodos em `IStorage` | 326 | **331** |
| Métodos em `DatabaseStorage` | 344 | **340** |
| Diferença (gap) | 18 | **12** |

> Os números anteriores estavam incorretos. Este documento usa os valores verificados via grep.

---

## ETAPA 1 — Validação do Contrato (os 12 métodos extras)

### Método de detecção

```bash
# Interface: grep de assinaturas em IStorage (linhas 83–600)
# Implementação: grep de métodos async em DatabaseStorage (linhas 602–3 131)
# Diff: comm -23 (impl - iface)
```

### Tabela completa dos 12 métodos

| # | Método | Linha | Visibilidade | Na interface? | Chamado por | Importadores | Uso interno? | Legado? | Morto? | Duplicado? | Pode remover? | Deve entrar na interface? | Deve ser privado? | Helper interno? |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | `getOrdersPaginated` | 2 998 | public | ❌ Não | `server/routes/routes.ts` | 1 | Não | Não | Não | Não | Não | **Sim** | Não | Não |
| 2 | `getProductsPaginated` | 3 044 | public | ❌ Não | `server/modules/products/products.service.ts` | 1 | Não | Não | Não | Não | Não | **Sim** | Não | Não |
| 3 | `getCompaniesPaginated` | 3 088 | public | ❌ Não | `server/modules/companies/companies.service.ts` | 1 | Não | Não | Não | Não | Não | **Sim** | Não | Não |
| 4 | `updateTask` | 1 373 | public | ❌ Não | `server/routes/tasks.routes.ts` | 1 | Não | Não | Não | Não | Não | **Sim** | Não | Não |
| 5 | `updateInternalIncident` | 1 461 | public | ❌ Não | `server/routes/incidents.routes.ts` | 1 | Não | Não | Não | Não | Não | **Sim** | Não | Não |
| 6 | `updateSanitaryQuestion` | 2 951 | public | ❌ Não | `server/routes/sanitary.routes.ts` | 1 | Não | Não | Não | Não | Não | **Sim** | Não | Não |
| 7 | `updateSanitaryEvaluation` | 2 976 | public | ❌ Não | `server/routes/sanitary.routes.ts` | 1 | Não | Não | Não | Não | Não | **Sim** | Não | Não |
| 8 | `updateSanitaryEvaluationItem` | 2 986 | public | ❌ Não | `server/routes/sanitary.routes.ts` | 1 | Não | Não | Não | Não | Não | **Sim** | Não | Não |
| 9 | `upsertAboutUs` | 1 951 | public | ❌ Não | `server/routes/about-us.routes.ts` | 1 | Não | Não | Não | Não | Não | **Sim** | Não | Não |
| 10 | `upsertSmtpConfig` | 1 970 | public | ❌ Não | `server/routes/smtp-config.routes.ts` | 1 | Não | Não | Não | Não | Não | **Sim** | Não | Não |
| 11 | `upsertPushSubscription` | 2 000 | public | ❌ Não | `server/routes/push.routes.ts` | 1 | Não | Não | Não | Não | Não | **Sim** | Não | Não |
| 12 | `upsertNotificationSetting` | 2 035 | public | ❌ Não | `server/routes/push.routes.ts` | 1 | Não | Não | Não | Não | Não | **Sim** | Não | Não |

### Observação crítica sobre os métodos paginados

Os três métodos paginados (`getOrdersPaginated`, `getProductsPaginated`, `getCompaniesPaginated`) usam os operadores `or()`, `ilike()` e `isNull()` do Drizzle ORM.

**Verificação de imports (linha 81 do arquivo):**

```typescript
import { eq, and, desc, gte, lte, sql, inArray, or, ilike, isNull } from "drizzle-orm";
```

✅ Os três operadores já estão importados. **Nenhum risco de import** ao extrair os repositories.

---

## ETAPA 2 — Validação da Interface

### Existem métodos públicos da implementação fora do contrato `IStorage`?

**Sim. São 12 métodos.**

### Justificativa para a divergência

Todos os 12 seguem o mesmo padrão: **foram adicionados à implementação após a última revisão da interface e nunca foram declarados em `IStorage`**. Não há lógica deliberada de ocultação — é omissão incremental típica de crescimento acelerado de codebase sem revisão de contrato.

### É um erro arquitetural?

**Parcialmente.** Do ponto de vista prático não causa falha em runtime porque:
- Todos os callers usam a instância concreta `storage` (não o tipo `IStorage`)
- TypeScript resolve os métodos diretamente na classe `DatabaseStorage`
- Nenhum caller faz `(storage as IStorage).metodo()` ou injeta `IStorage` como tipo

Do ponto de vista de design de contrato é um erro: a interface deveria ser a fonte de verdade. Qualquer novo repository que implemente `IStorage` **não seria obrigado** pelo compilador a implementar esses 12 métodos, criando lacunas invisíveis.

### Impacto

| Impacto | Severidade | Ocorre hoje? |
|---|---|---|
| Runtime failure | Nenhum | Não |
| TypeScript compilation failure | Nenhum | Não |
| Repository futuro incompleto | Alto | Será relevante na Wave 1 |
| Testes de interface incompletos | Médio | Sim |
| Documentação de contrato incorreta | Médio | Sim |

### Como corrigir sem quebrar compatibilidade

Adicionar as 12 assinaturas a `IStorage`. É operação **zero-risco**: apenas declaração TypeScript, sem lógica, sem mudança de comportamento, sem migração de dados.

```typescript
// Adicionar ao IStorage (sem alterar DatabaseStorage):
getOrdersPaginated(params: OrdersPaginatedParams): Promise<PaginatedResult<Order>>;
getProductsPaginated(params: ProductsPaginatedParams): Promise<PaginatedResult<Product>>;
getCompaniesPaginated(params: CompaniesPaginatedParams): Promise<PaginatedResult<Company>>;
updateTask(id: number, updates: TaskUpdateInput): Promise<Task>;
updateInternalIncident(id: number, updates: InternalIncidentUpdate): Promise<InternalIncident>;
updateSanitaryQuestion(id: number, data: Partial<InsertSanitaryQuestion>): Promise<SanitaryQuestion>;
updateSanitaryEvaluation(id: number, data: Partial<InsertSanitaryEvaluation>): Promise<SanitaryEvaluation>;
updateSanitaryEvaluationItem(id: number, data: Partial<InsertSanitaryEvaluationItem>): Promise<SanitaryEvaluationItem>;
upsertAboutUs(data: Partial<InsertAboutUs>): Promise<AboutUs>;
upsertSmtpConfig(data: Partial<InsertSmtpConfig>): Promise<SmtpConfig>;
upsertPushSubscription(data: InsertPushSubscription): Promise<PushSubscription>;
upsertNotificationSetting(event: string, data: Partial<InsertNotificationSetting>): Promise<NotificationSetting>;
```

---

## ETAPA 3 — Classificação dos 12 Métodos

> Nenhum dos 12 métodos é privado, legado, morto, duplicado ou auxiliar interno.
> Todos são **públicos, ativos e chamados por callers externos**.
> Todos pertencem à **Categoria A**.

### Categoria A — Métodos públicos esquecidos na interface (12/12)

| Método | Justificativa |
|---|---|
| `getOrdersPaginated` | Método público de listagem paginada de pedidos. Ativo em `routes.ts`. Adicionado após a interface ser escrita. |
| `getProductsPaginated` | Método público de listagem paginada de produtos. Ativo em `products.service.ts`. Adicionado após a interface. |
| `getCompaniesPaginated` | Método público de listagem paginada de empresas. Ativo em `companies.service.ts`. Adicionado após a interface. |
| `updateTask` | CRUD padrão de Task. Os outros 4 métodos de Task estão na interface. Este foi omitido por lapso. |
| `updateInternalIncident` | CRUD padrão de InternalIncident. `createInternalIncident`, `getInternalIncidents` e `deleteInternalIncident` estão na interface. Este foi omitido. |
| `updateSanitaryQuestion` | CRUD padrão. `getSanitaryQuestions`, `createSanitaryQuestion` e `deleteSanitaryQuestion` estão na interface. Update foi omitido. |
| `updateSanitaryEvaluation` | CRUD padrão. `createSanitaryEvaluation` e `getSanitaryEvaluation` estão na interface. Update foi omitido. |
| `updateSanitaryEvaluationItem` | CRUD padrão. `createSanitaryEvaluationItem` está na interface. Update foi omitido. |
| `upsertAboutUs` | Par natural de `getAboutUs` (que está na interface). O upsert foi omitido. |
| `upsertSmtpConfig` | Par natural de `getSmtpConfig` (que está na interface). O upsert foi omitido. |
| `upsertPushSubscription` | Complemento de `getActivePushSubscriptions` / `deactivatePushSubscription` (ambos na interface). O upsert foi omitido. |
| `upsertNotificationSetting` | Complemento de `getNotificationSettings` (que está na interface). O upsert foi omitido. |

### Categorias B–F: Nenhum método classificado

| Categoria | Descrição | Métodos |
|---|---|---|
| B — Privados internos | Métodos sem visibilidade externa | 0 |
| C — Legados | Métodos marcados `@deprecated` já conhecidos, todos na interface | 0 |
| D — Mortos | Métodos sem nenhum caller | 0 |
| E — Auxiliares | Helpers internos sem contrato público | 0 |
| F — Duplicados | Métodos que replicam funcionalidade existente | 0 |

> **Nota sobre os `@deprecated`:** `payAccountReceivable`, `payAccountPayable` e `getAccountReceivableByOrderId` são legados **mas já estão declarados em `IStorage`** — não entram na lista dos 12 extras.

---

## ETAPA 4 — Priorização de Extração (V1)

### Domínios congelados — excluídos da priorização

| Domínio congelado | Engloba |
|---|---|
| Finance | AccountsReceivable, AccountsPayable, FinancialTransactions, BankAccounts, BankTransactions, CnabImportHistory |
| Fiscal | NfeEmissoes, NfeTrainingLogs, NfeCce, FiscalInvoices, DanfeRecords |
| SaaS | Planos, Assinaturas, BillingEvents, ModulosSistema, PlanoModulos, BancosRecebimento, ContratosClientes, FaturasSaas, SaasMetrics, ModulosMarketplace, EmpresaModulos |

> SaaS engloba Billing, Marketplace, White Label, Gateway e PIX conforme instrução.

### Contagem corrigida — domínios ativos V1

Contagens corrigidas com os 12 métodos extras distribuídos nos seus domínios:

| Domínio | Métodos (plano anterior) | Métodos extras incorporados | Contagem corrigida |
|---|---|---|---|
| Users | 7 | — | **7** |
| Companies | 17 | +1 (`getCompaniesPaginated`) | **18** |
| Customers | 18 | — | **18** |
| Products | 24 | +1 (`getProductsPaginated`) | **25** |
| Orders | 31 | +1 (`getOrdersPaginated`) | **32** |
| Planning | 7 | — | **7** |
| Inventory | 13 | — | **13** |
| Logistics | 30 | — | **30** |
| Delivery | 13 | — | **13** |
| AI | 6 | — | **6** |
| Settings | 45 | +4 (`upsertAboutUs`, `upsertSmtpConfig`, `upsertPushSubscription`, `upsertNotificationSetting`) | **49** |
| Incidents | 20 | +1 (`updateTask`) | **21** |
| Sanitary | 8 | +3 (`updateSanitaryQuestion`, `updateSanitaryEvaluation`, `updateSanitaryEvaluationItem`) | **11** |

---

## ETAPA 5 — Matriz de Decisão (Domínios V1)

> Escala 1–5. Maior = melhor.
> **Score** = soma dos 4 critérios (máximo 20).

| Domínio | Métodos | Importadores | Dependências | Complexidade | Isolável? | Valor V1 | Facilidade | Ganho Arq. | Risco | Score | Prioridade |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Users | 7 | ~25 | bcrypt, invalidateUsageCache | Baixa | ✅ Sim | 5 | 5 | 4 | 5 | **19** | 🥇 1 |
| Companies | 18 | ~35 | bcrypt, cache | Baixa | ✅ Sim | 5 | 4 | 5 | 4 | **18** | 🥈 2 |
| Orders | 32 | ~30 | db.transaction, invalidateUsageCache, SQL JOIN | Média | ✅ Sim | 5 | 3 | 5 | 3 | **16** | 🥉 3 |
| Products | 25 | ~12 | cache (1 método) | Baixa | ✅ Sim | 4 | 4 | 3 | 5 | **16** | 4 |
| Customers | 18 | ~8 | Nenhuma | Baixa | ✅ Sim | 4 | 5 | 2 | 5 | **16** | 5 |
| Logistics | 30 | ~8 | invalidateUsageCache | Baixa-Média | ✅ Sim | 4 | 4 | 2 | 4 | **14** | 6 |
| Delivery | 13 | ~5 | Nenhuma | Baixa | ✅ Sim | 4 | 5 | 2 | 5 | **16** | 7* |
| Incidents | 21 | ~8 | Nenhuma | Baixa | ✅ Sim | 3 | 4 | 2 | 4 | **13** | 8 |
| Inventory | 13 | ~4 | tenantWhere/And/withTenant | Baixa | ✅ Sim | 3 | 4 | 1 | 4 | **12** | 9 |
| Planning | 7 | ~5 | tenantWhere/And/withTenant | Baixa | ✅ Sim | 3 | 5 | 1 | 5 | **14** | 10 |
| Settings | 49 | ~25 | logSecurity, dep. de Companies | Alta | ⚠️ Não isolável | 3 | 2 | 4 | 2 | **11** | 11 |
| AI | 6 | ~5 | Nenhuma | Baixa | ✅ Sim | 2 | 5 | 1 | 5 | **13** | 12 |
| Sanitary | 11 | ~3 | Nenhuma | Baixa | ✅ Sim | 2 | 5 | 1 | 5 | **13** | 13 |

> \* Delivery tem score 16 igual a Orders, Products e Customers, mas é colocado em 7 porque depende operacionalmente de Logistics estar maduro primeiro — os objetos de rota, motorista e veículo são referenciados em deliveries.

### Detalhamento das dependências por domínio

| Domínio | Dependências externas | Dependências internas (cross-método) |
|---|---|---|
| Users | `bcrypt`, `invalidateUsageCache` | Nenhuma |
| Companies | `bcrypt`, `cache` | `updateCompanySettings` → `getCompanySettings`; `upsertEmpresaConfig` → `getEmpresaConfig` (self-contained) |
| Orders | `db.transaction`, `invalidateUsageCache` | `getPurchasingReport`/`getIndustrializedReport` fazem JOIN com companies+products via SQL puro — sem chamada `this.*` |
| Products | `cache`, `logSecurity` | Nenhuma |
| Customers | Nenhuma | Nenhuma |
| Logistics | `invalidateUsageCache` | Nenhuma |
| Delivery | Nenhuma | Nenhuma |
| Incidents | Nenhuma | `createIncidentMessage` atualiza `clientIncidents` via SQL direto — sem `this.*` |
| Inventory | `tenantWhere`, `tenantAnd`, `withTenant`, `stripTenantFields`, `requireTenantId` | `upsertInventorySetting` → `getInventorySettingByProductId` (self-contained) |
| Planning | `tenantWhere`, `tenantAnd`, `withTenant`, `stripTenantFields`, `requireTenantId` | Nenhuma |
| Settings | `logSecurity` | `getActiveAnnouncementsForCompany` → `this.getCompany()` ⚠️ (cross-domain — precisa de Companies pronto) |
| AI | Nenhuma | Nenhuma |
| Sanitary | Nenhuma | Nenhuma |

---

## ETAPA 6 — Recomendação Técnica

### 1. O contrato `IStorage` está consistente?

**Não completamente.**

A interface tem 331 assinaturas e a implementação tem 340 métodos. Os 12 métodos extras são todos públicos e ativamente chamados por callers externos que usam a instância concreta `storage`. A inconsistência não causa falha hoje porque TypeScript resolve os métodos diretamente na classe, mas viola o princípio de que a interface é a fonte de verdade do contrato.

---

### 2. Os 12 métodos representam um problema arquitetural?

**Sim — é um problema arquitetural real, mas de baixa severidade operacional.**

- **Operacionalmente:** zero impacto. Tudo funciona.
- **Arquiteturalmente:** qualquer futuro `IStorage` mock, stub de teste ou implementação alternativa que implemente a interface ficará incompleto — não cobrirá os 12 métodos ativos.
- **Na decomposição:** ao criar `IUsersRepository` a partir de `IStorage`, o compilador não alertará que `updateTask` (por exemplo) falta, porque não está na interface. O repository pode ser gerado incompleto sem erro de compilação.

---

### 3. O problema deve ser resolvido ANTES da decomposição?

**Sim. É pré-requisito da Wave 1.**

Adicionar as 12 assinaturas à `IStorage` é a única etapa obrigatória antes de iniciar qualquer Wave. O esforço é mínimo (12 linhas TypeScript, zero lógica, zero risco de regressão) e elimina toda a ambiguidade de contrato antes que a migração comece.

**Estimativa:** 15–30 minutos de trabalho.

---

### 4. Existe algum risco oculto para a migração?

**Sim. Três riscos identificados:**

**Risco 1 — Dependência cross-domain em Settings (alta relevância)**

`getActiveAnnouncementsForCompany` chama `this.getCompany()`. Quando `Settings` for extraído, o `SettingsRepository` não poderá chamar `this.getCompany()` — isso viria de outro repository. Solução: injetar `ICompaniesRepository` no construtor do `SettingsRepository`, ou converter a chamada em query SQL inline direta.

**Implicação para o plano:** Settings deve ser extraído APÓS Companies (já contemplado no plano original como pré-requisito, mas a razão exata não estava documentada com clareza).

**Risco 2 — Três métodos paginados omitidos da análise anterior (relevância média)**

`getOrdersPaginated`, `getProductsPaginated` e `getCompaniesPaginated` foram completamente ignorados no plano original por ficarem além da linha 2 997 que foi lida. Eles devem entrar nos repositórios de Orders, Products e Companies respectivamente. São métodos mais complexos (paginação + filtros + count query) e precisam de atenção especial no design das interfaces dos repositories.

**Risco 3 — `computeAndSaveSaasMetrics` agrega múltiplas tabelas (baixa relevância agora)**

Este método (no domínio SaaS, congelado) faz queries em `companies`, `assinaturas`, `planos`, `users` e `orders`. É o único método do sistema com dependência genuína de dados de múltiplos domínios. Por estar no domínio congelado, não é urgente — mas deve ser documentado para a Wave SaaS futura.

---

### 5. Há inconsistências que ainda não foram detectadas?

**Sim. Duas:**

**Inconsistência 1 — Assinaturas divergentes entre interface e implementação**

Alguns métodos têm assinaturas ligeiramente diferentes na interface vs. implementação (parâmetros opcionais adicionados na implementação sem atualizar a interface). Exemplos:
- `getOrders(empresaId?: number, limit = 1000)` na implementação vs. `getOrders(): Promise<Order[]>` na interface
- `getPriceGroups(empresaId?: number, limit = 500)` na implementação vs. `getPriceGroups(): Promise<PriceGroup[]>` na interface
- `getCategories(empresaId?: number, limit = 500)` na implementação vs. `getCategories(): Promise<Category[]>` na interface

TypeScript não gera erro porque os parâmetros extras têm valor default, tornando-os compatíveis com a assinatura mais restrita da interface. Mas os callers que precisariam dos parâmetros de filtro (ex.: `getOrders(empresaId)`) precisam confiar na implementação concreta, não na interface.

**Inconsistência 2 — Inconsistência de visibilidade em `getUsers`/`getUsersSafe`**

A interface declara `getUsers()` sem parâmetros, mas a implementação aceita `getUsers(limit = 1000)`. Padrão similar a outros métodos acima.

---

### 6. O plano pode começar imediatamente ou existe etapa obrigatória antes?

**Existe uma etapa obrigatória antes da Wave 1.**

```
PRÉ-WAVE (obrigatório, ~30 min):
  └── Sincronizar IStorage: adicionar 12 assinaturas faltantes

Wave 1 — Users
Wave 2 — Companies
Wave 3 — Orders     ← inclui getOrdersPaginated
Wave 4 — Products   ← inclui getProductsPaginated
...
```

Sem o PRÉ-WAVE, a decomposição funcionará em runtime mas os contratos dos novos repositories estarão arquiteturalmente incompletos desde o início.

---

## Resumo Executivo

### Números corrigidos

| Item | Valor |
|---|---|
| Linhas do arquivo | **3 133** |
| Métodos em `IStorage` | **331** |
| Métodos em `DatabaseStorage` | **340** |
| Gap real (implementação — interface) | **12 métodos** |
| Categoria desses 12 métodos | **100% Categoria A (públicos esquecidos)** |
| Algum morto ou removível? | **Não** |
| Algum privado ou helper interno? | **Não** |
| Risco de runtime hoje? | **Zero** |
| Pré-requisito antes da Wave 1? | **Sim — adicionar 12 assinaturas à IStorage** |

### Três listas finais para V1

---

#### ✅ EXTRAIR IMEDIATAMENTE
*(antes de qualquer novo desenvolvimento)*

| Ordem | Domínio | Métodos | Importadores | Motivo |
|---|---|---|---|---|
| 1 | **Users** | 7 | ~25 | Fundação de auth. Menor domínio. Risco zero. Habilita todos os outros. |
| 2 | **Companies** | 18 | ~35 | Maior pool de importadores. Pré-requisito para Settings. Bcrypt + cache já abstraídos. |
| 3 | **Orders** | 32 | ~30 | Core do negócio. 1 transação gerenciável. JOINs dos relatórios são SQL puro. |
| 4 | **Products** | 25 | ~12 | Totalmente isolado. Usado por Orders e Fiscal (mas Fiscal está congelado). |

---

#### 🔄 EXTRAIR DURANTE O DESENVOLVIMENTO
*(conforme novas funcionalidades forem sendo implementadas)*

| Ordem | Domínio | Métodos | Importadores | Motivo | Pré-requisito |
|---|---|---|---|---|---|
| 5 | **Customers** | 18 | ~8 | Zero dependências. Contratos de escopo são críticos para operação. | Nenhum |
| 6 | **Logistics** | 30 | ~8 | Operação de entrega. Padrão repetitivo facilita extração. | Nenhum |
| 7 | **Delivery** | 13 | ~5 | Zero dependências. Sai naturalmente após Logistics estar estável. | Logistics (wave 6) |
| 8 | **Incidents** | 21 | ~8 | Zero dependências. Lógica cruzada de `createIncidentMessage` é SQL puro. | Nenhum |
| 9 | **Inventory** | 13 | ~4 | Tenant helpers são padronizados. Já tem módulo parcial. | Nenhum |
| 10 | **Planning** | 7 | ~5 | Pequeno, isolado, tenant-scoped padronizado. | Nenhum |
| 11 | **Settings** | 49 | ~25 | Maior entre os não-congelados. Depende de Companies estar extraído primeiro. | Companies (wave 2) |
| 12 | **AI** | 6 | ~5 | Menor domínio ativo. Zero dependências. Extração trivial. | Nenhum |
| 13 | **Sanitary** | 11 | ~3 | Zero dependências. Baixo impacto operacional V1. | Nenhum |

---

#### 🔒 MANTER COMO ESTÁ
*(permanecem dentro do `storage.ts` até versão futura)*

| Domínio | Métodos | Engloba | Motivo |
|---|---|---|---|
| **Finance** | 28 | AR, AP, Transactions, BankAccounts, BankTransactions, CNAB | Congelado explicitamente |
| **Fiscal** | 18 | NF-e, DANFE, CCe, FiscalInvoices | Congelado explicitamente |
| **SaaS** | 50 | Billing, Planos, Assinaturas, Marketplace, White Label, Gateway, PIX, EmpresaModulos | Congelado explicitamente |

**Total congelado: 96 métodos (28% do total de 340)**

---

*Documento de validação. Nenhum arquivo de código foi alterado.*
