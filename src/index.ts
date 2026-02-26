import "dotenv/config";
import express from "express";
import cors from "cors";
import helmet from "helmet";

import productRoutes from "./routes/productRoutes";
import categoryRoutes from "./routes/categoryRoutes";
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

app.use(
  cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (e.g. mobile apps, curl in dev)
      if (!origin) return callback(null, true);
      if (allowedOrigins.includes(origin)) {
        return callback(null, true);
      }
      callback(new Error(`CORS policy: origin ${origin} is not allowed`));
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

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
app.use("/api", productRoutes);
app.use("/api", categoryRoutes);

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
