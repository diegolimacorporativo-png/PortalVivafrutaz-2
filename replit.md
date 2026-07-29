# VivafrutaZ ERP + Clara IA

Sistema completo de gestão empresarial para fruticulturas com assistente de IA integrada (Clara IA).

## Stack

- **Backend**: Node.js 20 + TypeScript + Express 5
- **Frontend**: React + Vite + Tailwind CSS + shadcn/ui
- **Database**: PostgreSQL 17 via Supabase (Drizzle ORM)
- **Auth**: Passport.js (local strategy) + express-session

## Como Rodar

```bash
npm run dev
```

Acesse em: `https://<repl>.replit.dev` (porta 5000)

## Secrets Obrigatórios

| Secret | Descrição |
|--------|-----------|
| `SUPABASE_DATABASE_URL` | URL de conexão Supabase (obrigatório — sem ele o servidor não inicia) |
| `SESSION_SECRET` | Chave de sessão |

## Secrets Opcionais

| Secret | Descrição |
|--------|-----------|
| `OPENAI_API_KEY` | Habilita Clara IA (assistente de chat) |
| `ITAU_CLIENT_ID` / `ITAU_CLIENT_SECRET` | Integração bancária Itaú |
| `NFE_CERT_BASE64` / `NFE_CERT_PASSWORD` | Certificado digital A1 para NF-e (modo padrão: `mock`) |
| `GOOGLE_MAPS_API_KEY` | Mapas na logística |

## Database Connection (verificado 2026-07-29)

- PostgreSQL 17.6 (Supabase — `aws-1-us-east-1`)
- Database: `postgres`
- Tabelas: 106  |  Usuários: 6  |  Empresas: 7  |  Pedidos: 21

## Módulos Principais

- `/api/v1/auth` — autenticação
- `/api/v1/orders` / `/api/v2/orders` — pedidos
- `/api/v1/companies` — empresas/clientes
- `/api/v1/inventory` — estoque
- `/api/v1/fiscal` — NF-e / SEFAZ (modo mock por padrão)
- `/api/v1/logistics` — logística / despacho
- `/api/v1/finance` — financeiro / boletos
- `/api/v1/products` — produtos / categorias

## User Preferences

- Sempre usar `SUPABASE_DATABASE_URL` como fonte da conexão PostgreSQL — nunca criar um novo banco Replit.
- Não resetar, migrar ou re-semear o banco de dados em produção sem confirmação explícita.
