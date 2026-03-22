/**
 * File: src/routes/usersRoutes.ts
 * Path: ecommerce-admin/src/routes/usersRoutes.ts
 *
 * Admin-only user management routes.
 * All routes require: valid JWT + admin role (applied via router.use).
 */
import { Router } from "express";
import { requireAuth, requireRole } from "../middleware/auth";
import {
  listUsers,
  getUserById,
  updateUserRole,
  updateUserStatus,
  deleteUser,
} from "../controllers/usersController";

const router = Router();

// All /api/users routes require: valid JWT + admin role
router.use(requireAuth, requireRole("admin"));

/** GET  /api/users              — list all users (paginated) */
router.get("/users", listUsers);

/** GET  /api/users/:id          — get a single user by UUID */
router.get("/users/:id", getUserById);

/** PATCH /api/users/:id/role    — update role_name */
router.patch("/users/:id/role", updateUserRole);

/** PATCH /api/users/:id/status  — update user_role.status */
router.patch("/users/:id/status", updateUserStatus);

/** DELETE /api/users/:id        — permanently delete user + auth account */
router.delete("/users/:id", deleteUser);

export default router;
