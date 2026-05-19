import { STORAGE_KEY, LEGACY_STORAGE_KEY, ROUTE_CARD_COLLAPSED_KEY, BOARDED_TRIP_STORAGE_KEY, BOARDED_TRIP_MAX_AGE_MS } from "./constants.js";
import { uid, nowStamp } from "./util.js";

function normalizeLegacyRoute(route) {
  return {
    id: uid(),
    label: route.tag || "루트",
    from: { name: route.from || "", x: null, y: null },
    to: { name: route.to || "", x: null, y: null },
    priority: route.tag === "퇴근" ? "fewest_transfers" : "fastest",
    transportFilter: "bus",
    lastResult: null,
    createdAt: nowStamp()
  };
}

function forceBusOnly(route) {
  return { ...route, transportFilter: "bus" };
}

function forceCurrentLocationFrom(route) {
  return {
    ...route,
    from: { name: "현재 위치", isCurrentLocation: true, x: null, y: null, kind: "현재 위치" }
  };
}

function loadBoardedTrip() {
  const raw = localStorage.getItem(BOARDED_TRIP_STORAGE_KEY);
  if (!raw) return null;
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  if (!parsed.startedAt || !parsed.routeId) return null;
  if (Date.now() - Number(parsed.startedAt) > BOARDED_TRIP_MAX_AGE_MS) {
    localStorage.removeItem(BOARDED_TRIP_STORAGE_KEY);
    return null;
  }
  return parsed;
}

function migrateAndLoadRoutes() {
  const current = localStorage.getItem(STORAGE_KEY);
  if (current) {
    try {
      return (JSON.parse(current) || []).map(forceBusOnly).map(forceCurrentLocationFrom);
    } catch {
      return [];
    }
  }

  const legacy = localStorage.getItem(LEGACY_STORAGE_KEY);
  if (!legacy) return [];

  try {
    const migrated = (JSON.parse(legacy) || []).map(normalizeLegacyRoute).map(forceBusOnly).map(forceCurrentLocationFrom);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(migrated));
    return migrated;
  } catch {
    return [];
  }
}

export const state = {
  routes: migrateAndLoadRoutes(),
  collapsedRouteIds: new Set(JSON.parse(localStorage.getItem(ROUTE_CARD_COLLAPSED_KEY) || "[]")),
  loadingRouteIds: new Set(),
  expandedRouteIds: new Set(),
  selectedCandidateIds: {},
  activeRouteId: null,
  trackingActive: false,
  trackingTimer: null,
  initialRefreshDone: false,
  boardedTrip: loadBoardedTrip(),
  modalRouteId: null,
  previewMaps: {},
  liveMaps: {},
  liveMapTimers: {},
  userLocation: null,
  locationWatchId: null,
  locationPermissionState: null,
  mapPickerTarget: null,
  autocompleteSelection: {
    to: null
  }
};

export function persistRoutes() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state.routes));
}

export function persistBoardedTrip() {
  if (state.boardedTrip) {
    localStorage.setItem(BOARDED_TRIP_STORAGE_KEY, JSON.stringify(state.boardedTrip));
  } else {
    localStorage.removeItem(BOARDED_TRIP_STORAGE_KEY);
  }
}

export function clearBoardedTripStorage() {
  localStorage.removeItem(BOARDED_TRIP_STORAGE_KEY);
}
