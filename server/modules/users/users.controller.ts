import type { Request, Response } from "express";
import { usersService, UsersService } from "./users.service";

/**
 * UsersController — thin HTTP adapter.
 *
 * Architecture decision: identical to OrdersController — controllers do three
 * things and nothing else:
 *   1. Pull pre-validated input out of `req` (validation already happened via
 *      the `validate` middleware).
 *   2. Call the service.
 *   3. Shape the response.
 * No business logic, no DB calls, no Zod, no try/catch (asyncHandler does it).
 *
 * BACKWARD-COMPAT — response shape:
 * The legacy users routes returned RAW arrays/objects (e.g. `User[]`, `{ ok:
 * true }`) and the existing frontend (`client/src/pages/admin/users.tsx`)
 * consumes `res.json()` directly. The standard `ok()/created()/noContent()`
 * helpers from `shared/utils/apiResponse` are intentionally NOT used here
 * because they wrap data in `{ success: true, data: ... }`, which would break
 * every existing frontend query. Migrating to the envelope is the recommended
 * follow-up — it requires a paired frontend update using `useSafeListQuery`/
 * `useSafeQuery` to normalise both the old and new shapes during the window.
 *
 * Errors still flow through AppError → the central errorHandler, which
 * preserves the legacy `{ message }` field via its compatibility branch.
 */
export class UsersController {
  constructor(private readonly service: UsersService = usersService) {}

  list = async (_req: Request, res: Response) => {
    const users = await this.service.list();
    return res.json(users);
  };

  create = async (req: Request, res: Response) => {
    const user = await this.service.create(req.body);
    return res.status(201).json(user);
  };

  update = async (req: Request, res: Response) => {
    const id = Number((req.params as any).id);
    const user = await this.service.update(id, req.body);
    return res.json(user);
  };

  remove = async (req: Request, res: Response) => {
    const id = Number((req.params as any).id);
    await this.service.delete(id);
    return res.status(204).end();
  };

  changePassword = async (req: Request, res: Response) => {
    const targetUserId = Number((req.params as any).id);
    const { newPassword } = req.body as { newPassword: string };
    const actorUserId =
      (req as any).session?.userId ?? (req as any).userId ?? null;

    const result = await this.service.changePassword({
      targetUserId,
      newPassword,
      actorUserId,
      ip: req.ip || "",
    });

    return res.json(result);
  };

  /**
   * Privileged unlock — POST /api/admin/users/:id/unlock.
   *
   * Mounted from the legacy `routes.ts` as a thin delegation (the path lives
   * under `/api/admin/...`, not `/api/users/...`, so it does not belong on the
   * users router itself). The IP-derivation logic mirrors the legacy handler:
   * trust `x-forwarded-for` first, fall back to socket.remoteAddress.
   */
  unlock = async (req: Request, res: Response) => {
    const targetUserId = Number((req.params as any).id);
    const actorUserId =
      (req as any).session?.userId ?? (req as any).userId ?? null;
    const ip =
      (req.headers["x-forwarded-for"] as string | undefined)?.split(",")[0] ||
      req.socket.remoteAddress ||
      "";

    const result = await this.service.unlockUser({
      targetUserId,
      actorUserId,
      ip,
    });

    return res.json(result);
  };
}

export const usersController = new UsersController();
