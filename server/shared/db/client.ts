/**
 * Shared DB client — compatibility re-export.
 *
 * SOURCE OF TRUTH: server/database/db.ts
 *
 * This file exists solely so that imports written as
 *   import { db } from "../../shared/db/client"
 * continue to resolve without changes.
 *
 * For NEW code, import directly from the source of truth:
 *   import { db } from "../../database/db"
 *
 * @deprecated — import from server/database/db.ts directly.
 */
export { db, pool } from "../../database/db";
