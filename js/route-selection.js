import { state } from "./state.js";

let renderRoutes = () => {};

export function configureRouteSelection(options = {}) {
  if (typeof options.renderRoutes === "function") {
    renderRoutes = options.renderRoutes;
  }
}

export function getSelectedCandidate(route) {
  const result = route?.lastResult;
  if (!result) return null;
  const candidates = result.candidates || [];
  const trip = state.boardedTrip;
  if (trip?.routeId === route.id && trip.candidateId) {
    const boardedCandidate = candidates.find((candidate) => candidate.id === trip.candidateId);
    if (boardedCandidate) return boardedCandidate;
  }
  const selectedId = state.selectedCandidateIds[route.id];
  if (selectedId) {
    const match = candidates.find((candidate) => candidate.id === selectedId);
    if (match) return match;
  }
  return result.recommendation || candidates[0] || null;
}

export function selectCandidate(routeId, candidateId) {
  const route = state.routes.find((item) => item.id === routeId);
  if (!route) return;
  const candidates = route.lastResult?.candidates || [];
  const exists = candidates.some((candidate) => candidate.id === candidateId);
  if (!exists) return;
  if (state.selectedCandidateIds[routeId] === candidateId) return;
  state.selectedCandidateIds[routeId] = candidateId;
  renderRoutes();
}
