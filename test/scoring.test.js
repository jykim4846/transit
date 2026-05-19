const test = require("node:test");
const assert = require("node:assert/strict");

const {
  chooseRecommendation,
  chooseFastest,
  chooseFewestTransfers,
  deduplicateCandidates
} = require("../api/_routes/scoring");

test("chooseRecommendation sorts by score, time, transfers, then walk for best_eta", () => {
  const candidates = [
    { id: "slow", scoreValue: 20, totalTime: 20, transferCount: 0, initialWalkTime: 1 },
    { id: "walkier", scoreValue: 12, totalTime: 10, transferCount: 0, initialWalkTime: 8 },
    { id: "winner", scoreValue: 12, totalTime: 10, transferCount: 0, initialWalkTime: 3 },
    { id: "transfer", scoreValue: 12, totalTime: 10, transferCount: 1, initialWalkTime: 1 }
  ];

  assert.deepEqual(
    chooseRecommendation(candidates, "best_eta").map((candidate) => candidate.id),
    ["winner", "walkier", "transfer", "slow"]
  );
});

test("chooseFastest and chooseFewestTransfers use different primary criteria", () => {
  const candidates = [
    { id: "fast-transfer", journeyMinutes: 20, scoreValue: 20, totalTime: 20, transferCount: 2, walkTime: 3 },
    { id: "slow-direct", journeyMinutes: 25, scoreValue: 25, totalTime: 25, transferCount: 0, walkTime: 8 }
  ];

  assert.equal(chooseFastest(candidates)[0].id, "fast-transfer");
  assert.equal(chooseFewestTransfers(candidates)[0].id, "slow-direct");
});

test("deduplicateCandidates keeps only one candidate per route and stop pair", () => {
  const candidates = [
    { id: "a", routeNo: "7016", boardingStopName: "A", alightingStopName: "B", transferCount: 0, totalTime: 30 },
    { id: "b", routeNo: "7016", boardingStopName: "A", alightingStopName: "B", transferCount: 0, totalTime: 30 },
    { id: "c", routeNo: "7016", boardingStopName: "A", alightingStopName: "C", transferCount: 0, totalTime: 30 }
  ];

  assert.deepEqual(deduplicateCandidates(candidates).map((candidate) => candidate.id), ["a", "c"]);
});
