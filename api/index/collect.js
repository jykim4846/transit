const { sendJson } = require("../_odsay");
const { enqueueRouteNos, collectRouteIndex } = require("../_mapping-index");

function isAuthorized(req) {
  const secret = process.env.INDEX_ADMIN_KEY || process.env.CRON_SECRET || null;
  if (!secret) return true;
  const auth = req.headers.authorization || "";
  return auth === `Bearer ${secret}` || req.query.secret === secret;
}

module.exports = async function handler(req, res) {
  if (req.method !== "GET" && req.method !== "POST") {
    return sendJson(res, 405, { error: "Method Not Allowed" });
  }

  if (!isAuthorized(req)) {
    return sendJson(res, 401, { error: "Unauthorized" });
  }

  const seedRouteNos = String(req.query.seedRouteNos || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
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
