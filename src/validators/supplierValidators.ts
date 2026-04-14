/**
 * File: src/validators/supplierValidators.ts
 * Path: ecommerce-admin/src/validators/supplierValidators.ts
 *
 * Zod schemas for the supplier CRUD endpoints.
 *
 * Covered endpoints:
 *   POST /api/suppliers          — createSupplierSchema
 *   PUT  /api/suppliers/:id      — updateSupplierSchema
 *
 * The GET endpoints (/api/suppliers and /api/suppliers/:id) have no
 * request bodies to validate, so no schema is needed for them.
 *
 * suppliers table columns:
 *   id, name, contact_person, email, phone, address, status, created_at
 */

import { z } from "zod";

// ─────────────────────────────────────────────
// Shared primitives
// ─────────────────────────────────────────────

/**
 * Allowed status values for a supplier.
 * Matches the VARCHAR(50) column with application-level enforcement.
 * 'inactive' and 'suspended' are intentionally distinct:
 *   - inactive  → supplier stopped trading (self/voluntary)
 *   - suspended → admin-imposed hold
 */
const supplierStatusEnum = z.enum(["active", "inactive", "suspended"], {
  errorMap: () => ({
    message: "status must be 'active', 'inactive', or 'suspended'",
  }),
});

// ─────────────────────────────────────────────
// POST /api/suppliers — create a new supplier
// ─────────────────────────────────────────────

/**
 * All fields except `name` are optional at creation.
 * `status` defaults to 'active' if omitted.
 *
 * Validation rules:
 *   name           — required, 1–255 chars, trimmed
 *   contact_person — optional, max 255 chars
 *   email          — optional, must be valid email format if provided
 *   phone          — optional, max 20 chars
 *   address        — optional, free-text (TEXT column, no length cap in DB)
 *   status         — optional, defaults to 'active'
 */
export const createSupplierSchema = z.object({
  name: z
    .string()
    .min(1, "Supplier name is required")
    .max(255, "Supplier name must be 255 characters or fewer")
    .trim(),

  contact_person: z
    .string()
    .max(255, "Contact person name must be 255 characters or fewer")
    .trim()
    .optional()
    .nullable(),

  email: z
    .string()
    .email("Must be a valid email address")
    .max(255, "Email must be 255 characters or fewer")
    .optional()
    .nullable(),

  phone: z
    .string()
    .max(20, "Phone number must be 20 characters or fewer")
    .optional()
    .nullable(),

  address: z
    .string()
    .max(2000, "Address must be 2000 characters or fewer")
    .optional()
    .nullable(),

  // Defaults to 'active' when not provided
  status: supplierStatusEnum.default("active"),
});

// ─────────────────────────────────────────────
// PUT /api/suppliers/:id — update an existing supplier
// ─────────────────────────────────────────────

/**
 * Every field is optional — only send what needs changing.
 * At least one field must be present (enforced via .refine).
 *
 * `name`, if sent, still cannot be empty string.
 * `email`, if sent, still must be valid email format.
 * Setting a nullable field to null explicitly clears it in the DB.
 */
export const updateSupplierSchema = z
  .object({
    name: z
      .string()
      .min(1, "Supplier name cannot be empty")
      .max(255, "Supplier name must be 255 characters or fewer")
      .trim()
      .optional(),

    contact_person: z
      .string()
      .max(255, "Contact person name must be 255 characters or fewer")
      .trim()
      .optional()
      .nullable(),

    email: z
      .string()
      .email("Must be a valid email address")
      .max(255, "Email must be 255 characters or fewer")
      .optional()
      .nullable(),

    phone: z
      .string()
      .max(20, "Phone number must be 20 characters or fewer")
      .optional()
      .nullable(),

    address: z
      .string()
      .max(2000, "Address must be 2000 characters or fewer")
      .optional()
      .nullable(),

    status: supplierStatusEnum.optional(),
  })
  // Require at least one field so we never fire a no-op UPDATE
  .refine(
    (data) => Object.values(data).some((value) => value !== undefined),
    { message: "At least one field must be provided for update" }
  );

// ─────────────────────────────────────────────
// Inferred TypeScript types
// ─────────────────────────────────────────────

export type CreateSupplierInput = z.infer<typeof createSupplierSchema>;
export type UpdateSupplierInput = z.infer<typeof updateSupplierSchema>;
