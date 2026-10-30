import os from "node:os";
import path from "node:path";
import { realpath, readFile } from "node:fs/promises";

const ISOLATED_PREVIEW_DATABASE = {
  host: "127.0.0.1",
  port: "55439",
  database: "/vivafrutaz_preview",
  username: "preview",
} as const;

const PRIMARY_SUPABASE_PROJECT_REF = "kqvutmzqwgrcntpivnhy";
const REMOTE_HOMOLOGATION_MARKER_TABLE = "portal_homologation_identity";
const REMOTE_HOMOLOGATION_APPLICATION = "PortalVivafrutaz-2";
const REMOTE_HOMOLOGATION_ENVIRONMENT = "homologation";

export type RuntimeEnvironment = NodeJS.ProcessEnv;

export type RemoteHomologationConfig = {
  databaseUrl: string;
  projectRef: string;
  environment: typeof REMOTE_HOMOLOGATION_ENVIRONMENT;
  schema: "public";
  markerId: string;
  databaseName: string;
  dataDirectory: string;
};

export type RemoteHomologationDatabaseIdentity = {
  projectRef: string;
  environment: typeof REMOTE_HOMOLOGATION_ENVIRONMENT;
  database: string;
  schema: "public";
  markerId: string;
};

export type ReadOnlyQuery = (text: string) => Promise<{
  rows: Array<Record<string, unknown>>;
}>;

export function isIsolatedPreviewMode(): boolean {
  return process.env.ISOLATED_PREVIEW_MODE === "1";
}

export function isRemoteHomologationMode(): boolean {
  return process.env.ISOLATED_REMOTE_HOMOLOGATION_MODE === "1";
}

export function isIsolatedRuntimeMode(): boolean {
  return isIsolatedPreviewMode() || isRemoteHomologationMode();
}

export function getRuntimeDatabaseProvider(): string {
  if (isRemoteHomologationMode()) return "isolated-remote-homologation-postgres";
  if (isIsolatedPreviewMode()) return "isolated-preview-postgres";
  return "supabase";
}

function hasRemoteHomologationConfiguration(env: RuntimeEnvironment): boolean {
  return [
    "ISOLATED_REMOTE_HOMOLOGATION_DATABASE_URL",
    "ISOLATED_REMOTE_HOMOLOGATION_PROJECT_REF",
    "ISOLATED_REMOTE_HOMOLOGATION_ENVIRONMENT",
    "ISOLATED_REMOTE_HOMOLOGATION_SCHEMA",
    "ISOLATED_REMOTE_HOMOLOGATION_MARKER_ID",
    "ISOLATED_REMOTE_HOMOLOGATION_DATA_DIR",
    "ISOLATED_REMOTE_HOMOLOGATION_API_URL",
  ].some((name) => Boolean(env[name]?.trim()));
}

function parseDatabaseUrl(rawUrl: string, settingName: string): URL {
  const normalized = normalizeDatabaseUrl(rawUrl);
  if (!normalized) throw new Error(`${settingName} é obrigatório.`);
  try {
    return new URL(normalized);
  } catch {
    throw new Error(`${settingName} não é uma URL válida.`);
  }
}

function projectRefFromDatabaseUrl(parsed: URL): string | null {
  const directHost = /^db\.([a-z0-9]{20})\.supabase\.co$/.exec(parsed.hostname);
  if (directHost) return directHost[1];

  if (parsed.hostname.endsWith(".pooler.supabase.com")) {
    const username = decodeURIComponent(parsed.username);
    const poolerUser = /^postgres\.([a-z0-9]{20})$/.exec(username);
    if (poolerUser) return poolerUser[1];
  }

  return null;
}

function validateTemporaryDirectory(rawPath: string | undefined, settingName: string): string {
  if (!rawPath?.trim()) throw new Error(`${settingName} é obrigatório.`);
  const tempRoot = path.resolve(os.tmpdir());
  const dataRoot = path.resolve(rawPath.trim());
  const relative = path.relative(tempRoot, dataRoot);
  if (
    !relative ||
    relative === ".." ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  ) {
    throw new Error(`${settingName} deve apontar para um diretório próprio dentro da pasta temporária.`);
  }
  return dataRoot;
}

/**
 * Validate all remote-test selectors before choosing a database URL. The
 * dedicated URL is the only URL returned; regular application URLs are
 * rejected while this mode is active to prevent an accidental fallback.
 */
export function validateRemoteHomologationConfig(
  env: RuntimeEnvironment = process.env,
): RemoteHomologationConfig {
  if (env.ISOLATED_REMOTE_HOMOLOGATION_MODE !== "1") {
    throw new Error("ISOLATED_REMOTE_HOMOLOGATION_MODE=1 é obrigatório para homologação remota.");
  }
  if (env.ISOLATED_PREVIEW_MODE === "1") {
    throw new Error("Os modos de preview local e homologação remota não podem ser usados juntos.");
  }
  if (env.NODE_ENV !== "development" && env.NODE_ENV !== "test") {
    throw new Error("Homologação remota só é permitida com NODE_ENV=development ou test.");
  }
  if (env.DATABASE_URL?.trim() || env.SUPABASE_DATABASE_URL?.trim()) {
    throw new Error("Remova DATABASE_URL e SUPABASE_DATABASE_URL do processo isolado; fallback é proibido.");
  }

  const parsed = parseDatabaseUrl(
    env.ISOLATED_REMOTE_HOMOLOGATION_DATABASE_URL ?? "",
    "ISOLATED_REMOTE_HOMOLOGATION_DATABASE_URL",
  );
  if (
    !["postgres:", "postgresql:"].includes(parsed.protocol) ||
    parsed.password.length === 0 ||
    parsed.search.length > 0 ||
    parsed.hash.length > 0 ||
    !["5432", "6543"].includes(parsed.port) ||
    decodeURIComponent(parsed.pathname.slice(1)) !== "postgres"
  ) {
    throw new Error("A URL exclusiva deve apontar ao PostgreSQL Supabase homologação, sem parâmetros extras.");
  }

  const expectedProjectRef = env.ISOLATED_REMOTE_HOMOLOGATION_PROJECT_REF?.trim().toLowerCase();
  if (!expectedProjectRef || !/^[a-z0-9]{20}$/.test(expectedProjectRef)) {
    throw new Error("ISOLATED_REMOTE_HOMOLOGATION_PROJECT_REF deve identificar um projeto Supabase válido.");
  }
  if (expectedProjectRef === PRIMARY_SUPABASE_PROJECT_REF) {
    throw new Error("O projeto Supabase principal não pode ser usado para homologação.");
  }
  const urlProjectRef = projectRefFromDatabaseUrl(parsed);
  if (!urlProjectRef || urlProjectRef !== expectedProjectRef) {
    throw new Error("A identidade do projeto na URL não corresponde ao projeto esperado.");
  }
  if (parsed.hostname.includes(PRIMARY_SUPABASE_PROJECT_REF) ||
      decodeURIComponent(parsed.username).includes(PRIMARY_SUPABASE_PROJECT_REF)) {
    throw new Error("O projeto Supabase principal está bloqueado para homologação.");
  }

  const environment = env.ISOLATED_REMOTE_HOMOLOGATION_ENVIRONMENT?.trim();
  if (environment !== REMOTE_HOMOLOGATION_ENVIRONMENT) {
    throw new Error("ISOLATED_REMOTE_HOMOLOGATION_ENVIRONMENT deve ser homologation.");
  }
  const schema = env.ISOLATED_REMOTE_HOMOLOGATION_SCHEMA?.trim();
  if (schema !== "public") {
    throw new Error("O esquema esperado para homologação deve ser public.");
  }
  const markerId = env.ISOLATED_REMOTE_HOMOLOGATION_MARKER_ID?.trim().toLowerCase();
  if (!markerId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(markerId)) {
    throw new Error("ISOLATED_REMOTE_HOMOLOGATION_MARKER_ID deve ser um UUID exclusivo do ambiente.");
  }
  const dataDirectory = validateTemporaryDirectory(
    env.ISOLATED_REMOTE_HOMOLOGATION_DATA_DIR,
    "ISOLATED_REMOTE_HOMOLOGATION_DATA_DIR",
  );

  return {
    databaseUrl: normalizeDatabaseUrl(env.ISOLATED_REMOTE_HOMOLOGATION_DATABASE_URL ?? ""),
    projectRef: expectedProjectRef,
    environment: REMOTE_HOMOLOGATION_ENVIRONMENT,
    schema: "public",
    markerId,
    databaseName: "postgres",
    dataDirectory,
  };
}

export function validateRemoteHomologationApiUrl(rawUrl: string | undefined): URL {
  if (!rawUrl?.trim()) {
    throw new Error("ISOLATED_REMOTE_HOMOLOGATION_API_URL é obrigatório para o teste integrado remoto.");
  }
  let parsed: URL;
  try {
    parsed = new URL(rawUrl.trim());
  } catch {
    throw new Error("ISOLATED_REMOTE_HOMOLOGATION_API_URL não é uma URL válida.");
  }
  if (
    parsed.protocol !== "http:" ||
    !["127.0.0.1", "localhost"].includes(parsed.hostname) ||
    parsed.username || parsed.password || parsed.search || parsed.hash ||
    !["", "/"].includes(parsed.pathname)
  ) {
    throw new Error("A API isolada deve estar acessível somente por HTTP local, sem credenciais ou parâmetros.");
  }
  return parsed;
}

/**
 * Read-only SQL attestation. Supabase does not expose its Project Ref as a
 * built-in PostgreSQL setting, so the operator-provisioned marker is checked
 * together with the URL's immutable project ref and the live database/schema.
 */
export async function verifyRemoteHomologationDatabaseIdentity(
  query: ReadOnlyQuery,
  config: RemoteHomologationConfig,
): Promise<RemoteHomologationDatabaseIdentity> {
  let identityRows: Array<Record<string, unknown>>;
  try {
    ({ rows: identityRows } = await query(`
      SELECT current_database() AS database, current_schema() AS schema
    `));
  } catch {
    throw new Error("Não foi possível consultar a identidade PostgreSQL da homologação.");
  }
  const actual = identityRows[0];
  if (
    identityRows.length !== 1 ||
    actual?.database !== config.databaseName ||
    actual?.schema !== config.schema
  ) {
    throw new Error("Banco ou esquema PostgreSQL diferente do alvo isolado esperado.");
  }

  let markerRows: Array<Record<string, unknown>>;
  try {
    ({ rows: markerRows } = await query(`
      SELECT application, project_ref, environment, schema_name,
             marker_id::text AS marker_id, data_classification, write_enabled
      FROM public.${REMOTE_HOMOLOGATION_MARKER_TABLE}
      LIMIT 2
    `));
  } catch {
    throw new Error("Marcador PostgreSQL de homologação ausente ou inacessível.");
  }
  const marker = markerRows[0];
  if (
    markerRows.length !== 1 ||
    marker?.application !== REMOTE_HOMOLOGATION_APPLICATION ||
    marker?.project_ref !== config.projectRef ||
    marker?.environment !== config.environment ||
    marker?.schema_name !== config.schema ||
    String(marker?.marker_id ?? "").toLowerCase() !== config.markerId ||
    marker?.data_classification !== "synthetic_only" ||
    marker?.write_enabled !== true
  ) {
    throw new Error("Marcador, classificação de dados ou autorização de escrita não corresponde ao ambiente esperado.");
  }

  return {
    projectRef: config.projectRef,
    environment: config.environment,
    database: config.databaseName,
    schema: config.schema,
    markerId: config.markerId,
  };
}

/** Ensure a remote test starts from an explicitly empty synthetic environment. */
export async function assertRemoteHomologationDatabaseIsEmpty(
  query: ReadOnlyQuery,
): Promise<void> {
  const expectedTables = [
    "companies", "users", "products", "orders", "order_items", "deliveries",
    "workflow_events", "nf_drafts", "company_config", "inventory_settings",
    "system_logs", "audit_logs", "auth_attempts", "production_batches",
    "production_batch_items", "fiscal_invoices", "nfe_emissoes", "nfe_cce",
    "nfe_cce_audit_logs", "nf_manual", "nfe_training_logs", "danfe_records",
    "fiscal_closures",
  ];
  const catalog = await query(`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
  `);
  const available = new Set(catalog.rows.map((row) => String(row.table_name)));
  const missing = expectedTables.filter((table) => !available.has(table));
  if (missing.length) {
    throw new Error("O schema remoto não está pronto para os testes isolados.");
  }
  for (const table of expectedTables) {
    const result = await query(`SELECT count(*)::int AS count FROM public."${table}"`);
    if (Number(result.rows[0]?.count) !== 0) {
      throw new Error("A homologação remota não está vazia; nenhum dado foi alterado.");
    }
  }
}

function normalizeDatabaseUrl(value: string): string {
  return value.trim().replace(/^(['"])(.*)\1$/, "$2").trim();
}

export function validateIsolatedPreviewDatabaseUrl(
  rawUrl: string | undefined,
  nodeEnv: string | undefined,
): string {
  if (nodeEnv !== "development") {
    throw new Error("ISOLATED_PREVIEW_MODE só é permitido com NODE_ENV=development.");
  }

  const databaseUrl = normalizeDatabaseUrl(rawUrl ?? "");
  if (!databaseUrl) {
    throw new Error("ISOLATED_PREVIEW_DATABASE_URL é obrigatório no preview isolado.");
  }

  let parsed: URL;
  try {
    parsed = new URL(databaseUrl);
  } catch {
    throw new Error("ISOLATED_PREVIEW_DATABASE_URL não é uma URL válida.");
  }

  if (
    !["postgres:", "postgresql:"].includes(parsed.protocol) ||
    parsed.hostname !== ISOLATED_PREVIEW_DATABASE.host ||
    parsed.port !== ISOLATED_PREVIEW_DATABASE.port ||
    parsed.pathname !== ISOLATED_PREVIEW_DATABASE.database ||
    parsed.username !== ISOLATED_PREVIEW_DATABASE.username ||
    parsed.password !== "" ||
    parsed.search !== "" ||
    parsed.hash !== ""
  ) {
    throw new Error(
      "Preview isolado aceita somente o PostgreSQL local dedicado em 127.0.0.1:55439/vivafrutaz_preview.",
    );
  }

  return databaseUrl;
}

export type IsolatedPreviewDatabaseIdentity = {
  database: string;
  username: string;
  address: string;
  port: number | string;
  dataDirectory: string;
};

export function assertIsolatedPreviewDatabaseIdentity(
  identity: IsolatedPreviewDatabaseIdentity,
  expectedDataDirectory: string,
): void {
  const addressIsLoopback =
    identity.address === "127.0.0.1" ||
    identity.address === "127.0.0.1/32";

  if (
    identity.database !== "vivafrutaz_preview" ||
    identity.username !== "preview" ||
    !addressIsLoopback ||
    Number(identity.port) !== 55439 ||
    path.resolve(identity.dataDirectory) !== path.resolve(expectedDataDirectory)
  ) {
    throw new Error(
      "A identidade do servidor PostgreSQL não corresponde ao banco temporário descartável.",
    );
  }
}

/** Read-only proof that the local preview pool belongs to its marked temp cluster. */
export async function verifyIsolatedPreviewDatabase(
  query: ReadOnlyQuery,
  configuredDataDirectory: string | undefined,
): Promise<{ dataRoot: string; isolationId: string }> {
  if (!configuredDataDirectory) {
    throw new Error("ISOLATED_PREVIEW_DATA_DIR é obrigatório para validar o preview local.");
  }
  const configuredRoot = path.resolve(configuredDataDirectory);
  const tempRoot = await realpath(os.tmpdir());
  const root = await realpath(configuredRoot);
  const relative = path.relative(tempRoot, root);
  if (!relative || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error("O cluster local do preview não está em um diretório temporário isolado.");
  }

  const result = await query(`
    SELECT current_database() AS database,
           current_user AS username,
           inet_server_addr()::text AS address,
           inet_server_port() AS port,
           current_setting('data_directory') AS data_directory
  `);
  const identity = result.rows[0];
  if (!identity) throw new Error("A identidade PostgreSQL local não foi retornada.");
  const dataDirectory = await realpath(String(identity.data_directory));
  const expectedDataDirectory = await realpath(path.join(root, "postgres"));
  const rootName = path.basename(root);
  const prefix = "vivafrutaz-isolated-preview.";
  const isolationId = rootName.startsWith(prefix) ? rootName.slice(prefix.length) : "";
  if (
    path.basename(dataDirectory) !== "postgres" ||
    dataDirectory !== expectedDataDirectory ||
    !/^[a-zA-Z0-9]+$/.test(isolationId)
  ) {
    throw new Error("O PostgreSQL conectado não corresponde ao cluster temporário configurado.");
  }
  const marker = await readFile(path.join(root, ".isolated-preview-marker"), "utf8");
  if (marker !== `vivafrutaz-isolated-preview-v1:${isolationId}\n`) {
    throw new Error("O marcador do cluster temporário local não confere.");
  }
  assertIsolatedPreviewDatabaseIdentity({
    database: String(identity.database),
    username: String(identity.username),
    address: String(identity.address),
    port: Number(identity.port),
    dataDirectory,
  }, expectedDataDirectory);

  return { dataRoot: root, isolationId };
}

export function getRuntimeDatabaseUrl(): string {
  if (isRemoteHomologationMode()) {
    return validateRemoteHomologationConfig().databaseUrl;
  }
  if (hasRemoteHomologationConfiguration(process.env)) {
    throw new Error("Configuração de homologação remota detectada sem o modo explícito; fallback bloqueado.");
  }
  if (isIsolatedPreviewMode()) {
    return validateIsolatedPreviewDatabaseUrl(
      process.env.ISOLATED_PREVIEW_DATABASE_URL,
      process.env.NODE_ENV,
    );
  }

  return normalizeDatabaseUrl(
    process.env.SUPABASE_DATABASE_URL ?? process.env.DATABASE_URL ?? "",
  );
}

export function getRuntimeUploadsDirectory(): string {
  if (isRemoteHomologationMode()) {
    const dataRoot = validateTemporaryDirectory(
      process.env.ISOLATED_REMOTE_HOMOLOGATION_DATA_DIR,
      "ISOLATED_REMOTE_HOMOLOGATION_DATA_DIR",
    );
    return path.join(dataRoot, "uploads");
  }
  if (!isIsolatedPreviewMode()) {
    return path.resolve(process.cwd(), "uploads");
  }

  const configuredRoot = process.env.ISOLATED_PREVIEW_DATA_DIR;
  if (!configuredRoot) {
    throw new Error("ISOLATED_PREVIEW_DATA_DIR é obrigatório no preview isolado.");
  }

  const tempRoot = path.resolve(os.tmpdir());
  const dataRoot = path.resolve(configuredRoot);
  const relative = path.relative(tempRoot, dataRoot);
  if (
    relative === "" ||
    relative === ".." ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  ) {
    throw new Error("Os dados do preview isolado devem ficar dentro do diretório temporário.");
  }

  return path.join(dataRoot, "uploads");
}
