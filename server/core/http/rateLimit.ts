/**
 * rateLimit — compatibility re-export.
 *
 * SOURCE OF TRUTH: server/core/http/api-rate-limit.ts
 *
 * This file exists solely so that existing imports written as
 *   import { simpleRateLimit } from "../core/http/rateLimit"
 * continue to resolve without changes.
 *
 * NOTE: This is the SIMPLE generic limiter (60 req/min, IP-only, no auth).
 *
 * DISTINCT FROM: server/core/security/rateLimit.ts
 *   That file is the full security rate-limiting suite.
 *   See api-rate-limit.ts for full documentation.
 *
 * For NEW code, import from the canonical location:
 *   import { simpleRateLimit } from "../core/http/api-rate-limit"
 *
 * @deprecated — import from server/core/http/api-rate-limit.ts directly.
 */
export { simpleRateLimit } from "./api-rate-limit";
