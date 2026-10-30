import dotenv from "dotenv";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { getRuntimeDatabaseUrl } from "../server/core/runtimeMode";
import { assertStartupSchemaReady } from "../server/bootstrap/startup-schema";

dotenv.config();

type Operation = "schema" | "recover-nfe" | "unlock-strategic-accounts";

function usage(): void {
  console.info(`Uso:
  npm run ops:startup -- schema --confirm-db=<nome-do-banco> [--apply]
  npm run ops:startup -- recover-nfe --confirm-db=<nome-do-banco> [--apply --confirm-no-nfe-in-flight]
  npm run ops:startup -- unlock-strategic-accounts --confirm-db=<nome-do-banco> [--apply --confirm-account-unlock]

Sem --apply, nenhum dado ou schema é alterado. O nome do banco deve coincidir
com o nome extraído da URL configurada; nenhum valor de credencial é exibido.`);
}

function parseDatabaseName(connectionString: string): string {
  const url = new URL(connectionString);
  return decodeURIComponent(url.pathname.replace(/^\//, ""));
}

async function main(): Promise<void> {
  const [operationArg, ...flags] = process.argv.slice(2);
  if (!operationArg || operationArg === "--help") return usage();
  if (!["schema", "recover-nfe", "unlock-strategic-accounts"].includes(operationArg)) {
    throw new Error("Operação desconhecida.");
  }
  const operation = operationArg as Operation;
  const apply = flags.includes("--apply");
  const confirmDb = flags.find((flag) => flag.startsWith("--confirm-db="))?.slice("--confirm-db=".length);
  const databaseUrl = getRuntimeDatabaseUrl();
  if (!databaseUrl) throw new Error("Configure DATABASE_URL/SUPABASE_DATABASE_URL no ambiente do operador.");
  const targetDatabase = parseDatabaseName(databaseUrl);
  if (!confirmDb || confirmDb !== targetDatabase) {
    throw new Error("Confirmação do banco ausente ou divergente. Nenhuma conexão foi aberta.");
  }
  if (apply && operation === "recover-nfe" && !flags.includes("--confirm-no-nfe-in-flight")) {
    throw new Error("Para recuperar NF-e, confirme primeiro que não há emissões em andamento.");
  }
  if (apply && operation === "unlock-strategic-accounts" && !flags.includes("--confirm-account-unlock")) {
    throw new Error("Para desbloquear contas, inclua --confirm-account-unlock.");
  }

  // Only connect after an explicit target database name has been confirmed.
  const { pool } = await import("../server/database/db");
  try {
    if (operation === "schema") {
      const migrationPath = path.resolve(process.cwd(), "migrations/20261030_startup_schema.sql");
      const migrationSql = await readFile(migrationPath, "utf8");
      const statements = migrationSql.split(";").map((statement) => statement.trim()).filter(Boolean);
      if (!apply) {
        console.info("Schema migration prepared; use --apply only after backup and target review.");
        console.info({ database: targetDatabase, migration: "migrations/20261030_startup_schema.sql", statements: statements.length });
        return;
      }
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        for (const statement of statements) await client.query(statement);
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
      await assertStartupSchemaReady((text) => pool.query(text));
      console.info("Startup schema applied and verified.", { database: targetDatabase });
      return;
    }

    if (operation === "recover-nfe") {
      const count = await pool.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM orders WHERE fiscal_status = 'enviando'`,
      );
      const candidates = Number(count.rows[0]?.count ?? 0);
      if (!apply) {
        console.info("NF-e recovery dry-run.", { database: targetDatabase, candidates });
        return;
      }
      const updated = await pool.query(
        `UPDATE orders SET fiscal_status = 'erro' WHERE fiscal_status = 'enviando' RETURNING id`,
      );
      console.info("NF-e recovery completed.", { database: targetDatabase, recovered: updated.rowCount ?? 0 });
      return;
    }

    const locked = await pool.query<{ count: string }>(`
      SELECT count(*)::text AS count
      FROM users
      WHERE role IN ('MASTER', 'ADMIN', 'DIRECTOR', 'DEVELOPER')
        AND (is_locked = true OR login_attempts > 0)
    `);
    const candidates = Number(locked.rows[0]?.count ?? 0);
    if (!apply) {
      console.info("Strategic account unlock dry-run.", { database: targetDatabase, candidates });
      return;
    }
    const { authService } = await import("../server/modules/auth/auth.service");
    await authService.unlockStrategicAccounts();
    console.info("Strategic account unlock operation completed.", { database: targetDatabase, candidates });
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error("[STARTUP_MAINTENANCE_BLOCKED]", error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
