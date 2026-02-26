import { Request, Response, NextFunction } from "express";
import { supabaseAdmin } from "../config/supabase";
import { AppError } from "../middleware/errorHandler";
import {
  createProductSchema,
  updateProductSchema,
  paginationSchema,
  CreateProductInput,
  UpdateProductInput,
} from "../validators";
import { ApiResponse, PaginatedResponse, ProductWithVariants } from "../types";

const PRODUCTS_PER_PAGE = 20;

// ─────────────────────────────────────────────
// GET /api/products
// Returns paginated products with their variants
// ─────────────────────────────────────────────
export const getProducts = async (
  req: Request,
  res: Response<ApiResponse<PaginatedResponse<ProductWithVariants>>>,
  next: NextFunction
): Promise<void> => {
  try {
    const { page, limit } = paginationSchema.parse(req.query);
    const offset = (page - 1) * PRODUCTS_PER_PAGE;

    // Fetch paginated products
    const { data: products, error, count } = await supabaseAdmin
      .from("products")
      .select("*, product_variants(*)", { count: "exact" })
      .eq("is_active", true)
      .order("created_at", { ascending: false })
      .range(offset, offset + PRODUCTS_PER_PAGE - 1);

    if (error) throw new AppError(`Database error: ${error.message}`, 500);

    const total = count ?? 0;
    const hasMore = offset + PRODUCTS_PER_PAGE < total;

    res.status(200).json({
      success: true,
      data: {
        data: (products ?? []).map((p) => ({
          ...p,
          variants: p.product_variants ?? [],
        })),
        page,
        limit: PRODUCTS_PER_PAGE,
        total,
        hasMore,
      },
    });
  } catch (err) {
    next(err);
  }
};

// ─────────────────────────────────────────────
// POST /api/product/add
// Inserts into products then product_variants
// Uses a transaction-like pattern: if variants fail, we delete the product
// ─────────────────────────────────────────────
export const addProduct = async (
  req: Request,
  res: Response<ApiResponse<{ product_id: number }>>,
  next: NextFunction
): Promise<void> => {
  try {
    const input: CreateProductInput = createProductSchema.parse(req.body);
    const { variants, ...productData } = input;

    // Insert the product row
    const { data: newProduct, error: productError } = await supabaseAdmin
      .from("products")
      .insert(productData)
      .select()
      .single();

    if (productError || !newProduct) {
      throw new AppError(`Failed to create product: ${productError?.message}`, 500);
    }

    // Insert all variants linked to the new product
    const variantRows = variants.map((v) => ({
      ...v,
      product_id: newProduct.id,
    }));

    const { error: variantError } = await supabaseAdmin
      .from("product_variants")
      .insert(variantRows);

    if (variantError) {
      // Rollback: delete the orphaned product row
      await supabaseAdmin.from("products").delete().eq("id", newProduct.id);
      throw new AppError(`Failed to create variants: ${variantError.message}`, 500);
    }

    res.status(201).json({
      success: true,
      message: "Product created successfully",
      data: { product_id: newProduct.id },
    });
  } catch (err) {
    next(err);
  }
};

// ─────────────────────────────────────────────
// PUT /api/product/update
// Updates product fields and upserts variants
// ─────────────────────────────────────────────
export const updateProduct = async (
  req: Request,
  res: Response<ApiResponse>,
  next: NextFunction
): Promise<void> => {
  try {
    const input: UpdateProductInput = updateProductSchema.parse(req.body);
    const { id, variants, ...productData } = input;

    // Verify the product exists before updating
    const { data: existing, error: fetchError } = await supabaseAdmin
      .from("products")
      .select("id")
      .eq("id", id)
      .single();

    if (fetchError || !existing) {
      throw new AppError(`Product with id ${id} not found`, 404);
    }

    // Update product fields (only provided fields)
    if (Object.keys(productData).length > 0) {
      const { error: updateError } = await supabaseAdmin
        .from("products")
        .update(productData)
        .eq("id", id);

      if (updateError) throw new AppError(`Failed to update product: ${updateError.message}`, 500);
    }

    // Upsert variants if provided
    // Variants with an id are updated; without an id they are inserted
    if (variants && variants.length > 0) {
      const variantRows = variants.map((v) => ({ ...v, product_id: id }));

      const { error: variantError } = await supabaseAdmin
        .from("product_variants")
        .upsert(variantRows, { onConflict: "id" });

      if (variantError) {
        throw new AppError(`Failed to update variants: ${variantError.message}`, 500);
      }
    }

    res.status(200).json({ success: true, message: "Product updated successfully" });
  } catch (err) {
    next(err);
  }
};

// ─────────────────────────────────────────────
// DELETE /api/product/remove/:id
// Deletes variants first (FK constraint), then product
// ─────────────────────────────────────────────
export const deleteProduct = async (
  req: Request,
  res: Response<ApiResponse>,
  next: NextFunction
): Promise<void> => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      throw new AppError("Invalid product id", 400);
    }

    // Verify product exists
    const { data: existing } = await supabaseAdmin
      .from("products")
      .select("id")
      .eq("id", id)
      .single();

    if (!existing) throw new AppError(`Product with id ${id} not found`, 404);

    // Delete variants first to satisfy FK constraint
    const { error: variantDeleteError } = await supabaseAdmin
      .from("product_variants")
      .delete()
      .eq("product_id", id);

    if (variantDeleteError) {
      throw new AppError(`Failed to delete variants: ${variantDeleteError.message}`, 500);
    }

    const { error: productDeleteError } = await supabaseAdmin
      .from("products")
      .delete()
      .eq("id", id);

    if (productDeleteError) {
      throw new AppError(`Failed to delete product: ${productDeleteError.message}`, 500);
    }

    res.status(200).json({ success: true, message: "Product deleted successfully" });
  } catch (err) {
    next(err);
  }
};
