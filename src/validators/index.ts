import { z } from "zod";

// ─────────────────────────────────────────────
// Shared / reusable schemas
// ─────────────────────────────────────────────

const bigintIdSchema = z.coerce.number().int().positive();

// ─────────────────────────────────────────────
// Product Variant schemas
// ─────────────────────────────────────────────

const variantBaseSchema = z.object({
  sku: z.string().min(1).max(100),
  color: z.string().max(50).optional().nullable(),
  size: z.string().max(50).optional().nullable(),
  material: z.string().max(100).optional().nullable(),
  attributes: z.record(z.unknown()).optional().nullable(),
  base_price: z.number().positive("Price must be positive"),
  is_active: z.boolean().default(true),
  image_url_primary: z.string().url().optional().nullable(),
  images_urls: z.array(z.string().url()).optional().nullable(),
  // status options: draft | active | archived
  status: z.enum(["draft", "active", "archived"]).default("active"),
  stock: z.number().int().min(0).default(0),
  discount_type: z.enum(["percentage", "fixed"]).optional().nullable(),
  discount_value: z.number().min(0).optional().nullable(),
});

export const createVariantSchema = variantBaseSchema;

export const updateVariantSchema = variantBaseSchema.partial().extend({
  id: bigintIdSchema.optional(), // present when updating an existing variant
});

// ─────────────────────────────────────────────
// Product schemas
// ─────────────────────────────────────────────

const productBaseSchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().max(5000).optional().default(""),
  category_id: bigintIdSchema,
  gender: z.enum(["male", "female", "unisex", "kids", "other"]).default("unisex"),
  is_active: z.boolean().default(true),
  product_code: z.string().min(1).max(100),
  seller_id: bigintIdSchema,
});

export const createProductSchema = productBaseSchema.extend({
  variants: z.array(createVariantSchema).min(1, "At least one variant is required"),
});

export const updateProductSchema = productBaseSchema.partial().extend({
  id: bigintIdSchema,
  variants: z.array(updateVariantSchema).optional(),
});

// ─────────────────────────────────────────────
// Category schemas
// ─────────────────────────────────────────────

const categoryBaseSchema = z.object({
  category_name: z.string().min(1).max(150),
  parent_category_id: bigintIdSchema.optional().nullable(),
  is_active: z.boolean().default(true),
});

export const createCategorySchema = categoryBaseSchema;

export const updateCategorySchema = categoryBaseSchema.partial().extend({
  id: bigintIdSchema,
});

// ─────────────────────────────────────────────
// Query param schemas
// ─────────────────────────────────────────────

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  // Fixed at 20 per requirements; included for transparency
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

// ─────────────────────────────────────────────
// Inferred TypeScript types from schemas
// ─────────────────────────────────────────────

export type CreateProductInput = z.infer<typeof createProductSchema>;
export type UpdateProductInput = z.infer<typeof updateProductSchema>;
export type CreateCategoryInput = z.infer<typeof createCategorySchema>;
export type UpdateCategoryInput = z.infer<typeof updateCategorySchema>;
export type PaginationInput = z.infer<typeof paginationSchema>;
