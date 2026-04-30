/**
 * FASE 8.6C — Bridge: re-importa o regression guard
 * `tests/regression/nfe-enforcement.test.ts` no glob padrão de
 * `npm run test` (`tests/unit/*.test.ts`) sem precisar mexer em
 * `package.json`. O `node:test` registra os `test()` no momento do
 * import, então este re-import basta para incluir os 6 cenários
 * (OFF / SHADOW / ENFORCE críticos × 3 / ENFORCE não-crítico) no
 * pipeline.
 */
import "../regression/nfe-enforcement.test";
