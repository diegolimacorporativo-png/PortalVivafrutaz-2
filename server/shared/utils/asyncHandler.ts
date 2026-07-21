/**
 * asyncHandler — compatibility re-export.
 *
 * SOURCE OF TRUTH: server/core/http/asyncHandler.ts
 *
 * This file exists solely so that existing imports written as
 *   import { asyncHandler } from "../../shared/utils/asyncHandler"
 * continue to resolve without changes.
 *
 * For NEW code, import from the canonical location:
 *   import { asyncHandler } from "../../core/http/asyncHandler"
 *
 * @deprecated — import from server/core/http/asyncHandler.ts directly.
 */
export { asyncHandler } from "../../core/http/asyncHandler";
