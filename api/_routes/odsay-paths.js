const { fetchOdsay } = require("../_odsay");
const { normalizeLanes } = require("./_common");
const { chooseFastest, chooseFewestTransfers, candidateKey } = require("./scoring");

const FILTER_TO_PATH_TYPE = {
  all: "0",
  subway: "1",
  bus: "2"
};

const OVERVIEW_PATH_TYPES = ["0", "2", "1"];

function getPathSignature(path) {
  const subPaths = path.subPath || [];
  return subPaths.map((segment) => {
    const lane = normalizeLanes(segment)[0] || {};
    return [
      segment.trafficType,
      segment.startName || "",
      segment.endName || "",
      lane.busID || lane.busNo || lane.name || "",
      segment.sectionTime || 0
    ].join(":");
  }).join("|");
}

async function fetchTransitPaths(fromX, fromY, toX, toY, pathType) {
  const payload = await fetchOdsay("searchPubTransPathR", {
    SX: String(fromX),
    SY: String(fromY),
    EX: String(toX),
    EY: String(toY),
    SearchPathType: pathType,
    OPT: "0"
  });
  return payload.result?.path || [];
}

async function collectTransitPaths(fromX, fromY, toX, toY, transportFilter) {
  const pathTypes = transportFilter === "all"
    ? OVERVIEW_PATH_TYPES
    : [FILTER_TO_PATH_TYPE[transportFilter] || "0"];
  const settled = await Promise.allSettled(
    pathTypes.map((pathType) => fetchTransitPaths(fromX, fromY, toX, toY, pathType))
  );
  const paths = [];
  const seen = new Set();

  settled.forEach((result) => {
    if (result.status !== "fulfilled") return;
    result.value.forEach((path) => {
      const key = getPathSignature(path);
      if (!key || seen.has(key)) return;
      seen.add(key);
      paths.push(path);
    });
  });

  const firstError = settled.find((result) => result.status === "rejected")?.reason;
  if (!paths.length && firstError) throw firstError;
  return paths;
}

function mergeFeaturedCandidates(featured, candidates, limit = 5) {
  const merged = [];
  const seen = new Set();
  [...featured, ...candidates].forEach((candidate) => {
    if (!candidate) return;
    const key = candidate.id || candidateKey(candidate);
    if (seen.has(key)) return;
    seen.add(key);
    merged.push(candidate);
  });
  return merged.slice(0, limit);
}

function buildOverviewResult(candidates, includeIndexStatusValue) {
  const fastest = chooseFastest(candidates)[0];
  const fewestTransfers = chooseFewestTransfers(candidates)[0];
  const fastestId = fastest?.id || null;
  const fewestTransfersId = fewestTransfers?.id || null;
  const featured = mergeFeaturedCandidates(
    [fastest, fewestTransfers],
    chooseFastest(candidates),
    5
  );

  return {
    fetchedAt: new Date().toISOString(),
    recommendedId: fastestId,
    recommendation: fastest || null,
    picks: {
      fastestId,
      fewestTransfersId,
      sameBest: Boolean(fastestId && fewestTransfersId && fastestId === fewestTransfersId),
      fastest,
      fewestTransfers
    },
    candidates: featured,
    mode: "overview",
    indexStatus: includeIndexStatusValue
  };
}

module.exports = {
  FILTER_TO_PATH_TYPE,
  OVERVIEW_PATH_TYPES,
  fetchTransitPaths,
  collectTransitPaths,
  getPathSignature,
  mergeFeaturedCandidates,
  buildOverviewResult
};
