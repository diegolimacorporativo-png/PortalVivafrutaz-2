# REPOSITORY_STANDARD.md
## Portal VivaFrutaz ERP — Padrão Oficial de Repositórios

> **Status:** Aprovado para replicação a partir da Wave 1B.
>
> Este documento é o contrato de engenharia de software para todos os
> repositórios criados ou refatorados nas Waves de extração do DatabaseStorage.
> Toda wave futura deve citar e seguir este documento.
>
> Data de criação: 2026-07-21
> Origem: Gate entre Wave 1A e Wave 1B

---

## ETAPA 1 — Auditoria do UsersRepository (Wave 1A)

### 1.1 Análise SOLID

| Princípio | Avaliação | Detalhe |
|-----------|-----------|---------|
| **S — Single Responsibility** | ⚠️ Parcial | O repositório tem **duas** responsabilidades: (1) persistência de User (CRUD + consultas) e (2) gravação de logs de auditoria em `systemLogs` via `log()`. `systemLogs` pertence ao domínio Settings/System, não ao domínio Users. Esta responsabilidade extra foi aceita como **decisão temporária documentada** para evitar dependência circular enquanto `storage.ts` ainda centraliza `createLog`. A `log()` deve ser extraída para um `AuditRepository` na wave correspondente ao domínio Settings. |
| **O — Open/Closed** | ✅ Correto | `IUsersRepository` permite novas implementações (mock, in-memory, read-replica) sem modificar `UsersRepository`. |
| **L — Liskov Substitution** | ✅ Correto | Qualquer implementação de `IUsersRepository` pode substituir `UsersRepository` sem alterar comportamento do chamador. |
| **I — Interface Segregation** | ⚠️ Parcial | `log()` está em `IUsersRepository` mas é uma concern cross-cutting. Callers que precisam apenas de CRUD de User são forçados a depender de um contrato de auditoria. Solução futura: `log()` sai de `IUsersRepository` e vai para `IAuditRepository`. |
| **D — Dependency Inversion** | ⚠️ Parcial | `UsersService` depende de `UsersRepository` (concreto) em vez de `IUsersRepository` (abstração). `DatabaseStorage` instancia `usersRepository` diretamente. Para as waves seguintes, o padrão define que `UsersService` deve aceitar `IUsersRepository` via injeção no construtor — o que `UsersService` já faz (`constructor(private readonly repo: UsersRepository = usersRepository)`), mas o tipo anotado deveria ser a interface. |

### 1.2 Duplicação identificada

| Item duplicado | Onde aparece hoje | Onde vai aparecer | Solução |
|----------------|-------------------|-------------------|---------|
| Tipo `LogEntry` | `IUsersRepository` | Cada `I{Domain}Repository` que precisar de `log()` | Mover para `server/shared/types/log.types.ts` |
| Corpo do método `log()` | `UsersRepository` | Cada repositório que gravar audit logs | Extrair para `AuditRepository` (wave Settings) |
| Padrão `const [row] = await db...returning(); return row!;` | `createUser`, `updateUser` | Todo repositório que faz INSERT/UPDATE | Utilitário `expectOne<T>()` (ver §4) |
| Alias methods (`list`, `getById`, `create`, `update`, `delete`) | `UsersRepository` | Potencialmente Companies, Orders etc. | Convenção documentada — aliases explícitos no repositório, não herança |

### 1.3 Acoplamento desnecessário

| Acoplamento | Risco | Decisão |
|-------------|-------|---------|
| `bcrypt` importado diretamente no repositório | Password hashing (security) misturado com persistence | **Aceito como herança do padrão original.** Waves futuras de domínios sem senha (Companies, Products, Orders) não terão esse acoplamento. Quando um `AuthRepository` for criado, o hashing deve migrar para lá. |
| `invalidateUsageCache` no repositório | Efeito colateral de cache de negócio dentro da camada de dados | **Aceito como herança.** O cache de billing é um side-effect necessário. Documentar que repositories podem chamar `invalidateUsageCache` mas devem evitar qualquer outra lógica de negócio. |
| `systemLogs` em `users.repository.ts` | Tabela de domínio diferente | **Temporário documentado.** Resolvido na wave de Settings. |

### 1.4 Dependências circulares

✅ **Nenhuma.** `users.repository.ts` não importa `storage.ts`. O grafo de dependência após a Wave 1A é:

```
storage.ts
  └─→ users.repository.ts
        └─→ db (Drizzle)
        └─→ @shared/schema
        └─→ billing/usage-cache
        └─→ core/tenant/context
        └─→ bcryptjs
```

O padrão que evita a circular dep é: **nenhum repositório importa `storage`**.

### 1.5 Responsabilidades misturadas

| Responsabilidade | Local atual | Correto? |
|------------------|-------------|---------|
| Persistência CRUD de User | `UsersRepository` | ✅ |
| Hashing de senha | `UsersRepository` (`createUser`, `updateUser`) | ⚠️ Aceitável transitoriamente |
| Invalidação de cache de billing | `UsersRepository` | ⚠️ Side-effect necessário, documentado |
| Gravação de audit log | `UsersRepository` (`log()`) | ❌ Temporário, migrar para `AuditRepository` |
| Scoping de tenant na listagem | `UsersRepository` (`list()`) | ✅ Correto — o repositório é o guardião do tenant |

### 1.6 Código candidato a BaseRepository

Avaliação honesta: **não há massa crítica suficiente para justificar herança**. Os repositórios existentes diferem muito entre si (Finance usa `tenantWhere`/`withTenant`, Users usa `eq(empresaId)`, Orders usa `withTenant(orders, ...)`, Security não tem tenant). Herança seria acoplamento artificial. O padrão oficial opta por **composição e utilitários** (ver §4).

### 1.7 Utilitários compartilháveis identificados

| Utilitário | Impacto | Decisão |
|-----------|---------|---------|
| Tipo `LogEntry` | Alto — duplicado em todo domínio com audit log | ✅ Criar |
| `expectOne<T>()` helper | Médio — elimina `!` anti-pattern | ✅ Criar |
| `hashPassword()` | Baixo — só Users e Auth usam bcrypt | ❌ Não criar — deixar inline |
| `PaginationHelper` | Futuro — paginação ainda inconsistente no projeto | ❌ Adiar para uma wave dedicada |
| `TransactionHelper` | Específico de Orders | ❌ Não generalizar — `orders.transaction.ts` é o padrão |
| `BaseRepository` | Alto risco de acoplamento sem benefício real | ❌ Não criar |

---

## ETAPA 2 — Estrutura oficial do padrão

### 2.1 Estrutura de pastas

```
server/modules/{domain}/
├── interfaces/
│   └── I{Domain}Repository.ts    ← interface pública do repositório
├── {domain}.repository.ts         ← implementação concreta
├── {domain}.service.ts            ← regras de negócio (orquestra o repo)
├── {domain}.controller.ts         ← handlers HTTP (orquestra o service)
├── {domain}.routes.ts             ← router Express
├── {domain}.types.ts              ← tipos públicos do domínio
├── {domain}.validation.ts         ← schemas Zod (validação de entrada)
└── index.ts                       ← barrel: exporta `definition`
```

Pastas opcionais (quando o domínio justificar):

```
├── {domain}.admin.routes.ts       ← rotas privilegiadas separadas
├── {domain}.transaction.ts        ← transações complexas (padrão de Orders)
└── README.md                      ← documentação do módulo
```

### 2.2 Nomenclatura obrigatória

| Artefato | Convenção | Exemplo |
|----------|-----------|---------|
| Interface | `I{Domain}Repository` | `ICompaniesRepository` |
| Classe | `{Domain}Repository` | `CompaniesRepository` |
| Singleton | `{domain}Repository` (camelCase) | `companiesRepository` |
| Arquivo de interface | `interfaces/I{Domain}Repository.ts` | `interfaces/ICompaniesRepository.ts` |
| Arquivo do repositório | `{domain}.repository.ts` | `companies.repository.ts` |
| Tipo de log | importar `LogEntry` de `@shared/types/log` | — |

**Regra de naming dos métodos:** usar verbos descritivos no idioma inglês.
Nomes legados do IStorage (`getUser`, `createUser`, `deleteUser`) são mantidos nos métodos canônicos
para garantir que a delegação em DatabaseStorage seja 1:1 sem quebrar a interface.
Aliases de conveniência (ex.: `getById`, `list`) podem existir mas **não** fazem parte da `I{Domain}Repository`.

### 2.3 Organização dos imports

Ordem obrigatória dentro de todo `{domain}.repository.ts`:

```typescript
// 1. Bibliotecas externas
import bcrypt from "bcryptjs";
import { eq, and, desc, sql } from "drizzle-orm";

// 2. Infraestrutura interna (db, shared utils)
import { db } from "../../database/db";
import { expectOne } from "../../shared/utils/repository.utils";

// 3. Tabelas do schema
import { users as usersTable, systemLogs } from "@shared/schema";

// 4. Tipos do domínio
import type { User, InsertUser } from "./users.types";

// 5. Interface que a classe implementa
import type { IUsersRepository } from "./interfaces/IUsersRepository";

// 6. Tipos cross-cutting (log, paginação)
import type { LogEntry } from "../../shared/types/log.types";

// 7. Helpers de tenant (quando aplicável)
import { tenantWhere, withTenant, stripTenantFields } from "../../core/tenant/scope";
import { requireTenantId, currentTenantId } from "../../core/tenant/context";

// 8. Side-effects necessários (cache, eventos)
import { invalidateUsageCache } from "../billing/usage-cache";
```

**Proibido em qualquer repositório:**
```typescript
import { storage } from "../../services/storage";  // ← NUNCA
```

### 2.4 Tratamento de erros

| Situação | Como tratar |
|----------|-------------|
| `.returning()` sem resultado (INSERT/UPDATE) | Usar `expectOne(rows, "context")` — lança `NotFoundError` com mensagem descritiva |
| Violação de unique constraint (código 23505) | **Não capturar no repositório.** Deixar o erro subir para o Service que lança `ConflictError` com mensagem de negócio. |
| Erro de foreign key (código 23503) | **Não capturar no repositório.** Subir para o Service. |
| Erro de log de auditoria | Capturar silenciosamente com `console.error` — log nunca pode derrubar operação principal. |
| Tenant ausente | Usar `requireTenantId()` — lança `ForbiddenError(403)` automaticamente. |
| Recurso não encontrado | Retornar `undefined` do repositório. Service lança `NotFoundError`. |

```typescript
// ✅ CORRETO — repositório retorna undefined, Service trata
async getById(id: number): Promise<Company | undefined> {
  const [row] = await db.select().from(companiesTable).where(eq(companiesTable.id, id));
  return row;
}

// ❌ ERRADO — repositório lança erro de negócio
async getById(id: number): Promise<Company> {
  const [row] = await db.select().from(companiesTable).where(eq(companiesTable.id, id));
  if (!row) throw new NotFoundError("Empresa não encontrada");  // ← errado aqui
  return row;
}
```

**Exceção aceita:** `expectOne()` em INSERT/UPDATE onde a ausência de resultado indica falha de infraestrutura (não de negócio).

### 2.5 Logs de auditoria

Regra: repositórios **não** devem construir a mensagem de auditoria. O Service constrói a mensagem e chama `repo.log(entry)`. O repositório apenas persiste.

```typescript
// ✅ CORRETO — Service monta, repo persiste
await this.repo.log({
  action: "USER_CREATED",
  description: `Usuário ${user.email} criado por ${actor.email}`,
  userId: actor.id,
  level: "INFO",
});

// ❌ ERRADO — lógica de mensagem no repositório
async createUser(user: InsertUser): Promise<User> {
  const result = ...;
  await this.log({ description: `User ${user.email} created` });  // ← regra de negócio no repo
  return result;
}
```

Enquanto `AuditRepository` não existir, cada repositório que precisar de `log()` implementa o método seguindo o template da §5.

### 2.6 Retornos

| Operação | Tipo de retorno | Justificativa |
|----------|-----------------|---------------|
| SELECT por id | `Promise<Entity \| undefined>` | Permite ao Service diferenciar "não encontrado" de erro |
| SELECT lista | `Promise<Entity[]>` | Array vazio é válido, nunca `undefined` |
| INSERT | `Promise<Entity>` | Usar `expectOne()` — INSERT bem-sucedido SEMPRE retorna uma linha |
| UPDATE | `Promise<Entity>` | Usar `expectOne()` — UPDATE por id SEMPRE retorna uma linha se existir |
| DELETE | `Promise<void>` | Service já validou existência antes de deletar |

### 2.7 Compatibilidade com DatabaseStorage

Para cada domínio extraído, `DatabaseStorage` mantém os métodos da `IStorage` mas transforma-os em delegações de 1 linha:

```typescript
// DatabaseStorage — padrão de delegação
async getCompany(id: number): Promise<Company | undefined> {
  return companiesRepository.getCompany(id);
}

async createCompany(data: InsertCompany): Promise<Company> {
  return companiesRepository.createCompany(data);
}
```

**Regras da delegação:**
- Assinatura idêntica à da `IStorage` — zero alteração para callers externos
- Sem lógica adicional — só a chamada de delegação
- Comentário `// delegated → {Domain}Repository (Wave {X})` facultativo para rastreabilidade

---

## ETAPA 3 — Guia de implementação

### 3.1 Como criar um Repository (passo a passo)

**Pré-condição:** executar `npm run check:strict` e `npm run test` para registrar o baseline.

```
Passo 1 — Criar a interface
  Arquivo: server/modules/{domain}/interfaces/I{Domain}Repository.ts
  Conteúdo: métodos com as MESMAS assinaturas que estão em IStorage para o domínio

Passo 2 — Criar o repositório
  Arquivo: server/modules/{domain}/{domain}.repository.ts
  Conteúdo: classe implements I{Domain}Repository com Drizzle direto
  Sem import de storage. Sem lógica de negócio. Sem construção de mensagens.

Passo 3 — Atualizar DatabaseStorage
  Arquivo: server/services/storage.ts
  Ação: adicionar import do singleton + substituir implementações por delegações de 1 linha

Passo 4 — Validar
  npm run check:strict   → mesmo número de erros que o baseline (± 0)
  npx tsc --noEmit       → 0 erros
  npm run test           → mesmo resultado que o baseline

Passo 5 — Gerar relatório
  docs/refactoring/WAVE_{X}{letra}_{DOMAIN}_REPORT.md
```

### 3.2 Como criar a Interface

```typescript
// server/modules/{domain}/interfaces/I{Domain}Repository.ts

import type { Entity, InsertEntity } from "../{domain}.types";
import type { LogEntry } from "../../../shared/types/log.types";

export interface I{Domain}Repository {
  // Método canônico = mesmo nome que estava em IStorage
  get{Entity}(id: number): Promise<Entity | undefined>;
  get{Entities}(limit?: number): Promise<Entity[]>;
  create{Entity}(data: Insert{Entity}): Promise<Entity>;
  update{Entity}(id: number, updates: Partial<Insert{Entity}>): Promise<Entity>;
  delete{Entity}(id: number): Promise<void>;

  // Somente se o domínio precisa de audit log
  log(entry: LogEntry): Promise<void>;
}
```

**Regras da interface:**
- Métodos **apenas** com a assinatura canônica (1:1 com IStorage)
- Aliases de conveniência (`list`, `getById`) ficam na classe concreta, **não** na interface
- O tipo `LogEntry` vem sempre de `@shared/types/log.types`, nunca redefinido localmente

### 3.3 Como realizar queries

```typescript
// SELECT simples
async getById(id: number): Promise<Entity | undefined> {
  const [row] = await db
    .select()
    .from(entityTable)
    .where(eq(entityTable.id, id));
  return row;
}

// SELECT com filtro de tenant obrigatório (tabelas com empresaId/tenantId)
async list(): Promise<Entity[]> {
  return db
    .select()
    .from(entityTable)
    .where(tenantWhere(entityTable))   // ← lança 403 se sem tenant
    .orderBy(entityTable.id);
}

// SELECT com tenant opcional (MASTER vê tudo)
async listForAdmin(): Promise<Entity[]> {
  const tenantId = currentTenantId();
  const query = db.select().from(entityTable);
  if (tenantId != null) {
    return query.where(eq(entityTable.empresaId, tenantId));
  }
  return query;  // MASTER cross-tenant — comentário obrigatório aqui
}

// SELECT com filtros dinâmicos
async listFiltered(filter: EntityFilter): Promise<Entity[]> {
  const conds: SQL[] = [tenantWhere(entityTable)];
  if (filter.status) conds.push(eq(entityTable.status, filter.status));
  if (filter.from)   conds.push(gte(entityTable.createdAt, filter.from));
  return db
    .select()
    .from(entityTable)
    .where(and(...conds))
    .orderBy(desc(entityTable.createdAt));
}
```

### 3.4 Como usar transações

Para operações que afetam múltiplas tabelas atomicamente, seguir o padrão de `orders.transaction.ts`:

```typescript
// {domain}.transaction.ts
import { db } from "../../database/db";

export async function executeComplexOperation(
  input: ComplexInput,
): Promise<ComplexResult> {
  return db.transaction(async (tx) => {
    const [entityA] = await tx.insert(tableA).values(input.a).returning();
    await tx.insert(tableB).values({ ...input.b, refId: entityA.id });
    return { entityA };
  });
}
```

**Regras de transações:**
- Transações ficam em `{domain}.transaction.ts`, não no repositório
- O repositório expõe um método que chama a função da transação
- Nunca passar `tx` como parâmetro para o repositório — cria acoplamento frágil

### 3.5 Como tratar erros

```typescript
// AppErrors — usar as classes existentes
import { NotFoundError, ConflictError, ForbiddenError } from "../../shared/errors/AppError";

// No Service (não no Repository):
const entity = await this.repo.getById(id);
if (!entity) throw new NotFoundError("Entidade não encontrada");

// Unique violation — capturar no Service
try {
  const entity = await this.repo.createEntity(data);
  return entity;
} catch (err: any) {
  if (err?.code === "23505") throw new ConflictError("Já existe um registro com esses dados");
  throw err;
}
```

### 3.6 Como registrar logs

```typescript
// No Service — montar a mensagem e delegar ao repo
await this.repo.log({
  action: "ENTITY_CREATED",           // string constante, maiúsculas com underscore
  description: `Descrição detalhada`, // português, informativa
  userId: actor.id,                   // quem executou
  userEmail: actor.email,
  userRole: actor.role,
  ip: input.ip,
  level: "INFO",                      // INFO | WARN | ERROR
});

// No Repository — só persistir, sem construir mensagem
async log(entry: LogEntry): Promise<void> {
  try {
    await db.insert(systemLogs).values({ ...entry, level: entry.level ?? "INFO" });
  } catch (err: any) {
    console.error("[{Domain}Repository] Failed to write system log:", err);
  }
}
```

### 3.7 Como realizar paginação

Paginação ainda não foi padronizada no projeto (algumas queries usam `limit`, outras não pagina). Por ora, o padrão mínimo:

```typescript
async list(limit = 100, offset = 0): Promise<Entity[]> {
  return db
    .select()
    .from(entityTable)
    .where(tenantWhere(entityTable))
    .orderBy(desc(entityTable.createdAt))
    .limit(limit)
    .offset(offset);
}
```

**Uma wave futura definirá `PaginationHelper` quando 3+ repositórios precisarem de paginação cursor-based.**

### 3.8 Como manter compatibilidade com DatabaseStorage

```typescript
// storage.ts — após extração do domínio

// 1. Adicionar import (junto com os demais imports de repositórios)
import { companiesRepository } from "../modules/companies/companies.repository";

// 2. Substituir cada método por delegação de 1 linha
async getCompany(id: number): Promise<Company | undefined> {
  return companiesRepository.getCompany(id);
}

async createCompany(data: InsertCompany): Promise<Company> {
  return companiesRepository.createCompany(data);
}
```

**Checklist de compatibilidade (obrigatório após cada wave):**
- [ ] `npx tsc --noEmit` → 0 erros
- [ ] `npm run check:strict` → mesmo número que o baseline
- [ ] `npm run test` → mesmo resultado que o baseline
- [ ] Nenhum endpoint HTTP alterado
- [ ] Nenhuma rota alterada
- [ ] Nenhuma migração de banco

---

## ETAPA 4 — Avaliação de componentes compartilhados

### 4.1 `BaseRepository` — ❌ Não criar

**Veredicto:** Não vale a pena.

**Justificativa:** Os repositórios existentes (Finance, Orders, Users, Security) têm estruturas muito distintas. Finance usa `tenantWhere`/`withTenant` em quase todo método. Users usa `eq(empresaId)` com fallback cross-tenant. Security não tem tenant. Orders tem transações complexas. Uma classe base que tente acomodar todos precisaria de tantos parâmetros genéricos e overrides que o custo de entender a herança superaria o benefício de reuso. **Composição e utilitários** entregam o mesmo reuso sem o acoplamento.

### 4.2 `LogEntry` (tipo compartilhado) — ✅ Criar

**Veredicto:** Vale a pena.

**Utilizado em:** Users, Companies, Orders, Auth, Finance, Products — praticamente todo domínio que tem operações privilegiadas precisa de audit log.

**Onde criar:** `server/shared/types/log.types.ts`

**Conteúdo:**
```typescript
export type LogEntry = {
  action: string;
  description: string;
  userId?: number;
  companyId?: number;
  userEmail?: string;
  userRole?: string;
  ip?: string;
  level?: "INFO" | "WARN" | "ERROR";
};
```

> **Nota de implementação:** A criação de `log.types.ts` e a migração de `LogEntry` de `IUsersRepository` para esse arquivo compartilhado ocorrerá **na Wave 1B**, quando o segundo repositório que precisa de `LogEntry` for criado. Não vale mover antes de ter o segundo consumidor.

### 4.3 `expectOne<T>()` helper — ✅ Criar

**Veredicto:** Vale a pena.

**Problema que resolve:** O padrão `const [row] = await db.insert(...).returning(); return row!;` usa não-null assertion (`!`) para silenciar TypeScript. Isso é um anti-padrão: mascara casos onde o banco retornou 0 linhas (ex.: trigger que causa rollback, constraint que falha silenciosamente).

**Utilizado em:** Todo repositório que faz INSERT ou UPDATE com `.returning()`.

**Onde criar:** `server/shared/utils/repository.utils.ts`

**Conteúdo:**
```typescript
/**
 * Extrai a primeira linha de um array retornado por .returning().
 * Lança erro de infraestrutura se o banco não retornou nenhuma linha,
 * o que indica falha de constraint, trigger, ou bug de configuração —
 * nunca um erro de negócio esperado.
 */
export function expectOne<T>(rows: T[], context: string): T {
  const [row] = rows;
  if (row === undefined) {
    throw new Error(
      `[Repository] ${context}: expected 1 row from .returning(), got 0. ` +
      `This is a data-layer failure, not a business error.`
    );
  }
  return row;
}
```

> **Nota de implementação:** Assim como `LogEntry`, `expectOne` será criado e introduzido progressivamente. `UsersRepository` já usa `!` (aceito na Wave 1A). A partir da Wave 1B, todos os novos repositórios usarão `expectOne`.

### 4.4 `PaginationHelper` — ❌ Adiar

**Veredicto:** Não vale a pena agora.

**Justificativa:** Paginação ainda é inconsistente no projeto. Algumas APIs usam `limit`, outras não paginam. Criar um helper prematuro fossiliza uma API antes do padrão ser testado. Adiar para uma wave dedicada quando 3+ repositórios precisarem de paginação cursor-based.

### 4.5 `QueryHelper` — ❌ Não criar

**Veredicto:** Não vale a pena.

**Justificativa:** Drizzle já é o query builder. Adicionar uma camada de `QueryHelper` seria um wrapper de wrapper. Os helpers de tenant (`tenantWhere`, `tenantAnd`, `withTenant`) em `core/tenant/scope.ts` já preenchem o papel de "helper de query" com escopo bem definido.

### 4.6 `TransactionHelper` — ❌ Não criar

**Veredicto:** Não vale a pena.

**Justificativa:** O padrão `{domain}.transaction.ts` (usado por Orders) já resolve o problema de forma explícita e compreensível. Generalizar aumentaria a abstração sem benefício mensurável.

### 4.7 `ErrorMapper` — ❌ Não criar

**Veredicto:** Não vale a pena.

**Justificativa:** Mapeamento de código de erro Postgres para `AppError` já tem um padrão: feito no Service com `try/catch`. A lógica é simples (`err?.code === "23505"`) e específica por domínio. Um ErrorMapper genérico seria over-engineering.

### 4.8 `ValidationHelper` — ❌ Não criar

**Veredicto:** Não vale a pena.

**Justificativa:** Validação já é responsabilidade do Zod schema na rota (`{domain}.validation.ts`). Colocar validação adicional em um helper de repositório violaria o princípio de que o repositório só faz persistência.

---

## ETAPA 5 — Template oficial

### 5.1 Arquivo: `interfaces/I{Domain}Repository.ts`

```typescript
/**
 * I{Domain}Repository — contrato do repositório do domínio {Domain}.
 *
 * As assinaturas canônicas correspondem 1:1 às assinaturas em IStorage
 * para o domínio {Domain}. DatabaseStorage delega para esta interface;
 * mocks e testes de unidade podem usar qualquer implementação.
 *
 * Wave {X} — {Domain} Repository extraction.
 */
import type { Entity, InsertEntity } from "../{domain}.types";
import type { LogEntry } from "../../../shared/types/log.types";

export interface I{Domain}Repository {
  // ── Métodos canônicos ─────────────────────────────────────────────────────
  get{Entity}(id: number): Promise<Entity | undefined>;
  get{Entities}(limit?: number): Promise<Entity[]>;
  create{Entity}(data: Insert{Entity}): Promise<Entity>;
  update{Entity}(id: number, updates: Partial<Insert{Entity}>): Promise<Entity>;
  delete{Entity}(id: number): Promise<void>;

  // ── Auditoria (remover se o domínio não precisar de log privilegiado) ─────
  log(entry: LogEntry): Promise<void>;
}
```

### 5.2 Arquivo: `{domain}.repository.ts`

```typescript
/**
 * {Domain}Repository — única camada de persistência do domínio {Domain}.
 *
 * Wave {X}: lógica extraída de DatabaseStorage.
 * DatabaseStorage agora apenas delega para esta classe.
 *
 * Regras:
 *  - Sem import de `storage` (evita dependência circular).
 *  - Toda query usa Drizzle diretamente via `db`.
 *  - Sem lógica de negócio — apenas persistência e side-effects mínimos
 *    (invalidateUsageCache quando o domínio afeta billing).
 */

// 1. Libs externas
import { eq, and, desc } from "drizzle-orm";

// 2. Infraestrutura
import { db } from "../../database/db";
import { expectOne } from "../../shared/utils/repository.utils";

// 3. Schema
import { entityTable, systemLogs } from "@shared/schema";

// 4. Tipos do domínio
import type { Entity, InsertEntity } from "./{domain}.types";

// 5. Interface
import type { I{Domain}Repository } from "./interfaces/I{Domain}Repository";

// 6. Tipos cross-cutting
import type { LogEntry } from "../../shared/types/log.types";

// 7. Tenant helpers (remover se o domínio não tiver tenant)
import { tenantWhere, withTenant, stripTenantFields } from "../../core/tenant/scope";
import { requireTenantId } from "../../core/tenant/context";

// 8. Side-effects (remover se não afetar billing)
import { invalidateUsageCache } from "../billing/usage-cache";

export class {Domain}Repository implements I{Domain}Repository {
  // ── Queries ───────────────────────────────────────────────────────────────

  async get{Entity}(id: number): Promise<Entity | undefined> {
    const [row] = await db
      .select()
      .from(entityTable)
      .where(eq(entityTable.id, id));
    return row;
  }

  async get{Entities}(limit = 1000): Promise<Entity[]> {
    return db
      .select()
      .from(entityTable)
      .orderBy(entityTable.id)
      .limit(limit);
  }

  async create{Entity}(data: Insert{Entity}): Promise<Entity> {
    const rows = await db
      .insert(entityTable)
      .values(withTenant(entityTable, data))
      .returning();
    const row = expectOne(rows, "create{Entity}");
    if (row.empresaId) invalidateUsageCache(row.empresaId);
    return row;
  }

  async update{Entity}(
    id: number,
    updates: Partial<Insert{Entity}>,
  ): Promise<Entity> {
    const rows = await db
      .update(entityTable)
      .set(stripTenantFields(updates))
      .where(eq(entityTable.id, id))
      .returning();
    return expectOne(rows, "update{Entity}(id=" + id + ")");
  }

  async delete{Entity}(id: number): Promise<void> {
    await db.delete(entityTable).where(eq(entityTable.id, id));
  }

  // ── Auditoria ─────────────────────────────────────────────────────────────
  // Implementado com Drizzle direto para não importar storage (circular dep).
  // Migrar para AuditRepository quando o domínio Settings for extraído.
  async log(entry: LogEntry): Promise<void> {
    try {
      await db
        .insert(systemLogs)
        .values({ ...entry, level: entry.level ?? "INFO" });
    } catch (err: any) {
      console.error("[{Domain}Repository] Failed to write system log:", err);
    }
  }

  // ── Aliases de conveniência (backward compat) ─────────────────────────────
  // NÃO fazem parte da I{Domain}Repository.
  // Existem somente para que {Domain}Service continue sem alteração.

  list(): Promise<Entity[]> {
    return this.get{Entities}();
  }

  getById(id: number): Promise<Entity | undefined> {
    return this.get{Entity}(id);
  }

  create(data: Insert{Entity}): Promise<Entity> {
    return this.create{Entity}(data);
  }

  update(id: number, updates: Partial<Insert{Entity}>): Promise<Entity> {
    return this.update{Entity}(id, updates);
  }

  delete(id: number): Promise<void> {
    return this.delete{Entity}(id);
  }
}

export const {domain}Repository = new {Domain}Repository();
```

### 5.3 Arquivo: `index.ts` (sem alteração necessária)

O `index.ts` do módulo **não muda** durante a extração do repositório. Ele exporta apenas a `definition` do módulo HTTP (router + basePath + name). O repositório é exportado diretamente do `{domain}.repository.ts` quando necessário.

### 5.4 Arquivo: `{domain}.types.ts` (sem alteração necessária)

Os tipos do domínio não mudam durante a extração. Os repositórios re-exportam de `@shared/schema` via `{domain}.types.ts` — esse contrato permanece estável.

### 5.5 Arquivo de relatório obrigatório

Cada wave gera `docs/refactoring/WAVE_{X}_{DOMAIN}_REPORT.md` contendo:

| Seção | Conteúdo mínimo |
|-------|-----------------|
| Arquivos criados | Lista com caminhos e descrição |
| Arquivos modificados | Lista com tipo de modificação |
| Métodos migrados | Tabela com método, linha original, implementação antes/depois |
| Imports alterados | Callers afetados (esperado: nenhum) |
| Compatibilidade | Checklist de garantias |
| Testes executados | Resultado pré e pós, delta |
| Cobertura | N métodos migrados de N total |
| Riscos | Tabela probabilidade × mitigação |
| Rollback | Instrução para checkpoint + rollback cirúrgico |

---

## Conclusão — O padrão está maduro para ser replicado?

## ✅ SIM

O padrão da Wave 1A está maduro e pode ser replicado a partir da Wave 1B.

### Critérios obrigatórios que todas as próximas Waves devem seguir

1. **Zero import de `storage` no repositório** — sem exceção.
2. **Interface em `interfaces/I{Domain}Repository.ts`** — antes de escrever a implementação.
3. **Métodos canônicos com assinatura 1:1 com IStorage** — para que a delegação em `DatabaseStorage` seja 1 linha sem adaptação.
4. **`expectOne()` em todo INSERT/UPDATE com `.returning()`** — sem `!` non-null assertion.
5. **`LogEntry` importado de `@shared/types/log.types`** — sem redefinição local (a partir da Wave 1B).
6. **`log()` implementado diretamente com Drizzle** — não via `storage.createLog`.
7. **Aliases de conveniência na classe concreta, não na interface** — a interface é o contrato público; os aliases são detalhe de implementação.
8. **`DatabaseStorage` delega com exatamente 1 linha por método** — sem lógica adicional.
9. **Baseline de testes e strict check registrado antes de qualquer alteração** — e confirmado igual após.
10. **Relatório `WAVE_{X}_{DOMAIN}_REPORT.md` gerado ao término de cada wave** — antes de aguardar aprovação humana.

### Dois ajustes a implementar progressivamente (não bloqueadores para Wave 1B)

| Ajuste | Quando | Impacto |
|--------|--------|---------|
| Criar `server/shared/types/log.types.ts` e `server/shared/utils/repository.utils.ts` | **Na Wave 1B**, ao criar o segundo repositório | Elimina duplicação de `LogEntry` e `!` assertion |
| Migrar `UsersRepository.log()` para `AuditRepository` | Wave de extração do domínio Settings | Resolve a mistura de responsabilidades identificada na auditoria |

Estes ajustes **não bloqueiam** a Wave 1B. O padrão é suficientemente estável para replicação imediata.
