import { Request, Response, NextFunction } from "express";
import { supabaseAdmin } from "../config/supabase";
import { AppError } from "../middleware/errorHandler";
import { ApiResponse, UserRole } from "../types";
import { updateRoleSchema } from "../validators/auth";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function validateUuid(id: string, label = "id"): void {
  if (!UUID_RE.test(id)) {
    throw new AppError(`Invalid ${label} — must be a valid UUID`, 400);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/users   — admin
//
// Returns all rows from user_role joined with the auth email.
// Uses the admin client to access auth.users via Supabase's admin API.
// Supports optional ?page= and ?limit= query params (default 1 / 20).
// ─────────────────────────────────────────────────────────────────────────────
export const listUsers = async (
  req: Request,
  res: Response<ApiResponse>,
  next: NextFunction
): Promise<void> => {
  try {
    const page  = Math.max(1, parseInt(String(req.query.page  ?? "1"),  10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit ?? "20"), 10) || 20));
    const from  = (page - 1) * limit;
    const to    = from + limit - 1;

    const { data: profiles, error, count } = await supabaseAdmin
      .from("user_role")
      .select("id, first_name, last_name, role_name, created_at", { count: "exact" })
      .order("created_at", { ascending: false })
      .range(from, to);

    if (error) throw new AppError(`Failed to fetch users: ${error.message}`, 500);

    // Fetch auth emails for this page of users in one admin API call
    const { data: authList } = await supabaseAdmin.auth.admin.listUsers({
      page,
      perPage: limit,
    });

    // Build an id→email lookup from the auth list
    const emailMap: Record<string, string> = {};
    (authList?.users ?? []).forEach((u) => { emailMap[u.id] = u.email ?? ""; });

    const users = (profiles ?? []).map((p) => ({
      ...p,
      email: emailMap[p.id] ?? null,
    }));

    res.status(200).json({
      success: true,
      data: {
        data:    users,
        total:   count ?? 0,
        page,
        limit,
        hasMore: (count ?? 0) > page * limit,
      },
    });
  } catch (err) {
    next(err);
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/users/:id   — admin
// ─────────────────────────────────────────────────────────────────────────────
export const getUserById = async (
  req: Request,
  res: Response<ApiResponse>,
  next: NextFunction
): Promise<void> => {
  try {
    const { id } = req.params;
    validateUuid(id, "user id");

    const { data: profile, error } = await supabaseAdmin
      .from("user_role")
      .select("id, first_name, last_name, role_name, created_at")
      .eq("id", id)
      .single();

    if (error || !profile) {
      throw new AppError(`User with id ${id} not found`, 404);
    }

    // Fetch auth email from Supabase admin
    const { data: authUser } = await supabaseAdmin.auth.admin.getUserById(id);

    res.status(200).json({
      success: true,
      data: {
        ...profile,
        email: authUser?.user?.email ?? null,
      },
    });
  } catch (err) {
    next(err);
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /api/users/:id/role   — admin
//
// Updates the role_name for a user.
// An admin cannot downgrade their own role to prevent lockout.
// ─────────────────────────────────────────────────────────────────────────────
export const updateUserRole = async (
  req: Request,
  res: Response<ApiResponse>,
  next: NextFunction
): Promise<void> => {
  try {
    const { id } = req.params;
    validateUuid(id, "user id");

    const { role_name } = updateRoleSchema.parse(req.body);

    // Prevent an admin from removing their own admin role
    if (id === req.user?.id && role_name !== "admin") {
      throw new AppError("You cannot change your own role.", 403);
    }

    // Confirm the target user exists
    const { data: existing, error: fetchError } = await supabaseAdmin
      .from("user_role")
      .select("id, role_name")
      .eq("id", id)
      .single();

    if (fetchError || !existing) {
      throw new AppError(`User with id ${id} not found`, 404);
    }

    const { data: updated, error: updateError } = await supabaseAdmin
      .from("user_role")
      .update({ role_name })
      .eq("id", id)
      .select("id, first_name, last_name, role_name, created_at")
      .single();

    if (updateError) {
      throw new AppError(`Role update failed: ${updateError.message}`, 500);
    }

    res.status(200).json({
      success: true,
      message: `User role updated to '${role_name}'.`,
      data: updated,
    });
  } catch (err) {
    next(err);
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /api/users/:id   — admin
//
// Deletes both the user_role profile row and the Supabase auth account.
// An admin cannot delete their own account.
// ─────────────────────────────────────────────────────────────────────────────
export const deleteUser = async (
  req: Request,
  res: Response<ApiResponse>,
  next: NextFunction
): Promise<void> => {
  try {
    const { id } = req.params;
    validateUuid(id, "user id");

    // Prevent self-deletion
    if (id === req.user?.id) {
      throw new AppError("You cannot delete your own account.", 403);
    }

    // Confirm user exists
    const { data: existing } = await supabaseAdmin
      .from("user_role")
      .select("id")
      .eq("id", id)
      .single();

    if (!existing) {
      throw new AppError(`User with id ${id} not found`, 404);
    }

    // Delete profile row first (FK references auth.users, so we remove this first
    // to avoid FK constraint violations — the auth user is the parent)
    const { error: profileDeleteError } = await supabaseAdmin
      .from("user_role")
      .delete()
      .eq("id", id);

    if (profileDeleteError) {
      throw new AppError(`Failed to delete user profile: ${profileDeleteError.message}`, 500);
    }

    // Delete the Supabase auth account
    const { error: authDeleteError } = await supabaseAdmin.auth.admin.deleteUser(id);

    if (authDeleteError) {
      // Auth deletion failed — profile is already gone, log for manual cleanup
      console.error(`[deleteUser] auth.admin.deleteUser failed for ${id}:`, authDeleteError.message);
      throw new AppError(
        `Profile deleted but auth account removal failed: ${authDeleteError.message}`,
        500
      );
    }

    res.status(200).json({
      success: true,
      message: `User ${id} has been permanently deleted.`,
    });
  } catch (err) {
    next(err);
  }
};
