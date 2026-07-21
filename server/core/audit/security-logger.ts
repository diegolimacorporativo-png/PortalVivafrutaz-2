/**
 * security-logger — compatibility re-export.
 *
 * SOURCE OF TRUTH: server/core/audit/audit-logger.ts
 *
 * This file exists solely so that existing imports written as
 *   import { logSecurityEvent } from "../core/audit/security-logger"
 * continue to resolve without changes.
 *
 * NAMING CLARIFICATION:
 *   This module (audit-logger) = DB-persisted structured audit records.
 *   server/core/security/securityLogger.ts = in-memory circular buffer (no DB).
 *   They are completely different modules with different logSecurityEvent signatures.
 *
 * For NEW code, import from the canonical location:
 *   import { logSecurityEvent } from "../core/audit/audit-logger"
 *
 * @deprecated — import from server/core/audit/audit-logger.ts directly.
 */
export {
  logSecurityEvent,
  classifyRoleRisk,
} from "./audit-logger";
export type {
  TenantScope,
  AccessIntent,
  RoleRiskLevel,
  SecurityEventPayload,
} from "./audit-logger";
