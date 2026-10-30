type SchemaRequirement = { table_name: string; column_name: string };
type SchemaQuery = (text: string) => Promise<{ rows: SchemaRequirement[] }>;

const REQUIRED_COLUMNS = [
  ["orders", "is_recurring"],
  ["companies", "password_changed_at"],
  ["users", "password_changed_at"],
  ["recurring_order_logs", "id"],
  ["recurring_order_logs", "company_id"],
  ["recurring_order_logs", "week_key"],
  ["recurring_order_logs", "day_of_week"],
  ["recurring_order_logs", "order_id"],
  ["recurring_order_logs", "scope_count"],
  ["recurring_order_logs", "total_value"],
  ["recurring_order_logs", "created_at"],
  ["__index__", "recurring_order_logs_unique_week_day"],
  ["session", "sid"],
  ["session", "sess"],
  ["session", "expire"],
] as const;

/**
 * Read-only readiness check for schema that was historically created at boot.
 * It deliberately performs no DDL and fails startup before accepting traffic
 * when an operator has not applied the corresponding explicit migration.
 */
export async function assertStartupSchemaReady(query: SchemaQuery): Promise<void> {
  const result = await query(`
    SELECT table_name, column_name
    FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND (table_name, column_name) IN (
        ('orders', 'is_recurring'),
        ('companies', 'password_changed_at'),
        ('users', 'password_changed_at'),
        ('recurring_order_logs', 'id'),
        ('recurring_order_logs', 'company_id'),
        ('recurring_order_logs', 'week_key'),
        ('recurring_order_logs', 'day_of_week'),
        ('recurring_order_logs', 'order_id'),
        ('recurring_order_logs', 'scope_count'),
        ('recurring_order_logs', 'total_value'),
        ('recurring_order_logs', 'created_at'),
        ('session', 'sid'),
        ('session', 'sess'),
        ('session', 'expire')
      )
    UNION ALL
    SELECT '__index__' AS table_name, indexname AS column_name
    FROM pg_indexes
    WHERE schemaname = current_schema()
      AND indexname = 'recurring_order_logs_unique_week_day'
  `);

  const found = new Set(result.rows.map(({ table_name, column_name }) => `${table_name}.${column_name}`));
  const missing = REQUIRED_COLUMNS
    .map(([table, column]) => `${table}.${column}`)
    .filter((name) => !found.has(name));

  if (missing.length > 0) {
    throw new Error(
      `Schema obrigatório ausente (${missing.join(", ")}). ` +
      "Aplique a migration controlada migrations/20261030_startup_schema.sql antes de iniciar o servidor.",
    );
  }
}
