const { sendJson } = require("./_odsay");
const { guardPublicApi } = require("./_public-api-guard");
const { isAuthorized } = require("./_auth");
const { recordTelemetry, getTelemetrySnapshot } = require("./_telemetry-store");

async function readBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string") return JSON.parse(req.body || "{}");
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
      if (raw.length > 4096) {
        reject(new Error("payload too large"));
        req.destroy();
      }
    });
    req.on("end", () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch (error) {
        reject(error);
      }
    });
    req.on("error", reject);
  });
}

module.exports = async function handler(req, res) {
  if (req.method === "GET") {
    if (!isAuthorized(req)) return sendJson(res, 401, { error: "Unauthorized" });
    return sendJson(res, 200, getTelemetrySnapshot());
  }

  if (req.method !== "POST") {
    return sendJson(res, 405, { error: "Method Not Allowed" });
  }

  const blocked = guardPublicApi(req, res, sendJson, {
    scope: "telemetry",
    limit: Number(process.env.TELEMETRY_RATE_LIMIT_PER_MINUTE || 120),
    windowMs: 60 * 1000
  });
  if (blocked) return blocked;

  try {
    const payload = await readBody(req);
    const result = recordTelemetry(payload);
    if (!result.accepted) return sendJson(res, 400, { error: result.reason });
    return sendJson(res, 202, { ok: true });
  } catch {
    return sendJson(res, 400, { error: "Invalid telemetry payload" });
  }
};
