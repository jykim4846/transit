import { STORAGE_KEY, LEGACY_STORAGE_KEY, ROUTE_CARD_COLLAPSED_KEY } from "./constants.js";
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
  boardedTrip: null,
  modalRouteId: null,
  previewMaps: {},
  liveMaps: {},
  liveMapTimers: {},
  userLocation: null,
  locationWatchId: null,
  mapPickerTarget: null,
  autocompleteSelection: {
    from: null,
    to: null
  }
};

export function persistRoutes() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state.routes));
}
