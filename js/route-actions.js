import { uid, nowStamp } from "./util.js";
import { ROUTE_CARD_COLLAPSED_KEY } from "./constants.js";
import { state, persistRoutes, persistBoardedTrip } from "./state.js";
import { fetchJson, searchStations, fetchRouteRecommendationDirect, tagRoutePicks } from "./api.js";
import { clearLiveMapTimer } from "./live-map.js";
import { canRequestGeolocation } from "./location-permission.js";
import { clearLocationPreview, updateLocationPreview, updateMapPickButtons, closeMapPicker } from "./location-ui.js";
import { recordTelemetry } from "./telemetry.js";

let renderRoutes = () => {};
let showToast = () => {};

export function configureRouteActions(options = {}) {
  if (typeof options.renderRoutes === "function") renderRoutes = options.renderRoutes;
  if (typeof options.showToast === "function") showToast = options.showToast;
}

export function startBoarding(routeId, candidate, vehicleKey) {
  const vehicles = candidate?.busApproachPreview?.vehicles || [];
  const explicit = vehicleKey != null
    ? vehicles.find((v) => String(v.key) === String(vehicleKey))
    : null;
  const target = explicit || vehicles.find((v) => v.catchable !== false) || vehicles[0];
  if (!target || !target.key) {
    showToast("탑승할 수 있는 버스가 없어요");
    return;
  }
  state.boardedTrip = {
    routeId,
    candidateId: candidate.id,
    vehicleKey: String(target.key),
    vehicleLabel: target.label || "다음",
    routeNo: candidate.routeNo,
    busRouteId: candidate.busRouteId || null,
    boardingStationId: candidate.boardingStationId || null,
    alightingStationId: candidate.alightingStationId || null,
    startedAt: Date.now(),
    alightingSeq: candidate.busApproachPreview?.alightingStationSeq || null,
    alightingName: candidate.busApproachPreview?.alightingStopName || candidate.alightingStopName || null,
    lastProgressSeq: Number(target.progressSeq) || 0,
    lastLat: target.gpsLat ?? null,
    lastLng: target.gpsLng ?? null,
    remainingStops: target.remainingStops,
    etaMinutes: target.etaMinutes
  };
  persistBoardedTrip();
  recordTelemetry("boarding_start", { source: "route_card" });
  showToast(`${candidate.routeNo || "버스"} 탑승을 시작합니다`);
  renderRoutes();
}

export function endBoarding(reason = "manual") {
  if (!state.boardedTrip) return;
  const name = state.boardedTrip.alightingName;
  state.boardedTrip = null;
  persistBoardedTrip();
  recordTelemetry("boarding_end", { reason });
  if (reason === "alighting") {
    showToast(name ? `${name} 도착! 하차 준비하세요` : "하차 정류장에 도착했어요");
  } else if (reason === "manual") {
    showToast("탑승을 종료했어요");
  }
  renderRoutes();
}

export async function resolveStationByName(name) {
  const normalized = name.trim();
  if (!normalized) throw new Error("역 이름이 비어 있습니다");
  const result = await searchStations(normalized);
  if (!result.stations.length) throw new Error('"' + normalized + '" 검색 결과가 없습니다');
  return result.stations[0];
}

function buildRoutePayload(baseRoute, resolvedFrom, resolvedTo) {
    return {
      ...baseRoute,
      from: resolvedFrom,
      to: resolvedTo
    };
}

export async function refreshRoute(routeId) {
  return refreshRouteWithOptions(routeId, {});
}

async function getCurrentPositionAsync(options = {}) {
  const allowed = await canRequestGeolocation({ requestIfPrompt: options.requestIfPrompt !== false });
  if (!allowed) {
    throw new Error("위치 권한 요청이 필요한 상태입니다");
  }

  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error("위치 정보를 사용할 수 없는 환경입니다"));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) => {
        state.locationPermissionState = "granted";
        resolve({ x: position.coords.longitude, y: position.coords.latitude });
      },
      (error) => {
        if (error?.code === error.PERMISSION_DENIED) state.locationPermissionState = "denied";
        reject(new Error(error.message || "위치 정보를 가져오지 못했습니다"));
      },
      { enableHighAccuracy: true, maximumAge: 15000, timeout: 8000 }
    );
  });
}

async function resolveCurrentLocationFrom(options = {}) {
  if (state.userLocation?.lat != null && state.userLocation?.lng != null) {
    return { name: "현재 위치", isCurrentLocation: true, x: state.userLocation.lng, y: state.userLocation.lat, kind: "현재 위치" };
  }
  const coords = await getCurrentPositionAsync({ requestIfPrompt: options.requestIfPrompt });
  state.userLocation = { lat: coords.y, lng: coords.x };
  return { name: "현재 위치", isCurrentLocation: true, x: coords.x, y: coords.y, kind: "현재 위치" };
}

export async function refreshRouteWithOptions(routeId, options = {}) {
  const route = state.routes.find((item) => item.id === routeId);
  if (!route || state.loadingRouteIds.has(routeId)) return;
  const silent = Boolean(options.silent);
  if (state.boardedTrip?.routeId === routeId) {
    recordTelemetry("route_refresh_skipped", { reason: silent ? "boarding_active_silent" : "boarding_active_manual" });
    if (!silent) {
      showToast("탑승 중에는 내 위치와 탑승 버스 위치만 갱신해요");
    }
    return;
  }

  state.loadingRouteIds.add(routeId);
  const loadingCard = document.querySelector(`.route-card[data-route-id="${CSS.escape(routeId)}"]`);
  if (loadingCard) loadingCard.classList.add("loading");

  try {
    const from = await resolveCurrentLocationFrom({ requestIfPrompt: !silent });
    const to = route.to?.x != null && route.to?.y != null ? route.to : await resolveStationByName(route.to?.name || "");
    const params = new URLSearchParams({
      fromX: String(from.x),
      fromY: String(from.y),
      toX: String(to.x),
      toY: String(to.y),
      priority: "overview",
      transportFilter: "bus"
    });

    let payload;
    try {
      payload = tagRoutePicks(await fetchJson("/api/routes?" + params.toString()));
    } catch (error) {
      payload = await fetchRouteRecommendationDirect(route, from, to);
      if (!silent) {
        showToast("서버 호출이 막혀 브라우저 직접 호출로 갱신했습니다");
      }
    }
    const nextRoute = buildRoutePayload(route, from, to);
    nextRoute.lastResult = payload;

    state.routes = state.routes.map((item) => item.id === routeId ? nextRoute : item);
    persistRoutes();
    recordTelemetry("route_refresh_success", { source: silent ? "silent" : "manual" });
    if (!silent) {
      showToast("추천을 새로 갱신했습니다");
    }
  } catch (error) {
    recordTelemetry("route_refresh_failure", {
      source: silent ? "silent" : "manual",
      reason: error?.name || "error"
    });
    if (!silent) {
      showToast(error.message || "추천 갱신에 실패했습니다");
    }
  } finally {
    state.loadingRouteIds.delete(routeId);
    renderRoutes();
  }
}

export function deleteRoute(routeId) {
  if (state.boardedTrip?.routeId === routeId) {
    state.boardedTrip = null;
    persistBoardedTrip();
  }
  state.routes = state.routes.filter((route) => route.id !== routeId);
  state.loadingRouteIds.delete(routeId);
  state.expandedRouteIds.delete(routeId);
  if (state.collapsedRouteIds.delete(routeId)) {
    localStorage.setItem(ROUTE_CARD_COLLAPSED_KEY, JSON.stringify([...state.collapsedRouteIds]));
  }
  delete state.selectedCandidateIds[routeId];
  if (state.activeRouteId === routeId) state.activeRouteId = null;
  clearLiveMapTimer(routeId);
  persistRoutes();
  renderRoutes();
  showToast("루트를 삭제했습니다");
}

export function openModal(routeId = null) {
  state.modalRouteId = routeId;
  state.mapPickerTarget = null;
  const route = state.routes.find((item) => item.id === routeId) || null;

  document.getElementById("modal-title").textContent = route ? "목적지 편집" : "새 목적지 추가";
  document.getElementById("route-label-input").value = route?.label || "";
  document.getElementById("route-to-input").value = route?.to?.name || "";

  state.autocompleteSelection.to = route?.to?.x != null && route?.to?.y != null ? route.to : null;
  updateMapPickButtons();
  updateLocationPreview("to", state.autocompleteSelection.to);

  setOptionGroupValue("priority", route?.priority || "fastest");

  document.getElementById("modal-overlay").classList.add("active");
}

export function closeModal() {
  state.modalRouteId = null;
  closeMapPicker();
  state.autocompleteSelection.to = null;
  updateMapPickButtons();
  clearLocationPreview("to");
  document.getElementById("route-to-dropdown").classList.remove("open");
  document.getElementById("modal-overlay").classList.remove("active");
}

export function setOptionGroupValue(group, value) {
  document.querySelectorAll('[data-' + group + ']').forEach((card) => {
    const active = card.dataset[group] === value;
    card.classList.toggle("active", active);
    const input = card.querySelector("input");
    if (input) input.checked = active;
  });
}

function getSelectedValue(name) {
  return document.querySelector('input[name="' + name + '"]:checked')?.value;
}

export async function saveRoute() {
  const label = document.getElementById("route-label-input").value.trim() || "루트";
  const toName = document.getElementById("route-to-input").value.trim();
  const priority = getSelectedValue("priority") || "fastest";
  const transportFilter = "bus";

  if (!toName) {
    showToast("목적지를 입력해주세요");
    return;
  }

  const original = state.routes.find((item) => item.id === state.modalRouteId);

  const from = { name: "현재 위치", isCurrentLocation: true, x: null, y: null, kind: "현재 위치" };

  const to = state.autocompleteSelection.to && state.autocompleteSelection.to.name === toName
    ? state.autocompleteSelection.to
    : { name: toName, x: null, y: null };

  const route = {
    id: original?.id || uid(),
    label,
    from,
    to,
    priority,
    transportFilter,
    lastResult: original?.lastResult || null,
    createdAt: original?.createdAt || nowStamp()
  };

  if (original) {
    state.routes = state.routes.map((item) => item.id === route.id ? route : item);
    showToast("루트 설정을 저장했습니다");
  } else {
    state.routes = [route, ...state.routes];
    showToast("루트를 저장했습니다");
  }

  persistRoutes();
  renderRoutes();
  closeModal();
}

export function toggleDetails(routeId) {
  if (state.expandedRouteIds.has(routeId)) {
    state.expandedRouteIds.delete(routeId);
  } else {
    state.expandedRouteIds.add(routeId);
    state.collapsedRouteIds.delete(routeId);
    localStorage.setItem(ROUTE_CARD_COLLAPSED_KEY, JSON.stringify([...state.collapsedRouteIds]));
  }
  renderRoutes();
}

export function toggleRouteCollapse(routeId) {
  if (state.collapsedRouteIds.has(routeId)) {
    state.collapsedRouteIds.delete(routeId);
  } else {
    state.collapsedRouteIds.add(routeId);
    state.expandedRouteIds.delete(routeId);
  }
  localStorage.setItem(ROUTE_CARD_COLLAPSED_KEY, JSON.stringify([...state.collapsedRouteIds]));
  renderRoutes();
}
