const test = require("node:test");
const assert = require("node:assert/strict");

const configHandler = require("../api/config");
const { _test } = require("../api/_public-api-guard");

function mockReq(headers = {}) {
  return {
    method: "GET",
    headers,
    socket: { remoteAddress: "127.0.0.1" }
  };
}

function mockRes() {
  return {
    statusCode: 200,
    headers: {},
    body: null,
    setHeader(key, value) {
      this.headers[key.toLowerCase()] = value;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    }
  };
}

function withEnv(values, fn) {
  const keys = Object.keys(values);
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  keys.forEach((key) => {
    if (values[key] == null) delete process.env[key];
    else process.env[key] = values[key];
  });
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      keys.forEach((key) => {
        if (previous[key] == null) delete process.env[key];
        else process.env[key] = previous[key];
      });
    });
}

test("config API applies the public origin guard in production", async () => {
  _test.buckets.clear();
  await withEnv({
    NODE_ENV: "production",
    APP_BASE_URL: "https://transit.example",
    VERCEL_PROJECT_PRODUCTION_URL: null,
    VERCEL_URL: null,
    VITE_KAKAO_MAP_KEY: "public-map-key"
  }, async () => {
    const blocked = mockRes();
    await configHandler(mockReq({ origin: "https://evil.example" }), blocked);
    assert.equal(blocked.statusCode, 403);
    assert.equal(blocked.body.error, "Origin not allowed");

    const allowed = mockRes();
    await configHandler(mockReq({ origin: "https://transit.example" }), allowed);
    assert.equal(allowed.statusCode, 200);
    assert.equal(allowed.body.kakaoMapKey, "public-map-key");
  });
});
