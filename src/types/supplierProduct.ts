/**
 * File: src/types/supplierProduct.ts
 * Path: ecommerce-admin/src/types/supplierProduct.ts
 *
 * TypeScript interface for rows in the `supplier_products` table.
 *
 * Columns mirrored:
 *   id, supplier_id, product_id, cost_price, lead_time_days, created_at,
 *   supplier_product_name, supplier_sku
 *
 * New columns (added April 2026):
 *   supplier_product_name VARCHAR(255) — the supplier's own name for this product
 *   supplier_sku          VARCHAR(100) — the supplier's internal SKU reference
 *
 * Used by supplier-product controller logic for strongly typed update payloads
 * and data handling.
 */
export interface SupplierProduct {
  id:                   string;
  supplier_id:          string;
  product_id:           string;
  cost_price:           number | null;
  lead_time_days:       number | null;
  created_at:           string;
  /** Supplier's own name/label for this product — may differ from products.name */
  supplier_product_name: string | null;
  /** Supplier's internal SKU reference for this product */
  supplier_sku:         string | null;
}
