/**
 * Shared DB index — compatibility re-export.
 *
 * SOURCE OF TRUTH: server/database/db.ts
 *
 * Chain: shared/db/index → shared/db/client → database/db (real instance)
 *
 * For NEW code, import directly from the source of truth:
 *   import { db } from "../../database/db"
 *
 * @deprecated — import from server/database/db.ts directly.
 */
export { db, pool } from "./client";
