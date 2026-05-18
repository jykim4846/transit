import { KAKAO_MAP_KEY_STORAGE } from "./constants.js";

export function setKakaoMapKey(value) {
  if (!value) {
    localStorage.removeItem(KAKAO_MAP_KEY_STORAGE);
    return;
  }
  localStorage.setItem(KAKAO_MAP_KEY_STORAGE, value.trim());
}

export function getKakaoMapKey() {
  const metaKey = document.querySelector('meta[name="kakao-map-key"]')?.content || "";
  return (localStorage.getItem(KAKAO_MAP_KEY_STORAGE) || window.TRANSIT_KAKAO_MAP_KEY || metaKey || "").trim();
}

export async function resolveKakaoMapKey() {
  const localKey = getKakaoMapKey();
  if (localKey) return localKey;
  if (resolveKakaoMapKey.promise) return resolveKakaoMapKey.promise;
  resolveKakaoMapKey.promise = fetch("/api/config", { cache: "no-store" })
    .then((response) => response.ok ? response.json() : {})
    .then((payload) => String(payload.kakaoMapKey || "").trim())
    .catch(() => "");
  return resolveKakaoMapKey.promise;
}

export async function loadKakaoMaps() {
  const key = await resolveKakaoMapKey();
  if (!key) return Promise.reject(new Error("Kakao Maps key missing"));
  if (window.kakao?.maps) {
    return new Promise((resolve) => window.kakao.maps.load(() => resolve(window.kakao.maps)));
  }
  if (loadKakaoMaps.promise) return loadKakaoMaps.promise;

  loadKakaoMaps.promise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${encodeURIComponent(key)}&autoload=false`;
    script.async = true;
    script.onload = () => window.kakao?.maps ? window.kakao.maps.load(() => resolve(window.kakao.maps)) : reject(new Error("Kakao Maps unavailable"));
    script.onerror = () => reject(new Error("Kakao Maps failed to load"));
    document.head.appendChild(script);
  });
  return loadKakaoMaps.promise;
}
