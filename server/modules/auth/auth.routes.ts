import { Router } from "express";
import { asyncHandler } from "../../core/http/asyncHandler";
import { authController } from "./auth.controller";

/**
 * Auth router — wires HTTP method+path → controller.
 *
 * Architecture decision: same shape as the finance and users routers, but
 * with two intentional deviations documented in `auth.controller.ts`:
 *
 *   1. No `validateRequest` middleware on `/login` and `/forgot-password`.
 *      The credentials endpoint deliberately obscures validation details
 *      (returning "Usuário ou senha incorretos." for any bad payload) and
 *      `forgot-password` returns "Email obrigatório." — both decided in the
 *      controller via local `try { schema.parse(...) }` blocks.
 *
 *   2. No `requireAuth` on the router. These endpoints ARE the auth flow:
 *      `/login`, `/me`, `/logout`, `/forgot-password`, `/log-unauthorized`
 *      must all be reachable without an existing session.
 */
const router = Router();

router.post("/login", asyncHandler(authController.login));
router.get("/me", asyncHandler(authController.me));
router.post("/logout", authController.logout);
router.post("/forgot-password", asyncHandler(authController.forgotPassword));
router.post("/log-unauthorized", asyncHandler(authController.logUnauthorized));

export const authRouter = router;
