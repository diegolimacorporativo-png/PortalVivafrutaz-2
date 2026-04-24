import type { Request, Response } from "express";
import { ZodError } from "zod";
import { authService, AuthService } from "./auth.service";
import {
  forgotPasswordSchema,
  loginSchema,
} from "./auth.validation";
import type { SessionPayload } from "./auth.types";

/**
 * AuthController — thin HTTP adapter.
 *
 * BACKWARD-COMPAT NOTE — response shape & error messages:
 * The frontend (`client/src/hooks/use-auth.ts`) Zod-parses success payloads
 * (`{user}` or `{company}`) and reads `error.message` on failures. The
 * existing login page additionally uses the *exact* Portuguese strings to
 * decide what banner to show (e.g. account locked, maintenance mode,
 * "X/3 tentativas" counter). To honour "do not change response format" and
 * "do not break frontend expectations" we:
 *   • Return raw `{user}` / `{company}` on success (NOT the `{success,data}`
 *     envelope).
 *   • Return raw `{message}` on failure (NOT the `{success,error}` envelope).
 *   • Catch ZodError on input and return `{message: "Usuário ou senha
 *     incorretos."}` to preserve the legacy security-by-obscurity behaviour
 *     on the credentials endpoint.
 *
 * Session writes (`req.session.save`, `req.session.destroy`) live here
 * because they're HTTP concerns. The service stays HTTP-free.
 */
export class AuthController {
  constructor(private readonly service: AuthService = authService) {}

  // ── POST /api/auth/login ───────────────────────────────────────────────
  login = async (req: Request, res: Response): Promise<void> => {
    let input;
    try {
      input = loginSchema.parse(req.body);
    } catch (err) {
      if (err instanceof ZodError) {
        res.status(400).json({ message: "Usuário ou senha incorretos." });
        return;
      }
      throw err;
    }

    const ip =
      ((req.headers["x-forwarded-for"] as string) || "").split(",")[0] ||
      req.socket.remoteAddress ||
      "";

    const outcome = await this.service.attemptLogin(input, ip);

    if (outcome.kind === "failure") {
      res.status(outcome.status).json({ message: outcome.message });
      return;
    }

    // Success — write session, persist it, then respond. Saving before the
    // response is critical because the frontend immediately fires GET /me
    // after login and expects the cookie to be valid.
    const session = req.session as unknown as SessionPayload;
    if (outcome.kind === "admin-success") {
      session.userId = outcome.user.id;
      session.userType = "admin";
    } else {
      session.companyId = outcome.company.id;
      session.userType = "company";
    }

    await new Promise<void>((resolve) => {
      req.session.save((err) => {
        if (err) {
          console.error("[LOGIN] Erro ao salvar sessão:", err);
          res
            .status(500)
            .json({ message: "Erro ao processar login. Tente novamente." });
          resolve();
          return;
        }
        console.log("[LOGIN] Sessão salva com sucesso");
        if (outcome.kind === "admin-success") {
          res.json({ user: outcome.user });
        } else {
          res.json({ company: outcome.company });
        }
        resolve();
      });
    });
  };

  // ── GET /api/auth/me ───────────────────────────────────────────────────
  me = async (req: Request, res: Response): Promise<void> => {
    const session = req.session as unknown as SessionPayload;
    const outcome = await this.service.resolveSession(session);

    if (outcome.kind === "admin") {
      res.json({ user: outcome.user });
      return;
    }
    if (outcome.kind === "company") {
      res.json({ company: outcome.company });
      return;
    }
    res.status(401).json({ message: "Not authenticated" });
  };

  // ── POST /api/auth/logout ──────────────────────────────────────────────
  logout = (req: Request, res: Response): void => {
    // Mirrors legacy: ignore destroy errors and always return 200 with the
    // exact "Logged out successfully" message the frontend doesn't read but
    // the security logs UI displays on session-end events.
    req.session.destroy(() => {
      res.json({ message: "Logged out successfully" });
    });
  };

  // ── POST /api/auth/forgot-password ─────────────────────────────────────
  forgotPassword = async (req: Request, res: Response): Promise<void> => {
    let email: string;
    try {
      email = forgotPasswordSchema.parse(req.body).email;
    } catch {
      res.status(400).json({ message: "Email obrigatório." });
      return;
    }

    const result = await this.service.requestPasswordReset(email);
    if (!result.found) {
      res.status(404).json({ message: result.message });
      return;
    }
    res.json({ message: result.message, requestId: result.requestId });
  };

  // ── POST /api/auth/log-unauthorized ────────────────────────────────────
  logUnauthorized = async (req: Request, res: Response): Promise<void> => {
    const session = req.session as unknown as SessionPayload;
    const actorUserId = session?.userId ?? null;
    const route = (req.body as { route?: string } | undefined)?.route;
    const ip = req.ip || "";
    const result = await this.service.logUnauthorizedAccess(
      actorUserId,
      route,
      ip,
    );
    res.json(result);
  };
}

export const authController = new AuthController();
