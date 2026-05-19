const { sendJson } = require("./_odsay");
const { guardPublicApi } = require("./_public-api-guard");
const { toNumber } = require("./_routes/_common");
const { handleOverview } = require("./_routes/overview");
const { handleDirectBusEta } = require("./_routes/direct-bus-eta");
const { handlePathType } = require("./_routes/path-type");

module.exports = async function handler(req, res) {
  if (req.method !== "GET") {
    return sendJson(res, 405, { error: "Method Not Allowed" });
  }

  const blocked = guardPublicApi(req, res, sendJson, {
    scope: "routes",
    limit: Number(process.env.ROUTES_RATE_LIMIT_PER_MINUTE || 30),
    windowMs: 60 * 1000
  });
  if (blocked) return blocked;

  const fromX = toNumber(req.query.fromX);
  const fromY = toNumber(req.query.fromY);
  const toX = toNumber(req.query.toX);
  const toY = toNumber(req.query.toY);
  const priority = String(req.query.priority || "fastest");
  const transportFilter = String(req.query.transportFilter || "all");
  const includeIndexStatus = String(req.query.includeIndexStatus || "0") === "1";

  if ([fromX, fromY, toX, toY].some((value) => value == null)) {
    return sendJson(res, 400, { error: "좌표 파라미터가 올바르지 않습니다" });
  }

  const lonsInRange = [fromX, toX].every((value) => value >= 124 && value <= 132);
  const latsInRange = [fromY, toY].every((value) => value >= 33 && value <= 43);
  if (!lonsInRange || !latsInRange) {
    return sendJson(res, 400, { error: "좌표 파라미터가 올바르지 않습니다" });
  }

  const ctx = { fromX, fromY, toX, toY, priority, transportFilter, includeIndexStatus };

  try {
    if (priority === "overview") {
      return await handleOverview(req, res, ctx);
    }

    if (priority === "best_eta" && transportFilter === "bus") {
      const handled = await handleDirectBusEta(req, res, ctx);
      if (handled !== null) return handled;
    }

    return await handlePathType(req, res, ctx);
  } catch (error) {
    return sendJson(res, error.statusCode || 500, { error: error.message || "경로 검색에 실패했습니다" });
  }
};
