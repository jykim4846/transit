const { fetchOdsay, sendJson } = require("./_odsay");
const { enqueueRouteNos, resolveBusMapping, getSeoulBusArrival, getBusApproachPreview, getCollectorStatus } = require("./_mapping-index");
const { getSeoulBusApiKey } = require("./_seoul-bus");

const FILTER_TO_PATH_TYPE = {
  all: "0",
  subway: "1",
  bus: "2"
};

const WALK_METERS_PER_MINUTE = 67;
const START_STATION_RADIUS = 350;
const END_STATION_RADIUS = 600;
const MAX_START_STATIONS = 4;
const MAX_END_STATIONS = 6;
const MAX_DIRECT_BUS_PAIRS = 12;

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

function toRadians(value) {
  return (Number(value) * Math.PI) / 180;
}

function getDistanceMeters(fromX, fromY, toX, toY) {
  const earthRadiusMeters = 6371000;
  const dLat = toRadians(Number(toY) - Number(fromY));
  const dLon = toRadians(Number(toX) - Number(fromX));
  const lat1 = toRadians(fromY);
  const lat2 = toRadians(toY);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return earthRadiusMeters * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function estimateWalkMinutesByCoords(fromX, fromY, toX, toY) {
  const meters = getDistanceMeters(fromX, fromY, toX, toY);
  return Math.max(1, Math.round(meters / WALK_METERS_PER_MINUTE));
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

function getPathSectionTime(subPaths) {
  return subPaths.reduce((sum, segment) => sum + Number(segment.sectionTime || 0), 0);
}

function inferTransferCount(info) {
  const rides = Number(info.busTransitCount || 0) + Number(info.subwayTransitCount || 0);
  return Math.max(0, rides - 1);
}

function normalizePointBusStation(entry) {
  return {
    stationID: entry.stationID || null,
    stationName: entry.stationName || entry.stationNameKor || "",
    x: toNumber(entry.x),
    y: toNumber(entry.y),
    busList: (entry.busList || []).map((bus) => ({
      busID: bus.busID || null,
      busNo: bus.busNo || bus.busNoKor || "",
      type: bus.type || null
    })).filter((bus) => bus.busID && bus.busNo)
  };
}

async function getNearbyBusStations(x, y, radius) {
  const payload = await fetchOdsay("pointBusStation", {
    x: String(x),
    y: String(y),
    radius: String(radius)
  });

  return (payload.result?.lane || [])
    .map(normalizePointBusStation)
    .filter((station) => station.stationID && station.x != null && station.y != null && station.busList.length);
}

async function getBusLaneDetail(busID) {
  const payload = await fetchOdsay("busLaneDetail", {
    busID: String(busID)
  });
  return payload.result || null;
}

async function searchBusPathBetweenStations(startStation, endStation) {
  const payload = await fetchOdsay("searchPubTransPathR", {
    SX: String(startStation.x),
    SY: String(startStation.y),
    EX: String(endStation.x),
    EY: String(endStation.y),
    SearchPathType: "2",
    OPT: "0"
  });
  return payload.result?.path || [];
}

function findStationOrder(detail, startStationID, endStationID) {
  const stations = detail?.station || [];
  let startIndex = -1;
  let endIndex = -1;

  for (let index = 0; index < stations.length; index += 1) {
    const station = stations[index];
    const stationID = String(station.stationID);
    if (startIndex < 0 && stationID === String(startStationID)) {
      startIndex = index;
      continue;
    }
    if (startIndex >= 0 && stationID === String(endStationID)) {
      endIndex = index;
      break;
    }
  }

  if (startIndex < 0 || endIndex < 0 || endIndex <= startIndex) {
    return null;
  }

  return {
    startIndex,
    endIndex
  };
}

function getDirectBusFirstTransit(bus) {
  return {
    trafficType: 2,
    lane: [{
      busID: bus.busID,
      busNo: bus.busNo
    }]
  };
}

function getPathTotalTime(path) {
  return getPathSectionTime(path.subPath || []);
}

function buildDirectBusCandidate(pair, ridePath, arrivalInfo) {
  const rideTime = getPathTotalTime(ridePath);
  const initialWalkTime = pair.startWalkMinutes;
  const finalWalkTime = pair.endWalkMinutes;
  const effectiveWait = arrivalInfo.waitMin;
  const totalTime = initialWalkTime + effectiveWait + rideTime + finalWalkTime;
  const firstTransitLabel = pair.bus.busNo;
  const note = arrivalInfo.skippedCount > 0
    ? `정류장까지 도보 ${initialWalkTime}분이 걸려 먼저 오는 버스 ${arrivalInfo.skippedCount}대를 놓치는 것으로 보고, 다음 도착 버스 기준 대기 ${effectiveWait}분을 계산했습니다.`
    : `도보 ${initialWalkTime}분 이동 후 남는 첫 버스 대기 ${effectiveWait}분을 기준으로 계산했습니다.`;

  return {
    id: `direct-${pair.startStation.stationID}-${pair.endStation.stationID}-${pair.bus.busID}`,
    scoreValue: totalTime,
    scoreDisplay: `${totalTime}분`,
    totalTime,
    totalTimeText: formatMinutes(totalTime),
    transferCount: 0,
    transferCountText: "0회",
    walkTime: initialWalkTime + finalWalkTime,
    walkTimeText: formatMinutes(initialWalkTime + finalWalkTime),
    firstWaitMin: effectiveWait,
    firstWaitText: formatMinutes(effectiveWait),
    firstWaitSource: "realtime",
    unavailableBusRealtime: false,
    transferWaitMin: 0,
    transferWaitText: formatMinutes(0),
    transferRiskLevel: "none",
    transferRiskText: null,
    busApproachPreview: null,
    mode: "bus",
    routeNo: pair.bus.busNo,
    firstTransitLabel,
    boardingStopName: pair.startStation.stationName,
    boardingApproachText: initialWalkTime > 0
      ? `도보 후 ${pair.startStation.stationName} 탑승`
      : `${pair.startStation.stationName} 탑승`,
    alightingStopName: pair.endStation.stationName,
    initialWalkTime,
    summarySteps: [
      {
        type: "walk",
        kind: "도보",
        label: `도보 ${initialWalkTime}분`,
        text: `출발지 → ${pair.startStation.stationName}`,
        time: formatMinutes(initialWalkTime)
      },
      {
        type: "bus",
        kind: "버스",
        label: pair.bus.busNo,
        text: `${pair.bus.busNo} · ${pair.startStation.stationName} → ${pair.endStation.stationName}`,
        time: formatMinutes(rideTime)
      },
      {
        type: "walk",
        kind: "도보",
        label: `도보 ${finalWalkTime}분`,
        text: `${pair.endStation.stationName} → 목적지`,
        time: formatMinutes(finalWalkTime)
      }
    ],
    note,
    segments: [
      {
        kind: "도보",
        text: `출발지 → ${pair.startStation.stationName}`,
        time: formatMinutes(initialWalkTime)
      },
      {
        kind: "버스",
        text: `${pair.bus.busNo} · ${pair.startStation.stationName} → ${pair.endStation.stationName}`,
        time: formatMinutes(rideTime)
      },
      {
        kind: "도보",
        text: `${pair.endStation.stationName} → 목적지`,
        time: formatMinutes(finalWalkTime)
      }
    ]
  };
}

async function findBestDirectBusCandidates(fromX, fromY, toX, toY) {
  const [rawStartStations, rawEndStations] = await Promise.all([
    getNearbyBusStations(fromX, fromY, START_STATION_RADIUS),
    getNearbyBusStations(toX, toY, END_STATION_RADIUS)
  ]);

  const startStations = rawStartStations
    .map((station) => ({
      ...station,
      startWalkMinutes: estimateWalkMinutesByCoords(fromX, fromY, station.x, station.y)
    }))
    .sort((a, b) => a.startWalkMinutes - b.startWalkMinutes)
    .slice(0, MAX_START_STATIONS);

  const endStations = rawEndStations
    .map((station) => ({
      ...station,
      endWalkMinutes: estimateWalkMinutesByCoords(station.x, station.y, toX, toY)
    }))
    .sort((a, b) => a.endWalkMinutes - b.endWalkMinutes)
    .slice(0, MAX_END_STATIONS);

  const endRouteMap = new Map();
  endStations.forEach((station) => {
    station.busList.forEach((bus) => {
      const list = endRouteMap.get(String(bus.busID)) || [];
      list.push({ station, bus });
      endRouteMap.set(String(bus.busID), list);
    });
  });

  const rawPairs = [];
  startStations.forEach((startStation) => {
    startStation.busList.forEach((bus) => {
      const endMatches = endRouteMap.get(String(bus.busID)) || [];
      endMatches.forEach(({ station: endStation }) => {
        rawPairs.push({
          bus,
          startStation,
          endStation,
          startWalkMinutes: startStation.startWalkMinutes,
          endWalkMinutes: endStation.endWalkMinutes
        });
      });
    });
  });

  const uniquePairs = [];
  const seen = new Set();
  rawPairs
    .sort((a, b) => (a.startWalkMinutes + a.endWalkMinutes) - (b.startWalkMinutes + b.endWalkMinutes))
    .forEach((pair) => {
      const key = `${pair.bus.busID}:${pair.startStation.stationID}:${pair.endStation.stationID}`;
      if (seen.has(key)) return;
      seen.add(key);
      uniquePairs.push(pair);
    });

  const busDetailCache = new Map();
  const ridePathCache = new Map();
  const candidates = [];

  for (const pair of uniquePairs.slice(0, MAX_DIRECT_BUS_PAIRS)) {
    const busKey = String(pair.bus.busID);
    if (!busDetailCache.has(busKey)) {
      busDetailCache.set(busKey, await getBusLaneDetail(pair.bus.busID).catch(() => null));
    }
    const detail = busDetailCache.get(busKey);
    const order = findStationOrder(detail, pair.startStation.stationID, pair.endStation.stationID);
    if (!order) continue;

    const candidateSeed = {
      mode: "bus",
      routeNo: pair.bus.busNo,
      boardingStopName: pair.startStation.stationName,
      alightingStopName: pair.endStation.stationName
    };
    const mapping = getSeoulBusApiKey()
      ? await resolveBusMapping(candidateSeed, fromX, fromY, toX, toY).catch(() => null)
      : null;
    const arrivalInfo = mapping
      ? await getSeoulBusArrival(mapping, pair.startWalkMinutes).catch(() => null)
      : null;
    if (arrivalInfo == null) continue;
    const busApproachPreview = mapping
      ? await getBusApproachPreview(mapping).catch(() => null)
      : null;

    const rideKey = `${pair.bus.busID}:${pair.startStation.stationID}:${pair.endStation.stationID}`;
    if (!ridePathCache.has(rideKey)) {
      ridePathCache.set(rideKey, await searchBusPathBetweenStations(pair.startStation, pair.endStation).catch(() => []));
    }
    const ridePaths = ridePathCache.get(rideKey);
    const matchedRidePath = ridePaths.find((path) => {
      const firstTransit = getFirstTransit(path.subPath || []);
      if (!firstTransit || firstTransit.trafficType !== 2) return false;
      return normalizeLanes(firstTransit).some((lane) => String(lane.busID) === busKey);
    });
    if (!matchedRidePath) continue;

    const built = buildDirectBusCandidate(pair, matchedRidePath, arrivalInfo);
    built.busApproachPreview = busApproachPreview;
    candidates.push(built);
  }

  return candidates
    .sort((a, b) => {
      if (a.scoreValue !== b.scoreValue) return a.scoreValue - b.scoreValue;
      if (a.firstWaitMin !== b.firstWaitMin) return a.firstWaitMin - b.firstWaitMin;
      return a.walkTime - b.walkTime;
    })
    .slice(0, 4);
}

function getEstimatedWait(priority, firstTransit, liveWait) {
  if (priority !== "best_eta") {
    return { minutes: null, source: "not_applicable" };
  }

  if (!firstTransit) {
    return { minutes: 0, source: "none" };
  }

  if (firstTransit.trafficType === 2) {
    if (liveWait != null) {
      return { minutes: liveWait, source: "seoul_arrival" };
    }
    const busInterval = toNumber(firstTransit.intervalTime) || 0;
    if (busInterval > 0) {
      return { minutes: Math.max(1, Math.round(busInterval / 2)), source: "interval" };
    }
    return { minutes: null, source: "seoul_unavailable" };
  }

  const interval = toNumber(firstTransit.intervalTime) || 0;
  if (interval > 0) {
    return { minutes: Math.max(1, Math.round(interval / 2)), source: "interval" };
  }

  return { minutes: null, source: "none" };
}

function isUnavailableBusForBestEta(firstTransit, wait) {
  return firstTransit?.trafficType === 2 && wait.source === "seoul_unavailable";
}

function getBoardingStopName(firstTransit) {
  if (!firstTransit) return null;
  return firstTransit.startName || firstTransit.startStationName || null;
}

function getLastTransit(subPaths) {
  for (let index = subPaths.length - 1; index >= 0; index -= 1) {
    const segment = subPaths[index];
    if (segment.trafficType === 1 || segment.trafficType === 2) {
      return segment;
    }
  }
  return null;
}

function getAlightingStopName(lastTransit) {
  if (!lastTransit) return null;
  return lastTransit.endName || lastTransit.endStationName || null;
}

function getTransferTimingEstimate(subPaths, priority) {
  if (priority !== "best_eta") {
    return {
      transferWaitMin: 0,
      transferRiskLevel: "none",
      transferRiskText: null,
      tightestSlackMin: null
    };
  }

  const transitIndices = subPaths
    .map((segment, index) => ((segment.trafficType === 1 || segment.trafficType === 2) ? index : -1))
    .filter((index) => index >= 0);

  if (transitIndices.length <= 1) {
    return {
      transferWaitMin: 0,
      transferRiskLevel: "none",
      transferRiskText: null,
      tightestSlackMin: null
    };
  }

  let transferWaitMin = 0;
  let tightestSlackMin = null;

  transitIndices.slice(1).forEach((transitIndex) => {
    const segment = subPaths[transitIndex];
    const interval = toNumber(segment.intervalTime) || 0;
    if (interval <= 0) return;

    const elapsedTravelMin = subPaths
      .slice(0, transitIndex)
      .reduce((sum, item) => sum + Number(item.sectionTime || 0), 0);

    const slackMin = interval - elapsedTravelMin;
    transferWaitMin += Math.max(0, slackMin);
    tightestSlackMin = tightestSlackMin == null ? slackMin : Math.min(tightestSlackMin, slackMin);
  });

  if (tightestSlackMin == null) {
    return {
      transferWaitMin,
      transferRiskLevel: "none",
      transferRiskText: null,
      tightestSlackMin: null
    };
  }

  let transferRiskLevel = "low";
  let transferRiskText = null;

  if (tightestSlackMin <= 1) {
    transferRiskLevel = "high";
    transferRiskText = tightestSlackMin < 0
      ? "환승 여유가 부족해 실제로는 다음 차를 놓칠 가능성이 큽니다."
      : `환승 여유가 ${tightestSlackMin}분 수준이라 지연 시 놓칠 가능성이 큽니다.`;
  } else if (tightestSlackMin <= 4) {
    transferRiskLevel = "medium";
    transferRiskText = `환승 여유가 ${tightestSlackMin}분 정도라 조금만 지연돼도 놓칠 수 있습니다.`;
  }

  return {
    transferWaitMin,
    transferRiskLevel,
    transferRiskText,
    tightestSlackMin
  };
}

function buildCandidate(path, index, priority, liveWait) {
  const info = path.info || {};
  const subPaths = path.subPath || [];
  const firstTransitIndex = subPaths.findIndex((segment) => segment.trafficType === 1 || segment.trafficType === 2);
  const firstTransit = firstTransitIndex >= 0 ? subPaths[firstTransitIndex] : null;
  const wait = getEstimatedWait(priority, firstTransit, liveWait);
  const initialWalkTime = getInitialWalkTime(subPaths, firstTransitIndex);
  const effectiveFirstWaitMin = wait.minutes != null ? Math.max(0, wait.minutes - initialWalkTime) : null;
  const transferTiming = getTransferTimingEstimate(subPaths, priority);
  const totalTime = getPathSectionTime(subPaths);
  const transferCount = inferTransferCount(info);
  const walkTime = getWalkTime(subPaths);
  const summarySteps = summarizeSteps(subPaths);
  const boardingStopName = getBoardingStopName(firstTransit);
  const alightingStopName = getAlightingStopName(getLastTransit(subPaths));
  const unavailableBusRealtime = isUnavailableBusForBestEta(firstTransit, wait);

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
    if (unavailableBusRealtime) {
      scoreValue = totalTime + transferTiming.transferWaitMin;
      scoreDisplay = `${scoreValue}분`;
      note = transferTiming.transferWaitMin > 0
        ? `첫 탑승 실시간은 없지만 환승 대기 추정 ${transferTiming.transferWaitMin}분을 반영했습니다.`
        : "서울시 버스 실시간 도착정보를 확인하지 못해 첫 탑승 대기 없이 비교했습니다.";
    } else {
      const totalWaitMin = (effectiveFirstWaitMin || 0) + transferTiming.transferWaitMin;
      scoreValue = totalTime + totalWaitMin;
      scoreDisplay = `${scoreValue}분`;
      note = totalWaitMin > 0
        ? `첫 탑승 대기 ${effectiveFirstWaitMin || 0}분과 환승 대기 추정 ${transferTiming.transferWaitMin}분을 합쳐 비교했습니다.`
        : "첫 탑승과 환승을 바로 연결할 수 있다고 보고 총 이동시간 기준으로 비교했습니다.";
    }
  } else {
    scoreValue = totalTime;
    scoreDisplay = `${totalTime}분`;
    note = "총 소요시간이 가장 짧은 후보를 우선합니다.";
  }

  const firstTransitLabel = firstTransit
    ? normalizeSegment(firstTransit).label
    : "도보";
  const routeNo = firstTransit?.trafficType === 2 ? (normalizeLanes(firstTransit)[0]?.busNo || null) : null;
  const mode = firstTransit?.trafficType === 2 ? "bus" : (firstTransit?.trafficType === 1 ? "subway" : "walk");

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
    firstWaitMin: effectiveFirstWaitMin,
    firstWaitText: priority !== "best_eta"
      ? "기준 아님"
      : (unavailableBusRealtime ? "실시간 미반영" : (effectiveFirstWaitMin != null ? formatMinutes(effectiveFirstWaitMin) : "정보 없음")),
    firstWaitSource: wait.source,
    unavailableBusRealtime,
    transferWaitMin: transferTiming.transferWaitMin,
    transferWaitText: priority === "best_eta" ? formatMinutes(transferTiming.transferWaitMin) : "기준 아님",
    transferRiskLevel: transferTiming.transferRiskLevel,
    transferRiskText: transferTiming.transferRiskText,
    mode,
    routeNo,
    firstTransitLabel,
    boardingStopName,
    boardingApproachText: boardingStopName
      ? (initialWalkTime > 0 ? `도보 후 ${boardingStopName} 탑승` : `${boardingStopName} 탑승`)
      : null,
    alightingStopName,
    initialWalkTime,
    summarySteps,
    note,
    segments: subPaths.map(normalizeSegment)
  };
}

async function maybeEnrichBusCandidate(candidate, fromX, fromY, toX, toY) {
  if (!candidate || candidate.mode !== "bus" || !candidate.routeNo || !candidate.boardingStopName || !candidate.alightingStopName) {
    return candidate;
  }

  if (!getSeoulBusApiKey()) {
    return candidate;
  }

  try {
    const mapping = await resolveBusMapping(candidate, fromX, fromY, toX, toY);
    if (!mapping) return candidate;
    const arrivalInfo = await getSeoulBusArrival(mapping, candidate.initialWalkTime);
    if (arrivalInfo == null) return candidate;
    const busApproachPreview = await getBusApproachPreview(mapping).catch(() => null);
    if (busApproachPreview?.vehicles) {
      busApproachPreview.vehicles.forEach((vehicle, index) => {
        vehicle.catchable = index >= arrivalInfo.skippedCount;
      });
    }

    const effectiveWait = arrivalInfo.waitMin;
    const totalTime = candidate.totalTime;
    const nextScore = totalTime + effectiveWait + Number(candidate.transferWaitMin || 0);
    const baseNote = arrivalInfo.skippedCount > 0
      ? `정류장까지 도보 ${candidate.initialWalkTime}분이 걸려 먼저 오는 버스 ${arrivalInfo.skippedCount}대를 놓치는 것으로 보고, 다음 도착 버스 기준 대기 ${effectiveWait}분을 반영했습니다.`
      : `서울시 도착정보 기준 현재 버스를 탈 수 있는 실제 대기 ${effectiveWait}분을 반영했습니다.`;
    return {
      ...candidate,
      firstWaitMin: effectiveWait,
      firstWaitText: formatMinutes(effectiveWait),
      firstWaitSource: "seoul_arrival",
      unavailableBusRealtime: false,
      busApproachPreview,
      scoreValue: nextScore,
      scoreDisplay: `${nextScore}분`,
      boardingStopName: mapping.stationName || candidate.boardingStopName,
      boardingApproachText: candidate.initialWalkTime > 0
        ? `도보 후 ${mapping.stationName || candidate.boardingStopName} 탑승`
        : `${mapping.stationName || candidate.boardingStopName} 탑승`,
      alightingStopName: mapping.alightingStationName || candidate.alightingStopName,
      note: candidate.transferRiskText ? `${baseNote} ${candidate.transferRiskText}` : baseNote
    };
  } catch {
    return candidate;
  }
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

function deduplicateCandidates(sorted) {
  const seen = new Set();
  return sorted.filter((candidate) => {
    const key = candidate.routeNo || candidate.firstTransitLabel || "";
    if (!key) return true;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function enrichCandidates(candidates, fromX, fromY, toX, toY) {
  return Promise.all(
    candidates.map((candidate) => maybeEnrichBusCandidate(candidate, fromX, fromY, toX, toY))
  );
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
  const includeIndexStatus = String(req.query.includeIndexStatus || "0") === "1";

  if ([fromX, fromY, toX, toY].some((value) => value == null)) {
    return sendJson(res, 400, { error: "좌표 파라미터가 올바르지 않습니다" });
  }

  const pathType = FILTER_TO_PATH_TYPE[transportFilter] || "0";

  try {
    if (priority === "best_eta" && transportFilter === "bus") {
      const directBusCandidates = await findBestDirectBusCandidates(fromX, fromY, toX, toY);
      if (directBusCandidates.length) {
        await enqueueRouteNos([...new Set(directBusCandidates.map((candidate) => candidate.routeNo).filter(Boolean))], "runtime_refresh");
        const enrichedDirect = await enrichCandidates(directBusCandidates, fromX, fromY, toX, toY);
        const sortedDirect = deduplicateCandidates(chooseRecommendation(enrichedDirect, priority)).slice(0, 4);
        const directRecommendation = sortedDirect[0];
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

    const routePayload = await fetchOdsay("searchPubTransPathR", {
      SX: String(fromX),
      SY: String(fromY),
      EX: String(toX),
      EY: String(toY),
      SearchPathType: pathType,
      OPT: "0"
    });

    const rawPaths = routePayload.result?.path || [];
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
  } catch (error) {
    return sendJson(res, error.statusCode || 500, { error: error.message || "경로 검색에 실패했습니다" });
  }
};
