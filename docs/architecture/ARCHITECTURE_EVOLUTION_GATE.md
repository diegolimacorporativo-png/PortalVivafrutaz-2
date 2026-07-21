# ARCHITECTURE EVOLUTION GATE
## Portal VivaFrutaz ERP — Gate pós-Wave 1B

> **Data:** 2026-07-21
> **Escopo:** Auditoria comparativa entre Wave 1A (Users) e Wave 1B (Companies).
> **Objetivo:** Validar maturidade do padrão antes de escalar para Wave 1C.
> **Restrição:** Nenhum código foi alterado nesta etapa.

---

## ETAPA 1 — COMPARAÇÃO: UsersRepository × CompaniesRepository

### 1.1 Estrutura de Pastas

| Item | Users (Wave 1A) | Companies (Wave 1B) | Status |
|------|-----------------|---------------------|--------|
| `interfaces/` | ✅ Existe | ✅ Existe | ✅ Consistente |
| `*.types.ts` | ✅ Existe | ✅ Existe | ✅ Consistente |
| `*.repository.ts` | ✅ Existe | ✅ Existe | ✅ Consistente |
| `*.service.ts` | ✅ Existe | ✅ Existe | ✅ Consistente |
| `*.controller.ts` | ✅ Existe | ✅ Existe | ✅ Consistente |
| `*.routes.ts` | ✅ Existe | ✅ Existe | ✅ Consistente |
| `*.validation.ts` | ✅ Existe | ✅ Existe | ✅ Consistente |
| `index.ts` | ✅ Existe | ✅ Existe | ✅ Consistente |
| `README.md` | ❌ Ausente | ❌ Ausente | ⚠️ Opcional — presente em Orders e Finance |

**Veredito de estrutura:** ✅ Idêntica. O padrão de pastas está estável.

---

### 1.2 Interfaces

| Item | Users (`IUsersRepository`) | Companies (`ICompaniesRepository`) | Status |
|------|---------------------------|-------------------------------------|--------|
| Arquivo em `interfaces/` | ✅ | ✅ | ✅ Consistente |
| Import de `LogEntry` de `@shared/types/log.types` | ✅ | ✅ | ✅ Consistente |
| `log(entry: LogEntry): Promise<void>` | ✅ | ✅ | ✅ Consistente |
| Tipos de paginação no mesmo arquivo | ❌ (não necessário) | ✅ (`PaginatedCompanies`, `CompaniesPaginatedParams`) | ✅ Apropriado ao domínio |
| Separação service-facing / IStorage-compatible | ❌ (não necessário — domínio simples) | ✅ (duas seções documentadas) | ✅ Companies mais complexo, separação correta |

**Veredito de interfaces:** ✅ Consistente. Companies introduziu boa prática de documentar as duas camadas (service-facing vs. IStorage-compatible) — útil para domínios com métodos rawsde delegação.

---

### 1.3 Tipos

| Item | Users | Companies | Status |
|------|-------|-----------|--------|
| Re-exporta tipos do Drizzle | ✅ (`User`, `InsertUser`) | ✅ (`Company`, `ContractScope`, etc.) | ✅ Consistente |
| Tipos específicos do módulo | ✅ (`SafeUser`, `ChangePasswordInput`, `UnlockUserInput`) | ✅ (`CompanyValidationReport`, `DeliverySuggestion`, `GpsStatus`) | ✅ Consistente |
| Barrel em `index.ts` | ❌ (não re-exporta types) | ✅ (`export * from "./companies.types"`) | ⚠️ **Divergência** — Users não re-exporta types pelo index |

**Divergência D-01:** `server/modules/users/index.ts` não re-exporta `users.types.ts`. Companies exporta `* from ./companies.types`. Para Wave 1C+, o index deve re-exportar os tipos do módulo.

---

### 1.4 Organização dos Métodos

| Item | Users | Companies | Status |
|------|-------|-----------|--------|
| CRUD canônico na interface | ✅ 7 métodos | ✅ 5 + N sub-domínios | ✅ Consistente |
| Aliases de compatibilidade (`list`, `getById`) | ✅ Explícitos no repo | ✅ Não necessário (service-facing usa nomes distintos) | ✅ Correto — aliases só onde necessário |
| Agrupamento por comentários de seção | ✅ | ✅ (seções: Service-facing, IStorage-compatible, Auditoria) | ✅ Companies mais organizado |

---

### 1.5 Queries e `expectOne()`

| Item | Users | Companies | Status |
|------|-------|-----------|--------|
| INSERT com `.returning()` | ✅ | ✅ | ✅ Consistente |
| UPDATE com `.returning()` | ✅ | ✅ | ✅ Consistente |
| Uso de `expectOne<T>()` | ❌ **Usa `rows[0]!`** (non-null assertion) | ✅ **Usa `expectOne(rows, ctx)`** | ⚠️ **Divergência D-02** |

**Divergência D-02 (Dívida técnica):** `UsersRepository` ainda usa o padrão `rows[0]!` (legado da Wave 1A, anterior à criação de `expectOne`). O utilitário `expectOne<T>()` foi criado em `server/shared/repositories/repository.utils.ts` durante a Wave 1B e usado consistentemente em `CompaniesRepository`. `UsersRepository` deve adotar `expectOne` na próxima oportunidade de toque no arquivo.

---

### 1.6 Tratamento de Erros

| Item | Users | Companies | Status |
|------|-------|-----------|--------|
| Usa `AppError` subclasses | ✅ (`ConflictError`, `ForbiddenError`, `NotFoundError`, `UnauthorizedError`) | ✅ (`ForbiddenError`, `NotFoundError`, `BadRequestError`) | ✅ Consistente |
| Import de `@shared/errors/AppError` | ✅ (via service) | ✅ (via repo e service) | ✅ Consistente |
| Captura Postgres error `23505` | ✅ (no service) | ✅ (implícito via constraint) | ✅ Consistente |
| `assertCompanyAccess()` / tenant-guard no repo | ❌ (Users são cross-tenant por definição) | ✅ (`ForbiddenError` quando tenant não autorizado) | ✅ Correto para cada domínio |

---

### 1.7 Logging e Auditoria

| Item | Users | Companies | Status |
|------|-------|-----------|--------|
| `log(entry: LogEntry)` no repositório | ✅ | ✅ | ✅ Idêntico |
| Import de `LogEntry` de `@shared/types/log.types` | ✅ | ✅ | ✅ Idêntico |
| Implementação: Drizzle direto para `systemLogs` | ✅ | ✅ | ✅ Idêntico |
| Falha silenciosa (`console.error` sem propagar) | ✅ | ✅ | ✅ Idêntico |
| Audit calls no service | ✅ (`PASSWORD_CHANGED`, `ACCOUNT_UNLOCKED`) | ✅ (`CONTRACT_UPDATED`, `EMAIL_SENT`) | ✅ Consistente |

**Veredito de logging:** ✅ Padrão totalmente estável e replicado corretamente na Wave 1B.

---

### 1.8 Controller e Response Shapes

| Item | Users | Companies | Status |
|------|-------|-----------|--------|
| Helper `ok()` / `created()` / `noContent()` | ❌ **Usa `res.json()` direto** | ✅ **Usa `ok()`, `created()`, `noContent()`** | ⚠️ **Divergência D-03** |
| Motivo documentado | ✅ (legacy frontend compatibility) | — | — |

**Divergência D-03:** `UsersController` usa `res.json()` direto intencionalmente para preservar shapes legados do frontend. `CompaniesController` adota os helpers de `apiResponse` corretamente. Esta divergência é **aceita e documentada** — Users é um domínio com contrato de resposta fixado pelo frontend existente. Wave 1C+ deve usar `apiResponse` helpers por padrão, como Companies faz.

---

### 1.9 Imports e Exports

| Item | Users | Companies | Status |
|------|-------|-----------|--------|
| Sem import de `storage.ts` | ✅ | ✅ | ✅ Regra respeitada |
| Drizzle via `@shared/db` (ou equivalente) | ✅ | ✅ | ✅ Consistente |
| Barrel `index.ts` com `definition` + exports | ✅ Parcial | ✅ Completo | ⚠️ Ver D-01 |

---

### 1.10 Compatibilidade com `DatabaseStorage`

| Item | Users | Companies | Status |
|------|-------|-----------|--------|
| Delegação em `storage.ts` | ✅ 7 métodos | ✅ 32 métodos | ✅ Funcional |
| Assinaturas 1:1 com `IStorage` | ✅ | ✅ (seção IStorage-compatible documentada) | ✅ Consistente |
| Sem circular dependency | ✅ | ✅ | ✅ |

---

### Resumo das Divergências (Etapa 1)

| ID | Divergência | Severidade | Ação |
|----|-------------|------------|------|
| D-01 | `users/index.ts` não re-exporta types | Baixa | Corrigir na próxima wave que tocar Users |
| D-02 | `UsersRepository` usa `rows[0]!` em vez de `expectOne()` | Média | Dívida técnica — corrigir na próxima wave que tocar Users |
| D-03 | `UsersController` usa `res.json()` em vez de `apiResponse` helpers | Baixa | Aceita e documentada — legado intencional |

---

## ETAPA 2 — REPOSITORY STANDARD v1: Avaliação

O documento `docs/architecture/REPOSITORY_STANDARD.md` foi revisado contra as implementações de Wave 1A e Wave 1B.

### 2.1 O que está adequado

| Seção | Status |
|-------|--------|
| Estrutura de pastas obrigatória | ✅ Seguida em ambas as waves |
| Proibição de import de `storage.ts` | ✅ Cumprida em ambas as waves |
| `LogEntry` em `@shared/types/log.types` | ✅ Implementado a partir de Wave 1B |
| `log()` com Drizzle direto (sem circular dep) | ✅ Implementado em ambas as waves |
| `AppError` subclasses para erros de domínio | ✅ Seguido em ambas |
| Tenant-guard no repositório | ✅ Documentado e seguido em Companies |
| Aliases de compatibilidade explícitos | ✅ Seguidos em Users |

### 2.2 Regras que precisam de ajuste ou adição

| Ajuste | Descrição |
|--------|-----------|
| **`expectOne()` é obrigatório** | O standard menciona `expectOne` como utilitário disponível, mas não o torna obrigatório. A Wave 1B comprovou que `rows[0]!` silencia falhas de INSERT/UPDATE. A partir de Wave 1C, `expectOne()` deve ser **obrigatório** em todo INSERT/UPDATE com `.returning()`. |
| **Index barrel completo** | O standard não especifica que `index.ts` deve re-exportar os tipos do módulo. Companies faz isso corretamente; Users não. Deve ser requisito explícito. |
| **Controller response helpers** | O standard não menciona `apiResponse` helpers. Deve registrar que `ok()`, `created()`, `noContent()` são o padrão para novos domínios. |
| **Documentação das duas camadas da interface** | Para domínios com delegação em `DatabaseStorage`, a interface deve separar explicitamente "service-facing" e "IStorage-compatible". Companies introduziu isso bem — deve virar regra. |

### 2.3 Regras que se mostraram desnecessárias

Nenhuma regra do v1 se mostrou desnecessária ou incorreta. O standard v1 permanece válido.

### 2.4 Proposta de versão 2

> ℹ️ Esta proposta é um registro de intenção. O documento `REPOSITORY_STANDARD.md` não deve ser alterado durante esta etapa de gate.

**Adições para v2:**

```
§ expectOne() — OBRIGATÓRIO
Todo INSERT ou UPDATE que use .returning() deve envolver o resultado em
expectOne(rows, 'NomeRepo.nomeMetodo'). O padrão rows[0]! é proibido.

§ Index barrel — OBRIGATÓRIO
index.ts deve exportar: definition, router, controller, service,
repository, classe do repositório, e `* from ./domain.types`.

§ Controller response — OBRIGATÓRIO
Novos controladores devem usar ok(), created(), noContent() de
server/shared/utils/apiResponse. Exceção documentada: domínios com
contrato legacy fixado pelo frontend.

§ Interface — duas camadas documentadas
Domínios que delegam métodos para DatabaseStorage devem separar
a interface em duas seções com comentários de delimitação:
// ── Service-facing (com tenant-guard) ──
// ── IStorage-compatível (raw, para delegação) ──
```

---

## ETAPA 3 — SHARED: Avaliação de Componentes Compartilháveis

### 3.1 O que já existe (inventário atual)

| Componente | Localização | Status |
|------------|-------------|--------|
| `expectOne<T>()` | `server/shared/repositories/repository.utils.ts` | ✅ Criado na Wave 1B — usar em todas as waves |
| `LogEntry` type | `server/shared/types/log.types.ts` | ✅ Criado na Wave 1B |
| `AppError` subclasses | `server/shared/errors/AppError.ts` | ✅ Disponível |
| `apiResponse` helpers (`ok`, `created`, `noContent`) | `server/shared/utils/apiResponse.ts` | ✅ Disponível |
| `paginate()` | `server/shared/utils/paginate.ts` | ✅ Disponível |
| `asyncHandler` | `server/shared/utils/asyncHandler.ts` | ✅ Disponível |
| Middlewares (`authenticate`, `validate`, `requireRole`) | `server/shared/middlewares/` | ✅ Disponível |

### 3.2 Candidatos avaliados

#### `BaseRepository` (herança)
- **Vale criar?** ❌ **Não recomendado agora.**
- **Motivo:** O único código verdadeiramente duplicado é o corpo do método `log()`. Em TypeScript, herança de classe para reutilização de um único método cria acoplamento rígido e dificulta mocks em testes. A solução correta é composição — extrair `log()` para um `AuditRepository` (planejado para a wave de Settings) e injetar.
- **Quando revisitar:** Após 3+ domínios extraídos, se mais código se mostrar idêntico.

#### `AuditRepository` (composição)
- **Vale criar?** ✅ **Sim — na wave de Settings.**
- **Em quais domínios?** Todos os que têm `log()`: Users, Companies, e qualquer domínio futuro com auditoria.
- **Benefício:** Elimina duplicação do corpo de `log()` (atualmente idêntico em Users e Companies) e remove a dependência temporária de `systemLogs` do domínio de Users/Companies.
- **Custo:** Baixo — um arquivo, zero breaking changes. Bloqueado pela wave de Settings (dono de `systemLogs`).

#### `TenantHelper`
- **Vale criar?** ⚠️ **Avaliar na Wave 1C.**
- **Motivo:** A lógica de `assertCompanyAccess()` e `tenantWhere()` é específica de Companies. Se Wave 1C (Products) precisar de tenant-scoping similar, extrair para `server/shared/utils/tenant.ts`.
- **Benefício esperado:** Evitar duplicação de `currentTenantId()` e guard logic.
- **Custo:** Baixo, mas só vale se 2+ domínios precisarem do mesmo padrão.

#### `PaginationHelper`
- **Vale criar?** ✅ **Já existe** (`server/shared/utils/paginate.ts`). Usar e padronizar seu uso.
- **Ação:** Documentar no REPOSITORY_STANDARD v2 que `paginate()` é o utilitário oficial para queries paginadas.

#### `QueryBuilder`
- **Vale criar?** ❌ **Não.**
- **Motivo:** Drizzle ORM já é o query builder. Adicionar uma camada de abstração sobre Drizzle seria redundante e aumentaria a curva de onboarding.

#### `CrudHelper`
- **Vale criar?** ❌ **Não.**
- **Motivo:** `expectOne<T>()` já resolve o principal problema do CRUD (`returning()` seguro). O restante do CRUD é suficientemente específico por domínio para não se beneficiar de uma abstração genérica.

#### `SoftDeleteHelper`
- **Vale criar?** ⚠️ **Condicional.**
- **Em quais domínios?** Desconhecido — nenhum dos domínios extraídos até agora usa soft-delete extensivamente.
- **Decisão:** Aguardar até que 2+ domínios precisem de soft-delete antes de criar.

#### `RepositoryFactory`
- **Vale criar?** ❌ **Não agora.**
- **Motivo:** A injeção de dependência atual é simples (singletons exportados + passagem no construtor). Uma factory introduziria complexidade sem benefício mensurável no volume atual de domínios.

---

## ETAPA 4 — DATABASESTORAGE: Evolução

### 4.1 Estado atual

| Métrica | Valor |
|---------|-------|
| Total de métodos em `DatabaseStorage` | ~364 |
| Métodos delegados para repositórios externos | **39** (10,7%) |
| Métodos ainda inline em `DatabaseStorage` | **~325** (89,3%) |

### 4.2 Redução por domínio

| Domínio | Métodos Delegados | % do total extraído | Módulo tem repositório? |
|---------|-------------------|---------------------|------------------------|
| Users | 7 | 1,9% | ✅ `users.repository.ts` |
| Companies | 32 | 8,8% | ✅ `companies.repository.ts` |
| Products | 0 | 0% | ✅ Tem `products.repository.ts` mas **sem delegation pattern** |
| Orders | 0 | 0% | ✅ Tem `orders.repository.ts` mas **sem delegation pattern** |
| Finance | 0 | 0% | ✅ Tem `finance.repository.ts` mas **sem delegation pattern** |
| Fiscal, Inventory, Logistics, Auth | 0 | 0% | ✅/⚠️ Módulos existem, delegation não iniciada |

> **Observação crítica:** Products, Orders e Finance já possuem repositórios no sistema de módulos, porém `DatabaseStorage` **não os usa via delegation** — estes métodos ainda vivem inline em `storage.ts`. Isso significa que a extração de Wave 1A/1B criou um padrão mais rigoroso do que o que existe nos módulos pré-existentes.

### 4.3 Próximos candidatos à extração (por volume estimado e risco)

| Domínio | Estimativa de métodos | Risco | Justificativa |
|---------|----------------------|-------|---------------|
| **Products** | ~25–35 | Baixo | Repositório já existe; domínio menos interdependente |
| **Orders** | ~60–80 | Alto | Outbox worker, v2 controller, transações; complexidade máxima |
| **Finance** | ~30–40 | Médio | Domínio sensível (billing, cobranças), repositório existe |
| **Inventory** | ~20–30 | Baixo | Domínio relativamente isolado |
| **Fiscal** | ~30–50 | Muito Alto | NF-e, certificados A1, integrações externas |

---

## ETAPA 5 — PREVISÃO RECALCULADA

### 5.1 Velocidade observada

| Wave | Domínio | Métodos migrados | Complexidade real |
|------|---------|-----------------|-------------------|
| 1A | Users | 7 | Baixa — domínio pequeno, sem sub-entidades |
| 1B | Companies | 32 | Média — sub-domínios (scopes, adjustments, addresses, configs), multi-tenancy |

**Taxa média:** ~20 métodos por wave para domínio de complexidade média.

### 5.2 Estimativas revisadas por wave

| Wave | Domínio Proposto | Métodos Estimados | Complexidade | Risco Principal | Estimativa |
|------|-----------------|-------------------|--------------|-----------------|-----------|
| **1C** | Products + Categories | 25–35 | Média | Pricing service acoplado; múltiplos sub-recursos (categorias, preços, admin) | 1 wave |
| **1D** | Inventory | 20–30 | Baixa-Média | Sem interdependências críticas identificadas | 1 wave |
| **1E** | Finance | 30–40 | Média-Alta | Lógica de billing/cobrança; side-effects financeiros | 1–2 waves |
| **1F** | Orders | 60–80 | Muito Alta | Outbox worker, transações, v1+v2 controllers, workflows | 2–3 waves |
| **1G** | Fiscal (NF-e) | 30–50 | Muito Alta | Integração SEFAZ, certificados, rejeições, reemissões | 2 waves |
| **Settings/System** | Logs, configs, módulos | 20–30 | Média | Permitirá extração de `AuditRepository` | 1 wave |

### 5.3 Riscos identificados

| Risco | Domínio | Mitigação |
|-------|---------|-----------|
| Products tem repositório pré-existente sem o padrão Wave 1B | Products | Adaptar o repositório existente ao padrão antes de conectar delegation |
| Orders usa outbox worker com acesso direto ao `db` | Orders | Mapear dependências do worker antes da extração |
| Finance tem side-effects de billing (`invalidateUsageCache`) | Finance | Documentar todos os side-effects antes de começar |
| Fiscal depende de certificados A1 (encryption) — repositório separado já existe (`companyCertificate.repository.ts`) | Fiscal | Aproveitar o `companyCertificate.repository.ts` como parte do módulo Fiscal |
| `DatabaseStorage` ainda tem ~325 métodos — escopo é grande | Todos | Manter waves incrementais; não tentar extrair tudo de uma vez |

### 5.4 Dependências entre waves

```
Wave 1C (Products)
  └── independente de 1D, 1E, 1F

Wave 1D (Inventory)
  └── independente de 1C, 1E, 1F

Wave 1E (Finance)
  └── pode depender de Users e Companies (billing context)
  └── deve vir ANTES de Orders (Orders cria cobranças)

Wave 1F (Orders)
  └── depende de Products (referencia produtos)
  └── depende de Finance se cobranças forem extraídas
  └── ÚLTIMA dentre os domínios core

Settings/System
  └── deve vir ANTES de qualquer wave que precise de AuditRepository
  └── recomendado: entre 1D e 1E
```

---

## ETAPA 6 — DECISÃO

### 6.1 Respostas objetivas

**1. O padrão está maduro para escalar?**
✅ **Sim.** A estrutura de pastas, interfaces, tipos, logging, error handling, tenant-guard, validation e exports estão consistentes entre as duas waves. O REPOSITORY_STANDARD.md v1 é uma base sólida. Os ajustes identificados são adições, não correções de problemas fundamentais.

**2. Existe dívida técnica criada pelas Waves?**
⚠️ **Sim — dívida pequena e localizada:**
- **D-02 (média):** `UsersRepository` usa `rows[0]!` em vez de `expectOne()`. Não causa bug atual, mas é inconsistência com o padrão estabelecido em Wave 1B.
- **D-01 (baixa):** `users/index.ts` não re-exporta types.
- **`log()` duplicado (baixa):** Corpo idêntico em Users e Companies. Resolução planejada para wave de Settings via `AuditRepository`.

**3. Existe alguma melhoria obrigatória antes da Wave 1C?**
✅ **Uma melhoria obrigatória de processo** (não de código): atualizar `REPOSITORY_STANDARD.md` para versão 2, tornando `expectOne()` obrigatório, padronizando o index barrel completo e os `apiResponse` helpers. Isso garante que Wave 1C já nasce sem as divergências D-01 e D-02.

**4. Qual domínio deve realmente ser o próximo?**
🎯 **Products (Wave 1C).** Justificativa:
- Repositório já existe — menor custo de criação
- Domínio relativamente isolado (produtos não dependem de Orders para existir)
- Complexidade média — adequada como terceira extração
- Elimina 25–35 métodos do `DatabaseStorage`, crescendo a base de confiança do padrão

**5. Existe algum domínio cuja ordem deveria ser alterada?**
✅ **Sim — dois ajustes recomendados:**
- **Settings/System deve ser antecipado** (antes de Finance) para desbloquear a extração de `AuditRepository` e eliminar a dependência temporária de `log()` nos repositórios de domínio.
- **Fiscal deve ser o último** (ou near-last) — dependências externas (SEFAZ), criptografia de certificados e lógica de rejeição/reemissão tornam este domínio o de maior risco. Extrair após toda a base estar consolidada.

---

## VEREDITO FINAL

```
🟡 GO COM AJUSTES
```

O padrão está maduro e as duas waves foram bem executadas. A Wave 1C pode ser iniciada após a conclusão dos seguintes ajustes obrigatórios:

| # | Ajuste obrigatório | Responsável | Bloqueante para 1C? |
|---|-------------------|-------------|---------------------|
| A1 | Atualizar `REPOSITORY_STANDARD.md` para v2 (tornar `expectOne()` obrigatório, padronizar index barrel, apiResponse helpers) | Próxima sessão de arquitetura | ✅ Sim |
| A2 | Registrar dívida técnica D-02 (UsersRepository / `expectOne`) no backlog para resolução na próxima oportunidade de toque | Registro no backlog | ❌ Não bloqueante |
| A3 | Confirmar ordem das waves: Products → Inventory → Settings → Finance → Orders → Fiscal | Decisão arquitetural | ❌ Não bloqueante para 1C |

**Não há bloqueadores técnicos.** O único ajuste que deve preceder o início da Wave 1C é a atualização do REPOSITORY_STANDARD.md para v2 (A1), garantindo que o próximo domínio já implemente o padrão completo desde o início.

---

*Documento gerado pelo Gate de Evolução Arquitetural pós-Wave 1B.*
*Nenhum código foi alterado durante esta análise.*
