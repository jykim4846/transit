const sentOnce = new Set();

function shouldSkipTelemetry() {
  return Boolean(window.__TRANSIT_E2E_FAST_POLL);
}

function cleanProps(props = {}) {
  const allowed = {};
  ["state", "reason", "status", "source", "count"].forEach((key) => {
    const value = props[key];
    if (value == null) return;
    allowed[key] = typeof value === "number" || typeof value === "boolean"
      ? value
      : String(value).slice(0, 80);
  });
  return allowed;
}

export function recordTelemetry(event, props = {}, options = {}) {
  if (shouldSkipTelemetry() || !event) return;
  const payload = {
    event,
    props: cleanProps(props)
  };
  const onceKey = options.onceKey ? `${event}:${options.onceKey}:${JSON.stringify(payload.props)}` : null;
  if (onceKey) {
    if (sentOnce.has(onceKey)) return;
    sentOnce.add(onceKey);
  }

  const body = JSON.stringify(payload);
  if (navigator.sendBeacon) {
    const blob = new Blob([body], { type: "application/json" });
    if (navigator.sendBeacon("/api/telemetry", blob)) return;
  }

  fetch("/api/telemetry", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
    keepalive: true,
    cache: "no-store"
  }).catch(() => {});
}
