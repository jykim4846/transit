const { sendJson } = require("../_odsay");
const { inspectSeoulBusApiKey, debugFetchSeoulBus, getArrivalByRoute } = require("../_seoul-bus");
const { isAuthorized } = require("../_auth");

module.exports = async function handler(req, res) {
  if (req.method !== "GET") {
    return sendJson(res, 405, { error: "Method Not Allowed" });
  }

  if (process.env.DEBUG_ENABLED !== "1") {
    return sendJson(res, 404, { error: "Not Found" });
  }

  if (!isAuthorized(req)) {
    return sendJson(res, 401, { error: "Unauthorized" });
  }

  const ID_PATTERN = /^[A-Za-z0-9_-]{1,32}$/;
  const SEQ_PATTERN = /^[0-9]{1,4}$/;
  const routeId = String(req.query.routeId || "");
  const stationId = String(req.query.stationId || "");
  const stationSeq = String(req.query.stationSeq || "");
  const anyProvided = Boolean(routeId || stationId || stationSeq);
  if (anyProvided) {
    if (!ID_PATTERN.test(routeId) || !ID_PATTERN.test(stationId) || !SEQ_PATTERN.test(stationSeq)) {
      return sendJson(res, 400, { error: "잘못된 파라미터입니다" });
    }
  }

  try {
    const rawKeyInfo = inspectSeoulBusApiKey();
    const keyInfo = {
      configured: Boolean(rawKeyInfo && rawKeyInfo.configured),
      apiRoot: rawKeyInfo && rawKeyInfo.apiRoot ? rawKeyInfo.apiRoot : ""
    };
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
