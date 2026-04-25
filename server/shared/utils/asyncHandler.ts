import type { Request, Response, NextFunction, RequestHandler } from "express";

/**
 * asyncHandler — wraps an async route handler so any thrown error is forwarded
 * to the central error middleware via `next(err)` automatically.
 *
 * Generic types allow callers to narrow the expected req/res shapes without
 * losing type safety inside the handler:
 *
 *   router.get("/", asyncHandler<AuthenticatedRequest>(async (req, res) => {
 *     res.json(req.user);
 *   }));
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
