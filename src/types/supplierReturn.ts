/**
 * File: src/types/supplierReturn.ts
 * Path: src/types/supplierReturn.ts
 *
 * TypeScript interfaces for supplier return workflows.
 *
 * Tables represented:
 *   - supplier_returns
 *   - supplier_return_items
 *   - inventory_batches
 */

export type SupplierReturnStatus = "initiated" | "shipped" | "completed";

export interface SupplierReturn {
  id: string;
  supplier_id: string;
  seller_id: string;
  reason: string | null;
  status: SupplierReturnStatus | null;
  created_at: string;
}

export interface SupplierReturnItem {
  id: string;
  return_id: string;
  inventory_batch_id: string;
  quantity: number;
}
