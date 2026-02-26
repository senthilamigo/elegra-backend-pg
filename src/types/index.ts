// ─────────────────────────────────────────────
// Database Row Types (mirror PostgreSQL schema)
// ─────────────────────────────────────────────

export interface Category {
  id: bigint;
  created_at: string;
  category_name: string;
  parent_category_id: bigint | null;
  is_active: boolean;
}

export interface Product {
  id: bigint;
  created_at: string;
  seller_id: bigint;
  name: string;
  description: string;
  category_id: bigint;
  gender: string;
  is_active: boolean;
  product_code: string;
}

export interface ProductVariant {
  id: bigint;
  created_at: string;
  product_id: bigint;
  sku: string;
  color: string | null;
  size: string | null;
  material: string | null;
  attributes: Record<string, unknown> | null; // jsonb
  base_price: number;
  is_active: boolean;
  image_url_primary: string | null;
  images_urls: string[] | null;
  status: string;
  stock: number;
  discount_type: string | null;
  discount_value: number | null;
}

// ─────────────────────────────────────────────
// Request / Response DTOs
// ─────────────────────────────────────────────

export interface ProductWithVariants extends Product {
  variants: ProductVariant[];
}

export interface PaginatedResponse<T> {
  data: T[];
  page: number;
  limit: number;
  total: number;
  hasMore: boolean;
}

export interface ApiResponse<T = null> {
  success: boolean;
  message?: string;
  data?: T;
  errors?: unknown;
}

// ─────────────────────────────────────────────
// Express augmentation for authenticated user
// ─────────────────────────────────────────────
import { User } from "@supabase/supabase-js";

declare global {
  namespace Express {
    interface Request {
      user?: User;
    }
  }
}
