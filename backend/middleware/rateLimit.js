"use strict";

function createRateLimiter({ windowMs = 60_000, max = 60, keyGenerator } = {}) {
  const buckets = new Map();

  function cleanup(now) {
    for (const [key, bucket] of buckets) {
      if (now - bucket.startedAt >= windowMs) buckets.delete(key);
    }
  }

  return function rateLimiter(req, res, next) {
    const now = Date.now();
    cleanup(now);
    const key = keyGenerator ? keyGenerator(req) : (req.ip || "unknown");
    let bucket = buckets.get(key);
    if (!bucket || now - bucket.startedAt >= windowMs) {
      bucket = { startedAt: now, count: 0 };
      buckets.set(key, bucket);
    }
    bucket.count += 1;
    res.setHeader("X-RateLimit-Limit", String(max));
    res.setHeader("X-RateLimit-Remaining", String(Math.max(0, max - bucket.count)));
    if (bucket.count > max) {
      const retryAfter = Math.ceil((windowMs - (now - bucket.startedAt)) / 1000);
      res.setHeader("Retry-After", String(retryAfter));
      return res.status(429).json({
        success: false,
        error: "Too many requests. Please try again later.",
        retryAfter
      });
    }
    return next();
  };
}

module.exports = { createRateLimiter };
