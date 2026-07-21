---
name: Wave 1B Companies extraction
description: Decisões e lições da extração do domínio Companies de DatabaseStorage para CompaniesRepository.
---

## Regra: cross-domain reads pertencem ao service, não ao repo

**Why:** O REPOSITORY_STANDARD proíbe import de `storage` no repositório. Métodos como `getUser`, `getSmtpConfig`, `getProducts`, `createOrder` não são do domínio Companies — pertencem ao serviço que chama `storage.*` diretamente.

**How to apply:** Ao extrair um repositório, qualquer chamada cross-domain que estava no repositório deve ir para o serviço. O serviço pode importar `storage` sem restrição.

## Regra: cache interno do storage não é replicado no repositório

**Why:** Cache é concern de latência/performance, não de persistência. Repositórios são camada de dados puros.

**How to apply:** Se o storage tinha cache (ex.: `getCompanies` com 5 min TTL), o repositório não replica. Callers que precisarem de cache devem adicionar na camada de serviço.

## Padrão de dois conjuntos de métodos no repositório

**Why:** DatabaseStorage precisa delegar com assinaturas IStorage-compatíveis (ex.: `getCompany(id)`), enquanto o serviço usa aliases service-facing (ex.: `get(id)` com tenant-guard). A ICompaniesRepository documenta os dois conjuntos.

**How to apply:** Seção 1 da interface: service-facing (com tenant-guard via `assertCompanyAccess`). Seção 2: IStorage-compatíveis (raw, sem guard). DatabaseStorage delega para os raw; serviço usa os service-facing.

## expectOne<T>() está em server/shared/repositories/repository.utils.ts

Usar em todo INSERT/UPDATE com `.returning()` em vez de `rows[0]!`.

## LogEntry está em server/shared/types/log.types.ts

Re-exportado de IUsersRepository para compatibilidade. Waves futuras importam de `@shared/types/log.types`.
