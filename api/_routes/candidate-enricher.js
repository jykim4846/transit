const { resolveBusMapping, getSeoulBusArrival, getBusApproachPreview, decorateVehiclesWithArrival } = require("../_mapping-index");
const { getSeoulBusApiKey } = require("../_seoul-bus");
const { formatMinutes } = require("./_common");

async function maybeEnrichBusCandidate(candidate, fromX, fromY, toX, toY) {
  if (!candidate || candidate.mode !== "bus" || !candidate.routeNo || !candidate.boardingStopName || !candidate.alightingStopName) {
    return candidate;
  }

  if (!getSeoulBusApiKey()) {
    return candidate;
  }

  try {
    const mapping = await resolveBusMapping(candidate, fromX, fromY, toX, toY);
    if (!mapping) return candidate;
    const arrivalInfo = await getSeoulBusArrival(mapping, candidate.initialWalkTime);
    const busApproachPreview = await getBusApproachPreview(mapping).catch(() => null);
    if (arrivalInfo == null) {
      // No catchable arrival (e.g. nearest bus already too close to make on foot, or
      // empty realtime feed). Still attach the live preview so the UI can render
      // the approaching buses on the map — wait time falls back to interval estimate.
      if (busApproachPreview) {
        return { ...candidate, busApproachPreview };
      }
      return candidate;
    }
    const arrivalSecondsSorted = arrivalInfo.arrivalSecondsSorted || [];
    const arrivalAtMsSorted = arrivalInfo.arrivalAtMsSorted || [];
    const walkSeconds = arrivalInfo.walkSeconds || 0;
    const fetchedAtMs = arrivalInfo.fetchedAtMs || Date.now();

    decorateVehiclesWithArrival(busApproachPreview, arrivalInfo);

    const effectiveWait = arrivalInfo.waitMin;
    const totalTime = candidate.totalTime;
    const nextScore = totalTime + effectiveWait + Number(candidate.transferWaitMin || 0);

    const departAtMs = fetchedAtMs;
    const nextArriveAtMs = departAtMs + nextScore * 60 * 1000;

    const catchableArrivalsMs = arrivalAtMsSorted.filter((ms) => ms - departAtMs >= walkSeconds * 1000);
    const primaryArrivalAtMs = catchableArrivalsMs[0];
    const fallbackArrivalAtMs = catchableArrivalsMs[1];
    const fallbackPlan = (primaryArrivalAtMs != null && fallbackArrivalAtMs != null) ? {
      nextVehicleArriveAt: new Date(fallbackArrivalAtMs).toISOString(),
      extraWaitMin: Math.max(1, Math.ceil((fallbackArrivalAtMs - primaryArrivalAtMs) / 60000)),
      arriveAt: new Date(nextArriveAtMs + (fallbackArrivalAtMs - primaryArrivalAtMs)).toISOString(),
      catchDeadline: new Date(primaryArrivalAtMs - walkSeconds * 1000).toISOString()
    } : null;

    const baseNote = arrivalInfo.skippedCount > 0
      ? `정류장까지 도보 ${candidate.initialWalkTime}분이 걸려 먼저 오는 버스 ${arrivalInfo.skippedCount}대를 놓치는 것으로 보고, 다음 도착 버스 기준 대기 ${effectiveWait}분을 반영했습니다.`
      : `서울시 도착정보 기준 현재 버스를 탈 수 있는 실제 대기 ${effectiveWait}분을 반영했습니다.`;
    return {
      ...candidate,
      firstWaitMin: effectiveWait,
      firstWaitText: formatMinutes(effectiveWait),
      firstWaitSource: "seoul_arrival",
      unavailableBusRealtime: false,
      busApproachPreview,
      scoreValue: nextScore,
      scoreDisplay: `${nextScore}분`,
      boardingStopName: mapping.stationName || candidate.boardingStopName,
      boardingApproachText: candidate.initialWalkTime > 0
        ? `도보 후 ${mapping.stationName || candidate.boardingStopName} 탑승`
        : `${mapping.stationName || candidate.boardingStopName} 탑승`,
      alightingStopName: mapping.alightingStationName || candidate.alightingStopName,
      departAt: new Date(departAtMs).toISOString(),
      arriveAt: new Date(nextArriveAtMs).toISOString(),
      journeyMinutes: nextScore,
      fallbackPlan,
      note: candidate.transferRiskText ? `${baseNote} ${candidate.transferRiskText}` : baseNote
    };
  } catch {
    return candidate;
  }
}

async function enrichCandidates(candidates, fromX, fromY, toX, toY) {
  return Promise.all(
    candidates.map((candidate) => maybeEnrichBusCandidate(candidate, fromX, fromY, toX, toY))
  );
}

module.exports = {
  maybeEnrichBusCandidate,
  enrichCandidates
};
