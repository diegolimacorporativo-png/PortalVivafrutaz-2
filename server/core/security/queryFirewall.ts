import crypto from "node:crypto";
import { db } from "../../database/db";
import { auditLogs } from "@shared/schema";
import { logSecurity } from "./securityLogger";

export type QueryFirewallContext = {
  userId?: number | string | null;
  tenantId: string;
  resource: string;
  action: string;
  sql: string;
};

function hashQuery(sqlText: string, tenantId: string, userId?: number | string | null) {
  return crypto.createHash("sha256").update(`${sqlText}|${tenantId}|${userId ?? "anonymous"}`).digest("hex");
}

export async function auditQuery(context: QueryFirewallContext) {
  const queryHash = hashQuery(context.sql, context.tenantId, context.userId);
  try {
    await db.insert(auditLogs).values({
      id: crypto.randomUUID(),
      userId: String(context.userId ?? "anonymous"),
      tenantId: context.tenantId,
      action: context.action,
      resource: context.resource,
      queryHash,
    });
  } catch (error: any) {
    logSecurity(`[SECURITY] AUDIT_LOG_WRITE_FAILED | resource=${context.resource} | error=${error?.message ?? "unknown"}`);
  }
  return queryHash;
}

export async function queryFirewall<T>(executor: () => Promise<T>, context: QueryFirewallContext): Promise<T> {
  if (!context.tenantId) {
    logSecurity(`[SECURITY] QUERY_FIREWALL_BLOCKED | resource=${context.resource} | reason=missing_tenant`);
    throw new Error("Tenant scope required");
  }
  await auditQuery(context);
  return executor();
}
