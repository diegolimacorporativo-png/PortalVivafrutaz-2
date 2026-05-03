import { db } from "../../database/db";
import { systemPolicies } from "../../../shared/schema";
import { desc, eq } from "drizzle-orm";

let cache: any[] = [];
let cacheAt = 0;

export async function loadEnabledPolicies(type?: string) {
  const now = Date.now();
  if (now - cacheAt > 10_000) {
    const rows = await db.select().from(systemPolicies).where(eq(systemPolicies.enabled, true)).orderBy(desc(systemPolicies.priority));
    cache = rows;
    cacheAt = now;
  }
  return type ? cache.filter((policy) => policy.type === type) : cache;
}

export function clearPolicyCache() {
  cache = [];
  cacheAt = 0;
}