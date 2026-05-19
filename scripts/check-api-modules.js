[
  "../api/_public-api-guard",
  "../api/_index-store",
  "../api/_mapping-index",
  "../api/routes",
  "../api/stations",
  "../api/bus-positions",
  "../api/index/status",
  "../api/index/collect",
  "../api/telemetry",
  "../api/config"
].forEach((modulePath) => require(modulePath));

console.log("api require ok");
