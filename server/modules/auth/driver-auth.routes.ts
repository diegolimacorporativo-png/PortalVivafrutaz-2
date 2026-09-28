import { Router } from "express";
import { asyncHandler } from "../../core/http/asyncHandler";
import { loginEmailIpLimiter, loginIpStrategicLimiter } from "../../core/security/rateLimit";
import { authController } from "./auth.controller";

/**
 * Authentication surface dedicated to the Android Tracker.
 *
 * Mounted at /api/driver/auth so the APK has a stable contract distinct from
 * the ERP login surface. It still writes the normal sessionId cookie, allowing
 * the existing /api/auth/me and /api/driver/gps endpoints to be reused.
 */
const router = Router();

router.post(
  "/login",
  loginIpStrategicLimiter,
  loginEmailIpLimiter,
  asyncHandler(authController.driverLogin),
);

export const driverAuthRouter = router;