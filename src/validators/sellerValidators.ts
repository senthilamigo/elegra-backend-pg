import { z } from "zod";

// ─────────────────────────────────────────────
// sellers table validators
// ─────────────────────────────────────────────

const sellerStatusEnum = z.enum(["active", "suspended", "pending"], {
  errorMap: () => ({ message: "status must be 'active', 'suspended', or 'pending'" }),
});

/**
 * POST /api/sellers  — create a new seller profile
 * All fields required except description (nullable).
 * is_verified defaults to false; status defaults to 'pending'.
 */
export const createSellerSchema = z.object({
  business_name: z.string().min(1, "Business name is required").max(255),
  contact_name:  z.string().min(1, "Contact name is required").max(255),
  email:         z.string().email("Must be a valid email").max(255),
  phone:         z.string().min(1, "Phone is required").max(20),
  description:   z.string().max(5000).optional().nullable(),
  // is_verified and status are set by the server on create; clients cannot supply them
});

/**
 * PUT /api/sellers/:id  — seller updates their own profile
 * All fields optional; at least one required.
 * is_verified and status are NOT updatable here — admins use the
 * dedicated PATCH /api/sellers/:id/status and /verify endpoints.
 */
export const updateSellerSchema = z
  .object({
    business_name: z.string().min(1).max(255).optional(),
    contact_name:  z.string().min(1).max(255).optional(),
    email:         z.string().email().max(255).optional(),
    phone:         z.string().min(1).max(20).optional(),
    description:   z.string().max(5000).optional().nullable(),
  })
  .refine(
    (d) => Object.values(d).some((v) => v !== undefined),
    { message: "At least one field must be provided" }
  );

/**
 * PATCH /api/sellers/:id/status  — admin updates seller status
 */
export const updateSellerStatusSchema = z.object({
  status: sellerStatusEnum,
});

// Inferred types
export type CreateSellerInput       = z.infer<typeof createSellerSchema>;
export type UpdateSellerInput       = z.infer<typeof updateSellerSchema>;
export type UpdateSellerStatusInput = z.infer<typeof updateSellerStatusSchema>;
