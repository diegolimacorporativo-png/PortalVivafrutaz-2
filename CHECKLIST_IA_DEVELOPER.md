# 🤖 IA Developer - Checklist de Operação Clara IA + ERP

> **Objetivo**: Guia rápido para a IA Developer validar e manter o ERP rodando corretamente

---

## ✅ Checklist Pré-Execução

- [ ] Verificar se variáveis de ambiente estão setadas (`.env`)
  ```bash
  cat .env
  # Esperado:
  # DATABASE_URL=postgres://viva_user:SenhaForte123@localhost:5432/viva_db
  # PORT=5000
  ```

- [ ] Verificar se PostgreSQL está rodando
  ```bash
  psql -U viva_user -d viva_db -c "SELECT 1"
  # Esperado: retornar "1"
  ```

- [ ] Instalar dependências se não estiverem
  ```bash
  npm install
  ```

---

## 🚀 Executar Sistema Completo (Recomendado)

### Opção 1: Servidor + Ngrok simultâneos (melhor para testes mobile)

```bash
npm run mobile-test
```

**O que faz:**
1. Valida TypeScript (`npm run check`)
2. Inicia servidor em `http://localhost:5000`
3. Abre túnel Ngrok em paralelo → link HTTPS público
4. Exibe URLs de teste

**Resultado esperado:**
```
✅ Túnel Ngrok aberto com sucesso!

📱 Link público HTTPS:
   https://abc123def456.ngrok.io

🌐 Acesso ao ERP VivaFrutaz:
   Página de Status Clara IA: https://abc123def456.ngrok.io/test-clara
   Chat Clara IA: https://abc123def456.ngrok.io/api/clara/chat
   Inserir NF Manual: https://abc123def456.ngrok.io/admin/insert-nf-manual

💻 Testes recomendados:
   Desktop: http://localhost:5000/test-clara
   Mobile: https://abc123def456.ngrok.io/test-clara
```

### Opção 2: Apenas servidor

```bash
npm run dev
```

Acesso local: `http://localhost:5000`

### Opção 3: Ndrok depois (em outro terminal)

```bash
# Terminal 1
npm run dev

# Terminal 2
npm run tunnel
```

---

## 📱 Testar em Celular

1. Copiar link HTTPS do Ngrok (ex: `https://abc123def456.ngrok.io`)
2. No celular, abrir navegador
3. Colar: `https://abc123def456.ngrok.io/test-clara`
4. Validar:
   - ✅ Status da Clara IA aparece
   - ✅ Chat responde
   - ✅ Botões são clicáveis
   - ✅ Layout é responsivo

---

## 🧪 Executar Testes Automatizados

### Testes E2E Completos (desktop + mobile)

```bash
npm run test:e2e
```

**Testes incluem:**
- Status page carrega corretamente
- Chat API responde
- Permissões por role funcionam
- NF Manual é responsivo
- Performance (< 3s loading)
- Acessibilidade

### Testes Mobile Específicos

```bash
npm run test:e2e:mobile
```

Testa em iPhone 12 + Pixel 5 (Android)

### Modo Debug (ver execução passo a passo)

```bash
npm run test:e2e:debug
```

### Ver relatório dos testes

```bash
npm run test:report
```

---

## 🐛 Se Algo Falhar

### Error: `Cannot find module './db'`

**Causa**: Import path errado  
**Solução**:
```bash
# 1. Encontrar arquivo com erro
npm run check

# 2. Abrir arquivo e procurar import errado
# ❌ import { db } from "./db"
# ✅ import { db } from "../database/db"

# 3. Corrigir e re-rodar
npm run check
```

---

### Error: `ECONNREFUSED: Connection refused`

**Causa**: Servidor ou banco offline  
**Solução**:
```bash
# 1. Verificar PostgreSQL
psql -U viva_user -d viva_db -c "SELECT 1"

# 2. Se erro, iniciar Postgres (Windows):
# - Abrir SQL Server Management Studio
# - Ou: Open Services → PostgreSQL → Start

# 3. Re-iniciar servidor
npm run dev
```

---

### Error: `TypeError: Cannot read property 'role' of undefined`

**Causa**: Usuário não autenticado  
**Solução**:
```bash
# 1. Fazer login no ERP antes de testar
# Ir para: http://localhost:5000/login
# User: admin@example.com / senha

# 2. Se login não funciona, verificar DB
psql -U viva_user -d viva_db
SELECT * FROM users LIMIT 1;
```

---

### Error: `Ngrok ERR_NGROK_317`

**Causa**: Falta token Ngrok ou limite excedido  
**Solução**:
```bash
# 1. Criar conta em https://dashboard.ngrok.com/signup

# 2. Copiar token de autenticação

# 3. Configurar localmente
ngrok config add-authtoken <seu-token-aqui>

# 4. Re-iniciar Ngrok
npm run tunnel
```

---

## 📋 Checklist de Auditoria Total

Execute `npm run audit` para validar tudo:

```bash
npm run audit
```

**Verifica:**
- ✅ TypeScript compilation (zero errors)
- ✅ Build success
- ✅ All imports valid
- ✅ Clara IA endpoints exist
- ✅ Database migrations applied
- ✅ Environment variables set

---

## 🔍 Debug: Verificar API Clara IA

### Testar chat via curl

```bash
curl -X POST http://localhost:5000/api/clara/chat \
  -H "Content-Type: application/json" \
  -d '{"message": "Olá Clara"}'

# Esperado:
# {"response": "Olá! Sou a Clara IA..."}
```

### Testar lista de treinamentos

```bash
curl http://localhost:5000/api/clara-training

# Esperado:
# {data: [{question: "...", answer: "...", active: true}]}
```

### Testar export

```bash
curl http://localhost:5000/api/clara/export?type=orders&period=month

# Esperado:
# Download de arquivo .xlsx
```

---

## 💾 Criar Novo Módulo (Passo a Passo)

Veja `docs/clara-ia-maintenance-guide.md` seção **"Criação de Novo Módulo"** para:

1. ✅ Estrutura do DB + schema
2. ✅ CRUD em storage.ts
3. ✅ Rotas API
4. ✅ Página React + formulário
5. ✅ Integração no menu
6. ✅ Testes

**Exemplo completo**: Módulo "Consultar Clima por Cidade" (leia o guide)

---

## 📊 Monitorar Logs

### Logs do servidor

```
[13:45:22] [express] GET /test-clara HTTP 200
[13:45:23] [express] POST /api/clara/chat HTTP 200
[13:45:25] [express] GET /api/products HTTP 200
```

Se ver erro `HTTP 500`:
- Ler mensagem exata de erro no console
- Abrir arquivo indicado
- Adicionar validação/try-catch
- Re-testar

### Logs do banco

```bash
# Conectar e rodar query de teste
psql -U viva_user -d viva_db
SELECT * FROM clara_training WHERE active = true;
```

---

## 🔐 Segurança: Antes de Publicar

- [ ] Alterar senha padrão `viva_user` no Postgres
- [ ] Usar HTTPS (Ngrok já usa, produção use Let's Encrypt)
- [ ] Validar autenticação em todas rotas `/admin`
- [ ] Testar role `USER` (deve ter chat limitado)
- [ ] Verificar rate limiting (proteção contra abuse)
- [ ] Fazer backup diário do banco

---

## 📈 Próximos Passos

1. **Criar novo módulo**: Siga seção 2 do guide (`clara-ia-maintenance-guide.md`)
2. **Adicionar mais testes**: Expanda `tests/e2e/clara-erp.spec.ts`
3. **Deploy em produção**: Use domínio próprio + HTTPS + monitoramento
4. **Integração CI/CD**: GitHub Actions para rodar `npm run audit` em cada commit

---

## 📞 Suporte Rápido

**Dúvida**: Como corrigir erro TS?  
**Resposta**: Ver `clara-ia-maintenance-guide.md` → Seção "Fluxo: Detectar e Corrigir Bugs"

**Dúvida**: Como criar novo módulo?  
**Resposta**: Ver `clara-ia-maintenance-guide.md` → Seção "Padrão: Criação de Novo Módulo"

**Dúvida**: Como testar em mobile?  
**Resposta**: Este documento → Seção "📱 Testar em Celular"

---

**Last Updated**: 2026-03-20  
**Version**: 1.0  
**Mantainer**: IA Developer  

---

## Comandos Rápidos (Copy-Paste)

```bash
# Validar tudo e rodar com Ngrok
npm run mobile-test

# Apenas testes
npm run test:e2e

# Apenas servidor
npm run dev

# Apenas Ngrok (rodando servidor em outro terminal)
npm run tunnel

# Testes em mobile (iPhone + Android)
npm run test:e2e:mobile

# Ver resultados dos testes
npm run test:report

# Auditoria completa (check + build)
npm run audit
```
