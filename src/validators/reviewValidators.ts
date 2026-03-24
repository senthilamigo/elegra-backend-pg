/**
 * File: src/validators/reviewValidators.ts
 * Path: ecommerce-admin/src/validators/reviewValidators.ts
 *
 * Zod schemas for product review request bodies.
 */

import { z } from "zod";

const uuidSchema = z.string().uuid("Must be a valid UUID");

// ─────────────────────────────────────────────
// POST /api/products/:id/reviews
// ─────────────────────────────────────────────

export const createReviewSchema = z.object({
  product_variant_id: uuidSchema.optional().nullable(),
  rating:             z.number().int().min(1, "Rating must be at least 1").max(5, "Rating must be at most 5"),
  review_title:       z.string().max(255).optional().nullable(),
  review_text:        z.string().max(5000).optional().nullable(),
});

// ─────────────────────────────────────────────
// PUT /api/reviews/:id
// ─────────────────────────────────────────────

export const updateReviewSchema = z
  .object({
    rating:       z.number().int().min(1).max(5).optional(),
    review_title: z.string().max(255).optional().nullable(),
    review_text:  z.string().max(5000).optional().nullable(),
  })
  .refine(
    (d) => d.rating !== undefined || d.review_title !== undefined || d.review_text !== undefined,
    { message: "At least one field (rating, review_title, review_text) must be provided" }
  );

// ─────────────────────────────────────────────
// PATCH /api/reviews/:id/approve
// ─────────────────────────────────────────────

export const approveReviewSchema = z.object({
  is_approved: z.boolean({ required_error: "is_approved (boolean) is required" }),
});

// ─────────────────────────────────────────────
// Inferred types
// ─────────────────────────────────────────────

export type CreateReviewInput  = z.infer<typeof createReviewSchema>;
export type UpdateReviewInput  = z.infer<typeof updateReviewSchema>;
export type ApproveReviewInput = z.infer<typeof approveReviewSchema>;
