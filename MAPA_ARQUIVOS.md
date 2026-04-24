# 🗂️ MAPA DE ARQUIVOS - GUIA VISUAL

**Navegação rápida pelos arquivos mais importantes do projeto**

---

## 📚 Comece Por Aqui 👇

### 1️⃣ Primeira Coisa (5 minutos)
```
START_HERE.md ⭐ LEIA PRIMEIRO
│
├─ O que é o sistema?
├─ Como instalar em 3 passos
├─ Como usar Clara IA
├─ Como testar tudo
└─ Resolver problemas
```

**Ação**: Abra [START_HERE.md](START_HERE.md) agora

---

### 2️⃣ Segunda Coisa (10 minutos)
```
CHECKLIST_IA_DEVELOPER.md ⭐ SE FOR MANTER O SISTEMA
│
├─ Pre-flight checks
├─ Como rodar servidor
├─ Como abrir Ngrok
├─ Como fazer testes
└─ Monitoramento
```

**Ação**: Abra [CHECKLIST_IA_DEVELOPER.md](CHECKLIST_IA_DEVELOPER.md)

---

### 3️⃣ Terceira Coisa (15 minutos)
```
RELATORIO_FINAL.md ⭐ RESUMO EXECUTIVO
│
├─ O que foi feito
├─ Erros corrigidos
├─ Funcionalidades adicionadas
├─ URLs de acesso
└─ Scripts disponíveis
```

**Ação**: Abra [RELATORIO_FINAL.md](RELATORIO_FINAL.md)

---

## 📂 Estrutura Completa do Projeto

```
projeto/
│
├─ 📚 DOCUMENTAÇÃO (Leia primeiro)
│  ├─ START_HERE.md ⭐ Início em 5 min
│  ├─ CHECKLIST_IA_DEVELOPER.md ⭐ Para devs
│  ├─ RELATORIO_FINAL.md ⭐ Resumo executivo
│  ├─ DASHBOARD_STATUS.md 📊 Status atual
│  ├─ DOCUMENTACAO_INDICE.md 📚 Índice central
│  ├─ RESUMO_TECNICO.md 🔧 Técnico detalhado
│  ├─ APRESENTACAO_EXECUTIVA.md 📊 Slides
│  ├─ README.md 🏠 Homepage
│  └─ este arquivo (MAPA_ARQUIVOS.md)
│
├─ 📁 server/ (Backend - Node.js/Express)
│  ├─ index.ts ⭐ SERVIDOR PRINCIPAL
│  │  └─ Escuta em 0.0.0.0:5000
│  │
│  ├─ routes/
│  │  └─ routes.ts ⭐ TODAS AS ROTAS API
│  │     ├─ POST /api/clara/chat
│  │     ├─ GET/POST/PUT/DELETE /api/clara-training
│  │     ├─ POST /api/nf-manual
│  │     ├─ GET /api/clara/export
│  │     └─ [35+ endpoints]
│  │
│  ├─ services/
│  │  ├─ aiDeveloper.ts 🤖 CLARA IA
│  │  │  ├─ chat(message, role)
│  │  │  ├─ runTest(testName)
│  │  │  └─ Memory integration
│  │  │
│  │  ├─ storage.ts 💾 DATABASE CRUD
│  │  │  ├─ getClaraTrainings()
│  │  │  ├─ createClaraTraining()
│  │  │  ├─ updateClaraTraining()
│  │  │  └─ deleteClaraTraining()
│  │  │
│  │  ├─ mailer.ts 📧 EMAILS
│  │  ├─ pushService.ts 📱 PUSH NOTIFICATIONS
│  │  ├─ autoLearningModule.ts 🧠 AUTO-LEARNING
│  │  └─ memoryModule.ts 🧠 MEMORY
│  │
│  ├─ database/
│  │  └─ db.ts 🔌 CONNECTION POOL
│  │
│  └─ backup.ts 🔄 BACKUP AUTOMÁTICO
│
├─ 📁 client/ (Frontend - React)
│  └─ src/
│     ├─ App.tsx ⭐ ROUTER PRINCIPAL
│     │  ├─ Route /test-clara
│     │  ├─ Route /admin/clara-training
│     │  ├─ Route /admin/insert-nf-manual
│     │  ├─ Route /admin/dashboard
│     │  └─ [todas 30+ rotas]
│     │
│     ├─ pages/ (Páginas)
│     │  ├─ test-clara.tsx ⭐ STATUS PAGE CLARA IA
│     │  │  └─ Exibe status, versão, funções
│     │  │
│     │  ├─ admin/
│     │  │  ├─ insert-nf-manual.tsx ⭐ FORMULÁRIO NF
│     │  │  │  └─ Campos: número, data, cliente, produtos, impostos
│     │  │  │
│     │  │  ├─ clara-training.tsx 📚 TREINAR CLARA
│     │  │  │  └─ Q&A manager
│     │  │  │
│     │  │  ├─ dashboard.tsx 📊 DASHBOARD
│     │  │  ├─ client-incidents.tsx 🚨 INCIDENTS
│     │  │  ├─ orders.tsx 📦 PEDIDOS
│     │  │  └─ [+ 5 páginas admin]
│     │  │
│     │  └─ [outras rotas]
│     │
│     ├─ components/ (Componentes React)
│     │  ├─ Layout.tsx 🏗️ LAYOUT PRINCIPAL
│     │  ├─ VirtualAssistant.tsx 🤖 CLARA IA CHAT UI
│     │  ├─ ContextualTip.tsx 💡 DICAS
│     │  ├─ Card.tsx 🎨 CARD COMPONENT
│     │  └─ [+ 20 componentes]
│     │
│     ├─ hooks/ (React Hooks)
│     │  ├─ use-push-notifications.ts 📱 NOTIFICAÇÕES
│     │  └─ [+ 5 custom hooks]
│     │
│     ├─ lib/
│     │  ├─ queryClient.ts 🔄 REACT QUERY
│     │  └─ api.ts 🌐 API CALLS
│     │
│     └─ styles/ (CSS/Tailwind)
│        └─ globals.css 🎨 ESTILOS GLOBAIS
│
├─ 📁 shared/ (Tipos & Schema)
│  └─ schema.ts ⭐ DATABASE SCHEMA
│     ├─ clara_training table
│     │  └─ id, question, answer, userId, userName, active, createdAt, updatedAt
│     │
│     ├─ nf_manual table
│     │  └─ number, date, client, products, taxes, observations
│     │
│     ├─ users table
│     ├─ orders table
│     ├─ products table
│     ├─ incidents table
│     ├─ contracts table
│     └─ [+ 13 tabelas]
│
├─ 📁 tests/ (Testes)
│  └─ e2e/
│     └─ clara-erp.spec.ts ⭐ PLAYWRIGHT E2E TESTS
│        ├─ Desktop tests
│        ├─ Mobile iPhone tests
│        ├─ Mobile Android tests
│        └─ 15 testes total
│
├─ 📁 scripts/ (Scripts de Automação)
│  ├─ ngrok-tunnel.js 🌐 NGROK AUTOMATION
│  │  └─ Abre túnel HTTPS público
│  │
│  └─ build.ts 🔨 BUILD SCRIPT
│
├─ 📁 docs/ (Documentação Técnica)
│  └─ clara-ia-maintenance-guide.md ⭐ GUIA COMPLETO (50+ pgs)
│     ├─ Arquitetura do sistema
│     ├─ Clara IA implementation
│     ├─ Database schema
│     ├─ Common errors & fixes
│     ├─ Como criar módulos
│     ├─ Testing procedures
│     ├─ Deployment
│     └─ Troubleshooting
│
├─ 🔧 CONFIGURAÇÃO
│  ├─ .env (Template)
│  │  ├─ DATABASE_URL
│  │  ├─ PORT
│  │  └─ NODE_ENV
│  │
│  ├─ package.json ⭐ NPM SCRIPTS & DEPENDÊNCIAS
│  │  ├─ "dev" - Servidor
│  │  ├─ "build" - Build
│  │  ├─ "check" - TypeScript check
│  │  ├─ "validate" - Environment validation
│  │  ├─ "tunnel" - Ngrok
│  │  ├─ "test:e2e" - Testes
│  │  ├─ "mobile-test" - Tudo junto
│  │  └─ [13 scripts total]
│  │
│  ├─ tsconfig.json (TypeScript config)
│  ├─ drizzle.config.ts (Database ORM)
│  ├─ vite.config.ts (Frontend bundler)
│  ├─ playwright.config.ts (E2E testing)
│  ├─ docker-compose.yml (Containers)
│  ├─ Dockerfile (Docker image)
│  ├─ ecosystem.config.js (PM2 config)
│  ├─ tailwind.config.ts (CSS framework)
│  ├─ postcss.config.js (CSS processing)
│  └─ .gitignore (Git ignore)
│
├─ 📊 RELATÓRIOS
│  ├─ IMPORTS_ANALYSIS.json (Análise de imports)
│  ├─ ANALISE_IMPORTS_COMPLETA.md (Análise completa)
│  └─ [backup análises anteriores]
│
├─ 📦 SISTEMA
│  ├─ node_modules/ (Dependências npm)
│  ├─ dist/ (Build output)
│  ├─ .git/ (Git repository)
│  ├─ migrations/ (Database migrations)
│  ├─ logs/ (System logs)
│  └─ backups/ (Database backups)
│
└─ 📄 DIVERSOS
   ├─ package-lock.json (npm lock file)
   ├─ cookie.txt (Auth cookies)
   ├─ deploy.sh (Deploy script)
   └─ attached_assets/ (Attachments)
```

---

## 🎯 Arquivos por Funcionalidade

### 🤖 Clara IA Chat

```
Frontend
├─ client/src/pages/test-clara.tsx ⭐ UI
├─ client/src/components/VirtualAssistant.tsx (Chat widget)
└─ client/src/hooks/use-push-notifications.ts

Backend
├─ server/routes/routes.ts (POST /api/clara/chat)
├─ server/services/aiDeveloper.ts (Logic)
└─ shared/schema.ts (Types)

Database
└─ shared/schema.ts (clara_training table)
```

### 📚 Clara IA Training

```
Frontend
├─ client/src/pages/admin/clara-training.tsx ⭐ UI
└─ client/src/App.tsx (Route setup)

Backend
├─ server/routes/routes.ts (CRUD endpoints)
├─ server/services/storage.ts (CRUD logic)
└─ server/services/aiDeveloper.ts (Training logic)

Database
└─ shared/schema.ts (clara_training table)
```

### 📄 NF Manual

```
Frontend
├─ client/src/pages/admin/insert-nf-manual.tsx ⭐ FORM
└─ client/src/App.tsx (Route)

Backend
├─ server/routes/routes.ts (POST /api/nf-manual)
└─ server/services/storage.ts (Database insert)

Database
└─ shared/schema.ts (nf_manual table)
```

### 🌐 Acesso Externo

```
Configuration
├─ server/index.ts (host: "0.0.0.0")
├─ .env (PORT=5000)
└─ scripts/ngrok-tunnel.js (HTTPS via Ngrok)

Scripts
├─ package.json ("tunnel" script)
└─ npm run tunnel (Execute)
```

### 🧪 Testes

```
Tests
└─ tests/e2e/clara-erp.spec.ts ⭐ All tests

Run
├─ npm run test:e2e (All)
├─ npm run test:e2e:mobile (Mobile)
├─ npm run test:e2e:debug (Debug)
└─ npm run test:report (View results)
```

### ✅ Validação & Deploy

```
Validate
├─ validate.ps1 (Windows)
├─ validate.sh (Linux/Mac)
└─ npm run validate (Execute)

Build
├─ npm run build (Production build)
├─ npm run start (Run production)
└─ docker-compose.yml (Docker)
```

---

## 🔍 Encontrando Arquivos por Tarefa

### "Preciso de documentação" 📚
```
START_HERE.md                    ← Início rápido
CHECKLIST_IA_DEVELOPER.md        ← Operação
docs/clara-ia-maintenance-guide  ← Técnico
README.md                        ← Overview
DASHBOARD_STATUS.md              ← Status atual
DOCUMENTACAO_INDICE.md           ← Índice
```

### "Preciso arrumar um erro" 🐛
```
1. Identifique arquivo:
   grep-search no workspace

2. Estude padrão similar:
   client/src/pages/admin/insert-nf-manual.tsx

3. Implemente fix:
   replace_string_in_file

4. Teste:
   npm run check
   npm run test:e2e
```

### "Preciso criar novo módulo" 🆕
```
1. Banco: shared/schema.ts
   └─ Adicione tabela

2. API: server/routes/routes.ts
   └─ Adicione endpoints

3. Frontend: client/src/pages/admin/
   └─ Crie componente

4. Teste: tests/e2e/clara-erp.spec.ts
   └─ Adicione testes

Guia: docs/clara-ia-maintenance-guide.md
```

### "Preciso deployar" 🚀
```
1. Validar:
   npm run validate

2. Build:
   npm run build

3. Config:
   .env (production)
   docker-compose.yml

4. Deploy:
   Docker, Heroku, ou VPS
```

### "Preciso testar em celular" 📱
```
1. Abrir Ngrok:
   npm run tunnel
   
2. Link público:
   https://abc123.ngrok.io

3. Abrir celular:
   4G/5G em outro dispositivo

4. Testar:
   /test-clara
   /admin/insert-nf-manual
```

---

## 📊 Arquivos por Tamanho/Importância

### ⭐⭐⭐ CRÍTICOS (Nunca mexer sem razão)
```
server/index.ts                         Main server
server/routes/routes.ts                 All routes
shared/schema.ts                        Database schema
client/src/App.tsx                      Router
package.json                            Dependencies & scripts
```

### ⭐⭐ IMPORTANTES (Leia antes de mexer)
```
server/services/aiDeveloper.ts          Clara IA logic
server/services/storage.ts              Database CRUD
client/src/pages/test-clara.tsx         Status UI
client/src/pages/admin/insert-nf-manual.tsx  NF Form
```

### ⭐ CONVENIENTES (Referência)
```
docs/clara-ia-maintenance-guide.md      Learning
CHECKLIST_IA_DEVELOPER.md               Operations
tests/e2e/clara-erp.spec.ts             Test examples
```

### ℹ️ SUPORTE (Consulte quando necessário)
```
README.md                               Quick reference
RELATORIO_FINAL.md                      What was done
DASHBOARD_STATUS.md                     Current status
```

---

## 🔗 Referência Cruzada

### Se estiver em `server/routes/routes.ts`
```
Veja também:
├─ server/services/aiDeveloper.ts (Clara logic)
├─ server/services/storage.ts (Database)
├─ shared/schema.ts (Types)
└─ tests/e2e/clara-erp.spec.ts (Tests)
```

### Se estiver em `client/src/App.tsx`
```
Veja também:
├─ client/src/pages/ (All pages)
├─ client/src/components/ (Ui components)
└─ client/src/lib/queryClient.ts (API setup)
```

### Se estiver em `shared/schema.ts`
```
Veja também:
├─ server/services/storage.ts (CRUD)
├─ server/routes/routes.ts (Endpoints)
└─ drizzle.config.ts (ORM config)
```

---

## 🎯 Começando Agora

```
1. Leia:
   START_HERE.md (5 min)

2. Execute:
   npm run validate

3. Rode:
   npm run dev

4. Abra:
   http://localhost:5000

5. Teste Clara:
   /test-clara

6. Teste NF Manual:
   /admin/insert-nf-manual

7. Celebre:
   🎉 Funciona tudo!
```

---

**Este mapa foi criado para ajudar você a navegar o projeto com facilidade.**

**Próxima ação:** Abra [START_HERE.md](START_HERE.md)

---

*Mapa de Arquivos - VivafrutaZ ERP + Clara IA v1.0*  
*Última atualização: 20 Março 2026*
