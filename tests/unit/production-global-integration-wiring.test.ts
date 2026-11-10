import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const authorization = read("../../server/modules/production/production-authorization.ts");
const routes = read("../../server/modules/production/production.routes.ts");
const controller = read("../../server/modules/production/production.controller.ts");
const service = read("../../server/modules/production/production.service.ts");
const repository = read("../../server/modules/production/production.repository.ts");
const page = read("../../client/src/pages/admin/production.tsx");
const phase1Migration = read("../../migrations/20261104_production_order_provenance.sql");
const phase2Migration = read("../../migrations/20261105_global_production_consolidation.sql");
const validation = read("../../server/modules/production/production.validation.ts");

test("rotas de consolidação e geração passam por autenticação, perfil, tenant interno e permissão de módulo", () => {
  assert.match(routes, /productionRouter\.use\([\s\S]*requireAuth,[\s\S]*requireRole\(\[\.\.\.PRODUCTION_ACCESS_ROLES\]\),[\s\S]*tenantContext,[\s\S]*requireTabPermission\("production"\)/);
  assert.match(routes, /productionRouter\.get\([\s\S]*"\/consolidated"[\s\S]*productionController\.consolidated/);
  assert.match(routes, /productionRouter\.post\([\s\S]*"\/batches\/generate"[\s\S]*productionController\.generate/);
  assert.match(authorization, /context\.principal\.kind !== "admin"/);
  assert.match(authorization, /PRODUCTION_ACCESS_ROLES\.includes/);
});

test("consulta e geração globais ignoram empresa selecionada, mas mantêm principal autorizado", () => {
  assert.match(controller, /productionService\.getConsolidationForDate\(date\)/);
  assert.match(controller, /productionService\.generateBatch\(body\)/);
  assert.match(service, /withGlobalTransaction\(async \(tx\)/);
  assert.match(repository, /withGlobalTransaction[\s\S]*isolationLevel: "repeatable read"/);
  assert.match(repository, /async getGlobalSourceRowsForDate\([\s\S]*\.where\(sql`DATE\(\$\{orders\.deliveryDate\}\) = \$\{productionDate\}`\)/);
  assert.doesNotMatch(repository.match(/async getGlobalSourceRowsForDate\([\s\S]*?\n  },/)?.[0] ?? "", /empresaId|tenantContext/);
});

test("lote existente bloqueia repetição e leitura do lote inclui itens e composição persistida", () => {
  assert.match(service, /findGlobalBatchByDate\(body\.productionDate, tx\)/);
  assert.match(service, /Já existe produção global/);
  assert.match(service, /production_batches_global_date_unique/);
  assert.match(repository, /async getGlobalBatchById[\s\S]*productionBatchItems[\s\S]*orderBreakdown: \(item\.orderBreakdown/);
  assert.match(repository, /async createGlobalBatchInTransaction[\s\S]*tx\.insert\(productionBatches\)[\s\S]*tx\.insert\(productionBatchItems\)/);
  assert.ok(page.includes("Já existe um lote global para {selectedDate}"), "a interface identifica que a data já possui lote");
  assert.match(page, /orderBreakdown\.map/);
  assert.match(page, /Já existe um lote global para \{selectedDate\}/);
  assert.match(page, /setActiveBatchId\(batch\.id\)/);
});

test("geração exige confirmação de uma prévia vigente e revalida no snapshot serializável", () => {
  assert.match(validation, /previewFingerprint: z\.string\(\)\.regex\(\/\^\[a-f0-9\]\{64\}\$\//);
  assert.match(page, /previewFingerprint: preview\.previewFingerprint/);
  assert.match(page, /onClick=\{\(\) => generateMutation\.mutate\(\)\}/);
  assert.match(service, /preview\.previewFingerprint !== body\.previewFingerprint/);
  assert.match(service, /withGlobalTransaction\(async \(tx\)[\s\S]*?, "serializable"\)/);
  assert.match(service, /if \(!preview\.canGenerate\)/);
  assert.match(repository, /async getGlobalBatchById[\s\S]*orderBreakdown: \(item\.orderBreakdown as OrderBreakdownEntry\[\]\)/);
});

test("interface mostra total, classificação, unidade, origem e pendências separadas", () => {
  const checks: Array<[RegExp, string]> = [
    [/\/api\/production\/consolidated\?date=\$\{selectedDate\}/, "consulta global envia a data selecionada"],
    [/fmt\(product\.totalQuantity\)/, "mostra quantidade total"],
    [/<TableHead>Unidade<\/TableHead>/, "mostra unidade"],
    [/product\.productionClassification/, "mostra classificação oficial"],
    [/source\.companyName/, "mostra empresa de origem"],
    [/source\.orderCode/, "mostra pedido de origem"],
    [/source\.itemId/, "mostra item de origem"],
    [/source\.quantity/, "mostra parcela da origem"],
    [/source\.origin === "CONTRACT_FIXED"/, "mostra origem operacional"],
    [/new Set\(product\.sources\.map\(\(source\) => source\.companyId\)\)/, "mostra quantidade de empresas por produto"],
    [/new Set\(product\.sources\.map\(\(source\) => source\.orderId\)\)/, "mostra quantidade de pedidos por produto"],
    [/pending\.missingContractOccurrences\.map/, "lista ocorrências contratuais pendentes"],
    [/pending\.unidentifiedItems\.map/, "lista produtos não identificados"],
    [/pending\.unclassifiedItems\.map/, "lista produtos sem classificação"],
    [/pending\.ineligibleOrders\.map/, "lista pedidos inelegíveis"],
    [/pending\.inconsistentOrigins\.map/, "lista origens inconsistentes"],
  ];
  for (const [pattern, description] of checks) assert.ok(pattern.test(page), description);
});

test("exportação Processados não oferece uma ação que o backend sempre rejeita", () => {
  assert.match(page, /Excel oficial — Processados \(indisponível\)/);
  assert.match(page, /disabled title="A exportação depende do turno manhã\/tarde/);
  assert.match(page, /Processados ainda não pode ser exportado: o lote não registra turno manhã\/tarde/);
});

test("migrations estão ordenadas e índice único interrompe com segurança se houver duplicatas históricas", () => {
  assert.match(phase1Migration, /CREATE TABLE IF NOT EXISTS recurring_order_log_items/);
  assert.match(phase2Migration, /ALTER TABLE production_batch_items[\s\S]*ADD COLUMN IF NOT EXISTS production_classification/);
  assert.match(phase2Migration, /GROUP BY production_date[\s\S]*HAVING COUNT\(\*\) > 1[\s\S]*RAISE EXCEPTION/);
  assert.match(phase2Migration, /CREATE UNIQUE INDEX IF NOT EXISTS production_batches_global_date_unique[\s\S]*WHERE empresa_id IS NULL/);
  assert.doesNotMatch(phase2Migration, /\b(DELETE|UPDATE)\s+production_batches\b/i);
});
