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

function getAppOrigin() {
  const raw =
    process.env.APP_BASE_URL ||
    process.env.VERCEL_PROJECT_PRODUCTION_URL ||
    process.env.VERCEL_URL ||
    "";

  if (!raw) return null;
  if (raw.startsWith("http://") || raw.startsWith("https://")) {
    return raw.replace(/\/$/, "");
  }
  return `https://${raw}`.replace(/\/$/, "");
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

  const appOrigin = getAppOrigin();
  const headers = {
    "User-Agent": "transit-app/1.0"
  };

  if (appOrigin) {
    headers.Origin = appOrigin;
    headers.Referer = `${appOrigin}/`;
  }

  const response = await fetch(`https://api.odsay.com/v1/api/${endpoint}?${query.toString()}`, {
    headers
  });
  const payload = await response.json().catch(() => null);

  if (!response.ok) {
    const detail = payload?.error?.msg || payload?.error?.message || payload?.error?.code || "";
    const error = new Error(detail ? `ODsay 요청 실패 (${response.status}): ${detail}` : `ODsay 요청 실패 (${response.status})`);
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
