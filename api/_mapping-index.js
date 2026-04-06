const crypto = require("crypto");
const { readJson, updateJson, writeJson, getDriverName } = require("./_index-store");
const { searchRoutesByNumber, getStopsByRoute, getArrivalByRoute, downloadRouteWorkbookRows } = require("./_seoul-bus");

const STATE_PATH = "collector/state.json";

function normalizeNameKey(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/\([^)]*\)/g, "")
    .replace(/역|정류장/g, "")
    .replace(/\s+/g, "")
    .trim();
}

function normalizeRouteNo(value) {
  return String(value || "").trim().toUpperCase().replace(/\s+/g, "");
}

function mappingKey(candidate) {
  const raw = [
    normalizeRouteNo(candidate.routeNo),
    normalizeNameKey(candidate.boardingStopName),
    normalizeNameKey(candidate.alightingStopName)
  ].join("|");
  return crypto.createHash("sha1").update(raw).digest("hex");
}

function routeListPath(routeNo) {
  return `seoul/routes-by-no/${normalizeRouteNo(routeNo)}.json`;
}

function routeStopsPath(routeId) {
  return `seoul/route-stops/${routeId}.json`;
}

function busMappingPath(key) {
  return `seoul/mappings/bus/${key}.json`;
}

function distanceMeters(fromX, fromY, toX, toY) {
  const toRadians = (value) => (Number(value) * Math.PI) / 180;
  const earthRadiusMeters = 6371000;
  const dLat = toRadians(Number(toY) - Number(fromY));
  const dLon = toRadians(Number(toX) - Number(fromX));
  const lat1 = toRadians(fromY);
  const lat2 = toRadians(toY);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return earthRadiusMeters * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

async function getOrFetchRoutes(routeNo) {
  const cached = await readJson(routeListPath(routeNo), null);
  if (cached?.routes?.length) return cached.routes;
  const rows = await downloadRouteWorkbookRows();
  const routes = [...new Map(
    rows
      .filter((row) => normalizeRouteNo(row.routeNo) === normalizeRouteNo(routeNo))
      .map((row) => [String(row.routeId), {
        routeId: String(row.routeId),
        routeNo: row.routeNo,
        routeType: null,
        startName: "",
        endName: ""
      }])
  ).values()];
  await writeJson(routeListPath(routeNo), {
    routeNo: normalizeRouteNo(routeNo),
    collectedAt: new Date().toISOString(),
    routes
  });
  return routes;
}

async function getOrFetchStops(routeId) {
  const cached = await readJson(routeStopsPath(routeId), null);
  if (cached?.stops?.length) return cached.stops;
  const rows = await downloadRouteWorkbookRows();
  const stops = rows
    .filter((row) => String(row.routeId) === String(routeId))
    .sort((a, b) => a.seq - b.seq);
  await writeJson(routeStopsPath(routeId), {
    routeId: String(routeId),
    collectedAt: new Date().toISOString(),
    stops
  });
  return stops;
}

function scoreStopCandidate(candidate, fromX, fromY, toX, toY) {
  const boardDistance = distanceMeters(fromX, fromY, candidate.board.lng, candidate.board.lat);
  const alightDistance = distanceMeters(candidate.alight.lng, candidate.alight.lat, toX, toY);
  return (
    (candidate.boardExact ? 0 : 5000) +
    (candidate.alightExact ? 0 : 5000) +
    boardDistance +
    alightDistance +
    Math.max(0, (candidate.alight.seq - candidate.board.seq) * -1000)
  );
}

function buildRouteCandidates(route, stops, candidate, fromX, fromY, toX, toY) {
  const boardKey = normalizeNameKey(candidate.boardingStopName);
  const alightKey = normalizeNameKey(candidate.alightingStopName);
  const boardStops = stops.filter((stop) => {
    const key = normalizeNameKey(stop.name);
    return key === boardKey || key.includes(boardKey) || boardKey.includes(key);
  });
  const alightStops = stops.filter((stop) => {
    const key = normalizeNameKey(stop.name);
    return key === alightKey || key.includes(alightKey) || alightKey.includes(key);
  });

  const pairs = [];
  boardStops.forEach((board) => {
    alightStops.forEach((alight) => {
      if (board.seq >= alight.seq) return;
      const boardExact = normalizeNameKey(board.name) === boardKey;
      const alightExact = normalizeNameKey(alight.name) === alightKey;
      pairs.push({
        route,
        board,
        alight,
        boardExact,
        alightExact,
        score: scoreStopCandidate({ route, board, alight, boardExact, alightExact }, fromX, fromY, toX, toY)
      });
    });
  });

  return pairs;
}

async function resolveBusMapping(candidate, fromX, fromY, toX, toY) {
  const key = mappingKey(candidate);
  const cached = await readJson(busMappingPath(key), null);
  if (cached?.mapping) {
    return cached.mapping;
  }

  const routes = await getOrFetchRoutes(candidate.routeNo);
  const scored = [];
  for (const route of routes) {
    const stops = await getOrFetchStops(route.routeId);
    scored.push(...buildRouteCandidates(route, stops, candidate, fromX, fromY, toX, toY));
  }

  scored.sort((a, b) => a.score - b.score);
  const best = scored[0];
  if (!best) return null;

  const mapping = {
    routeNo: candidate.routeNo,
    routeId: best.route.routeId,
    stationId: best.board.stationId,
    stationSeq: best.board.seq,
    stationName: best.board.name,
    alightingStationId: best.alight.stationId,
    alightingStationSeq: best.alight.seq,
    alightingStationName: best.alight.name,
    confidence: best.score < 400 ? "high" : best.score < 1200 ? "medium" : "low",
    score: Math.round(best.score),
    createdAt: new Date().toISOString()
  };

  await writeJson(busMappingPath(key), {
    key,
    mapping,
    source: "runtime_resolve"
  });
  return mapping;
}

async function enqueueRouteNos(routeNos, source = "runtime") {
  const normalized = routeNos.map(normalizeRouteNo).filter(Boolean);
  if (!normalized.length) return;
  await updateJson(STATE_PATH, {
    pendingRouteNos: [],
    processedRouteNos: {},
    failedRouteNos: {},
    lastRunAt: null,
    lastSource: null
  }, (state) => {
    const pending = new Set(state.pendingRouteNos || []);
    normalized.forEach((routeNo) => {
      if (!state.processedRouteNos?.[routeNo]) pending.add(routeNo);
    });
    return {
      ...state,
      pendingRouteNos: [...pending],
      lastSource: source
    };
  });
}

async function collectRouteIndex(limit = 6) {
  const state = await readJson(STATE_PATH, {
    pendingRouteNos: [],
    processedRouteNos: {},
    failedRouteNos: {},
    lastRunAt: null,
    lastSource: null
  });

  const queue = [...(state.pendingRouteNos || [])];
  const batch = queue.splice(0, limit);
  const processed = [];
  const failed = [];

  let workbookRows = null;
  if (batch.length) {
    try {
      workbookRows = await downloadRouteWorkbookRows();
    } catch (error) {
      const nextState = {
        pendingRouteNos: batch.concat(queue),
        processedRouteNos: state.processedRouteNos || {},
        failedRouteNos: {
          ...(state.failedRouteNos || {}),
          __collector__: error.message
        },
        lastRunAt: new Date().toISOString(),
        lastSource: "collector_file"
      };
      await writeJson(STATE_PATH, nextState);
      return {
        driver: getDriverName(),
        processed: [],
        failed: batch.map((routeNo) => ({ routeNo, error: error.message })),
        remaining: nextState.pendingRouteNos.length,
        lastRunAt: nextState.lastRunAt
      };
    }
  }

  for (const routeNo of batch) {
    try {
      const routes = [...new Map(
        workbookRows
          .filter((row) => normalizeRouteNo(row.routeNo) === normalizeRouteNo(routeNo))
          .map((row) => [String(row.routeId), {
            routeId: String(row.routeId),
            routeNo: row.routeNo,
            routeType: null,
            startName: "",
            endName: ""
          }])
      ).values()];

      await writeJson(routeListPath(routeNo), {
        routeNo,
        collectedAt: new Date().toISOString(),
        routes
      });
      for (const route of routes) {
        const stops = workbookRows
          .filter((row) => String(row.routeId) === String(route.routeId))
          .sort((a, b) => a.seq - b.seq);
        await writeJson(routeStopsPath(route.routeId), {
          routeId: route.routeId,
          routeNo: route.routeNo,
          collectedAt: new Date().toISOString(),
          stops
        });
      }
      processed.push(routeNo);
    } catch (error) {
      failed.push({ routeNo, error: error.message });
    }
  }

  const nextState = {
    pendingRouteNos: queue.concat(failed.map((item) => item.routeNo)),
    processedRouteNos: {
      ...(state.processedRouteNos || {}),
      ...Object.fromEntries(processed.map((routeNo) => [routeNo, new Date().toISOString()]))
    },
    failedRouteNos: (() => {
      const current = { ...(state.failedRouteNos || {}) };
      processed.forEach((routeNo) => delete current[routeNo]);
      failed.forEach((item) => { current[item.routeNo] = item.error; });
      return current;
    })(),
    lastRunAt: new Date().toISOString(),
    lastSource: "collector"
  };

  await writeJson(STATE_PATH, nextState);
  return {
    driver: getDriverName(),
    processed,
    failed,
    remaining: nextState.pendingRouteNos.length,
    lastRunAt: nextState.lastRunAt
  };
}

async function getCollectorStatus() {
  const state = await readJson(STATE_PATH, {
    pendingRouteNos: [],
    processedRouteNos: {},
    failedRouteNos: {},
    lastRunAt: null,
    lastSource: null
  });
  return {
    driver: getDriverName(),
    pendingCount: (state.pendingRouteNos || []).length,
    processedCount: Object.keys(state.processedRouteNos || {}).length,
    failedCount: Object.keys(state.failedRouteNos || {}).length,
    lastRunAt: state.lastRunAt,
    lastSource: state.lastSource,
    pendingPreview: (state.pendingRouteNos || []).slice(0, 12)
  };
}

async function getSeoulBusArrival(mapping) {
  const items = await getArrivalByRoute(mapping.stationId, mapping.routeId, mapping.stationSeq);
  const exact = items.find((item) => String(item.routeId) === String(mapping.routeId));
  if (!exact) return null;
  const seconds = [exact.expectedSeconds1, exact.expectedSeconds2].filter((value) => Number.isFinite(value) && value >= 0);
  if (!seconds.length) return null;
  return Math.max(1, Math.ceil(Math.min(...seconds) / 60));
}

module.exports = {
  enqueueRouteNos,
  collectRouteIndex,
  getCollectorStatus,
  resolveBusMapping,
  getSeoulBusArrival,
  normalizeRouteNo
};
