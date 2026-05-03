/**
 * File: src/validators/expenseValidators.ts
 * Path: src/validators/expenseValidators.ts
 *
 * Zod request validation schemas for expense endpoints.
 *
 * Endpoints validated:
 *   - POST   /api/expenses            — createExpenseSchema
 *   - PUT    /api/expenses/:id        — updateExpenseSchema
 *   - GET    /api/expenses            — listExpensesQuerySchema  (query params)
 *
 * GET /api/expenses/:id and DELETE /api/expenses/:id have no body to validate;
 * the :id path param is validated with a UUID regex in the controller.
 *
 * expense_type allowed values (from sql/expenses.sql comment):
 *   travel | stall | logistics | misc
 */

import { z } from "zod";

// ─────────────────────────────────────────────
// Shared primitives
// ─────────────────────────────────────────────

const uuidSchema = z.string().uuid("Must be a valid UUID");

/**
 * Allowed expense_type values.
 * Mirrors the VARCHAR(50) column with application-level enforcement.
 */
const expenseTypeEnum = z.enum(["travel", "stall", "logistics", "misc"], {
  errorMap: () => ({
    message: "expense_type must be one of: travel, stall, logistics, misc",
  }),
});

/**
 * ISO date string validator for expense_date (stored as DATE in DB).
 * Accepts strings in YYYY-MM-DD format.
 */
const dateStringSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "expense_date must be a valid date in YYYY-MM-DD format")
  .refine(
    (d) => !isNaN(Date.parse(d)),
    { message: "expense_date must be a real calendar date" }
  );

// ─────────────────────────────────────────────
// POST /api/expenses — create a new expense
// ─────────────────────────────────────────────

/**
 * Required fields:
 *   - amount       — positive number, required
 *   - expense_date — YYYY-MM-DD string, required
 *
 * Optional fields:
 *   - seller_id    — admin-only override; sellers always use their own profile
 *   - title        — short description label
 *   - description  — long-form detail
 *   - expense_type — category: travel | stall | logistics | misc
 */
export const createExpenseSchema = z.object({
  /**
   * UUID of the sellers row this expense belongs to.
   * For seller callers: resolved from JWT; this field is ignored if provided.
   * For admin callers: required (they must specify which seller's expense this is).
   */
  seller_id: uuidSchema.optional(),

  /** Short label for the expense — VARCHAR(255) */
  title: z
    .string()
    .trim()
    .max(255, "title must be 255 characters or fewer")
    .optional()
    .nullable(),

  /** Detailed notes — TEXT column */
  description: z
    .string()
    .trim()
    .max(5000, "description must be 5000 characters or fewer")
    .optional()
    .nullable(),

  /** Monetary amount — must be positive; stored as NUMERIC(12,2) */
  amount: z
    .number({
      required_error: "amount is required",
      invalid_type_error: "amount must be a number",
    })
    .positive("amount must be greater than 0")
    .multipleOf(0.01, "amount must have at most 2 decimal places"),

  /** Category tag for the expense */
  expense_type: expenseTypeEnum.optional().nullable(),

  /** Calendar date the expense was incurred — YYYY-MM-DD */
  expense_date: dateStringSchema,
});

// ─────────────────────────────────────────────
// PUT /api/expenses/:id — update an existing expense
// ─────────────────────────────────────────────

/**
 * Every field is optional — only send the fields that need changing.
 * At least one field must be present (enforced via .refine).
 *
 * seller_id is intentionally NOT updatable: an expense's ownership
 * cannot be transferred to a different seller after creation.
 *
 * amount, if provided, still must be positive.
 * expense_date, if provided, still must be a valid YYYY-MM-DD string.
 */
export const updateExpenseSchema = z
  .object({
    title: z
      .string()
      .trim()
      .max(255, "title must be 255 characters or fewer")
      .optional()
      .nullable(),

    description: z
      .string()
      .trim()
      .max(5000, "description must be 5000 characters or fewer")
      .optional()
      .nullable(),

    amount: z
      .number({ invalid_type_error: "amount must be a number" })
      .positive("amount must be greater than 0")
      .multipleOf(0.01, "amount must have at most 2 decimal places")
      .optional(),

    expense_type: expenseTypeEnum.optional().nullable(),

    expense_date: dateStringSchema.optional(),
  })
  // Guard: at least one updatable field must be present so we never
  // fire a no-op UPDATE query against the database.
  .refine(
    (data) =>
      data.title !== undefined ||
      data.description !== undefined ||
      data.amount !== undefined ||
      data.expense_type !== undefined ||
      data.expense_date !== undefined,
    {
      message:
        "At least one field (title, description, amount, expense_type, expense_date) must be provided",
    }
  );

// ─────────────────────────────────────────────
// GET /api/expenses — query param validation
// ─────────────────────────────────────────────

/**
 * Validates and coerces query parameters for the list endpoint.
 *
 * Supported filters:
 *   ?expense_type=travel|stall|logistics|misc
 *   ?seller_id=<uuid>           — admin only; sellers always see own
 *   ?from=YYYY-MM-DD            — inclusive lower bound on expense_date
 *   ?to=YYYY-MM-DD              — inclusive upper bound on expense_date
 *   ?page=<n>                   — default 1
 *   ?limit=<n>                  — default 20, max 100
 */
export const listExpensesQuerySchema = z.object({
  expense_type: expenseTypeEnum.optional(),

  seller_id: uuidSchema.optional(),

  from: dateStringSchema.optional(),

  to: dateStringSchema.optional(),

  page: z.coerce
    .number()
    .int()
    .min(1, "page must be at least 1")
    .default(1),

  limit: z.coerce
    .number()
    .int()
    .min(1, "limit must be at least 1")
    .max(100, "limit cannot exceed 100")
    .default(20),
});

// ─────────────────────────────────────────────
// Inferred TypeScript types
// ─────────────────────────────────────────────

export type CreateExpenseInput     = z.infer<typeof createExpenseSchema>;
export type UpdateExpenseInput     = z.infer<typeof updateExpenseSchema>;
export type ListExpensesQueryInput = z.infer<typeof listExpensesQuerySchema>;
