import { state } from "./state.js";

let getOrderedRoutes = () => [];
let setActiveRoute = () => {};

export function configureRouteNavigation(options = {}) {
  if (typeof options.getOrderedRoutes === "function") {
    getOrderedRoutes = options.getOrderedRoutes;
  }
  if (typeof options.setActiveRoute === "function") {
    setActiveRoute = options.setActiveRoute;
  }
}

export function bindRouteTabs() {
  const tabs = document.getElementById("route-tabs");
  if (!tabs) return;
  tabs.addEventListener("click", (event) => {
    const target = event.target.closest("[data-route-tab]");
    if (!target) return;
    setActiveRoute(target.dataset.routeTab);
  });
}

export function shiftActiveRoute(direction) {
  const routes = getOrderedRoutes();
  if (routes.length < 2) return;
  const currentIdx = routes.findIndex((route) => route.id === state.activeRouteId);
  if (currentIdx < 0) return;
  const nextIdx = direction > 0
    ? Math.min(routes.length - 1, currentIdx + 1)
    : Math.max(0, currentIdx - 1);
  if (nextIdx !== currentIdx) setActiveRoute(routes[nextIdx].id);
}

export function bindRouteSwipe() {
  const list = document.getElementById("route-list");
  if (!list) return;
  const SWIPE_MIN_X = 45;
  let startX = 0;
  let startY = 0;
  let tracking = false;
  list.addEventListener("pointerdown", (event) => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    if (event.target.closest(".live-map, .fast-candidate, button, [data-action], a, input, textarea")) {
      tracking = false;
      return;
    }
    tracking = true;
    startX = event.clientX;
    startY = event.clientY;
  }, { passive: true });
  const finish = (event) => {
    if (!tracking) return;
    tracking = false;
    const dx = event.clientX - startX;
    const dy = event.clientY - startY;
    if (Math.abs(dx) < SWIPE_MIN_X || Math.abs(dx) <= Math.abs(dy)) return;
    shiftActiveRoute(dx < 0 ? 1 : -1);
  };
  list.addEventListener("pointerup", finish, { passive: true });
  list.addEventListener("pointercancel", () => { tracking = false; }, { passive: true });
}
