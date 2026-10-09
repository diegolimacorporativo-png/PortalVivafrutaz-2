/**
 * Tracking tokens are bearer capabilities. Keep them out of request,
 * response, security, and error logs while retaining the route shape.
 */
export function redactTrackingTokenFromPath(path: string): string {
  return path
    .replace(/(\/(?:api\/logistics\/track|api\/track|driver-map|track)\/)[^/?#]+/gi, "$1:token")
    .replace(/([?#&][^=&#]*token[^=&#]*=)[^&#]*/gi, "$1[REDACTED]");
}
