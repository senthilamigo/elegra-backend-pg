import { Router } from "express";
import { requireAuth, requireRole } from "../middleware/auth";
import {
  listUsers,
  getUserById,
  updateUserRole,
  deleteUser,
} from "../controllers/usersController";

const router = Router();

// All /api/users routes require: (1) a valid JWT and (2) the admin role
router.use(requireAuth, requireRole("admin"));

/** GET  /api/users         — list all users (paginated) */
router.get("/users", listUsers);

/** GET  /api/users/:id     — get a single user by UUID */
router.get("/users/:id", getUserById);

/** PATCH /api/users/:id/role  — update role_name */
router.patch("/users/:id/role", updateUserRole);

/** DELETE /api/users/:id   — permanently delete user + auth account */
router.delete("/users/:id", deleteUser);

export default router;
