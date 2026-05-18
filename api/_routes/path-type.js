const { sendJson } = require("../_odsay");
const { enqueueRouteNos, getCollectorStatus } = require("../_mapping-index");
const { fetchTransitPaths, FILTER_TO_PATH_TYPE } = require("./odsay-paths");
const { buildCandidate } = require("./candidate-builder");
const { enrichCandidates } = require("./candidate-enricher");
const { chooseRecommendation, deduplicateCandidates } = require("./scoring");

async function handlePathType(req, res, ctx) {
  const { fromX, fromY, toX, toY, priority, transportFilter, includeIndexStatus } = ctx;

  const pathType = FILTER_TO_PATH_TYPE[transportFilter] || "0";

  const rawPaths = await fetchTransitPaths(fromX, fromY, toX, toY, pathType);
  if (!rawPaths.length) {
    return sendJson(res, 404, { error: "조건에 맞는 경로가 없습니다" });
  }

  const candidates = [];

  for (let index = 0; index < rawPaths.length; index += 1) {
    const path = rawPaths[index];
    const candidate = buildCandidate(path, index, priority, null);
    candidates.push(candidate);
  }

  await enqueueRouteNos([...new Set(candidates.map((candidate) => candidate.routeNo).filter(Boolean))], "runtime_refresh");
  const enrichedCandidates = await enrichCandidates(candidates, fromX, fromY, toX, toY);

  const sorted = deduplicateCandidates(chooseRecommendation(enrichedCandidates, priority));
  const recommendation = sorted[0];
  const result = {
    fetchedAt: new Date().toISOString(),
    recommendedId: recommendation.id,
    recommendation,
    candidates: sorted.slice(0, 4),
    indexStatus: includeIndexStatus ? await getCollectorStatus().catch(() => null) : undefined
  };

  return sendJson(res, 200, result);
}

module.exports = { handlePathType };
