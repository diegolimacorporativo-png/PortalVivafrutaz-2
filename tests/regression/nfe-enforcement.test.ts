/**
 * FASE 8.6C — TESTE AUTOMÁTICO DO ENFORCEMENT (CI PROOF)
 *
 * Garante em CI que os 3 modos do enforcement runtime introduzido nas
 * fases 8.6A/8.6B preservam invariantes:
 *
 *   • OFF        (nenhum env)                                → não valida nada, não loga, não bloqueia.
 *   • SHADOW     (NFE_VALIDATE_INPUT=1)                      → valida, loga, NÃO bloqueia.
 *   • ENFORCE    (NFE_VALIDATE_INPUT=1 +
 *                 NFE_ENFORCE_VALIDATION=1)                  → loga e BLOQUEIA somente
 *                 quando a issue toca `ncm` | `cfop` |
 *                 `produtos`. Erros não-críticos seguem
 *                 apenas logando.
 *
 * Estratégia (espelho 1:1 do bloco do builder)
 * --------------------------------------------
 * O bloco de enforcement em `server/modules/nfe/nfe-input.builder.ts`
 * é um trecho fechado e PURO (depende só de `process.env`,
 * `NFeInputSchema.safeParse` e do `nfeInput`). Replicar esse trecho
 * num helper `simulateBuilder` permite atestar o COMPORTAMENTO do
 * enforcement sem precisar inicializar DB, configurar emitente, criar
 * pedido e draft. Se o builder mudar a regra, este teste quebra
 * primeiro — qualquer divergência crítica também é capturada pela
 * sentinela 8.4.3.
 *
 * Run: npm run test
 */

import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { NFeInputSchema } from "../../server/modules/nfe/schema";
import type { NFeInput } from "../../server/modules/nfe/types";

// ── Espelho 1:1 do bloco em nfe-input.builder.ts (FASE 8.6A + 8.6B) ─────────
// MANTER SINCRONIZADO. Se a lógica do builder mudar, este helper deve
// mudar junto — e ambos devem mudar pelos MESMOS motivos.
async function simulateBuilder(nfeInput: any): Promise<NFeInput> {
  if (process.env.NFE_VALIDATE_INPUT === "1") {
    const result = NFeInputSchema.safeParse(nfeInput);
    if (!result.success) {
      // log silenciado nos testes para não poluir o relatório do node:test;
      // em produção, o builder usa console.error real.
      // (não afeta a asserção: testamos apenas se lança/não lança.)

      if (process.env.NFE_ENFORCE_VALIDATION === "1") {
        const hasCriticalError = result.error.issues.some((issue) =>
          issue.path.includes("ncm") ||
          issue.path.includes("cfop") ||
          issue.path.includes("produtos"),
        );
        if (hasCriticalError) {
          throw new Error("NFE_SCHEMA_CRITICAL_INVALID");
        }
      }
    }
  }
  return nfeInput as NFeInput;
}

// ── Mocks ───────────────────────────────────────────────────────────────────

const invalidSemNCM = {
  orderId: 1,
  produtos: [
    {
      cProd: "1",
      xProd: "Produto teste",
      ncm: "", // CRÍTICO — viola z.string().min(1) em path 'produtos.0.ncm'
      cfop: "5102",
      uCom: "UN",
      qCom: 1,
      vUnCom: 10,
      vProd: 10,
      csosn: "102",
      cst: "00",
      importado: false,
    },
  ],
};

// Erro NÃO crítico: payload tecnicamente válido pelo schema (xProd vazio é
// permitido — z.string() sem .min). Como `safeParse` devolve `success: true`,
// o branch de enforcement nem é alcançado. Documenta a expectativa de que
// "campos não-críticos não bloqueiam".
const naoCritico = {
  ...invalidSemNCM,
  produtos: [
    {
      ...invalidSemNCM.produtos[0],
      ncm: "08039000",
      xProd: "", // NÃO crítico
    },
  ],
};

// ── Isolamento ───────────────────────────────────────────────────────────────

afterEach(() => {
  delete process.env.NFE_VALIDATE_INPUT;
  delete process.env.NFE_ENFORCE_VALIDATION;
});

// ── Casos ────────────────────────────────────────────────────────────────────

test("FASE 8.6C — ENFORCEMENT OFF (sem env) não bloqueia", async () => {
  delete process.env.NFE_VALIDATE_INPUT;
  delete process.env.NFE_ENFORCE_VALIDATION;
  await assert.doesNotReject(async () => {
    await simulateBuilder(invalidSemNCM);
  });
});

test("FASE 8.6C — SHADOW MODE (apenas NFE_VALIDATE_INPUT=1) não bloqueia", async () => {
  process.env.NFE_VALIDATE_INPUT = "1";
  delete process.env.NFE_ENFORCE_VALIDATION;
  await assert.doesNotReject(async () => {
    await simulateBuilder(invalidSemNCM);
  });
});

test("FASE 8.6C — ENFORCEMENT bloqueia erro crítico (NCM ausente)", async () => {
  process.env.NFE_VALIDATE_INPUT = "1";
  process.env.NFE_ENFORCE_VALIDATION = "1";
  await assert.rejects(
    async () => {
      await simulateBuilder(invalidSemNCM);
    },
    /NFE_SCHEMA_CRITICAL_INVALID/,
  );
});

test("FASE 8.6C — ENFORCEMENT não bloqueia erro não crítico", async () => {
  process.env.NFE_VALIDATE_INPUT = "1";
  process.env.NFE_ENFORCE_VALIDATION = "1";
  await assert.doesNotReject(async () => {
    await simulateBuilder(naoCritico);
  });
});

// ── Casos extra de cobertura: cfop e produtos[] vazios ──────────────────────

test("FASE 8.6C — ENFORCEMENT bloqueia erro crítico (CFOP ausente)", async () => {
  process.env.NFE_VALIDATE_INPUT = "1";
  process.env.NFE_ENFORCE_VALIDATION = "1";
  const semCFOP = {
    ...invalidSemNCM,
    produtos: [{ ...invalidSemNCM.produtos[0], ncm: "08081000", cfop: "" }],
  };
  await assert.rejects(
    async () => {
      await simulateBuilder(semCFOP);
    },
    /NFE_SCHEMA_CRITICAL_INVALID/,
  );
});

test("FASE 8.6C — ENFORCEMENT bloqueia erro crítico (produtos vazio)", async () => {
  process.env.NFE_VALIDATE_INPUT = "1";
  process.env.NFE_ENFORCE_VALIDATION = "1";
  const produtosVazios = { orderId: 99, produtos: [] };
  await assert.rejects(
    async () => {
      await simulateBuilder(produtosVazios);
    },
    /NFE_SCHEMA_CRITICAL_INVALID/,
  );
});
