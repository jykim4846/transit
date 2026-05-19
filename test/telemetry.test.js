const test = require("node:test");
const assert = require("node:assert/strict");

const telemetryHandler = require("../api/telemetry");
const { recordTelemetry, getTelemetrySnapshot, _test } = require("../api/_telemetry-store");

function mockReq({ method = "POST", headers = {}, body = {}, query = {} } = {}) {
  return {
    method,
    headers,
    body,
    query,
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

test("telemetry store accepts only known events and safe dimensions", () => {
  _test.resetTelemetryForTest();
  const accepted = recordTelemetry({
    event: "permission_state",
    props: {
      state: "denied",
      secret: "do-not-store",
      reason: "x".repeat(120)
    }
  });

  assert.equal(accepted.accepted, true);
  const snapshot = getTelemetrySnapshot();
  assert.equal(snapshot.totalEvents, 1);
  assert.equal(snapshot.counters[0].event, "permission_state");
  assert.equal(snapshot.counters[0].props.state, "denied");
  assert.equal(snapshot.counters[0].props.secret, undefined);
  assert.equal(snapshot.counters[0].props.reason.length, 80);

  const rejected = recordTelemetry({ event: "precise_location", props: { state: "bad" } });
  assert.equal(rejected.accepted, false);
  assert.equal(getTelemetrySnapshot().droppedEvents, 1);
});

test("telemetry endpoint records public POSTs and protects GET snapshots", async () => {
  _test.resetTelemetryForTest();

  const posted = mockRes();
  await telemetryHandler(mockReq({ body: { event: "live_map_retry", props: { source: "status_chip" } } }), posted);
  assert.equal(posted.statusCode, 202);

  const unauthorized = mockRes();
  await telemetryHandler(mockReq({ method: "GET" }), unauthorized);
  assert.equal(unauthorized.statusCode, 401);

  const previous = process.env.INDEX_ADMIN_KEY;
  process.env.INDEX_ADMIN_KEY = "secret";
  const authorized = mockRes();
  await telemetryHandler(mockReq({ method: "GET", headers: { authorization: "Bearer secret" } }), authorized);
  assert.equal(authorized.statusCode, 200);
  assert.equal(authorized.body.totalEvents, 1);
  if (previous == null) delete process.env.INDEX_ADMIN_KEY;
  else process.env.INDEX_ADMIN_KEY = previous;
});
