/**
 * FASE 8.4.3 — Bridge: registra o regression guard
 * `tests/regression/billing-nfe-equivalence.test.ts` no glob padrão de
 * `npm run test` (`tests/unit/*.test.ts`) sem precisar mexer em
 * `package.json`. O `node:test` executa as chamadas `test()` no momento
 * do import, então este re-import basta para incluir todos os cenários
 * (STANDARD, CONTRACT_OPEN, CONTRACT_AVERAGE, GROUPED) no pipeline.
 */
import "../regression/billing-nfe-equivalence.test";
