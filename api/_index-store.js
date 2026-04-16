const fs = require("fs/promises");
const path = require("path");

const LOCAL_ROOT = path.join(process.cwd(), ".runtime-index");

const memCache = new Map();
const MEM_CACHE_TTL_MS = 5 * 60 * 1000;
const MEM_CACHE_MAX = 200;

function memCacheGet(key) {
  const entry = memCache.get(key);
  if (!entry) return undefined;
  if (Date.now() > entry.expiresAt) {
    memCache.delete(key);
    return undefined;
  }
  return entry.value;
}

function memCacheSet(key, value) {
  if (memCache.size >= MEM_CACHE_MAX) {
    const now = Date.now();
    for (const [k, v] of memCache) {
      if (now > v.expiresAt) memCache.delete(k);
    }
    if (memCache.size >= MEM_CACHE_MAX) {
      const first = memCache.keys().next().value;
      memCache.delete(first);
    }
  }
  memCache.set(key, { value, expiresAt: Date.now() + MEM_CACHE_TTL_MS });
}

function normalizeRepoPath(repoPath) {
  return repoPath.split("/").map(encodeURIComponent).join("/");
}

function getGithubConfig() {
  const token = process.env.INDEX_GITHUB_TOKEN;
  const repo = process.env.INDEX_GITHUB_REPO;
  if (!token || !repo) return null;
  return {
    token,
    repo,
    branch: process.env.INDEX_GITHUB_BRANCH || "main",
    prefix: (process.env.INDEX_GITHUB_PREFIX || "runtime-index").replace(/^\/+|\/+$/g, "")
  };
}

function getDriverName() {
  return getGithubConfig() ? "github" : "filesystem";
}

function withPrefix(filePath) {
  const github = getGithubConfig();
  if (github?.prefix) {
    return `${github.prefix}/${filePath}`.replace(/\/+/g, "/");
  }
  return filePath;
}

async function readJsonFs(filePath, fallback = null) {
  try {
    const fullPath = path.join(LOCAL_ROOT, filePath);
    const raw = await fs.readFile(fullPath, "utf8");
    return JSON.parse(raw);
  } catch (error) {
    if (error.code === "ENOENT") return fallback;
    throw error;
  }
}

async function writeJsonFs(filePath, value) {
  const fullPath = path.join(LOCAL_ROOT, filePath);
  await fs.mkdir(path.dirname(fullPath), { recursive: true });
  await fs.writeFile(fullPath, JSON.stringify(value, null, 2));
  return value;
}

async function readJsonGithub(filePath, fallback = null) {
  const github = getGithubConfig();
  const pathname = withPrefix(filePath);
  const url = `https://api.github.com/repos/${normalizeRepoPath(github.repo)}/contents/${pathname}?ref=${encodeURIComponent(github.branch)}`;
  const response = await fetch(url, {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${github.token}`,
      "User-Agent": "transit-app-index/1.0"
    },
    cache: "no-store"
  });

  if (response.status === 404) return fallback;
  if (!response.ok) {
    throw new Error(`GitHub 인덱스 읽기 실패 (${response.status})`);
  }

  const payload = await response.json();
  const content = Buffer.from(payload.content || "", "base64").toString("utf8");
  return JSON.parse(content);
}

async function writeJsonGithub(filePath, value) {
  const github = getGithubConfig();
  const pathname = withPrefix(filePath);
  const url = `https://api.github.com/repos/${normalizeRepoPath(github.repo)}/contents/${pathname}`;

  let sha = undefined;
  const current = await fetch(`${url}?ref=${encodeURIComponent(github.branch)}`, {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${github.token}`,
      "User-Agent": "transit-app-index/1.0"
    },
    cache: "no-store"
  });

  if (current.ok) {
    const payload = await current.json();
    sha = payload.sha;
  }

  const response = await fetch(url, {
    method: "PUT",
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${github.token}`,
      "User-Agent": "transit-app-index/1.0",
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      message: `Update runtime index: ${pathname}`,
      branch: github.branch,
      sha,
      content: Buffer.from(JSON.stringify(value, null, 2)).toString("base64")
    })
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`GitHub 인덱스 쓰기 실패 (${response.status}): ${text}`);
  }

  return value;
}

async function readJson(filePath, fallback = null) {
  const mem = memCacheGet(filePath);
  if (mem !== undefined) return mem;
  const result = getGithubConfig()
    ? await readJsonGithub(filePath, fallback)
    : await readJsonFs(filePath, fallback);
  if (result != null && result !== fallback) {
    memCacheSet(filePath, result);
  }
  return result;
}

async function writeJson(filePath, value) {
  const result = getGithubConfig()
    ? await writeJsonGithub(filePath, value)
    : await writeJsonFs(filePath, value);
  memCacheSet(filePath, result);
  return result;
}

async function updateJson(filePath, fallbackValue, updater) {
  const current = await readJson(filePath, fallbackValue);
  const next = await updater(current ?? fallbackValue);
  await writeJson(filePath, next);
  return next;
}

module.exports = {
  getDriverName,
  readJson,
  writeJson,
  updateJson
};
