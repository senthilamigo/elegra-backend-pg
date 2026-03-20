import { Request, Response, NextFunction } from "express";
import { supabase, supabaseAdmin } from "../config/supabase";
import { AppError } from "../middleware/errorHandler";
import { ApiResponse, UserRole } from "../types";
import {
  registerSchema,
  loginSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
  updateMeSchema,
} from "../validators/authValidators";

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function validateUuid(id: string, label = "id"): void {
  if (!UUID_RE.test(id)) {
    throw new AppError(`Invalid ${label} — must be a valid UUID`, 400);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/auth/register   — public
//
// 1. Creates a Supabase auth user via the admin client (no email needed in body
//    for confirmation because we use signUp which respects the project settings).
// 2. Inserts a row in user_role with role_name = 'admin' (as specified).
// 3. Returns the access_token so the user can log in immediately if email
//    confirmation is disabled.  If confirmation is enabled the token will be
//    absent — the caller should prompt the user to check their inbox.
// ─────────────────────────────────────────────────────────────────────────────
export const register = async (
  req: Request,
  res: Response<ApiResponse>,
  next: NextFunction
): Promise<void> => {
  try {
    const body = registerSchema.parse(req.body);

    // Create auth account using the public client so Supabase handles email
    // confirmation according to the project's Auth settings.
    const { data: authData, error: authError } =
      await supabase.auth.signUp({
        email:    body.email,
        password: body.password,
      });

    if (authError || !authData.user) {
      throw new AppError(
        authError?.message ?? "Registration failed. Please try again.",
        400
      );
    }

    const userId = authData.user.id;

    // Insert the user_role profile row.
    // Use the admin client so this works regardless of RLS policies.
    const { error: roleError } = await supabaseAdmin
      .from("user_role")
      .insert({
        id:         userId,
        first_name: body.first_name.trim(),
        last_name:  body.last_name.trim(),
        role_name:  "admin",
      });

    if (roleError) {
      // Profile insert failed — roll back the auth user so we don't leave orphans
      await supabaseAdmin.auth.admin.deleteUser(userId);
      throw new AppError(
        `Account created but profile setup failed: ${roleError.message}`,
        500
      );
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
          first_name: body.first_name.trim(),
          last_name:  body.last_name.trim(),
          role_name:  "admin",
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
//
// Authenticates with Supabase and returns both the access_token (short-lived)
// and refresh_token (long-lived) so the client can silently re-authenticate.
// ─────────────────────────────────────────────────────────────────────────────
export const login = async (
  req: Request,
  res: Response<ApiResponse>,
  next: NextFunction
): Promise<void> => {
  try {
    const body = loginSchema.parse(req.body);

    const { data, error } = await supabase.auth.signInWithPassword({
      email:    body.email,
      password: body.password,
    });

    if (error || !data.session) {
      throw new AppError(
        error?.message ?? "Invalid credentials.",
        401
      );
    }

    // Fetch the user_role profile to include in the response
    const { data: profile } = await supabaseAdmin
      .from("user_role")
      .select("id, first_name, last_name, role_name, created_at")
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
          id:        data.user.id,
          email:     data.user.email,
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
//
// Invalidates the user's current Supabase session.
// The client should also clear any locally stored tokens on its side.
// ─────────────────────────────────────────────────────────────────────────────
export const logout = async (
  req: Request,
  res: Response<ApiResponse>,
  next: NextFunction
): Promise<void> => {
  try {
    // Extract the raw token from the Authorization header (requireAuth already
    // validated it — we need it again here to call signOut with the right scope)
    const token = req.headers.authorization!.split(" ")[1];

    // Sign out using the user-scoped client so only THIS session is invalidated
    // (not all sessions for the user, which global scope would do)
    const userClient = createUserClient(token);
    const { error } = await userClient.auth.signOut();

    if (error) {
      throw new AppError(`Logout failed: ${error.message}`, 500);
    }

    res.status(200).json({ success: true, message: "Logged out successfully." });
  } catch (err) {
    next(err);
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/auth/refresh-token   — auth
//
// Exchanges a refresh_token for a new access_token + refresh_token pair.
// The old refresh_token is invalidated by Supabase (rotation).
// ─────────────────────────────────────────────────────────────────────────────
export const refreshToken = async (
  req: Request,
  res: Response<ApiResponse>,
  next: NextFunction
): Promise<void> => {
  try {
    const { refresh_token } = req.body;
    if (!refresh_token || typeof refresh_token !== "string") {
      throw new AppError("refresh_token is required in the request body.", 400);
    }

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
//
// Sends a password-reset email via Supabase Auth.
// Always responds with 200 to avoid leaking whether the email is registered.
// ─────────────────────────────────────────────────────────────────────────────
export const forgotPassword = async (
  req: Request,
  res: Response<ApiResponse>,
  next: NextFunction
): Promise<void> => {
  try {
    const { email } = forgotPasswordSchema.parse(req.body);

    // Fire-and-forget — we intentionally do not expose whether the email exists
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
//
// The frontend exchanges the token from the reset email for a new password.
// The access_token in the reset link is used to authenticate the update.
// ─────────────────────────────────────────────────────────────────────────────
export const resetPassword = async (
  req: Request,
  res: Response<ApiResponse>,
  next: NextFunction
): Promise<void> => {
  try {
    const { access_token, new_password } = resetPasswordSchema.parse(req.body);

    // Set the session using the one-time token from the reset email
    const { error: sessionError } = await supabase.auth.setSession({
      access_token,
      refresh_token: access_token, // Supabase accepts the same token for both in reset flow
    });

    if (sessionError) {
      throw new AppError(
        "Invalid or expired reset token. Please request a new password reset.",
        401
      );
    }

    // Update the password
    const { error: updateError } = await supabase.auth.updateUser({
      password: new_password,
    });

    if (updateError) {
      throw new AppError(`Password reset failed: ${updateError.message}`, 400);
    }

    res.status(200).json({ success: true, message: "Password reset successfully. Please log in." });
  } catch (err) {
    next(err);
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/auth/me   — auth
//
// Returns the authenticated user's profile from the user_role table.
// ─────────────────────────────────────────────────────────────────────────────
export const getMe = async (
  req: Request,
  res: Response<ApiResponse<UserRole & { email: string | undefined }>>,
  next: NextFunction
): Promise<void> => {
  try {
    // req.userRole is already populated by requireAuth middleware
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
// Updates the authenticated user's first_name, last_name, and/or password.
// Profile fields go to user_role; password goes through Supabase Auth.
// ─────────────────────────────────────────────────────────────────────────────
export const updateMe = async (
  req: Request,
  res: Response<ApiResponse>,
  next: NextFunction
): Promise<void> => {
  try {
    const body   = updateMeSchema.parse(req.body);
    const userId = req.user!.id;
    const token  = req.headers.authorization!.split(" ")[1];

    // ── Update profile fields in user_role ──────────────────────────────────
    const profileUpdates: Record<string, string> = {};
    if (body.first_name) profileUpdates.first_name = body.first_name.trim();
    if (body.last_name)  profileUpdates.last_name  = body.last_name.trim();

    if (Object.keys(profileUpdates).length > 0) {
      const { error } = await supabaseAdmin
        .from("user_role")
        .update(profileUpdates)
        .eq("id", userId);

      if (error) {
        throw new AppError(`Profile update failed: ${error.message}`, 500);
      }
    }

    // ── Update password via Supabase Auth ────────────────────────────────────
    if (body.new_password) {
      const userClient = createUserClient(token);
      const { error } = await userClient.auth.updateUser({
        password: body.new_password,
      });

      if (error) {
        throw new AppError(`Password update failed: ${error.message}`, 400);
      }
    }

    // Return the updated profile
    const { data: updated } = await supabaseAdmin
      .from("user_role")
      .select("id, first_name, last_name, role_name, created_at")
      .eq("id", userId)
      .single();

    res.status(200).json({
      success: true,
      message: "Profile updated successfully.",
      data: { ...updated, email: req.user?.email },
    });
  } catch (err) {
    next(err);
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// Internal helper — creates a Supabase client scoped to a specific user token.
// Used for operations that must run as the user (logout, password change).
// ─────────────────────────────────────────────────────────────────────────────
function createUserClient(accessToken: string) {
  const { createClient } = require("@supabase/supabase-js");
  return createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_ANON_KEY!,
    {
      global: { headers: { Authorization: `Bearer ${accessToken}` } },
      auth:   { persistSession: false, autoRefreshToken: false },
    }
  );
}
