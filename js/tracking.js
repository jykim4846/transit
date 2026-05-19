import { state } from "./state.js";
import { startUserLocationWatch, stopUserLocationWatch } from "./live-map.js";

let triggerActiveRefresh = async () => {};
let showToast = () => {};

export function configureTracking(options = {}) {
  if (typeof options.triggerActiveRefresh === "function") {
    triggerActiveRefresh = options.triggerActiveRefresh;
  }
  if (typeof options.showToast === "function") {
    showToast = options.showToast;
  }
}

export function setTrackingButton(active) {
  const btn = document.getElementById("tracking-toggle-btn");
  if (btn) btn.setAttribute("aria-pressed", active ? "true" : "false");
}

export async function toggleTracking() {
  if (state.trackingActive) {
    if (state.trackingTimer) clearInterval(state.trackingTimer);
    state.trackingTimer = null;
    state.trackingActive = false;
    stopUserLocationWatch();
    setTrackingButton(false);
    showToast("이동 트래킹을 끕니다");
    return;
  }
  if (!state.routes.length) {
    showToast("저장된 루트가 없어요");
    return;
  }
  state.trackingActive = true;
  setTrackingButton(true);
  await startUserLocationWatch({ requestIfPrompt: true });
  showToast("이동 트래킹을 시작합니다");
  if (!state.boardedTrip) {
    triggerActiveRefresh({ silent: true });
  }
  state.trackingTimer = setInterval(() => {
    if (state.boardedTrip) return;
    triggerActiveRefresh({ silent: true });
  }, 60000);
}
