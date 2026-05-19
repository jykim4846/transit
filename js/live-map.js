import { escapeHtml, minuteNumber } from "./util.js";
import { state, persistBoardedTrip } from "./state.js";
import { loadKakaoMaps } from "./live-map-keys.js";
import { canRequestGeolocation } from "./location-permission.js";
import { inferSegmentType, updateBoardingPanelDOM } from "./render.js";
import { recordTelemetry } from "./telemetry.js";

const LIVE_MAP_LOAD_TIMEOUT_MS = 5000;
const BUS_POLL_BASE_DELAY_MS = 20000;
const BUS_POLL_MAX_DELAY_MS = 90000;

function isE2EFastPoll() {
  return Boolean(window.__TRANSIT_E2E_FAST_POLL);
}

let getSelectedCandidate = () => null;
let endBoarding = () => {};

export function configureLiveMapRuntime(options = {}) {
  if (typeof options.getSelectedCandidate === "function") {
    getSelectedCandidate = options.getSelectedCandidate;
  }
  if (typeof options.endBoarding === "function") {
    endBoarding = options.endBoarding;
  }
}

function toLatLngPoint(location) {
  const lat = Number(location?.y ?? location?.lat);
  const lng = Number(location?.x ?? location?.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { lat, lng };
}

function toPathPoint(value) {
  const lat = Number(value?.lat ?? value?.y);
  const lng = Number(value?.lng ?? value?.x);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { lat, lng };
}

function dedupePathPoints(points) {
  const result = [];
  points.filter(Boolean).forEach((point) => {
    const prev = result[result.length - 1];
    if (prev && Math.abs(prev.lat - point.lat) < 0.000001 && Math.abs(prev.lng - point.lng) < 0.000001) return;
    result.push(point);
  });
  return result;
}

function interpolatePoint(a, b, ratio) {
  return {
    lat: a.lat + (b.lat - a.lat) * ratio,
    lng: a.lng + (b.lng - a.lng) * ratio
  };
}

function pointAtSeq(stops, seq) {
  const sorted = stops
    .map((stop) => ({ ...stop, point: toPathPoint(stop), seq: Number(stop.seq) }))
    .filter((stop) => stop.point && Number.isFinite(stop.seq))
    .sort((a, b) => a.seq - b.seq);
  if (!sorted.length || !Number.isFinite(Number(seq))) return sorted[0]?.point || null;
  const target = Number(seq);
  let prev = sorted[0];
  let next = sorted[sorted.length - 1];
  for (let index = 0; index < sorted.length; index += 1) {
    if (sorted[index].seq <= target) prev = sorted[index];
    if (sorted[index].seq >= target) {
      next = sorted[index];
      break;
    }
  }
  if (!prev || !next || prev.seq === next.seq) return (next || prev)?.point || null;
  return interpolatePoint(prev.point, next.point, (target - prev.seq) / (next.seq - prev.seq));
}

function getFirstBusSegment(candidate) {
  return (candidate?.segments || []).find((segment) => inferSegmentType(segment) === "bus") || null;
}

function getBoardingSeq(preview) {
  const explicitSeq = Number(preview?.boardingStationSeq);
  if (Number.isFinite(explicitSeq)) return explicitSeq;
  const boardingStop = (preview?.stops || []).find((stop) => stop.isBoarding);
  const inferredSeq = Number(boardingStop?.seq);
  return Number.isFinite(inferredSeq) ? inferredSeq : null;
}

function getBoardingStopPoint(candidate, origin) {
  const stops = candidate?.busApproachPreview?.stops || [];
  const boarding = stops.find((stop) => stop.isBoarding)
    || stops.find((stop) => Number(stop.seq) === Number(candidate?.busApproachPreview?.boardingStationSeq))
    || stops[stops.length - 1];
  const previewPoint = toPathPoint(boarding);
  if (previewPoint) return previewPoint;

  const firstBus = getFirstBusSegment(candidate);
  const segmentPoint = toPathPoint(firstBus?.pathPoints?.[0]);
  if (segmentPoint) return segmentPoint;

  return origin;
}

function getApproachStopPoints(candidate) {
  const preview = candidate?.busApproachPreview;
  const stops = preview?.stops || [];
  const boardingSeq = getBoardingSeq(preview);
  const sortedStops = stops
    .filter((stop) => toPathPoint(stop))
    .sort((a, b) => Number(a.seq) - Number(b.seq));
  let boardingIndex = sortedStops.findIndex((stop) => stop.isBoarding);
  if (boardingIndex < 0) {
    boardingIndex = sortedStops.findIndex((stop) => Number(stop.seq) === boardingSeq);
  }
  const approachStops = Number.isFinite(boardingSeq)
    ? sortedStops.filter((stop) => Number(stop.seq) <= boardingSeq)
    : (boardingIndex >= 0 ? sortedStops.slice(0, boardingIndex + 1) : []);
  return dedupePathPoints(approachStops.map(toPathPoint));
}

function getRealtimeBusPoints(candidate) {
  const preview = candidate?.busApproachPreview;
  const boardingSeq = getBoardingSeq(preview);
  if (!preview?.stops?.length || !preview?.vehicles?.length) return [];
  return preview.vehicles
    .filter((vehicle) => boardingSeq == null || Number(vehicle.progressSeq) < boardingSeq)
    .slice(0, 3)
    .map((vehicle, index) => ({
      index,
      label: vehicle.label || (index === 0 ? "다음" : `${index + 1}번째`),
      remainingStops: vehicle.remainingStops,
      etaMinutes: vehicle.etaMinutes,
      point: pointAtSeq(preview.stops, vehicle.progressSeq)
    }))
    .filter((bus) => bus.point);
}

function buildLiveTransitPoints(route, candidate) {
  const origin = toLatLngPoint(route?.from) || { lat: 37.4979, lng: 127.0276 };
  const destination = toLatLngPoint(route?.to) || null;
  const user = state.userLocation || origin;
  const hasBusLeg = (candidate?.segments || []).some((segment) => inferSegmentType(segment) === "bus");
  const boarding = getBoardingStopPoint(candidate, origin);
  const approachPoints = getApproachStopPoints(candidate);
  const approachingBuses = getRealtimeBusPoints(candidate);
  if (!hasBusLeg) {
    return {
      canRenderMap: false,
      fallbackReason: "no_bus",
      fallbackMessage: "실시간 차량 추적 없음",
      origin,
      destination,
      user,
      boardingStop: boarding,
      busPoints: [],
      approachPolylinePoints: []
    };
  }
  if (approachPoints.length < 2) {
    return {
      canRenderMap: false,
      fallbackReason: "no_approach",
      fallbackMessage: "실시간 차량 방향 정보를 확인 중이에요",
      origin,
      destination,
      user,
      boardingStop: boarding,
      busPoints: [],
      approachPolylinePoints: []
    };
  }
  return {
    canRenderMap: true,
    origin,
    destination,
    user,
    boardingStop: boarding,
    busPoints: approachingBuses,
    approachPolylinePoints: approachPoints
  };
}

function renderLiveMapFallback(container, route, candidate, reason) {
  const fallback = container.querySelector("[data-live-map-fallback]");
  if (!fallback) return;
  const canvas = container.querySelector(".live-map-canvas");
  if (canvas) canvas.style.display = "none";
  fallback.classList.toggle("no-bus", reason === "no_bus");
  fallback.style.display = "grid";

  const boardingName = candidate?.boardingStopName || "탑승 정류장 정보 없음";
  const alightingName = candidate?.alightingStopName || "도착 정류장 정보 없음";
  const transit = candidate?.firstTransitLabel || "이동";
  const totalMin = minuteNumber(candidate?.journeyMinutes || candidate?.scoreDisplay || candidate?.totalTime);
  const segmentLine = (candidate?.segments || [])
    .filter((segment) => segment && (segment.kind === "버스" || segment.kind === "지하철" || (segment.kind === "도보" && minuteNumber(segment.time) > 0)))
    .slice(0, 4)
    .map((segment) => `${segment.label || segment.kind} ${segment.time || ""}`.trim())
    .join(" · ");

  if (reason === "no_bus") {
    fallback.innerHTML = `
      <strong>${escapeHtml(transit)} 중심 경로 · 실시간 차량 추적 없음</strong>
      <span>${escapeHtml(route.from?.name || "출발지")} → ${escapeHtml(route.to?.name || "도착지")} · 총 ${escapeHtml(totalMin || "--")}분</span>
      ${segmentLine ? `<span>${escapeHtml(segmentLine)}</span>` : ""}
      <span>지하철·도보 중심이라 지도 위에 실시간 버스를 표시하지 않습니다.</span>
    `;
  } else if (reason === "timeout" || reason === "error") {
    fallback.innerHTML = `
      <strong>실시간 차량 위치를 불러오지 못했어요</strong>
      <span>경로 정보는 계속 볼 수 있어요 · ${escapeHtml(boardingName)} → ${escapeHtml(alightingName)}</span>
      ${segmentLine ? `<span>${escapeHtml(segmentLine)}</span>` : ""}
      <span>잠시 후 "실시간으로 다시 계산"을 눌러 새로 가져와 보세요.</span>
    `;
  } else {
    fallback.innerHTML = `
      <strong>이 노선은 실시간 위치 정보가 없어요</strong>
      <span>${escapeHtml(boardingName)} → ${escapeHtml(alightingName)} · 노선 매핑이 수집되면 자동으로 표시됩니다.</span>
      ${segmentLine ? `<span>${escapeHtml(segmentLine)}</span>` : ""}
      <span>경로 정보는 계속 사용할 수 있어요.</span>
    `;
  }
}

export function clearLiveMapTimer(routeId) {
  const timer = state.liveMapTimers[routeId];
  if (timer) {
    clearTimeout(timer);
    delete state.liveMapTimers[routeId];
  }
}

export async function startUserLocationWatch(options = {}) {
  if (state.locationWatchId != null || !navigator.geolocation) return false;
  const allowed = await canRequestGeolocation({ requestIfPrompt: Boolean(options.requestIfPrompt) });
  if (!allowed) return false;

  state.locationWatchId = navigator.geolocation.watchPosition(
    (position) => {
      state.locationPermissionState = "granted";
      state.userLocation = {
        lat: position.coords.latitude,
        lng: position.coords.longitude
      };
      Object.values(state.liveMaps).forEach((entry) => {
        if (!entry?.maps || !entry.userOverlay) return;
        entry.userOverlay.setPosition(new entry.maps.LatLng(state.userLocation.lat, state.userLocation.lng));
      });
    },
    (error) => {
      if (error?.code === error.PERMISSION_DENIED) {
        state.locationPermissionState = "denied";
        if (state.locationWatchId != null) {
          navigator.geolocation.clearWatch(state.locationWatchId);
          state.locationWatchId = null;
        }
      }
    },
    { enableHighAccuracy: true, maximumAge: 15000, timeout: 8000 }
  );
  return true;
}

export function stopUserLocationWatch() {
  if (state.locationWatchId == null || !navigator.geolocation) return false;
  navigator.geolocation.clearWatch(state.locationWatchId);
  state.locationWatchId = null;
  return true;
}

function overlayContent(html, className = "") {
  const el = document.createElement("div");
  el.className = className;
  el.innerHTML = html;
  return el;
}

function easeInOutCubic(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

export async function initLiveTransitMaps() {
  const containers = Array.from(document.querySelectorAll("[data-live-map]"));
  if (!containers.length) return;

  containers.forEach((container) => {
    const routeId = container.dataset.routeId;
    if (!routeId) return;
    const route = state.routes.find((item) => item.id === routeId);
    const candidate = route ? getSelectedCandidate(route) : null;
    const points = candidate ? buildLiveTransitPoints(route, candidate) : null;

    if (!points || !points.canRenderMap) {
      renderLiveMapFallback(container, route, candidate, points?.fallbackReason || "no_approach");
      return;
    }

    clearLiveMapTimer(routeId);
    state.liveMapTimers[routeId] = setTimeout(() => {
      if (state.liveMaps[routeId]) return;
      renderLiveMapFallback(container, route, candidate, "timeout");
    }, LIVE_MAP_LOAD_TIMEOUT_MS);
  });

  let maps;
  try {
    maps = await loadKakaoMaps();
  } catch (_) {
    containers.forEach((container) => {
      const routeId = container.dataset.routeId;
      clearLiveMapTimer(routeId);
      const route = state.routes.find((item) => item.id === routeId);
      const candidate = route ? getSelectedCandidate(route) : null;
      renderLiveMapFallback(container, route, candidate, "error");
    });
    return;
  }
  await startUserLocationWatch({ requestIfPrompt: false });

  containers.forEach((container) => {
    const routeId = container.dataset.routeId;
    if (!routeId || state.liveMaps[routeId]) return;
    const canvas = container.querySelector(".live-map-canvas");
    const fallback = container.querySelector("[data-live-map-fallback]");
    const route = state.routes.find((item) => item.id === routeId);
    if (!canvas || !route) {
      clearLiveMapTimer(routeId);
      return;
    }

    const candidate = getSelectedCandidate(route);
    const points = candidate ? buildLiveTransitPoints(route, candidate) : null;
    if (!points || !points.canRenderMap) {
      clearLiveMapTimer(routeId);
      renderLiveMapFallback(container, route, candidate, points?.fallbackReason || "no_approach");
      return;
    }
    clearLiveMapTimer(routeId);
    canvas.style.display = "";
    const map = new maps.Map(canvas, {
      center: new maps.LatLng(points.boardingStop.lat, points.boardingStop.lng),
      level: 5
    });
    const approachPath = points.approachPolylinePoints.map((point) => new maps.LatLng(point.lat, point.lng));
    const approachPolyline = new maps.Polyline({
      path: approachPath,
      strokeWeight: 7,
      strokeColor: "#2563eb",
      strokeOpacity: 0.74,
      strokeStyle: "solid"
    });
    approachPolyline.setMap(map);

    const ridingStops = candidate?.busApproachPreview?.ridingStops || [];
    const ridingPathPoints = ridingStops
      .map((stop) => ({ lat: Number(stop.lat), lng: Number(stop.lng) }))
      .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng));
    let ridingPolyline = null;
    if (ridingPathPoints.length >= 2) {
      ridingPolyline = new maps.Polyline({
        path: ridingPathPoints.map((p) => new maps.LatLng(p.lat, p.lng)),
        strokeWeight: 7,
        strokeColor: "#16a34a",
        strokeOpacity: 0.82,
        strokeStyle: "solid"
      });
      ridingPolyline.setMap(map);
    }

    const previewStops = candidate?.busApproachPreview?.stops || [];
    const stopsForMarkers = new Map();
    [...previewStops, ...ridingStops].forEach((stop) => {
      const lat = Number(stop.lat);
      const lng = Number(stop.lng);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
      const key = String(stop.stationId || `${lat},${lng}`);
      if (!stopsForMarkers.has(key)) stopsForMarkers.set(key, { ...stop, lat, lng });
    });
    const stopOverlays = Array.from(stopsForMarkers.values()).map((stop) => {
      const cls = stop.isBoarding ? "kakao-stop-dot boarding"
        : stop.isAlighting ? "kakao-stop-dot alighting"
        : "kakao-stop-dot";
      const overlay = new maps.CustomOverlay({
        position: new maps.LatLng(stop.lat, stop.lng),
        content: overlayContent("", cls),
        xAnchor: 0.5,
        yAnchor: 0.5,
        zIndex: stop.isBoarding ? 3 : stop.isAlighting ? 3 : 2
      });
      overlay.setMap(map);
      return overlay;
    });

    const userOverlay = new maps.CustomOverlay({
      position: new maps.LatLng(points.user.lat, points.user.lng),
      content: overlayContent("", "kakao-dot-overlay"),
      xAnchor: 0.5,
      yAnchor: 0.5
    });
    userOverlay.setMap(map);

    const initialVehicles = vehiclesForMap(candidate?.busApproachPreview, route.id);
    const busOverlays = initialVehicles.map((vehicle, index) => {
      const pos = vehicleLatLng(vehicle, previewStops) || points.boardingStop;
      const boarded = isBoardedVehicle(vehicle, route.id);
      const className = vehicleClassFor(vehicle, index, route.id);
      const overlay = new maps.CustomOverlay({
        position: new maps.LatLng(pos.lat, pos.lng),
        content: overlayContent(busLabelHtml(vehicle, boarded), className),
        xAnchor: 0.5,
        yAnchor: 0.5,
        zIndex: boarded ? 100 : 10 - index
      });
      overlay.setMap(map);
      return { key: vehicle.key, index, overlay, position: { ...pos } };
    });

    const bounds = new maps.LatLngBounds();
    [
      ...approachPath,
      ...ridingPathPoints.map((p) => new maps.LatLng(p.lat, p.lng)),
      new maps.LatLng(points.user.lat, points.user.lng),
      ...busOverlays.map((b) => new maps.LatLng(b.position.lat, b.position.lng))
    ].forEach((point) => bounds.extend(point));
    map.setBounds(bounds, 24, 24, 24, 24);
    if (fallback) fallback.style.display = "none";

    const entry = {
      maps, map, container, userOverlay, stopOverlays, busOverlays,
      approachPolyline, ridingPolyline,
      previewStops, animationFrame: null, pollTimer: null
    };
    state.liveMaps[routeId] = entry;
    startBusPolling(routeId, candidate);
  });
}

function vehicleLatLng(vehicle, stops) {
  if (vehicle?.gpsLat != null && vehicle?.gpsLng != null) {
    const lat = Number(vehicle.gpsLat);
    const lng = Number(vehicle.gpsLng);
    if (Number.isFinite(lat) && Number.isFinite(lng)) return { lat, lng };
  }
  return pointAtSeq(stops || [], vehicle?.progressSeq);
}

function busLabelHtml(vehicle, isBoarded = false) {
  const parts = [];
  if (isBoarded) {
    parts.push("🎒 탑승 중");
  } else {
    parts.push(escapeHtml(vehicle.label || "다음"));
  }
  if (vehicle.riding) {
    parts.push(`${escapeHtml(vehicle.remainingStops || 0)}정거장 남음`);
  } else if (vehicle.catchable === false) {
    parts.push(`${escapeHtml(vehicle.remainingStops || 0)}정거장 뒤`);
  } else {
    parts.push(`${escapeHtml(vehicle.remainingStops || 0)}정거장 전`);
  }
  if (vehicle.etaMinutes != null) {
    parts.push(vehicle.catchable === false
      ? `${escapeHtml(vehicle.passedAgoMinutes ?? vehicle.etaMinutes)}분 전 통과`
      : `${escapeHtml(vehicle.etaMinutes)}분 후`);
  }
  return `<span class="kakao-bus-label${isBoarded ? " boarded" : ""}">${parts.join(" · ")}</span>`;
}

function isBoardedVehicle(vehicle, routeId) {
  const trip = state.boardedTrip;
  return Boolean(trip && trip.routeId === routeId && String(vehicle.key) === String(trip.vehicleKey));
}

function vehiclesForMap(preview, routeId) {
  const vehicles = [...(preview?.vehicles || [])];
  const trip = state.boardedTrip;
  if (trip?.routeId !== routeId || !trip.vehicleKey) return vehicles;
  if (vehicles.some((vehicle) => String(vehicle.key) === String(trip.vehicleKey))) return vehicles;

  const boardedVehicle = (preview?.ridingVehicles || [])
    .find((vehicle) => String(vehicle.key) === String(trip.vehicleKey));
  if (boardedVehicle) return [boardedVehicle, ...vehicles];

  if (trip.lastLat != null && trip.lastLng != null) {
    return [{
      key: trip.vehicleKey,
      label: trip.vehicleLabel || "탑승 중",
      remainingStops: trip.remainingStops,
      etaMinutes: trip.etaMinutes,
      progressSeq: trip.lastProgressSeq,
      gpsLat: trip.lastLat,
      gpsLng: trip.lastLng,
      riding: true
    }, ...vehicles];
  }

  return vehicles;
}

function setLiveMapStatus(entry, message, options = {}) {
  const container = entry?.container?.isConnected
    ? entry.container
    : (options.retryRouteId ? document.querySelector(`[data-live-map][data-route-id="${CSS.escape(options.retryRouteId)}"]`) : entry?.container);
  if (!container) return;
  if (entry && entry.container !== container) entry.container = container;
  let chip = container.querySelector("[data-live-map-status]");
  if (!message) {
    chip?.remove();
    return;
  }
  if (!chip) {
    chip = document.createElement("div");
    chip.className = "live-map-status-chip";
    chip.dataset.liveMapStatus = "true";
    container.appendChild(chip);
  }
  const retry = options.retryRouteId
    ? ` <button type="button" data-action="retry-live-map" data-id="${escapeHtml(options.retryRouteId)}">재연결</button>`
    : "";
  chip.innerHTML = `${escapeHtml(message)}${retry}`;
}

function nextPollDelay(failures) {
  if (isE2EFastPoll()) return 50;
  const multiplier = Math.min(4, Math.max(0, failures));
  return Math.min(BUS_POLL_MAX_DELAY_MS, BUS_POLL_BASE_DELAY_MS * (2 ** multiplier));
}

function startBusPolling(routeId, candidate, options = {}) {
  stopBusPolling(routeId);
  if (!candidate?.busRouteId || !candidate?.boardingStationId) return;
  const entry = state.liveMaps[routeId];
  if (!entry) return;
  entry.pollStopped = false;
  entry.pollVersion = (entry.pollVersion || 0) + 1;
  const pollVersion = entry.pollVersion;
  if (options.resetFailures) entry.pollFailures = 0;
  const params = new URLSearchParams({
    routeId: String(candidate.busRouteId),
    boardingStationId: String(candidate.boardingStationId),
    alightingStationId: candidate.alightingStationId ? String(candidate.alightingStationId) : "",
    walkMinutes: String(candidate.initialWalkTime || 0)
  });
  const url = `/api/bus-positions?${params.toString()}`;
  const schedule = () => {
    const current = state.liveMaps[routeId];
    if (!current || current.pollStopped || current.pollVersion !== pollVersion) return;
    current.pollTimer = setTimeout(poll, nextPollDelay(current.pollFailures || 0));
  };
  const markFailure = () => {
    const current = state.liveMaps[routeId];
    if (!current) return;
    current.pollFailures = (current.pollFailures || 0) + 1;
    if (isE2EFastPoll()) window.__TRANSIT_E2E_POLL_FAILURES = current.pollFailures;
    recordTelemetry("bus_poll_failure", { count: current.pollFailures });
    const failureThreshold = isE2EFastPoll() ? 1 : 3;
    if (current.pollFailures >= failureThreshold) {
      const last = current.lastPollSuccessAt
        ? `마지막 연결 ${new Date(current.lastPollSuccessAt).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" })}`
        : "최근 위치 유지 중";
      setLiveMapStatus(current, `실시간 위치 연결이 불안정해요 · ${last}`, { retryRouteId: routeId });
      recordTelemetry("live_map_unstable", { count: current.pollFailures }, { onceKey: routeId });
    }
  };
  const poll = async () => {
    const entry = state.liveMaps[routeId];
    if (!entry?.map) return;
    try {
      const response = await fetch(url, { cache: "no-store" });
      if (!response.ok) {
        markFailure();
        return;
      }
      const data = await response.json();
      entry.pollFailures = 0;
      entry.lastPollSuccessAt = Date.now();
      recordTelemetry("bus_poll_success", { status: response.status });
      setLiveMapStatus(entry, "");
      updateLiveVehicles(routeId, data?.preview);
    } catch {
      markFailure();
    } finally {
      schedule();
    }
  };
  poll();
}

function stopBusPolling(routeId) {
  const entry = state.liveMaps[routeId];
  if (entry?.pollTimer) {
    clearTimeout(entry.pollTimer);
    entry.pollTimer = null;
  }
  if (entry) entry.pollStopped = true;
}

export function retryLiveMap(routeId) {
  const route = state.routes.find((item) => item.id === routeId);
  const candidate = route ? getSelectedCandidate(route) : null;
  const entry = state.liveMaps[routeId];
  recordTelemetry("live_map_retry", { source: "status_chip" });
  if (entry) setLiveMapStatus(entry, "실시간 위치를 다시 연결하고 있어요");
  startBusPolling(routeId, candidate, { resetFailures: true });
}

function tweenOverlayPosition(maps, overlay, fromPos, toPos, durationMs = 700) {
  const startMs = performance.now();
  const step = (now) => {
    const ratio = Math.min(1, (now - startMs) / durationMs);
    const eased = easeInOutCubic(ratio);
    const lat = fromPos.lat + (toPos.lat - fromPos.lat) * eased;
    const lng = fromPos.lng + (toPos.lng - fromPos.lng) * eased;
    overlay.setPosition(new maps.LatLng(lat, lng));
    if (ratio < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

function vehicleClassFor(vehicle, index, routeId) {
  const trip = state.boardedTrip;
  const isBoarded = trip?.routeId === routeId && String(vehicle.key) === String(trip.vehicleKey);
  const dimmed = trip?.routeId === routeId && !isBoarded;
  return [
    "kakao-bus-overlay",
    index > 0 ? "secondary" : "",
    isBoarded ? "boarded" : "",
    dimmed ? "dimmed" : ""
  ].filter(Boolean).join(" ");
}

function updateLiveVehicles(routeId, preview) {
  const entry = state.liveMaps[routeId];
  if (!entry || !preview) return;
  const vehicles = vehiclesForMap(preview, routeId);
  const stops = [...(preview.stops || entry.previewStops || []), ...(preview.ridingStops || [])];
  const nextOverlays = [];
  vehicles.forEach((vehicle, index) => {
    const targetPos = vehicleLatLng(vehicle, stops);
    if (!targetPos) return;
    const boarded = isBoardedVehicle(vehicle, routeId);
    const className = vehicleClassFor(vehicle, index, routeId);
    const existing = entry.busOverlays.find((b) => b.key === vehicle.key);
    if (existing) {
      const content = existing.overlay.getContent();
      content.className = className;
      const labelEl = content.querySelector(".kakao-bus-label");
      if (labelEl) labelEl.outerHTML = busLabelHtml(vehicle, boarded);
      tweenOverlayPosition(entry.maps, existing.overlay, existing.position, targetPos);
      existing.position = targetPos;
      nextOverlays.push(existing);
    } else {
      const overlay = new entry.maps.CustomOverlay({
        position: new entry.maps.LatLng(targetPos.lat, targetPos.lng),
        content: overlayContent(busLabelHtml(vehicle, boarded), className),
        xAnchor: 0.5,
        yAnchor: 0.5,
        zIndex: boarded ? 100 : 10 - index
      });
      overlay.setMap(entry.map);
      nextOverlays.push({ key: vehicle.key, index, overlay, position: { ...targetPos } });
    }
  });
  entry.busOverlays.forEach((bus) => {
    if (!nextOverlays.find((next) => next.key === bus.key)) bus.overlay.setMap(null);
  });
  entry.busOverlays = nextOverlays;

  const trip = state.boardedTrip;
  if (trip?.routeId === routeId) {
    const matched = vehicles.find((v) => String(v.key) === String(trip.vehicleKey));
    if (matched) {
      trip.remainingStops = Math.max(0, Number(matched.remainingStops || 0));
      trip.etaMinutes = matched.etaMinutes;
      trip.lastProgressSeq = Number(matched.progressSeq) || trip.lastProgressSeq;
      const matchedPos = vehicleLatLng(matched, stops);
      if (matchedPos) {
        trip.lastLat = matchedPos.lat;
        trip.lastLng = matchedPos.lng;
      }
      persistBoardedTrip();
      updateBoardingPanelDOM(routeId, trip);
      if (trip.alightingSeq != null && trip.lastProgressSeq >= trip.alightingSeq - 0.1) {
        endBoarding("alighting");
      }
    } else if (trip.alightingSeq != null && trip.lastProgressSeq >= trip.alightingSeq - 1) {
      endBoarding("alighting");
    }
  }
}

export function teardownLiveMaps() {
  Object.values(state.liveMaps).forEach((entry) => {
    if (entry?.animationFrame) cancelAnimationFrame(entry.animationFrame);
    if (entry?.pollTimer) clearTimeout(entry.pollTimer);
    try {
      entry?.approachPolyline?.setMap?.(null);
      entry?.ridingPolyline?.setMap?.(null);
      entry?.userOverlay?.setMap?.(null);
      (entry?.stopOverlays || []).forEach((overlay) => { try { overlay?.setMap?.(null); } catch {} });
      (entry?.busOverlays || []).forEach((bus) => { try { bus?.overlay?.setMap?.(null); } catch {} });
    } catch {}
  });
  state.liveMaps = {};
  Object.keys(state.liveMapTimers).forEach((routeId) => clearLiveMapTimer(routeId));
}
