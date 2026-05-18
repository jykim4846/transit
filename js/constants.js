export const STORAGE_KEY = "transit-routes-v2";
export const LEGACY_STORAGE_KEY = "transit-routes";
export const ROUTE_CARD_COLLAPSED_KEY = "transit-route-card-collapsed";
export const ODSAY_BROWSER_KEY_STORAGE = "transit-odsay-browser-key";
export const KAKAO_MAP_KEY_STORAGE = "transit-kakao-map-key";
export const AUTOCOMPLETE_MIN_LENGTH = 2;
export const ODSAY_API_ROOT = "https://api.odsay.com/v1/api";

export const PRIORITY_META = {
  fastest: {
    label: "최소시간",
    className: "priority-fastest",
    scoreLabel: "총 이동",
    staleText: "가장 빠른 총 소요시간 기준"
  },
  fewest_transfers: {
    label: "최소환승",
    className: "priority-fewest_transfers",
    scoreLabel: "환승 우선",
    staleText: "환승 수가 가장 적은 기준"
  },
  best_eta: {
    label: "지금 출발",
    className: "priority-best_eta",
    scoreLabel: "출발 기준",
    staleText: "첫 탑승 대기까지 반영한 기준"
  }
};

export function priorityLabel(value) {
  return PRIORITY_META[value]?.label || value;
}
