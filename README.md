# E-Commerce Admin API

Production-ready Node.js + Express + TypeScript backend for a multi-role
e-commerce platform. Built on Supabase (PostgreSQL) with JWT authentication,
Zod validation, and per-route role enforcement.

---

## Stack

| Layer | Technology |
|---|---|
| Runtime | Node.js 20+ with TypeScript 5 |
| Framework | Express 4 |
| Database | Supabase (PostgreSQL 15) |
| Auth | Supabase JWT (RS256), verified server-side |
| Validation | Zod 3 |
| Security | Helmet, CORS whitelist, size-limited bodies |
| File Upload | Multer (memory storage) → Supabase Storage |
| Entry point | `src/index.ts` |
| Build output | `dist/` |

---

## Setup

```bash
# 1. Install dependencies
npm install

# 2. Configure environment
cp .env.example .env

# 3. Dev server (hot reload)
npm run dev

# 4. Production build
npm run build && npm start
```

---

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `SUPABASE_URL` | ✓ | Supabase project URL |
| `SUPABASE_ANON_KEY` | ✓ | Public anon key (safe for client) |
| `SUPABASE_SERVICE_ROLE_KEY` | ✓ | Admin key — **never expose to client** |
| `PORT` | | Server port (default: `3000`) |
| `NODE_ENV` | | `development` or `production` |
| `ALLOWED_ORIGINS` | | Comma-separated CORS whitelist |
| `PASSWORD_RESET_REDIRECT_URL` | | URL Supabase redirects to after password reset |
| `PAYMENT_WEBHOOK_SECRET` | | Secret validated on `POST /api/payments/verify` |

---

## Role Hierarchy

| Role | Level | Description |
|---|---|---|
| `customer` | 1 | Lowest — cart, wishlist, own orders |
| `seller` | 2 | Customer + product/variant management for own products, supplier workflow |
| `admin` | 3 | Full access to all endpoints |

Routes marked **auth** require any valid JWT. Routes marked **seller** require
`seller` role or above. Routes marked **admin** require `admin` role only.

Suspended users (`user_role.status = 'suspended'`) are blocked at the
`requireAuth` middleware and cannot access any protected route.

---

## Standard Response Envelope

All endpoints return JSON in this shape:

```json
{
  "success": true,
  "message": "Optional human-readable message",
  "data": { }
}
```

Error responses:

```json
{
  "success": false,
  "message": "What went wrong",
  "errors": { }
}
```

Paginated responses wrap results in:

```json
{
  "success": true,
  "data": {
    "data": [...],
    "page": 1,
    "limit": 20,
    "total": 145,
    "hasMore": true
  }
}
```

---

## API Reference

### Authentication — `/api/auth`

| Method | Endpoint | Role | Description |
|---|---|---|---|
| POST | `/api/auth/register` | public | Create account. Body: `{ email, password, first_name, last_name?, role_name: "customer"\|"admin"\|"seller", seller_profile?: { seller_profile_id } }`. Inserts `user_role` (status: `pending`). If seller, inserts `sellers` row linking to the chosen `seller_profile_id`. |
| POST | `/api/auth/login` | public | Sign in with email + password. Returns `access_token`, `refresh_token`, and `user` profile. |
| POST | `/api/auth/logout` | auth | Invalidates the current session. |
| POST | `/api/auth/refresh-token` | auth | Exchange `refresh_token` for a new `access_token`. |
| POST | `/api/auth/forgot-password` | public | Send password-reset email. Always returns 200 to prevent email enumeration. |
| POST | `/api/auth/reset-password` | public | Body: `{ access_token, new_password }`. Completes the reset flow. |
| GET | `/api/auth/me` | auth | Returns the authenticated user's `user_role` profile including `role_name`, `status`, `is_seller_partner`, `seller_id`, `tagged_seller_partner_id`. |
| PATCH | `/api/auth/me` | auth | Update `first_name`, `last_name`, and/or password. Changing password requires `current_password`. |

---

### Users — `/api/users`

All routes require **admin** role.

| Method | Endpoint | Role | Description |
|---|---|---|---|
| GET | `/api/users` | admin | Paginated list of all users from `user_role`. Supports `?page=` `?limit=`. |
| GET | `/api/users/:id` | admin | Single user by UUID. |
| PATCH | `/api/users/:id/role` | admin | Update `role_name`. Body: `{ role_name: "customer"\|"seller"\|"admin" }`. |
| PATCH | `/api/users/:id/status` | admin | Update `user_role.status`. Body: `{ status: "active"\|"pending"\|"suspended" }`. Admins cannot suspend themselves. |
| DELETE | `/api/users/:id` | admin | Permanently deletes the `user_role` row and the Supabase auth account. |

---

### Seller Profiles — `/api/seller-profiles`

`seller_profiles` holds business identity. `sellers` links a user to a profile.

| Method | Endpoint | Role | Description |
|---|---|---|---|
| GET | `/api/seller-profiles` | **public** | Paginated list of seller profiles. Used in the signup dropdown. Supports `?status=` `?search=` `?page=` `?limit=`. |
| POST | `/api/seller-profiles` | admin | Create a new seller profile. Body: `{ business_name, contact_name?, email?, phone?, description? }`. Starts with `is_verified: false`, `status: "pending"`. |
| PUT | `/api/seller-profiles/:id` | admin | Update business profile details. |
| PATCH | `/api/seller-profiles/:id/status` | admin | Update profile status. Body: `{ status: "active"\|"pending"\|"suspended" }`. Setting `active` also sets `is_verified: true`. |

---

### Sellers — `/api/sellers`

| Method | Endpoint | Role | Description |
|---|---|---|---|
| GET | `/api/sellers` | admin | Paginated list of seller accounts joined with their profile. Supports `?status=` `?user_id=` `?page=` `?limit=`. |
| GET | `/api/sellers/me` | seller | The authenticated user's seller account joined with their `seller_profiles` row. |
| GET | `/api/sellers/:id` | admin | Single seller account by UUID. |
| POST | `/api/sellers` | auth | Link the authenticated user to an existing `seller_profile`. Body: `{ seller_profile_id }`. One seller account per user enforced. Starts with `status: "pending"`. |
| PATCH | `/api/sellers/:id/status` | admin | Update `sellers.status`. Body: `{ status: "active"\|"pending"\|"suspended" }`. |
| DELETE | `/api/sellers/:id` | admin | Permanently remove a seller account (does not delete the profile). |

---

### Categories — `/api/categories` (RESTful) and `/api/category` (legacy)

#### RESTful categories

| Method | Endpoint | Role | Description |
|---|---|---|---|
| GET | `/api/categories` | public | Full category tree (hierarchical). |
| GET | `/api/categories/:id` | public | Single category by id. |
| POST | `/api/categories` | admin | Create category. Body: `{ category_name, parent_category_id?, is_active? }`. |
| PUT | `/api/categories/:id` | admin | Update category. Cycle detection prevents a category from becoming its own ancestor. |
| PATCH | `/api/categories/:id/toggle` | admin | Toggle `is_active` on a category. |
| DELETE | `/api/categories/:id` | admin | Delete category. Blocked if it has active child categories or products. |

#### Legacy admin-panel categories

| Method | Endpoint | Role | Description |
|---|---|---|---|
| GET | `/api/category` | auth | Flat list of all categories. |
| POST | `/api/category/add` | auth | Create category. |
| PUT | `/api/category/update` | auth | Update category. |
| DELETE | `/api/category/remove/:id` | auth | Delete category. |

---

### Products — `/api/products` (RESTful) and `/api/product` (legacy)

#### RESTful products

| Method | Endpoint | Role | Description |
|---|---|---|---|
| GET | `/api/products/search` | public | Full-text search across `name`, `description`, `product_code`. Query params: `?q=` (required) `?category_id=` `?gender=` `?seller_id=` `?min_price=` `?max_price=` `?page=` `?limit=`. |
| GET | `/api/products` | public | Paginated active products with variants. Supports `?category_id=` `?gender=` `?seller_id=` `?page=` `?limit=`. |
| GET | `/api/seller/products` | seller | The authenticated seller's own product list. |
| GET | `/api/products/:id` | public | Single active product with all active variants. |
| POST | `/api/products` | admin | Create product with at least one variant. Rolls back on variant insert failure. |
| PUT | `/api/products/:id` | admin | Update product-level fields only (not variants). |
| PATCH | `/api/products/:id/toggle` | admin | Toggle `is_active` between `true` and `false`. |
| DELETE | `/api/products/:id` | admin | Soft-delete: sets `is_active = false` and archives all variants. |

#### Product Variants

| Method | Endpoint | Role | Description |
|---|---|---|---|
| GET | `/api/products/:id/variants` | public | All active variants for a product. |
| GET | `/api/products/:id/variants/:vid` | public | Single variant. |
| POST | `/api/products/:id/variants` | seller | Add a variant. Ownership check: seller must own the product. |
| PUT | `/api/products/:id/variants/:vid` | seller | Update variant details. |
| PATCH | `/api/products/:id/variants/:vid/stock` | seller | Update stock quantity. Body: `{ stock: integer >= 0 }`. |
| PATCH | `/api/products/:id/variants/:vid/discount` | seller | Set discount. Body: `{ discount_type: "percentage"\|"fixed"\|null, discount_value: number\|null }`. Send both as `null` to clear. |
| DELETE | `/api/products/:id/variants/:vid` | seller | Soft-deactivate variant (`is_active: false`, `status: "archived"`). |

#### Legacy admin-panel products

| Method | Endpoint | Role | Description |
|---|---|---|---|
| GET | `/api/products` | auth | Paginated products (20/page) with variants. |
| POST | `/api/product/add` | auth | Create product + variants. |
| PUT | `/api/product/update` | auth | Update product fields and upsert variants. |
| DELETE | `/api/product/remove/:id` | auth | Hard-delete product and all variants. |

---

### Product Reviews — `/api/products/:id/reviews` and `/api/reviews`

| Method | Endpoint | Role | Description |
|---|---|---|---|
| GET | `/api/products/:id/reviews` | public | Approved reviews for a product. Includes `average_rating` and `review_count`. Supports `?rating=1-5` `?page=` `?limit=`. |
| POST | `/api/products/:id/reviews` | auth | Submit a review. `is_verified_purchase` is set automatically by checking the user's delivered orders. One review per (user, product). |
| PUT | `/api/reviews/:id` | auth | Edit own review. Resets `is_approved: true` on edit. |
| DELETE | `/api/reviews/:id` | auth | Delete own review. Admins can delete any review. |
| PATCH | `/api/reviews/:id/approve` | admin | Approve or reject a review. Body: `{ is_approved: boolean }`. |
| GET | `/api/seller/reviews` | seller | Reviews on all of the seller's products. Supports `?is_approved=true\|false` `?rating=` `?page=` `?limit=`. |

---

### Cart and Wishlist — `/api/cart` and `/api/wishlist`

All routes require **auth**.

#### Cart

`cart` table columns: `id`, `user_id`, `product_id` (→ `product_variants.id`), `quantity`, `created_at`, `updated_at`

| Method | Endpoint | Role | Description |
|---|---|---|---|
| GET | `/api/cart` | auth | Current user's cart with product info and computed `subtotal`. |
| POST | `/api/cart` | auth | Add product to cart. Body: `{ product_id, quantity? }`. Increments quantity if product already in cart. |
| PUT | `/api/cart/:id` | auth | Update quantity of a cart item. Body: `{ quantity: integer >= 1 }`. |
| DELETE | `/api/cart` | auth | Hard-delete all cart items (clear cart). **Must be registered before `DELETE /api/cart/:id`.** |
| DELETE | `/api/cart/:id` | auth | Hard-delete a single cart item. |

#### Wishlist

`wishlist` table columns: `id`, `user_id`, `product_id` (→ `product_variants.id`), `created_at`, `deleted_at`

| Method | Endpoint | Role | Description |
|---|---|---|---|
| GET | `/api/wishlist` | auth | Active wishlist items (`deleted_at IS NULL`) with product info. |
| POST | `/api/wishlist` | auth | Add product. Body: `{ product_id }`. Idempotent — if soft-deleted entry exists, `deleted_at` is cleared. Returns 200 if already active, 201 if new. |
| DELETE | `/api/wishlist/:id` | auth | Soft-delete: sets `deleted_at = NOW()`. |

---

### Orders — `/api/orders`

| Method | Endpoint | Role | Description |
|---|---|---|---|
| GET | `/api/orders` | auth | List orders. Customers see own orders only; admins see all. Supports `?status=pending\|shipped\|delivered` `?page=` `?limit=`. |
| POST | `/api/orders` | auth | Place a new order from the cart. Body: `{ shipping_address_id, billing_address_id }`. Resolves unit prices from active variants, inserts `orders` + `order_details`, clears the cart. |
| GET | `/api/orders/:id` | auth | Order details with line items and joined addresses. |
| PATCH | `/api/orders/:id/status` | admin | Update order status. Body: `{ status }`. Forward-only transitions enforced (`pending → shipped → delivered`). |
| DELETE | `/api/orders/:id` | auth | Cancel an order. Only `pending` orders can be cancelled. |
| GET | `/api/orders/:id/items` | auth | Line items (`order_details`) for an order. |
| GET | `/api/orders/:id/payment` | auth | Payment record for an order. |
| GET | `/api/orders/:id/shipment` | auth | Shipment for an order (resolved via `orders.shipment_id`). |
| GET | `/api/seller/orders` | seller | Orders containing the seller's products. Supports `?page=` `?limit=`. |

---

### Payments — `/api/payments`

| Method | Endpoint | Role | Description |
|---|---|---|---|
| POST | `/api/payments/initiate` | auth | Create a payment record for an order. Body: `{ order_id, type: "UPI"\|"Credit Card"\|"Cash"\|"Debit Card"\|"Gift Voucher" }`. Links `orders.payment_id`. Only for `pending` orders. |
| POST | `/api/payments/verify` | **public** | Webhook — confirm payment. Body: `{ payment_id, transaction_id, webhook_secret? }`. Sets `payment_date` and `transaction_id`. Validates `PAYMENT_WEBHOOK_SECRET` env var if set. |
| GET | `/api/payments/:id` | auth | Payment record by ID. Ownership enforced for non-admins. |
| POST | `/api/payments/:id/refund` | admin | Initiate refund. Marks `transaction_id` as `REFUNDED:original`, clears `payment_date`, reverts order to `pending`. Body: `{ reason? }`. |

---

### Shipments — `/api/shipments`

`shipment` table columns: `id`, `shipment_date`, `address_id`. The link to orders is stored on `orders.shipment_id`.

| Method | Endpoint | Role | Description |
|---|---|---|---|
| GET | `/api/shipments/:id` | auth | Shipment details joined with delivery address. |
| POST | `/api/shipments` | admin | Create a shipment. Body: `{ order_id, address_id, shipment_date? }`. Updates `orders.shipment_id` after insert. One shipment per order (409 on duplicate). |
| PATCH | `/api/shipments/:id` | admin | Update `shipment_date` and/or `address_id`. At least one field required. |

---

### Addresses — `/api/addresses`

All routes require **auth**. Users can only access their own addresses.

| Method | Endpoint | Role | Description |
|---|---|---|---|
| GET | `/api/addresses` | auth | List the authenticated user's addresses. Supports `?type=billing\|shipping`. |
| POST | `/api/addresses` | auth | Create an address. Body: `{ street_address, city, state, pin_code, country, land_mark?, address_type: "billing"\|"shipping" }`. |
| PUT | `/api/addresses/:id` | auth | Update an address. Ownership enforced. |
| DELETE | `/api/addresses/:id` | auth | Delete an address. Ownership enforced. |

---

### File Upload — `/api/upload`

| Method | Endpoint | Role | Description |
|---|---|---|---|
| POST | `/api/upload/image` | auth | Upload an image to Supabase Storage (`image-bucket/products/`). Request: `multipart/form-data` with field `image`. Max size 5 MB. Accepted types: JPEG, PNG, WebP, GIF. Returns `{ url }`. |

---

### Suppliers — `/api/suppliers`

All routes require **seller** role or above.

| Method | Endpoint | Role | Description |
|---|---|---|---|
| POST | `/api/suppliers` | seller+ | Create a new supplier. Body: `{ name, contact_person?, email?, phone?, address?, status? }`. |
| GET | `/api/suppliers` | seller+ | Paginated list. Supports `?page=` `?limit=` `?status=` `?search=`. |
| GET | `/api/suppliers/:id` | seller+ | Single supplier by UUID. |
| PUT | `/api/suppliers/:id` | seller+ | Update supplier fields. At least one field required. |

---

### Supplier Products — `/api/supplier-products`

| Method | Endpoint | Role | Description |
|---|---|---|---|
| POST | `/api/supplier-products` | seller+ | Create a supplier-product mapping. Body: `{ supplier_id, product_id, cost_price?, lead_time_days? }`. |
| GET | `/api/supplier-products` | seller+ | Paginated list. Supports `?supplier_id=` `?product_id=` `?page=` `?limit=`. |
| PUT | `/api/supplier-products/:id` | seller+ | Update `cost_price` and/or `lead_time_days`. |

---

### Purchase Orders — `/api/purchase-orders`

| Method | Endpoint | Role | Description |
|---|---|---|---|
| GET | `/api/purchase-orders` | seller+ | Paginated list. Sellers see own; admins see all. Supports `?status=` `?seller_id=` `?page=` `?limit=`. |
| GET | `/api/purchase-orders/:id` | seller+ | Single purchase order with line items. |
| POST | `/api/purchase-orders` | seller+ | Create purchase order. Body: `{ supplier_id, seller_id?, expected_delivery_date?, items: [{ product_variant_id, quantity, unit_cost? }] }`. |
| PUT | `/api/purchase-orders/:id/status` | seller+ | Update status. Body: `{ status: "pending"\|"shipped"\|"received" }`. |

---

### Supplier Shipments — `/api/supplier-shipments`

Atomic creation: inserts shipment + items + inventory batches + shipping cost allocations in one operation.

| Method | Endpoint | Role | Description |
|---|---|---|---|
| POST | `/api/supplier-shipments` | seller+ | Create inbound shipment. Body: `{ purchase_order_id, seller_id?, courier_name?, tracking_number?, shipment_date?, delivery_date?, shipping_cost?, status?, items: [{ product_variant_id, quantity }] }`. |
| GET | `/api/supplier-shipments` | seller+ | Paginated list. Supports `?purchase_order_id=` `?seller_id=` `?page=` `?limit=`. |
| GET | `/api/supplier-shipments/:id` | seller+ | Single shipment with items, inventory batches, and cost allocations. |

---

### Supplier Returns — `/api/supplier-returns`

| Method | Endpoint | Role | Description |
|---|---|---|---|
| POST | `/api/supplier-returns` | seller+ | Initiate a return. Body: `{ supplier_id, seller_id?, reason?, items: [{ inventory_batch_id, quantity }] }`. Decrements `remaining_quantity` on affected batches. |
| GET | `/api/supplier-returns` | seller+ | Paginated list. Sellers see own; admins see all. Supports `?status=` `?supplier_id=` `?seller_id=` `?page=` `?limit=`. |
| GET | `/api/supplier-returns/:id` | seller+ | Single return with items and batch context. |
| PUT | `/api/supplier-returns/:id/status` | seller+ | Update status. Body: `{ status: "initiated"\|"shipped"\|"completed" }`. |

---

### Supplier Return Shipments — `/api/supplier-return-shipments`

Atomic creation: inserts return shipment + items + cost allocations in one operation with compensating rollback.

| Method | Endpoint | Role | Description |
|---|---|---|---|
| POST | `/api/supplier-return-shipments` | seller+ | Create return shipment. Body: `{ return_id, courier_name?, tracking_number?, shipment_date?, delivery_date?, shipping_cost?, status?, items: [{ inventory_batch_id, quantity }] }`. |
| GET | `/api/supplier-return-shipments` | seller+ | Paginated list. Supports `?return_id=` `?status=` `?seller_id=` `?page=` `?limit=`. |
| GET | `/api/supplier-return-shipments/:id` | seller+ | Single return shipment with items and cost allocations. |

---

### Supplier Replacements — `/api/supplier-replacements`

Two code paths share the same POST route, differentiated by the presence of a `shipment` body key.

| Method | Endpoint | Role | Description |
|---|---|---|---|
| POST | `/api/supplier-replacements` | seller+ | **(A) With `shipment` key:** Full atomic workflow — creates return shipment + items + cost allocations + replacement record. **(B) Without `shipment` key:** Creates only the `supplier_replacements` record with an optional `shipment_id`. |
| GET | `/api/supplier-replacements` | seller+ | Paginated list. Supports `?return_id=` `?status=` `?seller_id=` `?page=` `?limit=`. |

---

### Cost Allocation — `/api/costs`

Recomputes and persists shipping-cost allocations proportionally by quantity.

| Method | Endpoint | Role | Description |
|---|---|---|---|
| GET | `/api/costs/inbound/:shipmentId` | seller+ | Recompute inbound shipment cost allocation. Updates `shipment_cost_allocations` and `inventory_batches.landed_cost`. |
| GET | `/api/costs/return/:shipmentId` | seller+ | Recompute return shipment cost allocation. Updates `return_shipment_cost_allocations`. |

---

### Inventory — `/api/inventory`

Read-only inventory visibility.

| Method | Endpoint | Role | Description |
|---|---|---|---|
| GET | `/api/inventory` | seller+ | Inventory summary grouped by product across all visible batches. |
| GET | `/api/inventory/:productId` | seller+ | Variant-level and batch-level breakdown for one product. |
| GET | `/api/inventory/batches/:id` | seller+ | Single inventory batch with supplier, shipment, and cost allocation context. |

---

### Supply-Chain Traceability — `/api/trace`

| Method | Endpoint | Role | Description |
|---|---|---|---|
| GET | `/api/trace/product/:variantId` | seller+ | Trace a product variant back to its supplier(s) via `inventory_batches`. Returns all batches with supplier and purchase-order context plus a summary of distinct suppliers. |
| GET | `/api/trace/order/:orderId` | seller+ | Trace a customer order back to the supplier(s) via line items and batches. Returns per-line-item batch/supplier detail and a top-level supplier summary. |

---

### Analytics — `/api/analytics`

| Method | Endpoint | Role | Description |
|---|---|---|---|
| GET | `/api/analytics/suppliers` | seller+ | Aggregated supplier performance metrics: total supplied qty, avg unit/landed cost, avg delivery time (days), return rate %, total shipments/POs/returns. Supports `?seller_id=` (admin only). |
| GET | `/api/analytics/costs` | seller+ | Full cost breakdown — inbound procurement cost, allocated shipping cost, landed cost, return cost, net inventory cost — as a summary plus per-product and per-supplier breakdowns. Supports `?seller_id=` (admin only). |

---

### Admin Analytics — `/api/admin`

All routes require **admin** role.

| Method | Endpoint | Role | Description |
|---|---|---|---|
| GET | `/api/admin/dashboard` | admin | KPIs for the current period: total/monthly revenue (with MoM comparison), order counts by status, user counts by role, top 5 products by units sold. |
| GET | `/api/admin/sales-report` | admin | Aggregated sales report. Query params: `?from=YYYY-MM-DD` `?to=YYYY-MM-DD` (default: current month) `?group_by=day\|month`. Returns time-series breakdown, revenue by payment type, revenue by category. |
| GET | `/api/admin/inventory` | admin | Low-stock variants. Query params: `?threshold=<n>` (default: 10) `?seller_id=<uuid>` `?page=` `?limit=`. |

---

## Database Table Summary

| Table | Key Columns | Notes |
|---|---|---|
| `user_role` | `id`, `first_name`, `last_name`, `role_name`, `status`, `is_seller_partner`, `seller_id`, `tagged_seller_partner_id` | FK → `auth.users(id)` |
| `seller_profiles` | `id`, `business_name`, `contact_name`, `email`, `phone`, `description`, `is_verified`, `status` | Business identity, admin-managed |
| `sellers` | `id`, `user_id`, `seller_profile_id`, `status` | Links a user to a seller_profile |
| `products` | `id`, `seller_id`, `name`, `product_code`, `category_id`, `gender`, `is_active` | `seller_id` → `seller_profiles.id` (not `sellers.id`) |
| `product_variants` | `id`, `product_id`, `sku`, `color`, `size`, `material`, `base_price`, `stock`, `status`, `discount_type`, `discount_value` | Cart and wishlist FK to this table |
| `category` | `id`, `category_name`, `parent_category_id`, `is_active` | Hierarchical tree; `id` is bigint |
| `product_reviews` | `id`, `user_id`, `product_id`, `product_variant_id`, `rating`, `review_title`, `review_text`, `is_verified_purchase`, `is_approved` | |
| `cart` | `id`, `user_id`, `product_id`, `quantity` | `product_id` FK → `product_variants.id`; hard-deleted on clear/checkout |
| `wishlist` | `id`, `user_id`, `product_id`, `deleted_at` | `product_id` FK → `product_variants.id`; soft-delete via `deleted_at` |
| `orders` | `id`, `user_id`, `amount`, `order_date`, `status`, `shipping_address_id`, `billing_address_id`, `payment_id`, `shipment_id` | |
| `order_details` | `id`, `order_id`, `product_id`, `quantity`, `unit_price` | `product_id` FK → `product_variants.id`; price captured at order time |
| `payment` | `id`, `type`, `amount`, `payment_date`, `order_id`, `transaction_id` | |
| `shipment` | `id`, `shipment_date`, `address_id` | `orders.shipment_id` is the FK — no `order_id` column on this table |
| `address` | `id`, `user_id`, `street_address`, `city`, `state`, `pin_code`, `country`, `land_mark`, `address_type` | |
| `suppliers` | `id`, `name`, `contact_person`, `email`, `phone`, `address`, `status` | |
| `supplier_products` | `id`, `supplier_id`, `product_id`, `cost_price`, `lead_time_days` | Maps supplier → product |
| `purchase_orders` | `id`, `seller_id`, `supplier_id`, `status`, `order_date`, `expected_delivery_date` | |
| `purchase_order_items` | `id`, `purchase_order_id`, `product_variant_id`, `quantity`, `unit_cost`, `received_quantity` | |
| `inventory_batches` | `id`, `product_variant_id`, `supplier_id`, `shipment_id`, `quantity`, `remaining_quantity`, `unit_cost`, `landed_cost` | Core of cost traceability |
| `supplier_shipments` | `id`, `supplier_id`, `purchase_order_id`, `courier_name`, `tracking_number`, `shipping_cost`, `status` | Inbound shipments FROM supplier |
| `supplier_shipment_items` | `id`, `shipment_id`, `product_variant_id`, `quantity` | |
| `shipment_cost_allocations` | `id`, `shipment_id`, `inventory_batch_id`, `allocated_cost` | Proportional inbound shipping cost per batch |
| `supplier_returns` | `id`, `supplier_id`, `seller_id`, `reason`, `status` | |
| `supplier_return_items` | `id`, `return_id`, `inventory_batch_id`, `quantity` | |
| `supplier_return_shipments` | `id`, `return_id`, `supplier_id`, `shipping_cost`, `status` | Outbound return shipments TO supplier |
| `supplier_return_shipment_items` | `id`, `shipment_id`, `inventory_batch_id`, `quantity` | |
| `return_shipment_cost_allocations` | `id`, `shipment_id`, `inventory_batch_id`, `allocated_cost` | Proportional return shipping cost per batch |
| `supplier_replacements` | `id`, `return_id`, `shipment_id`, `status` | Replacement goods sent back BY supplier |

---

## File Structure

```
src/
├── config/
│   └── supabase.ts              # Supabase anon + admin clients
├── controllers/
│   ├── adminController.ts       # Dashboard, sales report, inventory
│   ├── analyticsController.ts   # Supplier analytics, cost analysis
│   ├── authController.ts        # register, login, logout, me, updateMe
│   ├── cartController.ts        # Cart + wishlist
│   ├── categoriesController.ts  # RESTful category CRUD
│   ├── categoryController.ts    # Legacy category routes
│   ├── costsController.ts       # Inbound + return shipment cost allocation
│   ├── inventoryController.ts   # Inventory summary, by-product, batch detail
│   ├── orderController.ts       # Orders + payments
│   ├── productController.ts     # Legacy product routes
│   ├── productsController.ts    # RESTful product + variant CRUD
│   ├── purchaseOrderController.ts # Purchase orders
│   ├── reviewController.ts      # Product reviews
│   ├── sellersController.ts     # seller_profiles + sellers
│   ├── shipmentController.ts    # Customer shipments
│   ├── supplierController.ts    # Supplier CRUD
│   ├── supplierProductController.ts # Supplier-product mappings
│   ├── supplierReplacementController.ts # Supplier replacements
│   ├── supplierReturnController.ts # Supplier returns
│   ├── supplierReturnShipmentController.ts # Return shipments
│   ├── supplierShipmentController.ts # Inbound shipments + inventory batch intake
│   ├── traceController.ts       # Supply-chain traceability
│   ├── uploadController.ts      # Image upload to Supabase Storage
│   └── usersController.ts       # User management (admin)
├── middleware/
│   ├── auth.ts                  # requireAuth, requireRole, authenticate
│   └── errorHandler.ts          # AppError, errorHandler, notFoundHandler
├── routes/
│   ├── adminRoutes.ts           # Per-route guards (see bug fix below)
│   ├── addressRoutes.ts
│   ├── analyticsRoutes.ts
│   ├── authRoutes.ts
│   ├── cartRoutes.ts
│   ├── categoriesRoutes.ts
│   ├── categoryRoutes.ts        # Legacy
│   ├── costsRoutes.ts
│   ├── inventoryRoutes.ts
│   ├── orderRoutes.ts
│   ├── productRoutes.ts         # Legacy
│   ├── productsRoutes.ts
│   ├── purchaseOrderRoutes.ts
│   ├── reviewRoutes.ts
│   ├── sellersRoutes.ts
│   ├── shipmentRoutes.ts
│   ├── supplierProductRoutes.ts
│   ├── supplierReplacementRoutes.ts
│   ├── supplierReturnRoutes.ts
│   ├── supplierReturnShipmentRoutes.ts
│   ├── supplierRoutes.ts
│   ├── supplierShipmentRoutes.ts
│   ├── traceRoutes.ts
│   ├── uploadRoutes.ts
│   └── usersRoutes.ts
├── types/
│   ├── address.ts
│   ├── cart.ts
│   ├── index.ts                 # Core interfaces + Express augmentation
│   ├── order.ts
│   ├── purchaseOrder.ts
│   ├── review.ts
│   ├── seller.ts
│   ├── shipment.ts
│   ├── supplier.ts
│   ├── supplierProduct.ts
│   ├── supplierReplacement.ts
│   ├── supplierReturn.ts
│   ├── supplierReturnShipment.ts
│   ├── supplierShipment.ts
│   └── ...
├── validators/
│   ├── addressValidators.ts
│   ├── authValidators.ts
│   ├── cartValidators.ts
│   ├── index.ts                 # Product + category Zod schemas
│   ├── orderValidators.ts
│   ├── purchaseOrderValidators.ts
│   ├── reviewValidators.ts
│   ├── sellerValidators.ts
│   ├── shipmentValidators.ts
│   ├── supplierProductValidators.ts
│   ├── supplierReplacementValidators.ts
│   ├── supplierReturnShipmentValidators.ts
│   ├── supplierReturnValidators.ts
│   ├── supplierShipmentValidators.ts
│   └── supplierValidators.ts
└── index.ts                     # App entry point + route registration order
```

---

## Route Registration Order

Route order in `src/index.ts` is critical. Routers with a blanket
`router.use(requireAuth)` will intercept requests to other routers if registered
too early. Always register **public and per-route-guarded routers BEFORE**
blanket-auth routers.

```
authRoutes                    public
categoriesRoutes              per-route (public GETs, admin writes)
productsRoutes                per-route (public GETs, admin/seller writes)
reviewRoutes                  per-route (public GET, auth writes)
sellersRoutes                 per-route (public GET /seller-profiles)
supplierRoutes                per-route (seller+)
supplierProductRoutes         per-route (seller+)
purchaseOrderRoutes           per-route (seller+)
supplierShipmentRoutes        per-route (seller+)
supplierReturnRoutes          per-route (seller+)
supplierReturnShipmentRoutes  per-route (seller+)
supplierReplacementRoutes     per-route (seller+)
traceRoutes                   per-route (seller+)
analyticsRoutes               per-route (seller+)
inventoryRoutes               per-route (seller+)
costsRoutes                   per-route (seller+)
adminRoutes                   per-route (admin only — see bug fix below)
productRoutes (legacy)        blanket requireAuth
categoryRoutes (legacy)       blanket requireAuth
uploadRoutes                  blanket requireAuth
usersRoutes                   blanket requireAuth + requireRole("admin")
addressRoutes                 blanket requireAuth
cartRoutes                    blanket requireAuth
shipmentRoutes                per-route
orderRoutes                   per-route
```

> **Known Bug Fixed:** `adminRoutes.ts` previously used `router.use(requireAuth, requireRole("admin"))` without a path prefix, which caused the admin guard to intercept requests to `/api/cart` and other unrelated routes, returning 403. This was fixed by converting to per-route guards on each handler.

---

## Key Schema Notes

- `products.seller_id` references `seller_profiles.id` — **not** `sellers.id`. To resolve which products a seller owns: `sellers WHERE user_id = req.user.id → get seller_profile_id → products WHERE seller_id = seller_profile_id`.
- `cart.product_id` and `wishlist.product_id` both FK to `product_variants.id`, not `products.id`.
- `order_details.product_id` also references `product_variants.id`.
- `shipment` has **no `order_id` column**. The FK lives on `orders.shipment_id → shipment.id`. Pass `order_id` in the POST body so the controller can update `orders.shipment_id` after insert.
- `category.id` is `bigint`, while all product, variant, and seller IDs are `uuid`.
- Supabase PostgREST returns FK joins as arrays even for one-to-one relationships. Always handle both shapes: `const product = Array.isArray(data.products) ? data.products[0] : data.products`.

---

## Security Notes

- The **service role key** bypasses Supabase RLS — only used server-side, never exposed to clients
- All JWT tokens are **verified server-side** via Supabase's `/auth/v1/user` endpoint, not just decoded locally — revoked tokens are rejected correctly
- Request bodies are **size-limited to 1 MB** to prevent denial-of-service attacks
- **CORS** is restricted to the `ALLOWED_ORIGINS` whitelist; preflight OPTIONS requests are handled explicitly
- **Helmet** sets secure HTTP headers (CSP, HSTS, X-Frame-Options, etc.)
- **Suspended users** are blocked at the `requireAuth` middleware level
- Ownership is enforced at the **controller level**: users can only read/modify their own cart, wishlist, orders, addresses, and reviews — returning 404 (not 403) to avoid leaking existence of other users' records
- Seller write operations verify `sellers.seller_profile_id === products.seller_id` before allowing any modification
- In production, error **stack traces** are suppressed from API responses
- Payment webhook validation uses `PAYMENT_WEBHOOK_SECRET` to authenticate gateway callbacks
- Image uploads are validated by both MIME type (multer `fileFilter`) and file extension (controller), capped at 5 MB

---

## Known Issues & Pending Work

| Item | Priority | Notes |
|---|---|---|
| Add `'cancelled'` to `order_status_enum` | High | `cancelOrder` sets `status: 'cancelled'` but the DB enum may not include this value. Add the enum value or change to a hard-delete. |
| Payment gateway integration | High | `POST /api/payments/verify` is a placeholder webhook. Integrate real HMAC signature validation from your gateway. |
| Refund gateway call | Medium | `refundPayment` marks the DB record but does not call a payment gateway API. Add the real refund call before the DB update. |
| Rate limiting | Medium | Add `express-rate-limit` to auth endpoints (login, register, forgot-password) to prevent brute force. |
| Pagination on admin analytics | Low | `getDashboard` loads all `order_details` to compute top products. Add a SQL-side aggregation for large datasets. |
| Order status webhook | Low | No outbound notification when order status changes. Add webhook/email notifications on `shipped`/`delivered`. |
| Seller product ownership on admin create | Low | `POST /api/products` (admin) accepts any `seller_id`. Consider validating the seller exists and is active. |
