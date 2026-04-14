import { z } from "zod";

export const createSupplierProductSchema = z.object({
  supplier_id: z.string().uuid("supplier_id must be a valid UUID"),
  product_id: z.string().uuid("product_id must be a valid UUID"),
  cost_price: z.number().nonnegative("cost_price must be 0 or greater").optional().nullable(),
  lead_time_days: z.number().int("lead_time_days must be an integer").nonnegative("lead_time_days must be 0 or greater").optional().nullable(),
});

export const updateSupplierProductSchema = z
  .object({
    cost_price: z.number().nonnegative("cost_price must be 0 or greater").optional().nullable(),
    lead_time_days: z.number().int("lead_time_days must be an integer").nonnegative("lead_time_days must be 0 or greater").optional().nullable(),
  })
  .refine((data) => data.cost_price !== undefined || data.lead_time_days !== undefined, {
    message: "At least one of cost_price or lead_time_days must be provided",
  });
