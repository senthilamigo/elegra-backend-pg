import { z } from "zod";

// ─────────────────────────────────────────────
// Shared primitives
// ─────────────────────────────────────────────

const emailSchema    = z.string().email("Must be a valid email address");
const passwordSchema = z.string().min(8, "Password must be at least 8 characters");

// ─────────────────────────────────────────────
// Auth endpoint schemas
// Table: user_role
//   id         UUID PRIMARY KEY
//   first_name text            NOT NULL
//   last_name  text            NULL
//   role_name  text            NOT NULL
//   created_at TIMESTAMP
// ─────────────────────────────────────────────

/**
 * POST /api/auth/register
 * first_name is required (NOT NULL in DB).
 * last_name  is optional — DB column allows NULL.
 */
export const registerSchema = z.object({
  email:      emailSchema,
  password:   passwordSchema,
  first_name: z.string().min(1, "First name is required").max(100).trim(),
  last_name:  z.string().max(100).trim().optional(),
});

/** POST /api/auth/login */
export const loginSchema = z.object({
  email:    emailSchema,
  password: z.string().min(1, "Password is required"),
});

/** POST /api/auth/refresh-token — body carries the refresh token */
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
 * - first_name: optional update; cannot be set to empty string
 * - last_name:  optional update; can be set to "" to clear it (stored as NULL)
 * - Changing password requires current_password for verification
 * - At least one field must be supplied
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

// ─────────────────────────────────────────────
// User-admin endpoint schemas
// ─────────────────────────────────────────────

/**
 * PATCH /api/users/:id/role
 * role_name must be one of the three valid roles.
 */
export const updateRoleSchema = z.object({
  role_name: z.enum(["customer", "seller", "admin"], {
    errorMap: () => ({ message: "role_name must be one of: customer, seller, admin" }),
  }),
});

// ─────────────────────────────────────────────
// Inferred TypeScript types
// ─────────────────────────────────────────────

export type RegisterInput       = z.infer<typeof registerSchema>;
export type LoginInput          = z.infer<typeof loginSchema>;
export type RefreshTokenInput   = z.infer<typeof refreshTokenSchema>;
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;
export type ResetPasswordInput  = z.infer<typeof resetPasswordSchema>;
export type UpdateMeInput       = z.infer<typeof updateMeSchema>;
export type UpdateRoleInput     = z.infer<typeof updateRoleSchema>;
