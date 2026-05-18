const { fetchOdsay } = require("../_odsay");
const { resolveBusMapping, getSeoulBusArrival, getBusApproachPreview } = require("../_mapping-index");
const { getSeoulBusApiKey } = require("../_seoul-bus");
const { distanceMeters } = require("../_geo");
const {
  toNumber,
  formatMinutes,
  normalizeLanes,
  normalizeCoordPoint,
  dedupePathPoints,
  normalizeSegment,
  getFirstTransit,
  getPathSectionTime
} = require("./_common");

const WALK_METERS_PER_MINUTE = 67;
const START_STATION_RADIUS = 350;
const END_STATION_RADIUS = 600;
const MAX_START_STATIONS = 4;
const MAX_END_STATIONS = 6;
const MAX_DIRECT_BUS_PAIRS = 12;

function estimateWalkMinutesByCoords(fromX, fromY, toX, toY) {
  const meters = distanceMeters(fromX, fromY, toX, toY);
  return Math.max(1, Math.round(meters / WALK_METERS_PER_MINUTE));
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
  const rideSegments = (ridePath.subPath || []).map(normalizeSegment);
  const busRideSegment = rideSegments.find((segment) => segment.type === "bus");
  const busPathPoints = busRideSegment?.pathPoints?.length >= 2
    ? busRideSegment.pathPoints
    : dedupePathPoints([
      normalizeCoordPoint(pair.startStation.x, pair.startStation.y),
      normalizeCoordPoint(pair.endStation.x, pair.endStation.y)
    ]);
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
        time: formatMinutes(initialWalkTime),
        pathPoints: dedupePathPoints([
          normalizeCoordPoint(pair.startStation.x, pair.startStation.y)
        ])
      },
      {
        type: "bus",
        kind: "버스",
        label: pair.bus.busNo,
        text: `${pair.bus.busNo} · ${pair.startStation.stationName} → ${pair.endStation.stationName}`,
        time: formatMinutes(rideTime),
        pathPoints: busPathPoints
      },
      {
        type: "walk",
        kind: "도보",
        label: `도보 ${finalWalkTime}분`,
        text: `${pair.endStation.stationName} → 목적지`,
        time: formatMinutes(finalWalkTime),
        pathPoints: dedupePathPoints([
          normalizeCoordPoint(pair.endStation.x, pair.endStation.y)
        ])
      }
    ],
    note,
    segments: [
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

module.exports = {
  findBestDirectBusCandidates,
  estimateWalkMinutesByCoords,
  normalizePointBusStation,
  getNearbyBusStations,
  getBusLaneDetail,
  searchBusPathBetweenStations,
  findStationOrder,
  getDirectBusFirstTransit,
  getPathTotalTime,
  buildDirectBusCandidate,
  WALK_METERS_PER_MINUTE,
  START_STATION_RADIUS,
  END_STATION_RADIUS,
  MAX_START_STATIONS,
  MAX_END_STATIONS,
  MAX_DIRECT_BUS_PAIRS
};
