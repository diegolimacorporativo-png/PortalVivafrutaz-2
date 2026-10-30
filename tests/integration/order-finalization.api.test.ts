import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { readFile, realpath } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import bcrypt from "bcryptjs";
import { Pool } from "pg";
import {
  assertRemoteHomologationDatabaseIsEmpty,
  assertIsolatedPreviewDatabaseIdentity,
  isRemoteHomologationMode,
  validateRemoteHomologationApiUrl,
  validateRemoteHomologationConfig,
  validateIsolatedPreviewDatabaseUrl,
  verifyRemoteHomologationDatabaseIdentity,
} from "../../server/core/runtimeMode";

const remoteMode = isRemoteHomologationMode();
const remoteConfig = remoteMode ? validateRemoteHomologationConfig() : undefined;
const databaseUrl = remoteMode
  ? remoteConfig!.databaseUrl
  : validateIsolatedPreviewDatabaseUrl(
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

async function verifyDisposableDatabase(pool: Pool): Promise<string> {
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
  return dataRoot;
}

async function verifyRemoteDatabase(pool: Pool) {
  if (!remoteConfig) throw new Error("Configuração remota ausente.");
  const identity = await verifyRemoteHomologationDatabaseIdentity(
    (text) => pool.query(text),
    remoteConfig,
  );
  await assertRemoteHomologationDatabaseIsEmpty((text) => pool.query(text));
  return identity;
}

function sessionIdFromCookie(cookie: string | undefined): string | undefined {
  if (!cookie) return undefined;
  const cookieValue = cookie.split(";")[0]?.slice("sessionId=".length);
  if (!cookieValue) return undefined;
  const decoded = decodeURIComponent(cookieValue);
  if (!decoded.startsWith("s:")) return undefined;
  return decoded.slice(2).split(".")[0] || undefined;
}

async function cleanupRunRecords(
  pool: Pool,
  ids: {
    companyIds: number[];
    userIds: number[];
    orderIds: number[];
    productIds: number[];
    sessionId?: string;
  },
): Promise<void> {
  if (ids.sessionId) {
    await pool.query('DELETE FROM "session" WHERE sid = $1', [ids.sessionId]);
  }
  if (ids.orderIds.length) {
    await pool.query("DELETE FROM workflow_events WHERE order_id = ANY($1::int[])", [ids.orderIds]);
    await pool.query("DELETE FROM deliveries WHERE order_id = ANY($1::int[])", [ids.orderIds]);
    await pool.query("DELETE FROM order_items WHERE order_id = ANY($1::int[])", [ids.orderIds]);
    await pool.query("DELETE FROM accounts_receivable WHERE order_id = ANY($1::int[])", [ids.orderIds]);
    await pool.query(
      "DELETE FROM inventory_movements WHERE reference_type = 'order' AND reference_id = ANY($1::int[])",
      [ids.orderIds],
    );
    await pool.query("DELETE FROM orders WHERE id = ANY($1::int[])", [ids.orderIds]);
  }
  if (ids.companyIds.length || ids.userIds.length) {
    await pool.query(
      "DELETE FROM system_logs WHERE company_id = ANY($1::int[]) OR user_id = ANY($2::int[])",
      [ids.companyIds, ids.userIds],
    );
    await pool.query(
      "DELETE FROM audit_logs WHERE tenant_id = ANY($1::text[]) OR user_id = ANY($2::text[])",
      [ids.companyIds.map(String), ids.userIds.map(String)],
    );
    await pool.query(
      "DELETE FROM auth_attempts WHERE company_id = ANY($1::int[]) OR user_id = ANY($2::int[])",
      [ids.companyIds, ids.userIds],
    );
  }
  if (ids.productIds.length) {
    await pool.query("DELETE FROM inventory_settings WHERE product_id = ANY($1::int[])", [ids.productIds]);
    await pool.query("DELETE FROM products WHERE id = ANY($1::int[])", [ids.productIds]);
  }
  if (ids.userIds.length) {
    await pool.query("DELETE FROM users WHERE id = ANY($1::int[])", [ids.userIds]);
  }
  if (ids.companyIds.length) {
    await pool.query("DELETE FROM companies WHERE id = ANY($1::int[])", [ids.companyIds]);
  }
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
    let baseUrl: URL;
    if (remoteMode) {
      baseUrl = validateRemoteHomologationApiUrl(
        process.env.ISOLATED_REMOTE_HOMOLOGATION_API_URL,
      );
    } else {
      const devDomain = process.env.REPLIT_DEV_DOMAIN;
      assert.ok(
        devDomain && !devDomain.includes("://"),
        "REPLIT_DEV_DOMAIN é obrigatório; o teste não usa URL de produção",
      );
      baseUrl = new URL(`https://${devDomain}`);
      assert.equal(baseUrl.protocol, "https:");
    }

    const pool = new Pool({
      connectionString: databaseUrl,
      ssl: false,
      max: 1,
      connectionTimeoutMillis: 5_000,
    });
    let servicePool: Pool | undefined;
    const runRecords = {
      companyIds: [] as number[],
      userIds: [] as number[],
      orderIds: [] as number[],
      productIds: [] as number[],
      sessionId: undefined as string | undefined,
    };

    try {
      const dataRoot = remoteMode ? undefined : await verifyDisposableDatabase(pool);
      const remoteIdentity = remoteMode ? await verifyRemoteDatabase(pool) : undefined;
      const isolationId = dataRoot
        ? path.basename(dataRoot).replace(/^vivafrutaz-isolated-preview\./, "")
        : undefined;

      // Prove that the HTTP server is attached to the exact temporary PG
      // instance validated by this harness before sending any mutating request.
      const health = await apiRequest(baseUrl, "/api/health");
      assert.equal(
        health.status,
        200,
        remoteMode
          ? "Inicie o servidor de homologação remota em loopback após validar a identidade PostgreSQL."
          : "Inicie primeiro o workflow Start application com npm run dev:isolated",
      );
      if (remoteMode) {
        assert.deepEqual(health.body, {
          status: "ok",
          isolatedRemoteHomologation: true,
          databaseIdentityVerified: true,
          ...remoteIdentity,
        }, "O servidor HTTP precisa comprovar o mesmo projeto, banco, esquema e marcador do harness");
      } else {
        assert.deepEqual(health.body, {
          status: "ok",
          isolatedPreview: true,
          databaseProvider: "isolated-preview-postgres",
          databaseIdentityVerified: true,
          isolationId,
        }, "O servidor HTTP precisa comprovar a mesma instância PostgreSQL descartável do harness");
      }

      // Configure the test process before importing any service module. This
      // prevents db.ts from loading .env and makes its pool use the exact same
      // validated disposable PostgreSQL as this harness.
      process.env.NODE_ENV = remoteMode ? process.env.NODE_ENV : "development";
      if (remoteMode) {
        process.env.ISOLATED_PREVIEW_MODE = "0";
      } else {
        process.env.ISOLATED_PREVIEW_MODE = "1";
        process.env.ISOLATED_PREVIEW_DATABASE_URL = databaseUrl;
        process.env.ISOLATED_PREVIEW_DATA_DIR = dataRoot!;
        process.env.DOTENV_CONFIG_PATH = path.join(dataRoot!, ".dotenv-disabled");
      }
      const [{ ordersService }, { runWithTenant }, appDatabase] = await Promise.all([
        import("../../server/modules/orders/orders.service"),
        import("../../server/core/tenant/context"),
        import("../../server/database/db"),
      ]);
      servicePool = appDatabase.pool;
      if (remoteMode) {
        const serviceIdentity = await verifyRemoteHomologationDatabaseIdentity(
          (text) => servicePool!.query(text),
          remoteConfig!,
        );
        assert.deepEqual(serviceIdentity, remoteIdentity,
          "O pool importado pelo serviço deve usar o mesmo projeto, banco, esquema e marcador validado pelo harness");
      } else {
        await verifyDisposableDatabase(servicePool);
      }

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
      runRecords.companyIds.push(companyId);
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
        `Synthetic tenant admin login failed with HTTP ${login.status}.`,
      );
      const setCookie = login.headers.get("set-cookie");
      assert.ok(setCookie, "Login did not issue a session cookie");
      const sessionCookie = setCookie.split(";")[0];
      const adminId = userResult.rows[0].id;
      runRecords.userIds.push(adminId);
      runRecords.sessionId = sessionIdFromCookie(setCookie);
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
        runRecords.orderIds.push(orderId);
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

      await t.test(
        "liberação de pedido confirmado não consulta saldo nem cria efeitos de estoque/financeiro",
        async () => {
          const orderCode = `ISO-${runId}-on-demand`;
          const orderResult = await pool.query<{ id: number }>(
            `INSERT INTO orders
              (order_code, status, workflow_status, company_id, delivery_date,
               week_reference, total_value)
             VALUES ($1, 'ACTIVE', 'CUSTOMER_CONFIRMED', $2, NOW() + INTERVAL '2 days',
                     $3, 12.00)
             RETURNING id`,
            [orderCode, companyId, `isolated-${runId}`],
          );
          const orderId = orderResult.rows[0].id;
          runRecords.orderIds.push(orderId);
          const productResult = await pool.query<{ id: number }>(
            `INSERT INTO products (empresa_id, name, category, unit, active)
             VALUES ($1, $2, 'Synthetic', 'un', true)
             RETURNING id`,
            [companyId, `Synthetic on-demand ${runId}`],
          );
          const productId = productResult.rows[0].id;
          runRecords.productIds.push(productId);
          await pool.query(
            `INSERT INTO order_items
              (empresa_id, order_id, product_id, quantity, unit_price, total_price)
             VALUES ($1, $2, $3, 2, 6.00, 12.00)`,
            [companyId, orderId, productId],
          );
          await pool.query(
            `INSERT INTO inventory_settings
              (empresa_id, product_id, product_name, unit, current_stock, min_stock)
             VALUES ($1, $2, $3, 'un', 0, 0)`,
            [companyId, productId, `Synthetic on-demand ${runId}`],
          );

          const suffix = randomBytes(6).toString("hex");
          const functionName = `iso_forbid_order_side_effects_${suffix}`;
          const arTrigger = `iso_forbid_order_ar_${suffix}`;
          const movementTrigger = `iso_forbid_order_movement_${suffix}`;
          try {
            await pool.query(`
              CREATE FUNCTION "${functionName}"() RETURNS trigger AS $$
              BEGIN
                IF TG_TABLE_NAME = 'accounts_receivable' THEN
                  IF NEW.order_id = ${orderId} THEN
                    RAISE EXCEPTION 'isolated test forbids order accounts-receivable side effect';
                  END IF;
                ELSIF TG_TABLE_NAME = 'inventory_movements' THEN
                  IF NEW.reference_id = ${orderId} THEN
                    RAISE EXCEPTION 'isolated test forbids order inventory side effect';
                  END IF;
                END IF;
                RETURN NEW;
              END;
              $$ LANGUAGE plpgsql
            `);
            await pool.query(`
              CREATE TRIGGER "${arTrigger}"
              BEFORE INSERT ON accounts_receivable
              FOR EACH ROW EXECUTE FUNCTION "${functionName}"()
            `);
            await pool.query(`
              CREATE TRIGGER "${movementTrigger}"
              BEFORE INSERT ON inventory_movements
              FOR EACH ROW EXECUTE FUNCTION "${functionName}"()
            `);

            const response = await requestJson(
              `/api/orders/${orderId}`,
              "PATCH",
              { status: "CONFIRMED" },
            );
            assert.equal(response.status, 200);

            const state = await pool.query<{ status: string; workflow_status: string }>(
              "SELECT status, workflow_status FROM orders WHERE id = $1",
              [orderId],
            );
            assert.deepEqual(state.rows[0], {
              status: "CONFIRMED",
              workflow_status: "APPROVED",
            });

            const stock = await pool.query<{ current_stock: string }>(
              "SELECT current_stock::text FROM inventory_settings WHERE product_id = $1",
              [productId],
            );
            assert.equal(Number(stock.rows[0]?.current_stock), 0);

            const [deliveriesCount, receivablesCount, movementsCount] = await Promise.all([
              pool.query<{ count: number }>(
                "SELECT count(*)::int AS count FROM deliveries WHERE order_id = $1",
                [orderId],
              ),
              pool.query<{ count: number }>(
                "SELECT count(*)::int AS count FROM accounts_receivable WHERE order_id = $1",
                [orderId],
              ),
              pool.query<{ count: number }>(
                `SELECT count(*)::int AS count FROM inventory_movements
                 WHERE reference_type = 'order' AND reference_id = $1`,
                [orderId],
              ),
            ]);
            assert.equal(deliveriesCount.rows[0]?.count, 1);
            assert.equal(receivablesCount.rows[0]?.count, 0);
            assert.equal(movementsCount.rows[0]?.count, 0);

            const retry = await requestJson(
              `/api/orders/${orderId}`,
              "PATCH",
              { status: "CONFIRMED" },
            );
            assert.equal(retry.status, 200);
            assert.equal(await workflowEventCount(orderId), 1);
          } finally {
            await pool.query(`DROP TRIGGER IF EXISTS "${arTrigger}" ON accounts_receivable`);
            await pool.query(`DROP TRIGGER IF EXISTS "${movementTrigger}" ON inventory_movements`);
            await pool.query(`DROP FUNCTION IF EXISTS "${functionName}"()`);
          }
        },
      );

      await t.test("create-with-delivery reverte o pedido se a entrega falhar e cria ambos juntos quando funciona", async () => {
        const suffix = randomBytes(6).toString("hex");
        const functionName = `iso_fail_delivery_${suffix}`;
        const triggerName = `iso_fail_delivery_trigger_${suffix}`;
        const before = await pool.query<{ count: number }>(
          "SELECT count(*)::int AS count FROM orders WHERE company_id = $1",
          [companyId],
        );
        const requestContext = {
          principal: { kind: "admin" as const, empresaId: companyId, userId: adminId, role: "ADMIN" },
          empresaId: companyId,
        };

        await pool.query(`
          CREATE FUNCTION "${functionName}"() RETURNS trigger AS $$
          BEGIN
            IF NEW.company_id = ${companyId} THEN
              RAISE EXCEPTION 'isolated test forces initial delivery failure';
            END IF;
            RETURN NEW;
          END;
          $$ LANGUAGE plpgsql
        `);
        await pool.query(`
          CREATE TRIGGER "${triggerName}"
          BEFORE INSERT ON deliveries
          FOR EACH ROW EXECUTE FUNCTION "${functionName}"()
        `);
        try {
          await assert.rejects(() => runWithTenant(requestContext, () =>
            ordersService.createWithDelivery(
              { companyId, deliveryDate: "2026-10-30", items: [] },
              { userId: adminId, companyId, role: "ADMIN" },
            ),
          ));
          const afterFailure = await pool.query<{ count: number }>(
            "SELECT count(*)::int AS count FROM orders WHERE company_id = $1",
            [companyId],
          );
          assert.equal(afterFailure.rows[0].count, before.rows[0].count);
        } finally {
          await pool.query(`DROP TRIGGER IF EXISTS "${triggerName}" ON deliveries`);
          await pool.query(`DROP FUNCTION IF EXISTS "${functionName}"()`);
        }

        const created = await runWithTenant(requestContext, () =>
          ordersService.createWithDelivery(
            { companyId, deliveryDate: "2026-10-30", items: [] },
            { userId: adminId, companyId, role: "ADMIN" },
          ),
        );
        runRecords.orderIds.push(created.order.id);
        assert.ok(created.order.id);
        assert.equal(created.delivery.orderId, created.order.id);
        const links = await pool.query<{ count: number }>(
          "SELECT count(*)::int AS count FROM deliveries WHERE order_id = $1",
          [created.order.id],
        );
        assert.equal(links.rows[0].count, 1);
      });

      await t.test("aprovações concorrentes deixam uma entrega e um evento para o pedido", async () => {
        const orderCode = `ISO-${runId}-concurrent-release`;
        const orderResult = await pool.query<{ id: number }>(
          `INSERT INTO orders
            (order_code, status, workflow_status, company_id, delivery_date,
             week_reference, total_value)
           VALUES ($1, 'ACTIVE', 'CUSTOMER_CONFIRMED', $2, NOW() + INTERVAL '2 days',
                   $3, 0.00)
           RETURNING id`,
          [orderCode, companyId, `isolated-${runId}`],
        );
        const orderId = orderResult.rows[0].id;
        runRecords.orderIds.push(orderId);
        const responses = await Promise.all([
          requestJson(`/api/orders/${orderId}`, "PATCH", { status: "CONFIRMED" }),
          requestJson(`/api/orders/${orderId}`, "PATCH", { status: "CONFIRMED" }),
        ]);
        assert.ok(responses.some((response) => response.status === 200));
        assert.ok(responses.every((response) => response.status === 200 || response.status === 409));
        const [deliveryCount, eventCount] = await Promise.all([
          pool.query<{ count: number }>(
            "SELECT count(*)::int AS count FROM deliveries WHERE order_id = $1",
            [orderId],
          ),
          pool.query<{ count: number }>(
            "SELECT count(*)::int AS count FROM workflow_events WHERE order_id = $1",
            [orderId],
          ),
        ]);
        assert.equal(deliveryCount.rows[0].count, 1);
        assert.equal(eventCount.rows[0].count, 1);
      });

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

      await t.test("entrega cancelada não conta como pedido entregue", async () => {
        const order = await createOrder("mixed-terminal", [
          "entregue",
          "cancelado",
        ]);
        const response = await requestJson(
          `/api/orders/${order.id}/transition`,
          "POST",
          { to: "DELIVERED" },
        );

        assert.equal(response.status, 400);
        assert.equal(await orderState(order.id), "SHIPPED");
        assert.equal(await workflowEventCount(order.id), 0);
      });

      await t.test("todas as entregas canceladas não finalizam o pedido", async () => {
        const order = await createOrder("all-cancelled", ["cancelado", "cancelado"]);
        const response = await requestJson(
          `/api/orders/${order.id}/transition`,
          "POST",
          { to: "DELIVERED" },
        );
        assert.equal(response.status, 400);
        assert.equal(await orderState(order.id), "SHIPPED");
        assert.equal(await workflowEventCount(order.id), 0);
      });

      await t.test("entrega manual vinculada é serializada e rejeita pedido terminal", async () => {
        const order = await createOrder("manual-delivery-terminal", ["entregue"]);
        await pool.query(
          "UPDATE orders SET workflow_status = 'DELIVERED', status = 'DELIVERED' WHERE id = $1",
          [order.id],
        );
        const response = await requestJson("/api/deliveries", "POST", {
          orderId: order.id,
          status: "pendente",
        });
        assert.ok(response.status === 409 || response.status === 400);
        const pending = await pool.query<{ count: number }>(
          "SELECT count(*)::int AS count FROM deliveries WHERE order_id = $1 AND status = 'pendente'",
          [order.id],
        );
        assert.equal(pending.rows[0].count, 0);
      });

      await t.test("entregas manuais divididas concorrentes preservam ambas sem corrida de finalização", async () => {
        const order = await createOrder("manual-delivery-split", []);
        const responses = await Promise.all([
          requestJson("/api/deliveries", "POST", { orderId: order.id, status: "pendente" }),
          requestJson("/api/deliveries", "POST", { orderId: order.id, status: "pendente" }),
        ]);
        assert.deepEqual(responses.map((response) => response.status), [201, 201]);
        const persisted = await pool.query<{ count: number }>(
          "SELECT count(*)::int AS count FROM deliveries WHERE order_id = $1",
          [order.id],
        );
        assert.equal(persisted.rows[0].count, 2);
      });

      await t.test("criação manual de entrega vinculada faz rollback se a inserção falhar", async () => {
        const order = await createOrder("manual-delivery-rollback", []);
        const suffix = randomBytes(6).toString("hex");
        const functionName = `iso_manual_delivery_fail_${suffix}`;
        const triggerName = `iso_manual_delivery_fail_${suffix}`;
        await pool.query(`
          CREATE FUNCTION "${functionName}"() RETURNS trigger AS $$
          BEGIN
            IF NEW.order_id = ${order.id} THEN
              RAISE EXCEPTION 'isolated manual delivery insert failpoint';
            END IF;
            RETURN NEW;
          END;
          $$ LANGUAGE plpgsql
        `);
        await pool.query(`CREATE TRIGGER "${triggerName}" BEFORE INSERT ON deliveries FOR EACH ROW EXECUTE FUNCTION "${functionName}"()`);
        try {
          const response = await requestJson("/api/deliveries", "POST", {
            orderId: order.id,
            status: "pendente",
          });
          assert.equal(response.status, 500);
          const persisted = await pool.query<{ count: number }>(
            "SELECT count(*)::int AS count FROM deliveries WHERE order_id = $1",
            [order.id],
          );
          assert.equal(persisted.rows[0].count, 0);
        } finally {
          await pool.query(`DROP TRIGGER IF EXISTS "${triggerName}" ON deliveries`);
          await pool.query(`DROP FUNCTION IF EXISTS "${functionName}"()`);
        }
      });

      await t.test("criação manual concorrente com finalização nunca deixa pedido entregue com entrega pendente", async () => {
        const order = await createOrder("manual-vs-finalize", ["entregue"]);
        const [manual, finalize] = await Promise.all([
          requestJson("/api/deliveries", "POST", { orderId: order.id, status: "pendente" }),
          requestJson(`/api/orders/${order.id}/transition`, "POST", { to: "DELIVERED" }),
        ]);
        assert.ok(manual.status === 201 || manual.status === 409 || manual.status === 400);
        assert.ok(finalize.status === 200 || finalize.status === 400 || finalize.status === 409);
        const state = await pool.query<{ workflow_status: string; pending_count: number }>(
          `SELECT o.workflow_status,
                  count(*) FILTER (WHERE d.status = 'pendente')::int AS pending_count
           FROM orders o LEFT JOIN deliveries d ON d.order_id = o.id
           WHERE o.id = $1 GROUP BY o.id`,
          [order.id],
        );
        assert.ok(state.rows[0]);
        assert.ok(!(state.rows[0].workflow_status === "DELIVERED" && state.rows[0].pending_count > 0));
      });

      await t.test("POST de entrega manual oculta pedido inexistente ou de outra empresa", async () => {
        const missing = await requestJson("/api/deliveries", "POST", {
          orderId: 2_000_000_000,
          status: "pendente",
        });
        assert.equal(missing.status, 404);
        const otherCompany = await pool.query<{ id: number }>(
          `INSERT INTO companies (company_name, contact_name, email, password, allowed_order_days)
           VALUES ($1, $2, $3, $4, '[]'::jsonb) RETURNING id`,
          [`Other isolated ${runId}`, "Synthetic", `other-${runId}@example.invalid`, await bcrypt.hash(randomBytes(24).toString("hex"), 4)],
        );
        runRecords.companyIds.push(otherCompany.rows[0].id);
        const foreignOrder = await pool.query<{ id: number }>(
          `INSERT INTO orders (order_code, status, workflow_status, company_id, delivery_date, week_reference, total_value)
           VALUES ($1, 'CONFIRMED', 'INVOICED', $2, NOW() + INTERVAL '2 days', $3, 0)
           RETURNING id`,
          [`ISO-${runId}-foreign-order`, otherCompany.rows[0].id, `isolated-${runId}`],
        );
        runRecords.orderIds.push(foreignOrder.rows[0].id);
        const otherTenant = await requestJson("/api/deliveries", "POST", {
          orderId: foreignOrder.rows[0].id,
          status: "pendente",
        });
        assert.equal(otherTenant.status, 404);
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
      if (
        runRecords.companyIds.length || runRecords.userIds.length ||
        runRecords.orderIds.length || runRecords.productIds.length || runRecords.sessionId
      ) {
        await cleanupRunRecords(pool, runRecords);
      }
      if (servicePool) await servicePool.end();
      await pool.end();
    }
  },
);
