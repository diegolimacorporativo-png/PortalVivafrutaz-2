import assert from "node:assert/strict";
import test from "node:test";
import axios from "axios";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  assertFiscalMutationEnabled,
  assertNfeIssuanceEnabled,
  blockNfeIssuance,
  NFE_ISSUANCE_PAUSED,
} from "../../server/modules/nfe/nfe-issuance-lock";
import { gerarNFeXML } from "../../server/services/nfe/nfeGenerator";
import { getFiscalSnapshot } from "../../server/core/nfe/fiscal-store";
import { cancelarNFe, enviarCCe, enviarNFeSEFAZ } from "../../server/services/nfe/nfeSender";
import { assinarEvento, assinarXML } from "../../server/services/nfe/nfeSignature";
import { assinarXML as assinarXMLViaSigner } from "../../server/services/nfe/nfeSigner";

// The service imports db.ts. Use the project's isolated preview configuration
// to initialize its pool without connecting to any database.
process.env.NODE_ENV = "development";
process.env.ISOLATED_PREVIEW_MODE = "1";
process.env.ISOLATED_PREVIEW_DATABASE_URL = "postgresql://preview@127.0.0.1:55439/vivafrutaz_preview";
const { OrdersService } = await import("../../server/modules/orders/orders.service");

const source = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

test("emissão fiscal fica pausada por padrão durante a alteração operacional", () => {
  assert.equal(NFE_ISSUANCE_PAUSED, true);
  assert.throws(assertNfeIssuanceEnabled, { code: "SERVICE_UNAVAILABLE" });
});

test("middleware bloqueia preview e endpoints de emissão antes do handler", () => {
  let nextCalled = false;
  let responseStatus = 0;
  let responseBody: any;
  const res: any = {
    status(value: number) { responseStatus = value; return this; },
    json(value: unknown) { responseBody = value; return this; },
  };

  blockNfeIssuance({} as any, res, (() => { nextCalled = true; }) as any);

  assert.equal(responseStatus, 503);
  assert.equal(responseBody.code, "NFE_ISSUANCE_PAUSED");
  assert.equal(nextCalled, false);
});

test("qualquer mutação fiscal permanece bloqueada pela pausa central", () => {
  assert.throws(assertFiscalMutationEnabled, { code: "SERVICE_UNAVAILABLE" });
});

test("PATCH fiscal bloqueia todos os status e pre-nota antes de persistir", async () => {
  let updateCalls = 0;
  let logCalls = 0;
  const service = new OrdersService({
    getUser: async () => ({ id: 7, email: "admin@example.test", role: "ADMIN" }),
    update: async () => { updateCalls++; return {}; },
    createLog: async () => { logCalls++; },
  } as any);
  const actor = { userId: 7, role: "ADMIN", email: "admin@example.test" };

  for (const fiscalStatus of ["nota_cancelada", "nota_emitida", "nota_exportada", "erro", "qualquer_estado"]) {
    await assert.rejects(
      () => service.updateFiscal(290, { fiscalStatus }, actor),
      { code: "SERVICE_UNAVAILABLE" },
    );
  }
  await assert.rejects(
    () => service.updateFiscal(290, { preNotaNumber: "PN-TESTE" }, actor),
    { code: "SERVICE_UNAVAILABLE" },
  );

  assert.equal(updateCalls, 0);
  assert.equal(logCalls, 0);
});

test("generatePrenota bloqueia chamada direta antes de consultar, gerar ou persistir", async () => {
  const calls = { getUser: 0, get: 0, update: 0, log: 0, reserveNumber: 0 };
  const service = new OrdersService({
    getUser: async () => { calls.getUser++; return { id: 7, email: "admin@example.test", role: "ADMIN" }; },
    get: async () => { calls.get++; return { order: { preNotaNumber: null }, items: [] }; },
    update: async () => { calls.update++; return {}; },
    createLog: async () => { calls.log++; },
    getNextNfeNumero: async () => { calls.reserveNumber++; return 1; },
  } as any);

  await assert.rejects(
    () => service.generatePrenota(290, { userId: 7, role: "ADMIN", email: "admin@example.test" }),
    { code: "SERVICE_UNAVAILABLE" },
  );
  assert.deepEqual(calls, { getUser: 0, get: 0, update: 0, log: 0, reserveNumber: 0 });
});

test("as rotas v1 e v2 encaminham a pré-nota ao serviço protegido e a leitura permanece disponível", () => {
  const v1 = source("server/modules/orders/orders.routes.ts");
  const v2 = source("server/modules/orders/orders.routes.v2.ts");
  const controller = source("server/modules/orders/orders.controller.ts");
  const controllerV2 = source("server/modules/orders/orders.controller.v2.ts");
  const fiscalReads = source("server/routes/routes.ts");

  assert.match(v1, /"\/\:id\/generate-prenota",[\s\S]{0,160}ordersController\.generatePrenota/);
  assert.match(v2, /"\/\:id\/generate-prenota",[\s\S]{0,170}ordersControllerV2\.generatePrenota/);
  assert.match(controller, /generatePrenota[\s\S]{0,180}this\.service\.generatePrenota/);
  assert.match(controllerV2, /generatePrenota[\s\S]{0,180}this\.service\.generatePrenota/);
  assert.match(fiscalReads, /app\.get\('\/api\/nfe\/\:orderId\/historico'/);
});

test("chamada direta ao gerador de XML é bloqueada antes de processar os dados", async () => {
  await assert.rejects(
    () => gerarNFeXML({} as any, 1),
    { code: "SERVICE_UNAVAILABLE" },
  );
});

test("rota de cancelamento SEFAZ é barrada antes do handler e de seus efeitos", () => {
  const routes = source("server/routes/routes.ts");
  const start = routes.indexOf("app.delete('/api/nfe/:id'");
  assert.notEqual(start, -1, "rota DELETE de cancelamento deve existir");
  const declarationEnd = routes.indexOf("async (req: any, res) =>", start);
  assert.notEqual(declarationEnd, -1, "handler da rota de cancelamento deve existir");
  const declaration = routes.slice(start, declarationEnd);
  const lockPosition = declaration.indexOf("blockNfeIssuance");
  const tenantLookupPosition = declaration.indexOf("tenantContext");
  assert.notEqual(lockPosition, -1, "rota deve usar a trava fiscal centralizada");
  assert.ok(lockPosition < tenantLookupPosition, "trava roda antes de leituras do handler");

  const handlerEnd = routes.indexOf("// CC-e (Carta de Correção Eletrônica)", declarationEnd);
  const handler = routes.slice(declarationEnd, handlerEnd);
  assert.match(handler, /cancelarNFe\(/, "o handler continua identificado como caminho fiscal protegido");
  assert.match(handler, /storage\.updateNfeEmissao\(/);
  assert.match(handler, /storage\.updateOrder\(nfe\.orderId, \{ fiscalStatus: 'nota_cancelada' \}/);
});

test("recovery mark-error está bloqueado antes do contexto fiscal e do handler", () => {
  const routes = source("server/routes/routes.ts");
  const start = routes.indexOf("app.post('/api/admin/nfe/recovery/:id/mark-error'");
  assert.notEqual(start, -1, "rota mark-error deve existir");
  const handlerStart = routes.indexOf("async (req: any, res) =>", start);
  assert.notEqual(handlerStart, -1, "handler mark-error deve existir");
  const middlewareChain = routes.slice(start, handlerStart);
  const lockPosition = middlewareChain.indexOf("blockNfeIssuance");
  const tenantPosition = middlewareChain.indexOf("tenantContext");
  assert.notEqual(lockPosition, -1, "rota deve usar a trava centralizada");
  assert.ok(lockPosition < tenantPosition, "trava antecede consulta do registro fiscal");

  const handlerEnd = routes.indexOf("// GET /api/nfe/sefaz/status", handlerStart);
  const handler = routes.slice(handlerStart, handlerEnd);
  assert.match(handler, /storage\.updateNfeEmissao\(nfeId,\s*\{\s*status:\s*'erro'/);
});

test("funções exportadas do SEFAZ são bloqueadas diretamente sem HTTP ou evento fiscal", async () => {
  const originalMode = process.env.NFE_SEFAZ_MODE;
  const axiosObject = axios as any;
  const originalPost = axiosObject.post;
  let httpCalls = 0;
  axiosObject.post = async () => { httpCalls++; throw new Error("HTTP stub should not be reached"); };
  process.env.NFE_SEFAZ_MODE = "production";
  const before = getFiscalSnapshot();

  try {
    await assert.rejects(
      () => enviarNFeSEFAZ("<signed/>", "SP", "1"),
      { code: "SERVICE_UNAVAILABLE" },
    );
    await assert.rejects(
      () => cancelarNFe("chave", "protocolo", "justificativa válida de teste", "SP", "00000000000000", "1"),
      { code: "SERVICE_UNAVAILABLE" },
    );
    await assert.rejects(
      () => enviarCCe("chave", "correção de teste", 1, "SP", "00000000000000", "1"),
      { code: "SERVICE_UNAVAILABLE" },
    );
    assert.equal(httpCalls, 0);
    assert.deepEqual(getFiscalSnapshot(), before);
  } finally {
    axiosObject.post = originalPost;
    if (originalMode === undefined) delete process.env.NFE_SEFAZ_MODE;
    else process.env.NFE_SEFAZ_MODE = originalMode;
  }
});

test("assinaturas diretas de NF-e e evento bloqueiam antes de acessar certificado ou criptografia", async () => {
  const invalidCertificatePath = "__CERTIFICATE_ACCESS_MUST_NOT_OCCUR__";
  await assert.rejects(
    () => assinarXML("<input-not-to-sign/>", invalidCertificatePath, "invalid"),
    { code: "SERVICE_UNAVAILABLE" },
  );
  await assert.rejects(
    () => assinarEvento("<event-not-to-sign/>", invalidCertificatePath, "invalid"),
    { code: "SERVICE_UNAVAILABLE" },
  );
});

test("wrapper nfeSigner bloqueia chamada direta antes de getCertificado ou da assinatura interna", async () => {
  const originalPassword = process.env.NFE_CERT_PASSWORD;
  const originalLegacyPassword = process.env.CERT_PASSWORD;
  delete process.env.NFE_CERT_PASSWORD;
  delete process.env.CERT_PASSWORD;

  try {
    await assert.rejects(
      () => assinarXMLViaSigner("<xml-not-to-sign/>"),
      (error: any) => {
        assert.equal(error.code, "SERVICE_UNAVAILABLE");
        assert.match(error.message, /emissão fiscal.*suspensa/i);
        return true;
      },
    );
  } finally {
    if (originalPassword === undefined) delete process.env.NFE_CERT_PASSWORD;
    else process.env.NFE_CERT_PASSWORD = originalPassword;
    if (originalLegacyPassword === undefined) delete process.env.CERT_PASSWORD;
    else process.env.CERT_PASSWORD = originalLegacyPassword;
  }
});

test("rotas de consulta e histórico fiscal permanecem sem a trava de emissão", () => {
  const routes = source("server/routes/routes.ts");
  for (const route of [
    "app.get('/api/nfe/:id'",
    "app.get('/api/nfe/:orderId/historico'",
    "app.get('/api/nfe/:id/danfe'",
    "app.get('/api/nfe/:id/xml'",
  ]) {
    const line = routes.split("\n").find((candidate) => candidate.includes(route));
    assert.ok(line, `consulta esperada ausente: ${route}`);
    assert.ok(!line.includes("blockNfeIssuance"), `consulta foi bloqueada: ${route}`);
  }
});

test("pontos de entrada fiscais estão protegidos sem iniciar serviços ou banco", () => {
  const cron = source("server/jobs/faturamento.cron.ts");
  assert.match(cron, /export async function runFaturamentoCron[\s\S]{0,350}assertNfeIssuanceEnabled\(\)/);
  assert.match(cron, /if \(NFE_ISSUANCE_PAUSED\)[\s\S]{0,180}return;/);

  const transmit = source("server/modules/nfe/nfe-transmit.service.ts");
  assert.match(transmit, /export async function transmitirNFe\([\s\S]{0,150}assertNfeIssuanceEnabled\(\)/);

  const persistence = source("server/modules/nfe/nfe-persist.transaction.ts");
  assert.equal((persistence.match(/assertNfeIssuanceEnabled\(\);/g) ?? []).length, 3);

  const routes = source("server/routes/routes.ts");
  for (const path of [
    "/api/nfe/preflight/:orderId",
    "/api/nfe/cron/run",
    "/api/nfe/emitir",
    "/api/nfe/:orderId/reenviar",
    "/api/nfe/:orderId/corrigir-reenviar",
    "/api/nfe/emitir-lote",
    "/api/nfe/:id/enviar",
    "/api/admin/nfe/recovery/:id/reprocess",
    "/api/nf-manual",
  ]) {
    const routeLine = routes.split("\n").find((line) =>
      line.includes(path) && /app\.(get|post|patch|put)\(/.test(line),
    );
    assert.ok(routeLine?.includes("blockNfeIssuance"), `rota sem bloqueio: ${path}`);
  }
  assert.match(routes, /app\.post\([\s\S]{0,80}'\/api\/nfe\/:id\/cce',[\s\S]{0,100}blockNfeIssuance/);

  const service = source("server/modules/orders/orders.service.ts");
  const fiscalUpdate = service.slice(service.indexOf("async updateFiscal("), service.indexOf("async generatePrenota(", service.indexOf("async updateFiscal(")));
  assert.match(fiscalUpdate, /assertFiscalMutationEnabled\(\)/);

  const script = source("server/scripts/fase19-transmissao.ts");
  assert.match(script, /async function main\(\) \{\s*assertNfeIssuanceEnabled\(\)/);

  const generator = source("server/services/nfe/nfeGenerator.ts");
  const generatorBody = generator.slice(generator.indexOf("export async function gerarNFeXML"));
  assert.match(generatorBody, /assertNfeIssuanceEnabled\(\);/);
  assert.ok(generatorBody.indexOf("assertNfeIssuanceEnabled();") < generatorBody.indexOf("NFE_XML_MISSING_EMITENTE"));
  assert.doesNotMatch(generatorBody, /storage\.|transmitirNFe|commitNfe/);

  const transaction = source("server/modules/orders/orders.transaction.ts");
  const shippedEffect = transaction.slice(
    transaction.indexOf("if (to === OrderStatus.SHIPPED)"),
    transaction.indexOf("// ── Step 4: Commit the state transition"),
  );
  assert.match(shippedEffect, /UPDATE deliveries[\s\S]*status\s*=\s*'em_rota'[\s\S]*status\s*=\s*'pendente'/);
  assert.match(shippedEffect, /assertDispatchHasEligibleDelivery\(updated\.map\(\(\{ id \}\) => id\)\)/);
  assert.doesNotMatch(shippedEffect, /INSERT INTO deliveries/i);
  assert.match(transaction, /await tx\.insert\(workflowEvents\)/);

  assert.doesNotMatch(routes, /app\.get\('\/api\/nfe\/(?:\:id\/historico|:id|eligible)'[^\n]*blockNfeIssuance/);

  const workflowService = source("server/modules/orders/orders.service.ts");
  const transition = workflowService.slice(
    workflowService.indexOf("async transition("),
    workflowService.indexOf("async retryPendingCustomerConfirmations("),
  );
  assert.doesNotMatch(transition, /gerarNFeXML|commitNfeCreation|runFaturamentoCron/);
});
