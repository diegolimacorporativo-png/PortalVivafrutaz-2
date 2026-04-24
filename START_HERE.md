# 🚀 COMECE AQUI - ERP VIVAFRUTAZ + CLARA IA

**Bem-vindo ao ERP VivaFrutaz com Clara IA!**

Este arquivo contém instruções passo a passo para começar a usar o sistema.

---

## ⚡ Início Rápido (3 minutos)

### 1️⃣ Clonar ou Abrir o Projeto
```bash
# Se for primeira vez, clone o repositório
git clone <url-do-repo> vivafrutaz
cd vivafrutaz

# Ou navegue ao diretório existente
cd c:\Users\User\Desktop\projeto
```

### 2️⃣ Instalar Dependências
```bash
npm install
```

### 3️⃣ Configurar Variáveis de Ambiente
**Criar arquivo `.env` na raiz do projeto:**

```env
# Database (PostgreSQL)
DATABASE_URL=postgresql://viva_user:SenhaForte123@localhost:5432/viva_db

# Server
PORT=5000
NODE_ENV=development

# Email (opcional, para backup/alertas)
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=seu_email@gmail.com
SMTP_PASSWORD=sua_senha
SMTP_FROM=noreply@vivafrutaz.com
```

### 4️⃣ Executar Migrações do Banco
```bash
npm run db:push
```

### 5️⃣ Validar Ambiente
```bash
npm run validate
```

**Se tudo passar ✅**, prossiga para o próximo passo.

### 6️⃣ Iniciar o Servidor
```bash
npm run dev
```

Você verá na tela:
```
✅ Servidor rodando em http://localhost:5000
✅ Conectado ao banco de dados
```

### 7️⃣ Acessar o Sistema
**Desktop/Laptop:**
```
http://localhost:5000
```

**Outro PC na mesma rede:**
```
http://192.168.100.78:5000
(substitua o IP pelo seu)
```

**Celular (via Ngrok - acesso público HTTPS):**
```bash
# Em outro terminal, execute:
npm run tunnel
```

Você verá:
```
🌐 Túnel aberto em: https://abc123def456.ngrok.io
```

Acesse este link no celular via 4G/5G.

---

## 🧪 Testar o Sistema

### Teste Rápido (Manual)

1. **Acesse** http://localhost:5000
2. **Login** (padrão):
   - Email: `admin@vivafrutaz.com`
   - Senha: `senha123`
3. **Teste Clara IA**:
   - Vá para `/test-clara`
   - Clique em "Fazer Pergunta"
   - Envie: "Oi Clara"
   - Veja a resposta da IA
4. **Teste NF Manual**:
   - Vá para `/admin/insert-nf-manual`
   - Preencha os campos (número NF, data, cliente, etc)
   - Clique "Salvar"
   - Veja mensagem de sucesso

### Teste Automatizado (Playwright)
```bash
npm run test:e2e
```

**Ver resultados:**
```bash
npm run test:report
```

### Teste Mobile (Ngrok)
```bash
npm run mobile-test
```

Isto inicia:
- ✅ Validação de código (npm run audit)
- ✅ Servidor (npm run dev)
- ✅ Ngrok (npm run tunnel)

Tudo em paralelo. Abra o link no celular e teste.

---

## 📍 Principais Funcionalidades

| Funcionalidade | URL | Descrição |
|---|---|---|
| Status Clara IA | `/test-clara` | Visão geral do sistema |
| Treinar Clara | `/admin/clara-training` | Q&A para Clara aprender |
| NF Manual | `/admin/insert-nf-manual` | Inserir Notas Fiscais |
| Chat Clara | `/api/clara/chat` | API de chat (POST) |
| Dashboard | `/admin/dashboard` | Relatórios e gráficos |

---

## 🐛 Resolver Problemas Comuns

### ❌ "Cannot connect to database"
**Solução:**
```bash
# Verificar se PostgreSQL está rodando
psql -U viva_user -d viva_db -c "SELECT 1"

# Se não funcionar, criar banco
createdb -U postgres viva_db
createuser -U postgres viva_user
psql -U postgres -c "ALTER USER viva_user PASSWORD 'SenhaForte123'"
psql -U postgres -d viva_db -c "GRANT ALL PRIVILEGES ON DATABASE viva_db TO viva_user"
```

### ❌ "Module not found"
**Solução:**
```bash
# Reinstalar dependências
rm -rf node_modules package-lock.json
npm install
npm run check
```

### ❌ "Port already in use"
**Solução:**
```bash
# Mudar porta em .env
PORT=5001

# Ou matar processo
# Windows PowerShell:
Get-Process node | Stop-Process -Force

# Mac/Linux:
lsof -ti:5000 | xargs kill -9
```

### ❌ "Cannot find ngrok"
**Solução:**
```bash
# Instalar ngrok
npm install -g ngrok

# Ou configurar:
npm install ngrok
```

---

## 📚 Documentação Completa

| Documento | Propósito | Público |
|-----------|----------|---------|
| `RELATORIO_FINAL.md` | Resumo do projeto | Todos |
| `CHECKLIST_IA_DEVELOPER.md` | Instruções rápidas | IA Developer |
| `docs/clara-ia-maintenance-guide.md` | Guia completo (50+ pgs) | Desenvolvedores |
| Este arquivo (START_HERE.md) | Início rápido | Todos |

---

## 🎯 Próximos Passos

### Para Usuários Finais (ERP)
1. ✅ Acesse http://localhost:5000
2. ✅ Faça login
3. ✅ Use Clara IA no chat
4. ✅ Insira Notas Fiscais Manuais
5. ✅ Veja relatórios no Dashboard

### Para Desenvolvedores/IA Developer
1. ✅ Leia `CHECKLIST_IA_DEVELOPER.md`
2. ✅ Entenda estrutura em `docs/clara-ia-maintenance-guide.md`
3. ✅ Execute `npm run validate` para validar ambiente
4. ✅ Explore código em `server/routes/routes.ts`
5. ✅ Crie novo módulo seguindo padrão

### Para DevOps/Deployment
1. ✅ Configure Docker → `docker-compose.yml`
2. ✅ Setup CI/CD → GitHub Actions
3. ✅ Deploy → Heroku/Railway/VPS
4. ✅ Monitore → Sentry/DataDog
5. ✅ Backup → Automated backups

---

## 🔐 Segurança

### ⚠️ Antes de Publicar (Produção)

- [ ] Altere senha do banco (`viva_user`)
- [ ] Gere novos tokens/secrets
- [ ] Ative HTTPS (Let's Encrypt)
- [ ] Configure firewall
- [ ] Faça backup de dados
- [ ] Teste failover e recovery
- [ ] Documente SLAs
- [ ] Treine time de suporte

### ✅ Ambiente de Produção

```bash
# Build para produção
npm run build

# Rodar em produção (não use 'dev')
npm run start

# Ngrok é apenas para teste. Para produção use um domínio real:
# https://vivafrutaz.com (com SSL)
```

---

## 📞 Suporte Rápido

### Comandos Úteis

```bash
# Verificar código
npm run check

# Build
npm run build

# Desenvolvimento
npm run dev

# Validar ambiente
npm run validate

# Testes E2E
npm run test:e2e

# Abrir Ngrok
npm run tunnel

# Tudo junto (dev + ngrok + teste)
npm run mobile-test

# Ver histórico de testes
npm run test:report

# Banco de dados
npm run db:push                              # Migrações
```

### Logs Importantes

```bash
# Verificar logs (servidor deve estar rodando)
npm run dev              # Mostra todos os logs em tempo real

# Logs do banco
psql -U viva_user -d viva_db -c "\dt"      # Ver tabelas

# Verificar porta
netstat -ano | findstr :5000               # Windows
lsof -i :5000                               # Mac/Linux
```

---

## 🎓 Aprendizado

### Estrutura do Projeto

```
projeto/
├── server/                          # Backend (Express)
│   ├── index.ts                    # Entrada do servidor
│   ├── routes/routes.ts            # APIs Clara IA, NF, etc
│   └── services/                   # Lógica de negócio
│       ├── aiDeveloper.ts          # Clara IA
│       └── storage.ts              # Banco de dados
├── client/                          # Frontend (React)
│   ├── src/App.tsx                 # Router
│   └── pages/
│       ├── test-clara.tsx          # Status page
│       └── admin/
│           ├── clara-training.tsx  # Treinar Clara
│           └── insert-nf-manual.tsx # NF Manual
├── shared/                          # Tipos TypeScript
│   └── schema.ts                   # Schema PostgreSQL
├── tests/                           # Testes
│   └── e2e/clara-erp.spec.ts       # Playwright E2E
├── docs/                            # Documentação
│   └── clara-ia-maintenance-guide.md
├── scripts/                         # Automação
│   └── ngrok-tunnel.js             # Ngrok automation
└── .env                             # Variáveis de ambiente
```

### Como Funciona Clara IA Chat

1. **Usuário escreve:** "Oi Clara"
2. **Frontend envia:** POST `/api/clara/chat` com `{message: "Oi Clara", role: "USER"}`
3. **Backend recebe:** `server/routes/routes.ts`
4. **Clara responde:** `server/services/aiDeveloper.ts` (método `chat()`)
5. **Response vai para:** Frontend, mostra ao usuário

---

## ✅ Checklist de Início

- [ ] Node.js instalado? (`node --version`)
- [ ] PostgreSQL rodando?
- [ ] Arquivo `.env` criado com DATABASE_URL?
- [ ] `npm install` executado?
- [ ] `npm run validate` passou?
- [ ] `npm run dev` iniciou servidor?
- [ ] Consegue acessar http://localhost:5000?
- [ ] Consegue fazer login?
- [ ] Clara IA responde via `/test-clara`?
- [ ] NF Manual carrega em `/admin/insert-nf-manual`?
- [ ] `npm run test:e2e` passa?

**Se todos forem ✅, o sistema está pronto para uso!**

---

## 🎉 Próxima Ação

**Escolha uma opção:**

### A) Apenas Usar o ERP
```bash
npm run dev
# Abra http://localhost:5000
```

### B) Desenvolver/Manter o ERP
```bash
# Leia o guia completo:
less docs/clara-ia-maintenance-guide.md

# Ou veja checklist rápido:
cat CHECKLIST_IA_DEVELOPER.md
```

### C) Testar em Celular
```bash
npm run mobile-test
# Pega link Ngrok e testa em 4G/5G
```

### D) Validar Tudo
```bash
npm run audit && npm run test:e2e
```

---

## 📚 Links Úteils

- **Documentação NodeJS**: https://nodejs.org/docs/
- **Documentação PostgreSQL**: https://www.postgresql.org/docs/
- **Playwright Docs**: https://playwright.dev/
- **Tailwind CSS**: https://tailwindcss.com/docs/
- **React Hooks**: https://react.dev/reference/react/hooks
- **Express.js**: https://expressjs.com/
- **TypeScript**: https://www.typescriptlang.org/docs/

---

## 🤝 Suporte

Se tiver dúvidas:

1. **Leia documentação:** `docs/clara-ia-maintenance-guide.md`
2. **Verifique checklist:** `CHECKLIST_IA_DEVELOPER.md`
3. **Valide ambiente:** `npm run validate`
4. **Veja logs:** `npm run dev` (observe console)
5. **Teste código:** `npm run check` (TypeScript errors)

---

**Última atualização**: 20 de Março de 2026  
**Status**: ✅ OPERACIONAL  
**Suporte**: Veja documentação em `docs/`

---

## 🚀 BOA SORTE E DIVIRTA-SE! 🎉

Agora execute:
```bash
npm run dev
```

E acesse http://localhost:5000! Clara IA está esperando você! 💬
