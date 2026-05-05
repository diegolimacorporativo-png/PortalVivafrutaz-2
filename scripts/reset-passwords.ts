/**
 * FASE: RESET CONTROLADO DE SENHAS (EXCETO MASTER)
 *
 * One-time script — run ONCE, then remove or comment out.
 *
 * Usage:
 *   npx tsx scripts/reset-passwords.ts
 *
 * Effect:
 *   - Resets all non-MASTER user passwords to new random temporaries
 *   - Sets mustChangePassword = true, passwordTemporary = true
 *   - Prints a one-time report to console (NOT saved anywhere)
 *   - MASTER user is completely untouched
 *   - Company (client) accounts are NOT touched by this script
 */
import "dotenv/config";
import { randomBytes } from "crypto";
import bcrypt from "bcryptjs";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { ne, eq } from "drizzle-orm";
import * as schema from "../shared/schema";

const { users } = schema;

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("[RESET] DATABASE_URL not set. Aborting.");
    process.exit(1);
  }

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const db = drizzle(pool, { schema });

  console.warn("======= INICIO RESET CONTROLADO DE SENHAS =======");
  console.warn("[RESET] Buscando usuários internos (role != MASTER)...");

  const targets = await db
    .select({ id: users.id, email: users.email, role: users.role })
    .from(users)
    .where(ne(users.role, "MASTER"));

  if (targets.length === 0) {
    console.warn("[RESET] Nenhum usuário encontrado para resetar.");
    await pool.end();
    return;
  }

  console.warn(`[RESET] ${targets.length} usuário(s) serão resetados.`);

  const report: { email: string; role: string; temporaryPassword: string }[] = [];

  for (const user of targets) {
    const tempPassword = randomBytes(8).toString("hex");
    const hashedPassword = await bcrypt.hash(tempPassword, 10);

    await db
      .update(users)
      .set({
        password: hashedPassword,
        mustChangePassword: true,
        passwordTemporary: true,
      } as any)
      .where(eq(users.id, user.id));

    report.push({
      email: user.email,
      role: user.role,
      temporaryPassword: tempPassword,
    });

    console.warn(`[RESET] ✓ ${user.email} (${user.role}) — senha resetada`);
  }

  console.warn("\n======= PASSWORD RESET REPORT =======");
  console.table(report);
  console.warn("=====================================");
  console.warn("[RESET] ATENÇÃO: Copie as senhas acima AGORA. Elas não serão exibidas novamente.");
  console.warn("[RESET] Distribua manualmente para cada usuário via canal seguro.");
  console.warn("[RESET] Script concluído. Remova ou comente este arquivo após o uso.\n");

  await pool.end();
}

main().catch((err) => {
  console.error("[RESET] Erro fatal:", err);
  process.exit(1);
});
