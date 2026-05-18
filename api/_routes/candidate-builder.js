const {
  toNumber,
  formatMinutes,
  formatTransferCount,
  normalizeLanes,
  normalizeSegment,
  getInitialWalkTime,
  summarizeSteps,
  getWalkTime,
  getPathSectionTime,
  inferTransferCount
} = require("./_common");

function getEstimatedWait(priority, firstTransit, liveWait) {
  if (priority !== "best_eta") {
    return { minutes: null, source: "not_applicable" };
  }

  if (!firstTransit) {
    return { minutes: 0, source: "none" };
  }

  if (firstTransit.trafficType === 2) {
    if (liveWait != null) {
      return { minutes: liveWait, source: "seoul_arrival" };
    }
    const busInterval = toNumber(firstTransit.intervalTime) || 0;
    if (busInterval > 0) {
      return { minutes: Math.max(1, Math.round(busInterval / 2)), source: "interval" };
    }
    return { minutes: null, source: "seoul_unavailable" };
  }

  const interval = toNumber(firstTransit.intervalTime) || 0;
  if (interval > 0) {
    return { minutes: Math.max(1, Math.round(interval / 2)), source: "interval" };
  }

  return { minutes: null, source: "none" };
}

function isUnavailableBusForBestEta(firstTransit, wait) {
  return firstTransit?.trafficType === 2 && wait.source === "seoul_unavailable";
}

function getBoardingStopName(firstTransit) {
  if (!firstTransit) return null;
  return firstTransit.startName || firstTransit.startStationName || null;
}

function getLastTransit(subPaths) {
  for (let index = subPaths.length - 1; index >= 0; index -= 1) {
    const segment = subPaths[index];
    if (segment.trafficType === 1 || segment.trafficType === 2) {
      return segment;
    }
  }
  return null;
}

function getAlightingStopName(lastTransit) {
  if (!lastTransit) return null;
  return lastTransit.endName || lastTransit.endStationName || null;
}

function getTransferTimingEstimate(subPaths, priority) {
  if (priority !== "best_eta") {
    return {
      transferWaitMin: 0,
      transferRiskLevel: "none",
      transferRiskText: null,
      tightestSlackMin: null
    };
  }

  const transitIndices = subPaths
    .map((segment, index) => ((segment.trafficType === 1 || segment.trafficType === 2) ? index : -1))
    .filter((index) => index >= 0);

  if (transitIndices.length <= 1) {
    return {
      transferWaitMin: 0,
      transferRiskLevel: "none",
      transferRiskText: null,
      tightestSlackMin: null
    };
  }

  let transferWaitMin = 0;
  let tightestSlackMin = null;

  transitIndices.slice(1).forEach((transitIndex) => {
    const segment = subPaths[transitIndex];
    const interval = toNumber(segment.intervalTime) || 0;
    if (interval <= 0) return;

    const elapsedTravelMin = subPaths
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
      transferRiskText: null,
      tightestSlackMin: null
    };
  }

  let transferRiskLevel = "low";
  let transferRiskText = null;

  if (tightestSlackMin <= 1) {
    transferRiskLevel = "high";
    transferRiskText = tightestSlackMin < 0
      ? "환승 여유가 부족해 실제로는 다음 차를 놓칠 가능성이 큽니다."
      : `환승 여유가 ${tightestSlackMin}분 수준이라 지연 시 놓칠 가능성이 큽니다.`;
  } else if (tightestSlackMin <= 4) {
    transferRiskLevel = "medium";
    transferRiskText = `환승 여유가 ${tightestSlackMin}분 정도라 조금만 지연돼도 놓칠 수 있습니다.`;
  }

  return {
    transferWaitMin,
    transferRiskLevel,
    transferRiskText,
    tightestSlackMin
  };
}

function buildCandidate(path, index, priority, liveWait) {
  const info = path.info || {};
  const subPaths = path.subPath || [];
  const firstTransitIndex = subPaths.findIndex((segment) => segment.trafficType === 1 || segment.trafficType === 2);
  const firstTransit = firstTransitIndex >= 0 ? subPaths[firstTransitIndex] : null;
  const wait = getEstimatedWait(priority, firstTransit, liveWait);
  const initialWalkTime = getInitialWalkTime(subPaths, firstTransitIndex);
  const effectiveFirstWaitMin = wait.minutes != null ? Math.max(0, wait.minutes - initialWalkTime) : null;
  const transferTiming = getTransferTimingEstimate(subPaths, priority);
  const totalTime = getPathSectionTime(subPaths);
  const departAtMs = Date.now();
  const journeyMinutes = totalTime + (effectiveFirstWaitMin || 0) + (transferTiming.transferWaitMin || 0);
  const arriveAtMs = departAtMs + journeyMinutes * 60 * 1000;
  const transferCount = inferTransferCount(info);
  const walkTime = getWalkTime(subPaths);
  const summarySteps = summarizeSteps(subPaths);
  const boardingStopName = getBoardingStopName(firstTransit);
  const alightingStopName = getAlightingStopName(getLastTransit(subPaths));
  const unavailableBusRealtime = isUnavailableBusForBestEta(firstTransit, wait);

  let scoreValue;
  let scoreDisplay;
  let note;

  if (priority === "fewest_transfers") {
    scoreValue = transferCount * 1000 + totalTime;
    scoreDisplay = `${transferCount}회`;
    note = transferCount === 0
      ? "환승 없이 가는 후보입니다."
      : `환승 ${transferCount}회 중 가장 단순한 후보입니다.`;
  } else if (priority === "best_eta") {
    if (unavailableBusRealtime) {
      scoreValue = totalTime + transferTiming.transferWaitMin;
      scoreDisplay = `${scoreValue}분`;
      note = transferTiming.transferWaitMin > 0
        ? `첫 탑승 실시간은 없지만 환승 대기 추정 ${transferTiming.transferWaitMin}분을 반영했습니다.`
        : "서울시 버스 실시간 도착정보를 확인하지 못해 첫 탑승 대기 없이 비교했습니다.";
    } else {
      const totalWaitMin = (effectiveFirstWaitMin || 0) + transferTiming.transferWaitMin;
      scoreValue = totalTime + totalWaitMin;
      scoreDisplay = `${scoreValue}분`;
      note = totalWaitMin > 0
        ? `첫 탑승 대기 ${effectiveFirstWaitMin || 0}분과 환승 대기 추정 ${transferTiming.transferWaitMin}분을 합쳐 비교했습니다.`
        : "첫 탑승과 환승을 바로 연결할 수 있다고 보고 총 이동시간 기준으로 비교했습니다.";
    }
  } else {
    scoreValue = totalTime;
    scoreDisplay = `${totalTime}분`;
    note = "총 소요시간이 가장 짧은 후보를 우선합니다.";
  }

  const firstTransitLabel = firstTransit
    ? normalizeSegment(firstTransit).label
    : "도보";
  const firstLane = firstTransit ? (normalizeLanes(firstTransit)[0] || null) : null;
  const routeNo = firstTransit?.trafficType === 2 ? (firstLane?.busNo || null) : null;
  const mode = firstTransit?.trafficType === 2 ? "bus" : (firstTransit?.trafficType === 1 ? "subway" : "walk");
  const firstTransitStations = firstTransit?.passStopList?.stations || firstTransit?.passStopList?.station || [];
  const boardingStation = firstTransitStations[0] || null;
  const alightingStation = firstTransitStations[firstTransitStations.length - 1] || null;
  const boardingStationId = mode === "bus" && boardingStation?.localStationID ? String(boardingStation.localStationID) : null;
  const alightingStationId = mode === "bus" && alightingStation?.localStationID ? String(alightingStation.localStationID) : null;
  const busRouteId = mode === "bus" && firstLane?.busLocalBlID ? String(firstLane.busLocalBlID) : null;

  return {
    id: `path-${index}`,
    scoreValue,
    scoreDisplay,
    totalTime,
    totalTimeText: formatMinutes(totalTime),
    transferCount,
    transferCountText: formatTransferCount(transferCount),
    walkTime,
    walkTimeText: formatMinutes(walkTime),
    firstWaitMin: effectiveFirstWaitMin,
    firstWaitText: priority !== "best_eta"
      ? "기준 아님"
      : (unavailableBusRealtime ? "실시간 미반영" : (effectiveFirstWaitMin != null ? formatMinutes(effectiveFirstWaitMin) : "정보 없음")),
    firstWaitSource: wait.source,
    unavailableBusRealtime,
    transferWaitMin: transferTiming.transferWaitMin,
    transferWaitText: priority === "best_eta" ? formatMinutes(transferTiming.transferWaitMin) : "기준 아님",
    transferRiskLevel: transferTiming.transferRiskLevel,
    transferRiskText: transferTiming.transferRiskText,
    mode,
    routeNo,
    busRouteId,
    boardingStationId,
    alightingStationId,
    firstTransitLabel,
    boardingStopName,
    boardingApproachText: boardingStopName
      ? (initialWalkTime > 0 ? `도보 후 ${boardingStopName} 탑승` : `${boardingStopName} 탑승`)
      : null,
    alightingStopName,
    initialWalkTime,
    summarySteps,
    note,
    departAt: new Date(departAtMs).toISOString(),
    arriveAt: new Date(arriveAtMs).toISOString(),
    journeyMinutes,
    segments: subPaths.map(normalizeSegment)
  };
}

module.exports = {
  buildCandidate,
  getEstimatedWait,
  isUnavailableBusForBestEta,
  getBoardingStopName,
  getLastTransit,
  getAlightingStopName,
  getTransferTimingEstimate
};
