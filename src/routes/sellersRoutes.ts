/**
 * File: src/routes/sellersRoutes.ts
 * Path: ecommerce-admin/src/routes/sellersRoutes.ts
 *
 * Routes for seller_profiles and sellers tables.
 *
 * seller_profiles (admin-managed):
 *   GET    /api/seller-profiles            — public (signup dropdown)
 *   POST   /api/seller-profiles            — admin
 *   PUT    /api/seller-profiles/:id        — admin
 *   PATCH  /api/seller-profiles/:id/status — admin
 *
 * sellers (user ↔ profile join):
 *   GET    /api/sellers/me  — seller own account
 *   GET    /api/sellers     — admin list
 *   GET    /api/sellers/:id — admin single
 *   POST   /api/sellers     — auth (link user to profile)
 *   PATCH  /api/sellers/:id/status — admin
 *   DELETE /api/sellers/:id        — admin
 */

import { Router } from "express";
import { requireAuth, requireRole } from "../middleware/auth";
import {
  listSellerProfiles,
  createSellerProfile,
  updateSellerProfile,
  updateSellerProfileStatus,
  listSellers,
  getMySellerProfile,
  getSellerById,
  createSeller,
  updateSellerStatus,
  deleteSeller,
} from "../controllers/sellersController";

const router = Router();

// ─────────────────────────────────────────────
// seller_profiles — public + admin
// ─────────────────────────────────────────────

/** GET /api/seller-profiles — public: list profiles for signup dropdown */
router.get("/seller-profiles", listSellerProfiles);

/** POST /api/seller-profiles — admin: create a new profile */
router.post("/seller-profiles", requireAuth, requireRole("admin"), createSellerProfile);

/** PATCH /api/seller-profiles/:id/status — admin: update status/verified */
router.patch("/seller-profiles/:id/status", requireAuth, requireRole("admin"), updateSellerProfileStatus);

/** PUT /api/seller-profiles/:id — admin: update profile details */
router.put("/seller-profiles/:id", requireAuth, requireRole("admin"), updateSellerProfile);

// ─────────────────────────────────────────────
// sellers — /me before /:id to avoid param conflict
// ─────────────────────────────────────────────

/** GET /api/sellers/me — seller: own account + profile */
router.get("/sellers/me", requireAuth, requireRole("seller"), getMySellerProfile);

/** GET /api/sellers — admin: list all seller accounts */
router.get("/sellers", requireAuth, requireRole("admin"), listSellers);

/** GET /api/sellers/:id — admin: single seller account */
router.get("/sellers/:id", requireAuth, requireRole("admin"), getSellerById);

/** POST /api/sellers — auth: link user to an existing seller_profile */
router.post("/sellers", requireAuth, createSeller);

/** PATCH /api/sellers/:id/status — admin: update account status */
router.patch("/sellers/:id/status", requireAuth, requireRole("admin"), updateSellerStatus);

/** DELETE /api/sellers/:id — admin: remove seller account */
router.delete("/sellers/:id", requireAuth, requireRole("admin"), deleteSeller);

export default router;
