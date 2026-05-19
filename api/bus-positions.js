const { sendJson } = require("./_odsay");
const { guardPublicApi } = require("./_public-api-guard");
const { getLiveBusPreview } = require("./_mapping-index");
const { getSeoulBusApiKey } = require("./_seoul-bus");

function toNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

module.exports = async function handler(req, res) {
  if (req.method !== "GET") {
    return sendJson(res, 405, { error: "Method Not Allowed" });
  }

  const blocked = guardPublicApi(req, res, sendJson, {
    scope: "bus-positions",
    limit: Number(process.env.BUS_POSITIONS_RATE_LIMIT_PER_MINUTE || 90),
    windowMs: 60 * 1000
  });
  if (blocked) return blocked;

  if (!getSeoulBusApiKey()) {
    return sendJson(res, 503, { error: "SEOUL_BUS_API_KEY 환경변수가 설정되지 않았습니다" });
  }

  const routeId = String(req.query.routeId || "").trim();
  const boardingStationId = String(req.query.boardingStationId || "").trim();
  const alightingStationId = String(req.query.alightingStationId || "").trim() || null;
  const walkMinutes = toNumber(req.query.walkMinutes) || 0;

  if (!routeId || !boardingStationId) {
    return sendJson(res, 400, { error: "routeId와 boardingStationId가 필요합니다" });
  }

  const ID_PATTERN = /^[A-Za-z0-9_-]{1,32}$/;
  if (!ID_PATTERN.test(routeId)) {
    return sendJson(res, 400, { error: "routeId 형식이 올바르지 않습니다" });
  }
  if (!ID_PATTERN.test(boardingStationId)) {
    return sendJson(res, 400, { error: "boardingStationId 형식이 올바르지 않습니다" });
  }
  if (alightingStationId && !ID_PATTERN.test(alightingStationId)) {
    return sendJson(res, 400, { error: "alightingStationId 형식이 올바르지 않습니다" });
  }

  try {
    const result = await getLiveBusPreview({ routeId, boardingStationId, alightingStationId, walkMinutes });
    if (!result) {
      return sendJson(res, 404, { error: "해당 노선/정류장 매핑을 찾지 못했습니다" });
    }
    const { preview, arrival, mapping } = result;
    return sendJson(res, 200, {
      fetchedAt: new Date().toISOString(),
      mapping: {
        routeId: mapping.routeId,
        stationId: mapping.stationId,
        stationSeq: mapping.stationSeq,
        stationName: mapping.stationName,
        alightingStationId: mapping.alightingStationId,
        alightingStationSeq: mapping.alightingStationSeq,
        alightingStationName: mapping.alightingStationName
      },
      preview,
      arrival: arrival ? {
        waitMin: arrival.waitMin,
        stationArrivalMin: arrival.stationArrivalMin,
        skippedCount: arrival.skippedCount,
        walkSeconds: arrival.walkSeconds,
        fetchedAtMs: arrival.fetchedAtMs
      } : null
    });
  } catch (error) {
    return sendJson(res, error.statusCode || 500, { error: error.message || "버스 위치 조회에 실패했습니다" });
  }
};
