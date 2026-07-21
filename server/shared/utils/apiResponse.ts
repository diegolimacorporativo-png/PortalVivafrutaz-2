/**
 * apiResponse helpers — compatibility re-export.
 *
 * SOURCE OF TRUTH: server/core/http/apiResponse.ts
 *
 * This file exists solely so that existing imports written as
 *   import { ok, created, fail } from "../../shared/utils/apiResponse"
 * continue to resolve without changes.
 *
 * For NEW code, import from the canonical location:
 *   import { ok, created, noContent, fail } from "../../core/http/apiResponse"
 *
 * @deprecated — import from server/core/http/apiResponse.ts directly.
 */
export {
  ok,
  created,
  noContent,
  fail,
} from "../../core/http/apiResponse";
export type {
  ResponseMeta,
  ApiSuccess,
  ApiFailure,
  ApiResponse,
} from "../../core/http/apiResponse";
