import { Request, Response, NextFunction } from "express";
import { supabaseAdmin }   from "../config/supabase";
import { AppError }        from "../middleware/errorHandler";
import { ApiResponse }     from "../types";
import { Address }         from "../types/address";
import {
  createAddressSchema,
  updateAddressSchema,
} from "../validators/addressValidators";

// ─────────────────────────────────────────────────────────────────────────────
// Shared helpers
// ─────────────────────────────────────────────────────────────────────────────

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function validateUuid(id: string, label = "id"): void {
  if (!UUID_RE.test(id)) {
    throw new AppError(`Invalid ${label} — must be a valid UUID`, 400);
  }
}

/** All columns to select — keeps the select string consistent across handlers */
const ADDRESS_SELECT = [
  "id",
  "user_id",
  "street_address",
  "city",
  "state",
  "pin_code",
  "country",
  "land_mark",
  "address_type",
  "created_at",
].join(", ");

/**
 * Asserts that an address exists AND belongs to the requesting user.
 * Throws 404 if not found, 403 if owned by a different user.
 * Returns the address row on success so callers can reuse it.
 */
async function fetchOwnAddress(addressId: string, userId: string): Promise<Address> {
  const { data, error } = await supabaseAdmin
    .from("address")
    .select(ADDRESS_SELECT)
    .eq("id", addressId)
    .single<Address>();

  if (error || !data) {
    throw new AppError(`Address ${addressId} not found`, 404);
  }

  if (data.user_id !== userId) {
    // Return 404 rather than 403 to avoid leaking whether the address exists
    throw new AppError(`Address ${addressId} not found`, 404);
  }

  return data;
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/addresses   — auth
//
// Returns all addresses that belong to the authenticated user, ordered by
// created_at descending (newest first).
// Supports optional ?type=billing|shipping filter.
// ─────────────────────────────────────────────────────────────────────────────
export const listAddresses = async (
  req:  Request,
  res:  Response<ApiResponse<unknown>>,
  next: NextFunction
): Promise<void> => {
  try {
    const userId    = req.user!.id;
    const typeParam = req.query.type as string | undefined;

    let query = supabaseAdmin
      .from("address")
      .select(ADDRESS_SELECT)
      .eq("user_id", userId)
      .order("created_at", { ascending: false });

    // Optional filter by address_type
    if (typeParam) {
      if (typeParam !== "billing" && typeParam !== "shipping") {
        throw new AppError("Query param 'type' must be 'billing' or 'shipping'", 400);
      }
      query = query.eq("address_type", typeParam);
    }

    const { data, error } = await query.returns<Address[]>();

    if (error) throw new AppError(`Failed to fetch addresses: ${error.message}`, 500);

    res.status(200).json({
      success: true,
      data:    data ?? [],
    });
  } catch (err) {
    next(err);
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/addresses   — auth
//
// Creates a new address row owned by the authenticated user.
// user_id is taken from the verified JWT — never from the request body.
// ─────────────────────────────────────────────────────────────────────────────
export const createAddress = async (
  req:  Request,
  res:  Response<ApiResponse<unknown>>,
  next: NextFunction
): Promise<void> => {
  try {
    const userId = req.user!.id;
    const body   = createAddressSchema.parse(req.body);

    const { data, error } = await supabaseAdmin
      .from("address")
      .insert({
        user_id:        userId,
        street_address: body.street_address,
        city:           body.city,
        state:          body.state,
        pin_code:       body.pin_code,
        country:        body.country,
        land_mark:      body.land_mark ?? null,
        address_type:   body.address_type,
      })
      .select(ADDRESS_SELECT)
      .single<Address>();

    if (error) throw new AppError(`Failed to create address: ${error.message}`, 500);

    res.status(201).json({
      success: true,
      message: "Address created successfully.",
      data,
    });
  } catch (err) {
    next(err);
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// PUT /api/addresses/:id   — auth
//
// Updates any subset of fields on an address that belongs to the caller.
// user_id is never updatable — an address always stays owned by its creator.
// ─────────────────────────────────────────────────────────────────────────────
export const updateAddress = async (
  req:  Request,
  res:  Response<ApiResponse<unknown>>,
  next: NextFunction
): Promise<void> => {
  try {
    const { id } = req.params;
    validateUuid(id, "address id");

    const userId = req.user!.id;
    const body   = updateAddressSchema.parse(req.body);

    // Confirm the address exists and belongs to this user before updating
    await fetchOwnAddress(id, userId);

    // Build the update payload — only include fields that were explicitly sent.
    // land_mark: null is allowed (clears the field); land_mark: undefined skips it.
    const updates: Record<string, unknown> = {};
    if (body.street_address !== undefined) updates.street_address = body.street_address;
    if (body.city           !== undefined) updates.city           = body.city;
    if (body.state          !== undefined) updates.state          = body.state;
    if (body.pin_code       !== undefined) updates.pin_code       = body.pin_code;
    if (body.country        !== undefined) updates.country        = body.country;
    if (body.address_type   !== undefined) updates.address_type   = body.address_type;
    if (body.land_mark      !== undefined) updates.land_mark      = body.land_mark ?? null;

    const { data, error } = await supabaseAdmin
      .from("address")
      .update(updates)
      .eq("id", id)
      .select(ADDRESS_SELECT)
      .single<Address>();

    if (error) throw new AppError(`Failed to update address: ${error.message}`, 500);

    res.status(200).json({
      success: true,
      message: "Address updated successfully.",
      data,
    });
  } catch (err) {
    next(err);
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /api/addresses/:id   — auth
//
// Permanently deletes an address that belongs to the authenticated user.
// ─────────────────────────────────────────────────────────────────────────────
export const deleteAddress = async (
  req:  Request,
  res:  Response<ApiResponse<unknown>>,
  next: NextFunction
): Promise<void> => {
  try {
    const { id } = req.params;
    validateUuid(id, "address id");

    const userId = req.user!.id;

    // Confirm ownership before deleting
    await fetchOwnAddress(id, userId);

    const { error } = await supabaseAdmin
      .from("address")
      .delete()
      .eq("id", id);

    if (error) throw new AppError(`Failed to delete address: ${error.message}`, 500);

    res.status(200).json({
      success: true,
      message: "Address deleted successfully.",
    });
  } catch (err) {
    next(err);
  }
};
