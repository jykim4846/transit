# Runtime Index

`runtime-index/` is the durable Seoul bus mapping cache committed to the repo.
`.runtime-index/` is the local development cache and is ignored by git.

## Drivers

The app chooses the index driver at runtime:

- `INDEX_GITHUB_TOKEN` and `INDEX_GITHUB_REPO` set: read/write through GitHub.
- Missing GitHub config: read/write local files under `.runtime-index/`.

`INDEX_GITHUB_BRANCH` defaults to `main`.
`INDEX_GITHUB_PREFIX` defaults to `runtime-index`.

## Write Behavior

Normal request-time cache misses can still write individual files because they
are latency-sensitive and small.

The collector path batches writes with GitHub Git Data APIs:

1. Read the current branch ref.
2. Create one tree containing all changed JSON files.
3. Create one commit with message `Update runtime index: batch ...`.
4. Move the branch ref once.

This keeps a collector run to one Git commit instead of one commit per route or
stop file. Vercel skips these commits through `vercel.json` because the commit
message keeps the `Update runtime index:` prefix.

## Operational Notes

- `api/index/collect.js` is protected by `INDEX_ADMIN_KEY` or Vercel cron.
- Public route/search/live-position APIs are rate-limited in memory per server
  instance. Configure per-minute limits with:
  - `ROUTES_RATE_LIMIT_PER_MINUTE`
  - `STATIONS_RATE_LIMIT_PER_MINUTE`
  - `BUS_POSITIONS_RATE_LIMIT_PER_MINUTE`
- Set `APP_BASE_URL` in production to reject cross-origin browser calls.
