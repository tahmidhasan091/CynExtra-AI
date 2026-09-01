"use strict";

const path = require("path");
const { createRateLimiter } = require("./middleware/rateLimit");
const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");

dotenv.config({ path: path.join(__dirname, ".env") });

const apiRouter = require("./routes/api");
const knowledge = require("./ai/knowledge");
const memory = require("./ai/memory");

const app = express();
const IS_PRODUCTION = String(process.env.NODE_ENV || "development").toLowerCase() === "production";

if (IS_PRODUCTION) {
  const required = ["AUTH_SECRET", "ADMIN_KEY", "AI_API_KEY", "AI_BASE_URL", "AI_MODEL"];
  const missing = required.filter((key) => !String(process.env[key] || "").trim());
  if (missing.length) {
    console.error(`Production configuration missing: ${missing.join(", ")}`);
    process.exit(1);
  }
  if (String(process.env.AUTH_SECRET).trim().length < 32) {
    console.error("AUTH_SECRET must be at least 32 characters in production.");
    process.exit(1);
  }
  if (String(process.env.ADMIN_KEY).trim().length < 32) {
    console.error("ADMIN_KEY must be at least 32 characters in production.");
    process.exit(1);
  }
}

app.set("trust proxy", IS_PRODUCTION ? 1 : false);

const parsedPort = Number.parseInt(process.env.PORT, 10);
const PORT =
  Number.isInteger(parsedPort) && parsedPort > 0 && parsedPort <= 65535
    ? parsedPort
    : 3000;

app.disable("x-powered-by");

app.use(
  cors({
    origin(origin, callback) {
      // Same-origin requests and local Acode/Android previews do not need
      // credentials and are allowed. Arbitrary remote origins are rejected.
      if (!origin) return callback(null, true);
      if (origin === "capacitor://localhost" || origin === "http://localhost" || origin === "https://localhost") return callback(null, true);
      try {
        const url = new URL(origin);
        const host = url.hostname.toLowerCase();
        const isLocalHost = host === "localhost" || host === "127.0.0.1" || host === "[::1]";
        const allowedOrigins = String(process.env.CORS_ORIGINS || "").split(",").map((x) => x.trim()).filter(Boolean);
        if (!IS_PRODUCTION && isLocalHost) return callback(null, true);
      if (allowedOrigins.includes(origin)) return callback(null, true);
      } catch {
        // Invalid Origin values are rejected below.
      }
      return callback(new Error("CORS origin is not allowed."));
    },
    methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "X-CynExtra-Request"]
  })
);

app.use(
  express.json({
    limit: process.env.JSON_BODY_LIMIT || "24mb",
    strict: true,
    verify(req, res, buf) {
      req.rawBody = Buffer.from(buf);
    }
  })
);

app.use(
  express.urlencoded({
    extended: false,
    limit: "50kb"
  })
);

app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Permissions-Policy", "camera=(), geolocation=(), payment=(), usb=()");
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
  if (IS_PRODUCTION) res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  next();
});

// Serve only the frontend. Never expose backend/.env, source data, or server code.
const frontendRoot = path.resolve(__dirname, "..");
app.use((req, res, next) => {
  const firstSegment = String(req.path || "").split("/").filter(Boolean)[0]?.toLowerCase();
  const blocked = new Set(["backend", ".env", ".git", "node_modules"]);
  if (blocked.has(firstSegment) || firstSegment?.startsWith(".env")) {
    return res.status(404).json({ success: false, error: "Route not found" });
  }
  return next();
});
app.use(express.static(frontendRoot, { dotfiles: "deny" }));

app.get("/health", (req, res) => {
  return res.status(200).json({
    success: true,
    service: "CynExtra-AI Backend",
    status: "healthy"
  });
});

const apiRateLimiter = createRateLimiter({
  windowMs: Number.parseInt(process.env.RATE_LIMIT_WINDOW_MS || "60000", 10),
  max: Number.parseInt(process.env.RATE_LIMIT_MAX || "120", 10)
});
app.use("/api", apiRateLimiter, apiRouter);

// SPA-style fallback for HTML pages (Express 5 compatible)
app.use((req, res, next) => {
  if (req.method !== "GET" && req.method !== "HEAD") return next();
  if (req.path.startsWith("/api")) return next();
  // Prefer existing static files; only fall through for missing HTML routes
  const requested = req.path === "/" ? "index.html" : req.path.replace(/^\/+/, "");
  const file = path.resolve(frontendRoot, requested);
  const relative = path.relative(frontendRoot, file);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    return res.status(404).json({ success: false, error: "Route not found" });
  }
  res.sendFile(file, (err) => {
    if (err) {
      // Avoid leaking filesystem details
      return res.status(404).json({ success: false, error: "Route not found" });
    }
  });
});

app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  if (
    err instanceof SyntaxError &&
    err.status === 400 &&
    err.type === "entity.parse.failed"
  ) {
    return res.status(400).json({
      success: false,
      error: "Invalid JSON request body."
    });
  }
  if (err.type === "entity.too.large") {
    return res.status(413).json({
      success: false,
      error: "Request body is too large."
    });
  }
  console.error("Unhandled server error:", err);
  return res.status(500).json({
    success: false,
    error: "Internal server error"
  });
});

async function start() {
  try {
    await memory.ensureDataFiles();
    await knowledge.ensureKnowledgeFile();
  } catch (e) {
    console.warn("Data init warning:", e.message);
  }

  const server = app.listen(PORT, () => {
    console.log(`CynExtra-AI backend running on http://localhost:${PORT}`);
    console.log(`API base: http://localhost:${PORT}/api`);
    console.log(`Environment: ${IS_PRODUCTION ? "production" : "development"}`);
  });

  const shutdown = (signal) => {
    console.log(`${signal} received; shutting down gracefully.`);
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 10000).unref();
  };
  process.once("SIGTERM", () => shutdown("SIGTERM"));
  process.once("SIGINT", () => shutdown("SIGINT"));
}

start().catch((error) => {
  console.error("Startup failed:", error.message);
  process.exit(1);
});
