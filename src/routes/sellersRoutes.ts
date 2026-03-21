import { Router } from "express";
import { requireAuth, requireRole } from "../middleware/auth";
import {
  listSellers,
  getSellerById,
  getMySellerProfile,
  createSeller,
  updateSeller,
  updateSellerStatus,
  verifySeller,
  deleteSeller,
} from "../controllers/sellersController";

const router = Router();

// ─────────────────────────────────────────────
// Seller — own profile (any authenticated user with seller role)
// ─────────────────────────────────────────────

/** GET  /api/sellers/me     — seller's own profile */
router.get(
  "/sellers/me",
  requireAuth, requireRole("seller"),
  getMySellerProfile
);

/** POST /api/sellers        — create seller profile (seller registers) */
router.post(
  "/sellers",
  requireAuth, requireRole("seller"),
  createSeller
);

/** PUT  /api/sellers/:id    — seller updates own profile */
router.put(
  "/sellers/:id",
  requireAuth, requireRole("seller"),
  updateSeller
);

// ─────────────────────────────────────────────
// Admin — full seller management
// ─────────────────────────────────────────────

/** GET  /api/sellers        — list all sellers (paginated, filterable) */
router.get(
  "/sellers",
  requireAuth, requireRole("admin"),
  listSellers
);

/** GET  /api/sellers/:id    — get any seller by id */
router.get(
  "/sellers/:id",
  requireAuth, requireRole("admin"),
  getSellerById
);

/** PATCH /api/sellers/:id/status  — update seller status */
router.patch(
  "/sellers/:id/status",
  requireAuth, requireRole("admin"),
  updateSellerStatus
);

/** PATCH /api/sellers/:id/verify  — toggle is_verified */
router.patch(
  "/sellers/:id/verify",
  requireAuth, requireRole("admin"),
  verifySeller
);

/** DELETE /api/sellers/:id  — permanently delete seller profile */
router.delete(
  "/sellers/:id",
  requireAuth, requireRole("admin"),
  deleteSeller
);

export default router;
