const crypto = require("crypto");
const { readJson, updateJson, writeJson, getDriverName } = require("./_index-store");
const { searchRoutesByNumber, getStopsByRoute, getArrivalByRoute, getBusPositionsByRoute, downloadRouteWorkbookRows, getWorkbookRowsIfCached } = require("./_seoul-bus");

const STATE_PATH = "collector/state.json";

function normalizeNameKey(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/\([^)]*\)/g, "")
    .replace(/(역|정류장)$/, "")
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
  const norm = normalizeRouteNo(routeNo);
  if (!/^[A-Z0-9-]{1,16}$/.test(norm)) {
    throw new Error("invalid routeNo: " + String(norm).slice(0, 32));
  }
  return `seoul/routes-by-no/${norm}.json`;
}

function routeStopsPath(routeId) {
  const s = String(routeId == null ? "" : routeId);
  if (!/^[A-Za-z0-9_-]{1,32}$/.test(s)) {
    throw new Error("invalid routeId: " + s.slice(0, 32));
  }
  return `seoul/route-stops/${s}.json`;
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

  const normalizedTarget = normalizeRouteNo(routeNo);
  try {
    const fetched = await searchRoutesByNumber(routeNo);
    const exact = fetched.filter((route) => normalizeRouteNo(route.routeNo) === normalizedTarget);
    if (exact.length) {
      const routes = exact.map((route) => ({
        routeId: String(route.routeId),
        routeNo: route.routeNo,
        routeType: route.routeType,
        startName: route.startName,
        endName: route.endName
      }));
      await writeJson(routeListPath(routeNo), {
        routeNo: normalizedTarget,
        collectedAt: new Date().toISOString(),
        source: "seoul_api",
        routes
      });
      return routes;
    }
  } catch {
    // fall through to workbook fallback
  }

  const rows = getWorkbookRowsIfCached();
  if (!rows) return [];
  const routes = [...new Map(
    rows
      .filter((row) => normalizeRouteNo(row.routeNo) === normalizedTarget)
      .map((row) => [String(row.routeId), {
        routeId: String(row.routeId),
        routeNo: row.routeNo,
        routeType: null,
        startName: "",
        endName: ""
      }])
  ).values()];
  await writeJson(routeListPath(routeNo), {
    routeNo: normalizedTarget,
    collectedAt: new Date().toISOString(),
    source: "workbook_fallback",
    routes
  });
  return routes;
}

async function getOrFetchStops(routeId) {
  const cached = await readJson(routeStopsPath(routeId), null);
  if (cached?.stops?.length) return cached.stops;

  try {
    const fetched = await getStopsByRoute(routeId);
    if (fetched.length) {
      const stops = fetched
        .map((stop) => ({
          routeId: String(stop.routeId || routeId),
          seq: Number(stop.seq || 0),
          stationId: stop.stationId,
          arsId: stop.arsId,
          name: stop.name,
          lat: Number(stop.lat),
          lng: Number(stop.lng),
          direction: stop.direction || ""
        }))
        .filter((stop) => stop.stationId && stop.seq > 0)
        .sort((a, b) => a.seq - b.seq);
      if (stops.length) {
        await writeJson(routeStopsPath(routeId), {
          routeId: String(routeId),
          collectedAt: new Date().toISOString(),
          source: "seoul_api",
          stops
        });
        return stops;
      }
    }
  } catch {
    // fall through to workbook fallback
  }

  const rows = getWorkbookRowsIfCached();
  if (!rows) return [];
  const stops = rows
    .filter((row) => String(row.routeId) === String(routeId))
    .sort((a, b) => a.seq - b.seq);
  await writeJson(routeStopsPath(routeId), {
    routeId: String(routeId),
    collectedAt: new Date().toISOString(),
    source: "workbook_fallback",
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
  const totalSeq = stops.length > 0 ? stops[stops.length - 1].seq : 0;
  const midSeq = Math.ceil(totalSeq / 2);
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
      if ((board.seq <= midSeq) !== (alight.seq <= midSeq)) return;
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

  // Fast-path: ODsay already returned the exact Seoul busRouteId + stationIds for the
  // boarding and alighting stops. Trust them — just resolve the stop sequence numbers
  // from the route's stop list so realtime arrival lookups have an `ord`.
  if (candidate.busRouteId && candidate.boardingStationId) {
    const stops = await getOrFetchStops(candidate.busRouteId);
    if (stops.length) {
      const boardStop = stops.find((stop) => String(stop.stationId) === String(candidate.boardingStationId));
      const alightStop = candidate.alightingStationId
        ? stops.find((stop) => String(stop.stationId) === String(candidate.alightingStationId) && (!boardStop || stop.seq > boardStop.seq))
        : null;
      if (boardStop) {
        const mapping = {
          routeNo: candidate.routeNo,
          routeId: String(candidate.busRouteId),
          stationId: String(boardStop.stationId),
          stationSeq: Number(boardStop.seq),
          stationName: boardStop.name,
          alightingStationId: alightStop ? String(alightStop.stationId) : null,
          alightingStationSeq: alightStop ? Number(alightStop.seq) : null,
          alightingStationName: alightStop ? alightStop.name : (candidate.alightingStopName || null),
          confidence: alightStop ? "high" : "medium",
          score: 0,
          source: "odsay_direct",
          version: 3,
          createdAt: new Date().toISOString()
        };
        // Fire-and-forget persistence so the response isn't blocked on GitHub PUT.
        writeJson(busMappingPath(key), { key, mapping, source: "odsay_direct" }).catch(() => {});
        return mapping;
      }
    }
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
    version: 2,
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

async function getSeoulBusArrival(mapping, approachWalkMin = 0) {
  const items = await getArrivalByRoute(mapping.stationId, mapping.routeId, mapping.stationSeq);
  const exact = items.find((item) => String(item.routeId) === String(mapping.routeId));
  if (!exact) return null;
  const walkSeconds = Math.max(0, Math.round(Number(approachWalkMin || 0) * 60));
  const arrivalSecondsSorted = [exact.expectedSeconds1, exact.expectedSeconds2]
    .filter((value) => Number.isFinite(value) && value >= 0)
    .sort((a, b) => a - b);
  if (!arrivalSecondsSorted.length) return null;

  const skippedCount = arrivalSecondsSorted.filter((value) => value < walkSeconds).length;
  const catchableSeconds = arrivalSecondsSorted.find((value) => value >= walkSeconds);
  if (catchableSeconds == null) return null;

  const fetchedAtMs = Date.now();
  const arrivalAtMsSorted = arrivalSecondsSorted.map((seconds) => fetchedAtMs + seconds * 1000);

  return {
    stationArrivalMin: Math.max(0, Math.ceil(catchableSeconds / 60)),
    waitMin: Math.max(0, Math.ceil((catchableSeconds - walkSeconds) / 60)),
    skippedCount,
    arrivalSecondsSorted,
    arrivalAtMsSorted,
    walkSeconds,
    fetchedAtMs
  };
}

function maskPlateNo(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  return raw.length <= 4 ? raw : `${raw.slice(0, -4)}****`;
}

function getVehicleProgressSeq(vehicle, stopSeqByStationId) {
  const lastSeq = stopSeqByStationId.get(String(vehicle.lastStationId));
  const nextSeq = stopSeqByStationId.get(String(vehicle.nextStationId));
  if (Number.isFinite(lastSeq) && Number.isFinite(nextSeq) && nextSeq > lastSeq) {
    const full = Number(vehicle.fullSectionDistance);
    const covered = Number(vehicle.sectionDistance);
    const ratio = full > 0 && Number.isFinite(covered) ? Math.min(1, Math.max(0, covered / full)) : 0;
    return lastSeq + ratio;
  }
  if (Number.isFinite(nextSeq)) return nextSeq - 0.15;
  if (Number.isFinite(lastSeq)) return lastSeq;
  return null;
}

function getApproachStartSeq(stops, mapping, stopWindow) {
  const boardingSeq = Number(mapping.stationSeq);
  const defaultStartSeq = Math.max(1, boardingSeq - (stopWindow - 1));
  const boardingNameKey = normalizeNameKey(mapping.stationName);
  if (!boardingNameKey) return defaultStartSeq;

  const previousSameStop = stops
    .filter((stop) => {
      if (Number(stop.seq) >= boardingSeq) return false;
      if (String(stop.stationId) === String(mapping.stationId)) return true;
      return normalizeNameKey(stop.name) === boardingNameKey;
    })
    .sort((a, b) => Number(b.seq) - Number(a.seq))[0];

  if (!previousSameStop) return defaultStartSeq;
  return Math.max(defaultStartSeq, Number(previousSameStop.seq) + 1);
}

async function getBusApproachPreview(mapping, stopWindow = 10) {
  const stops = await getOrFetchStops(mapping.routeId);
  const boardingIndex = stops.findIndex((stop) => String(stop.stationId) === String(mapping.stationId));
  if (boardingIndex < 0) return null;

  const stopSeqByStationId = new Map(stops.map((stop) => [String(stop.stationId), stop.seq]));
  const vehicles = await getBusPositionsByRoute(mapping.routeId);
  const maxApproachGap = Math.ceil(stops.length / 3);
  const approachStartSeq = getApproachStartSeq(stops, mapping, stopWindow);
  const approaching = vehicles
    .map((vehicle) => {
      const progressSeq = getVehicleProgressSeq(vehicle, stopSeqByStationId);
      if (!Number.isFinite(progressSeq)) return null;
      const remainingSeq = mapping.stationSeq - progressSeq;
      if (remainingSeq <= 0 || remainingSeq > Math.min(10, maxApproachGap)) return null;
      if (progressSeq < approachStartSeq) return null;
      return {
        ...vehicle,
        progressSeq,
        remainingSeq
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.remainingSeq - b.remainingSeq)
    .slice(0, 3);

  const previewStops = stops.filter((stop) => stop.seq >= approachStartSeq && stop.seq <= mapping.stationSeq);
  if (!previewStops.length) return null;

  const boardingSeq = Number(mapping.stationSeq);
  const alightingSeq = Number(mapping.alightingStationSeq);
  const ridingStops = (Number.isFinite(alightingSeq) && alightingSeq > boardingSeq)
    ? stops
        .filter((stop) => stop.seq >= boardingSeq && stop.seq <= alightingSeq)
        .map((stop) => ({
          seq: stop.seq,
          name: stop.name,
          stationId: stop.stationId,
          lat: stop.lat,
          lng: stop.lng,
          isBoarding: String(stop.stationId) === String(mapping.stationId),
          isAlighting: String(stop.stationId) === String(mapping.alightingStationId)
        }))
    : [];

  const minSeq = previewStops[0].seq;
  const cellCount = previewStops.length;

  return {
    routeNo: mapping.routeNo,
    routeId: mapping.routeId,
    boardingStopName: mapping.stationName,
    boardingStationId: mapping.stationId,
    boardingStationSeq: mapping.stationSeq,
    alightingStopName: mapping.alightingStationName || null,
    alightingStationId: mapping.alightingStationId || null,
    alightingStationSeq: Number.isFinite(alightingSeq) ? alightingSeq : null,
    approachStartSeq,
    approachDirectionFrom: previewStops[0]?.name || "",
    stops: previewStops.map((stop) => ({
      seq: stop.seq,
      name: stop.name,
      stationId: stop.stationId,
      lat: stop.lat,
      lng: stop.lng,
      isBoarding: String(stop.stationId) === String(mapping.stationId),
      isAlighting: String(stop.stationId) === String(mapping.alightingStationId)
    })),
    ridingStops,
    vehicles: approaching.map((vehicle, index) => {
      const lat = Number(vehicle.gpsY);
      const lng = Number(vehicle.gpsX);
      return {
        key: vehicle.vehicleId,
        label: index === 0 ? "다음" : (index === 1 ? "다다음" : "세번째"),
        plateNoMasked: maskPlateNo(vehicle.plateNo),
        remainingStops: Math.max(0, Math.ceil(vehicle.remainingSeq)),
        nextStopName: stops.find((stop) => String(stop.stationId) === String(vehicle.nextStationId))?.name || "",
        progressSeq: vehicle.progressSeq,
        progressPercent: Math.max(0, Math.min(100, ((vehicle.progressSeq - minSeq + 0.5) / cellCount) * 100)),
        gpsLat: Number.isFinite(lat) ? lat : null,
        gpsLng: Number.isFinite(lng) ? lng : null,
        dataTime: vehicle.dataTime || null
      };
    })
  };
}

function decorateVehiclesWithArrival(preview, arrivalInfo) {
  if (!preview?.vehicles || !arrivalInfo) return preview;
  const arrivalSecondsSorted = arrivalInfo.arrivalSecondsSorted || [];
  const arrivalAtMsSorted = arrivalInfo.arrivalAtMsSorted || [];
  const walkSeconds = arrivalInfo.walkSeconds || 0;
  const fetchedAtMs = arrivalInfo.fetchedAtMs || Date.now();
  preview.fetchedAt = new Date(fetchedAtMs).toISOString();
  preview.walkSeconds = walkSeconds;
  preview.vehicles.forEach((vehicle, index) => {
    const eta = arrivalSecondsSorted[index];
    const etaAtMs = arrivalAtMsSorted[index];
    if (eta != null) {
      vehicle.etaSeconds = eta;
      vehicle.etaMinutes = Math.max(0, Math.ceil(eta / 60));
      vehicle.etaAt = new Date(etaAtMs).toISOString();
      vehicle.catchable = eta >= walkSeconds;
      if (!vehicle.catchable) {
        vehicle.passedAgoMinutes = Math.max(0, Math.ceil((walkSeconds - eta) / 60));
      }
    } else {
      vehicle.etaSeconds = null;
      vehicle.etaMinutes = null;
      vehicle.etaAt = null;
      vehicle.catchable = true;
    }
  });
  return preview;
}

async function getLiveBusPreview({ routeId, boardingStationId, alightingStationId, walkMinutes }) {
  if (!routeId || !boardingStationId) return null;
  const stops = await getOrFetchStops(routeId);
  if (!stops.length) return null;
  const board = stops.find((stop) => String(stop.stationId) === String(boardingStationId));
  if (!board) return null;
  const alight = alightingStationId
    ? stops.find((stop) => String(stop.stationId) === String(alightingStationId) && stop.seq > board.seq)
    : null;
  const mapping = {
    routeId: String(routeId),
    stationId: String(board.stationId),
    stationSeq: Number(board.seq),
    stationName: board.name,
    alightingStationId: alight ? String(alight.stationId) : null,
    alightingStationSeq: alight ? Number(alight.seq) : null,
    alightingStationName: alight ? alight.name : null
  };
  const [preview, arrival] = await Promise.all([
    getBusApproachPreview(mapping).catch(() => null),
    getSeoulBusArrival(mapping, walkMinutes || 0).catch(() => null)
  ]);
  if (!preview) return null;
  if (arrival) decorateVehiclesWithArrival(preview, arrival);
  return { preview, arrival, mapping };
}

module.exports = {
  enqueueRouteNos,
  collectRouteIndex,
  getCollectorStatus,
  resolveBusMapping,
  getSeoulBusArrival,
  getBusApproachPreview,
  decorateVehiclesWithArrival,
  getLiveBusPreview,
  normalizeRouteNo
};
