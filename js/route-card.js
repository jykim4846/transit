import { escapeHtml, relativeTime, minuteNumber, formatShortTime } from "./util.js";
import { state } from "./state.js";
import { BOARDED_TRIP_MAX_AGE_MS } from "./constants.js";
import {
  describeRecommendation,
  iconSvg,
  getCandidateTitle,
  getFirstAction,
  renderSegments,
  renderFastFlow,
  renderFastCandidate,
  renderCandidate
} from "./render.js";

export function renderEmptyCard() {
  return `
    <div class="empty-state">
      <!-- 빈 상태 일러스트 — 버스 정류장에서 기다리는 캐릭터 -->
      <div class="empty-state-illust" aria-hidden="true">
        <svg width="110" height="110" viewBox="0 0 110 110" fill="none" xmlns="http://www.w3.org/2000/svg">
          <!-- 하늘 배경 원 -->
          <circle cx="55" cy="55" r="50" fill="#f0f8ff" opacity="0.6"/>
          <!-- 구름 -->
          <ellipse cx="28" cy="28" rx="12" ry="7" fill="white" opacity="0.9"/>
          <ellipse cx="38" cy="25" rx="9" ry="6" fill="white" opacity="0.9"/>
          <ellipse cx="22" cy="30" rx="7" ry="5" fill="white" opacity="0.8"/>
          <!-- 땅 -->
          <rect x="10" y="82" width="90" height="8" rx="4" fill="#c8e6c9" opacity="0.7"/>
          <!-- 버스 정류장 기둥 -->
          <rect x="52" y="40" width="5" height="44" rx="2" fill="#90a4ae"/>
          <!-- 정류장 표지판 -->
          <rect x="44" y="28" width="28" height="16" rx="5" fill="#1c5bb7"/>
          <rect x="44" y="28" width="28" height="16" rx="5" fill="url(#stop-grad)"/>
          <text x="58" y="39" text-anchor="middle" font-size="7" font-weight="700" fill="white" font-family="sans-serif">BUS</text>
          <!-- 캐릭터 몸통 -->
          <rect x="30" y="60" width="20" height="22" rx="7" fill="#fce4ec"/>
          <rect x="30" y="60" width="20" height="22" rx="7" fill="url(#char-body-grad)"/>
          <!-- 캐릭터 머리 -->
          <ellipse cx="40" cy="54" rx="12" ry="11" fill="#ffe0b2"/>
          <!-- 귀 -->
          <ellipse cx="28" cy="53" rx="3.5" ry="4" fill="#ffe0b2"/>
          <ellipse cx="28" cy="53" rx="2" ry="2.5" fill="#f8bbd9" opacity="0.8"/>
          <ellipse cx="52" cy="53" rx="3.5" ry="4" fill="#ffe0b2"/>
          <ellipse cx="52" cy="53" rx="2" ry="2.5" fill="#f8bbd9" opacity="0.8"/>
          <!-- 머리카락 -->
          <path d="M28 48 Q40 36 52 48" fill="#5d4037"/>
          <ellipse cx="34" cy="44" rx="5" ry="4" fill="#5d4037"/>
          <ellipse cx="46" cy="44" rx="5" ry="4" fill="#5d4037"/>
          <!-- 눈 -->
          <ellipse cx="35" cy="53" rx="2.5" ry="3" fill="#3e2723"/>
          <ellipse cx="45" cy="53" rx="2.5" ry="3" fill="#3e2723"/>
          <circle cx="36" cy="51.5" r="0.9" fill="white"/>
          <circle cx="46" cy="51.5" r="0.9" fill="white"/>
          <!-- 뺨 -->
          <ellipse cx="30" cy="57" rx="3.5" ry="2" fill="#f8bbd9" opacity="0.75"/>
          <ellipse cx="50" cy="57" rx="3.5" ry="2" fill="#f8bbd9" opacity="0.75"/>
          <!-- 입 (씩 웃음) -->
          <path d="M36 60 Q40 63 44 60" stroke="#5d4037" stroke-width="1.3" stroke-linecap="round" fill="none"/>
          <!-- 손 (흔드는 쪽) -->
          <ellipse cx="70" cy="60" rx="6" ry="5" fill="#ffe0b2" class="empty-state-wave" style="transform-origin:70px 70px"/>
          <ellipse cx="72" cy="57" rx="2" ry="2.5" fill="#ffe0b2"/>
          <ellipse cx="75" cy="56" rx="2" ry="2.5" fill="#ffe0b2"/>
          <ellipse cx="78" cy="57" rx="2" ry="2.5" fill="#ffe0b2"/>
          <!-- 가방 -->
          <rect x="22" y="68" width="10" height="13" rx="4" fill="#b3e5fc"/>
          <rect x="24" y="66" width="6" height="4" rx="2" fill="#81d4fa"/>
          <!-- 꽃 장식 -->
          <circle cx="88" cy="36" r="5" fill="#fce4ec" opacity="0.9"/>
          <circle cx="88" cy="36" r="2.5" fill="#f48fb1"/>
          <circle cx="88" cy="28" r="3" fill="#fff9c4" opacity="0.9"/>
          <circle cx="88" cy="28" r="1.5" fill="#fff176"/>
          <defs>
            <linearGradient id="stop-grad" x1="44" y1="28" x2="72" y2="44" gradientUnits="userSpaceOnUse">
              <stop offset="0%" stop-color="#1c5bb7"/>
              <stop offset="100%" stop-color="#1565c0"/>
            </linearGradient>
            <linearGradient id="char-body-grad" x1="30" y1="60" x2="50" y2="82" gradientUnits="userSpaceOnUse">
              <stop offset="0%" stop-color="#f8bbd9"/>
              <stop offset="100%" stop-color="#fce4ec"/>
            </linearGradient>
          </defs>
        </svg>
      </div>
      <strong>루트를 저장해보세요!</strong>
      자주 가는 버스 출퇴근 경로를 저장해두면<br>루트마다 추천 기준을 정해 한눈에 볼 수 있어요.
    </div>
  `;
}

function sumSegmentMinutes(segments, predicate) {
  return (segments || [])
    .filter(predicate)
    .reduce((sum, segment) => sum + minuteNumber(segment.minutes ?? segment.time), 0);
}

function getPreviewWaitMinutes(candidate) {
  const vehicles = candidate?.busApproachPreview?.vehicles || [];
  const catchableVehicle = vehicles.find((vehicle) => vehicle.catchable !== false && vehicle.etaMinutes != null);
  const firstVehicle = vehicles.find((vehicle) => vehicle.etaMinutes != null);
  return catchableVehicle?.etaMinutes ?? firstVehicle?.etaMinutes ?? null;
}

function getJourneyBreakdown(candidate) {
  const segments = candidate?.segments || [];
  const transitIndices = segments
    .map((segment, index) => (segment.type === "bus" || segment.type === "subway" || segment.kind === "버스" || segment.kind === "지하철") ? index : -1)
    .filter((index) => index >= 0);
  const firstTransitIndex = transitIndices[0] ?? -1;
  const lastTransitIndex = transitIndices[transitIndices.length - 1] ?? -1;
  const initialWalk = candidate?.initialWalkTime != null
    ? minuteNumber(candidate.initialWalkTime)
    : sumSegmentMinutes(segments.slice(0, Math.max(0, firstTransitIndex)), (segment) => segment.type === "walk" || segment.kind === "도보");
  const previewWait = getPreviewWaitMinutes(candidate);
  const wait = candidate?.firstWaitMin != null ? minuteNumber(candidate.firstWaitMin) : (previewWait != null ? minuteNumber(previewWait) : null);
  const waitSource = candidate?.firstWaitMin != null ? candidate.firstWaitSource : (previewWait != null ? "seoul_arrival" : null);
  const ride = sumSegmentMinutes(segments, (segment) => segment.type === "bus" || segment.type === "subway" || segment.kind === "버스" || segment.kind === "지하철");
  const finalWalk = lastTransitIndex >= 0
    ? sumSegmentMinutes(segments.slice(lastTransitIndex + 1), (segment) => segment.type === "walk" || segment.kind === "도보")
    : Math.max(0, minuteNumber(candidate?.walkTime || candidate?.walkTimeText) - initialWalk);
  return { initialWalk, wait, waitSource, ride, finalWalk };
}

function renderJourneyBreakdown(candidate) {
  if (!candidate) return "";
  const parts = getJourneyBreakdown(candidate);
  const waitText = parts.wait == null ? "확인 중" : `${parts.wait}분`;
  return `
    <div class="journey-breakdown" aria-label="이동 시간 상세">
      <div class="journey-breakdown-item walk-start">
        <span class="journey-breakdown-label">출발 도보</span>
        <strong>${escapeHtml(parts.initialWalk)}분</strong>
        <span>${escapeHtml(candidate.boardingStopName || "탑승 정류장")}까지</span>
      </div>
      <div class="journey-breakdown-item wait">
        <span class="journey-breakdown-label">정류장 대기</span>
        <strong>${escapeHtml(waitText)}</strong>
        <span>${escapeHtml(parts.waitSource === "seoul_arrival" ? "실시간 도착 기준" : "예상 대기")}</span>
      </div>
      <div class="journey-breakdown-item ride">
        <span class="journey-breakdown-label">버스 탑승</span>
        <strong>${escapeHtml(parts.ride)}분</strong>
        <span>${escapeHtml(candidate.firstTransitLabel || candidate.routeNo || "이동")}</span>
      </div>
      <div class="journey-breakdown-item walk-end">
        <span class="journey-breakdown-label">도착 도보</span>
        <strong>${escapeHtml(parts.finalWalk)}분</strong>
        <span>하차 후 목적지까지</span>
      </div>
    </div>
  `;
}

export function renderRouteCard(route, options = {}) {
  const { commuteCtx, getSelectedCandidate, getBoardingStatusForRoute, isCommutePinned } = options;
  const ctx = commuteCtx;
  const pinned = isCommutePinned(route, ctx);
  const loading = state.loadingRouteIds.has(route.id);
  const expanded = state.expandedRouteIds.has(route.id);
  const result = route.lastResult;
  const recommendation = result?.recommendation || null;
  const fetchedAt = result?.fetchedAt || null;
  const compareCandidates = result?.candidates || [];
  const primary = getSelectedCandidate(route);
  const selectedId = primary?.id || null;
  const recommendedId = result?.recommendedId || null;
  const isAlternateActive = Boolean(primary && recommendedId && primary.id !== recommendedId);
  const totalMin = primary ? minuteNumber(primary.journeyMinutes || primary.scoreDisplay || primary.totalTime) : "--";
  const transfer = primary ? Number(primary.transferCount || 0) : "--";
  const walk = primary ? minuteNumber(primary.walkTime || primary.walkTimeText) : "--";
  const note = primary
    ? (primary.note || describeRecommendation(route, primary))
    : "출발지와 도착지를 저장한 뒤 실시간으로 다시 계산하세요.";
  const selectionBadge = isAlternateActive
    ? `<div class="fast-selection-hint">선택한 대안 후보로 표시 중이에요${recommendation ? ` · 추천(${escapeHtml(getCandidateTitle(recommendation))})로 돌아가려면 추천 카드를 누르세요` : ""}</div>`
    : "";
  const tripStatus = getBoardingStatusForRoute(route.id);
  const isBoardedHere = Boolean(tripStatus);
  const boardingPanel = (() => {
    if (isBoardedHere) {
      const remain = Math.max(0, Number(tripStatus.remainingStops || 0));
      const eta = tripStatus.etaMinutes;
      const started = formatShortTime(tripStatus.startedAt);
      const expires = formatShortTime(Number(tripStatus.startedAt) + BOARDED_TRIP_MAX_AGE_MS);
      const tripMeta = [started ? `${started} 탑승 시작` : "", expires ? `${expires}까지 유지` : ""].filter(Boolean).join(" · ");
      return `
        <div class="boarding-panel boarded" data-route-id="${escapeHtml(route.id)}">
          <div class="boarding-panel-mascot" aria-hidden="true">
            <svg width="52" height="48" viewBox="0 0 52 48" xmlns="http://www.w3.org/2000/svg">
              <ellipse class="bm-shadow" cx="26" cy="42" rx="18" ry="3" fill="rgba(58, 44, 43, 0.16)"/>
              <g class="bm-body">
                <rect x="6" y="8" width="40" height="28" rx="10" fill="#ffd6a0" stroke="#3a2c2b" stroke-width="2"/>
                <rect x="10" y="13" width="14" height="10" rx="3" fill="#fff8e7"/>
                <rect x="28" y="13" width="14" height="10" rx="3" fill="#fff8e7"/>
                <g class="bm-passenger">
                  <circle cx="17" cy="18" r="2.6" fill="#3a2c2b"/>
                  <rect x="15" y="19.5" width="4" height="3" rx="1" fill="#79cdb8"/>
                  <path class="bm-arm" d="M19 19 L23 16" stroke="#3a2c2b" stroke-width="1.6" stroke-linecap="round"/>
                </g>
                <circle cx="16" cy="28" r="1.6" fill="#ff8aa6"/>
                <circle cx="36" cy="28" r="1.6" fill="#ff8aa6"/>
                <path d="M21 29 q5 3 10 0" stroke="#3a2c2b" stroke-width="1.6" stroke-linecap="round" fill="none"/>
                <circle cx="20" cy="22" r="1.3" fill="#3a2c2b"/>
                <circle cx="32" cy="22" r="1.3" fill="#3a2c2b"/>
                <circle cx="20.5" cy="21.4" r="0.4" fill="#fff"/>
                <circle cx="32.5" cy="21.4" r="0.4" fill="#fff"/>
              </g>
              <g class="bm-wheels">
                <circle cx="14" cy="38" r="4" fill="#3a2c2b"/>
                <circle cx="38" cy="38" r="4" fill="#3a2c2b"/>
                <circle cx="14" cy="38" r="1.6" fill="#fff"/>
                <circle cx="38" cy="38" r="1.6" fill="#fff"/>
              </g>
              <g class="bm-sparkles">
                <text x="2" y="14" font-size="8" fill="#ffb479">✦</text>
                <text x="44" y="10" font-size="9" fill="#ff8aa6">✦</text>
                <text x="46" y="36" font-size="7" fill="#93bcff">✦</text>
              </g>
            </svg>
          </div>
          <div class="boarding-panel-info">
            <span class="boarding-panel-tag">🎒 탑승 중</span>
            <strong>${escapeHtml(tripStatus.alightingName || "하차 정류장")}까지 ${remain}정거장</strong>
            ${eta != null ? `<span>약 ${escapeHtml(eta)}분 후 하차</span>` : '<span>버스 위치 추적 중…</span>'}
            ${tripMeta ? `<span class="boarding-panel-meta">${escapeHtml(tripMeta)}</span>` : ""}
          </div>
          <button type="button" class="boarding-panel-btn end" data-action="end-boarding">하차</button>
        </div>
      `;
    }
    const previewVehicles = primary?.busApproachPreview?.vehicles || [];
    if (!previewVehicles.length) return "";
    const nextCatchable = previewVehicles.find((v) => v.catchable !== false);
    const offered = nextCatchable || previewVehicles[0];
    const isCatchable = offered.catchable !== false;
    const routeNo = primary?.routeNo || "버스";
    const vehicleLabel = offered.label || "다음";
    const vehicleKeyAttr = offered.key != null ? ` data-vehicle-key="${escapeHtml(String(offered.key))}"` : "";
    if (isCatchable) {
      const etaText = offered.etaMinutes != null ? `${offered.etaMinutes}분 후 도착` : "곧 도착";
      return `
        <div class="boarding-panel">
          <div class="boarding-panel-info">
            <span class="boarding-panel-tag">🚌 탑승 시작</span>
            <strong>${escapeHtml(routeNo)} · ${escapeHtml(vehicleLabel)} ${escapeHtml(etaText)}</strong>
            <span class="bus-availability-badge catchable">탈 수 있음</span>
            <span>이 버스에 탑승하면 알려드릴게요</span>
          </div>
          <button type="button" class="boarding-panel-btn primary" data-action="start-boarding" data-id="${escapeHtml(route.id)}"${vehicleKeyAttr}>이 버스 탑승</button>
        </div>
      `;
    }
    const passedValue = offered.passedAgoMinutes ?? offered.etaMinutes;
    const etaTextUncatchable = passedValue != null ? `${passedValue}분 전 통과` : "방금 통과";
    return `
      <div class="boarding-panel">
        <div class="boarding-panel-info">
          <span class="boarding-panel-tag">🚌 빨리 도착했나요?</span>
          <strong>${escapeHtml(routeNo)} · ${escapeHtml(vehicleLabel)} ${escapeHtml(etaTextUncatchable)}</strong>
          <span class="bus-availability-badge uncatchable">타기 어려움</span>
          <span>예상보다 빨리 도착했다면 이 버스를 선택하세요</span>
        </div>
        <button type="button" class="boarding-panel-btn primary" data-action="start-boarding" data-id="${escapeHtml(route.id)}"${vehicleKeyAttr}>이 버스 탑승</button>
      </div>
    `;
  })();
  const detailsHtml = result ? `
    <div class="detail-block">
      <h3>${isAlternateActive ? "선택 후보 상세" : "추천 상세"}</h3>
      ${renderSegments(primary?.segments)}
    </div>
    <div class="detail-block">
      <h3>후보 메모</h3>
      <div class="candidate-list">
        ${compareCandidates.map((candidate) => renderCandidate(candidate, candidate.id === result.recommendedId)).join("")}
      </div>
    </div>
  ` : `
    <div class="detail-block">
      <h3>다음 단계</h3>
      <div class="empty-state">
        <strong>루트는 저장되었지만 추천 데이터는 아직 없습니다</strong>
        추천 갱신 버튼을 누르면 현재 기준으로 후보를 하나 골라 저장합니다.
      </div>
    </div>
  `;

  return `
    <article class="route-card fast-card ${loading ? "loading" : ""} ${expanded ? "expanded" : ""} ${pinned ? "commute-pinned" : ""}">
      <div class="route-main">
        <section class="fast-trip-panel">
          <div class="fast-trip-head">
            <div class="fast-trip-title">
              ${iconSvg("map", 16)}
              <strong>${escapeHtml(route.from?.name || "출발지")} → ${escapeHtml(route.to?.name || "도착지")}</strong>
            </div>
            <div class="fast-trip-menu">
              <button class="fast-icon-btn" data-action="edit" data-id="${escapeHtml(route.id)}" aria-label="편집">${iconSvg("edit", 15)}</button>
              <button class="fast-icon-btn" data-action="delete" data-id="${escapeHtml(route.id)}" aria-label="삭제">${iconSvg("trash", 15)}</button>
            </div>
          </div>
          ${primary ? renderFastFlow(primary, { routeId: route.id }) : ""}
          <div class="fast-metrics">
            <div class="fast-metric arrive">
              <strong>${escapeHtml(totalMin)}</strong>
              <span>도착 · 분</span>
            </div>
            <div class="fast-metric transfer">
              <strong>${escapeHtml(transfer)}</strong>
              <span>환승 · 회</span>
            </div>
            <div class="fast-metric walk">
              <strong>${escapeHtml(walk)}</strong>
              <span>도보 · 분</span>
            </div>
          </div>
          ${renderJourneyBreakdown(primary)}
          <div class="fast-next-action">
            <div class="label">먼저 할 일</div>
            <div class="fast-next-row">
              <strong>${escapeHtml(getFirstAction(primary))}</strong>
              <span>→</span>
            </div>
          </div>
          <div class="fast-note">${iconSvg("clock", 15)} <span>${escapeHtml(note)} · ${escapeHtml(relativeTime(fetchedAt))}</span></div>
          ${selectionBadge}
          ${boardingPanel}
        </section>
        <section class="fast-candidates">
          ${compareCandidates.length ? compareCandidates.slice(0, 4).map((candidate, index) => renderFastCandidate(
            candidate,
            index,
            candidate.id === result?.recommendedId,
            { routeId: route.id, isSelected: candidate.id === selectedId }
          )).join("") : ""}
        </section>
        <section class="fast-detail">
          <button class="fast-detail-toggle" data-action="toggle" data-id="${escapeHtml(route.id)}">
            <div>
              <strong>상세 경로</strong>
              <span>필요할 때만 펼쳐서 확인</span>
            </div>
            ${iconSvg("chevron", 20)}
          </button>
          <div class="route-details">${detailsHtml}</div>
        </section>
      </div>
    </article>
  `;
}
