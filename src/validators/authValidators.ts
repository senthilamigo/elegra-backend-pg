/**
 * File: src/validators/authValidators.ts
 * Path: ecommerce-admin/src/validators/authValidators.ts
 *
 * Zod schemas for authentication and user-admin endpoints.
 */
import { z } from "zod";

// ─────────────────────────────────────────────
// Shared primitives
// ─────────────────────────────────────────────

const emailSchema    = z.string().email("Must be a valid email address");
const passwordSchema = z.string().min(8, "Password must be at least 8 characters");

// ─────────────────────────────────────────────
// Auth endpoint schemas
// ─────────────────────────────────────────────

/**
 * POST /api/auth/register
 * role_name is required — 'admin' or 'seller'.
 * When role_name is 'seller', seller_profile fields become required.
 */
export const registerSchema = z
  .object({
    // User identity
    email:      emailSchema,
    password:   passwordSchema,
    first_name: z.string().min(1, "First name is required").max(100).trim(),
    last_name:  z.string().max(100).trim().optional(),

    // Role selection — only 'admin' or 'seller' at registration
    role_name: z.enum(["admin", "seller"], {
      errorMap: () => ({ message: "role_name must be 'admin' or 'seller'" }),
    }),

    // Seller profile — required when role_name is 'seller'.
    // Contains the seller_profile_id the user selected from the dropdown.
    seller_profile: z
      .object({
        seller_profile_id: z.string().uuid("Must be a valid UUID"),
      })
      .optional(),
  })
  .refine(
    (d) => !(d.role_name === "seller" && !d.seller_profile),
    {
      message: "seller_profile is required when role_name is 'seller'",
      path:    ["seller_profile"],
    }
  );

/** POST /api/auth/login */
export const loginSchema = z.object({
  email:    emailSchema,
  password: z.string().min(1, "Password is required"),
});

/** POST /api/auth/refresh-token */
export const refreshTokenSchema = z.object({
  refresh_token: z.string().min(1, "refresh_token is required"),
});

/** POST /api/auth/forgot-password */
export const forgotPasswordSchema = z.object({
  email: emailSchema,
});

/** POST /api/auth/reset-password */
export const resetPasswordSchema = z.object({
  access_token: z.string().min(1, "access_token is required"),
  new_password: passwordSchema,
});

/**
 * PATCH /api/auth/me
 * first_name — cannot be empty if supplied
 * last_name  — nullable (clears to NULL when empty string sent)
 * Changing password requires current_password
 */
export const updateMeSchema = z
  .object({
    first_name:       z.string().min(1, "first_name cannot be empty").max(100).trim().optional(),
    last_name:        z.string().max(100).trim().optional().nullable(),
    current_password: z.string().min(1).optional(),
    new_password:     passwordSchema.optional(),
  })
  .refine(
    (d) => d.first_name !== undefined || d.last_name !== undefined || d.new_password !== undefined,
    { message: "At least one field (first_name, last_name, new_password) must be provided" }
  )
  .refine(
    (d) => !(d.new_password && !d.current_password),
    { message: "current_password is required when setting a new_password", path: ["current_password"] }
  );

/** PATCH /api/users/:id/role */
export const updateRoleSchema = z.object({
  role_name: z.enum(["customer", "seller", "admin"], {
    errorMap: () => ({ message: "role_name must be one of: customer, seller, admin" }),
  }),
});

// ─────────────────────────────────────────────
// Inferred types
// ─────────────────────────────────────────────
export type RegisterInput       = z.infer<typeof registerSchema>;
export type LoginInput          = z.infer<typeof loginSchema>;
export type RefreshTokenInput   = z.infer<typeof refreshTokenSchema>;
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;
export type ResetPasswordInput  = z.infer<typeof resetPasswordSchema>;
export type UpdateMeInput       = z.infer<typeof updateMeSchema>;
export type UpdateRoleInput     = z.infer<typeof updateRoleSchema>;
