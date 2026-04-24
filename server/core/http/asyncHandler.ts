import type { Request, Response, NextFunction, RequestHandler } from "express";

/**
 * asyncHandler — wraps an async controller so any thrown error is forwarded
 * to the central error middleware via next(err) instead of crashing the
 * request. Eliminates the boilerplate try/catch repeated 200+ times in the
 * legacy routes.ts.
 */
export function asyncHandler<
  Req extends Request = Request,
  Res extends Response = Response,
>(
  fn: (req: Req, res: Res, next: NextFunction) => Promise<unknown>,
): RequestHandler {
  return (req, res, next) => {
    Promise.resolve(fn(req as Req, res as Res, next)).catch(next);
  };
}
