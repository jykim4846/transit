const { GLOBAL_CACHE, getCached, setCached, fetchOdsay, sendJson } = require("./_odsay");

const ROUTE_TTL = 10 * 60 * 1000;
const REALTIME_TTL = 20 * 1000;

const FILTER_TO_PATH_TYPE = {
  all: "0",
  subway: "1",
  bus: "2"
};

function toNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function formatMinutes(value) {
  const num = Number(value || 0);
  return `${num}분`;
}

function formatTransferCount(value) {
  return `${Number(value || 0)}회`;
}

function normalizeLanes(subPath) {
  return (subPath.lane || []).map((lane) => ({
    name: lane.name || "",
    busNo: lane.busNo || "",
    busID: lane.busID || lane.busId || null,
    busLocalBlID: lane.busLocalBlID || lane.routeID || lane.routeId || null,
    subwayCode: lane.subwayCode || null
  }));
}

function normalizeSegment(subPath) {
  if (subPath.trafficType === 3) {
    return {
      type: "walk",
      kind: "도보",
      text: `${subPath.startName || "이동"} → ${subPath.endName || "연결"}`
        + (subPath.sectionTime ? ` · 도보 ${subPath.sectionTime}분` : ""),
      time: formatMinutes(subPath.sectionTime || 0),
      label: `도보 ${subPath.sectionTime || 0}분`
    };
  }

  if (subPath.trafficType === 2) {
    const lane = normalizeLanes(subPath)[0] || {};
    return {
      type: "bus",
      kind: "버스",
      text: `${lane.busNo || "버스"} · ${subPath.startName || ""} → ${subPath.endName || ""}`,
      time: formatMinutes(subPath.sectionTime || 0),
      label: lane.busNo || "버스"
    };
  }

  const lane = normalizeLanes(subPath)[0] || {};
  return {
    type: "subway",
    kind: "지하철",
    text: `${lane.name || "지하철"} · ${subPath.startName || ""} → ${subPath.endName || ""}`,
    time: formatMinutes(subPath.sectionTime || 0),
    label: lane.name || "지하철"
  };
}

function getFirstTransit(subPaths) {
  return subPaths.find((segment) => segment.trafficType === 1 || segment.trafficType === 2) || null;
}

function getInitialWalkTime(subPaths, firstTransitIndex) {
  if (firstTransitIndex <= 0) return 0;
  return subPaths.slice(0, firstTransitIndex)
    .filter((segment) => segment.trafficType === 3)
    .reduce((sum, segment) => sum + Number(segment.sectionTime || 0), 0);
}

function summarizeSteps(subPaths) {
  return subPaths
    .filter((segment) => segment.trafficType === 1 || segment.trafficType === 2 || (segment.trafficType === 3 && Number(segment.sectionTime) > 0))
    .map((segment) => normalizeSegment(segment))
    .slice(0, 6);
}

function getWalkTime(subPaths) {
  return subPaths
    .filter((segment) => segment.trafficType === 3)
    .reduce((sum, segment) => sum + Number(segment.sectionTime || 0), 0);
}

function inferTransferCount(info) {
  const rides = Number(info.busTransitCount || 0) + Number(info.subwayTransitCount || 0);
  return Math.max(0, rides - 1);
}

function normalizeRealtimeEntry(entry) {
  return {
    busID: entry.busID || entry.busId || null,
    routeID: entry.routeID || entry.routeId || null,
    routeNo: entry.routeNo || entry.busNo || entry.routeName || "",
    arrival1Sec: toNumber(entry.arrival1?.arrivalSec),
    arrival2Sec: toNumber(entry.arrival2?.arrivalSec)
  };
}

async function getRealtimeArrivals(stationID) {
  const cacheKey = String(stationID);
  const cached = getCached(GLOBAL_CACHE.realtimeArrival, cacheKey);
  if (cached) return cached;

  const payload = await fetchOdsay("realtimeStation", {
    stationID: cacheKey,
    stationBase: "0"
  });

  const list = (payload.result?.real || payload.result?.realtime || payload.result?.station || [])
    .map(normalizeRealtimeEntry);

  return setCached(GLOBAL_CACHE.realtimeArrival, cacheKey, list, REALTIME_TTL);
}

function findBestBusArrival(firstTransit, arrivals) {
  const lanes = normalizeLanes(firstTransit);
  const matches = arrivals.flatMap((arrival) => {
    return lanes.flatMap((lane) => {
      const busIdMatch = lane.busID && arrival.busID && String(lane.busID) === String(arrival.busID);
      const routeIdMatch = lane.busLocalBlID && arrival.routeID && String(lane.busLocalBlID) === String(arrival.routeID);
      const routeNoMatch = lane.busNo && arrival.routeNo && String(lane.busNo) === String(arrival.routeNo);

      if (!busIdMatch && !routeIdMatch && !routeNoMatch) return [];
      return [arrival.arrival1Sec, arrival.arrival2Sec].filter((value) => Number.isFinite(value));
    });
  });

  if (!matches.length) return null;
  return Math.max(1, Math.ceil(Math.min(...matches) / 60));
}

function getEstimatedWait(firstTransit, realtimeWait) {
  if (!firstTransit) {
    return { minutes: 0, source: "none" };
  }

  if (firstTransit.trafficType === 2 && realtimeWait != null) {
    return { minutes: realtimeWait, source: "realtime" };
  }

  const interval = toNumber(firstTransit.intervalTime) || 0;
  if (interval > 0) {
    return { minutes: Math.max(1, Math.round(interval / 2)), source: "interval" };
  }

  return { minutes: 0, source: "none" };
}

function getBoardingStopName(firstTransit) {
  if (!firstTransit) return null;
  return firstTransit.startName || firstTransit.startStationName || null;
}

function buildCandidate(path, index, priority, realtimeWait) {
  const info = path.info || {};
  const subPaths = path.subPath || [];
  const firstTransitIndex = subPaths.findIndex((segment) => segment.trafficType === 1 || segment.trafficType === 2);
  const firstTransit = firstTransitIndex >= 0 ? subPaths[firstTransitIndex] : null;
  const wait = getEstimatedWait(firstTransit, realtimeWait);
  const initialWalkTime = getInitialWalkTime(subPaths, firstTransitIndex);
  const totalTime = Number(info.totalTime || 0);
  const transferCount = inferTransferCount(info);
  const walkTime = getWalkTime(subPaths);
  const summarySteps = summarizeSteps(subPaths);
  const boardingStopName = getBoardingStopName(firstTransit);

  let scoreValue;
  let scoreDisplay;
  let note;

  if (priority === "fewest_transfers") {
    scoreValue = transferCount * 1000 + totalTime;
    scoreDisplay = `${transferCount}회`;
    note = transferCount === 0
      ? "환승 없이 가는 후보입니다."
      : `환승 ${transferCount}회 중 가장 단순한 후보입니다.`;
  } else if (priority === "best_eta") {
    scoreValue = totalTime + wait.minutes;
    scoreDisplay = `${scoreValue}분`;
    note = wait.minutes > 0
      ? `첫 탑승 대기 ${wait.minutes}분과 총 이동시간을 합쳐 비교했습니다.`
      : "첫 탑승 대기 정보를 반영할 수 없어 총 이동시간 위주로 비교했습니다.";
  } else {
    scoreValue = totalTime;
    scoreDisplay = `${totalTime}분`;
    note = "총 소요시간이 가장 짧은 후보를 우선합니다.";
  }

  const firstTransitLabel = firstTransit
    ? normalizeSegment(firstTransit).label
    : "도보";

  return {
    id: `path-${index}`,
    scoreValue,
    scoreDisplay,
    totalTime,
    totalTimeText: formatMinutes(totalTime),
    transferCount,
    transferCountText: formatTransferCount(transferCount),
    walkTime,
    walkTimeText: formatMinutes(walkTime),
    firstWaitMin: wait.minutes || null,
    firstWaitText: wait.minutes ? formatMinutes(wait.minutes) : "즉시",
    firstWaitSource: wait.source,
    firstTransitLabel,
    boardingStopName,
    boardingApproachText: boardingStopName
      ? (initialWalkTime > 0 ? `도보 후 ${boardingStopName} 탑승` : `${boardingStopName} 탑승`)
      : null,
    initialWalkTime,
    summarySteps,
    note,
    segments: subPaths.map(normalizeSegment)
  };
}

function chooseRecommendation(candidates, priority) {
  return [...candidates].sort((a, b) => {
    if (a.scoreValue !== b.scoreValue) return a.scoreValue - b.scoreValue;
    if (a.totalTime !== b.totalTime) return a.totalTime - b.totalTime;
    if (a.transferCount !== b.transferCount) return a.transferCount - b.transferCount;
    if (priority === "best_eta" && a.initialWalkTime !== b.initialWalkTime) return a.initialWalkTime - b.initialWalkTime;
    return 0;
  });
}

module.exports = async function handler(req, res) {
  if (req.method !== "GET") {
    return sendJson(res, 405, { error: "Method Not Allowed" });
  }

  const fromX = toNumber(req.query.fromX);
  const fromY = toNumber(req.query.fromY);
  const toX = toNumber(req.query.toX);
  const toY = toNumber(req.query.toY);
  const priority = String(req.query.priority || "fastest");
  const transportFilter = String(req.query.transportFilter || "all");

  if ([fromX, fromY, toX, toY].some((value) => value == null)) {
    return sendJson(res, 400, { error: "좌표 파라미터가 올바르지 않습니다" });
  }

  const pathType = FILTER_TO_PATH_TYPE[transportFilter] || "0";
  const cacheKey = [fromX, fromY, toX, toY, pathType].join(":");

  try {
    let routePayload = getCached(GLOBAL_CACHE.routeSearch, cacheKey);
    if (!routePayload) {
      routePayload = await fetchOdsay("searchPubTransPathR", {
        SX: String(fromX),
        SY: String(fromY),
        EX: String(toX),
        EY: String(toY),
        SearchPathType: pathType,
        OPT: "0"
      });
      setCached(GLOBAL_CACHE.routeSearch, cacheKey, routePayload, ROUTE_TTL);
    }

    const rawPaths = routePayload.result?.path || [];
    if (!rawPaths.length) {
      return sendJson(res, 404, { error: "조건에 맞는 경로가 없습니다" });
    }

    const realtimeCache = new Map();
    const candidates = [];

    for (let index = 0; index < rawPaths.length; index += 1) {
      const path = rawPaths[index];
      const firstTransit = getFirstTransit(path.subPath || []);
      let realtimeWait = null;

      if (priority === "best_eta" && firstTransit?.trafficType === 2 && firstTransit.startID) {
        const stationKey = String(firstTransit.startID);
        if (!realtimeCache.has(stationKey)) {
          realtimeCache.set(stationKey, await getRealtimeArrivals(stationKey));
        }
        realtimeWait = findBestBusArrival(firstTransit, realtimeCache.get(stationKey));
      }

      candidates.push(buildCandidate(path, index, priority, realtimeWait));
    }

    const sorted = chooseRecommendation(candidates, priority);
    const recommendation = sorted[0];
    const result = {
      fetchedAt: new Date().toISOString(),
      recommendedId: recommendation.id,
      recommendation,
      candidates: sorted.slice(0, 4)
    };

    const cacheControl = priority === "best_eta"
      ? "public, s-maxage=20, stale-while-revalidate=40"
      : "public, s-maxage=600, stale-while-revalidate=120";

    return sendJson(res, 200, result, cacheControl);
  } catch (error) {
    return sendJson(res, error.statusCode || 500, { error: error.message || "경로 검색에 실패했습니다" });
  }
};
