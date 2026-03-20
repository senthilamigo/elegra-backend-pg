import { z } from "zod";

// ─────────────────────────────────────────────
// address table
//   id             UUID PRIMARY KEY
//   user_id        UUID REFERENCES auth.users(id)
//   street_address TEXT
//   city           VARCHAR(100)
//   state          VARCHAR(100)
//   pin_code       VARCHAR(20)
//   country        VARCHAR(100)
//   land_mark      TEXT            (nullable — no NOT NULL constraint)
//   address_type   address_type_enum  ('billing' | 'shipping')
//   created_at     TIMESTAMP
// ─────────────────────────────────────────────

const addressTypeEnum = z.enum(["billing", "shipping"], {
  errorMap: () => ({ message: "address_type must be 'billing' or 'shipping'" }),
});

// ─────────────────────────────────────────────
// POST /api/addresses — all required fields
// ─────────────────────────────────────────────
export const createAddressSchema = z.object({
  street_address: z.string().min(1, "street_address is required").max(500),
  city:           z.string().min(1, "city is required").max(100),
  state:          z.string().min(1, "state is required").max(100),
  pin_code:       z.string().min(1, "pin_code is required").max(20),
  country:        z.string().min(1, "country is required").max(100),
  land_mark:      z.string().max(500).optional().nullable(),
  address_type:   addressTypeEnum,
});

// ─────────────────────────────────────────────
// PUT /api/addresses/:id — all fields optional, at least one required
// ─────────────────────────────────────────────
export const updateAddressSchema = z
  .object({
    street_address: z.string().min(1).max(500).optional(),
    city:           z.string().min(1).max(100).optional(),
    state:          z.string().min(1).max(100).optional(),
    pin_code:       z.string().min(1).max(20).optional(),
    country:        z.string().min(1).max(100).optional(),
    land_mark:      z.string().max(500).optional().nullable(),
    address_type:   addressTypeEnum.optional(),
  })
  .refine(
    (d) => Object.values(d).some((v) => v !== undefined),
    { message: "At least one field must be provided for update" }
  );

// ─────────────────────────────────────────────
// Inferred types
// ─────────────────────────────────────────────
export type CreateAddressInput = z.infer<typeof createAddressSchema>;
export type UpdateAddressInput = z.infer<typeof updateAddressSchema>;
