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

async function writeJsonManyFs(entries) {
  await Promise.all(entries.map(({ filePath, value }) => writeJsonFs(filePath, value)));
  return entries.map((entry) => entry.value);
}

async function writeJsonManyGithub(entries) {
  return writeJsonManyGithubAttempt(entries, 0);
}

async function writeJsonManyGithubAttempt(entries, attempt) {
  const github = getGithubConfig();
  const refUrl = `https://api.github.com/repos/${normalizeRepoPath(github.repo)}/git/ref/heads/${encodeURIComponent(github.branch)}`;
  const headers = {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${github.token}`,
    "User-Agent": "transit-app-index/1.0",
    "Content-Type": "application/json"
  };

  const refResponse = await fetch(refUrl, { headers, cache: "no-store" });
  if (!refResponse.ok) {
    throw new Error(`GitHub ref 읽기 실패 (${refResponse.status})`);
  }
  const ref = await refResponse.json();
  const parentSha = ref.object?.sha;
  if (!parentSha) {
    throw new Error("GitHub ref 응답에 parent sha가 없습니다");
  }

  const commitResponse = await fetch(`https://api.github.com/repos/${normalizeRepoPath(github.repo)}/git/commits/${parentSha}`, {
    headers,
    cache: "no-store"
  });
  if (!commitResponse.ok) {
    throw new Error(`GitHub commit 읽기 실패 (${commitResponse.status})`);
  }
  const parentCommit = await commitResponse.json();
  const baseTreeSha = parentCommit.tree?.sha;
  if (!baseTreeSha) {
    throw new Error("GitHub commit 응답에 tree sha가 없습니다");
  }

  const tree = entries.map(({ filePath, value }) => ({
    path: withPrefix(filePath),
    mode: "100644",
    type: "blob",
    content: JSON.stringify(value, null, 2)
  }));

  const treeResponse = await fetch(`https://api.github.com/repos/${normalizeRepoPath(github.repo)}/git/trees`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      base_tree: baseTreeSha,
      tree
    })
  });
  if (!treeResponse.ok) {
    const text = await treeResponse.text();
    throw new Error(`GitHub tree 생성 실패 (${treeResponse.status}): ${text}`);
  }
  const nextTree = await treeResponse.json();

  const commitCreateResponse = await fetch(`https://api.github.com/repos/${normalizeRepoPath(github.repo)}/git/commits`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      message: `Update runtime index: batch ${entries.length} files`,
      tree: nextTree.sha,
      parents: [parentSha]
    })
  });
  if (!commitCreateResponse.ok) {
    const text = await commitCreateResponse.text();
    throw new Error(`GitHub batch commit 생성 실패 (${commitCreateResponse.status}): ${text}`);
  }
  const nextCommit = await commitCreateResponse.json();

  const updateRefResponse = await fetch(refUrl, {
    method: "PATCH",
    headers,
    body: JSON.stringify({
      sha: nextCommit.sha,
      force: false
    })
  });
  if (!updateRefResponse.ok) {
    const text = await updateRefResponse.text();
    if ((updateRefResponse.status === 409 || updateRefResponse.status === 422) && attempt < 2) {
      await new Promise((resolve) => setTimeout(resolve, 150 * (attempt + 1)));
      return writeJsonManyGithubAttempt(entries, attempt + 1);
    }
    throw new Error(`GitHub ref 업데이트 실패 (${updateRefResponse.status}): ${text}`);
  }

  return entries.map((entry) => entry.value);
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

async function writeJsonMany(entries) {
  const normalized = entries
    .filter((entry) => entry && entry.filePath)
    .map((entry) => ({ filePath: entry.filePath, value: entry.value }));
  if (!normalized.length) return [];

  const results = getGithubConfig()
    ? await writeJsonManyGithub(normalized)
    : await writeJsonManyFs(normalized);
  normalized.forEach(({ filePath, value }) => memCacheSet(filePath, value));
  return results;
}

async function updateJson(filePath, fallbackValue, updater) {
  const current = await readJson(filePath, fallbackValue);
  const next = await updater(current ?? fallbackValue);
  await writeJson(filePath, next);
  return next;
}

function inflightCache() {
  const map = new Map();
  return {
    async getOrStart(key, factory) {
      if (map.has(key)) return map.get(key).promise;
      const promise = Promise.resolve().then(factory).finally(() => {
        const entry = map.get(key);
        if (entry && entry.promise === promise) map.delete(key);
      });
      map.set(key, { promise });
      return promise;
    },
    size() { return map.size; }
  };
}

module.exports = {
  getDriverName,
  readJson,
  writeJson,
  writeJsonMany,
  updateJson,
  inflightCache
};
