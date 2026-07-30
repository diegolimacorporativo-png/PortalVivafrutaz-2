/**
 * Testes unitários — calculateOrderModificationDeadline
 *
 * Cobertura conforme especificação:
 *   ✅ Entrega segunda   ✅ Entrega terça   ✅ Entrega quarta
 *   ✅ Entrega quinta    ✅ Entrega sexta
 *   ✅ Antes das 12:00   ✅ Depois das 12:00
 *   ✅ Fim de semana     ✅ Mudança de mês  ✅ Mudança de ano
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { calculateOrderModificationDeadline } from "../../client/src/lib/order-deadline";

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Cria uma Date a partir de string ISO (UTC) */
function utc(iso: string): Date {
  return new Date(iso);
}

// ─── 1. Cálculo do prazo por dia da semana ────────────────────────────────────
//
// Regra: prazo = 2 dias úteis antes da entrega, às 15:00 UTC (12:00 BRT)
// Referência: semana de 03–07/08/2026
//
//   Entrega Seg 03/08 → prazo Qui 30/07 às 15:00 UTC
//   Entrega Ter 04/08 → prazo Sex 01/08 às 15:00 UTC
//   Entrega Qua 05/08 → prazo Seg 03/08 às 15:00 UTC
//   Entrega Qui 06/08 → prazo Ter 04/08 às 15:00 UTC
//   Entrega Sex 07/08 → prazo Qua 05/08 às 15:00 UTC

describe("Cálculo do prazo por dia da entrega", () => {
  const WEEKDAY_CASES: Array<{ label: string; delivery: string; expectedDeadline: string }> = [
    {
      label: "Entrega segunda-feira → prazo quinta anterior",
      delivery: "2026-08-03T12:00:00Z",
      expectedDeadline: "2026-07-30T15:00:00.000Z",
    },
    {
      label: "Entrega terça-feira → prazo sexta anterior",
      delivery: "2026-08-04T12:00:00Z",
      expectedDeadline: "2026-07-31T15:00:00.000Z",
    },
    {
      label: "Entrega quarta-feira → prazo segunda mesma semana",
      delivery: "2026-08-05T12:00:00Z",
      expectedDeadline: "2026-08-03T15:00:00.000Z",
    },
    {
      label: "Entrega quinta-feira → prazo terça mesma semana",
      delivery: "2026-08-06T12:00:00Z",
      expectedDeadline: "2026-08-04T15:00:00.000Z",
    },
    {
      label: "Entrega sexta-feira → prazo quarta mesma semana",
      delivery: "2026-08-07T12:00:00Z",
      expectedDeadline: "2026-08-05T15:00:00.000Z",
    },
  ];

  for (const { label, delivery, expectedDeadline } of WEEKDAY_CASES) {
    test(label, () => {
      const { deadline } = calculateOrderModificationDeadline(delivery);
      assert.equal(
        deadline.toISOString(),
        expectedDeadline,
        `deadline esperado: ${expectedDeadline}, obtido: ${deadline.toISOString()}`,
      );
    });
  }
});

// ─── 2. canModify: antes e depois das 12:00 ───────────────────────────────────
//
// Entrega quinta 06/08/2026 → prazo terça 04/08/2026 às 15:00 UTC

describe("canModify — antes e depois do prazo", () => {
  const DELIVERY = "2026-08-06T12:00:00Z"; // quinta
  const DEADLINE  = "2026-08-04T15:00:00Z"; // terça às 15:00 UTC

  test("antes das 12:00 BRT do dia limite → canModify = true", () => {
    const now = utc("2026-08-04T14:59:59Z"); // 11:59 BRT
    const { canModify, reason } = calculateOrderModificationDeadline(DELIVERY, { now });
    assert.equal(canModify, true);
    assert.equal(reason, "");
  });

  test("exatamente às 12:00 BRT (15:00 UTC) → canModify = true (limite inclusivo)", () => {
    const now = utc(DEADLINE); // == deadline
    const { canModify } = calculateOrderModificationDeadline(DELIVERY, { now });
    assert.equal(canModify, true, "deadline é inclusivo: now <= deadline deve ser true");
  });

  test("1 segundo depois das 12:00 BRT → canModify = false", () => {
    const now = utc("2026-08-04T15:00:01Z"); // 12:00:01 BRT
    const { canModify, reason } = calculateOrderModificationDeadline(DELIVERY, { now });
    assert.equal(canModify, false);
    assert.ok(reason.length > 0, "reason deve ter conteúdo quando bloqueado");
  });

  test("dia seguinte ao prazo → canModify = false", () => {
    const now = utc("2026-08-05T10:00:00Z"); // dia seguinte
    const { canModify } = calculateOrderModificationDeadline(DELIVERY, { now });
    assert.equal(canModify, false);
  });
});

// ─── 3. Fim de semana na janela de prazo ──────────────────────────────────────
//
// Entrega segunda 03/08/2026 → prazo quinta 31/07/2026 (pula sáb + dom)
// Confirma que sáb e dom são corretamente ignorados no retrocesso.

describe("Fim de semana — ignorados no cálculo", () => {
  test("entrega segunda: prazo pula sábado e domingo corretamente", () => {
    // segunda 03/08 → retrocede 2 biz days:
    //   dom 02/08 (skip) → sáb 01/08 (skip) → sex 01/08 (1º biz) → qui 31/07 (2º biz)
    // Portanto prazo = qui 30/07/2026 às 15:00 UTC  ← conforme spec
    const { deadline } = calculateOrderModificationDeadline("2026-08-03T12:00:00Z");
    assert.equal(deadline.toISOString(), "2026-07-30T15:00:00.000Z");
  });

  test("na sexta após o prazo (que era quinta) → canModify = false", () => {
    // Entrega seg 03/08 → prazo qui 30/07/2026 às 15:00 UTC
    // Sexta 31/07 às 10:00 UTC está após o deadline (30/07) → bloqueado
    const now = utc("2026-07-31T10:00:00Z");
    const { canModify } = calculateOrderModificationDeadline("2026-08-03T12:00:00Z", { now });
    assert.equal(canModify, false, "sexta após deadline deve estar bloqueado");
  });

  test("na quinta antes das 12:00 BRT → canModify = true", () => {
    // Prazo é quinta 30/07/2026 às 15:00 UTC (12:00 BRT)
    // quinta 30/07 às 14:00 UTC (11:00 BRT) → dentro do prazo
    const now = utc("2026-07-30T14:00:00Z");
    const { canModify } = calculateOrderModificationDeadline("2026-08-03T12:00:00Z", { now });
    assert.equal(canModify, true);
  });
});

// ─── 4. Mudança de mês ────────────────────────────────────────────────────────
//
// Entrega quarta 02/09/2026 → retrocede 2 dias úteis:
//   ter 01/09 (1) → seg 31/08 (2) ← prazo cruza para agosto

describe("Mudança de mês", () => {
  test("prazo cai no mês anterior à entrega", () => {
    // Entrega qua 02/09/2026 → prazo seg 31/08/2026
    const { deadline } = calculateOrderModificationDeadline("2026-09-02T12:00:00Z");
    assert.equal(deadline.toISOString(), "2026-08-31T15:00:00.000Z");
  });

  test("dentro do prazo em agosto para entrega em setembro → canModify = true", () => {
    const now = utc("2026-08-31T14:00:00Z"); // 31/ago às 14:00 UTC (11:00 BRT)
    const { canModify } = calculateOrderModificationDeadline("2026-09-02T12:00:00Z", { now });
    assert.equal(canModify, true);
  });

  test("em setembro para entrega em setembro → canModify = false", () => {
    const now = utc("2026-09-01T12:00:00Z"); // 01/set, após prazo
    const { canModify } = calculateOrderModificationDeadline("2026-09-02T12:00:00Z", { now });
    assert.equal(canModify, false);
  });
});

// ─── 5. Mudança de ano ────────────────────────────────────────────────────────
//
// Entrega segunda 04/01/2027 → retrocede 2 dias úteis:
//   sex 01/01/2027 (1) → qui 31/12/2026 (2) ← prazo cruza para ano anterior
//   (sem feriados — 01/01 é dia útil no algoritmo atual)

describe("Mudança de ano", () => {
  test("prazo cai no ano anterior à entrega", () => {
    // 2027-01-04 é segunda (jan 1 2027 = sex → jan 4 = seg)
    // retrocede: sex 01/01/2027 (1) → qui 31/12/2026 (2)
    const { deadline } = calculateOrderModificationDeadline("2027-01-04T12:00:00Z");
    assert.equal(deadline.toISOString(), "2026-12-31T15:00:00.000Z");
  });

  test("dentro do prazo em dezembro para entrega em janeiro → canModify = true", () => {
    const now = utc("2026-12-31T14:00:00Z"); // 31/dez às 14:00 UTC
    const { canModify } = calculateOrderModificationDeadline("2027-01-04T12:00:00Z", { now });
    assert.equal(canModify, true);
  });

  test("em janeiro no dia da entrega → canModify = false", () => {
    const now = utc("2027-01-04T08:00:00Z");
    const { canModify } = calculateOrderModificationDeadline("2027-01-04T12:00:00Z", { now });
    assert.equal(canModify, false);
  });
});

// ─── 6. Estrutura do retorno ──────────────────────────────────────────────────

describe("Estrutura do retorno", () => {
  test("dentro do prazo: reason é string vazia", () => {
    const now = utc("2026-07-01T10:00:00Z");
    const { reason, canModify } = calculateOrderModificationDeadline("2026-08-05T12:00:00Z", { now });
    assert.equal(canModify, true);
    assert.equal(reason, "");
  });

  test("fora do prazo: reason é string não-vazia", () => {
    const now = utc("2026-08-10T10:00:00Z"); // muito depois da entrega
    const { reason, canModify } = calculateOrderModificationDeadline("2026-08-05T12:00:00Z", { now });
    assert.equal(canModify, false);
    assert.ok(reason.length > 0, "reason deve ser preenchido quando bloqueado");
  });

  test("deadline é sempre às 15:00 UTC (12:00 BRT)", () => {
    const { deadline } = calculateOrderModificationDeadline("2026-08-06T12:00:00Z");
    assert.equal(deadline.getUTCHours(), 15);
    assert.equal(deadline.getUTCMinutes(), 0);
    assert.equal(deadline.getUTCSeconds(), 0);
  });
});
