import { state } from "./state.js";

export async function getGeolocationPermissionState() {
  if (!navigator.permissions?.query) return null;
  try {
    const status = await navigator.permissions.query({ name: "geolocation" });
    state.locationPermissionState = status.state;
    status.onchange = () => {
      state.locationPermissionState = status.state;
    };
    return status.state;
  } catch {
    return null;
  }
}

export async function canRequestGeolocation(options = {}) {
  const permissionState = await getGeolocationPermissionState();
  if (permissionState === "denied") return false;
  if (permissionState === "prompt" && !options.requestIfPrompt) return false;
  if (!permissionState && !options.requestIfPrompt && state.locationPermissionState !== "granted") return false;
  return true;
}
