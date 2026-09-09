---
name: Products tenant isolation
description: Modelo híbrido e regras de ownership do catálogo de produtos.
---

Products, categories e product_sub_categories são híbridos: `empresa_id` nulo representa catálogo global/compartilhado; valor preenchido representa recurso da empresa. Sessões tenant-bound podem ler global + próprio tenant, mas só podem alterar/excluir linhas do próprio tenant. MASTER/DIRECTOR globais podem operar global + tenant explicitamente selecionado.

**Why:** O schema não torna `empresa_id` obrigatório e o catálogo existente depende de produtos globais. Filtrar tudo por uma empresa quebraria o portal; deixar IDs sem filtro permitiria IDOR e alteração cross-tenant.

**How to apply:** Derive `empresa_id` do contexto nos inserts, remova campos de tenant do body antes de updates, valide o produto pai para subcategorias e aplique o contexto antes de toda rota de products/categories, incluindo mounts versionados.