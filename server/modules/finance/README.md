# Finance Module

Domain: receivables, payables, cashflow, PIX issuance, financial dashboard.

## Layers

```
finance.routes.ts        → HTTP wiring (path + middleware + handler)
finance.controller.ts    → req/res adapter, no business logic
finance.service.ts       → business rules, orchestration, pure helpers (PIX)
finance.repository.ts    → all DB / storage access
finance.validation.ts    → Zod schemas (extend the shared insert schemas)
finance.types.ts         → public types & DTOs
index.ts                 → module definition consumed by the loader
```

## Endpoints (all under `/api/finance`)

| Method | Path                                  | Purpose                     |
| ------ | ------------------------------------- | --------------------------- |
| GET    | `/dashboard`                          | KPIs                        |
| GET    | `/accounts-receivable`                | List (filter: status, companyId) |
| POST   | `/accounts-receivable`                | Create (auto-PIX)           |
| PATCH  | `/accounts-receivable/:id`            | Update                      |
| PATCH  | `/accounts-receivable/:id/pay`        | Mark paid                   |
| DELETE | `/accounts-receivable/:id`            | Remove                      |
| GET    | `/accounts-payable`                   | List                        |
| POST   | `/accounts-payable`                   | Create                      |
| PATCH  | `/accounts-payable/:id`               | Update                      |
| PATCH  | `/accounts-payable/:id/pay`           | Mark paid                   |
| DELETE | `/accounts-payable/:id`               | Remove                      |
| GET    | `/cashflow`                           | List (filter: from/to)      |
| POST   | `/cashflow`                           | Manual entry                |
| GET    | `/pix/:id`                            | Get PIX payload for AR      |

## Response shape

All endpoints emit the standard envelope:

```json
{ "success": true,  "data":  { ... } }
{ "success": false, "error": { "message": "...", "code": "..." } }
```

## Migration status

- ✅ Routes migrated from legacy `server/routes/routes.ts` (lines 6587–6759).
- 🔜 The repository still delegates to `services/storage.ts`. When storage is
  split per domain, replace each repo method with direct Drizzle queries.
