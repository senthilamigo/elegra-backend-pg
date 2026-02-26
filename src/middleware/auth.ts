import { Request, Response, NextFunction } from "express";
import { supabase } from "../config/supabase";
import { ApiResponse } from "../types";

/**
 * Authentication Middleware
 *
 * Security considerations:
 * - Validates JWT tokens issued by Supabase Auth (RS256 signed)
 * - Token is extracted from Authorization header (Bearer scheme)
 * - We call supabase.auth.getUser() which validates the token server-side
 *   against Supabase's public key — we do NOT simply decode/trust the JWT payload
 * - Expired tokens are rejected automatically
 * - Do NOT store tokens in localStorage on the frontend; prefer httpOnly cookies
 *   or in-memory storage to mitigate XSS attacks
 */
export const authenticate = async (
  req: Request,
  res: Response<ApiResponse>,
  next: NextFunction
): Promise<void> => {
  const authHeader = req.headers.authorization;

  // Reject requests without an Authorization header
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    res.status(401).json({
      success: false,
      message: "Missing or malformed Authorization header. Expected: Bearer <token>",
    });
    return;
  }

  const token = authHeader.split(" ")[1];

  // Validate the token with Supabase — this hits Supabase's /auth/v1/user endpoint
  const { data, error } = await supabase.auth.getUser(token);

  if (error || !data.user) {
    res.status(401).json({
      success: false,
      // Avoid leaking internal error details to the client
      message: "Invalid or expired token. Please log in again.",
    });
    return;
  }

  // Attach verified user to the request for downstream handlers
  req.user = data.user;
  next();
};
