require("dotenv").config({ quiet: true });
const path = require("path");
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const pinoHttp = require("pino-http");
const logger = require("./lib/logger");

// Fail fast if critical env vars are missing
if (!process.env.JWT_SECRET) {
  console.error("Missing JWT_SECRET in .env — see .env.example");
  process.exit(1);
}

const IS_PRODUCTION = process.env.NODE_ENV === "production";

const authRoutes = require("./routes/auth");
const menuItemRoutes = require("./routes/menuItems");
const tableRoutes = require("./routes/tables");
const orderRoutes = require("./routes/orders");
const inventoryRoutes = require("./routes/inventory");
const customerRoutes = require("./routes/customers");
const supplierRoutes = require("./routes/suppliers");
const employeeRoutes = require("./routes/employees");
const settingsRoutes = require("./routes/settings");
const reportRoutes = require("./routes/reports");
const activityRoutes = require("./routes/activity");
const receiptRoutes = require("./routes/receipts");

const app = express();

// Only enable when actually deployed behind a reverse proxy (nginx, Render,
// Railway, ...). Without this, express-rate-limit reads the proxy's IP for
// every request instead of the real client's, so all visitors share one
// rate-limit bucket. Enabling it when there is NO proxy in front is a
// spoofing risk (clients could fake X-Forwarded-For), so it's opt-in.
if (process.env.TRUST_PROXY === "true") {
  app.set("trust proxy", 1);
}

app.use(pinoHttp({ logger, autoLogging: { ignore: (req) => req.url === "/api/health" } }));

// Security headers. The frontend is a single self-contained HTML page that
// loads React/Babel from cdnjs and runs its own JSX in an inline <script>
// (no build step, no bundler) — so unlike a typical app, script-src and
// style-src need 'unsafe-inline' or the page simply won't run. Everything
// else stays locked to 'self'.
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "https://cdnjs.cloudflare.com", "'unsafe-inline'", "'unsafe-eval'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", "data:"],
        connectSrc: ["'self'", "https://cdnjs.cloudflare.com"],
        fontSrc: ["'self'"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        frameAncestors: ["'self'"],
      },
    },
  })
);

const allowedOrigins = (process.env.CORS_ORIGIN || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

// In production, an unset CORS_ORIGIN must NOT silently fall back to
// "allow every origin" — that's the kind of misconfiguration that's easy to
// ship by accident and expensive to have missed. Fail fast instead, same as
// the JWT_SECRET check above. Non-production keeps the permissive default
// so local development doesn't need any CORS setup at all.
if (IS_PRODUCTION && allowedOrigins.length === 0) {
  console.error(
    "NODE_ENV=production but CORS_ORIGIN is not set — refusing to start with an " +
      "allow-all CORS policy in production. Set CORS_ORIGIN in .env (comma-separated " +
      "if more than one), e.g. CORS_ORIGIN=https://your-domain.com"
  );
  process.exit(1);
}

app.use(
  cors({
    origin: allowedOrigins.length ? allowedOrigins : true,
  })
);
app.use(express.json());

// A generous global ceiling on the whole API, on top of the stricter
// per-route limiters (login, refresh). Mainly a backstop against a runaway
// client or a scraping/abuse attempt, not something a normal user should
// ever notice.
app.use(
  "/api",
  rateLimit({
    windowMs: 60 * 1000,
    limit: 300,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "Too many requests. Please slow down." },
  })
);

app.get("/api/health", (req, res) => res.json({ ok: true, time: new Date().toISOString() }));

app.use("/api/auth", authRoutes);
app.use("/api/menu-items", menuItemRoutes);
app.use("/api/tables", tableRoutes);
app.use("/api/orders", orderRoutes);
app.use("/api/inventory", inventoryRoutes);
app.use("/api/customers", customerRoutes);
app.use("/api/suppliers", supplierRoutes);
app.use("/api/employees", employeeRoutes);
app.use("/api/settings", settingsRoutes);
app.use("/api/reports", reportRoutes);
app.use("/api/activity", activityRoutes);
app.use("/api/orders", receiptRoutes); // adds GET /api/orders/:id/receipt

// Serve the connected frontend (public/index.html + any assets) from the same
// server, so the app works same-origin with no CORS/API-URL config needed.
app.use(express.static(path.join(__dirname, "..", "public")));

// 404 handler
app.use((req, res) => res.status(404).json({ error: "Not found" }));

// Error handler
app.use((err, req, res, next) => {
  (req.log || logger).error({ err }, "unhandled request error");
  res.status(500).json({ error: "Internal server error" });
});

const PORT = process.env.PORT || 4000;

if (require.main === module) {
  app.listen(PORT, () => {
    logger.info(`Mahumbezi API listening on port ${PORT}`);
  });
}

module.exports = app;
