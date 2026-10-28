import type { Pool, PoolClient } from "pg";
import { ConflictError, NotFoundError } from "../../shared/errors/AppError";

const MAX_PURGED_ROWS = 100_000;
const DISCOVERY_BATCH_SIZE = 500;

type ForeignKeyEdge = {
  constraintId: number;
  childOid: number;
  parentOid: number;
  childSchema: string;
  childTable: string;
  parentSchema: string;
  parentTable: string;
  childColumns: string[];
  parentColumns: string[];
  childKind: string;
  parentKind: string;
};

type QueryClient = Pick<PoolClient, "query" | "release">;
type PoolLike = Pick<Pool, "connect">;

function quoteIdentifier(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

function qualifiedName(schema: string, table: string): string {
  return `${quoteIdentifier(schema)}.${quoteIdentifier(table)}`;
}

function orderForDeletion(
  selectedTables: Set<number>,
  edges: ForeignKeyEdge[],
): number[] {
  const children = new Map<number, Set<number>>();
  for (const edge of edges) {
    if (!selectedTables.has(edge.parentOid) || !selectedTables.has(edge.childOid)) continue;
    if (edge.parentOid === edge.childOid) {
      throw new ConflictError("A empresa possui uma relação interna que exige tratamento manual; nenhum dado foi removido.");
    }
    const set = children.get(edge.parentOid) ?? new Set<number>();
    set.add(edge.childOid);
    children.set(edge.parentOid, set);
  }

  const visiting = new Set<number>();
  const visited = new Set<number>();
  const result: number[] = [];
  const visit = (tableOid: number) => {
    if (visited.has(tableOid)) return;
    if (visiting.has(tableOid)) {
      throw new ConflictError("A empresa possui relações cíclicas que exigem tratamento manual; nenhum dado foi removido.");
    }
    visiting.add(tableOid);
    for (const childOid of children.get(tableOid) ?? []) visit(childOid);
    visiting.delete(tableOid);
    visited.add(tableOid);
    result.push(tableOid);
  };

  for (const tableOid of selectedTables) visit(tableOid);
  return result;
}

/**
 * Permanently removes a company and every row reachable through a public-schema
 * foreign key, in one transaction. It discovers the FK graph at runtime so new
 * relations are included without a stale hand-maintained table list. External
 * schema references, cycles, oversized purges, or any SQL failure abort and roll
 * back the entire operation. No row contents are read into application logs.
 */
export async function purgeCompanyAndReferences(
  pool: PoolLike,
  companyId: number,
): Promise<void> {
  const client = await pool.connect();
  let transactionOpen = false;

  try {
    await client.query("BEGIN");
    transactionOpen = true;

    const rootResult = await client.query<{ row_ref: string; table_oid: number }>(
      `/* company-purge:root */
       SELECT tableoid::text || ':' || ctid::text AS row_ref,
              'public.companies'::regclass::oid::int AS table_oid
       FROM public.companies
       WHERE id = $1
       FOR UPDATE`,
      [companyId],
    );
    if (rootResult.rows.length === 0) throw new NotFoundError("Empresa não encontrada");

    const foreignKeys = await client.query<ForeignKeyEdge>(
      `/* company-purge:foreign-keys */
       SELECT con.oid::int AS "constraintId",
              con.conrelid::int AS "childOid",
              con.confrelid::int AS "parentOid",
              child_ns.nspname AS "childSchema",
              child.relname AS "childTable",
              parent_ns.nspname AS "parentSchema",
              parent.relname AS "parentTable",
              array_agg(child_att.attname ORDER BY child_key.ordinality) AS "childColumns",
              array_agg(parent_att.attname ORDER BY parent_key.ordinality) AS "parentColumns",
              child.relkind AS "childKind",
              parent.relkind AS "parentKind"
       FROM pg_constraint con
       JOIN pg_class child ON child.oid = con.conrelid
       JOIN pg_namespace child_ns ON child_ns.oid = child.relnamespace
       JOIN pg_class parent ON parent.oid = con.confrelid
       JOIN pg_namespace parent_ns ON parent_ns.oid = parent.relnamespace
       JOIN LATERAL unnest(con.conkey) WITH ORDINALITY child_key(attnum, ordinality) ON true
       JOIN LATERAL unnest(con.confkey) WITH ORDINALITY parent_key(attnum, ordinality)
         ON parent_key.ordinality = child_key.ordinality
       JOIN pg_attribute child_att
         ON child_att.attrelid = con.conrelid AND child_att.attnum = child_key.attnum
       JOIN pg_attribute parent_att
         ON parent_att.attrelid = con.confrelid AND parent_att.attnum = parent_key.attnum
       WHERE con.contype = 'f'
         AND child_ns.nspname = 'public'
         AND parent_ns.nspname = 'public'
       GROUP BY con.oid, child_ns.nspname, child.relname, parent_ns.nspname,
                parent.relname, child.relkind, parent.relkind`,
    );

    const edges = foreignKeys.rows;
    const edgesByParent = new Map<number, ForeignKeyEdge[]>();
    const tableNames = new Map<number, { schema: string; table: string; kind: string }>();
    for (const edge of edges) {
      const outgoing = edgesByParent.get(Number(edge.parentOid)) ?? [];
      outgoing.push({ ...edge, childOid: Number(edge.childOid), parentOid: Number(edge.parentOid) });
      edgesByParent.set(Number(edge.parentOid), outgoing);
      tableNames.set(Number(edge.childOid), { schema: edge.childSchema, table: edge.childTable, kind: edge.childKind });
      tableNames.set(Number(edge.parentOid), { schema: edge.parentSchema, table: edge.parentTable, kind: edge.parentKind });
    }

    const root = rootResult.rows[0];
    const rootOid = Number(root.table_oid);
    const refsByTable = new Map<number, Set<string>>([[rootOid, new Set([root.row_ref])]]);
    const processedByTable = new Map<number, Set<string>>();
    const matchedEdges = new Set<number>();
    const queue: Array<{ tableOid: number; rowRefs: string[] }> = [
      { tableOid: rootOid, rowRefs: [root.row_ref] },
    ];
    let discoveredRows = 1;

    while (queue.length > 0) {
      const current = queue.shift()!;
      const processed = processedByTable.get(current.tableOid) ?? new Set<string>();
      const newParentRefs = current.rowRefs.filter((rowRef) => !processed.has(rowRef));
      if (newParentRefs.length === 0) continue;
      for (const rowRef of newParentRefs) processed.add(rowRef);
      processedByTable.set(current.tableOid, processed);

      for (const edge of edgesByParent.get(current.tableOid) ?? []) {
        if (edge.childKind === "p" || edge.parentKind === "p") {
          throw new ConflictError("A empresa possui relações particionadas que exigem tratamento manual; nenhum dado foi removido.");
        }
        const childName = qualifiedName(edge.childSchema, edge.childTable);
        const parentName = qualifiedName(edge.parentSchema, edge.parentTable);
        const join = edge.childColumns
          .map((column, index) => `child_row.${quoteIdentifier(column)} = parent_row.${quoteIdentifier(edge.parentColumns[index])}`)
          .join(" AND ");
        const childRefs = new Set<string>();

        for (let offset = 0; offset < newParentRefs.length; offset += DISCOVERY_BATCH_SIZE) {
          const batch = newParentRefs.slice(offset, offset + DISCOVERY_BATCH_SIZE);
          const related = await client.query<{ row_ref: string }>(
            `/* company-purge:discover-child */
             SELECT child_row.tableoid::text || ':' || child_row.ctid::text AS row_ref
             FROM ${childName} AS child_row
             JOIN ${parentName} AS parent_row ON ${join}
             WHERE parent_row.tableoid::text || ':' || parent_row.ctid::text = ANY($1::text[])
             FOR UPDATE OF child_row`,
            [batch],
          );
          for (const row of related.rows) childRefs.add(row.row_ref);
        }

        const knownChildRefs = refsByTable.get(edge.childOid) ?? new Set<string>();
        if (childRefs.size > 0) matchedEdges.add(Number(edge.constraintId));
        const newlyDiscovered: string[] = [];
        for (const rowRef of childRefs) {
          if (knownChildRefs.has(rowRef)) continue;
          knownChildRefs.add(rowRef);
          newlyDiscovered.push(rowRef);
        }
        if (newlyDiscovered.length > 0) {
          discoveredRows += newlyDiscovered.length;
          if (discoveredRows > MAX_PURGED_ROWS) {
            throw new ConflictError("A empresa excede o limite de exclusão automática segura; nenhum dado foi removido.");
          }
          refsByTable.set(edge.childOid, knownChildRefs);
          queue.push({ tableOid: edge.childOid, rowRefs: newlyDiscovered });
        }
      }
    }

    const deletionOrder = orderForDeletion(
      new Set(refsByTable.keys()),
      edges.filter((edge) => matchedEdges.has(Number(edge.constraintId))),
    );
    for (const tableOid of deletionOrder) {
      const refs = [...(refsByTable.get(tableOid) ?? [])];
      if (refs.length === 0) continue;
      const table = tableNames.get(tableOid) ?? { schema: "public", table: "companies", kind: "r" };
      const qualified = qualifiedName(table.schema, table.table);
      for (let offset = 0; offset < refs.length; offset += DISCOVERY_BATCH_SIZE) {
        const batch = refs.slice(offset, offset + DISCOVERY_BATCH_SIZE);
        await client.query(
          `/* company-purge:delete-rows */
           DELETE FROM ${qualified} AS target_row
           WHERE target_row.tableoid::text || ':' || target_row.ctid::text = ANY($1::text[])`,
          [batch],
        );
      }
    }

    await client.query("COMMIT");
    transactionOpen = false;
  } catch (error: any) {
    if (transactionOpen) {
      try {
        await client.query("ROLLBACK");
      } catch {
        // Preserve the original error; the connection is released below.
      }
    }
    if (error instanceof NotFoundError || error instanceof ConflictError) throw error;
    if (error?.code === "23503" || error?.cause?.code === "23503") {
      throw new ConflictError("Há referências fora do escopo seguro de exclusão; a operação foi revertida e nenhum dado foi removido.");
    }
    throw error;
  } finally {
    client.release();
  }
}
