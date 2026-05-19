const test = require("node:test");
const assert = require("node:assert/strict");

const { checkRateLimit, isAllowedOrigin, _test } = require("../api/_public-api-guard");

function req(headers = {}) {
  return {
    headers,
    socket: { remoteAddress: "127.0.0.1" }
  };
}

test("rate limiter blocks after the configured threshold per scope and client", () => {
  _test.buckets.clear();
  assert.equal(checkRateLimit(req(), { scope: "routes", limit: 2, windowMs: 60_000 }).allowed, true);
  assert.equal(checkRateLimit(req(), { scope: "routes", limit: 2, windowMs: 60_000 }).allowed, true);
  const blocked = checkRateLimit(req(), { scope: "routes", limit: 2, windowMs: 60_000 });
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.retryAfterSeconds > 0, true);
});

test("rate limiter prunes expired buckets when the cache grows large", () => {
  _test.buckets.clear();
  for (let i = 0; i < 1000; i += 1) {
    _test.buckets.set(`stale:${i}`, { count: 1, resetAt: 1 });
  }

  checkRateLimit(req({ "x-forwarded-for": "5.6.7.8" }), { scope: "stations", limit: 2, windowMs: 60_000 });

  assert.equal(_test.buckets.size, 1);
  assert.ok(_test.buckets.has("stations:5.6.7.8"));
});

test("origin guard is permissive in development until APP_BASE_URL is configured", () => {
  const previous = process.env.APP_BASE_URL;
  const previousProduction = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  const previousPreview = process.env.VERCEL_URL;
  const previousNodeEnv = process.env.NODE_ENV;
  const previousVercel = process.env.VERCEL;
  const previousAppEnv = process.env.APP_ENV;
  delete process.env.APP_BASE_URL;
  delete process.env.VERCEL_PROJECT_PRODUCTION_URL;
  delete process.env.VERCEL_URL;
  delete process.env.NODE_ENV;
  delete process.env.VERCEL;
  delete process.env.APP_ENV;

  assert.equal(isAllowedOrigin(req({ origin: "https://example.com" })), true);

  process.env.APP_BASE_URL = "https://transit.example";
  assert.equal(isAllowedOrigin(req({ origin: "https://transit.example" })), true);
  assert.equal(isAllowedOrigin(req({ origin: "https://other.example" })), false);

  if (previous == null) delete process.env.APP_BASE_URL;
  else process.env.APP_BASE_URL = previous;
  if (previousProduction == null) delete process.env.VERCEL_PROJECT_PRODUCTION_URL;
  else process.env.VERCEL_PROJECT_PRODUCTION_URL = previousProduction;
  if (previousPreview == null) delete process.env.VERCEL_URL;
  else process.env.VERCEL_URL = previousPreview;
  if (previousNodeEnv == null) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = previousNodeEnv;
  if (previousVercel == null) delete process.env.VERCEL;
  else process.env.VERCEL = previousVercel;
  if (previousAppEnv == null) delete process.env.APP_ENV;
  else process.env.APP_ENV = previousAppEnv;
});

test("origin guard fails closed in production when no allowlist is configured", () => {
  const previous = process.env.APP_BASE_URL;
  const previousProduction = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  const previousPreview = process.env.VERCEL_URL;
  const previousNodeEnv = process.env.NODE_ENV;
  delete process.env.APP_BASE_URL;
  delete process.env.VERCEL_PROJECT_PRODUCTION_URL;
  delete process.env.VERCEL_URL;
  process.env.NODE_ENV = "production";

  assert.equal(isAllowedOrigin(req({ origin: "https://example.com" })), false);
  assert.equal(isAllowedOrigin(req()), true);

  if (previous == null) delete process.env.APP_BASE_URL;
  else process.env.APP_BASE_URL = previous;
  if (previousProduction == null) delete process.env.VERCEL_PROJECT_PRODUCTION_URL;
  else process.env.VERCEL_PROJECT_PRODUCTION_URL = previousProduction;
  if (previousPreview == null) delete process.env.VERCEL_URL;
  else process.env.VERCEL_URL = previousPreview;
  if (previousNodeEnv == null) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = previousNodeEnv;
});
