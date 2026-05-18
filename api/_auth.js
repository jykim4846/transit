const crypto = require("crypto");

function timingSafeEquals(a, b) {
  const ab = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

// Fail-closed admin auth.
// - Allows Vercel cron-triggered calls via x-vercel-cron header
// - Otherwise requires INDEX_ADMIN_KEY (or legacy CRON_SECRET) configured AND matched
function isAuthorized(req) {
  if (req.headers["x-vercel-cron"] === "1") return true;

  const secret = process.env.INDEX_ADMIN_KEY || process.env.CRON_SECRET || "";
  if (!secret) return false;

  const auth = String(req.headers.authorization || "");
  const bearer = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  const provided = bearer || String((req.query && req.query.secret) || "");
  if (!provided) return false;

  return timingSafeEquals(provided, secret);
}

module.exports = { isAuthorized };
