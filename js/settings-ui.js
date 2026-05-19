import { state } from "./state.js";
import { getBrowserOdsayKey, setBrowserOdsayKey } from "./api.js";
import { setKakaoMapKey, getKakaoMapKey, resolveKakaoMapKey, loadKakaoMaps } from "./live-map-keys.js";
import { initLiveTransitMaps } from "./live-map.js";

let showToast = () => {};

export function configureSettingsUi(options = {}) {
  if (typeof options.showToast === "function") {
    showToast = options.showToast;
  }
}

export function configureBrowserKey() {
  const current = getBrowserOdsayKey();
  const input = window.prompt(
    "서버 호출이 막힐 때 브라우저에서 직접 ODsay를 호출할 키를 입력하세요. 비우고 저장하면 삭제됩니다.",
    current
  );
  if (input === null) return;
  setBrowserOdsayKey(input);
  const kakaoInput = window.prompt(
    "Kakao Maps JavaScript 키를 입력하세요. 비우고 저장하면 지도는 간이 live map으로 표시됩니다.",
    getKakaoMapKey()
  );
  if (kakaoInput !== null) {
    setKakaoMapKey(kakaoInput);
    loadKakaoMaps.promise = null;
    resolveKakaoMapKey.promise = null;
    state.liveMaps = {};
    requestAnimationFrame(initLiveTransitMaps);
  }
  updateOdsayKeyVisibility();
  showToast(input.trim() || kakaoInput?.trim() ? "브라우저 키 설정을 저장했습니다" : "저장된 브라우저 키를 삭제했습니다");
}

export function updateOdsayKeyVisibility() {
  const btn = document.getElementById("key-settings-btn");
  if (btn) btn.style.display = getBrowserOdsayKey() ? "none" : "";
}
