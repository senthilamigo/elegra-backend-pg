import { z } from "zod";

// ─────────────────────────────────────────────
// Reusable field schemas
// ─────────────────────────────────────────────

const emailSchema    = z.string().email("Must be a valid email address");
const passwordSchema = z.string().min(8, "Password must be at least 8 characters");
const uuidSchema     = z.string().uuid("Must be a valid UUID");

// ─────────────────────────────────────────────
// Auth endpoint schemas
// ─────────────────────────────────────────────

/** POST /api/auth/register */
export const registerSchema = z.object({
  email:      emailSchema,
  password:   passwordSchema,
  first_name: z.string().min(1, "First name is required").max(100),
  last_name:  z.string().min(1, "Last name is required").max(100),
});

/** POST /api/auth/login */
export const loginSchema = z.object({
  email:    emailSchema,
  password: z.string().min(1, "Password is required"),
});

/** POST /api/auth/forgot-password */
export const forgotPasswordSchema = z.object({
  email: emailSchema,
});

/** POST /api/auth/reset-password */
export const resetPasswordSchema = z.object({
  access_token: z.string().min(1, "Token is required"),
  new_password: passwordSchema,
});

/** PATCH /api/auth/me */
export const updateMeSchema = z.object({
  first_name:   z.string().min(1).max(100).optional(),
  last_name:    z.string().min(1).max(100).optional(),
  new_password: passwordSchema.optional(),
}).refine(
  (d) => d.first_name || d.last_name || d.new_password,
  { message: "At least one field (first_name, last_name, new_password) must be provided" }
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

export type RegisterInput      = z.infer<typeof registerSchema>;
export type LoginInput         = z.infer<typeof loginSchema>;
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;
export type UpdateMeInput      = z.infer<typeof updateMeSchema>;
export type UpdateRoleInput    = z.infer<typeof updateRoleSchema>;
