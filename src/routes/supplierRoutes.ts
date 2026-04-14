/**
 * File: src/routes/supplierRoutes.ts
 * Path: ecommerce-admin/src/routes/supplierRoutes.ts
 *
 * Supplier CRUD routes — all require at least the 'seller' role.
 *
 *   POST   /api/suppliers        — create a new supplier
 *   GET    /api/suppliers        — paginated list of suppliers
 *   GET    /api/suppliers/:id    — single supplier by UUID
 *   PUT    /api/suppliers/:id    — update supplier fields
 *
 * Role access:
 *   requireRole("seller") grants access to users with the 'seller' role
 *   AND the 'admin' role (because the hierarchy is customer < seller < admin).
 *   Customers cannot access any of these endpoints.
 *
 * Guard pattern:
 *   Per-route guards are used (requireAuth + requireRole on each handler)
 *   rather than a blanket router.use(). This is consistent with the
 *   rest of the codebase and avoids the middleware-leakage bug described
 *   in adminRoutes.ts where a blanket guard fires on unrelated requests.
 *
 * Route ordering:
 *   GET /api/suppliers must be registered BEFORE GET /api/suppliers/:id
 *   so Express matches the literal path first. Express already handles this
 *   correctly for different HTTP methods on the same literal path, but the
 *   ordering is kept explicit here for clarity.
 *
 * Registration in src/index.ts:
 *   Add the following line in the API Routes section, alongside the other
 *   per-route-guarded routers (before the blanket-auth routers):
 *
 *     import supplierRoutes from "./routes/supplierRoutes";
 *     app.use("/api", supplierRoutes);
 *
 *   Placement recommendation: after sellersRoutes and before adminRoutes,
 *   so it sits with the other per-route-guarded, non-public routers.
 */

import { Router } from "express";
import { requireAuth, requireRole } from "../middleware/auth";
import {
  createSupplier,
  listSuppliers,
  getSupplier,
  updateSupplier,
} from "../controllers/supplierController";

const router = Router();

// ─────────────────────────────────────────────
// POST /api/suppliers — seller+
//
// Creates a new supplier.
// Body: { name (required), contact_person?, email?, phone?, address?, status? }
// ─────────────────────────────────────────────
router.post(
  "/suppliers",
  requireAuth,
  requireRole("seller"),
  createSupplier
);

// ─────────────────────────────────────────────
// GET /api/suppliers — seller+
//
// Returns a paginated list of suppliers.
// Query params: ?page= ?limit= ?status= ?search=
// ─────────────────────────────────────────────
router.get(
  "/suppliers",
  requireAuth,
  requireRole("seller"),
  listSuppliers
);

// ─────────────────────────────────────────────
// GET /api/suppliers/:id — seller+
//
// Returns a single supplier by UUID.
// Returns 404 if the supplier does not exist.
// ─────────────────────────────────────────────
router.get(
  "/suppliers/:id",
  requireAuth,
  requireRole("seller"),
  getSupplier
);

// ─────────────────────────────────────────────
// PUT /api/suppliers/:id — seller+
//
// Updates any subset of supplier fields.
// At least one field must be supplied.
// Returns 404 if the supplier does not exist.
// ─────────────────────────────────────────────
router.put(
  "/suppliers/:id",
  requireAuth,
  requireRole("seller"),
  updateSupplier
);

export default router;
