function chooseRecommendation(candidates, priority) {
  return [...candidates].sort((a, b) => {
    if (a.scoreValue !== b.scoreValue) return a.scoreValue - b.scoreValue;
    if (a.totalTime !== b.totalTime) return a.totalTime - b.totalTime;
    if (a.transferCount !== b.transferCount) return a.transferCount - b.transferCount;
    if (priority === "best_eta" && a.initialWalkTime !== b.initialWalkTime) return a.initialWalkTime - b.initialWalkTime;
    return 0;
  });
}

function getComparableMinutes(candidate) {
  const journey = Number(candidate?.journeyMinutes);
  if (Number.isFinite(journey) && journey > 0) return journey;
  const score = Number(candidate?.scoreValue);
  if (Number.isFinite(score) && score > 0) return score;
  return Number(candidate?.totalTime || 0);
}

function chooseFastest(candidates) {
  return [...candidates].sort((a, b) => {
    const aMinutes = getComparableMinutes(a);
    const bMinutes = getComparableMinutes(b);
    if (aMinutes !== bMinutes) return aMinutes - bMinutes;
    if (a.transferCount !== b.transferCount) return a.transferCount - b.transferCount;
    return a.walkTime - b.walkTime;
  });
}

function chooseFewestTransfers(candidates) {
  return [...candidates].sort((a, b) => {
    if (a.transferCount !== b.transferCount) return a.transferCount - b.transferCount;
    const aMinutes = getComparableMinutes(a);
    const bMinutes = getComparableMinutes(b);
    if (aMinutes !== bMinutes) return aMinutes - bMinutes;
    return a.walkTime - b.walkTime;
  });
}

function candidateKey(candidate) {
  return [
    candidate.routeNo || candidate.firstTransitLabel || candidate.mode || "",
    candidate.boardingStopName || "",
    candidate.alightingStopName || "",
    candidate.transferCount,
    candidate.totalTime
  ].join("|");
}

function deduplicateCandidates(sorted) {
  const seen = new Set();
  return sorted.filter((candidate) => {
    const key = candidateKey(candidate);
    if (!key) return true;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

module.exports = {
  chooseRecommendation,
  chooseFastest,
  chooseFewestTransfers,
  getComparableMinutes,
  candidateKey,
  deduplicateCandidates
};
