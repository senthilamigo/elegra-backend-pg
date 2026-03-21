// ─────────────────────────────────────────────
// Database Row Types (mirror PostgreSQL schema)
// ─────────────────────────────────────────────
// NOTE: products.id and product_variants.id were changed from bigint → uuid.
// All other FK/ID columns in the categories table remain bigint.

export interface Category {
  id: bigint;
  created_at: string;
  category_name: string;
  parent_category_id: bigint | null;
  is_active: boolean;
}

export interface Product {
  id: string;           // uuid — changed from bigint
  created_at: string;
  seller_id: string;        // uuid — changed from bigint
  name: string;
  description: string;
  category_id: bigint;
  gender: string;
  is_active: boolean;
  product_code: string;
}

export interface ProductVariant {
  id: string;           // uuid — changed from bigint
  created_at: string;
  product_id: string;   // uuid FK → products.id — changed from bigint
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
      user?:     User;
      userRole?: UserRole;   // defined below in this file — no self-import needed
    }
  }
}

// ─────────────────────────────────────────────
// user_role table
//   id         UUID PRIMARY KEY (FK → auth.users.id)
//   first_name text             NOT NULL
//   last_name  text             NULL
//   role_name  text             NOT NULL  ('customer' | 'seller' | 'admin')
//   created_at TIMESTAMP
// ─────────────────────────────────────────────

export type RoleName = "customer" | "seller" | "admin";

export interface UserRole {
  id:         string;        // uuid — FK → auth.users.id
  first_name: string;        // NOT NULL
  last_name:  string | null; // NULL allowed
  role_name:  RoleName;      // NOT NULL
  created_at: string;
}
