const { GLOBAL_CACHE, getCached, setCached, fetchOdsay, sendJson } = require("./_odsay");

const STATION_TTL = 7 * 24 * 60 * 60 * 1000;

function normalizeStation(station) {
  const stationType = Number(station.stationType ?? 0);
  const stationClass = Number(station.stationClass ?? 0);
  const isSubway = stationType === 1 || stationClass === 2;
  return {
    name: station.stationName || station.stationNameKor || "",
    x: station.x,
    y: station.y,
    stationID: station.stationID || null,
    kind: isSubway ? "지하철" : "버스"
  };
}

module.exports = async function handler(req, res) {
  if (req.method !== "GET") {
    return sendJson(res, 405, { error: "Method Not Allowed" });
  }

  const q = String(req.query.q || "").trim();
  if (q.length < 2) {
    return sendJson(res, 400, { error: "검색어는 두 글자 이상이어야 합니다" });
  }

  const cacheKey = q.toLowerCase();
  const cached = getCached(GLOBAL_CACHE.stationSearch, cacheKey);
  if (cached) {
    return sendJson(res, 200, cached, "public, s-maxage=604800, stale-while-revalidate=86400");
  }

  try {
    const payload = await fetchOdsay("searchStation", {
      stationName: q
    });
    const stations = (payload.result?.station || [])
      .slice(0, 8)
      .map(normalizeStation)
      .filter((station) => station.name && station.x && station.y);

    const result = { stations };
    setCached(GLOBAL_CACHE.stationSearch, cacheKey, result, STATION_TTL);
    return sendJson(res, 200, result, "public, s-maxage=604800, stale-while-revalidate=86400");
  } catch (error) {
    return sendJson(res, error.statusCode || 500, { error: error.message || "정류장 검색에 실패했습니다" });
  }
};
