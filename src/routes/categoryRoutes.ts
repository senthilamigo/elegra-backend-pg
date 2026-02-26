import { Router } from "express";
import { authenticate } from "../middleware/auth";
import {
  getCategories,
  addCategory,
  updateCategory,
  deleteCategory,
} from "../controllers/categoryController";

const router = Router();

// All category routes require authentication
router.use(authenticate);

/**
 * GET /api/category
 * Returns flat list of all categories (build tree on frontend using parent_category_id)
 */
router.get("/category", getCategories);

/**
 * POST /api/category/add
 * Body: { category_name, parent_category_id?, is_active? }
 */
router.post("/category/add", addCategory);

/**
 * PUT /api/category/update
 * Body: { id, category_name?, parent_category_id?, is_active? }
 */
router.put("/category/update", updateCategory);

/**
 * DELETE /api/category/remove/:id
 * Blocked if products or sub-categories exist
 */
router.delete("/category/remove/:id", deleteCategory);

export default router;
