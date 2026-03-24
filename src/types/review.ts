/**
 * File: src/types/review.ts
 * Path: ecommerce-admin/src/types/review.ts
 *
 * TypeScript interface mirroring the product_reviews table.
 *
 * product_reviews columns:
 *   id                   UUID PRIMARY KEY
 *   user_id              UUID REFERENCES auth.users(id)
 *   product_id           UUID REFERENCES products(id)
 *   product_variant_id   UUID REFERENCES product_variants(id)
 *   rating               INTEGER  (1–5)
 *   review_title         VARCHAR(255)
 *   review_text          TEXT       (column name in schema listed as "mreview_text" —
 *                                    assumed typo; using "review_text" throughout)
 *   is_verified_purchase BOOLEAN
 *   is_approved          BOOLEAN  DEFAULT true
 *   created_at           TIMESTAMPTZ
 *   updated_at           TIMESTAMPTZ
 */

export interface ProductReview {
  id:                   string;
  user_id:              string;
  product_id:           string;
  product_variant_id:   string | null;
  rating:               number;         // 1–5
  review_title:         string | null;
  review_text:          string | null;
  is_verified_purchase: boolean;
  is_approved:          boolean;
  created_at:           string;
  updated_at:           string;
}
