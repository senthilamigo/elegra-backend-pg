// ─────────────────────────────────────────────
// Address types — mirrors the `address` table
// ─────────────────────────────────────────────

export type AddressType = "billing" | "shipping";

export interface Address {
  id:             string;           // UUID PRIMARY KEY
  user_id:        string;           // UUID REFERENCES auth.users(id)
  street_address: string;
  city:           string;
  state:          string;
  pin_code:       string;
  country:        string;
  land_mark:      string | null;    // nullable
  address_type:   AddressType;      // public.address_type_enum
  created_at:     string;
}
