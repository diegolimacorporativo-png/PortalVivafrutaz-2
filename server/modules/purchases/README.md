# Purchases Module — `STUB`

## Scope when implemented
- Purchase orders, suppliers, purchase planning, fiscal invoice import (NF-e)

## What to migrate from `server/routes/routes.ts`
- All `/api/compras/*`, `/api/purchase-planning/*`, `/api/suppliers/*` routes
- Server services under `server/services/nfe/` (issuance + import)

## Files to create
Same layered layout as `finance/`.
