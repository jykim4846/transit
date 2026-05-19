const assert = require("node:assert/strict");

const baseUrl = (process.env.SMOKE_BASE_URL || process.argv[2] || "https://transit-mauve.vercel.app").replace(/\/$/, "");

async function getText(path) {
  const response = await fetch(`${baseUrl}${path}`, { cache: "no-store" });
  assert.equal(response.ok, true, `${path} returned ${response.status}`);
  return response.text();
}

async function getJson(path) {
  const text = await getText(path);
  return JSON.parse(text);
}

async function main() {
  const cacheKey = `v=${Date.now()}`;
  const html = await getText(`/?${cacheKey}`);
  assert.match(html, /토닥버스/);
  assert.match(html, /permission-notice/);
  assert.match(html, /live-map-status-chip/);

  const liveMap = await getText(`/js/live-map.js?${cacheKey}`);
  assert.match(liveMap, /retryLiveMap/);
  assert.match(liveMap, /BUS_POLL_MAX_DELAY_MS/);

  const app = await getText(`/js/app.js?${cacheKey}`);
  assert.match(app, /visibilitychange/);
  assert.match(app, /permission-notice/);

  const stations = await getJson("/api/stations?q=%EA%B0%95%EB%82%A8%EC%97%AD");
  assert.equal(Array.isArray(stations.stations), true);
  assert.equal(stations.stations.length > 0, true);

  const routes = await getJson("/api/routes?fromX=127.0276&fromY=37.4979&toX=126.9223&toY=37.5563&priority=overview&transportFilter=bus&includeIndexStatus=1");
  assert.equal(Array.isArray(routes.candidates), true);

  const blocked = await fetch(`${baseUrl}/api/config`, {
    headers: { Origin: "https://evil.example" },
    cache: "no-store"
  });
  assert.equal(blocked.status, 403);

  console.log(JSON.stringify({
    ok: true,
    baseUrl,
    stationCount: stations.stations.length,
    candidateCount: routes.candidates.length
  }));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
