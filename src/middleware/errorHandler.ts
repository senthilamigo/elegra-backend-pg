import { Request, Response, NextFunction } from "express";
import { ZodError } from "zod";
import { ApiResponse } from "../types";

/**
 * Custom error class for operational errors (expected errors we throw intentionally).
 * Operational errors get their status code forwarded to the client.
 * Programmer errors (unexpected) return a generic 500.
 */
export class AppError extends Error {
  constructor(
    public message: string,
    public statusCode: number = 500
  ) {
    super(message);
    this.name = "AppError";
    // Restore prototype chain for instanceof checks
    Object.setPrototypeOf(this, AppError.prototype);
  }
}

/**
 * Centralized error handler — must be registered LAST with app.use()
 *
 * Security considerations:
 * - In production, stack traces are suppressed to avoid leaking implementation details
 * - Zod validation errors are normalized into a consistent format
 * - Generic 500 messages are returned for unexpected errors
 */
export const errorHandler = (
  err: Error,
  req: Request,
  res: Response<ApiResponse>,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _next: NextFunction
): void => {
  const isDev = process.env.NODE_ENV === "development";

  // Handle Zod validation errors (from validators)
  if (err instanceof ZodError) {
    res.status(400).json({
      success: false,
      message: "Validation failed",
      errors: err.flatten().fieldErrors,
    });
    return;
  }

  // Handle known operational errors
  if (err instanceof AppError) {
    res.status(err.statusCode).json({
      success: false,
      message: err.message,
      ...(isDev && { stack: err.stack }),
    });
    return;
  }

  // Unknown / programmer error — log internally, return generic message
  console.error("[Unhandled Error]", err);
  res.status(500).json({
    success: false,
    message: "An unexpected internal server error occurred.",
    ...(isDev && { stack: err.stack }),
  });
};

/**
 * 404 handler for unmatched routes — register before errorHandler
 */
export const notFoundHandler = (req: Request, res: Response<ApiResponse>): void => {
  res.status(404).json({
    success: false,
    message: `Route ${req.method} ${req.path} not found`,
  });
};
