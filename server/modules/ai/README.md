# AI Module — `STUB` (isolated)

## Scope when implemented
- Clara IA assistant, AI developer agent, auto-learning, memory module
- All experimental / generative-AI features kept ISOLATED here so they can
  evolve without touching the ERP core.

## What to migrate
- `server/services/aiDeveloper/` and `aiDeveloper.ts`
- `server/services/autoLearningModule.ts`, `memoryModule.ts`
- All `/api/ai/*`, `/api/clara/*`, `/api/developer/*` routes from `routes.ts`

## Files to create
Same layered layout as `finance/`. Keep model/provider clients behind the
repository so swapping vendors is a one-file change.
