/**
 * File: src/types/seller.ts
 * Path: ecommerce-admin/src/types/seller.ts
 *
 * TypeScript interfaces mirroring the split seller tables.
 *
 * seller_profiles — business identity, shared/reusable across users:
 *   id, business_name, contact_name, email, phone, description,
 *   is_verified, status, created_at, updated_at
 *
 * sellers — user ↔ profile join, tracks per-user account status:
 *   id, user_id, seller_profile_id, status, created_at, updated_at
 */

export type SellerStatus = "active" | "suspended" | "pending";

/** Row in seller_profiles table — business details */
export interface SellerProfile {
  id:            string;
  business_name: string;
  contact_name:  string | null;
  email:         string | null;
  phone:         string | null;
  description:   string | null;
  is_verified:   boolean;
  status:        SellerStatus;
  created_at:    string;
  updated_at:    string;
}

/** Row in sellers table — links a user to a seller_profile */
export interface Seller {
  id:                string;
  user_id:           string;
  seller_profile_id: string;
  status:            SellerStatus;
  created_at:        string;
  updated_at:        string;
}

/** Seller row enriched with its joined profile, used in most API responses */
export interface SellerWithProfile extends Seller {
  seller_profiles: SellerProfile | null;
}
