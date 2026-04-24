import { z } from "zod";
import { api } from "@shared/routes";

/**
 * Validation layer for the auth module.
 *
 * Architecture decision: we deliberately reuse `api.auth.login.input` (the
 * single source of truth shared with the frontend in `shared/routes.ts`) so
 * the client and server agree on the login contract. The other schemas are
 * local because they don't have a public client SDK counterpart yet.
 *
 * NOTE: the controllers parse these schemas INSIDE the handler (instead of
 * via the `validateRequest` middleware) because the legacy auth endpoints
 * intentionally obscure validation details — e.g. an invalid login payload
 * returns "Usuário ou senha incorretos." (a security best practice for
 * credential endpoints). The middleware would expose Zod's structured error
 * shape, which would change the response and leak information.
 */

export const loginSchema = api.auth.login.input;

export const forgotPasswordSchema = z.object({
  email: z.string().email(),
});

export const logUnauthorizedSchema = z.object({
  route: z.string().optional(),
});
