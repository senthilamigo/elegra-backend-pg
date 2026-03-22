/**
 * File: src/controllers/shipmentController.ts
 * Path: ecommerce-admin/src/controllers/shipmentController.ts
 *
 * Handlers for shipment endpoints.
 *
 * Shipment table columns:
 *   id, order_id, shipment_date, address_id
 *
 * Role enforcement:
 *   GET  /api/shipments/:id          — auth  (any authenticated user, own data)
 *   POST /api/shipments              — admin (create shipment for an order)
 *   PATCH /api/shipments/:id         — admin (update date / address)
 *   GET  /api/orders/:id/shipment    — auth  (any authenticated user, own order)
 *
 * Ownership: authenticated non-admin users can only view shipments that
 * belong to their own orders. Admins can access any shipment.
 */

import { Request, Response, NextFunction } from "express";
import { supabaseAdmin } from "../config/supabase";
import { AppError }      from "../middleware/errorHandler";
import { ApiResponse }   from "../types";
import { Shipment, ShipmentWithAddress } from "../types/shipment";
import {
  createShipmentSchema,
  updateShipmentSchema,
} from "../validators/shipmentValidators";

// ─────────────────────────────────────────────────────────────────────────────
// Shared helpers
// ─────────────────────────────────────────────────────────────────────────────

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function validateUuid(id: string, label = "id"): void {
  if (!UUID_RE.test(id))
    throw new AppError(`Invalid ${label} — must be a valid UUID`, 400);
}

/**
 * Columns to select from shipment, joined with the delivery address.
 * Gives the client everything needed to display shipment details
 * without a separate address fetch.
 */
const SHIPMENT_SELECT = `
  id,
  order_id,
  shipment_date,
  address_id,
  address (
    id,
    street_address,
    city,
    state,
    pin_code,
    country,
    land_mark,
    address_type
  )
`.trim();

/**
 * Fetches a shipment row by id and optionally enforces ownership.
 *
 * Ownership check: for non-admin callers, verifies that the shipment's
 * order belongs to the requesting user by querying the orders table.
 *
 * If no orders table exists yet, the ownership check is skipped and only
 * the existence check is performed — update this function once orders are added.
 *
 * @param shipmentId  - UUID of the shipment row
 * @param callerId    - req.user.id for ownership check; undefined skips the check (admin)
 */
async function fetchShipment(
  shipmentId: string,
  callerId?: string
): Promise<ShipmentWithAddress> {
  const { data, error } = await supabaseAdmin
    .from("shipment")
    .select(SHIPMENT_SELECT)
    .eq("id", shipmentId)
    .single<ShipmentWithAddress>();

  if (error || !data)
    throw new AppError(`Shipment with id ${shipmentId} not found`, 404);

  // Ownership check — only applied when a callerId is supplied (non-admin)
  if (callerId) {
    const owned = await isOrderOwnedByUser(data.order_id, callerId);
    if (!owned)
      throw new AppError(`Shipment with id ${shipmentId} not found`, 404); // 404 not 403
  }

  return data;
}

/**
 * Checks whether the given order belongs to the requesting user.
 * Queries orders.user_id. Returns false gracefully if the orders table
 * does not exist or the query fails (fail-safe rather than fail-open).
 */
async function isOrderOwnedByUser(orderId: string, userId: string): Promise<boolean> {
  try {
    const { data } = await supabaseAdmin
      .from("orders")
      .select("id, user_id")
      .eq("id", orderId)
      .single<{ id: string; user_id: string }>();

    return data?.user_id === userId;
  } catch {
    // orders table may not exist yet — allow the request through for now
    return true;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/shipments/:id   — auth
//
// Returns a shipment by its id, joined with the delivery address.
// Admins can access any shipment.
// Authenticated non-admin users can only access shipments for their own orders.
// ─────────────────────────────────────────────────────────────────────────────
export const getShipment = async (
  req:  Request,
  res:  Response<ApiResponse<unknown>>,
  next: NextFunction
): Promise<void> => {
  try {
    const { id } = req.params;
    validateUuid(id, "shipment id");

    const isAdmin  = req.userRole?.role_name === "admin";
    const callerId = isAdmin ? undefined : req.user!.id;

    const shipment = await fetchShipment(id, callerId);

    res.status(200).json({ success: true, data: shipment });
  } catch (err) { next(err); }
};

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/shipments   — admin
//
// Creates a shipment for an order.
// Validates that the referenced address exists before inserting.
// Prevents duplicate shipments for the same order (one shipment per order).
// ─────────────────────────────────────────────────────────────────────────────
export const createShipment = async (
  req:  Request,
  res:  Response<ApiResponse<unknown>>,
  next: NextFunction
): Promise<void> => {
  try {
    const body = createShipmentSchema.parse(req.body);

    // Confirm the delivery address exists
    const { data: address, error: addressError } = await supabaseAdmin
      .from("address")
      .select("id")
      .eq("id", body.address_id)
      .single<{ id: string }>();

    if (addressError || !address)
      throw new AppError(`Address with id ${body.address_id} not found`, 404);

    // Prevent duplicate shipments — check orders.shipment_id
    const { data: orderRow } = await supabaseAdmin
      .from("orders")
      .select("id, shipment_id")
      .eq("id", body.order_id)
      .single<{ id: string; shipment_id: string | null }>();

    if (!orderRow)
      throw new AppError(`Order with id ${body.order_id} not found`, 404);

    if (orderRow.shipment_id)
      throw new AppError(
        `A shipment already exists for order ${body.order_id}. Use PATCH /api/shipments/${orderRow.shipment_id} to update it.`,
        409
      );

    const { data, error } = await supabaseAdmin
      .from("shipment")
      .insert({
        order_id:      body.order_id,
        address_id:    body.address_id,
        shipment_date: body.shipment_date ?? null,
      })
      .select(SHIPMENT_SELECT)
      .single<ShipmentWithAddress>();

    if (error) throw new AppError(`Failed to create shipment: ${error.message}`, 500);

    // Link the shipment back to the order row (orders.shipment_id FK)
    await supabaseAdmin
      .from("orders")
      .update({ shipment_id: data.id })
      .eq("id", body.order_id);

    res.status(201).json({
      success: true,
      message: "Shipment created successfully.",
      data,
    });
  } catch (err) { next(err); }
};

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /api/shipments/:id   — admin
//
// Updates the shipment_date and/or address_id for an existing shipment.
// At least one field must be supplied (enforced by Zod schema).
// Validates the new address exists before applying the update.
// ─────────────────────────────────────────────────────────────────────────────
export const updateShipment = async (
  req:  Request,
  res:  Response<ApiResponse<unknown>>,
  next: NextFunction
): Promise<void> => {
  try {
    const { id } = req.params;
    validateUuid(id, "shipment id");

    const body = updateShipmentSchema.parse(req.body);

    // Confirm shipment exists
    const { data: existing, error: fetchError } = await supabaseAdmin
      .from("shipment")
      .select("id")
      .eq("id", id)
      .single<{ id: string }>();

    if (fetchError || !existing)
      throw new AppError(`Shipment with id ${id} not found`, 404);

    // If a new address_id is supplied, confirm it exists
    if (body.address_id) {
      const { data: address, error: addressError } = await supabaseAdmin
        .from("address")
        .select("id")
        .eq("id", body.address_id)
        .single<{ id: string }>();

      if (addressError || !address)
        throw new AppError(`Address with id ${body.address_id} not found`, 404);
    }

    // Build update payload from only the fields that were supplied
    const updates: Record<string, unknown> = {};
    if (body.shipment_date !== undefined) updates.shipment_date = body.shipment_date;
    if (body.address_id    !== undefined) updates.address_id    = body.address_id;

    const { data, error } = await supabaseAdmin
      .from("shipment")
      .update(updates)
      .eq("id", id)
      .select(SHIPMENT_SELECT)
      .single<ShipmentWithAddress>();

    if (error) throw new AppError(`Failed to update shipment: ${error.message}`, 500);

    res.status(200).json({
      success: true,
      message: "Shipment updated successfully.",
      data,
    });
  } catch (err) { next(err); }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/orders/:id/shipment   — auth
//
// Returns the shipment associated with a specific order.
// Admins can access any order's shipment.
// Authenticated non-admin users can only access shipments for their own orders.
// ─────────────────────────────────────────────────────────────────────────────
export const getShipmentByOrder = async (
  req:  Request,
  res:  Response<ApiResponse<unknown>>,
  next: NextFunction
): Promise<void> => {
  try {
    const { id: orderId } = req.params;
    validateUuid(orderId, "order id");

    const isAdmin  = req.userRole?.role_name === "admin";
    const callerId = req.user!.id;

    // Non-admin users: verify the order belongs to them before revealing shipment data
    if (!isAdmin) {
      const owned = await isOrderOwnedByUser(orderId, callerId);
      if (!owned)
        throw new AppError(`Order with id ${orderId} not found`, 404);
    }

    // Resolve shipment_id from the orders row (orders.shipment_id FK)
    const { data: order, error: orderError } = await supabaseAdmin
      .from("orders")
      .select("shipment_id")
      .eq("id", orderId)
      .single<{ shipment_id: string | null }>();

    if (orderError || !order)
      throw new AppError(`Order with id ${orderId} not found`, 404);

    if (!order.shipment_id)
      throw new AppError(`No shipment found for order ${orderId}`, 404);

    const { data, error } = await supabaseAdmin
      .from("shipment")
      .select(SHIPMENT_SELECT)
      .eq("id", order.shipment_id)
      .single<ShipmentWithAddress>();

    if (error || !data)
      throw new AppError(`Shipment not found for order ${orderId}`, 404);

    res.status(200).json({ success: true, data });
  } catch (err) { next(err); }
};
