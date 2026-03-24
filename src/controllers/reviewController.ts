/**
 * File: src/controllers/reviewController.ts
 * Path: ecommerce-admin/src/controllers/reviewController.ts
 *
 * Handlers for product review endpoints.
 *
 * product_reviews columns:
 *   id, user_id, product_id, product_variant_id, rating,
 *   review_title, review_text, is_verified_purchase,
 *   is_approved, created_at, updated_at
 *
 * Role enforcement (applied at route level):
 *   public — GET /api/products/:id/reviews
 *   auth   — POST (submit), PUT (edit own), DELETE (delete own)
 *   admin  — PATCH /api/reviews/:id/approve
 *   seller — GET /api/seller/reviews
 *
 * Verified purchase check (POST):
 *   A review is flagged is_verified_purchase = true when the submitting
 *   user has a delivered order that contains the product being reviewed.
 *   This is derived automatically — the client never supplies this field.
 */

import { Request, Response, NextFunction } from "express";
import { supabaseAdmin } from "../config/supabase";
import { AppError }      from "../middleware/errorHandler";
import { ApiResponse }   from "../types";
import { ProductReview } from "../types/review";
import {
  createReviewSchema,
  updateReviewSchema,
  approveReviewSchema,
} from "../validators/reviewValidators";

// ─────────────────────────────────────────────────────────────────────────────
// Shared helpers
// ─────────────────────────────────────────────────────────────────────────────

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function validateUuid(id: string, label = "id"): void {
  if (!UUID_RE.test(id))
    throw new AppError(`Invalid ${label} — must be a valid UUID`, 400);
}

/** All columns to select from product_reviews, joined with user first_name for display */
const REVIEW_SELECT = `
  id,
  user_id,
  product_id,
  product_variant_id,
  rating,
  review_title,
  review_text,
  is_verified_purchase,
  is_approved,
  created_at,
  updated_at,
  user_role ( first_name, last_name )
`.trim();

function parsePage(query: Record<string, unknown>) {
  const page  = Math.max(1, parseInt(String(query.page  ?? "1"),  10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(String(query.limit ?? "20"), 10) || 20));
  return { page, limit, from: (page - 1) * limit, to: (page - 1) * limit + limit - 1 };
}

/**
 * Checks whether the user has a delivered order containing the given product.
 * Used to set is_verified_purchase on new reviews.
 */
async function checkVerifiedPurchase(userId: string, productId: string): Promise<boolean> {
  // Find orders placed by this user that are delivered
  const { data: orders } = await supabaseAdmin
    .from("orders")
    .select("id")
    .eq("user_id", userId)
    .eq("status", "delivered");

  if (!orders || orders.length === 0) return false;

  const orderIds = orders.map((o: { id: string }) => o.id);

  // Check if any of those orders contain the product in order_details
  const { data: detail } = await supabaseAdmin
    .from("order_details")
    .select("id")
    .in("order_id", orderIds)
    .eq("product_id", productId)
    .limit(1)
    .maybeSingle<{ id: string }>();

  return !!detail;
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/products/:id/reviews   — public
//
// Returns paginated approved reviews for a product, newest first.
// Supports ?rating= filter (1–5).
// ─────────────────────────────────────────────────────────────────────────────
export const listProductReviews = async (
  req:  Request,
  res:  Response<ApiResponse<unknown>>,
  next: NextFunction
): Promise<void> => {
  try {
    const { id: productId } = req.params;
    validateUuid(productId, "product id");

    const { page, limit, from, to } = parsePage(req.query as Record<string, unknown>);
    const rating = req.query.rating ? parseInt(String(req.query.rating), 10) : undefined;

    if (rating !== undefined && (isNaN(rating) || rating < 1 || rating > 5))
      throw new AppError("Query param 'rating' must be an integer between 1 and 5", 400);

    // Confirm product exists
    const { data: product } = await supabaseAdmin
      .from("products")
      .select("id")
      .eq("id", productId)
      .single<{ id: string }>();

    if (!product) throw new AppError(`Product with id ${productId} not found`, 404);

    let q = supabaseAdmin
      .from("product_reviews")
      .select(REVIEW_SELECT, { count: "exact" })
      .eq("product_id", productId)
      .eq("is_approved", true)
      .order("created_at", { ascending: false })
      .range(from, to);

    if (rating !== undefined) q = q.eq("rating", rating);

    const { data, error, count } = await q;
    if (error) throw new AppError(`Failed to fetch reviews: ${error.message}`, 500);

    // Compute average rating across all approved reviews (not just this page)
    const { data: avg } = await supabaseAdmin
      .from("product_reviews")
      .select("rating")
      .eq("product_id", productId)
      .eq("is_approved", true);

    const allRatings = (avg ?? []).map((r: { rating: number }) => r.rating);
    const averageRating = allRatings.length
      ? Math.round((allRatings.reduce((s, r) => s + r, 0) / allRatings.length) * 10) / 10
      : null;

    res.status(200).json({
      success: true,
      data: {
        reviews:        data ?? [],
        page,
        limit,
        total:          count ?? 0,
        hasMore:        (count ?? 0) > page * limit,
        average_rating: averageRating,
        review_count:   allRatings.length,
      },
    });
  } catch (err) { next(err); }
};

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/products/:id/reviews   — auth
//
// Submits a review for a product.
// - One review per (user_id, product_id) — rejects duplicates.
// - Automatically sets is_verified_purchase by checking the user's order history.
// - is_approved defaults to true (per the DB default).
// ─────────────────────────────────────────────────────────────────────────────
export const submitReview = async (
  req:  Request,
  res:  Response<ApiResponse<unknown>>,
  next: NextFunction
): Promise<void> => {
  try {
    const { id: productId } = req.params;
    validateUuid(productId, "product id");

    const userId = req.user!.id;
    const body   = createReviewSchema.parse(req.body);

    // Confirm product exists and is active
    const { data: product } = await supabaseAdmin
      .from("products")
      .select("id, is_active")
      .eq("id", productId)
      .single<{ id: string; is_active: boolean }>();

    if (!product) throw new AppError(`Product with id ${productId} not found`, 404);
    if (!product.is_active) throw new AppError("Cannot review an inactive product", 400);

    // If a product_variant_id is given, confirm it belongs to this product
    if (body.product_variant_id) {
      const { data: variant } = await supabaseAdmin
        .from("product_variants")
        .select("id")
        .eq("id", body.product_variant_id)
        .eq("product_id", productId)
        .single<{ id: string }>();

      if (!variant)
        throw new AppError(
          `Variant ${body.product_variant_id} does not belong to product ${productId}`, 400
        );
    }

    // Enforce one review per (user, product)
    const { data: existing } = await supabaseAdmin
      .from("product_reviews")
      .select("id")
      .eq("user_id", userId)
      .eq("product_id", productId)
      .maybeSingle<{ id: string }>();

    if (existing)
      throw new AppError("You have already submitted a review for this product", 409);

    // Automatically determine verified purchase status
    const isVerified = await checkVerifiedPurchase(userId, productId);

    const { data, error } = await supabaseAdmin
      .from("product_reviews")
      .insert({
        user_id:              userId,
        product_id:           productId,
        product_variant_id:   body.product_variant_id ?? null,
        rating:               body.rating,
        review_title:         body.review_title ?? null,
        review_text:          body.review_text  ?? null,
        is_verified_purchase: isVerified,
        // is_approved uses the DB default (true)
      })
      .select(REVIEW_SELECT)
      .single<ProductReview>();

    if (error) throw new AppError(`Failed to submit review: ${error.message}`, 500);

    res.status(201).json({
      success: true,
      message: "Review submitted successfully.",
      data,
    });
  } catch (err) { next(err); }
};

// ─────────────────────────────────────────────────────────────────────────────
// PUT /api/reviews/:id   — auth
//
// Edits the authenticated user's own review.
// Resets is_approved to true (back to default) so admin can re-moderate if needed.
// ─────────────────────────────────────────────────────────────────────────────
export const updateReview = async (
  req:  Request,
  res:  Response<ApiResponse<unknown>>,
  next: NextFunction
): Promise<void> => {
  try {
    const { id } = req.params;
    validateUuid(id, "review id");

    const userId = req.user!.id;
    const body   = updateReviewSchema.parse(req.body);

    // Fetch and confirm ownership
    const { data: existing, error: fetchError } = await supabaseAdmin
      .from("product_reviews")
      .select("id, user_id")
      .eq("id", id)
      .single<{ id: string; user_id: string }>();

    if (fetchError || !existing)
      throw new AppError("Review not found", 404);

    if (existing.user_id !== userId)
      throw new AppError("Review not found", 404); // 404 not 403

    // Build update payload from only supplied fields
    const updates: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
      // Edited reviews go back to default approved state — re-moderate if needed
      is_approved: true,
    };
    if (body.rating       !== undefined) updates.rating       = body.rating;
    if (body.review_title !== undefined) updates.review_title = body.review_title;
    if (body.review_text  !== undefined) updates.review_text  = body.review_text;

    const { data, error } = await supabaseAdmin
      .from("product_reviews")
      .update(updates)
      .eq("id", id)
      .select(REVIEW_SELECT)
      .single<ProductReview>();

    if (error) throw new AppError(`Failed to update review: ${error.message}`, 500);

    res.status(200).json({ success: true, message: "Review updated.", data });
  } catch (err) { next(err); }
};

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /api/reviews/:id   — auth
//
// Hard-deletes the authenticated user's own review.
// ─────────────────────────────────────────────────────────────────────────────
export const deleteReview = async (
  req:  Request,
  res:  Response<ApiResponse<unknown>>,
  next: NextFunction
): Promise<void> => {
  try {
    const { id } = req.params;
    validateUuid(id, "review id");

    const userId  = req.user!.id;
    const isAdmin = req.userRole?.role_name === "admin";

    // Fetch the review
    const { data: existing, error: fetchError } = await supabaseAdmin
      .from("product_reviews")
      .select("id, user_id")
      .eq("id", id)
      .single<{ id: string; user_id: string }>();

    if (fetchError || !existing)
      throw new AppError("Review not found", 404);

    // Only owner or admin can delete
    if (!isAdmin && existing.user_id !== userId)
      throw new AppError("Review not found", 404);

    const { error } = await supabaseAdmin
      .from("product_reviews")
      .delete()
      .eq("id", id);

    if (error) throw new AppError(`Failed to delete review: ${error.message}`, 500);

    res.status(200).json({ success: true, message: "Review deleted." });
  } catch (err) { next(err); }
};

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /api/reviews/:id/approve   — admin
//
// Approves or rejects a review by toggling is_approved.
// Body: { is_approved: boolean }
// ─────────────────────────────────────────────────────────────────────────────
export const approveReview = async (
  req:  Request,
  res:  Response<ApiResponse<unknown>>,
  next: NextFunction
): Promise<void> => {
  try {
    const { id } = req.params;
    validateUuid(id, "review id");

    const { is_approved } = approveReviewSchema.parse(req.body);

    // Confirm the review exists
    const { data: existing, error: fetchError } = await supabaseAdmin
      .from("product_reviews")
      .select("id")
      .eq("id", id)
      .single<{ id: string }>();

    if (fetchError || !existing)
      throw new AppError("Review not found", 404);

    const { data, error } = await supabaseAdmin
      .from("product_reviews")
      .update({ is_approved, updated_at: new Date().toISOString() })
      .eq("id", id)
      .select(REVIEW_SELECT)
      .single<ProductReview>();

    if (error) throw new AppError(`Failed to update review approval: ${error.message}`, 500);

    res.status(200).json({
      success: true,
      message: `Review ${is_approved ? "approved" : "rejected"}.`,
      data,
    });
  } catch (err) { next(err); }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/seller/reviews   — seller
//
// Returns paginated reviews for all products that belong to the authenticated
// seller, including unapproved ones so the seller can see full feedback.
// Supports ?is_approved= and ?rating= filters.
// ─────────────────────────────────────────────────────────────────────────────
export const getSellerReviews = async (
  req:  Request,
  res:  Response<ApiResponse<unknown>>,
  next: NextFunction
): Promise<void> => {
  try {
    const { page, limit, from, to } = parsePage(req.query as Record<string, unknown>);
    const userId = req.user!.id;

    const isApprovedParam = req.query.is_approved as string | undefined;
    const ratingParam     = req.query.rating as string | undefined;

    // Resolve the seller's sellers.id from their user_id
    const { data: seller } = await supabaseAdmin
      .from("sellers")
      .select("id")
      .eq("user_id", userId)
      .single<{ id: string }>();

    if (!seller) throw new AppError("No seller profile found for this account", 404);

    // Fetch all product IDs owned by this seller
    const { data: sellerProducts } = await supabaseAdmin
      .from("products")
      .select("id")
      .eq("seller_id", seller.id);

    const productIds = (sellerProducts ?? []).map((p: { id: string }) => p.id);

    if (productIds.length === 0) {
      return res.status(200).json({
        success: true,
        data: { reviews: [], page, limit, total: 0, hasMore: false },
      }) as any;
    }

    let q = supabaseAdmin
      .from("product_reviews")
      .select(REVIEW_SELECT, { count: "exact" })
      .in("product_id", productIds)
      .order("created_at", { ascending: false })
      .range(from, to);

    // Optional filters
    if (isApprovedParam !== undefined)
      q = q.eq("is_approved", isApprovedParam === "true");

    if (ratingParam !== undefined) {
      const r = parseInt(ratingParam, 10);
      if (isNaN(r) || r < 1 || r > 5)
        throw new AppError("Query param 'rating' must be an integer between 1 and 5", 400);
      q = q.eq("rating", r);
    }

    const { data, error, count } = await q;
    if (error) throw new AppError(`Failed to fetch seller reviews: ${error.message}`, 500);

    res.status(200).json({
      success: true,
      data: {
        reviews: data ?? [],
        page,
        limit,
        total:   count ?? 0,
        hasMore: (count ?? 0) > page * limit,
      },
    });
  } catch (err) { next(err); }
};
