import pkg from 'pg';
const { Client } = pkg;
async function main() {
  const client = new Client({ connectionString: 'postgres://viva_user:SenhaForte123@localhost:5432/viva_db' });
  await client.connect();
  await client.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS empresa_id text;");
  await client.query("ALTER TABLE companies ADD COLUMN IF NOT EXISTS empresa_id text;");
  await client.query("UPDATE users SET empresa_id = '1' WHERE empresa_id IS NULL;");
  await client.query("UPDATE companies SET empresa_id = '1' WHERE empresa_id IS NULL;");
  console.log('empresa_id migration + backfill completo');
  await client.end();
}
main().catch(err => { console.error(err); process.exit(1); });