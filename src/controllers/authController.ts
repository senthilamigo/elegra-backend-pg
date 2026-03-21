import { Request, Response, NextFunction } from "express";
import { createClient }    from "@supabase/supabase-js";
import { supabase, supabaseAdmin } from "../config/supabase";
import { AppError }        from "../middleware/errorHandler";
import { ApiResponse, UserRole } from "../types";
import {
  registerSchema,
  loginSchema,
  refreshTokenSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
  updateMeSchema,
} from "../validators/authValidators";

// ─────────────────────────────────────────────────────────────────────────────
// Internal helper
// Creates a Supabase client authenticated as the calling user.
// Used for operations that must run under the user's own credentials
// (signOut, updateUser password) rather than the service-role key.
// ─────────────────────────────────────────────────────────────────────────────
function createUserClient(accessToken: string) {
  return createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_ANON_KEY!,
    {
      global: { headers: { Authorization: `Bearer ${accessToken}` } },
      auth:   { persistSession: false, autoRefreshToken: false },
    }
  );
}

// Columns to select from user_role — mirrors exact table schema
const USER_ROLE_SELECT = "id, first_name, last_name, role_name, created_at";

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/auth/register   — public
//
// Flow:
//   1. Validate input — role_name ('admin'|'seller'), seller_profile required if seller
//   2. Create Supabase auth account
//   3. Insert user_role row with the chosen role
//   4. If role is 'seller', insert sellers row (status: pending, is_verified: false)
//   5. Rollback auth account if any DB insert fails
//   6. Return tokens + profile if email confirmation disabled; inbox message if required
// ─────────────────────────────────────────────────────────────────────────────
export const register = async (
  req: Request,
  res: Response<ApiResponse<unknown>>,
  next: NextFunction
): Promise<void> => {
  try {
    const body = registerSchema.parse(req.body);

    // Step 1 — Create the auth account
    const { data: authData, error: authError } = await supabase.auth.signUp({
      email:    body.email,
      password: body.password,
    });

    if (authError || !authData.user) {
      throw new AppError(authError?.message ?? "Registration failed.", 400);
    }

    const userId = authData.user.id;

    // Step 2 — Insert user_role row with the chosen role
    const { error: roleError } = await supabaseAdmin
      .from("user_role")
      .insert({
        id:         userId,
        first_name: body.first_name,
        last_name:  body.last_name ?? null,
        role_name:  body.role_name,
      });

    if (roleError) {
      await supabaseAdmin.auth.admin.deleteUser(userId);
      throw new AppError(
        `Account created but profile setup failed: ${roleError.message}`,
        500
      );
    }

    // Step 3 — If seller, insert sellers row
    if (body.role_name === "seller" && body.seller_profile) {
      const sp = body.seller_profile;
      const { error: sellerError } = await supabaseAdmin
        .from("sellers")
        .insert({
          user_id:       userId,
          business_name: sp.business_name,
          contact_name:  sp.contact_name,
          email:         body.email,          // default to auth email
          phone:         sp.phone,
          description:   sp.description ?? null,
          is_verified:   false,
          status:        "pending",
        });

      if (sellerError) {
        // Rollback both auth account and user_role row
        await supabaseAdmin.from("user_role").delete().eq("id", userId);
        await supabaseAdmin.auth.admin.deleteUser(userId);
        throw new AppError(
          `Account created but seller profile setup failed: ${sellerError.message}`,
          500
        );
      }
    }

    const requiresConfirmation = !authData.session?.access_token;

    res.status(201).json({
      success: true,
      message: requiresConfirmation
        ? "Registration successful. Please check your email to confirm your account."
        : "Registration successful.",
      data: {
        user: {
          id:         userId,
          email:      authData.user.email,
          first_name: body.first_name,
          last_name:  body.last_name ?? null,
          role_name:  body.role_name,
        },
        ...(authData.session && {
          access_token:  authData.session.access_token,
          refresh_token: authData.session.refresh_token,
        }),
      },
    });
  } catch (err) {
    next(err);
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/auth/login   — public
// ─────────────────────────────────────────────────────────────────────────────
export const login = async (
  req: Request,
  res: Response<ApiResponse<unknown>>,
  next: NextFunction
): Promise<void> => {
  try {
    const body = loginSchema.parse(req.body);

    const { data, error } = await supabase.auth.signInWithPassword({
      email:    body.email,
      password: body.password,
    });

    if (error || !data.session) {
      throw new AppError(error?.message ?? "Invalid credentials.", 401);
    }

    // Fetch profile — include all user_role columns
    const { data: profile } = await supabaseAdmin
      .from("user_role")
      .select(USER_ROLE_SELECT)
      .eq("id", data.user.id)
      .single();

    res.status(200).json({
      success: true,
      message: "Login successful.",
      data: {
        access_token:  data.session.access_token,
        refresh_token: data.session.refresh_token,
        expires_in:    data.session.expires_in,
        user: {
          id:    data.user.id,
          email: data.user.email,
          ...profile,
        },
      },
    });
  } catch (err) {
    next(err);
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/auth/logout   — auth
// Invalidates only the current session (not all sessions for the user).
// ─────────────────────────────────────────────────────────────────────────────
export const logout = async (
  req: Request,
  res: Response<ApiResponse<unknown>>,
  next: NextFunction
): Promise<void> => {
  try {
    const token      = req.headers.authorization!.split(" ")[1];
    const userClient = createUserClient(token);

    const { error } = await userClient.auth.signOut();
    if (error) throw new AppError(`Logout failed: ${error.message}`, 500);

    res.status(200).json({ success: true, message: "Logged out successfully." });
  } catch (err) {
    next(err);
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/auth/refresh-token   — auth
// Body: { refresh_token: string }
// Returns a new access_token + refresh_token (old refresh_token is rotated).
// ─────────────────────────────────────────────────────────────────────────────
export const refreshToken = async (
  req: Request,
  res: Response<ApiResponse<unknown>>,
  next: NextFunction
): Promise<void> => {
  try {
    const { refresh_token } = refreshTokenSchema.parse(req.body);

    const { data, error } = await supabase.auth.refreshSession({ refresh_token });

    if (error || !data.session) {
      throw new AppError(
        error?.message ?? "Could not refresh token. Please log in again.",
        401
      );
    }

    res.status(200).json({
      success: true,
      message: "Token refreshed.",
      data: {
        access_token:  data.session.access_token,
        refresh_token: data.session.refresh_token,
        expires_in:    data.session.expires_in,
      },
    });
  } catch (err) {
    next(err);
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/auth/forgot-password   — public
// Always returns 200 to prevent email enumeration.
// ─────────────────────────────────────────────────────────────────────────────
export const forgotPassword = async (
  req: Request,
  res: Response<ApiResponse<unknown>>,
  next: NextFunction
): Promise<void> => {
  try {
    const { email } = forgotPasswordSchema.parse(req.body);

    await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: process.env.PASSWORD_RESET_REDIRECT_URL,
    });

    res.status(200).json({
      success: true,
      message: "If that email is registered, a password reset link has been sent.",
    });
  } catch (err) {
    next(err);
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/auth/reset-password   — public
// Body: { access_token: string, new_password: string }
// The access_token is the one-time token embedded in the reset link.
// ─────────────────────────────────────────────────────────────────────────────
export const resetPassword = async (
  req: Request,
  res: Response<ApiResponse<unknown>>,
  next: NextFunction
): Promise<void> => {
  try {
    const { access_token, new_password } = resetPasswordSchema.parse(req.body);

    const { error: sessionError } = await supabase.auth.setSession({
      access_token,
      refresh_token: access_token,
    });

    if (sessionError) {
      throw new AppError(
        "Invalid or expired reset token. Please request a new one.",
        401
      );
    }

    const { error: updateError } = await supabase.auth.updateUser({
      password: new_password,
    });

    if (updateError) {
      throw new AppError(`Password reset failed: ${updateError.message}`, 400);
    }

    res.status(200).json({
      success: true,
      message: "Password reset successfully. Please log in.",
    });
  } catch (err) {
    next(err);
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/auth/me   — auth
// Returns the authenticated user's profile from user_role + email from auth.
// req.userRole is already populated by requireAuth middleware.
// ─────────────────────────────────────────────────────────────────────────────
export const getMe = async (
  req: Request,
  res: Response<ApiResponse<UserRole & { email?: string }>>,
  next: NextFunction
): Promise<void> => {
  try {
    res.status(200).json({
      success: true,
      data: {
        ...req.userRole!,
        email: req.user?.email,
      },
    });
  } catch (err) {
    next(err);
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /api/auth/me   — auth
//
// Updatable fields:
//   first_name      — cannot be set to empty string (NOT NULL in DB)
//   last_name       — can be null/empty (NULL allowed in DB)
//   new_password    — requires current_password for verification
//
// current_password is verified by attempting a signInWithPassword before
// updating, so we never blindly accept a password change without proof.
// ─────────────────────────────────────────────────────────────────────────────
export const updateMe = async (
  req: Request,
  res: Response<ApiResponse<unknown>>,
  next: NextFunction
): Promise<void> => {
  try {
    const body   = updateMeSchema.parse(req.body);
    const userId = req.user!.id;
    const email  = req.user!.email!;
    const token  = req.headers.authorization!.split(" ")[1];

    // ── Verify current password before allowing a password change ────────────
    if (body.new_password && body.current_password) {
      const { error: verifyError } = await supabase.auth.signInWithPassword({
        email,
        password: body.current_password,
      });
      if (verifyError) {
        throw new AppError("Current password is incorrect.", 401);
      }
    }

    // ── Update profile fields in user_role ───────────────────────────────────
    // Build update object only from fields that were explicitly supplied.
    // last_name: "" is treated as null (user wants to clear it).
    // last_name: undefined means the field was not sent — skip it entirely.
    const profileUpdates: Record<string, string | null> = {};
    if (body.first_name !== undefined) {
      profileUpdates.first_name = body.first_name; // Zod trim + min(1) already applied
    }
    if (body.last_name !== undefined) {
      // Store null when the client sends null or an empty string
      profileUpdates.last_name = body.last_name?.trim() || null;
    }

    if (Object.keys(profileUpdates).length > 0) {
      const { error } = await supabaseAdmin
        .from("user_role")
        .update(profileUpdates)
        .eq("id", userId);

      if (error) throw new AppError(`Profile update failed: ${error.message}`, 500);
    }

    // ── Update password via Supabase Auth ────────────────────────────────────
    if (body.new_password) {
      const userClient = createUserClient(token);
      const { error } = await userClient.auth.updateUser({ password: body.new_password });
      if (error) throw new AppError(`Password update failed: ${error.message}`, 400);
    }

    // ── Return the refreshed profile ─────────────────────────────────────────
    const { data: updated } = await supabaseAdmin
      .from("user_role")
      .select(USER_ROLE_SELECT)
      .eq("id", userId)
      .single();

    res.status(200).json({
      success: true,
      message: "Profile updated successfully.",
      data: { ...updated, email },
    });
  } catch (err) {
    next(err);
  }
};
