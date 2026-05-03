/**
 * File: src/controllers/expenseController.ts
 * Path: src/controllers/expenseController.ts
 *
 * Handlers for expense management endpoints.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Endpoints implemented in this file:
 * ─────────────────────────────────────────────────────────────────────────────
 *
 *   POST   /api/expenses          — createExpense
 *     Creates a new expense record for a seller.
 *     Seller callers: seller_id resolved from their linked seller profile;
 *       any seller_id in the request body is silently ignored.
 *     Admin callers: seller_id must be supplied in the request body.
 *
 *   GET    /api/expenses          — listExpenses
 *     Paginated list of expenses.
 *     Sellers see only their own expenses.
 *     Admins see all and can filter by ?seller_id=.
 *     Supports additional filters: ?expense_type= ?from= ?to=
 *     Supports pagination: ?page= ?limit=
 *
 *   GET    /api/expenses/:id      — getExpense
 *     Returns a single expense by UUID.
 *     Sellers can only access their own expenses (404 if not owner).
 *     Admins can access any expense.
 *
 *   PUT    /api/expenses/:id      — updateExpense
 *     Updates any subset of mutable fields on an existing expense.
 *     seller_id is NOT updatable — ownership is fixed at creation.
 *     Sellers can only update their own expenses.
 *     Admins can update any expense.
 *
 *   DELETE /api/expenses/:id      — deleteExpense
 *     Permanently (hard) deletes an expense record.
 *     Sellers can only delete their own expenses.
 *     Admins can delete any expense.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Access model
 * ─────────────────────────────────────────────────────────────────────────────
 *   Route layer enforces requireAuth + requireRole("seller").
 *   This permits both seller and admin users via the role hierarchy
 *   (customer < seller < admin).
 *   This controller additionally enforces seller-level data scoping:
 *     - Seller users can only read/write expenses belonging to their own
 *       seller profile (resolved via sellers.user_id → sellers.id).
 *     - Admin users bypass the seller_id ownership check and can optionally
 *       filter by ?seller_id= to scope results to a specific seller.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Tables used
 * ─────────────────────────────────────────────────────────────────────────────
 *   expenses  — primary table (all five endpoints)
 *   sellers   — used to resolve seller_id from req.user.id for seller callers
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Ownership / 404 vs 403 convention
 * ─────────────────────────────────────────────────────────────────────────────
 *   Non-owner access returns 404 (not 403) to avoid leaking whether a
 *   resource exists for another seller — consistent with the rest of the
 *   codebase (cartController, orderController, addressController, etc.).
 */

import { Request, Response, NextFunction } from "express";
import { supabaseAdmin } from "../config/supabase";
import { AppError }      from "../middleware/errorHandler";
import { ApiResponse }   from "../types";
import { Expense }       from "../types/expense";
import {
  createExpenseSchema,
  updateExpenseSchema,
  listExpensesQuerySchema,
} from "../validators/expenseValidators";

// ─────────────────────────────────────────────────────────────────────────────
// Shared helpers
// ─────────────────────────────────────────────────────────────────────────────

/** UUID v4 regex — validates :id path params before querying Supabase */
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Validates that a string is a valid UUID.
 * Throws a 400 AppError immediately if the format is wrong so we never
 * send a malformed value to Supabase.
 */
function validateUuid(id: string, label = "id"): void {
  if (!UUID_RE.test(id)) {
    throw new AppError(`Invalid ${label} — must be a valid UUID`, 400);
  }
}

/** Returns true when the authenticated user has the admin role */
function isAdmin(req: Request): boolean {
  return req.userRole?.role_name === "admin";
}

/**
 * Resolves the sellers.id for the currently authenticated seller user.
 *
 * Queries the sellers table using req.user.id (auth UUID) to find the
 * linked seller account, then returns sellers.id.
 *
 * Throws 403 when:
 *   - The user has no linked seller profile in the sellers table.
 *
 * Not called for admin users — admins supply seller_id explicitly in
 * the request body or query params.
 */
async function resolveCallerSellerId(req: Request): Promise<string> {
  const userId = req.user!.id;

  const { data: sellerRow, error } = await supabaseAdmin
    .from("sellers")
    .select("id")
    .eq("user_id", userId)
    .single<{ id: string }>();

  if (error || !sellerRow) {
    throw new AppError("No seller profile linked to this account", 403);
  }

  return sellerRow.id;
}

/**
 * Columns to select for all expense queries.
 * Kept as a constant so every handler returns an identical shape.
 * Maps 1-to-1 with the Expense interface in src/types/expense.ts.
 */
const EXPENSE_SELECT =
  "id, seller_id, title, description, amount, expense_type, expense_date, created_by, created_at";

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/expenses   — seller+
//
// Creates a new expense record.
//
// Seller callers:
//   seller_id is always resolved from the JWT — any seller_id supplied in
//   the request body is silently ignored to prevent privilege escalation.
//   created_by is set to req.user.id (the auth user who made the request).
//
// Admin callers:
//   seller_id must be provided in the request body. Admins can create
//   expenses on behalf of any seller. created_by is still set to req.user.id.
//
// Request body (JSON):
//   {
//     seller_id?:    string (UUID) — required for admin, ignored for seller
//     title?:        string | null
//     description?:  string | null
//     amount:        number        — required, positive
//     expense_type?: 'travel'|'stall'|'logistics'|'misc' | null
//     expense_date:  string        — required, YYYY-MM-DD
//   }
//
// Response 201: { success: true, message: "...", data: Expense }
// ─────────────────────────────────────────────────────────────────────────────
export const createExpense = async (
  req:  Request,
  res:  Response<ApiResponse<unknown>>,
  next: NextFunction
): Promise<void> => {
  try {
    const body = createExpenseSchema.parse(req.body);

    // Resolve the seller_id to write into the new row.
    // Sellers always use their own profile; admins must supply seller_id.
    let sellerId: string;

    if (isAdmin(req)) {
      // Admin must provide seller_id so we know which seller this belongs to
      if (!body.seller_id) {
        throw new AppError(
          "seller_id is required in the request body for admin callers",
          400
        );
      }
      // Validate the supplied seller_id exists
      const { data: sellerRow } = await supabaseAdmin
        .from("sellers")
        .select("id")
        .eq("id", body.seller_id)
        .single<{ id: string }>();

      if (!sellerRow) {
        throw new AppError(
          `Seller with id ${body.seller_id} not found`,
          404
        );
      }
      sellerId = body.seller_id;
    } else {
      // Seller caller — always resolve from JWT; ignore any body.seller_id
      sellerId = await resolveCallerSellerId(req);
    }

    const { data, error } = await supabaseAdmin
      .from("expenses")
      .insert({
        seller_id:    sellerId,
        title:        body.title        ?? null,
        description:  body.description  ?? null,
        amount:       body.amount,
        expense_type: body.expense_type ?? null,
        expense_date: body.expense_date,
        // Track which auth user created this record (audit trail)
        created_by:   req.user!.id,
      })
      .select(EXPENSE_SELECT)
      .single<Expense>();

    if (error) {
      throw new AppError(`Failed to create expense: ${error.message}`, 500);
    }

    res.status(201).json({
      success: true,
      message: "Expense created successfully.",
      data,
    });
  } catch (err) {
    next(err);
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/expenses   — seller+
//
// Returns a paginated list of expenses.
//
// Sellers see only their own expenses (scoped by seller_id resolved from JWT).
// Admins see all expenses and can optionally filter by ?seller_id=.
//
// Query params:
//   ?expense_type=travel|stall|logistics|misc  — filter by category
//   ?seller_id=<uuid>                          — admin only: scope to a seller
//   ?from=YYYY-MM-DD                           — inclusive lower bound on expense_date
//   ?to=YYYY-MM-DD                             — inclusive upper bound on expense_date
//   ?page=<n>                                  — default 1
//   ?limit=<n>                                 — default 20, max 100
//
// Response 200 (paginated envelope):
//   {
//     success: true,
//     data: {
//       data:    Expense[]
//       total:   number
//       page:    number
//       limit:   number
//       hasMore: boolean
//     }
//   }
// ─────────────────────────────────────────────────────────────────────────────
export const listExpenses = async (
  req:  Request,
  res:  Response<ApiResponse<unknown>>,
  next: NextFunction
): Promise<void> => {
  try {
    // Validate and coerce all query params in one step
    const query = listExpensesQuerySchema.parse(req.query);

    const { page, limit, expense_type, from, to } = query;
    const rangeFrom = (page - 1) * limit;
    const rangeTo   = rangeFrom + limit - 1;

    // ── Determine seller_id scope ─────────────────────────────────────────────
    // Sellers are always scoped to their own profile.
    // Admins may optionally narrow to a specific seller via ?seller_id=.
    let sellerIdFilter: string | null = null;

    if (!isAdmin(req)) {
      // Non-admin sellers: always scope to their own seller_id
      sellerIdFilter = await resolveCallerSellerId(req);
    } else if (query.seller_id) {
      // Admin with explicit seller_id filter
      sellerIdFilter = query.seller_id;
    }

    // ── Build query ───────────────────────────────────────────────────────────
    let q = supabaseAdmin
      .from("expenses")
      .select(EXPENSE_SELECT, { count: "exact" })
      .order("expense_date", { ascending: false }) // newest expense date first
      .order("created_at",   { ascending: false }) // tie-break by creation time
      .range(rangeFrom, rangeTo);

    // Apply seller scoping (null = no filter = admin sees all)
    if (sellerIdFilter) {
      q = q.eq("seller_id", sellerIdFilter);
    }

    // Apply optional category filter
    if (expense_type) {
      q = q.eq("expense_type", expense_type);
    }

    // Apply optional date range filters (inclusive, on expense_date)
    if (from) {
      q = q.gte("expense_date", from);
    }
    if (to) {
      q = q.lte("expense_date", to);
    }

    const { data, error, count } = await q;

    if (error) {
      throw new AppError(`Failed to fetch expenses: ${error.message}`, 500);
    }

    res.status(200).json({
      success: true,
      data: {
        data:    data ?? [],
        total:   count ?? 0,
        page,
        limit,
        hasMore: (count ?? 0) > page * limit,
      },
    });
  } catch (err) {
    next(err);
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/expenses/:id   — seller+
//
// Returns a single expense by UUID.
// Sellers can only retrieve expenses belonging to their own seller profile.
// Admins can retrieve any expense.
//
// Returns 404 for:
//   - Non-existent expense
//   - Expense that belongs to a different seller (to avoid leaking existence)
//
// Response 200: { success: true, data: Expense }
// ─────────────────────────────────────────────────────────────────────────────
export const getExpense = async (
  req:  Request,
  res:  Response<ApiResponse<unknown>>,
  next: NextFunction
): Promise<void> => {
  try {
    const { id } = req.params;
    validateUuid(id, "expense id");

    // Fetch the expense row
    const { data, error } = await supabaseAdmin
      .from("expenses")
      .select(EXPENSE_SELECT)
      .eq("id", id)
      .single<Expense>();

    if (error || !data) {
      throw new AppError(`Expense with id ${id} not found`, 404);
    }

    // Seller ownership check: non-admin users may only read their own expenses
    if (!isAdmin(req)) {
      const callerSellerId = await resolveCallerSellerId(req);
      if (data.seller_id !== callerSellerId) {
        // Return 404 (not 403) — avoids leaking that the expense exists
        throw new AppError(`Expense with id ${id} not found`, 404);
      }
    }

    res.status(200).json({
      success: true,
      data,
    });
  } catch (err) {
    next(err);
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// PUT /api/expenses/:id   — seller+
//
// Updates any subset of mutable fields on an existing expense.
// At least one field must be provided (enforced by updateExpenseSchema).
//
// seller_id is intentionally NOT updatable — expense ownership is fixed
// at creation and cannot be transferred between sellers.
//
// Sellers can only update their own expenses.
// Admins can update any expense.
//
// Path params:
//   :id — UUID of the expense to update
//
// Request body (JSON) — all fields optional, at least one required:
//   {
//     title?:        string | null
//     description?:  string | null
//     amount?:       number
//     expense_type?: 'travel'|'stall'|'logistics'|'misc' | null
//     expense_date?: string  (YYYY-MM-DD)
//   }
//
// Response 200: { success: true, message: "...", data: Expense }
// Response 404: expense not found (or not owned by the calling seller)
// ─────────────────────────────────────────────────────────────────────────────
export const updateExpense = async (
  req:  Request,
  res:  Response<ApiResponse<unknown>>,
  next: NextFunction
): Promise<void> => {
  try {
    const { id } = req.params;
    validateUuid(id, "expense id");

    const body = updateExpenseSchema.parse(req.body);

    // ── Ownership check ───────────────────────────────────────────────────────
    // Fetch the existing row first so we can:
    //   (a) confirm it exists
    //   (b) verify seller ownership for non-admin callers
    const { data: existing, error: fetchError } = await supabaseAdmin
      .from("expenses")
      .select("id, seller_id")
      .eq("id", id)
      .single<{ id: string; seller_id: string }>();

    if (fetchError || !existing) {
      throw new AppError(`Expense with id ${id} not found`, 404);
    }

    if (!isAdmin(req)) {
      const callerSellerId = await resolveCallerSellerId(req);
      if (existing.seller_id !== callerSellerId) {
        // Return 404 to avoid leaking existence for another seller's expense
        throw new AppError(`Expense with id ${id} not found`, 404);
      }
    }

    // ── Build update payload ──────────────────────────────────────────────────
    // Only include fields that were explicitly provided in the request body.
    // Sending null for a nullable field (e.g. title: null) clears it.
    // Fields absent from the body are omitted — the DB column keeps its value.
    const updates: Record<string, unknown> = {};

    if (body.title        !== undefined) updates.title        = body.title;
    if (body.description  !== undefined) updates.description  = body.description;
    if (body.amount       !== undefined) updates.amount       = body.amount;
    if (body.expense_type !== undefined) updates.expense_type = body.expense_type;
    if (body.expense_date !== undefined) updates.expense_date = body.expense_date;

    const { data, error } = await supabaseAdmin
      .from("expenses")
      .update(updates)
      .eq("id", id)
      .select(EXPENSE_SELECT)
      .single<Expense>();

    if (error) {
      throw new AppError(`Failed to update expense: ${error.message}`, 500);
    }

    res.status(200).json({
      success: true,
      message: "Expense updated successfully.",
      data,
    });
  } catch (err) {
    next(err);
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /api/expenses/:id   — seller+
//
// Permanently (hard) deletes an expense record.
// This operation is irreversible — no soft-delete column exists on expenses.
//
// Sellers can only delete their own expenses.
// Admins can delete any expense.
//
// Returns 404 for:
//   - Non-existent expense
//   - Expense that belongs to a different seller (to avoid leaking existence)
//
// Response 200: { success: true, message: "..." }
// ─────────────────────────────────────────────────────────────────────────────
export const deleteExpense = async (
  req:  Request,
  res:  Response<ApiResponse<unknown>>,
  next: NextFunction
): Promise<void> => {
  try {
    const { id } = req.params;
    validateUuid(id, "expense id");

    // ── Ownership check ───────────────────────────────────────────────────────
    // Fetch the row to confirm it exists and verify seller ownership before
    // performing the irreversible delete.
    const { data: existing, error: fetchError } = await supabaseAdmin
      .from("expenses")
      .select("id, seller_id")
      .eq("id", id)
      .single<{ id: string; seller_id: string }>();

    if (fetchError || !existing) {
      throw new AppError(`Expense with id ${id} not found`, 404);
    }

    if (!isAdmin(req)) {
      const callerSellerId = await resolveCallerSellerId(req);
      if (existing.seller_id !== callerSellerId) {
        // Return 404 to avoid leaking existence for another seller's expense
        throw new AppError(`Expense with id ${id} not found`, 404);
      }
    }

    // ── Perform the hard delete ───────────────────────────────────────────────
    const { error } = await supabaseAdmin
      .from("expenses")
      .delete()
      .eq("id", id);

    if (error) {
      throw new AppError(`Failed to delete expense: ${error.message}`, 500);
    }

    res.status(200).json({
      success: true,
      message: `Expense ${id} deleted successfully.`,
    });
  } catch (err) {
    next(err);
  }
};
