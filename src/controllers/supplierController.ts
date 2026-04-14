/**
 * File: src/controllers/supplierController.ts
 * Path: ecommerce-admin/src/controllers/supplierController.ts
 *
 * Handlers for supplier CRUD endpoints.
 *
 * Covered endpoints (all require seller role or above):
 *   POST   /api/suppliers        — createSupplier
 *   GET    /api/suppliers        — listSuppliers
 *   GET    /api/suppliers/:id    — getSupplier
 *   PUT    /api/suppliers/:id    — updateSupplier
 *
 * suppliers table columns:
 *   id, name, contact_person, email, phone, address, status, created_at
 *
 * Role enforcement:
 *   All four endpoints require at least the 'seller' role.
 *   This is applied at the route level via requireRole("seller").
 *   Because the role hierarchy is customer < seller < admin, admins
 *   automatically have access too.
 *
 * Design notes:
 *   - Sellers can create and manage suppliers relevant to their own
 *     products. There is no ownership constraint on suppliers in the DB
 *     schema — any seller or admin can read/update any supplier.
 *   - Pagination is supported on the list endpoint via ?page= and ?limit=.
 *   - An optional ?status= filter is supported on the list endpoint.
 *   - An optional ?search= filter performs a case-insensitive partial
 *     match on the supplier name.
 *   - UUIDs in path params are validated with a regex before any DB call.
 *   - All errors are forwarded to the central error handler via next(err).
 */

import { Request, Response, NextFunction } from "express";
import { supabaseAdmin } from "../config/supabase";
import { AppError }      from "../middleware/errorHandler";
import { ApiResponse }   from "../types";
import { Supplier }      from "../types/supplier";
import {
  createSupplierSchema,
  updateSupplierSchema,
} from "../validators/supplierValidators";

// ─────────────────────────────────────────────────────────────────────────────
// Shared helpers
// ─────────────────────────────────────────────────────────────────────────────

/** UUID v4 regex — used to validate :id path params before querying the DB */
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Validates that a string looks like a UUID.
 * Throws a 400 AppError immediately if the format is wrong so we never
 * send a malformed value to Supabase.
 *
 * @param id    - The raw string to validate
 * @param label - Human-readable label used in the error message (e.g. "supplier id")
 */
function validateUuid(id: string, label = "id"): void {
  if (!UUID_RE.test(id)) {
    throw new AppError(`Invalid ${label} — must be a valid UUID`, 400);
  }
}

/**
 * Parses ?page= and ?limit= query params with safe defaults and caps.
 * Returns the page/limit values plus the Supabase range offsets.
 *
 * Defaults: page=1, limit=20
 * Cap: limit ≤ 100
 */
function parsePage(query: Record<string, unknown>) {
  const page  = Math.max(1, parseInt(String(query.page  ?? "1"),  10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(String(query.limit ?? "20"), 10) || 20));
  return {
    page,
    limit,
    from: (page - 1) * limit,
    to:   (page - 1) * limit + limit - 1,
  };
}

/**
 * Columns selected in every supplier query.
 * Kept as a constant so all handlers return the same shape.
 * Matches every column in the suppliers table.
 */
const SUPPLIER_SELECT =
  "id, name, contact_person, email, phone, address, status, created_at";

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/suppliers   — seller+
//
// Creates a new supplier row.
// All fields except `name` are optional at creation; status defaults to 'active'.
//
// Request body (JSON):
//   {
//     name:           string  (required)
//     contact_person: string  (optional)
//     email:          string  (optional, valid email)
//     phone:          string  (optional)
//     address:        string  (optional)
//     status:         'active'|'inactive'|'suspended'  (optional, default 'active')
//   }
//
// Response 201: { success: true, message: "...", data: Supplier }
// ─────────────────────────────────────────────────────────────────────────────
export const createSupplier = async (
  req:  Request,
  res:  Response<ApiResponse<unknown>>,
  next: NextFunction
): Promise<void> => {
  try {
    // Validate and parse the request body with Zod.
    // createSupplierSchema applies type coercion, trimming, and defaults.
    const body = createSupplierSchema.parse(req.body);

    const { data, error } = await supabaseAdmin
      .from("suppliers")
      .insert({
        name:           body.name,
        contact_person: body.contact_person ?? null,
        email:          body.email          ?? null,
        phone:          body.phone          ?? null,
        address:        body.address        ?? null,
        status:         body.status,         // schema default is 'active'
      })
      .select(SUPPLIER_SELECT)
      .single<Supplier>();

    if (error) {
      throw new AppError(`Failed to create supplier: ${error.message}`, 500);
    }

    res.status(201).json({
      success: true,
      message: "Supplier created successfully.",
      data,
    });
  } catch (err) {
    next(err);
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/suppliers   — seller+
//
// Returns a paginated list of all suppliers.
//
// Query params:
//   ?page=<n>         Page number (default: 1)
//   ?limit=<n>        Items per page (default: 20, max: 100)
//   ?status=<value>   Filter by status: 'active' | 'inactive' | 'suspended'
//   ?search=<term>    Case-insensitive partial match on supplier name
//
// Results are ordered by name ascending.
//
// Response 200 (paginated envelope):
//   {
//     success: true,
//     data: {
//       data:    Supplier[]
//       total:   number
//       page:    number
//       limit:   number
//       hasMore: boolean
//     }
//   }
// ─────────────────────────────────────────────────────────────────────────────
export const listSuppliers = async (
  req:  Request,
  res:  Response<ApiResponse<unknown>>,
  next: NextFunction
): Promise<void> => {
  try {
    const { page, limit, from, to } = parsePage(
      req.query as Record<string, unknown>
    );

    // Extract optional filter params
    const statusParam = req.query.status as string | undefined;
    const searchParam = req.query.search as string | undefined;

    // Validate the status filter value before forwarding to Supabase
    if (statusParam) {
      const validStatuses = ["active", "inactive", "suspended"];
      if (!validStatuses.includes(statusParam)) {
        throw new AppError(
          "Query param 'status' must be 'active', 'inactive', or 'suspended'",
          400
        );
      }
    }

    // Build the base query with count for pagination metadata
    let query = supabaseAdmin
      .from("suppliers")
      .select(SUPPLIER_SELECT, { count: "exact" })
      .order("name", { ascending: true })
      .range(from, to);

    // Apply optional filters — each is additive (AND logic)
    if (statusParam) {
      query = query.eq("status", statusParam);
    }

    if (searchParam?.trim()) {
      // ilike = case-insensitive LIKE; wrapping in % makes it a substring match
      query = query.ilike("name", `%${searchParam.trim()}%`);
    }

    const { data, error, count } = await query;

    if (error) {
      throw new AppError(`Failed to fetch suppliers: ${error.message}`, 500);
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
// GET /api/suppliers/:id   — seller+
//
// Returns a single supplier by its UUID.
// Returns 404 if the supplier does not exist.
//
// Path params:
//   :id — UUID of the supplier
//
// Response 200: { success: true, data: Supplier }
// ─────────────────────────────────────────────────────────────────────────────
export const getSupplier = async (
  req:  Request,
  res:  Response<ApiResponse<unknown>>,
  next: NextFunction
): Promise<void> => {
  try {
    const { id } = req.params;

    // Validate UUID format before sending to the DB to avoid Postgres errors
    validateUuid(id, "supplier id");

    const { data, error } = await supabaseAdmin
      .from("suppliers")
      .select(SUPPLIER_SELECT)
      .eq("id", id)
      .single<Supplier>();

    // Supabase returns an error (PGRST116 "not found") when .single() finds
    // no row — treat that as a 404 rather than a 500
    if (error || !data) {
      throw new AppError(`Supplier with id ${id} not found`, 404);
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
// PUT /api/suppliers/:id   — seller+
//
// Updates any subset of fields on an existing supplier.
// At least one field must be provided (enforced by Zod schema).
//
// Path params:
//   :id — UUID of the supplier to update
//
// Request body (JSON) — all fields optional, at least one required:
//   {
//     name?:           string
//     contact_person?: string | null
//     email?:          string | null
//     phone?:          string | null
//     address?:        string | null
//     status?:         'active'|'inactive'|'suspended'
//   }
//
// Response 200: { success: true, message: "...", data: Supplier }
// Response 404: supplier not found
// ─────────────────────────────────────────────────────────────────────────────
export const updateSupplier = async (
  req:  Request,
  res:  Response<ApiResponse<unknown>>,
  next: NextFunction
): Promise<void> => {
  try {
    const { id } = req.params;

    // Validate UUID format before querying the DB
    validateUuid(id, "supplier id");

    // Validate and parse the request body
    const body = updateSupplierSchema.parse(req.body);

    // Confirm the supplier exists before attempting the update.
    // This gives us a clear 404 instead of a silent no-op if the id is wrong.
    const { data: existing, error: fetchError } = await supabaseAdmin
      .from("suppliers")
      .select("id")
      .eq("id", id)
      .single<{ id: string }>();

    if (fetchError || !existing) {
      throw new AppError(`Supplier with id ${id} not found`, 404);
    }

    // Build the update payload from only the fields that were explicitly sent.
    // Fields not present in the body are omitted entirely so the DB column
    // retains its current value. Explicitly null values clear the DB column.
    const updates: Record<string, unknown> = {};

    if (body.name           !== undefined) updates.name           = body.name;
    if (body.contact_person !== undefined) updates.contact_person = body.contact_person ?? null;
    if (body.email          !== undefined) updates.email          = body.email          ?? null;
    if (body.phone          !== undefined) updates.phone          = body.phone          ?? null;
    if (body.address        !== undefined) updates.address        = body.address        ?? null;
    if (body.status         !== undefined) updates.status         = body.status;

    const { data, error } = await supabaseAdmin
      .from("suppliers")
      .update(updates)
      .eq("id", id)
      .select(SUPPLIER_SELECT)
      .single<Supplier>();

    if (error) {
      throw new AppError(`Failed to update supplier: ${error.message}`, 500);
    }

    res.status(200).json({
      success: true,
      message: "Supplier updated successfully.",
      data,
    });
  } catch (err) {
    next(err);
  }
};
