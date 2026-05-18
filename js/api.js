import { ODSAY_API_ROOT, ODSAY_BROWSER_KEY_STORAGE, AUTOCOMPLETE_MIN_LENGTH } from "./constants.js";

// ---- Internal pure helpers (duplicated from transit-app.html where they are
// still used by non-extracted code; will be consolidated in a later phase). ----

function toPathPoint(value) {
  const lat = Number(value?.lat ?? value?.y);
  const lng = Number(value?.lng ?? value?.x);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { lat, lng };
}

function dedupePathPoints(points) {
  const result = [];
  points.filter(Boolean).forEach((point) => {
    const prev = result[result.length - 1];
    if (prev && Math.abs(prev.lat - point.lat) < 0.000001 && Math.abs(prev.lng - point.lng) < 0.000001) return;
    result.push(point);
  });
  return result;
}

export function tagRoutePicks(result) {
  if (!result?.candidates?.length || !result.picks) return result;
  const fastestId = result.picks.fastestId;
  const fewestId = result.picks.fewestTransfersId;
  return {
    ...result,
    candidates: result.candidates.map((candidate) => {
      let pickKind = candidate.pickKind || null;
      if (candidate.id === fastestId && candidate.id === fewestId) pickKind = "fastest_and_fewest";
      else if (candidate.id === fastestId) pickKind = "fastest";
      else if (candidate.id === fewestId) pickKind = "fewest";
      return pickKind ? { ...candidate, pickKind } : candidate;
    }),
    recommendation: result.recommendation
      ? {
        ...result.recommendation,
        pickKind: fastestId === fewestId ? "fastest_and_fewest" : "fastest"
      }
      : result.recommendation
  };
}

function inferTransferCount(info) {
  const rides = Number(info.busTransitCount || 0) + Number(info.subwayTransitCount || 0);
  return Math.max(0, rides - 1);
}

function summarizeCandidateSteps(subPaths) {
  return (subPaths || []).filter((segment) =>
    segment.trafficType === 1 ||
    segment.trafficType === 2 ||
    (segment.trafficType === 3 && Number(segment.sectionTime || 0) > 0)
  ).map((segment) => {
    if (segment.trafficType === 3) {
      return { type: "walk", label: `도보 ${segment.sectionTime || 0}분` };
    }
    if (segment.trafficType === 2) {
      return { type: "bus", label: segment.lane?.[0]?.busNo || "버스" };
    }
    return { type: "subway", label: segment.lane?.[0]?.name || "지하철" };
  }).slice(0, 6);
}

function getPathSectionTime(subPaths) {
  return (subPaths || []).reduce((sum, segment) => sum + Number(segment.sectionTime || 0), 0);
}

function getTransferTimingEstimate(subPaths, priority) {
  if (priority !== "best_eta") {
    return {
      transferWaitMin: 0,
      transferRiskLevel: "none",
      transferRiskText: null
    };
  }

  const transitIndices = (subPaths || []).map((segment, index) =>
    segment.trafficType === 1 || segment.trafficType === 2 ? index : -1
  ).filter((index) => index >= 0);

  if (transitIndices.length <= 1) {
    return {
      transferWaitMin: 0,
      transferRiskLevel: "none",
      transferRiskText: null
    };
  }

  let transferWaitMin = 0;
  let tightestSlackMin = null;

  transitIndices.slice(1).forEach((transitIndex) => {
    const segment = subPaths[transitIndex];
    const interval = Number(segment.intervalTime || 0);
    if (!(interval > 0)) return;

    const elapsedTravelMin = (subPaths || [])
      .slice(0, transitIndex)
      .reduce((sum, item) => sum + Number(item.sectionTime || 0), 0);

    const slackMin = interval - elapsedTravelMin;
    transferWaitMin += Math.max(0, slackMin);
    tightestSlackMin = tightestSlackMin == null ? slackMin : Math.min(tightestSlackMin, slackMin);
  });

  if (tightestSlackMin == null) {
    return {
      transferWaitMin,
      transferRiskLevel: "none",
      transferRiskText: null
    };
  }

  if (tightestSlackMin <= 1) {
    return {
      transferWaitMin,
      transferRiskLevel: "high",
      transferRiskText: tightestSlackMin < 0
        ? "환승 여유가 부족해 실제로는 다음 차를 놓칠 가능성이 큽니다."
        : `환승 여유가 ${tightestSlackMin}분 수준이라 지연 시 놓칠 가능성이 큽니다.`
    };
  }

  if (tightestSlackMin <= 4) {
    return {
      transferWaitMin,
      transferRiskLevel: "medium",
      transferRiskText: `환승 여유가 ${tightestSlackMin}분 정도라 조금만 지연돼도 놓칠 수 있습니다.`
    };
  }

  return {
    transferWaitMin,
    transferRiskLevel: "low",
    transferRiskText: null
  };
}

function getLastTransit(subPaths) {
  for (let index = (subPaths || []).length - 1; index >= 0; index -= 1) {
    const segment = subPaths[index];
    if (segment.trafficType === 1 || segment.trafficType === 2) {
      return segment;
    }
  }
  return null;
}

async function fetchJsonDirect(url) {
  const response = await fetch(url, { cache: "no-store" });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload?.error) {
    throw new Error(payload?.error?.msg || payload?.error?.message || payload?.error?.code || payload.error || "ODsay 직접 호출 실패");
  }
  return payload;
}

// ---- Exported network / data-fetch layer ----

export function getBrowserOdsayKey() {
  return localStorage.getItem(ODSAY_BROWSER_KEY_STORAGE) || "";
}

export function setBrowserOdsayKey(value) {
  if (!value) {
    localStorage.removeItem(ODSAY_BROWSER_KEY_STORAGE);
    return;
  }
  localStorage.setItem(ODSAY_BROWSER_KEY_STORAGE, value.trim());
}

export async function fetchJson(url, options = {}) {
  const { signal: externalSignal, timeoutMs = 15000 } = options;
  const controller = new AbortController();
  const onExternalAbort = () => controller.abort();
  if (externalSignal) {
    if (externalSignal.aborted) controller.abort();
    else externalSignal.addEventListener("abort", onExternalAbort, { once: true });
  }
  const timer = timeoutMs > 0 ? setTimeout(() => controller.abort(), timeoutMs) : null;
  try {
    const response = await fetch(url, { cache: "no-store", signal: controller.signal });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload.error || "요청에 실패했습니다");
    }
    return payload;
  } catch (error) {
    if (error?.name === "AbortError") {
      if (externalSignal?.aborted) throw error;
      throw new Error("요청 시간 초과");
    }
    throw error;
  } finally {
    if (timer) clearTimeout(timer);
    if (externalSignal) externalSignal.removeEventListener("abort", onExternalAbort);
  }
}

export async function fetchOdsayDirect(endpoint, params) {
  const key = getBrowserOdsayKey();
  if (!key) {
    throw new Error("서버 호출이 실패했고 브라우저 fallback용 ODsay 키도 저장되지 않았습니다");
  }
  const query = new URLSearchParams({
    apiKey: key,
    lang: "0",
    output: "json",
    ...params
  });
  return fetchJsonDirect(`${ODSAY_API_ROOT}/${endpoint}?${query.toString()}`);
}

export const searchStations = (() => {
  let seq = 0;
  // When a newer call has superseded this one we return a never-resolving
  // Promise so callers (autocomplete dropdown) silently discard the result
  // without surfacing a spurious error toast.
  const stale = () => new Promise(() => {});
  return async function searchStations(query) {
    const normalized = query.trim();
    if (normalized.length < AUTOCOMPLETE_MIN_LENGTH) {
      return {
        stations: [],
        warnings: []
      };
    }
    const mySeq = ++seq;
    try {
      const payload = await fetchJson("/api/stations?q=" + encodeURIComponent(normalized));
      if (mySeq !== seq) return stale();
      return {
        stations: payload.stations || [],
        warnings: payload.warnings || []
      };
    } catch (error) {
      if (mySeq !== seq) return stale();
      const fallbackPayload = await fetchOdsayDirect("searchStation", { stationName: normalized });
      if (mySeq !== seq) return stale();
      const stations = (fallbackPayload.result?.station || []).slice(0, 8).map((station) => ({
        name: station.stationName || station.stationNameKor || "",
        x: station.x,
        y: station.y,
        stationID: station.stationID || null,
        kind: Number(station.stationType ?? 0) === 1 || Number(station.stationClass ?? 0) === 2 ? "지하철" : "버스",
        detail: [
          station.stationCityName,
          station.stationDistrictName,
          station.stationDongName
        ].filter(Boolean).join(" · ")
      })).filter((station) => station.name && station.x && station.y);
      return {
        stations,
        warnings: ["서버 경로가 막혀 브라우저 직접 호출로 검색했습니다", error.message]
      };
    }
  };
})();

export function normalizeSegments(subPaths) {
  return (subPaths || []).map((segment) => {
    const minutes = Number(segment.sectionTime || 0);
    const start = segment.startName || "";
    const end = segment.endName || "";
    const rawStops = segment.passStopList?.stations
      || segment.passStopList?.station
      || segment.passStopList
      || [];
    const stops = Array.isArray(rawStops) ? rawStops : [];
    const pathPoints = dedupePathPoints([
      toPathPoint({ x: segment.startX, y: segment.startY }),
      ...stops.map((stop) => toPathPoint({ x: stop.x ?? stop.lng, y: stop.y ?? stop.lat })),
      toPathPoint({ x: segment.endX, y: segment.endY })
    ]);
    if (segment.trafficType === 3) {
      return {
        type: "walk",
        kind: "도보",
        text: `${start || "이동"} → ${end || "연결"}`,
        time: `${minutes}분`,
        minutes,
        start,
        end,
        pathPoints,
        label: `도보 ${minutes}분`
      };
    }
    if (segment.trafficType === 2) {
      const busNo = segment.lane?.[0]?.busNo || "버스";
      return {
        type: "bus",
        kind: "버스",
        text: `${busNo} · ${start} → ${end}`,
        time: `${minutes}분`,
        minutes,
        start,
        end,
        pathPoints,
        label: busNo
      };
    }
    const name = segment.lane?.[0]?.name || "지하철";
    return {
      type: "subway",
      kind: "지하철",
      text: `${name} · ${start} → ${end}`,
      time: `${minutes}분`,
      minutes,
      start,
      end,
      pathPoints,
      label: name
    };
  });
}

export async function fetchRouteRecommendationDirect(route, from, to) {
  const pathTypes = ["0", "2", "1"];
  const responses = await Promise.allSettled(pathTypes.map((pathType) => fetchOdsayDirect("searchPubTransPathR", {
    SX: String(from.x),
    SY: String(from.y),
    EX: String(to.x),
    EY: String(to.y),
    SearchPathType: pathType,
    OPT: "0"
  })));
  const seen = new Set();
  const rawPaths = [];
  responses.forEach((response) => {
    if (response.status !== "fulfilled") return;
    (response.value.result?.path || []).forEach((path) => {
      const key = (path.subPath || []).map((segment) => [
        segment.trafficType,
        segment.startName || "",
        segment.endName || "",
        segment.lane?.[0]?.busID || segment.lane?.[0]?.busNo || segment.lane?.[0]?.name || "",
        segment.sectionTime || 0
      ].join(":")).join("|");
      if (seen.has(key)) return;
      seen.add(key);
      rawPaths.push(path);
    });
  });
  if (!rawPaths.length) {
    throw new Error("조건에 맞는 경로가 없습니다");
  }

  const candidates = [];
  for (let index = 0; index < rawPaths.length; index += 1) {
    const path = rawPaths[index];
    const info = path.info || {};
    const subPaths = path.subPath || [];
    const firstTransit = subPaths.find((segment) => segment.trafficType === 1 || segment.trafficType === 2) || null;
    const firstTransitStartName = firstTransit?.startName || firstTransit?.startStationName || null;
    const initialWalkTime = subPaths
      .slice(0, Math.max(0, subPaths.findIndex((segment) => segment.trafficType === 1 || segment.trafficType === 2)))
      .filter((segment) => segment.trafficType === 3)
      .reduce((sum, segment) => sum + Number(segment.sectionTime || 0), 0);
    const interval = Number(firstTransit?.intervalTime || 0);
    let firstWaitMin = null;
    let firstWaitSource = "not_applicable";
    if (route.priority === "best_eta") {
      if (firstTransit?.trafficType === 2) {
        if (interval > 0) {
          firstWaitMin = Math.max(0, Math.max(1, Math.round(interval / 2)) - initialWalkTime);
          firstWaitSource = "interval";
        } else {
          firstWaitSource = "seoul_unavailable";
        }
      } else if (interval > 0) {
        firstWaitMin = Math.max(0, Math.max(1, Math.round(interval / 2)) - initialWalkTime);
        firstWaitSource = "interval";
      } else {
        firstWaitSource = "none";
      }
    }
    const unavailableBusRealtime = route.priority === "best_eta" && firstTransit?.trafficType === 2 && firstWaitMin == null;
    const transferTiming = getTransferTimingEstimate(subPaths, route.priority);
    const totalTime = getPathSectionTime(subPaths);
    const transferCount = inferTransferCount(info);
    const walkTime = subPaths.filter((segment) => segment.trafficType === 3).reduce((sum, segment) => sum + Number(segment.sectionTime || 0), 0);
    const lastTransit = getLastTransit(subPaths);
    const alightingStopName = lastTransit?.endName || lastTransit?.endStationName || null;
    let scoreValue = totalTime;
    let scoreDisplay = `${totalTime}분`;
    let note = "총 소요시간이 가장 짧은 후보를 우선합니다.";

    if (route.priority === "best_eta") {
      scoreValue = totalTime + (firstWaitMin || 0) + transferTiming.transferWaitMin;
      scoreDisplay = `${scoreValue}분`;
      note = "첫 탑승 대기와 총 이동시간을 함께 비교했습니다.";
    }

    const departAtMs = Date.now();
    const journeyMinutes = totalTime + (firstWaitMin || 0) + (transferTiming.transferWaitMin || 0);
    const arriveAtMs = departAtMs + journeyMinutes * 60 * 1000;

    candidates.push({
      id: `path-${index}`,
      scoreValue,
      scoreDisplay,
      totalTime,
      totalTimeText: `${totalTime}분`,
      transferCount,
      transferCountText: `${transferCount}회`,
      walkTime,
      walkTimeText: `${walkTime}분`,
      firstWaitMin,
      firstWaitText: route.priority !== "best_eta"
        ? "기준 아님"
        : (unavailableBusRealtime ? "실시간 미반영" : (firstWaitMin != null ? `${firstWaitMin}분` : "정보 없음")),
      firstWaitSource,
      unavailableBusRealtime,
      transferWaitMin: transferTiming.transferWaitMin,
      transferWaitText: route.priority === "best_eta" ? `${transferTiming.transferWaitMin}분` : "기준 아님",
      transferRiskLevel: transferTiming.transferRiskLevel,
      transferRiskText: transferTiming.transferRiskText,
      firstTransitLabel: firstTransit ? (firstTransit.trafficType === 2 ? (firstTransit.lane?.[0]?.busNo || "버스") : (firstTransit.lane?.[0]?.name || "지하철")) : "도보",
      boardingStopName: firstTransitStartName,
      boardingApproachText: firstTransitStartName
        ? (initialWalkTime > 0 ? `도보 후 ${firstTransitStartName} 탑승` : `${firstTransitStartName} 탑승`)
        : null,
      alightingStopName,
      summarySteps: summarizeCandidateSteps(subPaths),
      note,
      departAt: new Date(departAtMs).toISOString(),
      arriveAt: new Date(arriveAtMs).toISOString(),
      journeyMinutes,
      segments: normalizeSegments(subPaths)
    });
  }

  const byFastest = [...candidates].sort((a, b) => {
    if (a.journeyMinutes !== b.journeyMinutes) return a.journeyMinutes - b.journeyMinutes;
    if (a.transferCount !== b.transferCount) return a.transferCount - b.transferCount;
    return a.walkTime - b.walkTime;
  });
  const byFewest = [...candidates].sort((a, b) => {
    if (a.transferCount !== b.transferCount) return a.transferCount - b.transferCount;
    if (a.journeyMinutes !== b.journeyMinutes) return a.journeyMinutes - b.journeyMinutes;
    return a.walkTime - b.walkTime;
  });
  const fastest = byFastest[0];
  const fewestTransfers = byFewest[0];
  const featured = [];
  const used = new Set();
  [fastest, fewestTransfers, ...byFastest].forEach((candidate) => {
    if (!candidate || used.has(candidate.id)) return;
    used.add(candidate.id);
    featured.push(candidate);
  });

  return tagRoutePicks({
    fetchedAt: new Date().toISOString(),
    recommendedId: fastest.id,
    recommendation: fastest,
    picks: {
      fastestId: fastest.id,
      fewestTransfersId: fewestTransfers.id,
      sameBest: fastest.id === fewestTransfers.id,
      fastest,
      fewestTransfers
    },
    candidates: featured.slice(0, 5),
    mode: "overview_browser_fallback"
  });
}
