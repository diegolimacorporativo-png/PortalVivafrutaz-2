# RFC-001 — ARQUITETURA OFICIAL V2
## Portal VivaFrutaz ERP

> **Status:** ✅ APROVADA
> **Data de aprovação:** 2026-07-21
> **Origem:** Gate pós-Wave 1B (`docs/architecture/ARCHITECTURE_EVOLUTION_GATE.md`)
> **Vigência:** Release 1 — todas as waves a partir de Wave 1C
> **Referência anterior:** `docs/architecture/REPOSITORY_STANDARD.md` v1 (substituído por esta RFC)

Este documento é a especificação normativa oficial da arquitetura do Portal VivaFrutaz ERP.
Toda wave futura, todo pull request e toda decisão técnica devem citar e respeitar esta RFC.
Divergências requerem uma nova RFC (ver Capítulo 6 — Governança).

---

## CAPÍTULO 1 — PRINCÍPIOS

Os princípios abaixo são inegociáveis. São as razões de ser de toda decisão arquitetural descrita nesta RFC.

---

### P-01 — Compatibilidade Primeiro

Nenhuma wave pode introduzir regressão observável no frontend ou em contratos de API existentes.
O comportamento externo das rotas deve ser preservado mesmo quando a implementação interna é totalmente reescrita.
A compatibilidade não é uma restrição inconveniente — é o critério primário de qualidade de cada wave.

**Na prática:** responses shapes legadas são mantidas no Controller mesmo após refatoração do Service e Repository.
`DatabaseStorage` continua delegando para os novos repositórios — nunca é removida antes do fim da Release 1.

---

### P-02 — Refatoração Incremental

A arquitetura evolui um domínio por vez. Nenhuma wave abrange dois domínios simultaneamente.
O sistema deve funcionar plenamente após cada wave, independentemente do estado das waves seguintes.

**Na prática:** cada wave extrai um domínio de `DatabaseStorage`, conecta a delegation, valida e encerra.
O `DatabaseStorage` encolhe gradualmente sem que o sistema jamais quebre.

---

### P-03 — Zero Regressão

Toda wave termina somente quando os testes de regressão e os testes de contrato passam.
Uma wave que passa nos testes unitários mas quebra um endpoint existente **não está concluída**.

**Na prática:** antes de encerrar uma wave, executar o suite completo de validação e verificar manualmente os endpoints afetados.

---

### P-04 — Um Domínio por Wave

Cada wave tem exatamente um domínio como escopo. Domínios adjacentes podem ser lidos mas nunca alterados.
Isso limita o blast radius de erros e mantém o histórico de mudanças legível.

---

### P-05 — DatabaseStorage como Facade Temporária

`server/services/storage.ts` (`DatabaseStorage`) é uma **facade em extinção**.
Ela existe para garantir compatibilidade enquanto os domínios são extraídos progressivamente.
Cada delegação adicionada é um passo em direção à sua eliminação final.

**Regra:** nenhum método novo deve ser adicionado a `DatabaseStorage`. Novos métodos de domínio vão diretamente no repositório do módulo correspondente.

---

### P-06 — Repository Pattern Obrigatório

Todo acesso ao banco de dados passa por um repositório. Controllers e Services jamais importam `db` (Drizzle) diretamente.
O repositório é a única camada que conhece o esquema de banco e as tabelas Drizzle.

---

### P-07 — Interface Antes da Implementação

Toda wave começa pela criação da interface (`I{Domain}Repository`) antes de escrever qualquer linha da implementação.
A interface é o contrato. A implementação é um detalhe.

**Benefício:** permite mocks em testes, permite múltiplas implementações (read-replica, cache), evita acoplamento.

---

### P-08 — Separação entre Domínio e Infraestrutura

O domínio (regras de negócio, invariantes, validações) não conhece infraestrutura (Drizzle, bcrypt, SMTP, sistema de arquivos).
A infraestrutura conhece o domínio, não o contrário.

**Mapeamento de camadas:**

```
HTTP (routes, validation) ──► Controller ──► Service ──► Repository ──► DB
                                               ↑
                               Regras de negócio aqui.
                               Infraestrutura: apenas no Repository.
```

---

### P-09 — Regras de Negócio Nunca no Repository

O repositório responde a uma pergunta simples: como persistir ou recuperar dados?
Toda lógica condicional de negócio (quem pode fazer o quê, quando algo é válido, quais side-effects ocorrem) pertence ao Service.

**Exceção aceita e documentada:** `assertCompanyAccess()` no `CompaniesRepository` é um guard de tenant-isolation, não uma regra de negócio — é uma invariante de infraestrutura de segurança. Guards de segurança são aceitos no repositório.

---

### P-10 — Services Coordenam, Repositories Persistem

O Service é o maestro: ele chama o repositório, aplica regras, despacha side-effects (email, cache, logs) e retorna o resultado ao Controller.
O Repository é o único músico que toca o banco de dados.

---

## CAPÍTULO 2 — PADRÕES OFICIAIS

---

### 2.1 — Repository Pattern

**Obrigatório em:** todos os domínios extraídos a partir da Wave 1C.

**Estrutura mínima:**

```typescript
// interfaces/IDomainRepository.ts
export interface IDomainRepository {
  list(): Promise<Entity[]>;
  get(id: number): Promise<Entity | undefined>;
  create(data: InsertEntity): Promise<Entity>;
  update(id: number, updates: Partial<InsertEntity>): Promise<Entity>;
  delete(id: number): Promise<void>;
  log(entry: LogEntry): Promise<void>;
}

// domain.repository.ts
export class DomainRepository implements IDomainRepository {
  // implementação com Drizzle
}

export const domainRepository = new DomainRepository();
```

**Regras:**
- O repositório implementa a interface — não herda de nenhuma classe base.
- O singleton exportado (`domainRepository`) é o único ponto de instância.
- O repositório não importa `storage.ts`, `IStorage`, nem qualquer outro repositório de domínio diferente.
- Cross-domain reads (ex: buscar empresa dentro de um repositório de pedidos) pertencem ao Service, nunca ao Repository.

---

### 2.2 — Interface Pattern

**Obrigatório em:** todo repositório.

**Localização:** `server/modules/{domain}/interfaces/I{Domain}Repository.ts`

**Para domínios com delegação em `DatabaseStorage`**, a interface deve separar explicitamente as duas camadas:

```typescript
export interface IDomainRepository {
  // ── Service-facing (com tenant-guard, validações de negócio) ──────────────
  list(): Promise<Entity[]>;
  get(id: number): Promise<Entity | undefined>;
  // ...

  // ── IStorage-compatível (raw, sem tenant-guard — para delegação) ──────────
  getDomainById(id: number): Promise<Entity | undefined>;
  createDomain(data: InsertEntity): Promise<Entity>;
  // ...

  // ── Auditoria ─────────────────────────────────────────────────────────────
  log(entry: LogEntry): Promise<void>;
}
```

**Regras:**
- `LogEntry` é importado de `server/shared/types/log.types.ts` — jamais redefinido localmente.
- A interface é o único contrato que o Service conhece. O Service não importa a classe concreta.
- Tipos de retorno paginado (`Paginated{Domain}`, `{Domain}PaginatedParams`) são definidos **no mesmo arquivo** da interface.

---

### 2.3 — Barrel Index Pattern

**Obrigatório em:** todo módulo.

**Localização:** `server/modules/{domain}/index.ts`

**Conteúdo mínimo obrigatório:**

```typescript
import { domainRouter } from "./domain.routes";

// ── Module definition (consumed by server/modules/index.ts) ───────────────
export const definition = {
  name: "domain" as const,
  basePath: "/api/domain" as const,
  router: domainRouter,
};

// ── Public API do módulo ──────────────────────────────────────────────────
export { domainRouter }            from "./domain.routes";
export { domainController }        from "./domain.controller";
export { domainService }           from "./domain.service";
export { domainRepository,
         DomainRepository }        from "./domain.repository";
export * from "./domain.types";    // ← OBRIGATÓRIO
```

**Regras:**
- `export * from "./domain.types"` é obrigatório — callers externos dependem do barrel, não do arquivo de tipos.
- Callers externos ao módulo importam de `server/modules/{domain}` — nunca de arquivos internos diretamente.
- Se o módulo tiver múltiplos mount points (ex: `/api/domain` e `/api/admin/domain`), cada um tem seu próprio `definition` e ambos são exportados pelo barrel.

---

### 2.4 — Shared Types

**Regra:** tipos usados em mais de um módulo vivem em `server/shared/types/`.
Tipos específicos de um domínio vivem em `server/modules/{domain}/{domain}.types.ts`.

**Tipos compartilhados oficiais:**

| Tipo | Localização | Uso |
|------|-------------|-----|
| `LogEntry` | `server/shared/types/log.types.ts` | Parâmetro do método `log()` em todo repositório |

**Regras:**
- Nunca redefina `LogEntry` localmente — importe do shared.
- `IUsersRepository` re-exporta `LogEntry` para compatibilidade com callers existentes — este é um caso de transição, não um padrão a replicar.
- Novos tipos compartilhados requerem aprovação arquitetural antes de serem adicionados ao shared.

---

### 2.5 — `expectOne<T>()`

**Obrigatório em:** todo INSERT ou UPDATE que usa `.returning()`.

**Localização:** `server/shared/repositories/repository.utils.ts`

**Assinatura:**
```typescript
export function expectOne<T>(rows: T[], context: string): T
```

**Uso correto:**
```typescript
// ✅ CORRETO
const rows = await db.insert(entities).values(data).returning();
return expectOne(rows, "DomainRepository.create");

// ❌ PROIBIDO — falha silenciosa se o INSERT não retornar nada
return rows[0]!;

// ❌ PROIBIDO — undefined propaga sem mensagem útil
return rows[0];
```

**Por quê:** `.returning()` pode retornar array vazio em condições de race condition, constraint violation silenciosa, ou erro de configuração. `expectOne` falha ruidosamente com contexto, em vez de propagar `undefined` para camadas superiores.

**Dívida técnica registrada:** `UsersRepository` (Wave 1A) ainda usa `rows[0]!` — deve ser corrigido na próxima oportunidade de toque neste arquivo.

---

### 2.6 — `apiResponse` Helpers

**Obrigatório em:** todos os controllers criados ou refatorados a partir da Wave 1C.

**Localização:** `server/shared/utils/apiResponse.ts`

**Helpers disponíveis:**

| Helper | HTTP Status | Uso |
|--------|-------------|-----|
| `ok(res, data)` | 200 | Leitura bem-sucedida, atualização bem-sucedida |
| `created(res, data)` | 201 | Criação bem-sucedida |
| `noContent(res)` | 204 | Deleção bem-sucedida, operação sem retorno |

**Uso correto:**
```typescript
// ✅ CORRETO
return ok(res, await this.service.list());
return created(res, await this.service.create(req.body));
return noContent(res);

// ❌ PROIBIDO em novos domínios
return res.status(200).json(data);
return res.json(data);
```

**Exceção documentada:** `UsersController` usa `res.json()` direto para preservar shapes legados do frontend. Esta exceção é intransferível — novos domínios não herdam esta exceção.

---

### 2.7 — `AppError` e Subclasses

**Obrigatório em:** todo erro de domínio lançado por Service ou Repository.

**Localização:** `server/shared/errors/AppError.ts`

**Hierarquia oficial:**

| Classe | HTTP Status | Quando usar |
|--------|-------------|-------------|
| `NotFoundError` | 404 | Entidade não encontrada por id |
| `ConflictError` | 409 | Violação de unicidade (ex: email duplicado, Postgres `23505`) |
| `ForbiddenError` | 403 | Operação negada por permissão ou tenant-guard |
| `UnauthorizedError` | 401 | Usuário não autenticado |
| `BadRequestError` | 400 | Input inválido que passou pela validação Zod mas falhou em regra de negócio |

**Regras:**
- Services e Repositories lançam `AppError` subclasses — nunca `Error` genérico para erros de domínio.
- O error handler global em `server/app.ts` converte `AppError` para a resposta HTTP correta.
- Erros de infraestrutura (falha de banco, timeout) podem propagar como `Error` genérico — o handler os converte em 500.
- A captura de `23505` (unique violation do Postgres) deve sempre ser convertida para `ConflictError` no Service.

---

### 2.8 — Logging e Auditoria

**Método `log()` — obrigatório em:** todo repositório.

**Implementação padrão:**

```typescript
async log(entry: LogEntry): Promise<void> {
  try {
    await db
      .insert(systemLogs)
      .values({
        acao:      entry.acao,
        empresaId: entry.empresaId ?? null,
        usuarioId: entry.usuarioId ?? null,
        detalhes:  entry.detalhes  ?? null,
      });
  } catch (err) {
    // Best-effort: falha de log não propaga para o chamador.
    console.error(`[{Domain}Repository] Failed to write system log:`, err);
  }
}
```

**Regras:**
- `log()` usa Drizzle direto — jamais chama `storage.createAiLog()` ou qualquer método de `storage.ts` (circular dependency).
- Falha de log é silenciosa — nunca propaga para o chamador (`try/catch` obrigatório).
- O Service é quem decide quando logar, não o Repository por conta própria.
- `systemLogs` pertence ao domínio Settings — o uso direto nos repositórios é temporário. Será resolvido com `AuditRepository` na wave de Settings.

**Ações de log recomendadas:** usar constantes descritivas em SNAKE_CASE (`PASSWORD_CHANGED`, `CONTRACT_UPDATED`, `ACCOUNT_UNLOCKED`).

---

### 2.9 — Paginação

**Obrigatório em:** toda listagem que pode crescer ilimitadamente.

**Localização do utilitário:** `server/shared/utils/paginate.ts`

**Tipo de retorno padronizado:**

```typescript
interface Paginated<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}
```

**Parâmetros de entrada padronizados** (definidos na interface do repositório):

```typescript
interface {Domain}PaginatedParams {
  page?:   number;  // default: 1
  limit?:  number;  // default: 20
  search?: string;
  // filtros específicos do domínio
}
```

**Regras:**
- Usar `paginate()` de `server/shared/utils/paginate.ts` — não reimplementar manualmente.
- Parâmetros de paginação são validados pelo schema Zod da rota, não pelo repositório.

---

### 2.10 — Delegação via `DatabaseStorage`

O mecanismo de delegação é o que permite a migração incremental sem breaking changes.

**Como funciona:**

```typescript
// Em server/services/storage.ts
import { domainRepository } from "../modules/domain";

class DatabaseStorage implements IStorage {
  // Antes da extração:
  async getDomainById(id: number) {
    return db.select().from(domains).where(eq(domains.id, id)).limit(1)[0];
  }

  // Depois da extração (delegação):
  getDomainById = this.domainRepository.getDomainById.bind(domainRepository);

  constructor(private readonly domainRepository = domainRepositoryInstance) {}
}
```

**Regras:**
- A assinatura do método delegado em `DatabaseStorage` deve ser **idêntica** à assinatura original em `IStorage`.
- A delegação é feita via `bind` ou arrow function — nunca reescrevendo a lógica.
- Nenhum método novo é adicionado a `DatabaseStorage` após a wave que cria o repositório correspondente.
- `DatabaseStorage` não é removida durante a Release 1 — ela é esvaziada progressivamente.

---

### 2.11 — Compatibilidade e Validação

**Regras de compatibilidade:**

1. **Response shape:** o formato da resposta HTTP não muda. Se o frontend espera `{ id, name, active }`, o controller continua retornando exatamente isso, mesmo que internamente o Service use uma representação diferente.
2. **Route paths:** os paths de API não mudam. A extração de um domínio é transparente para o cliente HTTP.
3. **Auth e middlewares:** os guards de autenticação e autorização das rotas existentes não são removidos nem relaxados.
4. **Aliases de backward-compat:** se o `DatabaseStorage` expunha um método com nome diferente do que o repositório usa, o repositório deve oferecer um alias explícito — nunca deixar o alias pendente.

**Validação obrigatória ao fim de cada wave:**
- Executar todos os testes automatizados.
- Validar manualmente os endpoints críticos do domínio extraído.
- Confirmar que `DatabaseStorage` delega corretamente (smoke test).

---

## CAPÍTULO 3 — ANTI-PADRÕES

Os anti-padrões abaixo são **proibidos**. Pull requests que os introduzam não devem ser aprovados.

---

### AP-01 — Importar `storage.ts` dentro de um Repository

```typescript
// ❌ PROIBIDO
import { storage } from "../../services/storage";

class ProductRepository {
  async getWithCompany(id: number) {
    const company = await storage.getCompany(companyId); // cross-domain no repo
  }
}
```

**Por quê:** cria dependência circular (`storage` → `repository` → `storage`) e acoplamento entre domínios na camada de persistência.

**Solução:** cross-domain reads pertencem ao Service. O Service chama `companiesRepository` e `domainRepository` separadamente e compõe os dados.

---

### AP-02 — Cross-domain Queries no Repository

```typescript
// ❌ PROIBIDO
class OrdersRepository {
  async getOrderWithUser(id: number) {
    return db
      .select()
      .from(orders)
      .leftJoin(users, eq(orders.userId, users.id))  // join de domínio diferente
      .where(eq(orders.id, id));
  }
}
```

**Por quê:** o repositório de Orders não deve conhecer a tabela de Users. Mudanças no domínio Users quebrariam OrdersRepository silenciosamente.

**Solução:** o Service faz duas chamadas de repositório e compõe o resultado. Se performance for crítica, criar uma view no banco ou uma query específica documentada como exceção de performance.

---

### AP-03 — Regras de Negócio no Repository

```typescript
// ❌ PROIBIDO
class OrdersRepository {
  async create(data: InsertOrder) {
    if (data.total > 10000 && !data.approvedBy) {  // regra de negócio
      throw new Error("Pedidos acima de R$10.000 requerem aprovação");
    }
    // ...
  }
}
```

**Por quê:** regras de negócio no repositório não podem ser testadas sem banco de dados, não podem ser compostas com outras regras, e embaralham responsabilidades.

**Solução:** toda validação de negócio vai no Service, antes da chamada ao repositório.

---

### AP-04 — Duplicação de Tipos

```typescript
// ❌ PROIBIDO — redefinir LogEntry localmente
interface LogEntry {
  acao: string;
  empresaId?: number;
  // ...
}
```

**Solução:** importar de `server/shared/types/log.types.ts`. Se um novo tipo compartilhado for necessário, adicioná-lo ao shared — não copiá-lo.

---

### AP-05 — Non-null Assertion em `.returning()`

```typescript
// ❌ PROIBIDO
const rows = await db.insert(entities).values(data).returning();
return rows[0]!;  // falha silenciosa se rows estiver vazio
```

**Solução:** usar `expectOne(rows, "DomainRepository.create")` obrigatoriamente.

---

### AP-06 — Helpers Duplicados

```typescript
// ❌ PROIBIDO — reimplementar o que já existe em server/shared/
function paginateResults<T>(items: T[], page: number, limit: number) { ... }
function sendOkResponse(res: Response, data: unknown) { ... }
```

**Solução:** usar os utilitários de `server/shared/` (`paginate`, `ok`, `created`, `noContent`, `expectOne`, `AppError`).

---

### AP-07 — SQL Espalhado em Controllers

```typescript
// ❌ PROIBIDO
class ProductController {
  async list(req: Request, res: Response) {
    const products = await db.select().from(productsTable);  // DB no controller
    return ok(res, products);
  }
}
```

**Solução:** o Controller chama o Service. O Service chama o Repository. O Repository acessa o banco.

---

### AP-08 — Controllers Acessando o Banco

Variação do AP-07. Mesmo via `storage`, `db`, ou qualquer ORM — proibido no Controller.

---

### AP-09 — Services Acessando Drizzle Diretamente

```typescript
// ❌ PROIBIDO
class ProductService {
  async list() {
    return db.select().from(productsTable);  // Drizzle no service
  }
}
```

**Solução:** o Service recebe o Repository via injeção no construtor e chama somente métodos do repositório.

---

### AP-10 — Adicionar Métodos Novos ao `DatabaseStorage`

```typescript
// ❌ PROIBIDO
class DatabaseStorage {
  async getNewFeatureData() { ... }  // novo método no storage
}
```

**Solução:** novos métodos vão diretamente no repositório do módulo correspondente. `DatabaseStorage` só recebe delegações de métodos que **já existiam** nela.

---

### AP-11 — Importar de Arquivos Internos de Outro Módulo

```typescript
// ❌ PROIBIDO
import { CompaniesService } from "../companies/companies.service";
import type { Company } from "../companies/companies.types";
```

**Solução:** importar sempre pelo barrel do módulo.

```typescript
// ✅ CORRETO
import { CompaniesService, type Company } from "../companies";
```

---

## CAPÍTULO 4 — ORGANIZAÇÃO DOS DOMÍNIOS

### 4.1 Estrutura de Diretório Obrigatória

```
server/modules/{domain}/
├── interfaces/
│   └── I{Domain}Repository.ts    ← contrato de persistência
├── {domain}.types.ts              ← tipos públicos do módulo
├── {domain}.repository.ts         ← implementação Drizzle
├── {domain}.service.ts            ← regras de negócio
├── {domain}.controller.ts         ← adapter HTTP
├── {domain}.routes.ts             ← definição das rotas Express
├── {domain}.validation.ts         ← schemas Zod
└── index.ts                       ← barrel + module definition
```

**Opcional mas recomendado:**
```
├── README.md                      ← decisões e contexto do domínio
```

**Para sub-domínios com repositório próprio** (ex: certificados A1 em Fiscal):
```
├── {subdomain}.repository.ts
```

### 4.2 Responsabilidades por Camada

| Arquivo | Responsabilidade | Pode importar |
|---------|------------------|---------------|
| `interfaces/I{D}Repository.ts` | Contrato de persistência | Tipos próprios, `LogEntry` de shared |
| `{d}.types.ts` | Tipos públicos do módulo | `@shared/schema`, tipos primitivos |
| `{d}.repository.ts` | Persistência com Drizzle | Interface própria, `db`, tabelas Drizzle, `shared/repositories`, `shared/types` |
| `{d}.service.ts` | Regras de negócio, orquestração | Interface do repositório, `shared/errors`, outros repositórios (via interface) |
| `{d}.controller.ts` | Adapter HTTP, sem lógica | Service, `shared/utils/apiResponse` |
| `{d}.routes.ts` | Rotas Express, middlewares | Controller, `core/http/requireAuth`, `core/http/validate` |
| `{d}.validation.ts` | Schemas Zod | `zod`, `@shared/schema` |
| `index.ts` | Barrel | Todos os arquivos do módulo |

### 4.3 Convenções de Nomenclatura

| Elemento | Convenção | Exemplo |
|----------|-----------|---------|
| Interface | `I{Domain}Repository` | `ICompaniesRepository` |
| Classe do repositório | `{Domain}Repository` | `CompaniesRepository` |
| Singleton exportado | `{domain}Repository` | `companiesRepository` |
| Singleton do service | `{domain}Service` | `companiesService` |
| Router exportado | `{domain}Router` | `companiesRouter` |
| Module definition | `definition` | `definition` (sempre este nome) |
| Types file | `{domain}.types.ts` | `companies.types.ts` |
| Validation file | `{domain}.validation.ts` | `companies.validation.ts` |

### 4.4 Validação HTTP

- Schemas Zod vivem em `{domain}.validation.ts`.
- Schemas **estendem** os schemas Drizzle de `@shared/schema` — nunca redefinem campos já definidos no schema.
- Controllers nunca tocam Zod diretamente — recebem dados já validados via middleware `validate`.
- Path params numéricos usam o padrão:
  ```typescript
  const numericId = z.union([z.string(), z.number()])
    .transform((v) => Number(v))
    .refine((n) => Number.isInteger(n) && n > 0, { message: "ID inválido" });
  ```

---

## CAPÍTULO 5 — CHECKLIST DE REVIEW

Este checklist é obrigatório para todo Pull Request que crie ou modifique um repositório de domínio.
O PR não pode ser aprovado se qualquer item obrigatório estiver desmarcado sem justificativa documentada.

---

### BLOCO A — Estrutura

```
□ [A1] Pasta interfaces/ criada com I{Domain}Repository.ts
□ [A2] Arquivo {domain}.types.ts criado e exportando tipos públicos
□ [A3] Arquivo {domain}.repository.ts implementa a interface
□ [A4] Arquivo {domain}.service.ts criado (regras de negócio separadas)
□ [A5] Arquivo {domain}.controller.ts criado (adapter HTTP apenas)
□ [A6] Arquivo {domain}.routes.ts criado (rotas + middlewares)
□ [A7] Arquivo {domain}.validation.ts criado (schemas Zod)
□ [A8] index.ts exporta: definition, router, controller, service,
        repository, classe do repositório, e * from types
```

---

### BLOCO B — Repository

```
□ [B1] Repositório implementa I{Domain}Repository (implements declarado)
□ [B2] Repositório não importa storage.ts nem IStorage
□ [B3] Repositório não importa repositório de outro domínio
□ [B4] Todo INSERT/UPDATE com .returning() usa expectOne()
□ [B5] Nenhuma regra de negócio no repositório
□ [B6] método log() implementado com Drizzle direto (sem circular dep)
□ [B7] log() tem try/catch — falha silenciosa, sem propagar
□ [B8] LogEntry importado de server/shared/types/log.types.ts
□ [B9] Tenant-guard (se aplicável) lança ForbiddenError — nunca retorna undefined silenciosamente
```

---

### BLOCO C — Service

```
□ [C1] Service recebe repositório via construtor (tipo: interface, não classe concreta)
□ [C2] Service não importa db (Drizzle) diretamente
□ [C3] Service não importa storage.ts
□ [C4] Erros de domínio lançados como AppError subclasses
□ [C5] Captura de postgres error 23505 → ConflictError
□ [C6] Side-effects (cache, email, log) disparados pelo Service, não pelo Repository
```

---

### BLOCO D — Controller e Rotas

```
□ [D1] Controller usa ok(), created(), noContent() de apiResponse
        (ou divergência documentada com justificativa)
□ [D2] Controller não acessa db nem storage diretamente
□ [D3] Controller não contém lógica de negócio
□ [D4] Rotas têm middlewares de auth adequados (requireAuth, requireRole)
□ [D5] Rotas têm validação Zod via middleware validate
□ [D6] Rate limiting aplicado onde necessário
```

---

### BLOCO E — Delegação e Compatibilidade

```
□ [E1] DatabaseStorage delega para o novo repositório (sem reescrever lógica)
□ [E2] Assinaturas delegadas em DatabaseStorage são idênticas às originais em IStorage
□ [E3] Nenhum método novo foi adicionado ao DatabaseStorage
□ [E4] Response shapes dos endpoints existentes não mudaram
□ [E5] Todos os aliases de compatibilidade backward-compat estão presentes
□ [E6] Nenhum path de API foi alterado
```

---

### BLOCO F — Qualidade

```
□ [F1] Sem dependência circular (verificado com import graph ou inspeção manual)
□ [F2] Sem non-null assertion (!) em operações de banco
□ [F3] Sem helpers duplicados (verificar se shared/ já oferece)
□ [F4] Tipos do módulo re-exportados pelo barrel (export * from ./domain.types)
□ [F5] Suite de testes passou (unitários + integração)
□ [F6] Smoke test manual dos endpoints afetados realizado
□ [F7] Em caso de rollback necessário: procedimento documentado no PR
```

---

## CAPÍTULO 6 — GOVERNANÇA

### 6.1 Quando criar uma nova RFC

Uma nova RFC deve ser criada quando:

| Situação | Exemplo |
|----------|---------|
| Adoção de novo padrão arquitetural que substitui ou contradiz esta RFC | Substituir Repository Pattern por CQRS |
| Adição de novo utilitário obrigatório ao shared | Criar `BaseRepository` abstrata |
| Mudança na estrutura de pastas do módulo | Adicionar pasta `events/` obrigatória |
| Mudança na política de delegação do `DatabaseStorage` | Remover `DatabaseStorage` antes do fim da Release 1 |
| Inclusão de nova camada entre Service e Repository | Adicionar Command Bus |
| Mudança em qualquer item do Capítulo 3 (Anti-padrões) | Permitir cross-domain join em repositório em casos específicos |

**Não** requerem nova RFC:
- Adição de novo método a um repositório existente dentro do padrão.
- Criação de um novo módulo seguindo esta RFC.
- Correção de dívida técnica documentada (ex: migrar `rows[0]!` para `expectOne`).
- Atualização de dependências sem mudança de API.

### 6.2 Processo de criação de RFC

```
1. Autor abre RFC como draft em docs/architecture/RFC-{NNN}_{TITULO}.md
2. RFC descreve: motivação, proposta, alternativas consideradas, impacto em waves futuras
3. RFC é revisada e aprovada antes de qualquer implementação
4. Após aprovação, RFC recebe status APROVADA e data
5. Esta RFC (RFC-001) é atualizada com referência cruzada à nova RFC
```

### 6.3 Quando um padrão pode ser alterado

Um padrão existente pode ser alterado quando:
- Uma nova RFC o substitui (processo acima).
- A alteração corrige um erro factual (ex: path errado documentado) — sem nova RFC, mas com registro de alteração no próprio documento.

Um padrão **não** pode ser alterado por conveniência local de uma wave específica.
Se uma wave enfrenta dificuldade em seguir o padrão, isso é um sinal de que o padrão precisa de RFC — não de que a wave pode ignorá-lo.

### 6.4 Quem pode alterar padrões arquiteturais

| Ação | Autorização |
|------|-------------|
| Seguir o padrão como documentado | Qualquer desenvolvedor |
| Corrigir erro factual no documento | Desenvolvedor + revisão |
| Propor nova RFC | Qualquer desenvolvedor — requer aprovação |
| Aprovar nova RFC | Arquiteto responsável / tech lead |
| Ignorar um padrão sem RFC | **Nunca permitido** |

---

## CAPÍTULO 7 — ROADMAP DA ARQUITETURA

### 7.1 Estado Atual (pós-Wave 1B)

```
DatabaseStorage (~364 métodos)
├── [DELEGADO] users.*          →  server/modules/users/users.repository.ts       (7 métodos)
├── [DELEGADO] companies.*      →  server/modules/companies/companies.repository.ts (32 métodos)
├── [INLINE]   products.*       →  ainda em storage.ts                            (~30 métodos)
├── [INLINE]   orders.*         →  ainda em storage.ts                            (~70 métodos)
├── [INLINE]   finance.*        →  ainda em storage.ts                            (~35 métodos)
├── [INLINE]   inventory.*      →  ainda em storage.ts                            (~25 métodos)
├── [INLINE]   fiscal.*         →  ainda em storage.ts                            (~40 métodos)
└── [INLINE]   outros/misc      →  ainda em storage.ts                            (~125 métodos)

Métodos delegados: 39 / ~364  (≈ 10,7%)
Módulos com repositório mas SEM delegation: products, orders, finance, inventory
```

### 7.2 Arquitetura após Wave 1C (Products)

```
DatabaseStorage (~334 métodos restantes inline)
├── [DELEGADO] users.*          →  users.repository.ts        (7 métodos)
├── [DELEGADO] companies.*      →  companies.repository.ts    (32 métodos)
├── [DELEGADO] products.*       →  products.repository.ts     (~30 métodos)  ← NEW
│   └── categories.*           →  (parte do módulo products)
├── [INLINE]   orders.*         →  ainda em storage.ts
├── [INLINE]   finance.*        →  ainda em storage.ts
└── [INLINE]   outros           →  ainda em storage.ts

Métodos delegados estimados: ~69 / ~364  (≈ 19%)
```

### 7.3 Arquitetura após Wave 1D (Inventory)

```
DatabaseStorage (~309 métodos restantes inline)
├── [DELEGADO] users.*          →  users.repository.ts
├── [DELEGADO] companies.*      →  companies.repository.ts
├── [DELEGADO] products.*       →  products.repository.ts
├── [DELEGADO] inventory.*      →  inventory.repository.ts    (~25 métodos)  ← NEW
├── [INLINE]   orders.*         →  ainda em storage.ts
├── [INLINE]   finance.*        →  ainda em storage.ts
└── [INLINE]   outros           →  ainda em storage.ts

Métodos delegados estimados: ~94 / ~364  (≈ 26%)
```

### 7.4 Arquitetura após Wave 1E (Settings + AuditRepository)

```
DatabaseStorage (~285 métodos restantes inline)
├── [DELEGADO] users.*          →  users.repository.ts
├── [DELEGADO] companies.*      →  companies.repository.ts
├── [DELEGADO] products.*       →  products.repository.ts
├── [DELEGADO] inventory.*      →  inventory.repository.ts
├── [DELEGADO] settings.*       →  settings.repository.ts     (~25 métodos)  ← NEW
│
├── shared/repositories/
│   └── audit.repository.ts    →  AuditRepository              ← NEW
│       └── log() extraído de Users e Companies
│
├── [INLINE]   orders.*         →  ainda em storage.ts
├── [INLINE]   finance.*        →  ainda em storage.ts
└── [INLINE]   fiscal.*         →  ainda em storage.ts

Métodos delegados estimados: ~119 / ~364  (≈ 33%)
Dívida técnica D-02 resolvida (log() movido para AuditRepository)
```

### 7.5 Arquitetura Final — Release 1 (pós todas as Waves)

```
DatabaseStorage (~50–80 métodos misc restantes inline)
├── [DELEGADO] users.*          →  users.repository.ts
├── [DELEGADO] companies.*      →  companies.repository.ts
├── [DELEGADO] products.*       →  products.repository.ts
├── [DELEGADO] inventory.*      →  inventory.repository.ts
├── [DELEGADO] settings.*       →  settings.repository.ts
├── [DELEGADO] finance.*        →  finance.repository.ts
├── [DELEGADO] orders.*         →  orders.repository.ts
├── [DELEGADO] fiscal.*         →  fiscal.repository.ts
└── [INLINE]   misc/legacy      →  candidatos para Release 2

server/shared/repositories/
├── repository.utils.ts         →  expectOne<T>()
└── audit.repository.ts         →  AuditRepository

Métodos delegados estimados: ~310–330 / ~364  (≈ 85–90%)

DatabaseStorage: casca de delegação, pronta para remoção na Release 2.
```

### 7.6 Tabela de Redução por Wave

| Wave | Domínio | Métodos Extraídos (estimativa) | Total Delegado | % DatabaseStorage Reduzido |
|------|---------|-------------------------------|----------------|----------------------------|
| 1A | Users | 7 | 7 | 1,9% |
| 1B | Companies | 32 | 39 | 10,7% |
| 1C | Products + Categories | ~30 | ~69 | ~19% |
| 1D | Inventory | ~25 | ~94 | ~26% |
| 1E | Settings + AuditRepo | ~25 | ~119 | ~33% |
| 1F | Finance | ~35 | ~154 | ~42% |
| 1G | Orders | ~70 | ~224 | ~62% |
| 1H | Fiscal | ~40 | ~264 | ~73% |
| Release 1 | Misc/residual | ~50 | ~314 | ~86% |

---

## APÊNDICE A — Arquivos de Referência

| Documento | Localização | Status |
|-----------|-------------|--------|
| Repository Standard v1 | `docs/architecture/REPOSITORY_STANDARD.md` | Substituído por esta RFC |
| Architecture Evolution Gate | `docs/architecture/ARCHITECTURE_EVOLUTION_GATE.md` | Referência histórica — Wave 1B |
| Schema do banco | `shared/schema.ts` | Fonte da verdade para tipos Drizzle |
| Utilitários compartilhados | `server/shared/` | Ver estrutura detalhada no Cap. 2 |

## APÊNDICE B — Decisões Temporárias Registradas

| ID | Decisão temporária | Resolução planejada |
|----|-------------------|---------------------|
| T-01 | `log()` duplicado em Users e Companies (corpo idêntico) | Wave de Settings: extração para `AuditRepository` |
| T-02 | `UsersRepository` usa `rows[0]!` em vez de `expectOne()` | Próxima oportunidade de toque em `users.repository.ts` |
| T-03 | `UsersController` usa `res.json()` direto (legacy shape) | Não alterar — contrato fixado pelo frontend |
| T-04 | `systemLogs` acessado diretamente por repositórios de domínio | Wave de Settings: `systemLogs` fica sob `SettingsRepository` |

---

## DECLARAÇÃO FINAL

> **A arquitetura está oficialmente congelada para a Release 1.**
>
> Todas as próximas Waves — a partir da Wave 1C — devem seguir obrigatoriamente esta RFC.
> Qualquer divergência intencional requer nova RFC aprovada antes da implementação.
> Divergências não intencionais (bugs de padrão) devem ser documentadas como dívida técnica
> no Apêndice B desta RFC via PR de atualização documental.
>
> **RFC-001 — Status: APROVADA — 2026-07-21**
