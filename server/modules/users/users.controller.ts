import type { Request, Response } from "express";
import { usersService, UsersService } from "./users.service";

/**
 * UsersController — thin HTTP adapter.
 *
 * Architecture decision: identical to FinanceController — controllers do three
 * things and nothing else:
 *   1. Pull pre-validated input out of `req` (validation already happened).
 *   2. Call the service.
 *   3. Shape the response.
 * No business logic, no DB calls, no Zod, no try/catch (asyncHandler does it).
 *
 * BACKWARD-COMPAT NOTE — response shape:
 * The legacy users routes returned RAW arrays/objects (e.g. `User[]`,
 * `{ ok: true }`) and the existing frontend (`client/src/pages/admin/users.tsx`)
 * consumes `res.json()` directly. To honour "do not break existing endpoints"
 * we deliberately bypass the `ok()` / `created()` envelope helpers here and
 * write the legacy shape verbatim. Errors still flow through AppError → the
 * central errorHandler, which preserves the legacy `{ message }` field via
 * its compatibility branch.
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
}

export const usersController = new UsersController();
