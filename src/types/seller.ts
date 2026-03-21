// ─────────────────────────────────────────────
// sellers table
//   id             UUID PRIMARY KEY
//   user_id        UUID REFERENCES auth.users(id)
//   business_name  VARCHAR(255)
//   contact_name   VARCHAR(255)
//   email          VARCHAR(255)
//   phone          VARCHAR(20)
//   description    TEXT        (nullable)
//   is_verified    BOOLEAN
//   status         VARCHAR(50)  ('active' | 'suspended' | 'pending')
//   created_at     TIMESTAMPTZ
//   updated_at     TIMESTAMPTZ
// ─────────────────────────────────────────────

export type SellerStatus = "active" | "suspended" | "pending";

export interface Seller {
  id:            string;
  user_id:       string;
  business_name: string;
  contact_name:  string;
  email:         string;
  phone:         string;
  description:   string | null;
  is_verified:   boolean;
  status:        SellerStatus;
  created_at:    string;
  updated_at:    string;
}
