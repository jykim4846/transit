const { sendJson } = require("../_odsay");
const { inspectSeoulBusApiKey, debugFetchSeoulBus, getArrivalByRoute } = require("../_seoul-bus");

function isAuthorized(req) {
  const secret = process.env.INDEX_ADMIN_KEY || process.env.CRON_SECRET || null;
  if (!secret) return true;
  const auth = req.headers.authorization || "";
  return auth === `Bearer ${secret}` || req.query.secret === secret;
}

module.exports = async function handler(req, res) {
  if (req.method !== "GET") {
    return sendJson(res, 405, { error: "Method Not Allowed" });
  }

  if (!isAuthorized(req)) {
    return sendJson(res, 401, { error: "Unauthorized" });
  }

  const routeId = String(req.query.routeId || "");
  const stationId = String(req.query.stationId || "");
  const stationSeq = String(req.query.stationSeq || "");

  try {
    const keyInfo = inspectSeoulBusApiKey();
    const output = { keyInfo };

    if (routeId && stationId && stationSeq) {
      output.raw = await debugFetchSeoulBus("/arrive/getArrInfoByRoute", {
        stId: stationId,
        busRouteId: routeId,
        ord: stationSeq
      });

      try {
        output.parsed = await getArrivalByRoute(stationId, routeId, stationSeq);
      } catch (error) {
        output.parsedError = error.message;
      }
    }

    return sendJson(res, 200, output);
  } catch (error) {
    return sendJson(res, 500, { error: error.message || "서울시 도착정보 디버그 조회에 실패했습니다" });
  }
};
