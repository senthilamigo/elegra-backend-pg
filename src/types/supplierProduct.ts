/**
 * File: src/types/supplierProduct.ts
 * Path: ecommerce-admin/src/types/supplierProduct.ts
 *
 * TypeScript interface for rows in the `supplier_products` table.
 *
 * Columns mirrored:
 *   id, supplier_id, product_id, supplier_product_name, supplier_sku,
 *   cost_price, lead_time_days, created_at
 *
 * Used by supplier-product controller logic for strongly typed update payloads
 * and data handling.
 */
export interface SupplierProduct {
  id: string;
  supplier_id: string;
  product_id: string;
  supplier_product_name: string | null;
  supplier_sku: string | null;
  cost_price: number | null;
  lead_time_days: number | null;
  created_at: string;
}
