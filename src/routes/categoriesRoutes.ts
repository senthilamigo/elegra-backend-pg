import { Router } from "express";
import { requireAuth, requireRole } from "../middleware/auth";
import {
  listCategories,
  getCategoryById,
  createCategory,
  updateCategory,
  toggleCategoryStatus,
  deleteCategory,
} from "../controllers/categoriesController";

const router = Router();

// ─────────────────────────────────────────────
// Public — no token required
// ─────────────────────────────────────────────

/** GET /api/categories — all active categories as a nested tree */
router.get("/categories", listCategories);

/** GET /api/categories/:id — single active category + nested sub-categories */
router.get("/categories/:id", getCategoryById);

// ─────────────────────────────────────────────
// Admin — valid JWT + admin role required
// ─────────────────────────────────────────────

/** POST /api/categories — create a new category */
router.post(
  "/categories",
  requireAuth, requireRole("admin"),
  createCategory
);

/** PUT /api/categories/:id — update category_name / parent_category_id */
router.put(
  "/categories/:id",
  requireAuth, requireRole("admin"),
  updateCategory
);

/** PATCH /api/categories/:id/toggle — flip the is_active flag */
router.patch(
  "/categories/:id/toggle",
  requireAuth, requireRole("admin"),
  toggleCategoryStatus
);

/** DELETE /api/categories/:id — permanently delete (blocked if has products or children) */
router.delete(
  "/categories/:id",
  requireAuth, requireRole("admin"),
  deleteCategory
);

export default router;
