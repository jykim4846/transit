import { formatClock, formatCountdown } from "./util.js";

export function tickCountdowns(nowMs = Date.now()) {
  document.querySelectorAll("[data-arrive-at]").forEach((node) => {
    if (!node.classList.contains("promoted")) {
      const deadline = node.getAttribute("data-fallback-deadline");
      const fbArrive = node.getAttribute("data-fallback-arrive-at");
      if (deadline && fbArrive && new Date(deadline).getTime() <= nowMs) {
        node.setAttribute("data-arrive-at", fbArrive);
        node.classList.add("promoted");
        const label = node.querySelector("[data-arrive-label]");
        if (label) label.textContent = `${formatClock(fbArrive)} 도착`;
        const note = node.querySelector("[data-journey-note]");
        if (note) note.textContent = "첫 차 놓침 · 같은 노선 다음 차 기준";
        document.querySelectorAll(`[data-fallback-row][data-fallback-deadline="${deadline}"]`).forEach((row) => {
          row.classList.add("consumed");
        });
      }
    }

    const iso = node.getAttribute("data-arrive-at");
    const cd = formatCountdown(iso, nowMs);
    const badge = node.querySelector("[data-countdown-arrive]");
    if (!badge) return;
    badge.textContent = cd.text;
    badge.classList.remove("urgent", "missed");
    if (cd.state === "urgent") badge.classList.add("urgent");
    if (cd.state === "missed") badge.classList.add("missed");
  });

  document.querySelectorAll("[data-countdown-eta]").forEach((node) => {
    const iso = node.getAttribute("data-countdown-eta");
    const target = new Date(iso).getTime();
    if (Number.isNaN(target)) return;
    const diffSec = Math.round((target - nowMs) / 1000);
    const parent = node.closest(".bus-line-bus");
    if (diffSec < 0) {
      node.textContent = `${Math.max(1, Math.ceil(-diffSec / 60))}분 전 통과`;
      if (parent) parent.classList.add("uncatchable");
    } else if (diffSec < 60) {
      node.textContent = `${diffSec}초 후`;
    } else if (diffSec < 300) {
      node.textContent = `${Math.floor(diffSec / 60)}분 ${diffSec % 60}초 후`;
    } else {
      node.textContent = `${Math.round(diffSec / 60)}분 후`;
    }
  });
}

export function startCountdowns() {
  tickCountdowns();
  return setInterval(tickCountdowns, 1000);
}
