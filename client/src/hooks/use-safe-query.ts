import {
  useQuery,
  type UseQueryOptions,
  type UseQueryResult,
  type QueryKey,
} from "@tanstack/react-query";
import {
  normalizeList,
  normalizeOne,
  normalizeMeta,
} from "@/lib/normalizeResponse";

/**
 * Safe query wrappers that pipe React Query results through the response
 * normalizers, so consumers always receive a guaranteed-shape value
 * (`T[]`, `T | null`, etc.) regardless of whether the endpoint returns the
 * legacy raw shape or the new `{ success, data, meta }` envelope.
 *
 * Usage:
 *   const { data: companies } = useSafeListQuery<Company>({
 *     queryKey: ["/api/companies"],
 *   });
 *   // `companies` is always `Company[]` — never undefined, never an envelope.
 *
 *   const { data: company } = useSafeQuery<Company>({
 *     queryKey: ["/api/companies", id],
 *   });
 *   // `company` is `Company | null`.
 */

type BaseOptions<TQueryFnData, TError, TQueryKey extends QueryKey> = Omit<
  UseQueryOptions<TQueryFnData, TError, unknown, TQueryKey>,
  "select"
>;

/**
 * Wraps `useQuery` and normalizes the response into `T[]`.
 * Use for any endpoint that returns a list of items.
 */
export function useSafeListQuery<
  T = unknown,
  TError = Error,
  TQueryKey extends QueryKey = QueryKey,
>(
  options: BaseOptions<unknown, TError, TQueryKey>,
): UseQueryResult<T[], TError> {
  return useQuery<unknown, TError, T[], TQueryKey>({
    ...options,
    select: (raw) => normalizeList<T>(raw),
  }) as UseQueryResult<T[], TError>;
}

/**
 * Wraps `useQuery` and normalizes the response into `T | null`.
 * Use for any endpoint that returns a single object.
 */
export function useSafeQuery<
  T = unknown,
  TError = Error,
  TQueryKey extends QueryKey = QueryKey,
>(
  options: BaseOptions<unknown, TError, TQueryKey>,
): UseQueryResult<T | null, TError> {
  return useQuery<unknown, TError, T | null, TQueryKey>({
    ...options,
    select: (raw) => normalizeOne<T>(raw),
  }) as UseQueryResult<T | null, TError>;
}

/**
 * Variant that returns both the normalized list and the meta block
 * (pagination / filters / etc.) when the endpoint uses the envelope.
 */
export function useSafeListQueryWithMeta<
  T = unknown,
  TError = Error,
  TQueryKey extends QueryKey = QueryKey,
>(
  options: BaseOptions<unknown, TError, TQueryKey>,
): UseQueryResult<{ items: T[]; meta: Record<string, unknown> }, TError> {
  return useQuery<
    unknown,
    TError,
    { items: T[]; meta: Record<string, unknown> },
    TQueryKey
  >({
    ...options,
    select: (raw) => ({
      items: normalizeList<T>(raw),
      meta: normalizeMeta(raw),
    }),
  }) as UseQueryResult<
    { items: T[]; meta: Record<string, unknown> },
    TError
  >;
}
