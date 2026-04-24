# 📘 Clara IA Developer - Guia Completo de Manutenção ERP

> **Objetivo**: Ensinar a IA Developer a auditar, atualizar, testar e manter o ERP VivaFrutaz com Clara IA de forma totalmente independente e automatizada.

---

## 📋 Índice

1. [Arquitetura do Sistema](#arquitetura)
2. [Processo de Auditoria](#auditoria)
3. [Criação de Novos Módulos](#novos-módulos)
4. [Correção de Bugs](#correção-bugs)
5. [Testes Automatizados](#testes)
6. [Acesso Externo com Ngrok](#ngrok)
7. [Deployment e Segurança](#deployment)
8. [Troubleshooting](#troubleshooting)

---

## <a id="arquitetura"></a>🏗️ Arquitetura do Sistema

### Backend
```
server/
├── index.ts                    # Entrada principal (host 0.0.0.0, porta 5000)
├── routes/routes.ts           # APIs: Clara Chat, Training, Export, NF Manual
├── services/
│   ├── storage.ts             # CRUD do banco (clara_training, users, etc)
│   ├── aiDeveloper.ts         # Clara IA (chat, teste, aprendizado)
│   ├── mailer.ts              # Email
│   ├── pushService.ts         # Push notifications (clara_task, clara_alert)
│   └── backup.ts              # Backup automático
├── database/
│   └── db.ts                  # Conexão Drizzle + Postgres
└── controllers/

```

### Frontend
```
client/src/
├── App.tsx                    # Rotas (test-clara, admin/clara-training, etc)
├── components/
│   ├── Layout.tsx             # Menu + sidebar (onAskClara)
│   ├── VirtualAssistant.tsx   # Chat visual da Clara
│   ├── TrainingMode.tsx       # Tutorial do sistema
│   └── ContextualTip.tsx      # Dicas flutuantes
├── pages/
│   ├── test-clara.tsx         # Status da Clara IA
│   ├── admin/
│   │   ├── clara-training.tsx # Treinar Clara (perguntas/respostas)
│   │   ├── insert-nf-manual.tsx # Inserir Nota Fiscal Manual
│   │   └── ...outros
│   └── client/
└── lib/
    ├── queryClient.ts         # API requests
    └── incident-pdf-generator.ts
```

### Database
```
Tabelas principais:
- users              (admin, cliente normal, cliente liberado)
- clara_training     (perguntas/respostas para treinar a IA)
- orders             (pedidos do ERP)
- products           (produtos)
- companies          (clientes/fornecedores)
- nf_manual          (notas fiscais inseridas manualmente)
- system_logs        (auditoria de ações)
```

---

## <a id="auditoria"></a>🔍 Processo de Auditoria Automática

### 1. Checklist de compilação
```bash
# Verificar erros TypeScript
npm run check

# Esperado: zero erros TS2xxx
```

**Se houver erro:**
1. Ler mensagem: `client/src/path: error TS2xxx: Mensagem`
2. Abrir arquivo em `src/path` linha indicada
3. Checar tipo: interface/type mismatch, import missing, null handling
4. Resolver (exemplos abaixo)

### 2. Validar imports críticos

```bash
# Grep para encontrar imports quebrados
grep -r "Cannot find module" . --include="*.ts" --include="*.tsx"
grep -r "from ['\"]\.\/[a-z]*['\"]" server/ --include="*.ts"  # imports relativos suspeitos

# Patterns esperados (CORRETOS):
# ✅ import { db } from "../database/db"
# ✅ import { sendEmail } from "../services/mailer"
# ❌ import { db } from "./db"             (caminho curto)
# ❌ import { mailer } from "./mailer"    (arquivo no diretório errado)
```

### 3. Validar nomes Clara IA

```bash
# Verificar se "Flora" ainda existe (deve estar 100% Clara)
grep -ri "flora" . --include="*.ts" --include="*.tsx" --include="*.json" \
  --exclude-dir=node_modules --exclude-dir=.git

# Esperado: ZERO ocorrências de "Flora" (case insensitive)
# Se encontrar, aplicar: sed -i 's/[Ff]lora/Clara/g' arquivo.ts
```

### 4. Validar permissões de usuário

Verificar em `server/routes/routes.ts` rota `/api/clara/chat`:

```typescript
// CORRETO:
if (user.role === 'USER') {
  // chat limitado (respostas base, sem análise de risco)
  return basicResponse;
} else if (['ADMIN', 'DIRECTOR', 'MASTER'].includes(user.role)) {
  // chat livre (todas perguntas)
  return aiResponse;
}

// ERRADO:
if (!user.role) { ... }  // falta validação
```

### 5. Validar schema e banco

```bash
# Entrar no banco PostgreSQL
psql -U viva_user -d viva_db

# Verificar tabelas principais
\dt

# Verificar schema clara_training
\d clara_training

# Esperado:
# Column         | Type
# question       | text
# answer         | text
# active         | boolean
# created_at     | timestamp
```

---

## <a id="novos-módulos"></a>✨ Padrão: Criação de Novo Módulo

**Exemplo: Criar "Consultar Clima por Cidade"**

### Passo 1: Database + Schema

```typescript
// shared/schema.ts
export const weatherQueries = pgTable("weather_queries", {
  id: serial("id").primaryKey(),
  city: text("city").notNull(),
  temperature: numeric("temperature"),
  condition: text("condition"),  // sunny, rainy, cloudy
  userId: integer("user_id"),
  createdAt: timestamp("created_at").defaultNow(),
});

export type WeatherQuery = typeof weatherQueries.$inferSelect;
export type InsertWeatherQuery = z.infer<typeof insertWeatherQuerySchema>;
```

### Passo 2: Storage (CRUD)

```typescript
// server/services/storage.ts
async getWeatherQueries(): Promise<WeatherQuery[]> {
  return db.select().from(weatherQueries).limit(100);
}

async createWeatherQuery(data: InsertWeatherQuery): Promise<WeatherQuery> {
  const [result] = await db.insert(weatherQueries).values(data).returning();
  return result;
}
```

### Passo 3: API Routes

```typescript
// server/routes/routes.ts
app.get('/api/weather-queries', async (req: any, res) => {
  try {
    const userId = req.session?.userId;
    if (!userId) return res.status(401).json({ message: 'Não autenticado' });
    
    const queries = await storage.getWeatherQueries();
    res.json({ data: queries });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
});

app.post('/api/weather-query', async (req: any, res) => {
  try {
    const userId = req.session?.userId;
    const { city } = req.body;
    
    // Validação
    if (!city || city.trim().length < 2) {
      return res.status(400).json({ message: 'Cidade inválida' });
    }
    
    const result = await storage.createWeatherQuery({ 
      city: city.trim(), 
      userId 
    });
    res.json({ success: true, data: result });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
});
```

### Passo 4: Frontend Page + Form

```typescript
// client/src/pages/admin/weather.tsx
import { useMutation, useQuery } from '@tanstack/react-query';
import { apiRequest } from '@/lib/queryClient';

export default function WeatherPage() {
  const [city, setCity] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const { data: queries } = useQuery({
    queryKey: ['/api/weather-queries'],
    queryFn: async () => {
      const res = await apiRequest('GET', '/api/weather-queries');
      return res.json();
    },
  });

  const mutation = useMutation({
    mutationFn: async (data: any) => {
      return apiRequest('POST', '/api/weather-query', data);
    },
    onSuccess: () => {
      setSuccess('Consulta registrada!');
      setCity('');
    },
    onError: (err: any) => {
      setError(err.message);
    },
  });

  return (
    <div className="p-4 bg-white rounded-lg shadow">
      <h1>Consultar Clima</h1>
      
      <input
        type="text"
        value={city}
        onChange={(e) => setCity(e.target.value)}
        placeholder="Digite a cidade"
        required
        className="border p-2 rounded w-full mb-2"
      />
      
      <button
        onClick={() => mutation.mutate({ city })}
        disabled={mutation.isPending}
        className="bg-blue-600 text-white px-4 py-2 rounded"
      >
        Consultar
      </button>

      {error && <p className="text-red-600">{error}</p>}
      {success && <p className="text-green-600">{success}</p>}

      <div className="mt-4">
        {queries?.data?.map((q: any) => (
          <div key={q.id} className="p-2 border-b">
            {q.city}: {q.condition} ({q.temperature}°C)
          </div>
        ))}
      </div>
    </div>
  );
}
```

### Passo 5: Integrar no App Routes

```typescript
// client/src/App.tsx
import WeatherPage from "@/pages/admin/weather";

<Route path="/admin/weather">
  {() => <ProtectedRoute 
    component={WeatherPage} 
    role="admin" 
    allowedRoles={['ADMIN', 'DIRECTOR']} 
    tabKey="weather" 
  />}
</Route>
```

### Passo 6: Adicionar ao Menu Layout

```typescript
// client/src/components/Layout.tsx
{ href: '/admin/weather', label: 'Clima', icon: Cloud, roles: ['ADMIN', 'DIRECTOR'], tabKey: 'weather', category: 'Operação' },
```

### Passo 7: Testes

```bash
# Validar TypeScript
npm run check

# Testar API
curl -X POST http://localhost:5000/api/weather-query \
  -H "Content-Type: application/json" \
  -d '{"city": "São Paulo"}'

# Esperado: { success: true, data: {...} }
```

---

## <a id="correção-bugs"></a>🐛 Fluxo: Detectar e Corrigir Bugs

### Cenário 1: TypeScript error

```
error TS2322: Type 'string' is not assignable to type 'number'
  client/src/pages/admin/weather.tsx:45:10
```

**Solução:**
1. Abrir arquivo `client/src/pages/admin/weather.tsx` linha 45
2. Encontrar o código (ex: `const temp = city;`)
3. Corrigir tipo:
   ```typescript
   const temp: number = parseInt(city); // conversão
   // ou
   const temp = Number(city); // mais seguro
   ```
4. Rodar `npm run check` para validar

### Cenário 2: Runtime error (API 500)

```
POST http://localhost:5000/api/weather-query → 500 Internal Server Error
```

**Solução:**
1. Verificar logs do servidor:
   ```
   [servidor rodando com ts-node]
   Error: Cannot read property 'trim' of undefined
   ```
2. Encontrar linha em `server/routes/routes.ts` onde erro ocorre
3. Adicionar validação:
   ```typescript
   if (!city || typeof city !== 'string') {
     return res.status(400).json({ message: 'Cidade deve ser texto' });
   }
   ```
4. Re-testar API

### Cenário 3: Componente não renderiza

**Solução:**
1. Abrir DevTools do navegador (F12)
2. Verificar Console para erros JS
3. Se error `Cannot find module`:
   - Verifique import path (relativo vs absoluto)
   - VS Code: `Ctrl+Click` no import para validar

### Cenário 4: Banco não insere dados

```
// Em storage.ts, isso pode falhar:
const [result] = await db.insert(weatherQueries).values(data).returning();
```

**Solução:**
1. Verificar se dados são válidos (tipos, NOT NULL)
2. Adicionar try/catch:
   ```typescript
   try {
     const [result] = await db.insert(weatherQueries).values(data).returning();
     return result;
   } catch (err) {
     console.error('DB Insert Error:', err);
     throw new Error('Não foi possível inserir dados');
   }
   ```
3. Testar query SQL direto:
   ```sql
   INSERT INTO weather_queries (city, user_id) VALUES ('São Paulo', 1);
   ```

---

## <a id="testes"></a>✅ Suite de Testes Automatizados

### Opção 1: Playwright (E2E completo)

```bash
# Instalar
npm install -D @playwright/test

# Rodar testes
npx playwright test tests/e2e/clara-erp.spec.ts

# Modo watch (re-rodar ao mudar código)
npx playwright test --watch

# Relatório
npx playwright show-report
```

**Exemplo de teste:**
```typescript
test('criar nova consulta de clima', async ({ page }) => {
  await page.goto('http://localhost:5000/admin/weather');
  
  await page.fill('input[placeholder="Digite a cidade"]', 'Rio de Janeiro');
  await page.click('button:has-text("Consultar")');
  
  await expect(page.locator('text=Consulta registrada!')).toBeVisible();
});
```

### Opção 2: API Testing (curl)

```bash
# Listar consultasClimate
curl -X GET http://localhost:5000/api/weather-queries

# Criar consulta
curl -X POST http://localhost:5000/api/weather-query \
  -H "Content-Type: application/json" \
  -d '{"city": "Brasília"}'

# Esperado: HTTP 200
```

### Opção 3: Unit Tests (Jest)

```typescript
// services/__tests__/storage.test.ts
import { storage } from '../storage';

describe('Storage - Weather', () => {
  test('criar weather query', async () => {
    const result = await storage.createWeatherQuery({
      city: 'Manaus',
      userId: 1,
    });
    
    expect(result.id).toBeDefined();
    expect(result.city).toBe('Manaus');
  });
});
```

---

## <a id="ngrok"></a>🌐 Acesso Externo com Ngrok

### Abrir túnel público

```bash
# Opção 1: Script automatizado (recomendado)
node scripts/ngrok-tunnel.js

# Opção 2: Comando direto
npx ngrok http 5000

# Opção 3: Com authtoken
ngrok authtoken <seu-token>
ngrok http 5000 --region sa
```

### Resultado esperado

```
Session Status   online
Account          usuario@email.com
Version          3.0.0
Region           South America (sa)
Forwarding       https://abc123def456.ngrok.io -> http://localhost:5000
```

### Testar no celular

1. Copiar link: `https://abc123def456.ngrok.io`
2. No celular, abrir navegador e acessar: `https://abc123def456.ngrok.io/test-clara`
3. Validar:
   - Clara IA status visível
   - Chat respondendo
   - NF Manual carregando

### Segurança

- ⚠️ Link Ngrok é **público** — qualquer pessoa pode acessar
- Use **autenticação** no ERP (login requerido)
- **Nunca** compartilhe token Ngrok
- Para produção, use domínio próprio + certficado SSL (+  nginx/Cloudflare)

---

## <a id="deployment"></a>🚀 Deployment e Segurança

### Pre-checklist antes de deploy

```bash
# 1. Validar TypeScript
npm run check

# 2. Validar builds
npm run build

# 3. Rodar testes
npm run test

# 4. Verificar variáveis de ambiente
echo $DATABASE_URL
echo $PORT

# 5. Verificar banco
psql -U viva_user -d viva_db -c "SELECT 1"

# 6. Iniciar servidor
npx tsx server/index.ts

# 7. Testar local
curl http://localhost:5000/test-clara
```

### Variáveis de ambiente (`.env`)

```
DATABASE_URL=postgres://viva_user:SenhaForte123@localhost:5432/viva_db
PORT=5000
NODE_ENV=production
SESSION_SECRET=seu-secret-aleatorio-aqui
VAPID_PUBLIC_KEY=sua-chave-push-web
VAPID_PRIVATE_KEY=sua-chave-privada
```

### Segurança em produção

- [ ] Alterar senha padrão `viva_user`
- [ ] Usar HTTPS (certificado Let's Encrypt)
- [ ] Ativar autenticação 2FA para admins
- [ ] Implementar rate limiting nas APIs
- [ ] Fazer backup diário do banco
- [ ] Monitorar logs de erro
- [ ] Usar VPN para ngrok/remote access

---

## <a id="troubleshooting"></a>🔧 Troubleshooting

### "Cannot find module './db'"

**Causa**: Import com path relativo incompleto
**Solução**:
```typescript
// ❌ ERRADO
import { db } from "./db";

// ✅ CORRETO
import { db } from "../database/db";
```

---

### "TypeError: Cannot read property 'role' of undefined"

**Causa**: Usuário não autenticado na sessão
**Solução**:
```typescript
const user = await storage.getUser(userId);
if (!user) {
  return res.status(401).json({ message: 'Não autenticado' });
}
// Agora user.role é seguro
```

---

### "ECONNREFUSED: Connection refused"

**Causa**: Servidor não está rodando ou banco offline
**Solução**:
```bash
# Verificar se servidor está rodando
lsof -i :5000

# Verificar se Postgres está rodando
psql -U viva_user -d viva_db -c "SELECT 1"

# Se não, reiniciar:
npx tsx server/index.ts
```

---

### "Ngrok ERR_NGROK_317"

**Causa**: Conta Ngrok inválida ou ausente
**Solução**:
```bash
# Criar conta em https://dashboard.ngrok.com/signup
# Copiar authtoken
ngrok config add-authtoken <token>
ngrok http 5000
```

---

## 📞 Resumo: Fluxo Diário da IA Developer

```
1. Rodar: npm run check
   ↓
2. Se erro TS → Corrigir import/tipo
   ↓
3. Rodar: npx tsx server/index.ts
   ↓
4. Testar: http://localhost:5000/test-clara
   ↓
5. Se problema → Verificar logs + API + DB
   ↓
6. Criar novo módulo?
   → Seguir padrão: DB + Storage + Routes + Frontend + Testes
   ↓
7. Deploy:
   → npm run check + build + test
   → ngrok ou domínio
   → Testar em mobile
   → Monitorar logs
```

---

**Last Updated**: 2026-03-20  
**Version**: 1.0  
**Mantainer**: IA Developer  
