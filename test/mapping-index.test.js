const test = require("node:test");
const assert = require("node:assert/strict");

const { _test } = require("../api/_mapping-index");

test("normalizeNameKey removes station suffix without damaging names like 역삼동", () => {
  assert.equal(_test.normalizeNameKey("강남역"), "강남");
  assert.equal(_test.normalizeNameKey("역삼동"), "역삼동");
  assert.equal(_test.normalizeNameKey("홍대입구 정류장"), "홍대입구");
});

test("route index path builders reject traversal-shaped identifiers", () => {
  assert.equal(_test.routeListPath("7016"), "seoul/routes-by-no/7016.json");
  assert.equal(_test.routeStopsPath("100100118"), "seoul/route-stops/100100118.json");
  assert.throws(() => _test.routeListPath("../7016"), /invalid routeNo/);
  assert.throws(() => _test.routeStopsPath("../100100118"), /invalid routeId/);
});

test("decorateVehiclesWithArrival marks catchable and uncatchable vehicles", () => {
  const preview = {
    vehicles: [{ key: "soon" }, { key: "later" }]
  };
  const decorated = _test.decorateVehiclesWithArrival(preview, {
    arrivalSecondsSorted: [60, 360],
    arrivalAtMsSorted: [1_000_060_000, 1_000_360_000],
    walkSeconds: 180,
    fetchedAtMs: 1_000_000_000
  });

  assert.equal(decorated.vehicles[0].catchable, false);
  assert.equal(decorated.vehicles[0].passedAgoMinutes, 2);
  assert.equal(decorated.vehicles[1].catchable, true);
  assert.equal(decorated.vehicles[1].etaMinutes, 6);
});
