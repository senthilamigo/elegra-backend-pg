/**
 * File: src/controllers/sellersController.ts
 * Path: ecommerce-admin/src/controllers/sellersController.ts
 *
 * Handlers for the split seller_profiles + sellers tables.
 *
 * seller_profiles — business identity (admin-managed):
 *   GET  /api/seller-profiles            public  — list profiles (for signup dropdown)
 *   POST /api/seller-profiles            admin   — create profile
 *   PUT  /api/seller-profiles/:id        admin   — update profile details
 *   PATCH /api/seller-profiles/:id/status admin  — update profile status / verify
 *
 * sellers — user ↔ profile join (user-managed):
 *   GET  /api/sellers                    admin   — list all seller accounts
 *   GET  /api/sellers/me                 seller  — own seller account + profile
 *   GET  /api/sellers/:id                admin   — single seller account
 *   POST /api/sellers                    auth    — link user to a seller_profile
 *   PATCH /api/sellers/:id/status        admin   — update seller account status
 *   DELETE /api/sellers/:id              admin   — remove seller account
 */

import { Request, Response, NextFunction } from "express";
import { supabaseAdmin } from "../config/supabase";
import { AppError }      from "../middleware/errorHandler";
import { ApiResponse }   from "../types";
import { Seller, SellerProfile, SellerWithProfile } from "../types/seller";
import {
  createSellerProfileSchema,
  updateSellerProfileSchema,
  createSellerSchema,
  updateSellerStatusSchema,
  updateSellerProfileStatusSchema,
} from "../validators/sellerValidators";

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function validateUuid(id: string, label = "id"): void {
  if (!UUID_RE.test(id))
    throw new AppError(`Invalid ${label} — must be a valid UUID`, 400);
}

const PROFILE_SELECT =
  "id, business_name, contact_name, email, phone, description, is_verified, status, created_at, updated_at";

const SELLER_SELECT =
  "id, user_id, seller_profile_id, status, created_at, updated_at, seller_profiles ( id, business_name, contact_name, email, phone, description, is_verified, status )";

function parsePage(query: Record<string, unknown>) {
  const page  = Math.max(1, parseInt(String(query.page  ?? "1"),  10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(String(query.limit ?? "20"), 10) || 20));
  return { page, limit, from: (page - 1) * limit, to: (page - 1) * limit + limit - 1 };
}

// ─────────────────────────────────────────────────────────────────────────────
// SELLER PROFILES
// ─────────────────────────────────────────────────────────────────────────────

/**
 * GET /api/seller-profiles   — public
 * Lists seller_profiles. Used by the signup screen dropdown.
 * Supports ?status= and ?search= filters.
 */
export const listSellerProfiles = async (
  req:  Request,
  res:  Response<ApiResponse<unknown>>,
  next: NextFunction
): Promise<void> => {
  try {
    const { page, limit, from, to } = parsePage(req.query as Record<string, unknown>);
    const status = req.query.status as string | undefined;
    const search = req.query.search as string | undefined;

    let q = supabaseAdmin
      .from("seller_profiles")
      .select(PROFILE_SELECT, { count: "exact" })
      .order("business_name", { ascending: true })
      .range(from, to);

    if (status) {
      if (!["active", "suspended", "pending"].includes(status))
        throw new AppError("status must be 'active', 'suspended', or 'pending'", 400);
      q = q.eq("status", status);
    }
    if (search) q = q.ilike("business_name", `%${search}%`);

    const { data, error, count } = await q;
    if (error) throw new AppError(`Failed to fetch seller profiles: ${error.message}`, 500);

    res.status(200).json({
      success: true,
      data: { data: data ?? [], total: count ?? 0, page, limit, hasMore: (count ?? 0) > page * limit },
    });
  } catch (err) { next(err); }
};

/**
 * POST /api/seller-profiles   — admin
 * Creates a new seller_profile (business entity).
 */
export const createSellerProfile = async (
  req:  Request,
  res:  Response<ApiResponse<unknown>>,
  next: NextFunction
): Promise<void> => {
  try {
    const body = createSellerProfileSchema.parse(req.body);

    const { data, error } = await supabaseAdmin
      .from("seller_profiles")
      .insert({
        business_name: body.business_name,
        contact_name:  body.contact_name  ?? null,
        email:         body.email         ?? null,
        phone:         body.phone         ?? null,
        description:   body.description   ?? null,
        is_verified:   false,
        status:        "pending",
      })
      .select(PROFILE_SELECT)
      .single<SellerProfile>();

    if (error) throw new AppError(`Failed to create seller profile: ${error.message}`, 500);

    res.status(201).json({ success: true, message: "Seller profile created.", data });
  } catch (err) { next(err); }
};

/**
 * PUT /api/seller-profiles/:id   — admin
 * Updates business details on a seller_profile.
 */
export const updateSellerProfile = async (
  req:  Request,
  res:  Response<ApiResponse<unknown>>,
  next: NextFunction
): Promise<void> => {
  try {
    const { id } = req.params;
    validateUuid(id, "seller profile id");

    const body = updateSellerProfileSchema.parse(req.body);

    const { data: existing } = await supabaseAdmin
      .from("seller_profiles").select("id").eq("id", id).single<{ id: string }>();
    if (!existing) throw new AppError(`Seller profile ${id} not found`, 404);

    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (body.business_name !== undefined) updates.business_name = body.business_name;
    if (body.contact_name  !== undefined) updates.contact_name  = body.contact_name ?? null;
    if (body.email         !== undefined) updates.email         = body.email        ?? null;
    if (body.phone         !== undefined) updates.phone         = body.phone        ?? null;
    if (body.description   !== undefined) updates.description   = body.description  ?? null;

    const { data, error } = await supabaseAdmin
      .from("seller_profiles").update(updates).eq("id", id)
      .select(PROFILE_SELECT).single<SellerProfile>();

    if (error) throw new AppError(`Failed to update seller profile: ${error.message}`, 500);

    res.status(200).json({ success: true, message: "Seller profile updated.", data });
  } catch (err) { next(err); }
};

/**
 * PATCH /api/seller-profiles/:id/status   — admin
 * Updates status and/or is_verified on a seller_profile.
 */
export const updateSellerProfileStatus = async (
  req:  Request,
  res:  Response<ApiResponse<unknown>>,
  next: NextFunction
): Promise<void> => {
  try {
    const { id } = req.params;
    validateUuid(id, "seller profile id");

    const { status } = updateSellerProfileStatusSchema.parse(req.body);

    const { data: existing } = await supabaseAdmin
      .from("seller_profiles").select("id").eq("id", id).single<{ id: string }>();
    if (!existing) throw new AppError(`Seller profile ${id} not found`, 404);

    // When activating, also mark as verified; when suspending/pending, unverify
    const is_verified = status === "active";

    const { data, error } = await supabaseAdmin
      .from("seller_profiles")
      .update({ status, is_verified, updated_at: new Date().toISOString() })
      .eq("id", id)
      .select(PROFILE_SELECT)
      .single<SellerProfile>();

    if (error) throw new AppError(`Failed to update profile status: ${error.message}`, 500);

    res.status(200).json({
      success: true,
      message: `Seller profile status updated to '${status}'.`,
      data,
    });
  } catch (err) { next(err); }
};

// ─────────────────────────────────────────────────────────────────────────────
// SELLERS (user ↔ profile join)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * GET /api/sellers   — admin
 * Paginated list of all seller accounts joined with their profile.
 */
export const listSellers = async (
  req:  Request,
  res:  Response<ApiResponse<unknown>>,
  next: NextFunction
): Promise<void> => {
  try {
    const { page, limit, from, to } = parsePage(req.query as Record<string, unknown>);
    const status = req.query.status  as string | undefined;
    const userId = req.query.user_id as string | undefined;

    let q = supabaseAdmin
      .from("sellers")
      .select(SELLER_SELECT, { count: "exact" })
      .order("created_at", { ascending: false })
      .range(from, to);

    if (status) {
      if (!["active", "suspended", "pending"].includes(status))
        throw new AppError("status must be 'active', 'suspended', or 'pending'", 400);
      q = q.eq("status", status);
    }
    if (userId) q = q.eq("user_id", userId);

    const { data, error, count } = await q;
    if (error) throw new AppError(`Failed to fetch sellers: ${error.message}`, 500);

    res.status(200).json({
      success: true,
      data: { data: data ?? [], total: count ?? 0, page, limit, hasMore: (count ?? 0) > page * limit },
    });
  } catch (err) { next(err); }
};

/**
 * GET /api/sellers/me   — seller
 * Returns the authenticated user's seller account joined with their profile.
 */
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
      .single<SellerWithProfile>();

    if (error || !data)
      throw new AppError("Seller account not found for this user", 404);

    res.status(200).json({ success: true, data });
  } catch (err) { next(err); }
};

/**
 * GET /api/sellers/:id   — admin
 * Returns a single seller account joined with its profile.
 */
export const getSellerById = async (
  req:  Request,
  res:  Response<ApiResponse<unknown>>,
  next: NextFunction
): Promise<void> => {
  try {
    const { id } = req.params;
    validateUuid(id, "seller id");

    const { data, error } = await supabaseAdmin
      .from("sellers")
      .select(SELLER_SELECT)
      .eq("id", id)
      .single<SellerWithProfile>();

    if (error || !data)
      throw new AppError(`Seller with id ${id} not found`, 404);

    res.status(200).json({ success: true, data });
  } catch (err) { next(err); }
};

/**
 * POST /api/sellers   — auth
 * Links the authenticated user to an existing seller_profile.
 * One seller account per user (enforced by unique constraint on user_id).
 */
export const createSeller = async (
  req:  Request,
  res:  Response<ApiResponse<unknown>>,
  next: NextFunction
): Promise<void> => {
  try {
    const userId = req.user!.id;
    const body   = createSellerSchema.parse(req.body);

    // Ensure the seller_profile exists
    const { data: profile } = await supabaseAdmin
      .from("seller_profiles")
      .select("id, status")
      .eq("id", body.seller_profile_id)
      .single<{ id: string; status: string }>();

    if (!profile)
      throw new AppError(`Seller profile ${body.seller_profile_id} not found`, 404);

    // Prevent duplicate seller accounts for the same user
    const { data: existing } = await supabaseAdmin
      .from("sellers")
      .select("id")
      .eq("user_id", userId)
      .maybeSingle<{ id: string }>();

    if (existing)
      throw new AppError("A seller account already exists for this user", 409);

    const { data, error } = await supabaseAdmin
      .from("sellers")
      .insert({
        user_id:           userId,
        seller_profile_id: body.seller_profile_id,
        status:            "pending",
      })
      .select(SELLER_SELECT)
      .single<SellerWithProfile>();

    if (error) throw new AppError(`Failed to create seller account: ${error.message}`, 500);

    res.status(201).json({
      success: true,
      message: "Seller account created. Pending admin review.",
      data,
    });
  } catch (err) { next(err); }
};

/**
 * PATCH /api/sellers/:id/status   — admin
 * Updates the sellers.status for a user's seller account.
 */
export const updateSellerStatus = async (
  req:  Request,
  res:  Response<ApiResponse<unknown>>,
  next: NextFunction
): Promise<void> => {
  try {
    const { id } = req.params;
    validateUuid(id, "seller id");

    const { status } = updateSellerStatusSchema.parse(req.body);

    const { data: existing } = await supabaseAdmin
      .from("sellers").select("id").eq("id", id).single<{ id: string }>();
    if (!existing) throw new AppError(`Seller with id ${id} not found`, 404);

    const { data, error } = await supabaseAdmin
      .from("sellers")
      .update({ status, updated_at: new Date().toISOString() })
      .eq("id", id)
      .select(SELLER_SELECT)
      .single<SellerWithProfile>();

    if (error) throw new AppError(`Failed to update seller status: ${error.message}`, 500);

    res.status(200).json({
      success: true,
      message: `Seller status updated to '${status}'.`,
      data,
    });
  } catch (err) { next(err); }
};

/**
 * DELETE /api/sellers/:id   — admin
 * Permanently removes a seller account (not the profile).
 */
export const deleteSeller = async (
  req:  Request,
  res:  Response<ApiResponse<unknown>>,
  next: NextFunction
): Promise<void> => {
  try {
    const { id } = req.params;
    validateUuid(id, "seller id");

    const { data: existing } = await supabaseAdmin
      .from("sellers").select("id").eq("id", id).single<{ id: string }>();
    if (!existing) throw new AppError(`Seller with id ${id} not found`, 404);

    const { error } = await supabaseAdmin.from("sellers").delete().eq("id", id);
    if (error) throw new AppError(`Failed to delete seller: ${error.message}`, 500);

    res.status(200).json({ success: true, message: "Seller account removed." });
  } catch (err) { next(err); }
};
