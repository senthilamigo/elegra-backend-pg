/**
 * File: src/controllers/adminController.ts
 * Path: ecommerce-admin/src/controllers/adminController.ts
 *
 * Admin analytics and reporting handlers.
 * All three endpoints require admin role (enforced at route level).
 *
 * Endpoints:
 *   GET /api/admin/dashboard    — KPIs: revenue, orders, users, top products
 *   GET /api/admin/sales-report — Aggregated sales with date-range filter
 *   GET /api/admin/inventory    — Low-stock variants across all sellers
 *
 * All data is read-only. Queries run via supabaseAdmin (service-role key)
 * so they bypass RLS and aggregate across all users/sellers.
 *
 * Date params (sales-report):
 *   ?from=2024-01-01  ISO date string, inclusive
 *   ?to=2024-12-31    ISO date string, inclusive
 *   Both default to the current calendar month when omitted.
 *
 * Inventory params:
 *   ?threshold=<n>   Stock level at or below which a variant is "low-stock"
 *                    Defaults to 10.
 *   ?seller_id=<uuid>  Optional — filter by a specific seller.
 */

import { Request, Response, NextFunction } from "express";
import { supabaseAdmin } from "../config/supabase";
import { AppError }      from "../middleware/errorHandler";
import { ApiResponse }   from "../types";

// ─────────────────────────────────────────────────────────────────────────────
// Shared helpers
// ─────────────────────────────────────────────────────────────────────────────

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Returns the ISO string for the first moment of the current month */
function startOfCurrentMonth(): string {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString();
}

/** Returns the ISO string for the last moment of the current month */
function endOfCurrentMonth(): string {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59, 999).toISOString();
}

/** Converts a YYYY-MM-DD date string to a start-of-day ISO string */
function toStartOfDay(dateStr: string): string {
  return new Date(`${dateStr}T00:00:00.000Z`).toISOString();
}

/** Converts a YYYY-MM-DD date string to an end-of-day ISO string */
function toEndOfDay(dateStr: string): string {
  return new Date(`${dateStr}T23:59:59.999Z`).toISOString();
}

/** Validates YYYY-MM-DD format */
function isValidDate(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(s));
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/admin/dashboard   — admin
//
// Returns the following KPIs in a single response:
//
//   revenue:
//     total_revenue          — sum of all delivered order amounts
//     revenue_this_month     — sum for the current calendar month
//     revenue_last_month     — sum for the previous calendar month
//
//   orders:
//     total_orders           — count of all orders
//     orders_this_month      — count for the current month
//     orders_by_status       — { pending, shipped, delivered } counts
//
//   users:
//     total_users            — total rows in user_role
//     new_users_this_month   — users created this month
//     users_by_role          — { admin, seller, customer } counts
//
//   top_products:
//     top 5 products by total units sold (from order_details), with name
// ─────────────────────────────────────────────────────────────────────────────
export const getDashboard = async (
  req:  Request,
  res:  Response<ApiResponse<unknown>>,
  next: NextFunction
): Promise<void> => {
  try {
    const monthStart = startOfCurrentMonth();
    const monthEnd   = endOfCurrentMonth();

    // Previous month boundaries
    const now  = new Date();
    const prevStart = new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString();
    const prevEnd   = new Date(now.getFullYear(), now.getMonth(),     0, 23, 59, 59, 999).toISOString();

    // ── Revenue ──────────────────────────────────────────────────────────────
    // All orders (delivered) — total revenue
    const { data: allDelivered } = await supabaseAdmin
      .from("orders")
      .select("amount")
      .eq("status", "delivered");

    const totalRevenue = (allDelivered ?? [])
      .reduce((s: number, o: { amount: number }) => s + Number(o.amount), 0);

    // Revenue this month
    const { data: deliveredThisMonth } = await supabaseAdmin
      .from("orders")
      .select("amount")
      .eq("status", "delivered")
      .gte("order_date", monthStart)
      .lte("order_date", monthEnd);

    const revenueThisMonth = (deliveredThisMonth ?? [])
      .reduce((s: number, o: { amount: number }) => s + Number(o.amount), 0);

    // Revenue last month
    const { data: deliveredLastMonth } = await supabaseAdmin
      .from("orders")
      .select("amount")
      .eq("status", "delivered")
      .gte("order_date", prevStart)
      .lte("order_date", prevEnd);

    const revenueLastMonth = (deliveredLastMonth ?? [])
      .reduce((s: number, o: { amount: number }) => s + Number(o.amount), 0);

    // ── Orders ───────────────────────────────────────────────────────────────
    const { count: totalOrders } = await supabaseAdmin
      .from("orders")
      .select("id", { count: "exact", head: true });

    const { count: ordersThisMonth } = await supabaseAdmin
      .from("orders")
      .select("id", { count: "exact", head: true })
      .gte("order_date", monthStart)
      .lte("order_date", monthEnd);

    // Orders by status
    const { data: allOrders } = await supabaseAdmin
      .from("orders")
      .select("status");

    type OrderRow = { status: string };
    const ordersByStatus = (allOrders ?? [] as OrderRow[]).reduce(
      (acc: Record<string, number>, o: OrderRow) => {
        acc[o.status] = (acc[o.status] ?? 0) + 1;
        return acc;
      },
      {} as Record<string, number>
    );

    // ── Users ────────────────────────────────────────────────────────────────
    const { count: totalUsers } = await supabaseAdmin
      .from("user_role")
      .select("id", { count: "exact", head: true });

    const { count: newUsersThisMonth } = await supabaseAdmin
      .from("user_role")
      .select("id", { count: "exact", head: true })
      .gte("created_at", monthStart)
      .lte("created_at", monthEnd);

    const { data: allUsers } = await supabaseAdmin
      .from("user_role")
      .select("role_name");

    type UserRow = { role_name: string };
    const usersByRole = (allUsers ?? [] as UserRow[]).reduce(
      (acc: Record<string, number>, u: UserRow) => {
        acc[u.role_name] = (acc[u.role_name] ?? 0) + 1;
        return acc;
      },
      {} as Record<string, number>
    );

    // ── Top products ─────────────────────────────────────────────────────────
    // Aggregate total units sold per product from order_details
    const { data: orderDetails } = await supabaseAdmin
      .from("order_details")
      .select("product_id, quantity");

    type DetailRow = { product_id: string; quantity: number };
    const productSales = ((orderDetails ?? []) as DetailRow[]).reduce(
      (acc: Record<string, number>, d) => {
        acc[d.product_id] = (acc[d.product_id] ?? 0) + d.quantity;
        return acc;
      },
      {} as Record<string, number>
    );

    // Sort by units sold, take top 5
    const top5Ids = Object.entries(productSales)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 5)
      .map(([id]) => id);

    let topProducts: unknown[] = [];
    if (top5Ids.length > 0) {
      const { data: products } = await supabaseAdmin
        .from("products")
        .select("id, name, product_code")
        .in("id", top5Ids);

      topProducts = top5Ids.map((id) => {
        const product = (products ?? []).find((p: { id: string }) => p.id === id);
        return {
          product_id:   id,
          name:         (product as any)?.name         ?? "Unknown",
          product_code: (product as any)?.product_code ?? "",
          units_sold:   productSales[id],
        };
      });
    }

    res.status(200).json({
      success: true,
      data: {
        revenue: {
          total_revenue:      Math.round(totalRevenue      * 100) / 100,
          revenue_this_month: Math.round(revenueThisMonth  * 100) / 100,
          revenue_last_month: Math.round(revenueLastMonth  * 100) / 100,
          currency:           "INR",
        },
        orders: {
          total_orders:      totalOrders      ?? 0,
          orders_this_month: ordersThisMonth  ?? 0,
          orders_by_status:  ordersByStatus,
        },
        users: {
          total_users:          totalUsers         ?? 0,
          new_users_this_month: newUsersThisMonth  ?? 0,
          users_by_role:        usersByRole,
        },
        top_products: topProducts,
      },
    });
  } catch (err) { next(err); }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/admin/sales-report   — admin
//
// Aggregated sales report for a given date range.
// Query params:
//   ?from=YYYY-MM-DD  (default: first day of current month)
//   ?to=YYYY-MM-DD    (default: last day of current month)
//   ?group_by=day|month  (default: day)
//
// Response:
//   summary: total_orders, total_revenue, avg_order_value, by status counts
//   breakdown: ordered array of { period, order_count, revenue }
//   by_payment_type: revenue grouped by payment method
//   by_category: revenue grouped by product category
// ─────────────────────────────────────────────────────────────────────────────
export const getSalesReport = async (
  req:  Request,
  res:  Response<ApiResponse<unknown>>,
  next: NextFunction
): Promise<void> => {
  try {
    // ── Parse and validate query params ──────────────────────────────────────
    const fromParam    = req.query.from    as string | undefined;
    const toParam      = req.query.to      as string | undefined;
    const groupByParam = (req.query.group_by as string | undefined) ?? "day";

    if (groupByParam !== "day" && groupByParam !== "month")
      throw new AppError("group_by must be 'day' or 'month'", 400);

    if (fromParam && !isValidDate(fromParam))
      throw new AppError("'from' must be a valid YYYY-MM-DD date", 400);

    if (toParam && !isValidDate(toParam))
      throw new AppError("'to' must be a valid YYYY-MM-DD date", 400);

    const fromISO = fromParam ? toStartOfDay(fromParam) : startOfCurrentMonth();
    const toISO   = toParam   ? toEndOfDay(toParam)     : endOfCurrentMonth();

    if (new Date(fromISO) > new Date(toISO))
      throw new AppError("'from' date must be before or equal to 'to' date", 400);

    // ── Fetch orders in range ─────────────────────────────────────────────────
    const { data: orders, error: ordersError } = await supabaseAdmin
      .from("orders")
      .select("id, amount, order_date, status, payment_id")
      .gte("order_date", fromISO)
      .lte("order_date", toISO)
      .order("order_date", { ascending: true });

    if (ordersError) throw new AppError(`Failed to fetch orders: ${ordersError.message}`, 500);

    const orderList = (orders ?? []) as {
      id: string; amount: number; order_date: string;
      status: string; payment_id: string | null;
    }[];

    // ── Summary ───────────────────────────────────────────────────────────────
    const totalRevenue = orderList
      .filter((o) => o.status === "delivered")
      .reduce((s, o) => s + Number(o.amount), 0);

    const statusCounts = orderList.reduce(
      (acc: Record<string, number>, o) => {
        acc[o.status] = (acc[o.status] ?? 0) + 1;
        return acc;
      },
      {} as Record<string, number>
    );

    const avgOrderValue = orderList.length
      ? totalRevenue / (statusCounts["delivered"] ?? 1)
      : 0;

    // ── Time-series breakdown ─────────────────────────────────────────────────
    const periodMap = new Map<string, { order_count: number; revenue: number }>();

    for (const order of orderList) {
      const date  = new Date(order.order_date);
      const key   = groupByParam === "month"
        ? `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`
        : date.toISOString().slice(0, 10);

      if (!periodMap.has(key)) periodMap.set(key, { order_count: 0, revenue: 0 });
      const entry = periodMap.get(key)!;
      entry.order_count += 1;
      if (order.status === "delivered") entry.revenue += Number(order.amount);
    }

    const breakdown = Array.from(periodMap.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([period, { order_count, revenue }]) => ({
        period,
        order_count,
        revenue: Math.round(revenue * 100) / 100,
      }));

    // ── Revenue by payment type ───────────────────────────────────────────────
    const paymentIds = orderList
      .filter((o) => o.payment_id !== null)
      .map((o) => o.payment_id as string);

    const paymentTypeMap: Record<string, number> = {};

    if (paymentIds.length > 0) {
      const { data: payments } = await supabaseAdmin
        .from("payment")
        .select("order_id, type, amount")
        .in("order_id", orderList.map((o) => o.id))
        .not("transaction_id", "is", null); // confirmed payments only

      for (const p of (payments ?? []) as { order_id: string; type: string; amount: number }[]) {
        paymentTypeMap[p.type] = (paymentTypeMap[p.type] ?? 0) + Number(p.amount);
      }
    }

    const byPaymentType = Object.entries(paymentTypeMap).map(([type, revenue]) => ({
      type,
      revenue: Math.round(revenue * 100) / 100,
    }));

    // ── Revenue by category ───────────────────────────────────────────────────
    const orderIds = orderList.map((o) => o.id);
    const categoryRevenueMap: Record<string, { category_name: string; revenue: number; units: number }> = {};

    if (orderIds.length > 0) {
      const { data: details } = await supabaseAdmin
        .from("order_details")
        .select(`
          product_id, quantity, unit_price,
          products ( category_id )
        `)
        .in("order_id", orderIds);

      // Collect unique category IDs
      const categoryIds = [
        ...new Set(
          ((details ?? []) as any[])
            .map((d) => {
              const cat = Array.isArray(d.products) ? d.products[0] : d.products;
              return cat?.category_id;
            })
            .filter(Boolean)
        ),
      ];

      if (categoryIds.length > 0) {
        const { data: categories } = await supabaseAdmin
          .from("category")
          .select("id, category_name")
          .in("id", categoryIds);

        const catMap: Record<string, string> = {};
        for (const c of (categories ?? []) as { id: number; category_name: string }[]) {
          catMap[String(c.id)] = c.category_name;
        }

        for (const d of (details ?? []) as any[]) {
          const prod    = Array.isArray(d.products) ? d.products[0] : d.products;
          const catId   = String(prod?.category_id ?? "unknown");
          const catName = catMap[catId] ?? "Unknown";
          const revenue = Number(d.unit_price) * Number(d.quantity);

          if (!categoryRevenueMap[catId]) {
            categoryRevenueMap[catId] = { category_name: catName, revenue: 0, units: 0 };
          }
          categoryRevenueMap[catId].revenue += revenue;
          categoryRevenueMap[catId].units   += Number(d.quantity);
        }
      }
    }

    const byCategory = Object.entries(categoryRevenueMap)
      .map(([id, { category_name, revenue, units }]) => ({
        category_id:   id,
        category_name,
        revenue:       Math.round(revenue * 100) / 100,
        units_sold:    units,
      }))
      .sort((a, b) => b.revenue - a.revenue);

    res.status(200).json({
      success: true,
      data: {
        period: { from: fromParam ?? fromISO.slice(0, 10), to: toParam ?? toISO.slice(0, 10) },
        group_by: groupByParam,
        summary: {
          total_orders:    orderList.length,
          total_revenue:   Math.round(totalRevenue * 100) / 100,
          avg_order_value: Math.round(avgOrderValue * 100) / 100,
          by_status:       statusCounts,
          currency:        "INR",
        },
        breakdown,
        by_payment_type: byPaymentType,
        by_category:     byCategory,
      },
    });
  } catch (err) { next(err); }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/admin/inventory   — admin
//
// Returns product variants where stock is at or below the threshold.
// Query params:
//   ?threshold=<n>     Default 10. Variants with stock <= threshold are returned.
//   ?seller_id=<uuid>  Optional. Filter to a specific seller's products.
//   ?page=  ?limit=    Pagination — default page 1, limit 20.
//
// Response rows include:
//   variant fields, product name + code, seller business_name.
// ─────────────────────────────────────────────────────────────────────────────
export const getInventory = async (
  req:  Request,
  res:  Response<ApiResponse<unknown>>,
  next: NextFunction
): Promise<void> => {
  try {
    const thresholdParam = req.query.threshold as string | undefined;
    const sellerIdParam  = req.query.seller_id as string | undefined;

    const threshold = thresholdParam !== undefined
      ? parseInt(thresholdParam, 10)
      : 10;

    if (isNaN(threshold) || threshold < 0)
      throw new AppError("'threshold' must be a non-negative integer", 400);

    if (sellerIdParam && !UUID_RE.test(sellerIdParam))
      throw new AppError("'seller_id' must be a valid UUID", 400);

    const page  = Math.max(1, parseInt(String(req.query.page  ?? "1"),  10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit ?? "20"), 10) || 20));
    const from  = (page - 1) * limit;
    const to    = from + limit - 1;

    // ── If seller_id filter supplied, resolve their product IDs ──────────────
    let productIdFilter: string[] | null = null;

    if (sellerIdParam) {
      const { data: sellerProducts } = await supabaseAdmin
        .from("products")
        .select("id")
        .eq("seller_id", sellerIdParam);

      productIdFilter = (sellerProducts ?? []).map((p: { id: string }) => p.id);

      if (productIdFilter.length === 0) {
        return res.status(200).json({
          success: true,
          data: { variants: [], page, limit, total: 0, hasMore: false, threshold },
        }) as any;
      }
    }

    // ── Fetch low-stock active variants ───────────────────────────────────────
    let q = supabaseAdmin
      .from("product_variants")
      .select(`
        id, sku, color, size, material, stock, status, is_active,
        product_id,
        products (
          id, name, product_code, seller_id,
          sellers:sellers!products_seller_id_fkey (
            id, business_name
          )
        )
      `, { count: "exact" })
      .lte("stock", threshold)
      .eq("is_active", true)
      .order("stock", { ascending: true })
      .range(from, to);

    if (productIdFilter) q = q.in("product_id", productIdFilter);

    const { data, error, count } = await q;
    if (error) throw new AppError(`Failed to fetch inventory: ${error.message}`, 500);

    // Flatten the nested join for a clean response shape
    const variants = (data ?? []).map((v: any) => {
      const product = Array.isArray(v.products) ? v.products[0] : v.products;
      const seller  = product
        ? (Array.isArray(product.sellers) ? product.sellers[0] : product.sellers)
        : null;

      return {
        variant_id:    v.id,
        sku:           v.sku,
        color:         v.color,
        size:          v.size,
        material:      v.material,
        stock:         v.stock,
        status:        v.status,
        product_id:    v.product_id,
        product_name:  product?.name         ?? null,
        product_code:  product?.product_code ?? null,
        seller_id:     product?.seller_id    ?? null,
        business_name: seller?.business_name ?? null,
      };
    });

    res.status(200).json({
      success: true,
      data: {
        variants,
        page,
        limit,
        total:     count ?? 0,
        hasMore:   (count ?? 0) > page * limit,
        threshold,
      },
    });
  } catch (err) { next(err); }
};
