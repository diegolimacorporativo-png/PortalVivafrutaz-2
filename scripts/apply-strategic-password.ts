import bcrypt from 'bcryptjs';
import { db } from '../server/database/db';
import { users, authAttempts } from '../shared/schema';
import { inArray, eq } from 'drizzle-orm';

const STRATEGIC_ROLES = ['MASTER', 'ADMIN', 'DIRECTOR', 'DEVELOPER'];
const PASSWORD = 'VivaFrutaz@2026!';

async function main() {
  console.log('[STRATEGIC_PASSWORD] Hashing VivaFrutaz@2026! (cost=10)...');
  const hash = await bcrypt.hash(PASSWORD, 10);

  const strategicUsers = await db
    .select({ id: users.id, email: users.email, role: users.role, password: users.password })
    .from(users)
    .where(inArray(users.role, STRATEGIC_ROLES));

  console.log(`[STRATEGIC_PASSWORD] Found ${strategicUsers.length} strategic accounts`);

  for (const u of strategicUsers) {
    const alreadySet = u.password
      ? await bcrypt.compare(PASSWORD, u.password).catch(() => false)
      : false;

    if (alreadySet) {
      console.log(`[STRATEGIC_PASSWORD] ${u.role} ${u.email} — senha já correta, pulando`);
      continue;
    }

    await db
      .update(users)
      .set({ password: hash, isLocked: false, loginAttempts: 0 })
      .where(eq(users.id, u.id));

    await db.delete(authAttempts).where(eq(authAttempts.userId, u.id));

    console.log(`[STRATEGIC_PASSWORD] ✓ Senha aplicada para ${u.role} ${u.email} (id=${u.id})`);
  }

  console.log('[STRATEGIC_PASSWORD] Concluído.');
  process.exit(0);
}

main().catch(err => {
  console.error('[STRATEGIC_PASSWORD_ERROR]', err?.message ?? err);
  process.exit(1);
});
