---
name: PostgreSQL JSONB membership
description: Evita erros de inferência de tipo ao testar valores JSONB com consultas Drizzle parametrizadas.
---

Ao testar se um array JSONB contém um valor em SQL parametrizado pelo Drizzle, o operador PostgreSQL `?` pode produzir erro de parâmetro sem tipo determinado. Use contenção JSONB (`@>`) com um literal JSONB fixo ou faça cast explícito do parâmetro à direita para `text`.

**Why:** Uma atualização condicionada por `tab_permissions ? $N` falhou com “could not determine data type of parameter”; a contenção JSONB validou e preservou a atualização idempotente.

**How to apply:** Para arrays JSONB de permissões, prefira `col @> '["chave"]'::jsonb` em verificações de valores conhecidos; mantenha valores variáveis parametrizados e tipados explicitamente.