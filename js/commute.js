import { state } from "./state.js";

export function getCommuteContext(date = new Date()) {
  const hour = date.getHours();
  if (hour >= 5 && hour < 12) return { phase: "morning", keyword: "출근", badge: "출근 시간" };
  if (hour >= 16 && hour < 23) return { phase: "evening", keyword: "퇴근", badge: "퇴근 시간" };
  return null;
}

export function isCommutePinned(route, ctx) {
  if (!ctx) return false;
  return (route.label || "").includes(ctx.keyword);
}

export function getOrderedRoutes() {
  const ctx = getCommuteContext();
  if (!ctx) return state.routes;
  const pinned = [];
  const rest = [];
  for (const route of state.routes) {
    if (isCommutePinned(route, ctx)) pinned.push(route);
    else rest.push(route);
  }
  return pinned.length ? [...pinned, ...rest] : state.routes;
}
