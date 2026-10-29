import { test } from "node:test";
import assert from "node:assert/strict";

const { purgeCompanyAndReferences } = await import("../../server/modules/companies/company-purge");
const { ConflictError } = await import("../../server/shared/errors/AppError");

function makePool(options: { failOnDelete?: boolean } = {}) {
  const statements: string[] = [];
  let releases = 0;
  const client = {
    async query(query: string, params: unknown[] = []) {
      statements.push(query.trim());
      if (query.includes("company-purge:root")) {
        return { rows: [{ row_ref: "16384:(0,1)", table_oid: 1 }], rowCount: 1 };
      }
      if (query.includes("company-purge:foreign-keys")) {
        return {
          rows: [
            { constraintId: 101, childOid: 2, parentOid: 1, childSchema: "public", childTable: "orders", parentSchema: "public", parentTable: "companies", childColumns: '["company_id"]', parentColumns: '["id"]', childKind: "r", parentKind: "r" },
            { constraintId: 102, childOid: 3, parentOid: 2, childSchema: "public", childTable: "order_items", parentSchema: "public", parentTable: "orders", childColumns: ["order_id"], parentColumns: ["id"], childKind: "r", parentKind: "r" },
            { constraintId: 103, childOid: 4, parentOid: 2, childSchema: "public", childTable: "nfe_emissoes", parentSchema: "public", parentTable: "orders", childColumns: ["order_id"], parentColumns: ["id"], childKind: "r", parentKind: "r" },
            { constraintId: 104, childOid: 5, parentOid: 4, childSchema: "public", childTable: "nfe_cce", parentSchema: "public", parentTable: "nfe_emissoes", childColumns: ["nfe_id"], parentColumns: ["id"], childKind: "r", parentKind: "r" },
          ],
          rowCount: 2,
        };
      }
      if (query.includes("company-purge:tenant-column-tables")) {
        return { rows: [{ tableOid: 6, schema: "public", table: "nfe_cce_audit_logs", companyColumns: '["empresa_id"]' }], rowCount: 1 };
      }
      if (query.includes("company-purge:discover-tenant-rows")) {
        return { rows: [{ row_ref: "16389:(0,6)" }], rowCount: 1 };
      }
      if (query.includes("company-purge:discover-child")) {
        const refs = params[0] as string[];
        if (query.includes('FROM "public"."order_items"')) {
          return { rows: refs.includes("16385:(0,2)") ? [{ row_ref: "16386:(0,3)" }] : [], rowCount: 1 };
        }
        if (query.includes('FROM "public"."nfe_cce"')) {
          return { rows: refs.includes("16387:(0,4)") ? [{ row_ref: "16388:(0,5)" }] : [], rowCount: 1 };
        }
        if (query.includes('FROM "public"."nfe_emissoes"')) {
          return { rows: refs.includes("16385:(0,2)") ? [{ row_ref: "16387:(0,4)" }] : [], rowCount: 1 };
        }
        if (query.includes('FROM "public"."orders"')) {
          return { rows: refs.includes("16384:(0,1)") ? [{ row_ref: "16385:(0,2)" }] : [], rowCount: 1 };
        }
      }
      if (query.includes("company-purge:delete-rows")) {
        if (options.failOnDelete) throw Object.assign(new Error("FK restriction"), { code: "23503" });
        return { rows: [], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    },
    release() { releases += 1; },
  };
  return {
    statements,
    get releases() { return releases; },
    pool: { connect: async () => client },
  };
}

test("company purge removes linked rows child-first in one transaction", async () => {
  const fake = makePool();
  await purgeCompanyAndReferences(fake.pool as any, 22);
  const deletes = fake.statements.filter((statement) => statement.includes("company-purge:delete-rows"));
  const deleteTables = deletes.map((statement) => {
    const match = statement.match(/DELETE FROM "public"\."([^"]+)"/);
    return match?.[1];
  });
  assert.ok(deleteTables.indexOf("order_items") < deleteTables.indexOf("orders"));
  assert.ok(deleteTables.indexOf("nfe_cce") < deleteTables.indexOf("nfe_emissoes"));
  assert.ok(deleteTables.indexOf("nfe_emissoes") < deleteTables.indexOf("orders"));
  assert.ok(deleteTables.includes("nfe_cce_audit_logs"));
  assert.equal(deleteTables.at(-1), "companies");
  assert.ok(fake.statements.some((statement) => statement.includes("company-purge:discover-tenant-rows")));
  assert.ok(fake.statements.includes("COMMIT"));
  assert.equal(fake.statements.includes("ROLLBACK"), false);
  assert.equal(fake.releases, 1);
});

test("company purge rolls back every deletion when a database constraint blocks it", async () => {
  const fake = makePool({ failOnDelete: true });
  await assert.rejects(
    purgeCompanyAndReferences(fake.pool as any, 22),
    (error: unknown) => error instanceof ConflictError,
  );
  assert.ok(fake.statements.includes("ROLLBACK"));
  assert.equal(fake.statements.includes("COMMIT"), false);
  assert.equal(fake.releases, 1);
});
