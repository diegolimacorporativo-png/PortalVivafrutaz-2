import os from "node:os";
import path from "node:path";

const ISOLATED_PREVIEW_DATABASE = {
  host: "127.0.0.1",
  port: "55439",
  database: "/vivafrutaz_preview",
  username: "preview",
} as const;

export function isIsolatedPreviewMode(): boolean {
  return process.env.ISOLATED_PREVIEW_MODE === "1";
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

export function getRuntimeDatabaseUrl(): string {
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
