# E-Commerce Admin API

Production-ready Node.js + Express + TypeScript backend for a multi-role
e-commerce platform. Built on Supabase (PostgreSQL) with JWT authentication,
Zod validation, and per-route role enforcement.

---

## Stack

| Layer | Technology |
|---|---|
| Runtime | Node.js + TypeScript |
| Framework | Express 4 |
| Database | Supabase (PostgreSQL) |
| Auth | Supabase JWT (RS256), verified server-side |
| Validation | Zod |
| Security | Helmet, CORS whitelist |

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
| `seller` | 2 | Customer + product/variant management for own products |
| `admin` | 3 | Full access to all endpoints |

Routes marked **auth** require any valid JWT. Routes marked **seller** require
`seller` role or above. Routes marked **admin** require `admin` role only.

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
| POST | `/api/auth/register` | public | Create account. Body: `{ email, password, first_name, last_name?, role_name: "admin"\|"seller", seller_profile?: { seller_profile_id } }`. Inserts `user_role` (status: `pending`). If seller, inserts `sellers` row linking to the chosen `seller_profile_id`. |
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
| GET | `/api/categories` | public | Full category tree (hierarchical). Supports `?is_active=`. |
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
| GET | `/api/seller/products` | seller | The authenticated seller's own product list (resolved via `sellers.seller_profile_id`). |
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
| PUT | `/api/products/:id/variants/:vid` | seller | Update variant details (not stock or discount — use dedicated endpoints). |
| PATCH | `/api/products/:id/variants/:vid/stock` | seller | Update stock quantity. Body: `{ stock: integer >= 0 }`. |
| PATCH | `/api/products/:id/variants/:vid/discount` | seller | Set discount. Body: `{ discount_type: "percentage"\|"fixed"\|null, discount_value: number\|null }`. Send both as `null` to clear. |
| DELETE | `/api/products/:id/variants/:vid` | seller | Soft-deactivate variant (`is_active: false`, `status: "archived"`). |

#### Legacy admin-panel products

| Method | Endpoint | Role | Description |
|---|---|---|---|
| GET | `/api/products` | auth | Paginated products (20/page) with variants. |
| POST | `/api/product/add` | auth | Create product + variants (transaction-like rollback). |
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

All routes require **auth**. Cart and wishlist are scoped to the authenticated user — `user_id` always comes from the JWT.

#### Cart

`cart` table columns: `id`, `user_id`, `product_id`, `quantity`, `created_at`, `updated_at`

| Method | Endpoint | Role | Description |
|---|---|---|---|
| GET | `/api/cart` | auth | Current user's cart with product info and computed `subtotal`. |
| POST | `/api/cart` | auth | Add product to cart. Body: `{ product_id, quantity? }`. Increments quantity if product already in cart. Validates product is active. |
| PUT | `/api/cart/:id` | auth | Update quantity of a cart item. Body: `{ quantity: integer >= 1 }`. Ownership enforced. |
| DELETE | `/api/cart/:id` | auth | Hard-delete a single cart item. |
| DELETE | `/api/cart` | auth | Hard-delete all cart items (clear cart). |

#### Wishlist

`wishlist` table columns: `id`, `user_id`, `product_id`, `created_at`, `deleted_at`

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
| GET | `/api/orders/:id` | auth | Order details with line items and joined addresses. Ownership enforced for non-admins. |
| PATCH | `/api/orders/:id/status` | admin | Update order status. Body: `{ status: "pending"\|"shipped"\|"delivered" }`. Forward-only transitions enforced (`pending → shipped → delivered`). |
| DELETE | `/api/orders/:id` | auth | Cancel an order. Only `pending` orders can be cancelled. |
| GET | `/api/orders/:id/items` | auth | Line items (`order_details`) for an order. |
| GET | `/api/orders/:id/payment` | auth | Payment record for an order. |
| GET | `/api/seller/orders` | seller | Orders containing the seller's products (resolved via `sellers.seller_profile_id`). Supports `?page=` `?limit=`. |

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
| GET | `/api/shipments/:id` | auth | Shipment details joined with delivery address. Non-admins can only access shipments for their own orders. |
| POST | `/api/shipments` | admin | Create a shipment. Body: `{ order_id, address_id, shipment_date? }`. Updates `orders.shipment_id` after insert. One shipment per order (409 on duplicate). |
| PATCH | `/api/shipments/:id` | admin | Update `shipment_date` and/or `address_id`. At least one field required. Validates address exists. |
| GET | `/api/orders/:id/shipment` | auth | Shipment for a specific order (resolved via `orders.shipment_id`). |

---

### Addresses — `/api/addresses`

All routes require **auth**. Users can only access their own addresses.

| Method | Endpoint | Role | Description |
|---|---|---|---|
| GET | `/api/addresses` | auth | List the authenticated user's addresses. |
| POST | `/api/addresses` | auth | Create an address. Body: `{ street_address, city, state, pin_code, country, land_mark?, address_type: "billing"\|"shipping" }`. |
| PUT | `/api/addresses/:id` | auth | Update an address. Ownership enforced. |
| DELETE | `/api/addresses/:id` | auth | Delete an address. Ownership enforced. |

---

### File Upload — `/api/upload`

| Method | Endpoint | Role | Description |
|---|---|---|---|
| POST | `/api/upload/image` | auth | Upload an image to Supabase Storage. Request: `multipart/form-data` with field `image`. Returns `{ url }` — the public URL of the stored image. |

---

### Admin Analytics — `/api/admin`

All routes require **admin** role.

| Method | Endpoint | Role | Description |
|---|---|---|---|
| GET | `/api/admin/dashboard` | admin | KPIs for the current period: total/monthly revenue (with MoM comparison), order counts by status, user counts by role, top 5 products by units sold. |
| GET | `/api/admin/sales-report` | admin | Aggregated sales report. Query params: `?from=YYYY-MM-DD` `?to=YYYY-MM-DD` (default: current month) `?group_by=day\|month`. Returns time-series breakdown, revenue by payment type, revenue by category. |
| GET | `/api/admin/inventory` | admin | Low-stock variants. Query params: `?threshold=<n>` (default: 10) `?seller_id=<uuid>` `?page=` `?limit=`. Returns variant + product + seller business name. |

---

## Database Table Summary

| Table | Key Columns | Notes |
|---|---|---|
| `user_role` | `id`, `first_name`, `last_name`, `role_name`, `status`, `is_seller_partner`, `seller_id`, `tagged_seller_partner_id` | FK → `auth.users(id)` |
| `seller_profiles` | `id`, `business_name`, `contact_name`, `email`, `phone`, `description`, `is_verified`, `status` | Business identity, admin-managed |
| `sellers` | `id`, `user_id`, `seller_profile_id`, `status` | Links a user to a seller_profile |
| `products` | `id`, `seller_id`, `name`, `product_code`, `category_id`, `gender`, `is_active` | `seller_id` → `seller_profiles.id` |
| `product_variants` | `id`, `product_id`, `sku`, `color`, `size`, `material`, `base_price`, `stock`, `status`, `discount_type`, `discount_value` | |
| `category` | `id`, `category_name`, `parent_category_id`, `is_active` | Hierarchical tree |
| `product_reviews` | `id`, `user_id`, `product_id`, `product_variant_id`, `rating`, `review_title`, `review_text`, `is_verified_purchase`, `is_approved` | |
| `cart` | `id`, `user_id`, `product_id`, `quantity` | Hard-deleted on clear/checkout |
| `wishlist` | `id`, `user_id`, `product_id`, `deleted_at` | Soft-delete via `deleted_at` |
| `orders` | `id`, `user_id`, `amount`, `order_date`, `status`, `shipping_address_id`, `billing_address_id`, `payment_id`, `shipment_id` | |
| `order_details` | `id`, `order_id`, `product_id`, `quantity`, `unit_price` | Price captured at order time |
| `payment` | `id`, `type`, `amount`, `payment_date`, `order_id`, `transaction_id` | |
| `shipment` | `id`, `shipment_date`, `address_id` | `orders.shipment_id` is the FK |
| `address` | `id`, `user_id`, `street_address`, `city`, `state`, `pin_code`, `country`, `land_mark`, `address_type` | |

---

## File Structure

```
src/
├── config/
│   └── supabase.ts              # Supabase anon + admin clients
├── controllers/
│   ├── adminController.ts       # Dashboard, sales report, inventory
│   ├── authController.ts        # register, login, logout, me, updateMe
│   ├── cartController.ts        # Cart + wishlist
│   ├── categoriesController.ts  # RESTful category CRUD
│   ├── categoryController.ts    # Legacy category routes
│   ├── orderController.ts       # Orders + payments
│   ├── productController.ts     # Legacy product routes
│   ├── productsController.ts    # RESTful product + variant CRUD
│   ├── reviewController.ts      # Product reviews
│   ├── sellersController.ts     # seller_profiles + sellers
│   ├── shipmentController.ts    # Shipments
│   ├── uploadController.ts      # Image upload to Supabase Storage
│   └── usersController.ts       # User management (admin)
├── middleware/
│   ├── auth.ts                  # requireAuth, requireRole, authenticate
│   └── errorHandler.ts          # AppError, errorHandler, notFoundHandler
├── routes/
│   ├── adminRoutes.ts
│   ├── addressRoutes.ts
│   ├── authRoutes.ts
│   ├── cartRoutes.ts
│   ├── categoriesRoutes.ts
│   ├── categoryRoutes.ts        # Legacy
│   ├── orderRoutes.ts
│   ├── productRoutes.ts         # Legacy
│   ├── productsRoutes.ts
│   ├── reviewRoutes.ts
│   ├── sellersRoutes.ts
│   ├── shipmentRoutes.ts
│   ├── uploadRoutes.ts
│   └── usersRoutes.ts
├── types/
│   ├── address.ts
│   ├── cart.ts
│   ├── index.ts                 # Core interfaces + Express augmentation
│   ├── order.ts
│   ├── review.ts
│   ├── seller.ts
│   └── shipment.ts
├── validators/
│   ├── addressValidators.ts
│   ├── authValidators.ts
│   ├── cartValidators.ts
│   ├── index.ts                 # Product + category Zod schemas
│   ├── orderValidators.ts
│   ├── reviewValidators.ts
│   ├── sellerValidators.ts
│   └── shipmentValidators.ts
└── index.ts                     # App entry point + route registration
```

---

## Security Notes

- The **service role key** bypasses Supabase RLS — only used server-side, never exposed to clients
- All JWT tokens are **verified server-side** via Supabase's `/auth/v1/user` endpoint, not just decoded locally — revoked tokens are rejected correctly
- Request bodies are **size-limited to 1 MB** to prevent denial-of-service attacks
- **CORS** is restricted to the `ALLOWED_ORIGINS` whitelist; preflight OPTIONS requests are handled explicitly
- **Helmet** sets secure HTTP headers (CSP, HSTS, X-Frame-Options, etc.)
- **Suspended users** are blocked at the `requireAuth` middleware level — they cannot access any protected route
- Ownership is enforced at the **controller level**: users can only read/modify their own cart, wishlist, orders, addresses, and reviews — returning 404 (not 403) to avoid leaking existence of other users' records
- Seller write operations verify `sellers.seller_profile_id === products.seller_id` before allowing any modification
- In production, error **stack traces** are suppressed from API responses
- Payment webhook validation uses `PAYMENT_WEBHOOK_SECRET` to authenticate gateway callbacks
