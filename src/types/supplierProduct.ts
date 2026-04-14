export interface SupplierProduct {
  id: string;
  supplier_id: string;
  product_id: string;
  cost_price: number | null;
  lead_time_days: number | null;
  created_at: string;
}
