/**
 * File: src/validators/sellerValidators.ts
 * Path: ecommerce-admin/src/validators/sellerValidators.ts
 *
 * Zod schemas for seller_profiles and sellers endpoints.
 *
 * seller_profiles: id, business_name, contact_name, email, phone,
 *                  description, is_verified, status, created_at, updated_at
 * sellers:         id, user_id, seller_profile_id, status, created_at, updated_at
 */

import { z } from "zod";

const uuidSchema = z.string().uuid("Must be a valid UUID");

const sellerStatusEnum = z.enum(["active", "suspended", "pending"], {
  errorMap: () => ({ message: "status must be 'active', 'suspended', or 'pending'" }),
});

// ─────────────────────────────────────────────
// seller_profiles schemas
// ─────────────────────────────────────────────

/** POST /api/seller-profiles — admin creates a new seller profile */
export const createSellerProfileSchema = z.object({
  business_name: z.string().min(1, "Business name is required").max(255),
  contact_name:  z.string().max(255).optional().nullable(),
  email:         z.string().email("Must be a valid email").max(255).optional().nullable(),
  phone:         z.string().max(20).optional().nullable(),
  description:   z.string().max(5000).optional().nullable(),
});

/** PUT /api/seller-profiles/:id — update profile details */
export const updateSellerProfileSchema = z
  .object({
    business_name: z.string().min(1).max(255).optional(),
    contact_name:  z.string().max(255).optional().nullable(),
    email:         z.string().email().max(255).optional().nullable(),
    phone:         z.string().max(20).optional().nullable(),
    description:   z.string().max(5000).optional().nullable(),
  })
  .refine(
    (d) => Object.values(d).some((v) => v !== undefined),
    { message: "At least one field must be provided" }
  );

// ─────────────────────────────────────────────
// sellers schemas
// ─────────────────────────────────────────────

/**
 * POST /api/sellers — link authenticated user to an existing seller_profile.
 * The user selects an existing profile from the list at signup.
 */
export const createSellerSchema = z.object({
  seller_profile_id: uuidSchema,
});

/** PATCH /api/sellers/:id/status — admin updates the seller account status */
export const updateSellerStatusSchema = z.object({
  status: sellerStatusEnum,
});

/**
 * PATCH /api/seller-profiles/:id/status — admin updates the profile status
 */
export const updateSellerProfileStatusSchema = z.object({
  status: sellerStatusEnum,
});

// ─────────────────────────────────────────────
// Inferred types
// ─────────────────────────────────────────────

export type CreateSellerProfileInput       = z.infer<typeof createSellerProfileSchema>;
export type UpdateSellerProfileInput       = z.infer<typeof updateSellerProfileSchema>;
export type CreateSellerInput              = z.infer<typeof createSellerSchema>;
export type UpdateSellerStatusInput        = z.infer<typeof updateSellerStatusSchema>;
export type UpdateSellerProfileStatusInput = z.infer<typeof updateSellerProfileStatusSchema>;
