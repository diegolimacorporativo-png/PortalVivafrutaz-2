import assert from "node:assert/strict";
import { test } from "node:test";
import { assertStartupSchemaReady } from "../../server/bootstrap/startup-schema";

const required = [
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
].map(([table_name, column_name]) => ({ table_name, column_name }));

test("startup schema readiness is a read-only query and accepts the required schema", async () => {
  let calls = 0;
  await assertStartupSchemaReady(async (query) => {
    calls++;
    assert.match(query, /information_schema\.columns/);
    assert.match(query, /pg_indexes/);
    assert.doesNotMatch(query, /\b(ALTER|CREATE|UPDATE|DELETE|INSERT)\b/i);
    return { rows: required };
  });
  assert.equal(calls, 1);
});

test("startup schema readiness fails before accepting traffic when required objects are absent", async () => {
  await assert.rejects(
    assertStartupSchemaReady(async () => ({ rows: [{ table_name: "orders", column_name: "id" }] })),
    /orders\.is_recurring.*session\.expire/,
  );
});
