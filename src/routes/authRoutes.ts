import { Router } from "express";
import { requireAuth } from "../middleware/auth";
import {
  register,
  login,
  logout,
  refreshToken,
  forgotPassword,
  resetPassword,
  getMe,
  updateMe,
} from "../controllers/authController";

const router = Router();

// ─────────────────────────────────────────────
// Public — no token required
// ─────────────────────────────────────────────

/** POST /api/auth/register — create account + user_role row (role: admin) */
router.post("/auth/register", register);

/** POST /api/auth/login — email + password → access_token + refresh_token */
router.post("/auth/login", login);

/** POST /api/auth/forgot-password — send password reset email */
router.post("/auth/forgot-password", forgotPassword);

/** POST /api/auth/reset-password — exchange reset token for a new password */
router.post("/auth/reset-password", resetPassword);

// ─────────────────────────────────────────────
// Authenticated — valid JWT required
// ─────────────────────────────────────────────

/** POST /api/auth/logout — invalidate the current session */
router.post("/auth/logout", requireAuth, logout);

/** POST /api/auth/refresh-token — exchange refresh_token for a new access_token */
router.post("/auth/refresh-token", requireAuth, refreshToken);

/** GET /api/auth/me — return the authenticated user's profile */
router.get("/auth/me", requireAuth, getMe);

/** PATCH /api/auth/me — update first_name, last_name, and/or password */
router.patch("/auth/me", requireAuth, updateMe);

export default router;
