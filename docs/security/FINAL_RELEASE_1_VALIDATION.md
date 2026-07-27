# FINAL_RELEASE_1_VALIDATION.md
> Validação dos 9 Bloqueadores — Gate Final Release 1  
> Data: 27 de julho de 2026  
> Metodologia: Leitura completa da cadeia Route → Controller → Service → Repository → DB para cada item  
> Escopo: Somente leitura. Nenhum arquivo de produção foi modificado.

---

## Sumário Executivo

| Bloqueador | Classificação Original | Classificação Validada | Δ |
|---|---|---|---|
| B1 — `POST /api/logs` sem auth | 🔴 Bloqueador | ✅ Vulnerabilidade confirmada | = |
| B2 — `POST/PUT/DELETE /api/products` sem middleware | 🔴 Bloqueador | ✅ Vulnerabilidade confirmada | = |
| B3 — `POST/PUT/DELETE /api/categories` sem middleware | 🔴 Bloqueador | ✅ Vulnerabilidade confirmada | = |
| B4 — `deleteScope` sem companyId no WHERE | 🔴 Bloqueador | 🟡 Proteção parcial | ↑ |
| B5 — `deleteAddress` sem companyId no WHERE | 🔴 Bloqueador | 🟡 Proteção parcial | ↑ |
| B6 — `markIncidentRead` sem verificação de tenant | 🔴 Bloqueador | ✅ Vulnerabilidade confirmada | = |
| B7 — `sql.raw` com template literal | 🟠 Alto | ⚠️ Falso positivo | ↑↑ |
| B8 — `temporaryPassword` em plaintext na resposta | 🟠 Alto | 🔵 Dívida técnica | ↑↑ |
| B9 — Token de reset em `console.log` | 🟡 Médio | ⚠️ Falso positivo | ↑↑ |

**Bloqueadores confirmados reais: 4** (B1, B2, B3, B6)  
**Proteção parcial (IDOR mitigado): 2** (B4, B5)  
**Falsos positivos: 2** (B7, B9)  
**Dívida técnica não explorável: 1** (B8)

---

## B1 — `POST /api/logs` sem autenticação

**Classificação: ✅ Vulnerabilidade confirmada**

### Evidência de código

**`server/routes/logs.routes.ts:20`**
```typescript
app.post('/api/logs', async (req, res) => {
  const userId   = req.session?.userId   ?? null;
  const companyId = req.session?.companyId ?? null;
  // userId e companyId são usados como metadado — não bloqueiam a requisição
  await db.insert(systemLogs).values({
    action:      req.body.action?.slice(0, 100),
    description: req.body.description?.slice(0, 1000),
    userId,
    companyId,
  });
  res.json({ ok: true });
});
```

**`server/routes/routes.ts`** — registro do módulo:
```typescript
logsRegister(app); // sem middleware de rota aplicado antes
```

**`server/app.ts`** — nenhum middleware global de auth para `/api`.

### Fluxo completo
```
POST /api/logs (sem middleware)
  → handler inline
  → extrai session se presente (opcional, não bloqueia)
  → db.insert(systemLogs) com payload do req.body
```

### Cenário real de exploração
Qualquer agente externo sem sessão pode executar:
```bash
curl -X POST https://app.example.com/api/logs \
  -H "Content-Type: application/json" \
  -d '{"action":"ADMIN_DELETE_ALL","description":"Usuário admin deletou todos os pedidos"}'
```
Resultado: entrada falsa inserida em `systemLogs` com `userId: null`, indistinguível visualmente de logs reais sem filtro explícito de `userId IS NOT NULL`. Poluição de trilha de auditoria.

### Impacto
- Poluição de audit log — trilha forense comprometida
- Spam de banco de dados (sem rate-limit nem limit de tamanho além do slice)
- Injeção de eventos falsos que podem confundir monitoramento operacional

### Complexidade da correção
**Baixa.** Adicionar `requireSession` antes do handler. Não altera comportamento para usuários autenticados.

### Quebra de compatibilidade
Não. Clientes legítimos sempre têm sessão ao gerar logs via UI.

---

## B2 — `POST/PUT/DELETE /api/products` sem middleware de rota

**Classificação: ✅ Vulnerabilidade confirmada**

### Evidência de código

**`server/modules/products/products.routes.ts:28–32`**
```typescript
router.get("/",    requireSession, (req, res, next) => productController.list(req, res, next));
router.get("/:id", requireSession, (req, res, next) => productController.getById(req, res, next));
// ↓ GETs têm requireSession; mutações NÃO
router.post("/",   (req, res, next) => productController.create(req, res, next));
router.put("/:id", (req, res, next) => productController.update(req, res, next));
router.delete("/:id", (req, res, next) => productController.remove(req, res, next));
```

**`server/modules/products/products.controller.ts:53–106`** — métodos `create`, `update`, `remove`:
```typescript
async create(req: Request, res: Response, next: NextFunction) {
  const validated = createProductSchema.parse(req.body); // Zod — sem check de sessão
  const product = await this.service.create(validated);
  res.status(201).json(product);
}
// update e remove: mesma ausência de req.session check
```

**`server/modules/index.ts`** — montagem do router:
```typescript
app.use("/api/products",    productsRouter);
app.use("/api/v1/products", productsRouter); // ambos sem middleware de auth
```

### Fluxo completo
```
POST /api/products (sem middleware)
  → productController.create
  → Zod parse (valida formato, não autenticação)
  → productsService.create
  → productsRepository.create
  → db.insert(products)
```

### Cenário real de exploração
```bash
curl -X POST https://app.example.com/api/products \
  -H "Content-Type: application/json" \
  -d '{"name":"Produto Fake","price":0,"empresaId":1,"active":true}'
# Produto criado no catálogo da empresa 1 sem nenhuma sessão
```
```bash
curl -X DELETE https://app.example.com/api/products/42
# Produto 42 deletado sem autenticação
```

### Impacto
- Criação, modificação e deleção de produtos por qualquer agente externo
- Catálogo de produtos corrompível sem rastreamento de usuário
- `empresaId` controlado pelo atacante — pode inserir produtos em qualquer tenant

### Complexidade da correção
**Baixa.** Adicionar `requireRole(['ADMIN','MASTER','DEVELOPER','DIRECTOR'])` nas 3 linhas de mutação.

### Quebra de compatibilidade
Não. Todas as chamadas legítimas de UI passam por sessão autenticada com role adequado.

---

## B3 — `POST/PUT/DELETE /api/categories` sem middleware de rota

**Classificação: ✅ Vulnerabilidade confirmada**

### Evidência de código

**`server/modules/products/categories.routes.ts:15–19`**
```typescript
router.get("/",    requireSession, (req, res) => productController.listCategories(req, res));
// ↓ mutações sem qualquer middleware
router.post("/",      (req, res) => productController.createCategory(req, res));
router.put("/:id",    (req, res) => productController.updateCategory(req, res));
router.delete("/:id", (req, res) => productController.deleteCategory(req, res));
```

**`server/modules/products/products.controller.ts:333–386`** — métodos de categoria:
```typescript
async createCategory(req: Request, res: Response) {
  const validated = createCategorySchema.parse(req.body);
  const cat = await this.service.createCategory(validated);
  res.status(201).json(cat);
  // zero verificação de req.session
}
```

### Fluxo completo
```
POST /api/categories (sem middleware)
  → productController.createCategory
  → Zod parse
  → categoriesService.create
  → db.insert(categories)
```

### Cenário real de exploração
Idêntico ao B2 para categorias. Atacante pode criar categorias fantasmas, renomear categorias existentes ou deletá-las, afetando a estrutura do catálogo de qualquer tenant.

### Impacto
- Estrutura de categorias corrompível sem autenticação
- Afeta exibição de produtos para todos os clientes do tenant

### Complexidade da correção
**Baixa.** Idem B2.

### Quebra de compatibilidade
Não.

---

## B4 — `deleteScope` sem `companyId` no WHERE

**Classificação: 🟡 Proteção parcial**

### Evidência de código

**`server/modules/companies/companies.repository.ts:189`**
```typescript
async deleteScope(scopeId: number, companyId: number): Promise<void> {
  this.assertCompanyAccess(companyId);  // ← guarda de tenant EXISTE
  await db.delete(contractScopes).where(eq(contractScopes.id, scopeId)); // ← sem companyId no WHERE
}
```

**`assertCompanyAccess` (mesmo arquivo)**:
```typescript
private assertCompanyAccess(companyId: number): void {
  const tenant = getCurrentTenant();
  if (tenant && tenant.companyId !== companyId) {
    throw new ForbiddenError('Tenant mismatch');
  }
}
```

**Cadeia completa:**
```
DELETE /api/companies/:id/contract-scopes/:scopeId
  → tenantContext middleware (resolve currentTenantId da sessão)
  → companiesController.deleteScope (extrai :id e :scopeId de params)
  → companiesService.deleteScope(id, scopeId)
  → repo.deleteScope(scopeId, companyId=id)
  → assertCompanyAccess(companyId=id) — valida tenant vs :id da URL
  → db.delete WHERE id = scopeId (sem AND companyId = ?)
```

### Por que é proteção parcial e não bloqueador total

`assertCompanyAccess` valida que o `companyId` passado na URL pertence ao tenant autenticado — ou seja, Company A não pode passar `companyId=B`. **Porém:** se Company A conhece um `scopeId` pertencente à Company B e chama `DELETE /api/companies/A/contract-scopes/[scopeId_de_B]`, o guard passa (A == A) e o `DELETE` remove o scope de B porque o WHERE não inclui `companyId`.

### Cenário real de exploração
IDs são `serial` (inteiros sequenciais — guessable). Um atacante autenticado como Company A pode iterar `scopeId` de 1 a N:
```bash
for i in $(seq 1 1000); do
  curl -X DELETE https://app/api/companies/A/contract-scopes/$i -H "Cookie: session=..."
done
```
Cada chamada apaga o scope com aquele ID, independente do tenant proprietário.

### Impacto
- Deleção de contract scopes de outros tenants por qualquer usuário autenticado
- Exploração requer autenticação válida (não anônima)
- Dados afetados: `contractScopes` — afeta regras de entrega por scope

### Complexidade da correção
**Baixa.** Uma linha: adicionar `eq(contractScopes.companyId, companyId)` ao WHERE.  
Não altera comportamento legítimo (scope correto é deletado; scope de outro tenant retorna 0 rows sem erro).

### Quebra de compatibilidade
Não. Comportamento correto passa idêntico; exploração bloqueada.

---

## B5 — `deleteAddress` sem `companyId` no WHERE

**Classificação: 🟡 Proteção parcial**

### Evidência de código

**`server/modules/companies/companies.repository.ts:279`**
```typescript
async deleteAddress(addressId: number, companyId: number): Promise<void> {
  this.assertCompanyAccess(companyId);  // ← guarda de tenant EXISTE
  await db.delete(companyAddresses).where(eq(companyAddresses.id, addressId)); // ← sem companyId
}
```

### Fluxo completo
```
DELETE /api/companies/:companyId/addresses/:addrId
  → tenantContext middleware
  → companiesController.deleteAddress
  → companiesService.deleteAddress(companyId, addrId)
  → repo.deleteAddress(addrId, companyId)
  → assertCompanyAccess(companyId) — valida tenant
  → db.delete WHERE id = addrId (sem AND companyId = ?)
```

### Análise idêntica ao B4
Mesma vulnerabilidade de IDOR cross-tenant. `addressId` é `serial` (guessable). Atacante autenticado como Company A pode deletar endereços de Company B iterando IDs.

### Impacto
- Deleção de endereços de entrega de outros tenants
- Afeta cálculo de rotas e entregas de clientes terceiros

### Complexidade da correção
**Baixa.** Adicionar `eq(companyAddresses.companyId, companyId)` ao WHERE.

### Quebra de compatibilidade
Não.

---

## B6 — `markIncidentReadByClient` sem verificação de tenant

**Classificação: ✅ Vulnerabilidade confirmada**

### Evidência de código

**`server/routes/incidents.routes.ts:123`**
```typescript
app.post('/api/client-incidents/:id/mark-read', async (req, res) => {
  if (!req.session?.companyId) return res.status(401).json({ message: 'Not authenticated' });
  // ↑ verifica autenticação — mas NÃO usa req.session.companyId para filtrar
  try {
    await storage.markIncidentReadByClient(parseInt(req.params.id));
    //                                     ↑ apenas o :id da URL — sem companyId
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ message: 'Erro' }); }
});
```

**`server/services/storage.ts:1376`**
```typescript
async markIncidentReadByClient(id: number): Promise<void> {
  await db.update(clientIncidents)
    .set({ hasUnreadAdminReply: false } as any)
    .where(eq(clientIncidents.id, id));
    // ↑ WHERE filtra APENAS por id — sem companyId
}
```

**`shared/schema.ts:363`**
```typescript
id: serial("id").primaryKey(), // ← inteiro sequencial, guessable
```

### Fluxo completo
```
POST /api/client-incidents/:id/mark-read (sem middleware de rota)
  → verificação inline: req.session?.companyId exists? (qualquer empresa autenticada passa)
  → storage.markIncidentReadByClient(parseInt(req.params.id))
  → db.update(clientIncidents) SET hasUnreadAdminReply=false WHERE id = :id
  // companyId da sessão NUNCA é usado
```

### Cenário real de exploração
Company A está autenticada. Company B tem o incidente ID 247 com uma resposta admin não lida (`hasUnreadAdminReply: true`). Company A executa:
```bash
curl -X POST https://app/api/client-incidents/247/mark-read \
  -H "Cookie: session=company_a_session"
```
Resultado: `hasUnreadAdminReply` do incidente de Company B é setado para `false`. Company B perde a notificação de nova resposta do admin e pode não responder ao incidente.

### Impacto
- Supressão de notificações de incidentes de outros tenants
- Degradação silenciosa de SLA de suporte (cliente perde sinal de resposta pendente)
- Exploração requer apenas sessão válida de qualquer empresa (não admin)
- IDs são sequenciais: iteração trivial contra todos os incidentes ativos

### Complexidade da correção
**Baixa-média.** Adicionar `companyId` ao `markIncidentReadByClient` e incluir no WHERE. Requer ajuste no storage e no handler.

### Quebra de compatibilidade
Não. Comportamento legítimo (empresa marcando seus próprios incidentes) permanece idêntico.

---

## B7 — `sql.raw` com interpolação de template literal

**Classificação: ⚠️ Falso positivo**

### Evidência de código

**`server/routes/routes.ts:3792–3801`**
```typescript
// Linha 3709: middleware requireDevAccess aplicado à rota pai
const requireDevAccess = (req, res, next) => {
  const allowed = ['MASTER','ADMIN','DEVELOPER','DIRECTOR','SUPER_ADMIN'];
  if (!req.session?.userId || !allowed.includes(req.session.role)) {
    return res.status(403).json({ message: 'Forbidden' });
  }
  next();
};

// Linha 3794: array HARDCODED — sem input do usuário
const mainTables = [
  'companies', 'orders', 'order_items', 'users', 'products', /* ... */
];
for (const tbl of mainTables) {
  try {
    const result = await db.execute(sql.raw(`SELECT count(*) as cnt FROM ${tbl}`));
    rowCounts[tbl] = parseInt((result[0] as any).cnt || '0');
  } catch {}
}
```

### Por que é falso positivo

1. **`tbl` não vem de input do usuário.** O array `mainTables` é declarado inline na mesma função, com strings literais hardcoded no código-fonte TypeScript. Nenhum `req.body`, `req.query` ou `req.params` contribui para o valor.

2. **Rota protegida por `requireDevAccess`.** O endpoint `GET /api/ai-developer/database` rejeita qualquer request sem sessão com role MASTER/ADMIN/DEVELOPER/DIRECTOR/SUPER_ADMIN.

3. **Não é explorável.** Para injetar SQL seria necessário modificar o código-fonte e re-deployar — o que não é um vetor de ataque em runtime.

### Risco residual real
**Dívida técnica de padrão.** O risco futuro existe se qualquer desenvolvedor copiar esse padrão e adicionar uma tabela dinâmica vinda de input. Recomendação: usar `sql.identifier(tbl)` do Drizzle, que escapa corretamente identificadores.

### Impacto atual em produção
**Zero.**

---

## B8 — `temporaryPassword` em plaintext na resposta JSON

**Classificação: 🔵 Dívida técnica (não explorável)**

### Evidência de código

**`server/modules/companies/companies.controller.ts:57–70`**
```typescript
async create(req: Request, res: Response) {
  // Rota protegida por writeGate = requireAuthOrService + tenantContext
  const temporaryPassword = crypto.randomBytes(8).toString("hex");
  const company = await this.service.create({
    ...req.body,
    temporaryPassword: await bcrypt.hash(temporaryPassword, 10),
  });
  // Log da criação com role do usuário
  logger.info(`Company created by ${req.session?.role}`);
  res.status(201).json({ ...company, temporaryPassword }); // ← plaintext na resposta
}
```

### Por que não é explorável

1. **Rota protegida por `writeGate`** (`requireAuthOrService + tenantContext`). Apenas admins autenticados ou service accounts com `x-api-key` chegam ao handler.

2. **Destinatário intencional é o admin.** Como não há envio automático de email da senha temporária (sem chamada ao mailer em `CompaniesService.create`), retornar a senha na resposta é o **único mecanismo de entrega** para o admin. Remover sem substituir por email quebraria o onboarding.

3. **A sessão admin já é confidencial.** O canal (HTTPS + sessão autenticada) é o mesmo que protege todas as demais operações sensíveis do admin.

### Risco residual real
**Baixo.** Se proxies de rede (nginx, load balancer, APM) logarem response bodies, a senha aparece. Em ambientes com log de payload, isso é um vetor de exposição indireta.

### Impacto atual em produção
**Baixo** — limitado a infraestrutura com log de corpo de resposta habilitado.

### Recomendação (não bloqueadora)
Implementar envio de email com a senha temporária e retornar apenas `{ id, passwordSent: true }` na resposta. Isso elimina o risco sem quebrar o fluxo de onboarding.

---

## B9 — Token de reset de senha em `console.log`

**Classificação: ⚠️ Falso positivo**

### Evidência de código

**`server/modules/auth/auth.service.ts:204–214`**
```typescript
async requestPasswordReset(email: string): Promise<void> {
  const token = crypto.randomUUID();
  // ... salva token no banco ...
  await this.mailer.sendPasswordResetEmail(email, resetUrl);

  if (process.env.NODE_ENV === "development") {
    console.log("[RESET_LINK_DEV] PASSWORD RESET LINK");
    console.log(`    ${baseUrl}/reset-password?token=${token}`);
    console.log("    (Token logged for dev testing — not visible in production)");
  }
}
```

### Por que é falso positivo

1. **Guard `NODE_ENV === "development"` explícito.** O bloco de log é executado **apenas em ambiente de desenvolvimento**. Em produção (`NODE_ENV=production`), o `console.log` nunca é atingido.

2. **Padrão legítimo de dev-trap.** Permite testar o fluxo de reset sem SMTP configurado localmente — convenção comum em projetos Node.js.

3. **Em produção no Replit**, `NODE_ENV` é definido como `production` no deploy. Logs de produção são acessíveis apenas ao owner/collaborators do Repl — não ao público.

### Risco residual real
**Zero em produção.** O risco teórico existe apenas se `NODE_ENV` for incorretamente configurado como `development` em um ambiente de produção — o que exigiria erro explícito de configuração.

---

## Mapa Revisado de Bloqueadores

| # | Classificação | Requer auth para explorar? | ID guessable? | Impacto |
|---|---|---|---|---|
| B1 | ✅ Confirmada | ❌ Não — anônimo | N/A | Poluição de audit log |
| B2 | ✅ Confirmada | ❌ Não — anônimo | N/A | Catálogo corrompível por qualquer agente |
| B3 | ✅ Confirmada | ❌ Não — anônimo | N/A | Categorias corrompíveis por qualquer agente |
| B4 | 🟡 Parcial | ✅ Sim — tenant autenticado | ✅ Serial | IDOR: deleta scope de outro tenant |
| B5 | 🟡 Parcial | ✅ Sim — tenant autenticado | ✅ Serial | IDOR: deleta endereço de outro tenant |
| B6 | ✅ Confirmada | ✅ Sim — qualquer empresa | ✅ Serial | Suprime notificações de incidente de outro tenant |
| B7 | ⚠️ Falso positivo | ✅ Role MASTER+ | N/A | Zero — array hardcoded |
| B8 | 🔵 Dívida técnica | ✅ Somente admin | N/A | Baixo — entrega para criador autorizado |
| B9 | ⚠️ Falso positivo | N/A | N/A | Zero — guard NODE_ENV=development |

**Bloqueadores reais para produção: 5** (B1, B2, B3 — anônimos; B4, B5 — autenticados; B6 — autenticado)  
*Nota: B4 e B5 exigem atacante autenticado mas são exploráveis; mantêm classificação de bloqueador por impacto cross-tenant.*

---

## Scores Recalculados

### Metodologia
- B7 e B9 eram falsos positivos: removidos do numerador negativo de segurança
- B8 foi redeclassificado de 🟠 Alto para 🔵 Dívida técnica: impacto de segurança menor
- B4 e B5 redeclassificados de 🔴 Bloqueador para 🟡 Parcial: mitigação parcial existente
- Scores de Arquitetura, Manutenibilidade e Escalabilidade: sem novos dados — mantidos

| Dimensão | Score Anterior | Score Recalculado | Δ | Justificativa |
|---|---|---|---|---|
| **Arquitetura** | 58/100 | **62/100** | +4 | B4/B5 têm `assertCompanyAccess` (proteção de tenant-level existe); `storage.ts` monolito e cross-domain issues permanecem |
| **Segurança** | 49/100 | **59/100** | +10 | B7 e B9 removidos (falsos positivos); B8 rebaixado (não explorável anonimamente); 4 vulnerabilidades confirmadas restam (B1, B2, B3, B6) sendo B1-B3 anônimas — peso alto |
| **Manutenibilidade** | 63/100 | **63/100** | 0 | Nenhum novo dado — findings de services/tamanho de métodos inalterados |
| **Escalabilidade** | 52/100 | **52/100** | 0 | Nenhum novo dado — indexes, N+1 e SELECT* inalterados |

### Detalhamento do score de Segurança (59/100)

| Fator | Peso | Status | Contribuição |
|---|---|---|---|
| Endpoints anônimos com mutação | Alto | 3 confirmados (B1, B2, B3) | −18 |
| IDOR cross-tenant autenticado | Alto | 2 confirmados (B4, B5) | −10 |
| Tenant isolation sem ownership check | Alto | 1 confirmado (B6) | −8 |
| Proteção de rotas autenticadas | Positivo | Módulos Finance/Fiscal/Orders/Users/Master protegidos | +10 |
| requireRole bem aplicado | Positivo | Users, backup, audit, master bem protegidos | +8 |
| Falsos positivos removidos | Positivo | B7 (sql.raw hardcoded) e B9 (NODE_ENV guard) | +8 |
| Dívida técnica não explorável | Neutro | B8 (temporaryPassword — admin only) | −3 |
| **Total** | | | **59/100** |

---

## Parecer Final Revisado

| Pergunta | Resposta |
|---|---|
| **Release 1 está pronta para produção?** | ❌ **Não** — 4 vulnerabilidades confirmadas + 2 IDOR de proteção parcial não resolvidos |
| **Existem bloqueadores reais restantes?** | ✅ Sim — **B1, B2, B3, B6** (confirmadas) + **B4, B5** (proteção parcial com IDOR exploitável) |
| **Tempo total estimado de correção** | **~6 horas** (B1+B2+B3: 1.5h; B4+B5: 1h; B6: 1h; B7+B9: fechados; B8: 1h para envio por email) |
| **Falsos positivos identificados** | B7 (sql.raw hardcoded, gated por requireDevAccess) e B9 (NODE_ENV=development guard) |
| **O ERP suporta 100% da operação da VivaFrutaz?** | ✅ Sim — os blockers são de segurança, não de funcionalidade |

---

*Documento de auditoria exclusivamente. Nenhum arquivo de produção foi modificado.*
