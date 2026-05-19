import { escapeHtml, minuteNumber, formatShortTime } from "./util.js";
import { BOARDED_TRIP_MAX_AGE_MS } from "./constants.js";

// ---- Pure data helpers used by renderers ----

export function describeRecommendation(route, recommendation) {
  if (!recommendation) return "저장된 추천이 없습니다. 필요할 때만 직접 갱신하세요.";
  if (route.priority === "fastest") {
    return "총 이동시간이 가장 짧은 후보를 상단에 고정했습니다.";
  }
  if (route.priority === "fewest_transfers") {
    return "환승 수를 먼저 줄이고, 동률이면 더 빠른 후보를 선택합니다.";
  }
  if (recommendation.firstWaitMin == null) {
    return "첫 탑승 대기 추정치와 총 이동시간을 함께 반영한 결과입니다.";
  }
  const source = recommendation.firstWaitSource === "seoul_arrival"
    ? "서울시 버스 도착정보"
    : "배차간격 추정";
  const riskSuffix = recommendation.transferRiskText ? " " + recommendation.transferRiskText : "";
  return "첫 탑승 대기 " + recommendation.firstWaitMin + "분(" + source + ")과 환승 대기 추정 " + (recommendation.transferWaitMin || 0) + "분을 반영해 지금 출발 기준으로 정렬했습니다." + riskSuffix;
}

export function iconSvg(name, size = 16) {
  const paths = {
    map: '<path d="M20 10c0 4.5-6 10-6 10S8 14.5 8 10a6 6 0 1 1 12 0Z"></path><circle cx="14" cy="10" r="2"></circle>',
    clock: '<circle cx="12" cy="12" r="9"></circle><path d="M12 7v5l3 2"></path>',
    refresh: '<path d="M21 12a9 9 0 0 1-15.3 6.4"></path><path d="M3 12A9 9 0 0 1 18.3 5.6"></path><path d="M18 2v4h-4"></path><path d="M6 22v-4h4"></path>',
    edit: '<path d="M12 20h9"></path><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"></path>',
    trash: '<path d="M3 6h18"></path><path d="M8 6V4h8v2"></path><path d="m19 6-1 14H6L5 6"></path>',
    chevron: '<path d="m6 9 6 6 6-6"></path>'
  };
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || ""}</svg>`;
}

export function getCandidateTone(candidate, index, isRecommended) {
  if (candidate.pickKind === "fastest_and_fewest") return { label: "추천", accent: "#2563eb", bg: "#eff6ff" };
  if (candidate.pickKind === "fastest") return { label: "최소시간", accent: "#2563eb", bg: "#eff6ff" };
  if (candidate.pickKind === "fewest") return { label: "최소환승", accent: "#16a34a", bg: "#ecfdf5" };
  if (isRecommended) return { label: "추천", accent: "#2563eb", bg: "#eff6ff" };
  if (candidate.transferCount === 0) return { label: "직행", accent: "#ea580c", bg: "#fff7ed" };
  if (index === 1) return { label: "빠름", accent: "#16a34a", bg: "#ecfdf5" };
  return { label: "대안", accent: "#7c3aed", bg: "#f5f3ff" };
}

export function getCandidateTitle(candidate) {
  const parts = (candidate?.segments || [])
    .filter((segment) => segment.kind !== "도보")
    .map((segment) => segment.label || segment.kind)
    .filter(Boolean);
  if (parts.length) return parts.slice(0, 3).join(" → ");
  return candidate?.firstTransitLabel || "도보 중심";
}

export function getFirstAction(candidate) {
  if (!candidate) return "추천을 갱신해 경로 확인";
  if (candidate.boardingApproachText) return candidate.boardingApproachText;
  const first = (candidate.segments || []).find((segment) => segment.kind === "도보" && minuteNumber(segment.time) > 0);
  if (first) return first.text || `도보 ${first.time}`;
  return candidate.firstTransitLabel ? `${candidate.firstTransitLabel} 탑승 준비` : "바로 이동";
}

export function getFastFlowStops(candidate) {
  const segments = candidate?.segments || [];
  const names = [
    candidate?.boardingStopName,
    ...segments.map((segment) => segment.start),
    ...segments.map((segment) => segment.end),
    candidate?.alightingStopName
  ].filter(Boolean);
  const unique = [];
  names.forEach((name) => {
    const clean = String(name).trim();
    if (clean && !unique.includes(clean)) unique.push(clean);
  });
  if (unique.length >= 4) {
    return [unique[0], unique[Math.floor(unique.length / 3)], unique[Math.floor(unique.length * 2 / 3)], unique[unique.length - 1]];
  }
  if (unique.length >= 2) return [unique[0], "이동 중", unique[unique.length - 1]];
  return ["출발", "이동 중", "도착"];
}

export function getFastFlowStatus(candidate, stops) {
  const firstRide = (candidate?.segments || []).find((segment) => segment.type === "bus" || segment.kind === "버스")
    || (candidate?.segments || []).find((segment) => segment.type === "subway" || segment.kind === "지하철");
  const label = firstRide?.label || candidate?.firstTransitLabel || "이동";
  const target = candidate?.boardingStopName || stops?.[0] || "탑승 정류장";
  const eta = candidate?.firstWaitMin != null
    ? `${candidate.firstWaitMin}분 후 도착`
    : `${Math.max(1, Math.min(9, Math.round(Number(firstRide?.minutes || candidate?.totalTime || 3) / 3)))}분 후 도착`;
  return {
    text: `${label}이 ${target}으로 오고 있어요`,
    eta
  };
}

export function inferSegmentType(seg) {
  if (!seg) return "bus";
  if (seg.type === "walk" || seg.type === "bus" || seg.type === "subway" || seg.type === "wait") return seg.type;
  if (seg.kind === "도보") return "walk";
  if (seg.kind === "지하철") return "subway";
  if (seg.kind === "버스") return "bus";
  return "bus";
}

export function segmentMinutes(seg) {
  if (!seg) return 0;
  const raw = seg.minutes != null ? seg.minutes : (typeof seg.time === "string" ? parseInt(seg.time, 10) : seg.time);
  const n = Number(raw);
  return Number.isFinite(n) ? Math.max(0, n) : 0;
}

export function getJourneyStepLabel(segment) {
  if (!segment) return "";
  if (segment.kind === "도보") return segment.time || "도보";
  const head = String(segment.text || "").split(" · ")[0] || segment.kind || "";
  return `${head} ${segment.time || ""}`.trim();
}

export function candidateRiskLabel(candidate) {
  if (candidate.transferRiskLevel === "high") return "놓칠 위험 큼";
  if (candidate.transferRiskLevel === "medium") return "환승 주의";
  return null;
}

// ---- HTML string renderers ----

export function renderJourneyFlow(segments, options = {}) {
  const compact = Boolean(options.compact);
  const journeySegments = (segments || []).filter((segment) => {
    if (!segment) return false;
    if (segment.kind === "도보") {
      return Number.parseInt(segment.time, 10) > 0;
    }
    return true;
  });

  if (!journeySegments.length) return "";

  const items = ['<span class="journey-node start">출발</span>'];
  journeySegments.forEach((segment) => {
    const typeClass = segment.kind === "버스" ? "bus" : segment.kind === "지하철" ? "subway" : "walk";
    items.push('<span class="journey-link">→</span>');
    items.push(`<span class="journey-node ${typeClass}">${escapeHtml(getJourneyStepLabel(segment))}</span>`);
  });
  items.push('<span class="journey-link">→</span>');
  items.push('<span class="journey-node end">도착</span>');

  return `<div class="journey-flow${compact ? " compact" : ""}">${items.join("")}</div>`;
}

export function renderSegments(segments) {
  if (!segments?.length) {
    return '<div class="empty-state"><strong>상세 구간이 없습니다</strong>다음 갱신 때 다시 확인해주세요.</div>';
  }
  return '<div class="segment-list">' + segments.map((segment) => `
      <div class="segment-item">
        <div class="name">
          <span class="kind">${escapeHtml(segment.kind)}</span>
          <div class="text">${escapeHtml(segment.text)}</div>
        </div>
        <div class="time">${escapeHtml(segment.time)}</div>
      </div>
    `).join("") + "</div>";
}

export function renderFastFlow(candidate, options = {}) {
  const compact = Boolean(options.compact);
  const routeId = options.routeId || "";
  const raw = (candidate?.segments || []).filter(Boolean).map((seg) => ({
    type: inferSegmentType(seg),
    label: seg.label || seg.kind || "",
    minutes: Math.max(0.5, segmentMinutes(seg))
  }));
  const segments = raw.length ? raw : [{ type: "walk", label: "대기", minutes: 1 }];
  const total = segments.reduce((sum, seg) => sum + seg.minutes, 0) || 1;
  const html = segments.map((seg) => {
    const pct = Math.max(7, (seg.minutes / total) * 100);
    const label = pct > 18 ? escapeHtml(seg.label) : "";
    return `<span class="fast-flow-seg ${escapeHtml(seg.type)}" style="width:${pct}%;">${label}</span>`;
  }).join("");
  const stops = getFastFlowStops(candidate);
  const status = getFastFlowStatus(candidate, stops);
  const liveMap = compact ? "" : `
      <div class="live-map" data-live-map data-route-id="${escapeHtml(routeId)}">
        <div class="live-map-canvas" aria-hidden="true"></div>
        <div class="live-map-fallback" data-live-map-fallback>
          <div class="live-map-fallback-illust" aria-hidden="true">
            <svg width="72" height="72" viewBox="0 0 72 72" fill="none" xmlns="http://www.w3.org/2000/svg">
              <!-- 지도 배경 -->
              <rect x="8" y="12" width="48" height="38" rx="8" fill="#e8f4fd"/>
              <rect x="8" y="12" width="48" height="38" rx="8" fill="url(#map-grad)" opacity="0.7"/>
              <!-- 지도 도로 선 -->
              <rect x="14" y="24" width="36" height="3" rx="1.5" fill="#b0bec5" opacity="0.7"/>
              <rect x="14" y="32" width="20" height="3" rx="1.5" fill="#b0bec5" opacity="0.7"/>
              <rect x="28" y="20" width="3" height="24" rx="1.5" fill="#b0bec5" opacity="0.7"/>
              <!-- 핀 마커 -->
              <ellipse cx="40" cy="36" rx="5" ry="7" fill="#f06292"/>
              <ellipse cx="40" cy="36" rx="3" ry="4.5" fill="#e91e63"/>
              <circle cx="40" cy="33" r="2.5" fill="white" opacity="0.7"/>
              <ellipse cx="40" cy="42" rx="3" ry="1.2" fill="#c2185b" opacity="0.4"/>
              <!-- 돋보기 -->
              <circle cx="58" cy="48" r="10" fill="white" opacity="0.92" stroke="#90caf9" stroke-width="2"/>
              <circle cx="58" cy="48" r="6.5" fill="#e3f2fd"/>
              <line x1="65" y1="55" x2="70" y2="60" stroke="#90caf9" stroke-width="3" stroke-linecap="round"/>
              <!-- 돋보기 안 지도 힌트 -->
              <rect x="54" y="45" width="8" height="1.5" rx="0.75" fill="#90caf9" opacity="0.8"/>
              <rect x="54" y="48" width="5" height="1.5" rx="0.75" fill="#90caf9" opacity="0.6"/>
              <!-- 별 -->
              <polygon points="20,14 21,17 24,17 21.5,19 22.5,22 20,20 17.5,22 18.5,19 16,17 19,17" fill="#ffd54f" opacity="0.8"/>
              <circle cx="60" cy="18" r="2.5" fill="#f8bbd9" opacity="0.9"/>
              <defs>
                <linearGradient id="map-grad" x1="8" y1="12" x2="56" y2="50" gradientUnits="userSpaceOnUse">
                  <stop offset="0%" stop-color="#c8e6f5"/>
                  <stop offset="100%" stop-color="#e8f5e9"/>
                </linearGradient>
              </defs>
            </svg>
          </div>
          <strong>Kakao Map 연결 중</strong>
          <span>실제 지도 위에서 내 위치, 탑승 정류장, 접근 중인 버스를 불러오고 있습니다.</span>
        </div>
        <div class="live-map-eta-chip">${escapeHtml(status.eta)}</div>
      </div>
    `;
  const nodes = segments.slice(0, 5).map((seg) => `
      <div class="fast-flow-node">
        <span class="fast-flow-dot ${escapeHtml(seg.type)}"></span>
        <span class="fast-flow-label">${escapeHtml(seg.label || seg.type)}</span>
        <span class="fast-flow-minutes">${escapeHtml(Math.round(seg.minutes))}분</span>
      </div>
    `).join("");
  return `
      <div class="fast-flow ${compact ? "compact" : ""}">
        <div class="fast-flow-head">
          <div>
            <div class="kicker">realtime route</div>
            <strong>실시간 이동 흐름</strong>
          </div>
          <div class="fast-flow-live">LIVE</div>
        </div>
        ${liveMap}
        <div class="fast-flow-timeline">
          <div class="fast-flow-nodes">${nodes}</div>
        </div>
        <div class="fast-flow-mini-track">
          <div class="fast-flow-inner">${html}</div>
        </div>
        <div class="fast-flow-status">
          <div>
            <div class="label">현재 상태</div>
            <strong>${escapeHtml(status.text)}</strong>
          </div>
          <div class="fast-flow-eta">${escapeHtml(status.eta)}</div>
        </div>
      </div>
    `;
}

export function renderFastCandidate(candidate, index, isRecommended, options = {}) {
  const tone = getCandidateTone(candidate, index, isRecommended);
  const score = minuteNumber(candidate.journeyMinutes || candidate.scoreDisplay || candidate.totalTime);
  const isSelected = Boolean(options.isSelected);
  const routeId = options.routeId || "";
  const classes = ["fast-candidate"];
  if (isRecommended) classes.push("recommended");
  if (isSelected) classes.push("active");
  return `
      <button type="button"
              class="${classes.join(" ")}"
              data-action="select-candidate"
              data-id="${escapeHtml(routeId)}"
              data-candidate-id="${escapeHtml(candidate.id || "")}"
              aria-pressed="${isSelected ? "true" : "false"}">
        <div class="fast-candidate-top">
          <div>
            <span class="fast-candidate-tag" style="color:${tone.accent}; background:${tone.bg};">${escapeHtml(tone.label)}${isSelected ? " · 선택됨" : ""}</span>
            <div class="fast-candidate-title">${escapeHtml(getCandidateTitle(candidate))}</div>
            <div class="fast-candidate-meta">환승 ${escapeHtml(candidate.transferCount ?? 0)}회 · 도보 ${escapeHtml(minuteNumber(candidate.walkTime || candidate.walkTimeText))}분</div>
          </div>
          <div class="fast-candidate-score">
            <strong style="color:${tone.accent};">${escapeHtml(score || candidate.scoreDisplay || "--")}</strong>
            <span>분</span>
          </div>
        </div>
        ${renderFastFlow(candidate, { compact: true })}
      </button>
    `;
}

export function renderCandidate(candidate, isRecommended) {
  return `
      <div class="candidate-card ${isRecommended ? "recommended" : ""}">
        <div class="candidate-card-top">
          <div>
            <strong>${escapeHtml(candidate.firstTransitLabel || "도보 중심")}</strong>
            <div class="meta">
              ${escapeHtml(candidate.note)}
            </div>
            ${candidate.transferRiskText ? `<div class="meta" style="margin-top:4px;">주의: ${escapeHtml(candidate.transferRiskText)}</div>` : ""}
          </div>
          <div class="candidate-score">${escapeHtml(candidate.scoreDisplay)}</div>
        </div>
        ${renderJourneyFlow(candidate.segments, { compact: true })}
      </div>
    `;
}

export function renderBusApproachPreview(preview) {
  if (!preview?.stops?.length) return "";

  const vehicles = preview.vehicles || [];
  const firstCatchableIdx = vehicles.findIndex((vehicle) => vehicle.catchable !== false);

  let laterCatchableCount = 0;
  const classified = vehicles.map((vehicle, index) => {
    if (vehicle.catchable === false) {
      return { vehicle, index, posClass: "uncatchable", label: "타기 어려움" };
    }
    if (index === firstCatchableIdx) {
      return { vehicle, index, posClass: "next", label: "다음" };
    }
    laterCatchableCount += 1;
    const label = laterCatchableCount === 1 ? "다다음" : `다음+${laterCatchableCount}`;
    return { vehicle, index, posClass: "after", label };
  });

  const clampPercent = (raw) => Math.max(0, Math.min(100, Number(raw) || 0));

  const buses = classified.map(({ vehicle, index, posClass, label }) => {
    const bits = [`<strong>${escapeHtml(label)}</strong>`];
    const availabilityClass = vehicle.catchable === false ? "uncatchable" : "catchable";
    const availabilityText = vehicle.catchable === false ? "타기 어려움" : "탈 수 있음";
    bits.push(`<span class="bus-availability-badge ${availabilityClass}">${availabilityText}</span>`);
    if (vehicle.etaMinutes != null) {
      const etaText = vehicle.catchable === false
        ? `${vehicle.passedAgoMinutes ?? vehicle.etaMinutes}분 전 통과`
        : `${vehicle.etaMinutes}분 후`;
      const etaAttr = vehicle.etaAt ? ` data-countdown-eta="${escapeHtml(vehicle.etaAt)}"` : "";
      bits.push(`<span${etaAttr}>${escapeHtml(etaText)}</span>`);
    }
    bits.push(`<span>${escapeHtml(`${vehicle.remainingStops}정거장 ${vehicle.catchable === false ? "뒤" : "전"}`)}</span>`);
    return `
        <div class="bus-line-bus ${posClass}" data-slot="${index}" style="left:${clampPercent(vehicle.progressPercent)}%;">
          ${bits.join("")}
        </div>
      `;
  }).join("");

  const busMarkers = classified.map(({ vehicle, posClass }) => (
    `<div class="bus-line-marker ${posClass}" style="left:${clampPercent(vehicle.progressPercent)}%;"></div>`
  )).join("");

  const stops = preview.stops.map((stop) => `
      <div class="bus-line-stop ${stop.isBoarding ? "boarding" : ""}${stop.isAlighting ? " alighting" : ""}">
        <span class="bus-line-dot"></span>
        <div class="bus-line-stop-name">${escapeHtml(stop.name)}</div>
      </div>
    `).join("");

  const vehicleSummary = classified.map(({ vehicle, label }) => {
    const eta = vehicle.etaMinutes != null
      ? (vehicle.catchable === false ? `${vehicle.passedAgoMinutes ?? vehicle.etaMinutes}분 전 통과` : `${vehicle.etaMinutes}분 후`)
      : `${vehicle.remainingStops}정거장 ${vehicle.catchable === false ? "뒤" : "전"}`;
    const availability = vehicle.catchable === false ? "타기 어려움" : "탈 수 있음";
    return `${label} ${availability} ${eta}`;
  }).join(" · ");

  return `
      <div class="bus-line-board">
        <div class="bus-line-head">
          <strong>${escapeHtml(preview.routeNo)} 접근 노선</strong>
          <span>${escapeHtml(vehicleSummary || "차량 위치 정보 없음")}</span>
        </div>
        <div class="bus-line-track">
          ${buses}
          ${busMarkers}
          ${stops}
        </div>
      </div>
    `;
}

// ---- DOM mutator (lightweight, kept here because it just patches innerHTML) ----

export function updateBoardingPanelDOM(routeId, trip) {
  const panel = document.querySelector(`.boarding-panel.boarded[data-route-id="${CSS.escape(routeId)}"]`);
  if (!panel) return;
  const started = formatShortTime(trip.startedAt);
  const expires = formatShortTime(Number(trip.startedAt) + BOARDED_TRIP_MAX_AGE_MS);
  const tripMeta = [started ? `${started} 탑승 시작` : "", expires ? `${expires}까지 유지` : ""].filter(Boolean).join(" · ");
  panel.innerHTML = `
      <div class="boarding-panel-info">
        <span class="boarding-panel-tag">탑승 중 🚌</span>
        <strong>${escapeHtml(trip.alightingName || "하차 정류장")}까지 ${escapeHtml(trip.remainingStops ?? "-")}정거장</strong>
        ${trip.etaMinutes != null ? `<span>약 ${escapeHtml(trip.etaMinutes)}분 후 하차</span>` : ""}
        ${tripMeta ? `<span class="boarding-panel-meta">${escapeHtml(tripMeta)}</span>` : ""}
      </div>
      <button type="button" class="boarding-panel-btn" data-action="end-boarding">하차했어요</button>
    `;
}
