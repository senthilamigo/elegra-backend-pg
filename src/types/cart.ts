/**
 * File: src/types/cart.ts
 * Path: ecommerce-admin/src/types/cart.ts
 *
 * TypeScript interfaces mirroring the exact cart and wishlist DB columns.
 *
 * cart table:
 *   id          UUID PRIMARY KEY
 *   user_id     UUID REFERENCES auth.users(id)
 *   product_id  UUID REFERENCES products(id)
 *   quantity    INTEGER  NOT NULL  CHECK (quantity > 0)
 *   created_at  TIMESTAMPTZ
 *   updated_at  TIMESTAMPTZ
 *
 * wishlist table:
 *   id          UUID PRIMARY KEY
 *   user_id     UUID REFERENCES auth.users(id)
 *   product_id  UUID REFERENCES products(id)
 *   created_at  TIMESTAMPTZ
 *   deleted_at  TIMESTAMPTZ  (NULL = active; non-NULL = soft-deleted)
 */

export interface CartItem {
  id:         string;        // uuid PK
  user_id:    string;        // uuid FK → auth.users
  product_id: string;        // uuid FK → products
  quantity:   number;        // > 0
  created_at: string;
  updated_at: string;
}

export interface WishlistItem {
  id:         string;        // uuid PK
  user_id:    string;        // uuid FK → auth.users
  product_id: string;        // uuid FK → products
  created_at: string;
  deleted_at: string | null; // NULL = active; timestamp = soft-deleted
}
