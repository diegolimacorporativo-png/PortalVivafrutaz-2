/**
 * Tracking tokens are bearer capabilities. Keep them out of request,
 * response, security, and error logs while retaining the route shape.
 */
export function redactTrackingTokenFromPath(path: string): string {
  return path
    .replace(/(\/api\/track\/)[^/?]+/g, "$1:token")
    .replace(/(\/api\/logistics\/track\/)[^/?]+/g, "$1:token");
}
