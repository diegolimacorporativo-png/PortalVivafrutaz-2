/**
 * FASE NF.7.1.1 — Testes de estrutura ICMS por CST.
 *
 * Trava o XML de ICMS gerado por `gerarNFeXML` contra regressão estrutural.
 * Não testa cálculo (NF.7.2 fará isso). Apenas assegura que cada CST produz
 * o conjunto correto de tags exigido pela SEFAZ:
 *
 *   CST 00 → estrutura completa com base e imposto
 *   CST 20 → inclui <pRedBC> além da base/imposto
 *   CST 40 → apenas <orig> + <CST> (sem base nem imposto)
 *   CST 60 → estrutura mínima (sem base nem imposto)
 *   CRT 1  → ignora cst e usa <ICMSSN${csosn}>
 *   default→ sem cst → cai em <ICMS00> (backward-compat)
 *
 * Run with: npx tsx --test tests/unit/nfeIcmsStructure.test.ts
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { gerarNFeXML } from "../../server/services/nfe/nfeGenerator";
import type { NFeInput } from "../../server/services/nfe/nfeValidator";

function makeInput(opts: { crt?: any; csosn?: any; cst?: any } = {}): NFeInput {
  const crt = "crt" in opts ? opts.crt : "3";
  return {
    emitente: {
      cnpj: "11222333000181",
      xNome: "Empresa Teste LTDA",
      xFant: "Empresa Teste",
      ie: "123456789",
      crt,
      logradouro: "Rua Teste",
      numero: "100",
      bairro: "Centro",
      cMun: "3550308",
      xMun: "São Paulo",
      uf: "SP",
      cep: "01001000",
    },
    destinatario: {
      cnpj: "11444777000161",
      xNome: "Cliente Teste",
      logradouro: "Av Cliente",
      numero: "200",
      bairro: "Bela Vista",
      cMun: "3550308",
      xMun: "São Paulo",
      uf: "SP",
      cep: "01310100",
    },
    produtos: [
      {
        cProd: "000001",
        xProd: "Banana Prata",
        ncm: "08039000",
        cfop: "5102",
        uCom: "KG",
        qCom: 10,
        vUnCom: 5,
        vProd: 50,
        csosn: opts.csosn,
        ...("cst" in opts ? { cst: opts.cst } : {}),
      },
    ],
    natOp: "Venda de mercadoria adquirida",
    tpAmb: "2",
    orderId: 1,
  };
}

/**
 * Extrai o conteúdo entre <ICMS${cst}> e </ICMS${cst}> ou
 * <ICMSSN${csosn}> e </ICMSSN${csosn}>, para asserts focados sem
 * vazamento de outras tags do XML.
 */
function extractIcmsBlock(xml: string, tag: string): string {
  const open = `<${tag}>`;
  const close = `</${tag}>`;
  const start = xml.indexOf(open);
  const end = xml.indexOf(close, start);
  if (start < 0 || end < 0) return "";
  return xml.slice(start, end + close.length);
}

describe("NF.7.1 — estrutura ICMS por CST (CRT='3')", () => {
  test("TESTE 1 — CST '00' gera estrutura completa", async () => {
    const out = await gerarNFeXML(makeInput({ crt: "3", cst: "00" }), 700);
    const block = extractIcmsBlock(out.xmlGerado, "ICMS00");
    assert.ok(block.length > 0, "deve conter <ICMS00>...</ICMS00>");
    assert.match(block, /<modBC>3<\/modBC>/);
    assert.match(block, /<vBC>50\.00<\/vBC>/);
    assert.match(block, /<pICMS>0\.00<\/pICMS>/);
    assert.match(block, /<vICMS>0\.00<\/vICMS>/);
    // pRedBC não pertence ao CST 00
    assert.ok(!/<pRedBC>/.test(block), "CST 00 não deve emitir <pRedBC>");
  });

  test("TESTE 2 — CST '20' inclui <pRedBC> + base", async () => {
    const out = await gerarNFeXML(makeInput({ crt: "3", cst: "20" }), 701);
    const block = extractIcmsBlock(out.xmlGerado, "ICMS20");
    assert.ok(block.length > 0, "deve conter <ICMS20>...</ICMS20>");
    assert.match(block, /<modBC>3<\/modBC>/);
    assert.match(block, /<vBC>50\.00<\/vBC>/);
    assert.match(block, /<pRedBC>0\.00<\/pRedBC>/);
    assert.match(block, /<pICMS>0\.00<\/pICMS>/);
    assert.match(block, /<vICMS>0\.00<\/vICMS>/);
    // não deve cair na tag fixa antiga
    assert.ok(!/<ICMS00>/.test(out.xmlGerado), "não deve emitir <ICMS00>");
  });

  test("TESTE 3 — CST '40' (isento) só com <orig> + <CST>", async () => {
    const out = await gerarNFeXML(makeInput({ crt: "3", cst: "40" }), 702);
    const block = extractIcmsBlock(out.xmlGerado, "ICMS40");
    assert.ok(block.length > 0, "deve conter <ICMS40>...</ICMS40>");
    assert.match(block, /<orig>0<\/orig>/);
    assert.match(block, /<CST>40<\/CST>/);
    // proibições do CST 40/41/50
    assert.ok(!/<modBC>/.test(block), "CST 40 não deve emitir <modBC>");
    assert.ok(!/<vBC>/.test(block), "CST 40 não deve emitir <vBC>");
    assert.ok(!/<pICMS>/.test(block), "CST 40 não deve emitir <pICMS>");
    assert.ok(!/<vICMS>/.test(block), "CST 40 não deve emitir <vICMS>");
  });

  test("TESTE 3b — CST '41' e '50' seguem a mesma regra do '40'", async () => {
    for (const cst of ["41", "50"] as const) {
      const out = await gerarNFeXML(makeInput({ crt: "3", cst }), 7020);
      const block = extractIcmsBlock(out.xmlGerado, `ICMS${cst}`);
      assert.ok(block.length > 0, `deve conter <ICMS${cst}>`);
      assert.match(block, new RegExp(`<CST>${cst}</CST>`));
      assert.ok(!/<modBC>/.test(block), `CST ${cst} sem <modBC>`);
      assert.ok(!/<vBC>/.test(block), `CST ${cst} sem <vBC>`);
      assert.ok(!/<pICMS>/.test(block), `CST ${cst} sem <pICMS>`);
      assert.ok(!/<vICMS>/.test(block), `CST ${cst} sem <vICMS>`);
    }
  });

  test("TESTE 4 — CST '60' (ICMS ST) com estrutura mínima", async () => {
    const out = await gerarNFeXML(makeInput({ crt: "3", cst: "60" }), 703);
    const block = extractIcmsBlock(out.xmlGerado, "ICMS60");
    assert.ok(block.length > 0, "deve conter <ICMS60>...</ICMS60>");
    assert.match(block, /<orig>0<\/orig>/);
    assert.match(block, /<CST>60<\/CST>/);
    assert.ok(!/<vBC>/.test(block), "CST 60 (estrutura mínima) sem <vBC>");
    assert.ok(!/<pICMS>/.test(block), "CST 60 (estrutura mínima) sem <pICMS>");
    assert.ok(!/<vICMS>/.test(block), "CST 60 (estrutura mínima) sem <vICMS>");
  });
});

describe("NF.7.1 — Simples Nacional ignora CST", () => {
  test("TESTE 5 — CRT '1' + csosn '102' + cst '20' usa <ICMSSN102>", async () => {
    const out = await gerarNFeXML(
      makeInput({ crt: "1", csosn: "102", cst: "20" }),
      704,
    );
    assert.match(out.xmlGerado, /<ICMSSN102>/);
    assert.match(out.xmlGerado, /<CSOSN>102<\/CSOSN>/);
    // mesmo passando cst='20', NÃO deve cair no branch CRT=3
    assert.ok(
      !/<ICMS20>/.test(out.xmlGerado),
      "Simples Nacional não deve emitir <ICMS20>",
    );
    assert.ok(
      !/<ICMS00>/.test(out.xmlGerado),
      "Simples Nacional não deve emitir <ICMS00>",
    );
  });
});

describe("NF.7.1 — backward compat (default sem CST)", () => {
  test("TESTE 6 — CRT '3' sem cst cai em <ICMS00> (legado preservado)", async () => {
    const out = await gerarNFeXML(makeInput({ crt: "3" }), 705);
    const block = extractIcmsBlock(out.xmlGerado, "ICMS00");
    assert.ok(block.length > 0, "deve conter <ICMS00>...</ICMS00>");
    assert.match(block, /<orig>0<\/orig>/);
    assert.match(block, /<CST>00<\/CST>/);
    assert.match(block, /<modBC>3<\/modBC>/);
    assert.match(block, /<vBC>50\.00<\/vBC>/);
    assert.match(block, /<pICMS>0\.00<\/pICMS>/);
    assert.match(block, /<vICMS>0\.00<\/vICMS>/);
    // pRedBC não vaza para o default
    assert.ok(!/<pRedBC>/.test(block), "default não deve emitir <pRedBC>");
  });
});
