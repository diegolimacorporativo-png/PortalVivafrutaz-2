/** @deprecated Use fetchWithAuth from "@/lib/fetchWithAuth". */
export function handleAuthError(
  _status: number,
  _onExpire?: () => void,
): boolean {
  return false;
}
