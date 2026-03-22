/**
 * File: src/controllers/orderController.ts
 * Path: ecommerce-admin/src/controllers/orderController.ts
 *
 * Handlers for order, order_details, and payment endpoints.
 *
 * Table columns:
 *   orders       : id, user_id, amount, order_date, status, shipping_address_id,
 *                  billing_address_id, payment_id, shipment_id
 *   order_details: id, order_id, product_id, quantity, unit_price
 *   payment      : id, type, amount, payment_date, order_id, transaction_id
 *
 * Role enforcement (applied at route level):
 *   auth   — any authenticated user (controller also enforces own-data)
 *   admin  — requireRole("admin")
 *   seller — requireRole("seller")
 *
 * POST /api/orders — Places a new order by reading the caller's cart,
 *   computing line-items + total, inserting orders + order_details rows,
 *   then clearing the cart.
 */

import { Request, Response, NextFunction } from "express";
import { supabaseAdmin } from "../config/supabase";
import { AppError }      from "../middleware/errorHandler";
import { ApiResponse }   from "../types";
import { Order, OrderDetail, Payment, OrderStatus } from "../types/order";
import {
  createOrderSchema,
  updateOrderStatusSchema,
  initiatePaymentSchema,
  verifyPaymentSchema,
  refundPaymentSchema,
} from "../validators/orderValidators";

// ─────────────────────────────────────────────────────────────────────────────
// Shared helpers
// ─────────────────────────────────────────────────────────────────────────────

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function validateUuid(id: string, label = "id"): void {
  if (!UUID_RE.test(id))
    throw new AppError(`Invalid ${label} — must be a valid UUID`, 400);
}

/** Columns for a full order row including joined addresses */
const ORDER_SELECT = `
  id, user_id, amount, order_date, status,
  shipping_address_id, billing_address_id, payment_id, shipment_id,
  shipping_address:address!orders_shipping_address_id_fkey (
    id, street_address, city, state, pin_code, country, land_mark, address_type
  ),
  billing_address:address!orders_billing_address_id_fkey (
    id, street_address, city, state, pin_code, country, land_mark, address_type
  )
`.trim();

/** Columns for order_details joined with product info */
const ORDER_DETAIL_SELECT = `
  id, order_id, product_id, quantity, unit_price,
  products ( id, name, product_code, gender )
`.trim();

/** Columns for a payment row */
const PAYMENT_SELECT = `
  id, type, amount, payment_date, order_id, transaction_id
`.trim();

/**
 * Asserts the given order belongs to the caller (or caller is admin).
 * Throws 404 (not 403) to avoid leaking whether the order exists.
 */
async function assertOrderAccess(
  orderId: string,
  userId:  string,
  isAdmin: boolean
): Promise<Order> {
  const { data, error } = await supabaseAdmin
    .from("orders")
    .select(ORDER_SELECT)
    .eq("id", orderId)
    .single<Order>();

  if (error || !data)
    throw new AppError(`Order with id ${orderId} not found`, 404);

  if (!isAdmin && data.user_id !== userId)
    throw new AppError(`Order with id ${orderId} not found`, 404);

  return data;
}

function parsePage(query: Record<string, unknown>) {
  const page  = Math.max(1, parseInt(String(query.page  ?? "1"),  10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(String(query.limit ?? "20"), 10) || 20));
  return { page, limit, from: (page - 1) * limit, to: (page - 1) * limit + limit - 1 };
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/orders   — auth
// Customers see only their own orders; admins see all.
// Supports ?status= filter and pagination.
// ─────────────────────────────────────────────────────────────────────────────
export const listOrders = async (
  req:  Request,
  res:  Response<ApiResponse<unknown>>,
  next: NextFunction
): Promise<void> => {
  try {
    const { page, limit, from, to } = parsePage(req.query as Record<string, unknown>);
    const isAdmin = req.userRole?.role_name === "admin";
    const status  = req.query.status as string | undefined;

    let q = supabaseAdmin
      .from("orders")
      .select(ORDER_SELECT, { count: "exact" })
      .order("order_date", { ascending: false })
      .range(from, to);

    // Customers see only their own orders
    if (!isAdmin) q = q.eq("user_id", req.user!.id);

    if (status) {
      if (!["pending", "shipped", "delivered"].includes(status))
        throw new AppError("status must be 'pending', 'shipped', or 'delivered'", 400);
      q = q.eq("status", status);
    }

    const { data, error, count } = await q;
    if (error) throw new AppError(`Failed to fetch orders: ${error.message}`, 500);

    res.status(200).json({
      success: true,
      data: { data: data ?? [], page, limit, total: count ?? 0, hasMore: (count ?? 0) > page * limit },
    });
  } catch (err) { next(err); }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/orders/:id   — auth
// Returns an order with its line items and joined addresses.
// ─────────────────────────────────────────────────────────────────────────────
export const getOrder = async (
  req:  Request,
  res:  Response<ApiResponse<unknown>>,
  next: NextFunction
): Promise<void> => {
  try {
    const { id } = req.params;
    validateUuid(id, "order id");

    const isAdmin = req.userRole?.role_name === "admin";
    const order   = await assertOrderAccess(id, req.user!.id, isAdmin);

    // Fetch line items alongside
    const { data: items } = await supabaseAdmin
      .from("order_details")
      .select(ORDER_DETAIL_SELECT)
      .eq("order_id", id);

    res.status(200).json({ success: true, data: { ...order, items: items ?? [] } });
  } catch (err) { next(err); }
};

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/orders   — auth
//
// Places a new order from the caller's current cart.
// Flow:
//   1. Validate shipping + billing address IDs belong to the caller
//   2. Fetch all cart items for the caller
//   3. Resolve the current price for each product (cheapest active variant)
//   4. Insert the orders row (status = 'pending')
//   5. Insert order_details rows (one per cart item)
//   6. Clear the cart
// ─────────────────────────────────────────────────────────────────────────────
export const placeOrder = async (
  req:  Request,
  res:  Response<ApiResponse<unknown>>,
  next: NextFunction
): Promise<void> => {
  try {
    const userId = req.user!.id;
    const body   = createOrderSchema.parse(req.body);

    // Validate addresses exist and belong to the caller
    for (const [label, addrId] of [
      ["shipping_address_id", body.shipping_address_id],
      ["billing_address_id",  body.billing_address_id],
    ] as [string, string][]) {
      const { data: addr } = await supabaseAdmin
        .from("address")
        .select("id, user_id")
        .eq("id", addrId)
        .single<{ id: string; user_id: string }>();

      if (!addr) throw new AppError(`Address ${addrId} not found`, 404);
      if (addr.user_id !== userId)
        throw new AppError(`${label} does not belong to your account`, 403);
    }

    // Fetch cart items
    const { data: cartItems, error: cartError } = await supabaseAdmin
      .from("cart")
      .select(`
        id, product_id, quantity,
        products (
          id, name, is_active,
          product_variants ( base_price, is_active, status )
        )
      `)
      .eq("user_id", userId);

    if (cartError) throw new AppError(`Failed to read cart: ${cartError.message}`, 500);
    if (!cartItems || cartItems.length === 0)
      throw new AppError("Your cart is empty", 400);

    // Resolve unit price for each product (cheapest active variant)
    type CartRow = {
      id: string;
      product_id: string;
      quantity: number;
      products: {
        id: string;
        name: string;
        is_active: boolean;
        product_variants: { base_price: number; is_active: boolean; status: string }[];
      } | null;
    };

    const lineItems: { product_id: string; quantity: number; unit_price: number }[] = [];
    let totalAmount = 0;

    for (const item of cartItems as CartRow[]) {
      const product = item.products;
      if (!product || !product.is_active)
        throw new AppError(`Product ${item.product_id} is no longer available`, 400);

      const activeVariants = (product.product_variants ?? [])
        .filter((v) => v.is_active && v.status !== "archived");
      if (activeVariants.length === 0)
        throw new AppError(`No active variants found for product "${product.name}"`, 400);

      const unitPrice = Math.min(...activeVariants.map((v) => v.base_price));
      lineItems.push({ product_id: item.product_id, quantity: item.quantity, unit_price: unitPrice });
      totalAmount += unitPrice * item.quantity;
    }

    totalAmount = Math.round(totalAmount * 100) / 100;

    // Insert the order row
    const { data: newOrder, error: orderError } = await supabaseAdmin
      .from("orders")
      .insert({
        user_id:             userId,
        amount:              totalAmount,
        order_date:          new Date().toISOString(),
        status:              "pending",
        shipping_address_id: body.shipping_address_id,
        billing_address_id:  body.billing_address_id,
        payment_id:          null,
        shipment_id:         null,
      })
      .select(ORDER_SELECT)
      .single<Order>();

    if (orderError || !newOrder)
      throw new AppError(`Failed to create order: ${orderError?.message}`, 500);

    // Insert order_details rows
    const detailRows = lineItems.map((li) => ({ ...li, order_id: newOrder.id }));
    const { error: detailError } = await supabaseAdmin
      .from("order_details")
      .insert(detailRows);

    if (detailError) {
      // Rollback order row
      await supabaseAdmin.from("orders").delete().eq("id", newOrder.id);
      throw new AppError(`Failed to save order items: ${detailError.message}`, 500);
    }

    // Clear the cart
    await supabaseAdmin.from("cart").delete().eq("user_id", userId);

    res.status(201).json({
      success: true,
      message: "Order placed successfully.",
      data: { ...newOrder, items: detailRows },
    });
  } catch (err) { next(err); }
};

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /api/orders/:id/status   — admin
// Updates order status. Validates allowed transitions.
// ─────────────────────────────────────────────────────────────────────────────
export const updateOrderStatus = async (
  req:  Request,
  res:  Response<ApiResponse<unknown>>,
  next: NextFunction
): Promise<void> => {
  try {
    const { id } = req.params;
    validateUuid(id, "order id");

    const { status } = updateOrderStatusSchema.parse(req.body);

    const { data: existing, error: fetchError } = await supabaseAdmin
      .from("orders")
      .select("id, status")
      .eq("id", id)
      .single<{ id: string; status: OrderStatus }>();

    if (fetchError || !existing)
      throw new AppError(`Order with id ${id} not found`, 404);

    // Enforce transition rules: pending → shipped → delivered (no backward moves)
    const RANK: Record<OrderStatus, number> = { pending: 0, shipped: 1, delivered: 2 };
    if (RANK[status] < RANK[existing.status])
      throw new AppError(
        `Cannot move order from '${existing.status}' back to '${status}'`, 400
      );

    const { data, error } = await supabaseAdmin
      .from("orders")
      .update({ status })
      .eq("id", id)
      .select(ORDER_SELECT)
      .single<Order>();

    if (error) throw new AppError(`Failed to update order status: ${error.message}`, 500);

    res.status(200).json({ success: true, message: `Order status updated to '${status}'.`, data });
  } catch (err) { next(err); }
};

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /api/orders/:id   — auth
// Cancels an order. Only 'pending' orders can be cancelled.
// Customers can only cancel their own orders; admins can cancel any.
// ─────────────────────────────────────────────────────────────────────────────
export const cancelOrder = async (
  req:  Request,
  res:  Response<ApiResponse<unknown>>,
  next: NextFunction
): Promise<void> => {
  try {
    const { id } = req.params;
    validateUuid(id, "order id");

    const isAdmin = req.userRole?.role_name === "admin";
    const order   = await assertOrderAccess(id, req.user!.id, isAdmin);

    if (order.status !== "pending")
      throw new AppError(
        `Only pending orders can be cancelled. This order is '${order.status}'.`, 400
      );

    // Soft-cancel by updating status to a cancelled state.
    // If your order_status_enum doesn't include 'cancelled', use hard-delete instead:
    //   await supabaseAdmin.from("orders").delete().eq("id", id);
    const { error } = await supabaseAdmin
      .from("orders")
      .update({ status: "cancelled" as OrderStatus })
      .eq("id", id);

    if (error) throw new AppError(`Failed to cancel order: ${error.message}`, 500);

    res.status(200).json({ success: true, message: "Order cancelled successfully." });
  } catch (err) { next(err); }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/seller/orders   — seller
// Returns paginated orders that contain at least one product from the
// authenticated seller's catalog. Joins through order_details.
// ─────────────────────────────────────────────────────────────────────────────
export const getSellerOrders = async (
  req:  Request,
  res:  Response<ApiResponse<unknown>>,
  next: NextFunction
): Promise<void> => {
  try {
    const { page, limit, from, to } = parsePage(req.query as Record<string, unknown>);
    const userId = req.user!.id;

    // Resolve seller UUID from the sellers table
    const { data: seller } = await supabaseAdmin
      .from("sellers")
      .select("id")
      .eq("user_id", userId)
      .single<{ id: string }>();

    if (!seller) throw new AppError("No seller profile found for this account", 404);

    // Get distinct order IDs that have at least one product belonging to this seller
    const { data: sellerProducts } = await supabaseAdmin
      .from("products")
      .select("id")
      .eq("seller_id", seller.id);

    const sellerProductIds = (sellerProducts ?? []).map((p: any) => p.id);

    if (sellerProductIds.length === 0) {
      return res.status(200).json({
        success: true,
        data: { data: [], page, limit, total: 0, hasMore: false },
      }) as any;
    }

    const { data: matchingDetails } = await supabaseAdmin
      .from("order_details")
      .select("order_id")
      .in("product_id", sellerProductIds);

    const orderIds = [...new Set((matchingDetails ?? []).map((d: any) => d.order_id))];

    if (orderIds.length === 0) {
      return res.status(200).json({
        success: true,
        data: { data: [], page, limit, total: 0, hasMore: false },
      }) as any;
    }

    const { data, error, count } = await supabaseAdmin
      .from("orders")
      .select(ORDER_SELECT, { count: "exact" })
      .in("id", orderIds)
      .order("order_date", { ascending: false })
      .range(from, to);

    if (error) throw new AppError(`Failed to fetch seller orders: ${error.message}`, 500);

    res.status(200).json({
      success: true,
      data: { data: data ?? [], page, limit, total: count ?? 0, hasMore: (count ?? 0) > page * limit },
    });
  } catch (err) { next(err); }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/orders/:id/items   — auth
// Returns the line items (order_details) for a specific order.
// ─────────────────────────────────────────────────────────────────────────────
export const getOrderItems = async (
  req:  Request,
  res:  Response<ApiResponse<unknown>>,
  next: NextFunction
): Promise<void> => {
  try {
    const { id } = req.params;
    validateUuid(id, "order id");

    const isAdmin = req.userRole?.role_name === "admin";
    await assertOrderAccess(id, req.user!.id, isAdmin);

    const { data, error } = await supabaseAdmin
      .from("order_details")
      .select(ORDER_DETAIL_SELECT)
      .eq("order_id", id)
      .order("id", { ascending: true });

    if (error) throw new AppError(`Failed to fetch order items: ${error.message}`, 500);

    res.status(200).json({ success: true, data: data ?? [] });
  } catch (err) { next(err); }
};

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/payments/initiate   — auth
// Creates a payment record for an order in 'pending' state.
// Only the order owner can initiate payment.
// Prevents duplicate payment initiation if one already exists.
// ─────────────────────────────────────────────────────────────────────────────
export const initiatePayment = async (
  req:  Request,
  res:  Response<ApiResponse<unknown>>,
  next: NextFunction
): Promise<void> => {
  try {
    const userId = req.user!.id;
    const body   = initiatePaymentSchema.parse(req.body);

    // Confirm the order exists and belongs to this user
    const { data: order, error: orderError } = await supabaseAdmin
      .from("orders")
      .select("id, user_id, amount, status, payment_id")
      .eq("id", body.order_id)
      .single<{ id: string; user_id: string; amount: number; status: string; payment_id: string | null }>();

    if (orderError || !order || order.user_id !== userId)
      throw new AppError("Order not found", 404);

    if (order.status !== "pending")
      throw new AppError(`Cannot initiate payment for an order with status '${order.status}'`, 400);

    if (order.payment_id)
      throw new AppError("A payment record already exists for this order. Use /payments/verify to confirm.", 409);

    // Insert payment row with null payment_date (unconfirmed)
    const { data: payment, error: paymentError } = await supabaseAdmin
      .from("payment")
      .insert({
        type:           body.type,
        amount:         order.amount,
        payment_date:   null,
        order_id:       body.order_id,
        transaction_id: null,
      })
      .select(PAYMENT_SELECT)
      .single<Payment>();

    if (paymentError || !payment)
      throw new AppError(`Failed to initiate payment: ${paymentError?.message}`, 500);

    // Link payment back to the order
    await supabaseAdmin
      .from("orders")
      .update({ payment_id: payment.id })
      .eq("id", body.order_id);

    res.status(201).json({
      success: true,
      message: "Payment initiated. Awaiting confirmation.",
      data:    payment,
    });
  } catch (err) { next(err); }
};

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/payments/verify   — public (webhook)
// Confirms a payment by setting payment_date and transaction_id.
// In production, validate the webhook_secret against an HMAC signature
// from the payment gateway before trusting this call.
// ─────────────────────────────────────────────────────────────────────────────
export const verifyPayment = async (
  req:  Request,
  res:  Response<ApiResponse<unknown>>,
  next: NextFunction
): Promise<void> => {
  try {
    const body = verifyPaymentSchema.parse(req.body);

    // Validate webhook secret if PAYMENT_WEBHOOK_SECRET env var is set
    const expectedSecret = process.env.PAYMENT_WEBHOOK_SECRET;
    if (expectedSecret && body.webhook_secret !== expectedSecret)
      throw new AppError("Invalid webhook secret", 401);

    // Confirm the payment record exists
    const { data: payment, error: fetchError } = await supabaseAdmin
      .from("payment")
      .select(PAYMENT_SELECT)
      .eq("id", body.payment_id)
      .single<Payment>();

    if (fetchError || !payment)
      throw new AppError(`Payment with id ${body.payment_id} not found`, 404);

    if (payment.transaction_id)
      throw new AppError("This payment has already been verified", 409);

    // Confirm the payment
    const { data: confirmed, error: updateError } = await supabaseAdmin
      .from("payment")
      .update({
        payment_date:   new Date().toISOString(),
        transaction_id: body.transaction_id,
      })
      .eq("id", body.payment_id)
      .select(PAYMENT_SELECT)
      .single<Payment>();

    if (updateError) throw new AppError(`Failed to confirm payment: ${updateError.message}`, 500);

    res.status(200).json({
      success: true,
      message: "Payment verified successfully.",
      data:    confirmed,
    });
  } catch (err) { next(err); }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/payments/:id   — auth
// Returns a payment record. Only the order owner or admin can access it.
// ─────────────────────────────────────────────────────────────────────────────
export const getPayment = async (
  req:  Request,
  res:  Response<ApiResponse<unknown>>,
  next: NextFunction
): Promise<void> => {
  try {
    const { id } = req.params;
    validateUuid(id, "payment id");

    const isAdmin = req.userRole?.role_name === "admin";

    const { data: payment, error } = await supabaseAdmin
      .from("payment")
      .select(PAYMENT_SELECT)
      .eq("id", id)
      .single<Payment>();

    if (error || !payment)
      throw new AppError(`Payment with id ${id} not found`, 404);

    // Non-admins: verify the payment's order belongs to them
    if (!isAdmin) {
      const { data: order } = await supabaseAdmin
        .from("orders")
        .select("user_id")
        .eq("id", payment.order_id)
        .single<{ user_id: string }>();

      if (!order || order.user_id !== req.user!.id)
        throw new AppError(`Payment with id ${id} not found`, 404);
    }

    res.status(200).json({ success: true, data: payment });
  } catch (err) { next(err); }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/orders/:id/payment   — auth
// Returns the payment associated with a specific order.
// ─────────────────────────────────────────────────────────────────────────────
export const getOrderPayment = async (
  req:  Request,
  res:  Response<ApiResponse<unknown>>,
  next: NextFunction
): Promise<void> => {
  try {
    const { id } = req.params;
    validateUuid(id, "order id");

    const isAdmin = req.userRole?.role_name === "admin";
    const order   = await assertOrderAccess(id, req.user!.id, isAdmin);

    if (!order.payment_id)
      throw new AppError(`No payment found for order ${id}`, 404);

    const { data, error } = await supabaseAdmin
      .from("payment")
      .select(PAYMENT_SELECT)
      .eq("id", order.payment_id)
      .single<Payment>();

    if (error || !data)
      throw new AppError(`Payment record not found for order ${id}`, 404);

    res.status(200).json({ success: true, data });
  } catch (err) { next(err); }
};

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/payments/:id/refund   — admin
// Marks a payment as refunded by clearing payment_date and transaction_id.
// In a real system this would call the payment gateway's refund API first.
// ─────────────────────────────────────────────────────────────────────────────
export const refundPayment = async (
  req:  Request,
  res:  Response<ApiResponse<unknown>>,
  next: NextFunction
): Promise<void> => {
  try {
    const { id } = req.params;
    validateUuid(id, "payment id");

    const body = refundPaymentSchema.parse(req.body);

    const { data: payment, error: fetchError } = await supabaseAdmin
      .from("payment")
      .select(PAYMENT_SELECT)
      .eq("id", id)
      .single<Payment>();

    if (fetchError || !payment)
      throw new AppError(`Payment with id ${id} not found`, 404);

    if (!payment.transaction_id)
      throw new AppError("Cannot refund a payment that has not been confirmed", 400);

    // In production: call payment gateway refund API here using payment.transaction_id
    // For now, record the refund by nullifying confirmation fields
    const { data: refunded, error: updateError } = await supabaseAdmin
      .from("payment")
      .update({
        payment_date:   null,
        transaction_id: `REFUNDED:${payment.transaction_id}`,
      })
      .eq("id", id)
      .select(PAYMENT_SELECT)
      .single<Payment>();

    if (updateError) throw new AppError(`Failed to process refund: ${updateError.message}`, 500);

    // Revert the associated order to 'pending' so it can be reprocessed
    await supabaseAdmin
      .from("orders")
      .update({ status: "pending", payment_id: null })
      .eq("payment_id", id);

    res.status(200).json({
      success: true,
      message: `Payment refunded${body.reason ? `: ${body.reason}` : "."}`,
      data:    refunded,
    });
  } catch (err) { next(err); }
};
