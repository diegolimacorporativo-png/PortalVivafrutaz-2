/**
 * Shared DB client placeholder.
 *
 * The active Drizzle client lives in server/database/db.ts.
 * Re-export it from here so future modules can import from a
 * single shared location without touching legacy paths.
 */
export { db } from "../../database/db";
