export function uid() {
  return typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : "route-" + Date.now() + "-" + Math.random().toString(16).slice(2);
}

export function nowStamp() {
  return new Date().toISOString();
}

export function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function formatTime(dateLike) {
  if (!dateLike) return "미갱신";
  const date = new Date(dateLike);
  if (Number.isNaN(date.getTime())) return "미갱신";
  return date.toLocaleTimeString("ko-KR", {
    hour: "2-digit",
    minute: "2-digit"
  });
}

export function relativeTime(dateLike) {
  if (!dateLike) return "아직 추천을 가져오지 않았습니다";
  const diffMin = Math.max(0, Math.floor((Date.now() - new Date(dateLike).getTime()) / 60000));
  if (diffMin < 1) return "방금 갱신";
  if (diffMin < 60) return diffMin + "분 전 갱신";
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return diffHour + "시간 전 갱신";
  return Math.floor(diffHour / 24) + "일 전 갱신";
}

export function minuteNumber(value) {
  const n = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(n) ? n : 0;
}

export function formatClock(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

export function formatCountdown(iso, nowMs = Date.now()) {
  if (!iso) return { text: "", state: "neutral", diffSec: null };
  const target = new Date(iso).getTime();
  if (Number.isNaN(target)) return { text: "", state: "neutral", diffSec: null };
  const diffSec = Math.round((target - nowMs) / 1000);
  if (diffSec < -60) return { text: `${Math.abs(Math.round(diffSec / 60))}분 전 통과`, state: "missed", diffSec };
  if (diffSec < 0) return { text: "방금 통과", state: "missed", diffSec };
  if (diffSec < 60) return { text: `${diffSec}초 후`, state: "urgent", diffSec };
  if (diffSec < 300) return { text: `${Math.floor(diffSec / 60)}분 ${diffSec % 60}초 후`, state: "urgent", diffSec };
  return { text: `${Math.round(diffSec / 60)}분 후`, state: "neutral", diffSec };
}
