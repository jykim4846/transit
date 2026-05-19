import { escapeHtml } from "./util.js";
import { state } from "./state.js";
import { configureLiveMapRuntime, initLiveTransitMaps, pauseLiveMapPolling, resumeLiveMapPolling, retryLiveMap, stopUserLocationWatch, teardownLiveMaps, startUserLocationWatch } from "./live-map.js";
import { renderEmptyCard, renderRouteCard } from "./route-card.js";
import {
  configureLocationUi,
  clearLocationPreview,
  updateLocationPreview,
  updateMapPickButtons,
  openMapPicker,
  closeMapPicker,
  setupAutocomplete
} from "./location-ui.js";
import {
  configureRouteActions,
  startBoarding,
  endBoarding,
  refreshRoute,
  refreshRouteWithOptions,
  deleteRoute,
  openModal,
  closeModal,
  saveRoute,
  toggleDetails,
  toggleRouteCollapse,
  setOptionGroupValue
} from "./route-actions.js";
import { startCountdowns } from "./countdowns.js";
import { configureTracking, toggleTracking } from "./tracking.js";
import { configureSettingsUi, configureBrowserKey, updateOdsayKeyVisibility } from "./settings-ui.js";
import { configureRouteNavigation, bindRouteTabs, bindRouteSwipe } from "./route-navigation.js";
import { getCommuteContext, isCommutePinned, getOrderedRoutes } from "./commute.js";
import { configureRouteSelection, getSelectedCandidate, selectCandidate } from "./route-selection.js";
import { getGeolocationPermissionState } from "./location-permission.js";
import { recordTelemetry } from "./telemetry.js";

function updateClock() {
  const now = new Date();
  document.getElementById("clock").textContent = now.toLocaleTimeString("ko-KR", {
    hour: "2-digit",
    minute: "2-digit"
  });
  const phase = getCommuteContext(now)?.phase || null;
  if (state.routes.length > 0 && phase !== state.lastCommutePhase) {
    renderRoutes();
  }
}

function renderRoutes() {
  const list = document.getElementById("route-list");
  const tabs = document.getElementById("route-tabs");
  document.getElementById("route-count").textContent = state.routes.length + "개 루트";
  if (state.routes.length === 0) {
    list.innerHTML = renderEmptyCard();
    if (tabs) tabs.innerHTML = "";
    state.lastCommutePhase = getCommuteContext()?.phase || null;
    teardownLiveMaps();
    return;
  }
  const ctx = getCommuteContext();
  teardownLiveMaps();
  const orderedRoutes = getOrderedRoutes();
  if (!orderedRoutes.find((route) => route.id === state.activeRouteId)) {
    const pinned = orderedRoutes.find((route) => isCommutePinned(route, ctx));
    state.activeRouteId = (pinned || orderedRoutes[0]).id;
  }
  list.innerHTML = orderedRoutes.map((route) => {
    const html = renderRouteCard(route, {
      commuteCtx: ctx,
      getSelectedCandidate,
      getBoardingStatusForRoute,
      isCommutePinned
    });
    return html.replace('<article class="route-card', `<article data-route-id="${escapeHtml(route.id)}" class="route-card${route.id === state.activeRouteId ? " active" : ""}`);
  }).join("");
  renderRouteTabs(orderedRoutes);
  requestAnimationFrame(initLiveTransitMaps);
  state.lastCommutePhase = ctx?.phase || null;
}

function renderRouteTabs(routes) {
  const tabs = document.getElementById("route-tabs");
  if (!tabs) return;
  if (!routes?.length) {
    tabs.innerHTML = "";
    return;
  }
  tabs.innerHTML = routes
    .map((route) => `<button type="button" class="route-tab${route.id === state.activeRouteId ? " active" : ""}" data-route-tab="${escapeHtml(route.id)}">${escapeHtml(route.label || "루트")}</button>`)
    .join("");
}

function setActiveRoute(routeId) {
  if (!routeId || state.activeRouteId === routeId) return;
  if (!state.routes.find((route) => route.id === routeId)) return;
  state.activeRouteId = routeId;
  renderRoutes();
}

async function triggerActiveRefresh(options = {}) {
  const routeId = state.activeRouteId || (state.routes[0] && state.routes[0].id);
  if (!routeId) {
    if (!options.silent) showToast("새로고침할 루트가 없습니다");
    return;
  }
  const btn = document.getElementById("header-refresh-btn");
  if (btn) {
    btn.classList.add("spinning");
    btn.setAttribute("aria-busy", "true");
  }
  try {
    await refreshRouteWithOptions(routeId, options);
  } finally {
    if (btn) {
      btn.classList.remove("spinning");
      btn.removeAttribute("aria-busy");
    }
  }
}

configureLiveMapRuntime({ getSelectedCandidate, endBoarding });

function getBoardingStatusForRoute(routeId) {
  const trip = state.boardedTrip;
  if (!trip || trip.routeId !== routeId) return null;
  return trip;
}

function maybeInitialAutoRefresh() {
  if (state.initialRefreshDone) return;
  if (!state.routes.length) return;
  state.initialRefreshDone = true;
  triggerActiveRefresh({ silent: true });
}

function showToast(message) {
  const toast = document.getElementById("toast");
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(showToast._timer);
  showToast._timer = setTimeout(() => toast.classList.remove("show"), 2200);
}

function permissionCopy(permissionState) {
  if (permissionState === "granted") return null;
  if (permissionState === "denied") {
    return {
      className: "blocked",
      text: "위치 권한이 차단되어 있어요. 브라우저 주소창 또는 OS 설정에서 위치를 허용하면 현재 위치 재검색과 트래킹이 다시 작동합니다."
    };
  }
  return {
    className: "prompt",
    text: "위치 권한은 브라우저가 저장합니다. 한 번 허용하면 보통 다시 묻지 않지만, 시크릿 모드나 권한 초기화 상태에서는 다시 요청될 수 있어요."
  };
}

async function updatePermissionNotice() {
  const notice = document.getElementById("permission-notice");
  if (!notice) return;
  const permissionState = await getGeolocationPermissionState();
  const copy = permissionCopy(permissionState || state.locationPermissionState);
  recordTelemetry("permission_state", { state: permissionState || state.locationPermissionState || "unknown" }, { onceKey: "permission" });
  if (!copy) {
    notice.hidden = true;
    notice.textContent = "";
    notice.className = "permission-notice";
    return;
  }
  notice.hidden = false;
  notice.className = `permission-notice ${copy.className}`;
  notice.textContent = copy.text;
}

configureLocationUi({ showToast });
configureRouteActions({ renderRoutes, showToast });
configureTracking({ triggerActiveRefresh, showToast });
configureSettingsUi({ showToast });
configureRouteNavigation({ getOrderedRoutes, setActiveRoute });
configureRouteSelection({ renderRoutes });

function bindStaticEvents() {
  document.getElementById("add-route-btn").addEventListener("click", () => openModal());
  document.getElementById("key-settings-btn").addEventListener("click", configureBrowserKey);
  document.getElementById("header-refresh-btn").addEventListener("click", () => triggerActiveRefresh({ silent: false }));
  document.getElementById("tracking-toggle-btn").addEventListener("click", () => toggleTracking());
  updateOdsayKeyVisibility();
  document.getElementById("route-to-map-pick-btn").addEventListener("click", () => openMapPicker("to"));
  document.getElementById("modal-close-btn").addEventListener("click", closeModal);
  document.getElementById("modal-cancel-btn").addEventListener("click", closeModal);
  document.getElementById("modal-save-btn").addEventListener("click", saveRoute);
  document.getElementById("map-picker-close-btn").addEventListener("click", closeMapPicker);
  document.getElementById("map-picker-cancel-btn").addEventListener("click", closeMapPicker);
  document.getElementById("map-picker-overlay").addEventListener("click", (event) => {
    if (event.target.id === "map-picker-overlay") closeMapPicker();
  });
  document.getElementById("modal-overlay").addEventListener("click", (event) => {
    if (event.target.id === "modal-overlay") closeModal();
  });

  bindRouteTabs();
  bindRouteSwipe();

  document.getElementById("route-list").addEventListener("click", (event) => {
    const target = event.target.closest("[data-action]");
    if (!target) return;
    const { action, id } = target.dataset;
    if (action === "refresh") refreshRoute(id);
    if (action === "collapse") toggleRouteCollapse(id);
    if (action === "toggle") toggleDetails(id);
    if (action === "edit") openModal(id);
    if (action === "delete") deleteRoute(id);
    if (action === "select-candidate") selectCandidate(id, target.dataset.candidateId);
    if (action === "retry-live-map") retryLiveMap(id);
    if (action === "start-boarding") {
      const route = state.routes.find((r) => r.id === id);
      const candidate = route ? getSelectedCandidate(route) : null;
      const vehicleKey = event.target.closest("[data-vehicle-key]")?.dataset.vehicleKey;
      if (route && candidate) startBoarding(id, candidate, vehicleKey);
    }
    if (action === "end-boarding") endBoarding("manual");
  });

  document.querySelectorAll("#priority-options .option-card").forEach((card) => {
    card.addEventListener("click", () => setOptionGroupValue("priority", card.dataset.priority));
  });

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
      stopUserLocationWatch();
      pauseLiveMapPolling();
      return;
    }
    if (state.trackingActive) {
      startUserLocationWatch({ requestIfPrompt: false });
    }
    resumeLiveMapPolling();
    updatePermissionNotice();
  });
}

if (window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone) {
  document.body.classList.add("is-standalone");
}

localStorage.removeItem("transit-station-cache");
bindStaticEvents();
updateMapPickButtons();
setupAutocomplete("route-to-input", "route-to-dropdown", "to");
setOptionGroupValue("priority", "fastest");
updateClock();
setInterval(updateClock, 10000);
renderRoutes();
maybeInitialAutoRefresh();
startCountdowns();
updatePermissionNotice();
if (state.boardedTrip) {
  recordTelemetry("boarding_resume", { source: "storage" }, { onceKey: "boarded-trip" });
}
