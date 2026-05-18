const { sendJson } = require("../_odsay");
const { enqueueRouteNos, getCollectorStatus } = require("../_mapping-index");
const { findBestDirectBusCandidates } = require("./direct-bus-search");
const { enrichCandidates } = require("./candidate-enricher");
const { chooseRecommendation, deduplicateCandidates } = require("./scoring");

async function handleDirectBusEta(req, res, ctx) {
  const { fromX, fromY, toX, toY, priority, includeIndexStatus } = ctx;

  const directBusCandidates = await findBestDirectBusCandidates(fromX, fromY, toX, toY);
  if (directBusCandidates.length) {
    await enqueueRouteNos([...new Set(directBusCandidates.map((candidate) => candidate.routeNo).filter(Boolean))], "runtime_refresh");
    const enrichedDirect = await enrichCandidates(directBusCandidates, fromX, fromY, toX, toY);
    const sortedDirect = deduplicateCandidates(chooseRecommendation(enrichedDirect, priority)).slice(0, 4);
    const directRecommendation = sortedDirect[0];
    if (directRecommendation) {
      return sendJson(res, 200, {
        fetchedAt: new Date().toISOString(),
        recommendedId: directRecommendation.id,
        recommendation: directRecommendation,
        candidates: sortedDirect,
        mode: "direct_bus_eta",
        indexStatus: includeIndexStatus ? await getCollectorStatus().catch(() => null) : undefined
      });
    }
  }

  return null;
}

module.exports = { handleDirectBusEta };
