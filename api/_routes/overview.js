const { sendJson } = require("../_odsay");
const { enqueueRouteNos, getCollectorStatus } = require("../_mapping-index");
const { getSeoulBusApiKey } = require("../_seoul-bus");
const { collectTransitPaths, buildOverviewResult } = require("./odsay-paths");
const { buildCandidate } = require("./candidate-builder");
const { enrichCandidates } = require("./candidate-enricher");
const { chooseFastest, deduplicateCandidates } = require("./scoring");
const { findBestDirectBusCandidates } = require("./direct-bus-search");

async function handleOverview(req, res, ctx) {
  const { fromX, fromY, toX, toY, transportFilter, includeIndexStatus } = ctx;

  const rawPaths = await collectTransitPaths(fromX, fromY, toX, toY, transportFilter);
  const candidates = rawPaths.map((path, index) => buildCandidate(path, index, "fastest", null));

  if ((transportFilter === "all" || transportFilter === "bus") && getSeoulBusApiKey()) {
    const directBusCandidates = await findBestDirectBusCandidates(fromX, fromY, toX, toY).catch(() => []);
    candidates.push(...directBusCandidates.map((candidate, index) => ({
      ...candidate,
      id: `direct-overview-${index}-${candidate.id}`
    })));
  }

  if (!candidates.length) {
    return sendJson(res, 404, { error: "조건에 맞는 경로가 없습니다" });
  }

  await enqueueRouteNos([...new Set(candidates.map((candidate) => candidate.routeNo).filter(Boolean))], "runtime_refresh");
  const enrichedCandidates = await enrichCandidates(candidates, fromX, fromY, toX, toY);
  const sorted = deduplicateCandidates(chooseFastest(enrichedCandidates));
  const indexStatus = includeIndexStatus ? await getCollectorStatus().catch(() => null) : undefined;
  return sendJson(res, 200, buildOverviewResult(sorted, indexStatus));
}

module.exports = { handleOverview };
