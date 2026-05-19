const STARTED_AT = new Date().toISOString();
const MAX_EVENTS = 20000;
const MAX_DIMENSION_LENGTH = 80;

const ALLOWED_EVENTS = new Set([
  "permission_state",
  "boarding_start",
  "boarding_resume",
  "boarding_end",
  "bus_poll_success",
  "bus_poll_failure",
  "live_map_unstable",
  "live_map_retry",
  "route_refresh_success",
  "route_refresh_failure",
  "route_refresh_skipped"
]);

const ALLOWED_PROPS = new Set([
  "state",
  "reason",
  "status",
  "source",
  "count"
]);

const counters = new Map();
let totalEvents = 0;
let droppedEvents = 0;

function dayKey(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

function cleanEventName(value) {
  const event = String(value || "").trim();
  return ALLOWED_EVENTS.has(event) ? event : null;
}

function cleanPropValue(value) {
  if (value == null) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "boolean") return value;
  return String(value).slice(0, MAX_DIMENSION_LENGTH);
}

function sanitizeProps(input) {
  const props = {};
  Object.entries(input || {}).forEach(([key, value]) => {
    if (!ALLOWED_PROPS.has(key)) return;
    const cleaned = cleanPropValue(value);
    if (cleaned == null) return;
    props[key] = cleaned;
  });
  return props;
}

function counterKey(day, event, props) {
  return JSON.stringify({ day, event, props });
}

function recordTelemetry(input = {}) {
  const event = cleanEventName(input.event);
  if (!event) {
    droppedEvents += 1;
    return { accepted: false, reason: "invalid_event" };
  }

  const props = sanitizeProps(input.props);
  const day = dayKey();
  const key = counterKey(day, event, props);
  const current = counters.get(key) || { day, event, props, count: 0 };
  current.count += 1;
  counters.set(key, current);
  totalEvents += 1;

  if (counters.size > MAX_EVENTS) {
    const oldest = counters.keys().next().value;
    counters.delete(oldest);
    droppedEvents += 1;
  }

  console.log(JSON.stringify({
    msg: "transit_telemetry",
    day,
    event,
    props
  }));

  return { accepted: true, event, props };
}

function getTelemetrySnapshot() {
  return {
    startedAt: STARTED_AT,
    totalEvents,
    droppedEvents,
    counters: Array.from(counters.values()).sort((a, b) => {
      if (a.day !== b.day) return a.day < b.day ? 1 : -1;
      if (a.event !== b.event) return a.event.localeCompare(b.event);
      return JSON.stringify(a.props).localeCompare(JSON.stringify(b.props));
    })
  };
}

function resetTelemetryForTest() {
  counters.clear();
  totalEvents = 0;
  droppedEvents = 0;
}

module.exports = {
  recordTelemetry,
  getTelemetrySnapshot,
  _test: {
    resetTelemetryForTest,
    sanitizeProps,
    cleanEventName
  }
};
