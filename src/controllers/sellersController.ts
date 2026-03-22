/**
 * File: src/controllers/sellersController.ts
 * Path: ecommerce-admin/src/controllers/sellersController.ts
 *
 * CRUD handlers for the sellers table.
 * Endpoints: list, getById, getMyProfile, create, update,
 *            updateStatus, verify, delete.
 */
import { Request, Response, NextFunction } from "express";
import { supabaseAdmin } from "../config/supabase";
import { AppError }      from "../middleware/errorHandler";
import { ApiResponse }   from "../types";
import { Seller }        from "../types/seller";
import {
  createSellerSchema,
  updateSellerSchema,
  updateSellerStatusSchema,
} from "../validators/sellerValidators";

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function validateUuid(id: string, label = "id"): void {
  if (!UUID_RE.test(id)) throw new AppError(`Invalid ${label} — must be a valid UUID`, 400);
}

const SELLER_SELECT = [
  "id", "user_id", "business_name", "contact_name",
  "email", "phone", "description", "is_verified",
  "status", "created_at", "updated_at",
].join(", ");

/**
 * Fetch a seller row and optionally assert it belongs to the given user_id.
 * Throws 404 if not found, 403 if owned by someone else.
 */
async function fetchSeller(id: string, ownerId?: string): Promise<Seller> {
  const { data, error } = await supabaseAdmin
    .from("sellers")
    .select(SELLER_SELECT)
    .eq("id", id)
    .single<Seller>();

  if (error || !data) throw new AppError(`Seller with id ${id} not found`, 404);

  if (ownerId && data.user_id !== ownerId) {
    throw new AppError("You do not have permission to modify this seller profile", 403);
  }

  return data;
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/sellers   — admin
//
// Paginated list of all sellers. Supports ?status= filter and ?page= / ?limit=.
// ─────────────────────────────────────────────────────────────────────────────
export const listSellers = async (
  req:  Request,
  res:  Response<ApiResponse<unknown>>,
  next: NextFunction
): Promise<void> => {
  try {
    const page   = Math.max(1, parseInt(String(req.query.page  ?? "1"),  10) || 1);
    const limit  = Math.min(100, Math.max(1, parseInt(String(req.query.limit ?? "20"), 10) || 20));
    const status = req.query.status  as string | undefined;
    const userId = req.query.user_id as string | undefined;
    const from   = (page - 1) * limit;
    const to     = from + limit - 1;

    let query = supabaseAdmin
      .from("sellers")
      .select(SELLER_SELECT, { count: "exact" })
      .order("created_at", { ascending: false })
      .range(from, to);

    if (status) {
      if (!["active", "suspended", "pending"].includes(status)) {
        throw new AppError("Query param 'status' must be 'active', 'suspended', or 'pending'", 400);
      }
      query = query.eq("status", status);
    }

    // Allow admin UI to fetch the seller profile for a specific user
    if (userId) {
      query = query.eq("user_id", userId);
    }

    const { data, error, count } = await query;
    if (error) throw new AppError(`Failed to fetch sellers: ${error.message}`, 500);

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
// GET /api/sellers/:id   — admin | seller (own profile)
// ─────────────────────────────────────────────────────────────────────────────
export const getSellerById = async (
  req:  Request,
  res:  Response<ApiResponse<unknown>>,
  next: NextFunction
): Promise<void> => {
  try {
    const { id } = req.params;
    validateUuid(id, "seller id");

    // Sellers can only fetch their own profile; admins can fetch any
    const role     = req.userRole?.role_name;
    const ownerId  = role === "admin" ? undefined : req.user!.id;

    const seller = await fetchSeller(id, ownerId);

    // Non-admin sellers can only see their own record
    if (role === "seller" && seller.user_id !== req.user!.id) {
      throw new AppError("You do not have permission to view this seller profile", 403);
    }

    res.status(200).json({ success: true, data: seller });
  } catch (err) {
    next(err);
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/sellers/me   — seller (own profile)
//
// Convenience endpoint — returns the seller profile for the authenticated user.
// ─────────────────────────────────────────────────────────────────────────────
export const getMySellerProfile = async (
  req:  Request,
  res:  Response<ApiResponse<unknown>>,
  next: NextFunction
): Promise<void> => {
  try {
    const { data, error } = await supabaseAdmin
      .from("sellers")
      .select(SELLER_SELECT)
      .eq("user_id", req.user!.id)
      .single<Seller>();

    if (error || !data) {
      throw new AppError("Seller profile not found for this account", 404);
    }

    res.status(200).json({ success: true, data });
  } catch (err) {
    next(err);
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/sellers   — auth (seller registers their own profile)
//
// user_id comes from the JWT — never from the request body.
// is_verified defaults to false; status defaults to 'pending'.
// A user can only have one seller profile.
// ─────────────────────────────────────────────────────────────────────────────
export const createSeller = async (
  req:  Request,
  res:  Response<ApiResponse<unknown>>,
  next: NextFunction
): Promise<void> => {
  try {
    const userId = req.user!.id;
    const body   = createSellerSchema.parse(req.body);

    // Prevent duplicate seller profiles for the same user
    const { data: existing } = await supabaseAdmin
      .from("sellers")
      .select("id")
      .eq("user_id", userId)
      .maybeSingle<{ id: string }>();

    if (existing) {
      throw new AppError("A seller profile already exists for this account", 409);
    }

    const { data, error } = await supabaseAdmin
      .from("sellers")
      .insert({
        user_id:       userId,
        business_name: body.business_name,
        contact_name:  body.contact_name,
        email:         body.email,
        phone:         body.phone,
        description:   body.description ?? null,
        is_verified:   false,   // always starts unverified
        status:        "pending", // always starts pending admin review
      })
      .select(SELLER_SELECT)
      .single<Seller>();

    if (error) throw new AppError(`Failed to create seller profile: ${error.message}`, 500);

    res.status(201).json({
      success: true,
      message: "Seller profile created. Pending admin review.",
      data,
    });
  } catch (err) {
    next(err);
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// PUT /api/sellers/:id   — seller (own profile only)
//
// Updates business details. is_verified and status cannot be changed here.
// ─────────────────────────────────────────────────────────────────────────────
export const updateSeller = async (
  req:  Request,
  res:  Response<ApiResponse<unknown>>,
  next: NextFunction
): Promise<void> => {
  try {
    const { id } = req.params;
    validateUuid(id, "seller id");

    const body = updateSellerSchema.parse(req.body);

    // Enforce ownership — only the seller who owns this profile or an admin can update
    const role = req.userRole?.role_name;
    const ownerId = role === "admin" ? undefined : req.user!.id;
    await fetchSeller(id, ownerId);

    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (body.business_name !== undefined) updates.business_name = body.business_name;
    if (body.contact_name  !== undefined) updates.contact_name  = body.contact_name;
    if (body.email         !== undefined) updates.email         = body.email;
    if (body.phone         !== undefined) updates.phone         = body.phone;
    if (body.description   !== undefined) updates.description   = body.description ?? null;

    const { data, error } = await supabaseAdmin
      .from("sellers")
      .update(updates)
      .eq("id", id)
      .select(SELLER_SELECT)
      .single<Seller>();

    if (error) throw new AppError(`Failed to update seller: ${error.message}`, 500);

    res.status(200).json({
      success: true,
      message: "Seller profile updated.",
      data,
    });
  } catch (err) {
    next(err);
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /api/sellers/:id/status   — admin
//
// Updates the seller status ('active' | 'suspended' | 'pending').
// ─────────────────────────────────────────────────────────────────────────────
export const updateSellerStatus = async (
  req:  Request,
  res:  Response<ApiResponse<unknown>>,
  next: NextFunction
): Promise<void> => {
  try {
    const { id } = req.params;
    validateUuid(id, "seller id");

    const { status } = updateSellerStatusSchema.parse(req.body);

    await fetchSeller(id); // confirm it exists

    const { data, error } = await supabaseAdmin
      .from("sellers")
      .update({ status, updated_at: new Date().toISOString() })
      .eq("id", id)
      .select(SELLER_SELECT)
      .single<Seller>();

    if (error) throw new AppError(`Failed to update seller status: ${error.message}`, 500);

    res.status(200).json({
      success: true,
      message: `Seller status updated to '${status}'.`,
      data,
    });
  } catch (err) {
    next(err);
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /api/sellers/:id/verify   — admin
//
// Toggles is_verified. Also sets status to 'active' when verifying.
// ─────────────────────────────────────────────────────────────────────────────
export const verifySeller = async (
  req:  Request,
  res:  Response<ApiResponse<unknown>>,
  next: NextFunction
): Promise<void> => {
  try {
    const { id } = req.params;
    validateUuid(id, "seller id");

    const seller = await fetchSeller(id);
    const newVerified = !seller.is_verified;

    const { data, error } = await supabaseAdmin
      .from("sellers")
      .update({
        is_verified: newVerified,
        // Automatically activate when verifying; revert to pending when un-verifying
        status:      newVerified ? "active" : "pending",
        updated_at:  new Date().toISOString(),
      })
      .eq("id", id)
      .select(SELLER_SELECT)
      .single<Seller>();

    if (error) throw new AppError(`Failed to update verification: ${error.message}`, 500);

    res.status(200).json({
      success: true,
      message: `Seller ${newVerified ? "verified and activated" : "unverified"}.`,
      data,
    });
  } catch (err) {
    next(err);
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /api/sellers/:id   — admin
//
// Permanently deletes a seller profile.
// ─────────────────────────────────────────────────────────────────────────────
export const deleteSeller = async (
  req:  Request,
  res:  Response<ApiResponse<unknown>>,
  next: NextFunction
): Promise<void> => {
  try {
    const { id } = req.params;
    validateUuid(id, "seller id");

    await fetchSeller(id); // confirm it exists

    const { error } = await supabaseAdmin
      .from("sellers")
      .delete()
      .eq("id", id);

    if (error) throw new AppError(`Failed to delete seller: ${error.message}`, 500);

    res.status(200).json({
      success: true,
      message: "Seller profile deleted.",
    });
  } catch (err) {
    next(err);
  }
};
