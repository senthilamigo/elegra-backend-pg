/**
 * File: src/types/supplier.ts
 * Path: ecommerce-admin/src/types/supplier.ts
 *
 * TypeScript interfaces mirroring the suppliers table.
 *
 * suppliers table columns:
 *   id             UUID PRIMARY KEY
 *   name           VARCHAR(255) NOT NULL
 *   contact_person VARCHAR(255) NULL
 *   email          VARCHAR(255) NULL
 *   phone          VARCHAR(20)  NULL
 *   address        TEXT         NULL
 *   status         VARCHAR(50)  DEFAULT 'active'
 *   created_at     TIMESTAMPTZ  DEFAULT now()
 *
 * Access: seller role and above (seller, admin).
 * Suppliers represent the businesses/individuals that stock products for sellers.
 * A supplier is linked to products via the supplier_products join table,
 * and to inventory via inventory_batches.
 */

// ─────────────────────────────────────────────
// Enums
// ─────────────────────────────────────────────

/** Valid values for suppliers.status */
export type SupplierStatus = "active" | "inactive" | "suspended";

// ─────────────────────────────────────────────
// Core DB row interface
// ─────────────────────────────────────────────

/**
 * Mirrors every column in the suppliers table exactly.
 * Used as the return type for all supplier query results.
 */
export interface Supplier {
  id:             string;           // UUID PRIMARY KEY
  name:           string;           // VARCHAR(255) NOT NULL
  contact_person: string | null;    // VARCHAR(255) — optional contact name
  email:          string | null;    // VARCHAR(255) — business email
  phone:          string | null;    // VARCHAR(20)  — contact number
  address:        string | null;    // TEXT          — full mailing address
  status:         SupplierStatus;   // VARCHAR(50)  DEFAULT 'active'
  created_at:     string;           // TIMESTAMPTZ  — ISO string from Supabase
}
