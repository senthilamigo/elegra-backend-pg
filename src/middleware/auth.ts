/**
 * File: src/middleware/auth.ts
 * Path: ecommerce-admin/src/middleware/auth.ts
 *
 * Authentication and role-based access control middleware.
 *
 * Exports:
 *   requireAuth  — validates Bearer JWT and loads req.user + req.userRole
 *   requireRole  — factory that enforces a minimum role level
 *   authenticate — backward-compatible alias for requireAuth
 */

import { Request, Response, NextFunction } from "express";
import { supabase, supabaseAdmin }         from "../config/supabase";
import { ApiResponse, RoleName, UserRole } from "../types";

// ─────────────────────────────────────────────────────────────────────────────
// requireAuth
//
// Validates the Bearer JWT in the Authorization header against Supabase
// (server-side check — not just a local decode), then loads the caller's
// row from the `user_role` table and attaches both to the request object:
//
//   req.user      — Supabase auth.users record (id, email, …)
//   req.userRole  — user_role row (id, first_name, last_name, role_name,
//                                  status, created_at)
//
// Every protected route MUST list requireAuth before its handler.
// requireRole() depends on req.userRole already being populated.
// ─────────────────────────────────────────────────────────────────────────────
export const requireAuth = async (
  req:  Request,
  res:  Response<ApiResponse<unknown>>,
  next: NextFunction
): Promise<void> => {
  const authHeader = req.headers.authorization;

  if (!authHeader?.startsWith("Bearer ")) {
    res.status(401).json({
      success: false,
      message: "Missing or malformed Authorization header. Expected: Bearer <token>",
    });
    return;
  }

  const token = authHeader.split(" ")[1];

  // Verify token with Supabase — real server-side check,
  // not a local JWT decode, so revoked tokens are rejected correctly.
  const { data: authData, error: authError } = await supabase.auth.getUser(token);

  if (authError || !authData.user) {
    res.status(401).json({
      success: false,
      message: "Invalid or expired token. Please log in again.",
    });
    return;
  }

  // Load the user_role profile — includes the new `status` column.
  const { data: roleRow, error: roleError } = await supabaseAdmin
    .from("user_role")
    .select("id, first_name, last_name, role_name, status, created_at")
    .eq("id", authData.user.id)
    .single<UserRole>();

  if (roleError || !roleRow) {
    res.status(403).json({
      success: false,
      message: "User profile not found. Your account may not be fully set up.",
    });
    return;
  }

  // Block suspended users from accessing any protected route
  if (roleRow.status === "suspended") {
    res.status(403).json({
      success: false,
      message: "Your account has been suspended. Please contact support.",
    });
    return;
  }

  req.user     = authData.user;
  req.userRole = roleRow;
  next();
};

// ─────────────────────────────────────────────────────────────────────────────
// requireRole(roleName)
//
// Middleware factory for role-based access control.
// MUST be placed after requireAuth in the middleware chain — it reads
// req.userRole which requireAuth populates.
//
// Role hierarchy (lowest → highest privilege):
//   customer  →  seller  →  admin
//
// Passing "seller" grants access to users whose role is seller OR admin.
// Passing "admin"  grants access only to admins.
// ─────────────────────────────────────────────────────────────────────────────
export const requireRole = (required: RoleName) => (
  req:  Request,
  res:  Response<ApiResponse<unknown>>,
  next: NextFunction
): void => {
  const userRole = req.userRole?.role_name;

  const HIERARCHY: RoleName[] = ["customer", "seller", "admin"];
  const userLevel     = HIERARCHY.indexOf(userRole as RoleName);
  const requiredLevel = HIERARCHY.indexOf(required);

  if (userLevel === -1 || userLevel < requiredLevel) {
    res.status(403).json({
      success: false,
      message: `Access denied. This endpoint requires the '${required}' role or above.`,
    });
    return;
  }

  next();
};

// ─────────────────────────────────────────────────────────────────────────────
// authenticate — backward-compatible alias for requireAuth.
// Keeps existing product / category / upload routes compiling without changes.
// ─────────────────────────────────────────────────────────────────────────────
export const authenticate = requireAuth;
