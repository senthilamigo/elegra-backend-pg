# E-Commerce Admin API

Production-ready Node.js + Express backend for an e-commerce admin app.

## Stack
- **Runtime**: Node.js + TypeScript
- **Framework**: Express
- **Database**: Supabase (PostgreSQL)
- **Auth**: Supabase JWT (RS256)
- **Validation**: Zod
- **Security**: Helmet, CORS whitelist

---

## Setup

```bash
# 1. Install dependencies
npm install

# 2. Configure environment
cp .env.example .env
# Fill in your Supabase URL and keys

# 3. Dev server (hot reload)
npm run dev

# 4. Production build
npm run build && npm start
```

---

## Environment Variables

| Variable | Description |
|---|---|
| `SUPABASE_URL` | Your Supabase project URL |
| `SUPABASE_ANON_KEY` | Public anon key (safe for client) |
| `SUPABASE_SERVICE_ROLE_KEY` | Admin key — **never expose to client** |
| `PORT` | Server port (default: 3000) |
| `NODE_ENV` | `development` or `production` |
| `ALLOWED_ORIGINS` | Comma-separated CORS whitelist |

---

## API Reference

All routes require `Authorization: Bearer <supabase_jwt_token>` header.

### Products

| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/products?page=1` | Paginated products (20/page) with variants |
| POST | `/api/product/add` | Create product + variants |
| PUT | `/api/product/update` | Update product + upsert variants |
| DELETE | `/api/product/remove/:id` | Delete product + all variants |

### Categories

| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/category` | All categories (flat list) |
| POST | `/api/category/add` | Create category |
| PUT | `/api/category/update` | Update category |
| DELETE | `/api/category/remove/:id` | Delete category (blocked if in use) |

---

## Example Requests

### Add a product
```json
POST /api/product/add
{
  "name": "Classic T-Shirt",
  "description": "100% cotton",
  "category_id": 1,
  "seller_id": 1,
  "gender": "unisex",
  "product_code": "TS-001",
  "is_active": true,
  "variants": [
    {
      "sku": "TS-001-BLK-M",
      "color": "Black",
      "size": "M",
      "base_price": 29.99,
      "stock": 100,
      "status": "active"
    }
  ]
}
```

### Paginated products response
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

## File Structure

```
src/
├── config/
│   └── supabase.ts        # Supabase client setup (anon + admin)
├── controllers/
│   ├── productController.ts
│   └── categoryController.ts
├── middleware/
│   ├── auth.ts            # JWT verification via Supabase
│   └── errorHandler.ts    # Global error + 404 handler
├── routes/
│   ├── productRoutes.ts
│   └── categoryRoutes.ts
├── types/
│   └── index.ts           # TypeScript interfaces + Express augmentation
├── validators/
│   └── index.ts           # Zod schemas
└── index.ts               # App entry point
```

---

## Security Notes

- The **service role key** bypasses Supabase RLS — only used server-side, never exposed
- All JWT tokens are **verified server-side** via Supabase's API, not just decoded
- Request bodies are **size-limited** (1mb) to prevent DoS
- **CORS** is restricted to `ALLOWED_ORIGINS` whitelist
- **Helmet** sets secure HTTP headers by default
- In production, error **stack traces** are suppressed in API responses
- Category deletion is **guarded** against orphaned products/sub-categories
