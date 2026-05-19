const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

const app = read("js/app.js");
const state = read("js/state.js");
const liveMap = read("js/live-map.js");
const routeCard = read("js/route-card.js");
const html = read("transit-app.html");
const config = read("api/config.js");

assert.match(config, /guardPublicApi\(req, res, sendJson/);
assert.match(app, /visibilitychange/);
assert.match(app, /stopUserLocationWatch\(\)/);
assert.match(app, /permission-notice/);
assert.match(state, /loadBoardedTrip/);
assert.match(state, /persistBoardedTrip/);
assert.match(routeCard, /BOARDED_TRIP_MAX_AGE_MS/);
assert.match(routeCard, /탑승 시작/);
assert.match(routeCard, /까지 유지/);
assert.match(liveMap, /BUS_POLL_MAX_DELAY_MS/);
assert.match(liveMap, /retryLiveMap/);
assert.match(liveMap, /lastPollSuccessAt/);
assert.match(liveMap, /data-action="retry-live-map"/);
assert.match(html, /live-map-status-chip button/);
assert.match(html, /boarding-panel-meta/);
assert.match(html, /id="permission-notice"/);

console.log("browser regression guards ok");
