let handled = false;

export function handleAuthError(status: number, onExpire: () => void) {
  if ((status === 401 || status === 403) && !handled) {
    handled = true;
    onExpire();
    return true;
  }
  return status === 401 || status === 403;
}