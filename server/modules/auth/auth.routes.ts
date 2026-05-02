import { Router } from "express";
import { asyncHandler } from "../../core/http/asyncHandler";
import { authController } from "./auth.controller";
// FASE 7 — IP-based brute-force guard on login (5 attempts / 5 min per IP).
// Complements the per-account lockout in AuthService (MAX_ATTEMPTS=3).
import { loginIpLimiter } from "../../core/security/rateLimit";

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

router.post("/login", loginIpLimiter, asyncHandler(authController.login));
router.get("/me", asyncHandler(authController.me));
router.post("/logout", authController.logout);
router.post("/forgot-password", asyncHandler(authController.forgotPassword));
router.post("/log-unauthorized", asyncHandler(authController.logUnauthorized));
// FASE 14.5 — mandatory first-login password change for provisioned accounts
router.post("/force-password-change", asyncHandler(authController.forcePasswordChange));

export const authRouter = router;
