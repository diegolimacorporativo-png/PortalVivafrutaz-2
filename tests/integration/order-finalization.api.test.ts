import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { readFile, realpath } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import bcrypt from "bcryptjs";
import { Pool } from "pg";
import {
  assertIsolatedPreviewDatabaseIdentity,
  validateIsolatedPreviewDatabaseUrl,
} from "../../server/core/runtimeMode";

const databaseUrl = validateIsolatedPreviewDatabaseUrl(
  "postgresql://preview@127.0.0.1:55439/vivafrutaz_preview",
  "development",
);
const markerPrefix = "vivafrutaz-isolated-preview-v1:";

type OrderFixture = {
  id: number;
  deliveryIds: number[];
};

type ApiResult = {
  status: number;
  body: unknown;
};

async function verifyDisposableDatabase(pool: Pool): Promise<void> {
  const result = await pool.query<{
    database: string;
    username: string;
    address: string;
    port: number;
    data_directory: string;
  }>(`
    SELECT
      current_database() AS database,
      current_user AS username,
      inet_server_addr()::text AS address,
      inet_server_port() AS port,
      current_setting('data_directory') AS data_directory
  `);
  const identity = result.rows[0];
  const dataDirectory = await realpath(identity.data_directory);
  const dataRoot = path.dirname(dataDirectory);
  const relativeToTemp = path.relative(await realpath(os.tmpdir()), dataRoot);
  const rootName = path.basename(dataRoot);
  const nonce = rootName.startsWith("vivafrutaz-isolated-preview.")
    ? rootName.slice("vivafrutaz-isolated-preview.".length)
    : "";

  assert.equal(path.basename(dataDirectory), "postgres");
  assert.ok(
    relativeToTemp &&
      relativeToTemp !== ".." &&
      !relativeToTemp.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relativeToTemp),
    "PostgreSQL data directory must be inside its isolated /tmp root",
  );
  assert.match(nonce, /^[a-zA-Z0-9]+$/);
  const marker = await readFile(
    path.join(dataRoot, ".isolated-preview-marker"),
    "utf8",
  );
  assert.equal(marker, `${markerPrefix}${nonce}\n`);

  assertIsolatedPreviewDatabaseIdentity(
    { ...identity, dataDirectory },
    dataDirectory,
  );

  const schema = await pool.query<{
    orders: string | null;
    deliveries: string | null;
    workflow_events: string | null;
    session: string | null;
  }>(`
    SELECT
      to_regclass('public.orders')::text AS orders,
      to_regclass('public.deliveries')::text AS deliveries,
      to_regclass('public.workflow_events')::text AS workflow_events,
      to_regclass('public.session')::text AS session
  `);
  assert.ok(
    schema.rows[0]?.orders &&
      schema.rows[0]?.deliveries &&
      schema.rows[0]?.workflow_events &&
      schema.rows[0]?.session,
    "The isolated app schema and session table must be prepared before API tests",
  );
}

async function apiRequest(
  baseUrl: URL,
  route: string,
  init: RequestInit = {},
  cookie?: string,
): Promise<ApiResult & { headers: Headers }> {
  const headers = new Headers(init.headers);
  if (init.body && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }
  if (cookie) headers.set("cookie", cookie);

  const response = await fetch(new URL(route, baseUrl), { ...init, headers });
  const body = await response.json().catch(() => null);
  return { status: response.status, body, headers: response.headers };
}

test(
  "finalização manual de pedidos pelo endpoint real, em PostgreSQL isolado",
  { timeout: 90_000 },
  async (t) => {
    const devDomain = process.env.REPLIT_DEV_DOMAIN;
    assert.ok(
      devDomain && !devDomain.includes("://"),
      "REPLIT_DEV_DOMAIN é obrigatório; o teste não usa URL de produção",
    );
    const baseUrl = new URL(`https://${devDomain}`);
    assert.equal(baseUrl.protocol, "https:");

    const health = await apiRequest(baseUrl, "/api/health");
    assert.equal(
      health.status,
      200,
      "Inicie primeiro o workflow Start application com npm run dev:isolated",
    );

    const pool = new Pool({
      connectionString: databaseUrl,
      ssl: false,
      max: 1,
      connectionTimeoutMillis: 5_000,
    });

    try {
      await verifyDisposableDatabase(pool);

      const runId = randomBytes(8).toString("hex");
      const password = randomBytes(24).toString("hex");
      const passwordHash = await bcrypt.hash(password, 4);
      const companyResult = await pool.query<{ id: number }>(
        `INSERT INTO companies
          (company_name, contact_name, email, password, allowed_order_days)
         VALUES ($1, $2, $3, $4, '[]'::jsonb)
         RETURNING id`,
        [
          `Isolated API test ${runId}`,
          "Synthetic test user",
          `isolated-company-${runId}@example.invalid`,
          passwordHash,
        ],
      );
      const companyId = companyResult.rows[0].id;
      const userResult = await pool.query<{ id: number }>(
        `INSERT INTO users
          (empresa_id, name, email, password, role, password_changed_at)
         VALUES ($1, $2, $3, $4, 'ADMIN', NOW())
         RETURNING id`,
        [
          companyId,
          "Isolated API test admin",
          `isolated-admin-${runId}@example.invalid`,
          passwordHash,
        ],
      );

      const login = await apiRequest(baseUrl, "/api/auth/login", {
        method: "POST",
        body: JSON.stringify({
          email: `isolated-admin-${runId}@example.invalid`,
          password,
          type: "admin",
        }),
      });
      assert.equal(
        login.status,
        200,
        `Synthetic tenant admin login failed: ${JSON.stringify(login.body)}`,
      );
      const setCookie = login.headers.get("set-cookie");
      assert.ok(setCookie, "Login did not issue a session cookie");
      const sessionCookie = setCookie.split(";")[0];
      const requestJson = (
        route: string,
        method: string,
        payload: Record<string, unknown>,
      ) =>
        apiRequest(
          baseUrl,
          route,
          { method, body: JSON.stringify(payload) },
          sessionCookie,
        );

      async function createOrder(
        tag: string,
        statuses: string[],
      ): Promise<OrderFixture> {
        const orderCode = `ISO-${runId}-${tag}`;
        const orderResult = await pool.query<{ id: number }>(
          `INSERT INTO orders
            (order_code, status, workflow_status, company_id, delivery_date,
             week_reference, total_value)
           VALUES ($1, 'CONFIRMED', 'SHIPPED', $2, NOW() + INTERVAL '2 days',
                   $3, 1.00)
           RETURNING id`,
          [orderCode, companyId, `isolated-${runId}`],
        );
        const orderId = orderResult.rows[0].id;
        const deliveryIds: number[] = [];

        for (const status of statuses) {
          const deliveryResult = await pool.query<{ id: number }>(
            `INSERT INTO deliveries (order_id, company_id, status)
             VALUES ($1, $2, $3)
             RETURNING id`,
            [orderId, companyId, status],
          );
          deliveryIds.push(deliveryResult.rows[0].id);
        }

        return { id: orderId, deliveryIds };
      }

      async function orderState(orderId: number): Promise<string> {
        const result = await pool.query<{ workflow_status: string }>(
          "SELECT workflow_status FROM orders WHERE id = $1",
          [orderId],
        );
        assert.ok(result.rows[0], `Order ${orderId} disappeared`);
        return result.rows[0].workflow_status;
      }

      async function workflowEventCount(orderId: number): Promise<number> {
        const result = await pool.query<{ count: number }>(
          "SELECT count(*)::int AS count FROM workflow_events WHERE order_id = $1",
          [orderId],
        );
        return result.rows[0].count;
      }

      await t.test("entrega pendente bloqueia e não cria evento", async () => {
        const order = await createOrder("pending", ["entregue", "pendente"]);
        const response = await requestJson(
          `/api/orders/${order.id}/transition`,
          "POST",
          { to: "DELIVERED" },
        );

        assert.equal(response.status, 400);
        assert.equal(await orderState(order.id), "SHIPPED");
        assert.equal(await workflowEventCount(order.id), 0);
      });

      let deliveredOrder: OrderFixture;
      await t.test("todas as entregas entregues finalizam uma vez", async () => {
        deliveredOrder = await createOrder("delivered", [
          "entregue",
          "entregue",
        ]);
        const response = await requestJson(
          `/api/orders/${deliveredOrder.id}/transition`,
          "POST",
          { to: "DELIVERED" },
        );

        assert.equal(response.status, 200);
        assert.equal(await orderState(deliveredOrder.id), "DELIVERED");
        assert.equal(await workflowEventCount(deliveredOrder.id), 1);
      });

      await t.test("repetir a finalização não duplica evento", async () => {
        const response = await requestJson(
          `/api/orders/${deliveredOrder.id}/transition`,
          "POST",
          { to: "DELIVERED" },
        );

        assert.ok(response.status >= 400);
        assert.equal(await workflowEventCount(deliveredOrder.id), 1);
      });

      await t.test("entregues e canceladas permitem finalizar", async () => {
        const order = await createOrder("mixed-terminal", [
          "entregue",
          "cancelado",
        ]);
        const response = await requestJson(
          `/api/orders/${order.id}/transition`,
          "POST",
          { to: "DELIVERED" },
        );

        assert.equal(response.status, 200);
        assert.equal(await orderState(order.id), "DELIVERED");
        assert.equal(await workflowEventCount(order.id), 1);
      });

      await t.test("falha ao inserir evento reverte a transação", async () => {
        const order = await createOrder("outbox-failure", [
          "entregue",
          "entregue",
        ]);
        const suffix = randomBytes(6).toString("hex");
        const functionName = `iso_outbox_fail_${suffix}`;
        const triggerName = `iso_outbox_fail_${suffix}`;

        try {
          await pool.query(`
            CREATE FUNCTION "${functionName}"() RETURNS trigger AS $$
            BEGIN
              IF NEW.order_id = ${order.id} THEN
                RAISE EXCEPTION 'isolated API test outbox failpoint';
              END IF;
              RETURN NEW;
            END;
            $$ LANGUAGE plpgsql
          `);
          await pool.query(`
            CREATE TRIGGER "${triggerName}"
            BEFORE INSERT ON workflow_events
            FOR EACH ROW EXECUTE FUNCTION "${functionName}"()
          `);

          const response = await requestJson(
            `/api/orders/${order.id}/transition`,
            "POST",
            { to: "DELIVERED" },
          );

          assert.equal(response.status, 500);
          assert.equal(await orderState(order.id), "SHIPPED");
          assert.equal(await workflowEventCount(order.id), 0);
        } finally {
          await pool.query(
            `DROP TRIGGER IF EXISTS "${triggerName}" ON workflow_events`,
          );
          await pool.query(`DROP FUNCTION IF EXISTS "${functionName}"()`);
        }
      });

      await t.test(
        "cancelar uma entrega deixa a irmã pendente e o pedido aberto",
        async () => {
          const order = await createOrder("cancel-sibling", [
            "pendente",
            "pendente",
          ]);
          const cancelledId = order.deliveryIds[0];
          const siblingId = order.deliveryIds[1];
          const response = await requestJson(
            `/api/deliveries/${cancelledId}/status`,
            "PATCH",
            { status: "cancelado" },
          );

          assert.equal(response.status, 200);
          const deliveries = await pool.query<{
            id: number;
            status: string;
          }>(
            "SELECT id, status FROM deliveries WHERE id = ANY($1::int[]) ORDER BY id",
            [[cancelledId, siblingId]],
          );
          assert.deepEqual(
            deliveries.rows.map((delivery) => delivery.status),
            ["cancelado", "pendente"],
          );
          assert.equal(await orderState(order.id), "SHIPPED");
        },
      );
    } finally {
      await pool.end();
    }
  },
);
