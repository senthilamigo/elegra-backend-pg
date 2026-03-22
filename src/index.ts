/**
 * File: src/index.ts
 * Path: ecommerce-admin/src/index.ts
 *
 * Express application entry point.
 * Registers all middleware, routes, and starts the HTTP server.
 */
import "dotenv/config";
import express from "express";
import cors from "cors";
import helmet from "helmet";

import productRoutes  from "./routes/productRoutes";
import categoryRoutes from "./routes/categoryRoutes";
import categoriesRoutes from "./routes/categoriesRoutes";
import uploadRoutes   from "./routes/uploadRoutes";
import authRoutes     from "./routes/authRoutes";
import usersRoutes    from "./routes/usersRoutes";
import addressRoutes  from "./routes/addressRoutes";
import sellersRoutes  from "./routes/sellersRoutes";
import productsRoutes from "./routes/productsRoutes";
import { errorHandler, notFoundHandler } from "./middleware/errorHandler";

const app = express();
const PORT = process.env.PORT ?? 3000;

// ─────────────────────────────────────────────
// Security Middleware
// ─────────────────────────────────────────────

/**
 * Helmet sets security-related HTTP headers:
 * - X-Content-Type-Options: nosniff
 * - X-Frame-Options: DENY
 * - Strict-Transport-Security (HSTS) in production
 * - Content-Security-Policy defaults
 */
app.use(helmet());

/**
 * CORS Configuration
 *
 * Security considerations:
 * - Only whitelisted origins are allowed (set ALLOWED_ORIGINS env var)
 * - Credentials (cookies) are allowed so frontend can use httpOnly cookies for tokens
 * - Avoid using origin: '*' in production as it defeats CORS protections
 */
const allowedOrigins = (process.env.ALLOWED_ORIGINS ?? "http://localhost:5173")
  .split(",")
  .map((o) => o.trim());

const corsOptions = {
  origin: (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => {
    // Allow requests with no origin (e.g. curl, mobile apps, server-to-server)
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin)) return callback(null, true);
    callback(new Error(`CORS policy: origin ${origin} is not allowed`));
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
};

app.use(cors(corsOptions));

/**
 * Explicitly handle OPTIONS preflight requests for ALL routes.
 * Without this, Express does not respond to browser preflight checks,
 * causing redirects or silence — both of which browsers reject as a CORS failure.
 * Must be registered AFTER the cors() middleware above.
 */
app.options("*", cors(corsOptions));

// ─────────────────────────────────────────────
// Body Parsing
// ─────────────────────────────────────────────

/**
 * Limit request body to 1mb to prevent denial-of-service via large payloads.
 * Adjust if you need to accept base64-encoded images in JSON bodies.
 */
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true, limit: "1mb" }));

// ─────────────────────────────────────────────
// Health check (no auth required)
// ─────────────────────────────────────────────
app.get("/health", (_req, res) => {
  res.status(200).json({ status: "ok", timestamp: new Date().toISOString() });
});

// ─────────────────────────────────────────────
// API Routes
// ─────────────────────────────────────────────
// IMPORTANT: public routes must be registered BEFORE any router that uses
// a blanket router.use(requireAuth) with no path prefix (productRoutes,
// categoryRoutes, uploadRoutes). Express passes a request through every
// router mounted at a matching prefix in registration order. If a router
// with blanket requireAuth is reached first, it runs requireAuth even if
// that router has no matching route — causing 401 on public endpoints.
app.use("/api", authRoutes);        // public: /auth/register, /auth/login, etc.
app.use("/api", categoriesRoutes);  // public GETs + admin writes (per-route guards)
app.use("/api", productsRoutes);   // per-route guards — public GETs + admin/seller writes
app.use("/api", productRoutes);     // blanket requireAuth inside — must come after public routes
app.use("/api", categoryRoutes);    // blanket requireAuth inside
app.use("/api", uploadRoutes);      // blanket requireAuth inside
app.use("/api", usersRoutes);       // blanket requireAuth + requireRole("admin") inside
app.use("/api", addressRoutes);     // blanket requireAuth inside
app.use("/api", sellersRoutes);     // per-route requireAuth + requireRole inside

// ─────────────────────────────────────────────
// Error Handling (must be last)
// ─────────────────────────────────────────────
app.use(notFoundHandler);
app.use(errorHandler);

// ─────────────────────────────────────────────
// Start server
// ─────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT} in ${process.env.NODE_ENV ?? "development"} mode`);
});

export default app;
