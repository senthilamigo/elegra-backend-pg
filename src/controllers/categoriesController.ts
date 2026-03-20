import { Request, Response, NextFunction } from "express";
import { supabaseAdmin } from "../config/supabase";
import { AppError }      from "../middleware/errorHandler";
import { ApiResponse, Category } from "../types";
import {
  createCategorySchema,
  updateCategorySchema,
  CreateCategoryInput,
  UpdateCategoryInput,
} from "../validators";

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Columns selected for every category query */
const CAT_SELECT = "id, category_name, parent_category_id, is_active, created_at";

/**
 * Parses and validates a numeric category id from a route param string.
 * categories.id is bigint — stored and compared as a JS number.
 */
function parseCategoryId(raw: string, label = "category id"): number {
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) {
    throw new AppError(`Invalid ${label} — must be a positive integer`, 400);
  }
  return id;
}

/**
 * Builds a tree from a flat category list.
 * Each node gets a `children` array containing its direct sub-categories.
 * Root nodes (parent_category_id === null) are returned as the top-level array.
 */
type CategoryNode = Category & { children: CategoryNode[] };

function buildTree(rows: Category[]): CategoryNode[] {
  const map = new Map<number, CategoryNode>();

  // First pass — index every row
  rows.forEach((r) => map.set(Number(r.id), { ...r, children: [] }));

  const roots: CategoryNode[] = [];

  // Second pass — attach children to their parent
  map.forEach((node) => {
    const parentId = node.parent_category_id ? Number(node.parent_category_id) : null;
    if (parentId !== null && map.has(parentId)) {
      map.get(parentId)!.children.push(node);
    } else {
      roots.push(node);
    }
  });

  return roots;
}

/**
 * Checks for a circular ancestor chain when re-parenting a category.
 * Walks up the parent chain from `proposedParentId` — if it ever reaches
 * `categoryId` the move would create a cycle.
 */
async function wouldCreateCycle(categoryId: number, proposedParentId: number): Promise<boolean> {
  let currentId: number | null = proposedParentId;

  while (currentId !== null) {
    if (currentId === categoryId) return true;

    const { data: row } = await supabaseAdmin
      .from("category")
      .select("parent_category_id")
      .eq("id", currentId)
      .single<{ parent_category_id: number | null }>();

    // Explicitly typed assignment — no implicit-any chain back to currentId
    const parentId: number | null = row?.parent_category_id
      ? Number(row.parent_category_id)
      : null;

    currentId = parentId;
  }

  return false;
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/categories   — public
//
// Returns all ACTIVE categories as a nested tree.
// Inactive categories are excluded so the public storefront sees only
// visible categories.
// ─────────────────────────────────────────────────────────────────────────────
export const listCategories = async (
  req:  Request,
  res:  Response<ApiResponse<unknown>>,
  next: NextFunction
): Promise<void> => {
  try {
    const { data, error } = await supabaseAdmin
      .from("category")
      .select(CAT_SELECT)
      .eq("is_active", true)
      .order("category_name", { ascending: true });

    if (error) throw new AppError(`Failed to fetch categories: ${error.message}`, 500);

    const tree = buildTree((data ?? []) as Category[]);

    res.status(200).json({
      success: true,
      data:    tree,
    });
  } catch (err) {
    next(err);
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/categories/:id   — public
//
// Returns a single active category plus its direct and nested sub-categories.
// Returns 404 if the category does not exist or is inactive.
// ─────────────────────────────────────────────────────────────────────────────
export const getCategoryById = async (
  req:  Request,
  res:  Response<ApiResponse<unknown>>,
  next: NextFunction
): Promise<void> => {
  try {
    const id = parseCategoryId(req.params.id);

    // Fetch the target category
    const { data: root, error: rootError } = await supabaseAdmin
      .from("category")
      .select(CAT_SELECT)
      .eq("id", id)
      .eq("is_active", true)
      .single<Category>();

    if (rootError || !root) {
      throw new AppError(`Category with id ${id} not found`, 404);
    }

    // Fetch all active categories and build a full tree, then locate this node
    // so we return it with all its nested descendants attached.
    const { data: all, error: allError } = await supabaseAdmin
      .from("category")
      .select(CAT_SELECT)
      .eq("is_active", true)
      .order("category_name", { ascending: true });

    if (allError) throw new AppError(`Failed to fetch sub-categories: ${allError.message}`, 500);

    const fullTree = buildTree((all ?? []) as Category[]);

    // Walk the tree to find the node matching this id
    function findNode(nodes: CategoryNode[]): CategoryNode | null {
      for (const n of nodes) {
        if (Number(n.id) === id) return n;
        const found = findNode(n.children);
        if (found) return found;
      }
      return null;
    }

    const node = findNode(fullTree);

    res.status(200).json({
      success: true,
      data:    node ?? { ...root, children: [] },
    });
  } catch (err) {
    next(err);
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/categories   — admin
//
// Creates a new category.
// Validates that the parent exists (if supplied).
// New categories are active by default.
// ─────────────────────────────────────────────────────────────────────────────
export const createCategory = async (
  req:  Request,
  res:  Response<ApiResponse<unknown>>,
  next: NextFunction
): Promise<void> => {
  try {
    const input: CreateCategoryInput = createCategorySchema.parse(req.body);

    // Validate parent exists if supplied
    if (input.parent_category_id) {
      const { data: parent } = await supabaseAdmin
        .from("category")
        .select("id")
        .eq("id", input.parent_category_id)
        .single<{ id: number }>();

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
      .select(CAT_SELECT)
      .single<Category>();

    if (error || !data) {
      throw new AppError(`Failed to create category: ${error?.message}`, 500);
    }

    res.status(201).json({
      success: true,
      message: "Category created successfully.",
      data,
    });
  } catch (err) {
    next(err);
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// PUT /api/categories/:id   — admin
//
// Updates category_name and/or parent_category_id.
// Blocks self-parenting and circular ancestor chains.
// ─────────────────────────────────────────────────────────────────────────────
export const updateCategory = async (
  req:  Request,
  res:  Response<ApiResponse<unknown>>,
  next: NextFunction
): Promise<void> => {
  try {
    const id = parseCategoryId(req.params.id);

    // Re-use the existing updateCategorySchema — inject id so validation runs
    const input: UpdateCategoryInput = updateCategorySchema.parse({ ...req.body, id });
    const { id: _id, ...updateData } = input;

    // Confirm the category exists
    const { data: existing } = await supabaseAdmin
      .from("category")
      .select("id, parent_category_id")
      .eq("id", id)
      .single<{ id: number; parent_category_id: number | null }>();

    if (!existing) throw new AppError(`Category with id ${id} not found`, 404);

    // Guard: cannot be its own parent
    if (input.parent_category_id && Number(input.parent_category_id) === id) {
      throw new AppError("A category cannot be its own parent.", 400);
    }

    // Guard: moving this category under one of its own descendants would create a cycle
    if (input.parent_category_id) {
      const { data: parent } = await supabaseAdmin
        .from("category")
        .select("id")
        .eq("id", input.parent_category_id)
        .single<{ id: number }>();

      if (!parent) {
        throw new AppError(
          `Parent category with id ${input.parent_category_id} not found`,
          404
        );
      }

      const cycle = await wouldCreateCycle(id, Number(input.parent_category_id));
      if (cycle) {
        throw new AppError(
          "Cannot re-parent: the proposed parent is a descendant of this category.",
          400
        );
      }
    }

    const { data, error } = await supabaseAdmin
      .from("category")
      .update(updateData)
      .eq("id", id)
      .select(CAT_SELECT)
      .single<Category>();

    if (error) throw new AppError(`Failed to update category: ${error.message}`, 500);

    res.status(200).json({
      success: true,
      message: "Category updated successfully.",
      data,
    });
  } catch (err) {
    next(err);
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /api/categories/:id/toggle   — admin
//
// Toggles the is_active flag between true and false.
// When a parent category is deactivated its children are NOT automatically
// deactivated — that is a deliberate choice left to the admin.
// ─────────────────────────────────────────────────────────────────────────────
export const toggleCategoryStatus = async (
  req:  Request,
  res:  Response<ApiResponse<unknown>>,
  next: NextFunction
): Promise<void> => {
  try {
    const id = parseCategoryId(req.params.id);

    // Fetch current is_active value
    const { data: existing, error: fetchError } = await supabaseAdmin
      .from("category")
      .select("id, is_active")
      .eq("id", id)
      .single<{ id: number; is_active: boolean }>();

    if (fetchError || !existing) {
      throw new AppError(`Category with id ${id} not found`, 404);
    }

    const newStatus = !existing.is_active;

    const { data, error } = await supabaseAdmin
      .from("category")
      .update({ is_active: newStatus })
      .eq("id", id)
      .select(CAT_SELECT)
      .single<Category>();

    if (error) throw new AppError(`Failed to toggle category status: ${error.message}`, 500);

    res.status(200).json({
      success: true,
      message: `Category ${newStatus ? "activated" : "deactivated"} successfully.`,
      data,
    });
  } catch (err) {
    next(err);
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /api/categories/:id   — admin
//
// Permanently deletes a category.
// Blocked if any products are assigned to it or if sub-categories exist.
// ─────────────────────────────────────────────────────────────────────────────
export const deleteCategory = async (
  req:  Request,
  res:  Response<ApiResponse<unknown>>,
  next: NextFunction
): Promise<void> => {
  try {
    const id = parseCategoryId(req.params.id);

    // Confirm the category exists
    const { data: existing } = await supabaseAdmin
      .from("category")
      .select("id")
      .eq("id", id)
      .single<{ id: number }>();

    if (!existing) throw new AppError(`Category with id ${id} not found`, 404);

    // Block if products reference this category
    const { count: productCount } = await supabaseAdmin
      .from("products")
      .select("id", { count: "exact", head: true })
      .eq("category_id", id);

    if (productCount && productCount > 0) {
      throw new AppError(
        `Cannot delete: ${productCount} product(s) are assigned to this category. Reassign or remove them first.`,
        400
      );
    }

    // Block if sub-categories exist
    const { count: childCount } = await supabaseAdmin
      .from("category")
      .select("id", { count: "exact", head: true })
      .eq("parent_category_id", id);

    if (childCount && childCount > 0) {
      throw new AppError(
        `Cannot delete: this category has ${childCount} sub-categorie(s). Delete or reassign them first.`,
        400
      );
    }

    const { error } = await supabaseAdmin
      .from("category")
      .delete()
      .eq("id", id);

    if (error) throw new AppError(`Failed to delete category: ${error.message}`, 500);

    res.status(200).json({
      success: true,
      message: "Category deleted successfully.",
    });
  } catch (err) {
    next(err);
  }
};
