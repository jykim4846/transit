// Local dev server for transit-app.
// - Serves transit-app.html and static assets (icons, manifest)
// - Routes /api/<path> to api/<path>.js using the Vercel-style handler signature
// - Auto-loads .env from the project root
// Run: node dev-server.js   (defaults to http://localhost:3000)
const http = require("http");
const fs = require("fs");
const path = require("path");
const { URL } = require("url");

const ROOT = __dirname;
const PORT = Number(process.env.PORT) || 3000;

function loadEnv() {
  const envPath = path.join(ROOT, ".env");
  if (!fs.existsSync(envPath)) return;
  fs.readFileSync(envPath, "utf8").split(/\r?\n/).forEach((line) => {
    if (!line || line.startsWith("#")) return;
    const eq = line.indexOf("=");
    if (eq <= 0) return;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  });
}

loadEnv();

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webmanifest": "application/manifest+json"
};

function adaptResponse(res) {
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (payload) => {
    if (!res.getHeader("Content-Type")) res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(JSON.stringify(payload));
    return res;
  };
  return res;
}

function adaptRequest(req, parsedUrl) {
  const query = {};
  for (const [k, v] of parsedUrl.searchParams) query[k] = v;
  req.query = query;
  return req;
}

function findHandlerFile(pathname) {
  // Strip leading "/api/" then resolve under api/. Reject parent traversal.
  const rel = pathname.replace(/^\/api\//, "").replace(/\/+$/, "");
  if (!rel || rel.includes("..")) return null;
  const direct = path.join(ROOT, "api", `${rel}.js`);
  if (fs.existsSync(direct)) return direct;
  const indexed = path.join(ROOT, "api", rel, "index.js");
  if (fs.existsSync(indexed)) return indexed;
  return null;
}

async function handleApi(req, res, parsedUrl) {
  const handlerFile = findHandlerFile(parsedUrl.pathname);
  if (!handlerFile) {
    res.statusCode = 404;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(JSON.stringify({ error: `No handler for ${parsedUrl.pathname}` }));
    return;
  }

  // Clear require cache so handler edits hot-reload on next request.
  Object.keys(require.cache).forEach((key) => {
    if (key.startsWith(path.join(ROOT, "api"))) delete require.cache[key];
  });

  let handler;
  try {
    handler = require(handlerFile);
  } catch (error) {
    res.statusCode = 500;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(JSON.stringify({ error: `handler load failed: ${error.message}`, stack: error.stack }));
    return;
  }

  adaptRequest(req, parsedUrl);
  adaptResponse(res);

  try {
    await handler(req, res);
  } catch (error) {
    if (!res.headersSent) {
      res.statusCode = 500;
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.end(JSON.stringify({ error: error.message || "handler crashed" }));
    } else {
      res.end();
    }
    console.error(`[api] ${parsedUrl.pathname} crashed:`, error.message);
  }
}

function serveStatic(req, res, parsedUrl) {
  let urlPath = decodeURIComponent(parsedUrl.pathname);
  if (urlPath === "/") urlPath = "/transit-app.html";
  if (urlPath.includes("..")) {
    res.statusCode = 400;
    return res.end("bad path");
  }

  const filePath = path.join(ROOT, urlPath);
  fs.stat(filePath, (err, stat) => {
    if (err || !stat.isFile()) {
      res.statusCode = 404;
      return res.end("not found");
    }
    const ext = path.extname(filePath).toLowerCase();
    res.setHeader("Content-Type", MIME[ext] || "application/octet-stream");
    res.setHeader("Cache-Control", "no-store");
    fs.createReadStream(filePath).pipe(res);
  });
}

const server = http.createServer(async (req, res) => {
  const parsedUrl = new URL(req.url, `http://localhost:${PORT}`);
  const t0 = Date.now();
  res.on("finish", () => {
    console.log(`${req.method} ${parsedUrl.pathname}${parsedUrl.search} → ${res.statusCode} (${Date.now() - t0}ms)`);
  });

  if (parsedUrl.pathname.startsWith("/api/")) {
    return handleApi(req, res, parsedUrl);
  }
  serveStatic(req, res, parsedUrl);
});

server.listen(PORT, () => {
  console.log(`transit-app dev server on http://localhost:${PORT}`);
  console.log(`  ODSAY_API_KEY: ${process.env.ODSAY_API_KEY ? "set" : "MISSING"}`);
  console.log(`  SEOUL_BUS_API_KEY: ${process.env.SEOUL_BUS_API_KEY ? "set" : "MISSING"}`);
  console.log(`  VITE_KAKAO_MAP_KEY: ${process.env.VITE_KAKAO_MAP_KEY ? "set" : "MISSING"}`);
  console.log(`  INDEX_GITHUB_TOKEN: ${process.env.INDEX_GITHUB_TOKEN ? "set (writes to GitHub)" : "unset (uses .runtime-index/)"}`);
});
