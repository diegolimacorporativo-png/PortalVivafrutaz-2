/**
 * FASE NF.5.2 — testes unitários para gerarNFeXML.
 *
 * Cobre os hardenings da FASE NF.5.1:
 *   - ETAPA 3: CRT sem fallback silencioso (NFE_INVALID_CRT)
 *   - ETAPA 4: tag <ICMSSN${csosn}> realmente dinâmica
 *   - ETAPA 5: CSOSN validado por regex (NFE_INVALID_CSOSN)
 *
 * Inclui também o cenário de NÃO regressão: Simples Nacional com CSOSN 102
 * deve gerar exatamente <ICMSSN102><CSOSN>102</CSOSN></ICMSSN102>.
 *
 * Adicionalmente, lock da regra de mapeamento regime → CRT do builder
 * (ETAPA 1 — override por cliente). Não chamamos buildNFeInput diretamente
 * (depende de DB), mas reproduzimos a regra documentada e a verificamos —
 * qualquer mudança no builder deve ser refletida aqui.
 *
 * Run with: npx tsx --test tests/unit/nfeGenerator.test.ts
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { gerarNFeXML } from "../../server/services/nfe/nfeGenerator";
import type { NFeInput } from "../../server/services/nfe/nfeValidator";

function makeInput(opts: { crt?: any; csosn?: any } = {}): NFeInput {
  // ATENÇÃO: usamos `'crt' in opts ? opts.crt : '1'` (não `??`) para preservar
  // explicitamente o valor `undefined` quando o teste o passa intencionalmente.
  // `opts.crt ?? '1'` colapsaria undefined em '1', mascarando o cenário de fail-fast.
  const crt = "crt" in opts ? opts.crt : "1";
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
      },
    ],
    natOp: "Venda de mercadoria adquirida",
    tpAmb: "2",
    orderId: 1,
  };
}

describe("gerarNFeXML — ETAPA 3 (CRT sem fallback silencioso)", () => {
  test("CRT inválido lança NFE_INVALID_CRT antes de montar o XML", async () => {
    const input = makeInput({ crt: "9", csosn: "102" });
    await assert.rejects(() => gerarNFeXML(input, 1), /NFE_INVALID_CRT/);
  });

  test("CRT undefined lança NFE_INVALID_CRT (sem mais default '1')", async () => {
    const input = makeInput({ crt: undefined, csosn: "102" });
    await assert.rejects(() => gerarNFeXML(input, 1), /NFE_INVALID_CRT/);
  });
});

describe("gerarNFeXML — ETAPAS 4 + 5 (CSOSN dinâmico e validado)", () => {
  test("CSOSN '102' (default) gera <ICMSSN102>", async () => {
    const out = await gerarNFeXML(makeInput({ crt: "1", csosn: "102" }), 1);
    assert.match(out.xmlGerado, /<ICMSSN102>/);
    assert.match(out.xmlGerado, /<CSOSN>102<\/CSOSN>/);
    assert.match(out.xmlGerado, /<\/ICMSSN102>/);
  });

  test("CSOSN '300' gera <ICMSSN300> (NÃO mais sempre 102)", async () => {
    const out = await gerarNFeXML(makeInput({ crt: "1", csosn: "300" }), 2);
    assert.match(out.xmlGerado, /<ICMSSN300>/);
    assert.match(out.xmlGerado, /<CSOSN>300<\/CSOSN>/);
    assert.match(out.xmlGerado, /<\/ICMSSN300>/);
    assert.ok(
      !/<ICMSSN102>/.test(out.xmlGerado),
      "não deve cair na tag fixa antiga <ICMSSN102>",
    );
  });

  test("CSOSN '400' também gera tag dinâmica", async () => {
    const out = await gerarNFeXML(makeInput({ crt: "2", csosn: "400" }), 3);
    assert.match(out.xmlGerado, /<ICMSSN400>/);
    assert.match(out.xmlGerado, /<CSOSN>400<\/CSOSN>/);
  });

  test("CSOSN '1' (curto) lança NFE_INVALID_CSOSN", async () => {
    await assert.rejects(
      () => gerarNFeXML(makeInput({ crt: "1", csosn: "1" }), 4),
      /NFE_INVALID_CSOSN/,
    );
  });

  test("CSOSN '10A' (com letra) lança NFE_INVALID_CSOSN", async () => {
    await assert.rejects(
      () => gerarNFeXML(makeInput({ crt: "1", csosn: "10A" }), 5),
      /NFE_INVALID_CSOSN/,
    );
  });

  test("CSOSN '<xml>' (caracteres especiais) lança NFE_INVALID_CSOSN", async () => {
    await assert.rejects(
      () => gerarNFeXML(makeInput({ crt: "1", csosn: "<xml>" }), 6),
      /NFE_INVALID_CSOSN/,
    );
  });

  test("CSOSN '1020' (longo) lança NFE_INVALID_CSOSN", async () => {
    await assert.rejects(
      () => gerarNFeXML(makeInput({ crt: "1", csosn: "1020" }), 7),
      /NFE_INVALID_CSOSN/,
    );
  });

  test("CRT '3' (Lucro Presumido) NÃO gera tag ICMSSN — branch ICMS00 inalterado", async () => {
    const out = await gerarNFeXML(makeInput({ crt: "3" }), 8);
    assert.ok(
      !/<ICMSSN/.test(out.xmlGerado),
      "CRT 3 deve usar <ICMS00>, não <ICMSSN>",
    );
    assert.match(out.xmlGerado, /<ICMS00>/);
  });
});

describe("gerarNFeXML — ETAPA 6 (NÃO regressão)", () => {
  test("Simples Nacional + CSOSN 102 produz XML válido equivalente ao baseline", async () => {
    const out = await gerarNFeXML(makeInput({ crt: "1", csosn: "102" }), 100);
    // estrutura mínima preservada
    assert.ok(out.xmlGerado.startsWith("<?xml"));
    assert.match(out.xmlGerado, /<NFe[\s>]/);
    assert.match(out.xmlGerado, /<\/NFe>/);
    assert.match(out.xmlGerado, /<CRT>1<\/CRT>/);
    // ICMSSN com tag e conteúdo idênticos ao comportamento legado
    assert.match(
      out.xmlGerado,
      /<ICMSSN102><orig>0<\/orig><CSOSN>102<\/CSOSN><\/ICMSSN102>/,
    );
    // chave NFe e número populados
    assert.equal(typeof out.chaveNFe, "string");
    assert.equal(out.chaveNFe.length, 44);
    assert.equal(out.numero, "100");
  });

  test("CSOSN ausente cai no default '102' (sem regressão)", async () => {
    const out = await gerarNFeXML(makeInput({ crt: "1", csosn: undefined }), 101);
    assert.match(out.xmlGerado, /<ICMSSN102>/);
    assert.match(out.xmlGerado, /<CSOSN>102<\/CSOSN>/);
  });
});

/**
 * ETAPA 4 — Lock da regra de override por cliente do builder.
 *
 * Replica a regra documentada em nfe-input.builder.ts:
 *   regime = company?.regimeTributario || config?.regimeTributario
 *   crt    = simples_nacional → '1' | mei → '2' | else → '3'
 *
 * Se alguém alterar a prioridade no builder, esse teste deixa de refletir
 * a verdade — força revisão consciente da NF.5.1 ETAPA 1.
 */
function regimeToCrt(
  company: { regimeTributario?: string | null } | null,
  config: { regimeTributario?: string | null } | null,
): string {
  const regime = company?.regimeTributario || config?.regimeTributario;
  return regime === "simples_nacional"
    ? "1"
    : regime === "mei"
      ? "2"
      : "3";
}

describe("Builder — ETAPA 1 (override por cliente: contrato)", () => {
  test("override do cliente prevalece sobre config global", () => {
    const crt = regimeToCrt(
      { regimeTributario: "lucro_presumido" },
      { regimeTributario: "simples_nacional" },
    );
    assert.equal(crt, "3");
  });

  test("sem override no cliente → cai no config global", () => {
    const crt = regimeToCrt(null, { regimeTributario: "simples_nacional" });
    assert.equal(crt, "1");
  });

  test("cliente com regime vazio → cai no config global", () => {
    const crt = regimeToCrt(
      { regimeTributario: "" },
      { regimeTributario: "simples_nacional" },
    );
    assert.equal(crt, "1");
  });

  test("MEI (cliente) → CRT '2'", () => {
    const crt = regimeToCrt(
      { regimeTributario: "mei" },
      { regimeTributario: "simples_nacional" },
    );
    assert.equal(crt, "2");
  });

  test("regime desconhecido → CRT '3' (fallback Lucro Real/Presumido)", () => {
    const crt = regimeToCrt(
      { regimeTributario: "qualquer_outro" },
      null,
    );
    assert.equal(crt, "3");
  });
});
