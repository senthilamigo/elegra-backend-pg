/**
 * File: src/types/cart.ts
 * Path: ecommerce-admin/src/types/cart.ts
 *
 * TypeScript interfaces mirroring the cart and wishlist DB tables.
 *
 * cart table:
 *   id           UUID PRIMARY KEY
 *   user_id      UUID REFERENCES auth.users(id)
 *   variant_id   UUID REFERENCES product_variants(id)
 *   quantity     INTEGER  NOT NULL  CHECK (quantity > 0)
 *   created_at   TIMESTAMPTZ
 *   updated_at   TIMESTAMPTZ
 *
 * wishlist table:
 *   id           UUID PRIMARY KEY
 *   user_id      UUID REFERENCES auth.users(id)
 *   product_id   UUID REFERENCES products(id)
 *   created_at   TIMESTAMPTZ
 *   is_active    BOOLEAN  DEFAULT true  (soft-delete flag)
 */

export interface CartItem {
  id:         string;   // uuid PK
  user_id:    string;   // uuid FK → auth.users
  variant_id: string;   // uuid FK → product_variants
  quantity:   number;   // > 0
  created_at: string;
  updated_at: string;
}

export interface WishlistItem {
  id:         string;   // uuid PK
  user_id:    string;   // uuid FK → auth.users
  product_id: string;   // uuid FK → products
  created_at: string;
  is_active:  boolean;  // soft-delete flag
}
