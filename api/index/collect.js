const { sendJson } = require("../_odsay");
const { enqueueRouteNos, collectRouteIndex } = require("../_mapping-index");
const { isAuthorized } = require("../_auth");

module.exports = async function handler(req, res) {
  if (req.method !== "GET" && req.method !== "POST") {
    return sendJson(res, 405, { error: "Method Not Allowed" });
  }

  if (!isAuthorized(req)) {
    return sendJson(res, 401, { error: "Unauthorized" });
  }

  const ROUTE_NO_PATTERN = /^[A-Z0-9-]{1,16}$/;
  const seedRouteNos = String(req.query.seedRouteNos || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => item.toUpperCase())
    .filter((item) => ROUTE_NO_PATTERN.test(item));
  const limit = Math.max(1, Math.min(20, Number(req.query.limit || 6) || 6));

  try {
    if (seedRouteNos.length) {
      await enqueueRouteNos(seedRouteNos, "manual_seed");
    }
    const result = await collectRouteIndex(limit);
    return sendJson(res, 200, result);
  } catch (error) {
    return sendJson(res, 500, { error: error.message || "인덱스 수집에 실패했습니다" });
  }
};
