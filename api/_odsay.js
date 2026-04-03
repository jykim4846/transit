const GLOBAL_CACHE = globalThis.__TRANSIT_APP_CACHE__ || (globalThis.__TRANSIT_APP_CACHE__ = {
  stationSearch: new Map(),
  routeSearch: new Map(),
  realtimeArrival: new Map()
});

function getEnvKey() {
  const key = process.env.ODSAY_API_KEY;
  if (!key) {
    const error = new Error("ODSAY_API_KEY 환경변수가 설정되지 않았습니다");
    error.statusCode = 500;
    throw error;
  }
  return key;
}

function getCached(map, key) {
  const hit = map.get(key);
  if (!hit) return null;
  if (hit.expiresAt <= Date.now()) {
    map.delete(key);
    return null;
  }
  return hit.value;
}

function setCached(map, key, value, ttlMs) {
  map.set(key, {
    value,
    expiresAt: Date.now() + ttlMs
  });
  return value;
}

async function fetchOdsay(endpoint, params) {
  const query = new URLSearchParams({
    apiKey: getEnvKey(),
    lang: "0",
    output: "json",
    ...params
  });

  const response = await fetch(`https://api.odsay.com/v1/api/${endpoint}?${query.toString()}`);
  const payload = await response.json().catch(() => null);

  if (!response.ok) {
    const error = new Error(`ODsay 요청 실패 (${response.status})`);
    error.statusCode = 502;
    throw error;
  }

  if (payload?.error) {
    const error = new Error(payload.error.msg || payload.error.message || payload.error.code || "ODsay 오류");
    error.statusCode = 502;
    throw error;
  }

  return payload;
}

function sendJson(res, statusCode, body, cacheControl) {
  if (cacheControl) {
    res.setHeader("Cache-Control", cacheControl);
  }
  res.status(statusCode).json(body);
}

module.exports = {
  GLOBAL_CACHE,
  getCached,
  setCached,
  fetchOdsay,
  sendJson
};
