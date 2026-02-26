import { Request, Response, NextFunction } from "express";
import { supabaseAdmin } from "../config/supabase";
import { AppError } from "../middleware/errorHandler";
import {
  createCategorySchema,
  updateCategorySchema,
  CreateCategoryInput,
  UpdateCategoryInput,
} from "../validators";
import { ApiResponse, Category } from "../types";

// ─────────────────────────────────────────────
// GET /api/category
// Returns all categories (flat list with parent_category_id for tree building on frontend)
// ─────────────────────────────────────────────
export const getCategories = async (
  req: Request,
  res: Response<ApiResponse<Category[]>>,
  next: NextFunction
): Promise<void> => {
  try {
    const { data, error } = await supabaseAdmin
      .from("category")
      .select("*")
      .order("category_name", { ascending: true });

    if (error) throw new AppError(`Database error: ${error.message}`, 500);

    res.status(200).json({ success: true, data: data ?? [] });
  } catch (err) {
    next(err);
  }
};

// ─────────────────────────────────────────────
// POST /api/category/add
// ─────────────────────────────────────────────
export const addCategory = async (
  req: Request,
  res: Response<ApiResponse<{ category_id: number }>>,
  next: NextFunction
): Promise<void> => {
  try {
    const input: CreateCategoryInput = createCategorySchema.parse(req.body);

    // Validate parent exists if provided
    if (input.parent_category_id) {
      const { data: parent } = await supabaseAdmin
        .from("category")
        .select("id")
        .eq("id", input.parent_category_id)
        .single();

      if (!parent) {
        throw new AppError(
          `Parent category with id ${input.parent_category_id} not found`,
          404
        );
      }
    }

    const { data, error } = await supabaseAdmin
      .from("category")
      .insert(input)
      .select()
      .single();

    if (error || !data) throw new AppError(`Failed to create category: ${error?.message}`, 500);

    res.status(201).json({
      success: true,
      message: "Category created successfully",
      data: { category_id: data.id },
    });
  } catch (err) {
    next(err);
  }
};

// ─────────────────────────────────────────────
// PUT /api/category/update
// ─────────────────────────────────────────────
export const updateCategory = async (
  req: Request,
  res: Response<ApiResponse>,
  next: NextFunction
): Promise<void> => {
  try {
    const input: UpdateCategoryInput = updateCategorySchema.parse(req.body);
    const { id, ...updateData } = input;

    // Verify the category exists
    const { data: existing } = await supabaseAdmin
      .from("category")
      .select("id")
      .eq("id", id)
      .single();

    if (!existing) throw new AppError(`Category with id ${id} not found`, 404);

    // Prevent circular self-reference
    if (input.parent_category_id === id) {
      throw new AppError("A category cannot be its own parent", 400);
    }

    // Validate new parent exists if provided
    if (input.parent_category_id) {
      const { data: parent } = await supabaseAdmin
        .from("category")
        .select("id")
        .eq("id", input.parent_category_id)
        .single();

      if (!parent) {
        throw new AppError(
          `Parent category with id ${input.parent_category_id} not found`,
          404
        );
      }
    }

    const { error } = await supabaseAdmin
      .from("category")
      .update(updateData)
      .eq("id", id);

    if (error) throw new AppError(`Failed to update category: ${error.message}`, 500);

    res.status(200).json({ success: true, message: "Category updated successfully" });
  } catch (err) {
    next(err);
  }
};

// ─────────────────────────────────────────────
// DELETE /api/category/remove/:id
// Prevents deletion if products reference this category
// ─────────────────────────────────────────────
export const deleteCategory = async (
  req: Request,
  res: Response<ApiResponse>,
  next: NextFunction
): Promise<void> => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      throw new AppError("Invalid category id", 400);
    }

    // Verify the category exists
    const { data: existing } = await supabaseAdmin
      .from("category")
      .select("id")
      .eq("id", id)
      .single();

    if (!existing) throw new AppError(`Category with id ${id} not found`, 404);

    // Block deletion if products are using this category (referential integrity guard)
    const { count: productCount } = await supabaseAdmin
      .from("products")
      .select("id", { count: "exact", head: true })
      .eq("category_id", id);

    if (productCount && productCount > 0) {
      throw new AppError(
        `Cannot delete category: ${productCount} product(s) are assigned to it. Reassign or remove them first.`,
        400
      );
    }

    // Block deletion if sub-categories exist
    const { count: childCount } = await supabaseAdmin
      .from("category")
      .select("id", { count: "exact", head: true })
      .eq("parent_category_id", id);

    if (childCount && childCount > 0) {
      throw new AppError(
        `Cannot delete category: it has ${childCount} sub-categorie(s). Delete or reassign them first.`,
        400
      );
    }

    const { error } = await supabaseAdmin.from("category").delete().eq("id", id);

    if (error) throw new AppError(`Failed to delete category: ${error.message}`, 500);

    res.status(200).json({ success: true, message: "Category deleted successfully" });
  } catch (err) {
    next(err);
  }
};
