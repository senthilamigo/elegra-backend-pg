/**
 * File: src/routes/expenseRoutes.ts
 * Path: src/routes/expenseRoutes.ts
 *
 * Express routes for the expense management endpoints.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Endpoints registered:
 * ─────────────────────────────────────────────────────────────────────────────
 *
 *   POST   /api/expenses        — createExpense
 *     Creates a new expense for a seller.
 *     Seller callers: seller_id always resolved from JWT (body.seller_id ignored).
 *     Admin callers:  seller_id must be supplied in the request body.
 *
 *   GET    /api/expenses        — listExpenses
 *     Paginated list. Sellers see own; admins see all.
 *     Supports: ?expense_type= ?seller_id= ?from= ?to= ?page= ?limit=
 *
 *   GET    /api/expenses/:id    — getExpense
 *     Single expense by UUID. Ownership enforced for seller callers.
 *
 *   PUT    /api/expenses/:id    — updateExpense
 *     Update mutable fields. seller_id is NOT updatable.
 *     Ownership enforced for seller callers.
 *
 *   DELETE /api/expenses/:id    — deleteExpense
 *     Hard delete. Ownership enforced for seller callers.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Access model
 * ─────────────────────────────────────────────────────────────────────────────
 *   All endpoints require authentication and role >= seller.
 *   requireRole("seller") permits both seller and admin users via the role
 *   hierarchy (customer < seller < admin).
 *   Seller-level data scoping (own expenses only) is enforced at the
 *   controller level — not here — consistent with the rest of the codebase.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Route registration in src/index.ts
 * ─────────────────────────────────────────────────────────────────────────────
 *   Add the following import and app.use() call in src/index.ts:
 *
 *     import expenseRoutes from "./routes/expenseRoutes";
 *     app.use("/api", expenseRoutes);
 *
 *   Recommended placement: after inventoryRoutes and costsRoutes (and other
 *   per-route-guarded seller+ routers) and before adminRoutes, keeping it
 *   in the per-route-guarded section.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Route ordering note
 * ─────────────────────────────────────────────────────────────────────────────
 *   GET /api/expenses        (list)   is registered BEFORE
 *   GET /api/expenses/:id    (single) so Express matches the literal path
 *   first. This is the standard ordering pattern used across all list + get
 *   router pairs in the codebase (supplierRoutes, inventoryRoutes, etc.).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Guard pattern
 * ─────────────────────────────────────────────────────────────────────────────
 *   Per-route guards (requireAuth + requireRole on each handler) are used
 *   rather than a blanket router.use(). This is consistent with the rest of
 *   the codebase and avoids the middleware-leakage bug documented in
 *   src/routes/adminRoutes.ts (where a blanket guard fires on unrelated paths).
 */

import { Router }                   from "express";
import { requireAuth, requireRole } from "../middleware/auth";
import {
  createExpense,
  listExpenses,
  getExpense,
  updateExpense,
  deleteExpense,
} from "../controllers/expenseController";

const router = Router();

// ─────────────────────────────────────────────
// POST /api/expenses — seller+
//
// Create a new expense record.
//
// Body: {
//   seller_id?:    string (UUID)  — required for admin, ignored for seller
//   title?:        string | null
//   description?:  string | null
//   amount:        number         — required, must be > 0
//   expense_type?: 'travel'|'stall'|'logistics'|'misc' | null
//   expense_date:  string         — required, YYYY-MM-DD
// }
// ─────────────────────────────────────────────
router.post(
  "/expenses",
  requireAuth,
  requireRole("seller"),
  createExpense
);

// ─────────────────────────────────────────────
// GET /api/expenses — seller+
//
// Paginated list of expenses visible to the caller.
// Sellers see only their own; admins see all.
//
// Query params:
//   ?expense_type=travel|stall|logistics|misc
//   ?seller_id=<uuid>   — admin only
//   ?from=YYYY-MM-DD    — inclusive lower bound on expense_date
//   ?to=YYYY-MM-DD      — inclusive upper bound on expense_date
//   ?page=<n>           — default 1
//   ?limit=<n>          — default 20, max 100
// ─────────────────────────────────────────────
router.get(
  "/expenses",
  requireAuth,
  requireRole("seller"),
  listExpenses
);

// ─────────────────────────────────────────────
// GET /api/expenses/:id — seller+
//
// Returns a single expense by UUID.
// Sellers can only access their own expenses (404 otherwise).
// ─────────────────────────────────────────────
router.get(
  "/expenses/:id",
  requireAuth,
  requireRole("seller"),
  getExpense
);

// ─────────────────────────────────────────────
// PUT /api/expenses/:id — seller+
//
// Update mutable fields on an existing expense.
// At least one field must be provided. seller_id is NOT updatable.
// Sellers can only update their own expenses (404 otherwise).
//
// Body (all optional, at least one required): {
//   title?:        string | null
//   description?:  string | null
//   amount?:       number
//   expense_type?: 'travel'|'stall'|'logistics'|'misc' | null
//   expense_date?: string  (YYYY-MM-DD)
// }
// ─────────────────────────────────────────────
router.put(
  "/expenses/:id",
  requireAuth,
  requireRole("seller"),
  updateExpense
);

// ─────────────────────────────────────────────
// DELETE /api/expenses/:id — seller+
//
// Permanently deletes an expense. No soft-delete — irreversible.
// Sellers can only delete their own expenses (404 otherwise).
// ─────────────────────────────────────────────
router.delete(
  "/expenses/:id",
  requireAuth,
  requireRole("seller"),
  deleteExpense
);

export default router;
