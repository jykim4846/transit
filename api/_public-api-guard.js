const DEFAULT_WINDOW_MS = 60 * 1000;
const MAX_BUCKETS = 1000;

const buckets = new Map();

function clientKey(req) {
  const forwarded = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim();
  return forwarded || req.socket?.remoteAddress || "unknown";
}

function allowedOrigins() {
  return [
    process.env.APP_BASE_URL,
    process.env.VERCEL_PROJECT_PRODUCTION_URL,
    process.env.VERCEL_URL
  ]
    .filter(Boolean)
    .map((value) => String(value).trim().replace(/\/$/, ""))
    .map((value) => value.startsWith("http://") || value.startsWith("https://") ? value : `https://${value}`);
}

function isAllowedOrigin(req) {
  const origin = String(req.headers.origin || "").replace(/\/$/, "");
  if (!origin) return true;

  const allowed = allowedOrigins();
  if (!allowed.length) return true;
  return allowed.includes(origin);
}

function checkRateLimit(req, options = {}) {
  const windowMs = Math.max(1000, Number(options.windowMs || DEFAULT_WINDOW_MS));
  const limit = Math.max(1, Number(options.limit || 60));
  const scope = options.scope || "public";
  const now = Date.now();
  cleanupExpiredBuckets(now);
  const key = `${scope}:${clientKey(req)}`;
  const current = buckets.get(key);

  if (!current || current.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, remaining: limit - 1, resetAt: now + windowMs };
  }

  current.count += 1;
  const remaining = Math.max(0, limit - current.count);
  return {
    allowed: current.count <= limit,
    remaining,
    resetAt: current.resetAt,
    retryAfterSeconds: Math.max(1, Math.ceil((current.resetAt - now) / 1000))
  };
}

function cleanupExpiredBuckets(now = Date.now()) {
  if (buckets.size < MAX_BUCKETS) return;
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) {
      buckets.delete(key);
    }
  }
}

function guardPublicApi(req, res, sendJson, options = {}) {
  if (!isAllowedOrigin(req)) {
    sendJson(res, 403, { error: "Origin not allowed" });
    return true;
  }

  const rate = checkRateLimit(req, options);
  res.setHeader("X-RateLimit-Remaining", String(rate.remaining));
  if (!rate.allowed) {
    res.setHeader("Retry-After", String(rate.retryAfterSeconds));
    sendJson(res, 429, { error: "Too Many Requests" });
    return true;
  }

  return false;
}

module.exports = {
  guardPublicApi,
  isAllowedOrigin,
  checkRateLimit,
  _test: {
    buckets,
    allowedOrigins,
    cleanupExpiredBuckets
  }
};
