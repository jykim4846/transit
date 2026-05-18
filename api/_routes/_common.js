function toNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function formatMinutes(value) {
  const num = Number(value || 0);
  return `${num}분`;
}

function formatTransferCount(value) {
  return `${Number(value || 0)}회`;
}

function normalizeLanes(subPath) {
  return (subPath.lane || []).map((lane) => ({
    name: lane.name || "",
    busNo: lane.busNo || "",
    busID: lane.busID || lane.busId || null,
    busLocalBlID: lane.busLocalBlID || lane.routeID || lane.routeId || null,
    subwayCode: lane.subwayCode || null
  }));
}

function normalizeCoordPoint(x, y) {
  const lng = Number(x);
  const lat = Number(y);
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

function normalizeStopListPoints(subPath) {
  const rawStops = subPath.passStopList?.stations
    || subPath.passStopList?.station
    || subPath.passStopList
    || [];
  const stops = Array.isArray(rawStops) ? rawStops : [];
  return dedupePathPoints([
    normalizeCoordPoint(subPath.startX, subPath.startY),
    ...stops.map((stop) => normalizeCoordPoint(stop.x ?? stop.lng, stop.y ?? stop.lat)),
    normalizeCoordPoint(subPath.endX, subPath.endY)
  ]);
}

function normalizeSegment(subPath) {
  const minutes = Number(subPath.sectionTime || 0);
  const start = subPath.startName || "";
  const end = subPath.endName || "";
  const pathPoints = normalizeStopListPoints(subPath);

  if (subPath.trafficType === 3) {
    return {
      type: "walk",
      kind: "도보",
      text: `${start || "이동"} → ${end || "연결"}`
        + (minutes ? ` · 도보 ${minutes}분` : ""),
      time: formatMinutes(minutes),
      minutes,
      start,
      end,
      pathPoints,
      label: `도보 ${minutes}분`
    };
  }

  if (subPath.trafficType === 2) {
    const lane = normalizeLanes(subPath)[0] || {};
    return {
      type: "bus",
      kind: "버스",
      text: `${lane.busNo || "버스"} · ${start} → ${end}`,
      time: formatMinutes(minutes),
      minutes,
      start,
      end,
      pathPoints,
      label: lane.busNo || "버스"
    };
  }

  const lane = normalizeLanes(subPath)[0] || {};
  return {
    type: "subway",
    kind: "지하철",
    text: `${lane.name || "지하철"} · ${start} → ${end}`,
    time: formatMinutes(minutes),
    minutes,
    start,
    end,
    pathPoints,
    label: lane.name || "지하철"
  };
}

function getFirstTransit(subPaths) {
  return subPaths.find((segment) => segment.trafficType === 1 || segment.trafficType === 2) || null;
}

function getInitialWalkTime(subPaths, firstTransitIndex) {
  if (firstTransitIndex <= 0) return 0;
  return subPaths.slice(0, firstTransitIndex)
    .filter((segment) => segment.trafficType === 3)
    .reduce((sum, segment) => sum + Number(segment.sectionTime || 0), 0);
}

function summarizeSteps(subPaths) {
  return subPaths
    .filter((segment) => segment.trafficType === 1 || segment.trafficType === 2 || (segment.trafficType === 3 && Number(segment.sectionTime) > 0))
    .map((segment) => normalizeSegment(segment))
    .slice(0, 6);
}

function getWalkTime(subPaths) {
  return subPaths
    .filter((segment) => segment.trafficType === 3)
    .reduce((sum, segment) => sum + Number(segment.sectionTime || 0), 0);
}

function getPathSectionTime(subPaths) {
  return subPaths.reduce((sum, segment) => sum + Number(segment.sectionTime || 0), 0);
}

function inferTransferCount(info) {
  const rides = Number(info.busTransitCount || 0) + Number(info.subwayTransitCount || 0);
  return Math.max(0, rides - 1);
}

module.exports = {
  toNumber,
  formatMinutes,
  formatTransferCount,
  normalizeLanes,
  normalizeCoordPoint,
  dedupePathPoints,
  normalizeStopListPoints,
  normalizeSegment,
  getFirstTransit,
  getInitialWalkTime,
  summarizeSteps,
  getWalkTime,
  getPathSectionTime,
  inferTransferCount
};
