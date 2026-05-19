# transit-app — Handoff (2026-05-19)

> 이전 어시스턴트(Claude)가 2026-05-18~19 세션에서 진행한 작업과 사용자와 논의한 내용 정리. GPT가 이어받아 작업할 수 있게 컨텍스트, 변경 이력, 남은 과제를 한 곳에.

> 2026-05-19 GPT continuation: 아래 원문 중 "P0: SPA 모듈화 마무리"와 "P1: GitHub Contents API → Git Trees API 배치 커밋"은 완료됨. 현재 프론트엔드는 `transit-app.html`의 단일 ESM entrypoint(`js/app.js`)와 domain modules(`js/*.js`)로 동작하며, 런타임 인덱스는 GitHub Git Data API batch commit을 사용한다. 최신 구조는 `docs/frontend-architecture.md`와 `docs/runtime-index.md`를 기준으로 볼 것.

---

## 1. 프로젝트 한눈에

- **무엇**: 1인용 서울 버스 출퇴근 길찾기 PWA (`https://transit-mauve.vercel.app/`)
- **스택**: Vercel serverless (`api/*.js`), 단일 HTML SPA(`transit-app.html`) + ESM 모듈(`js/*.js`), GitHub-backed JSON 캐시(`runtime-index/`)
- **외부 API**: ODSAY(유료, 길찾기), 서울시 버스(실시간 도착·위치), Kakao Maps(라이브 맵), Nominatim(역지오코딩)
- **배포 정책**: `git push origin main` → Vercel 자동 빌드. 단 `Update runtime index:` 프리픽스 커밋은 빌드 스킵(`vercel.json:14`).
- **컬렉터 cron**: Vercel cron `0 3 * * *` → `/api/index/collect?limit=8`

상세 데이터 흐름과 캐시 레이어는 §6 참고.

---

## 2. 오늘 진행한 14개 변경 (시간 순)

모두 `origin/main`에 push 완료 (`c96968b`이 최종 HEAD). 각 항목 = 1 commit.

### 보안·정확성 (Phase 1)
1. **`3edbc4e` Harden /api auth, input validation, and fix best_eta NPE**
   - `api/_auth.js` 신규: fail-closed(`INDEX_ADMIN_KEY` 없으면 거부), `x-vercel-cron: 1` 헤더 화이트리스트, `crypto.timingSafeEqual`
   - `api/index/collect.js` + `api/debug/seoul-arrival.js`: 신 auth 사용 + 입력 검증
   - **debug 엔드포인트**는 `DEBUG_ENABLED === "1"`일 때만 동작(404로 존재도 숨김), 키 프리뷰/길이 누출 제거
   - `api/_mapping-index.js`: `routeListPath`/`routeStopsPath`에 strict regex 가드(path traversal 방어), `normalizeNameKey`에서 "역" 글로벌 strip → 접미사 strip(`/(역|정류장)$/`)으로 변경해 "역삼동"이 "삼동"이 되던 버그 픽스
   - `api/bus-positions.js`: routeId/boardingStationId/alightingStationId regex 검증
   - **`api/routes.js`** BLOCKER NPE 픽스: `priority=best_eta` + `transportFilter=bus`에서 `sortedDirect`가 비면 `directRecommendation.id` 접근 시 500. `if (directRecommendation)` 가드 + ODSAY fallback으로 통과
   - Korea 좌표 bounds 검증(lon 124..132, lat 33..43)

### 프론트엔드 정리 (Phase 2)
2. **`0c8973b` Cut dead renderers, dedupe render loop, harden fetch and stale-search guards**
   - 사용 안 되는 렌더러 9개 제거 (`renderTransportSteps`, `renderCompareCard`, `buildMetricSummary`, `renderBoardingAction`, `renderCompactDetails`, `renderArrivalHeadline`, `renderJourneyLine`, `estimateArriveMs`, `renderAlternates`) — 약 −350줄
   - `refreshRouteWithOptions`에서 `renderRoutes()` 3중 호출을 1번으로 dedup. 중간 호출은 surgical `.loading` 클래스 토글로 대체 → Kakao 맵 build→teardown→build 깜빡임 제거
   - `deleteRoute`에 `collapsedRouteIds.delete(routeId)` 추가(localStorage 누수 막음)
   - `fetchJson` 15s `AbortController` 기본값
   - `searchStations` seq 카운터로 stale response discard
   - `progressPercent` CSS interpolation에 `Math.max(0, Math.min(100, Number(x) || 0))` clamp

### UX 픽스 ①: 빨리 도착해서 잡은 버스도 탑승 가능
3. **`38e7bf7` Always offer boarding even when next bus is marked uncatchable**
   - **사용자 보고**: "도보 시간 이전에 도착하는 버스를 안 보여줘서, 내가 일찍 도착해서 그 버스를 타도 탑승 버튼을 못 누름"
   - **원인**: `boardingPanel` IIFE에서 `previewVehicles.find(v => v.catchable !== false)` → 모두 uncatchable이면 `return ""`로 패널 자체가 사라짐
   - **픽스**: catchable 우선, 없으면 closest uncatchable(`vehicles[0]`)에 폴백. 두 분기 모두 버튼 렌더. 버튼에 `data-vehicle-key` 추가, `startBoarding(routeId, candidate, vehicleKey)` 시그니처에 키 명시 받아서 사용자가 본 그 차량을 정확히 트래킹

### 매핑 정확성 + 캐시 stampede 보호 (Phase 3)
4. **`30ec295` Tighten mapping match, dedup realtime fetches, cap stop fan-out`**
   - `_mapping-index.js`: substring 매칭에 `length >= 3` 가드(두 정류장 이름) → "강남" ≠ "강남역사거리"
   - `_mapping-index.js`: fire-and-forget `writeJson` swallow를 `console.warn`로 (실패 가시화)
   - **`_index-store.js`** `inflightCache()` 헬퍼 신규 export — 동일 키에 대한 in-flight Promise 디듀프
   - **`_seoul-bus.js`** `realtimeCache`에 inflight 적용(`getArrivalByRoute`, `getBusPositionsByRoute`) — 동시 요청이 같은 정류장에 가도 1번만 fetch
   - `realtimeCache` LRU eviction 보강: size >= MAX인데 모두 fresh일 때 가장 오래된 키 제거
   - **`_mapping-index.js`** `getOrFetchStops` 순차 `await` 루프를 `mapWithConcurrency(routes, 4, ...)`로(Vercel 10s 함수 타임아웃 위험 감소)
   - `inspectSeoulBusApiKey`를 `{configured, apiRoot}`로 슬림화

### routes.js 1031줄 분할 (Phase 4)
5. **`76681c0` Split routes.js into api/_routes/ modules and share geo helpers**
   - `api/_geo.js` 신규: `toRadians`, `distanceMeters` (이전 routes.js와 _mapping-index.js에 중복되어 있던 haversine)
   - `api/routes.js` 1031줄 → **46줄 dispatcher** (Korea bounds 검증 + 분기)
   - `api/_routes/` 폴더 신규:
     - `_common.js` (153 LOC) — 공유 helpers
     - `scoring.js` (67) — `chooseRecommendation`, dedup, sort
     - `odsay-paths.js` (113) — fetch/collect/buildOverview
     - `candidate-builder.js` (249) — `buildCandidate` + 종속
     - `candidate-enricher.js` (89) — `enrichCandidates`, `maybeEnrichBusCandidate`
     - `direct-bus-search.js` (350) — `findBestDirectBusCandidates`
     - `overview.js` (35), `direct-bus-eta.js` (31), `path-type.js` (42) — 분기별 핸들러
   - 라이브 스모크 테스트 통과: 3개 분기 모두 동일 `recommendedId`/`scoreValue` 반환

### SPA 모듈화 5단계 — Phase 5 (이력: 5a~5f-keys, 이후 GPT continuation에서 전체 완료)
6. **`3f819a6` Extract pure helpers into js/util.js as the first ESM module**
   - `<script>` → `<script type="module">`
   - `js/util.js`: `uid`, `nowStamp`, `escapeHtml`, `formatTime`, `relativeTime`, `minuteNumber`, `formatClock`, `formatCountdown`
   - `priorityLabel`은 `PRIORITY_META`에 의존해서 보류
7. **`aec7a5c` Extract storage keys, PRIORITY_META, priorityLabel into js/constants.js`**
   - 8개 storage/api 상수 + `PRIORITY_META` + `priorityLabel` 한 묶음
8. **`7576df8` Extract state singleton and migration helpers into js/state.js`**
   - `state` 객체 + `normalizeLegacyRoute`/`forceBusOnly`/`forceCurrentLocationFrom`/`migrateAndLoadRoutes`/`persistRoutes`
   - state는 모듈 init 시점에 `migrateAndLoadRoutes()`로 자체 초기화 → 인라인 `state.routes = migrateAndLoadRoutes()` 라인 제거
9. **`2043200` Extract network layer into js/api.js`**
   - `fetchJson`(Phase 2 AbortController 유지), `fetchOdsayDirect`, `searchStations`(Phase 2 seq race guard 유지), `normalizeSegments`, `fetchRouteRecommendationDirect`
   - ODSAY browser key 보조: `getBrowserOdsayKey`/`setBrowserOdsayKey`
   - 내부 helpers 9개도 동행(당시 일부 인라인 중복이 있었으나 이후 모듈화 완료)
10. **`f1253d3` Extract pure HTML renderers into js/render.js`**
    - `describeRecommendation`, `iconSvg`, candidate-tone 헬퍼들, fast-flow 헬퍼, segment 헬퍼, `renderJourneyFlow`/`renderSegments`/`renderFastFlow`/`renderFastCandidate`/`renderCandidate`/`renderBusApproachPreview`/`updateBoardingPanelDOM`
    - `tagRoutePicks` canonical은 `api.js`(`export` 키워드 추가), `render.js`는 import
   - 당시 `renderRoutes`, `renderRouteCard`, `renderRouteTabs`는 안전상 HTML 안에 남겼음. 이후 `route-card.js`와 `app.js` orchestration으로 분리 완료
11. **`f259319` Extract Kakao Maps SDK loader into js/live-map-keys.js`**
    - `setKakaoMapKey`/`getKakaoMapKey`/`resolveKakaoMapKey`/`loadKakaoMaps` 4개만 추출 (격리도 높음)
    - `resolveKakaoMapKey`는 native `fetch("/api/config")` 직접 호출 — `api.js` 의존 없음

### UX 픽스 ②: catchable 뱃지
12. **`8fb63ec` Add catchable/uncatchable badges to bus previews and boarding panel**
    - **사용자 요청**: "탈 수 있는 버스와 타기 어려운 버스 시각 구분, uncatchable에 뱃지"
    - `renderBusApproachPreview`의 각 차량 chip에 `<span class="bus-availability-badge {catchable|uncatchable}">`
    - boarding panel의 strong 옆에 동일 뱃지(두 분기 모두)
    - bus-line chip 라벨 "놓침" → "타기 어려움"으로 통일
    - CSS: 초록(`rgba(30,122,95,.16)` + `--accent-strong`) / 주황(`rgba(197,99,31,.18)` + `--orange`)

### UX 픽스 ③: 탑승 상태 영속화
13. **`c96968b` Persist boardedTrip across reloads with a 3h staleness guard`** (HEAD)
    - **사용자 보고**: "탑승 누르고 앱 내렸다가 다시 실행시키면 정보 잃어버림"
    - **원인**: `state.boardedTrip`이 메모리에만 있고 localStorage에 안 써짐. 새로고침 시 `state.js` init이 `boardedTrip: null`로 리셋
    - **픽스**:
      - `constants.js`: `BOARDED_TRIP_STORAGE_KEY`, `BOARDED_TRIP_MAX_AGE_MS = 3 * 60 * 60 * 1000`
      - `state.js`: `loadBoardedTrip()` (init 시 localStorage 읽고, `startedAt`이 3h 초과면 자동 제거 후 null), `persistBoardedTrip()` export (값 있으면 write, null이면 remove로 set/clear 통합)
      - `transit-app.html`: `startBoarding`/`endBoarding`/`deleteRoute`(탑승 중인 루트 삭제 시) 모두 `persistBoardedTrip()` 호출

---

## 3. 현재 코드 구조

```
transit-app/
├── api/
│   ├── _auth.js                  # ★신규: 공유 fail-closed auth
│   ├── _geo.js                   # ★신규: 공유 haversine
│   ├── _index-store.js           # mem/GitHub/FS 3-tier 캐시 + inflightCache
│   ├── _mapping-index.js         # ODSAY↔서울버스 매핑 + 컬렉터
│   ├── _odsay.js                 # ODSAY fetch 어댑터
│   ├── _seoul-bus.js             # 서울 버스 OpenAPI 어댑터 (realtimeCache stampede 보호)
│   ├── _routes/                  # ★신규: routes.js 분할
│   │   ├── _common.js
│   │   ├── candidate-builder.js
│   │   ├── candidate-enricher.js
│   │   ├── direct-bus-eta.js
│   │   ├── direct-bus-search.js
│   │   ├── odsay-paths.js
│   │   ├── overview.js
│   │   ├── path-type.js
│   │   └── scoring.js
│   ├── routes.js                 # 46줄 dispatcher
│   ├── bus-positions.js
│   ├── config.js                 # Kakao key 노출 (브라우저 의도된 공개)
│   ├── reverse-geocode.js
│   ├── stations.js
│   ├── debug/seoul-arrival.js    # DEBUG_ENABLED=1일 때만
│   └── index/
│       ├── collect.js            # cron 진입점
│       └── status.js
├── js/                           # ★신규: SPA ESM 모듈
│   ├── util.js
│   ├── constants.js
│   ├── state.js                  # state 싱귤레톤 + boardedTrip persistence
│   ├── api.js                    # 네트워크 레이어
│   ├── render.js                 # 순수 HTML 렌더러
│   ├── live-map-keys.js          # Kakao SDK 로더
│   ├── live-map.js               # Kakao 라이브 맵 런타임
│   ├── location-ui.js            # Leaflet/자동완성/지도 선택
│   ├── route-actions.js          # 루트 저장/삭제/새로고침/탑승
│   ├── route-card.js             # 루트 카드 렌더러
│   ├── route-navigation.js       # 탭/스와이프 내비게이션
│   ├── route-selection.js        # 후보 선택
│   ├── commute.js                # 출퇴근 pinned ordering
│   └── app.js                    # ESM entrypoint + 앱 조립
├── transit-app.html              # 정적 shell + <script type="module" src="./js/app.js">
├── dev-server.js                 # 로컬 Vercel 어댑터
├── runtime-index/                # GitHub-backed JSON 캐시
├── vercel.json                   # cron + 빌드 스킵 규칙
└── HANDOFF.md                    # ← 이 파일
```

---

## 4. ⚠️ 사용자(jykim4846)가 직접 해야 할 일

1. **`INDEX_ADMIN_KEY` 로테이션** — 이전 값 `admin123` (약함, 공개됐다고 가정). Vercel 대시보드에서 새 값으로 교체.
2. **`ODSAY_API_KEY`, `SEOUL_BUS_API_KEY` 방어적 로테이션** (선택이지만 권장).
3. **Kakao Developers 콘솔**에서 Map JS 키의 도메인 락 확인 — `transit-mauve.vercel.app` + (개발용) `localhost`만 허용되어야 함.

---

## 5. 완료된 후속 작업 — 이전 우선순위 기준

### ✅ P0: SPA 모듈화 마무리 (Phase 5f-rest, 5g)
완료됨. `transit-app.html`의 인라인 앱 로직은 제거됐고, 런타임은 `js/app.js` entrypoint와 domain modules로 분리됨. 과거 남은 인라인 코드 목록:
- **Kakao 라이브 맵 런타임** (~25개 함수, ~1000줄)
  - 좌표 수학: `toPathPoint`, `dedupePathPoints`, `interpolatePoint`, `pointAtSeq`, `toLatLngPoint`, `easeInOutCubic`
  - 버스 세그먼트: `getFirstBusSegment`, `getBoardingSeq`, `getBoardingStopPoint`, `getApproachStopPoints`, `getRealtimeBusPoints`
  - Build/init/teardown: `buildLiveTransitPoints`, `initLiveTransitMaps`, `renderLiveMapFallback`, `teardownLiveMaps`, `clearLiveMapTimer`
  - 폴링/애니메이션: `startBusPolling`, `stopBusPolling`, `tweenOverlayPosition`, `vehicleClassFor`, `updateLiveVehicles`, `vehicleLatLng`, `busLabelHtml`, `isBoardedVehicle`, `overlayContent`
  - 위치 watch: `startUserLocationWatch`
- **렌더링 + 이벤트 와이어링** (renderRoutes/renderRouteCard/renderRouteTabs/bindStaticEvents/bindRouteTabs/bindRouteSwipe/init)

**적용된 분할**:
- `js/live-map.js` — 위 Kakao 런타임 + 위치 watch
- `js/app.js` — init + DOM 이벤트 바인딩 + 모달 + 자동완성
- 그러면 `transit-app.html`의 인라인 `<script>`가 `<script type="module" src="./js/app.js"></script>` 한 줄로 끝남

**주의 — 회귀 위험 큼**:
- Kakao SDK는 비동기 로드(`loadKakaoMaps`가 promise). state.liveMaps/liveMapTimers 등 state 의존도 높음
- 실제 라이브 맵 렌더링까지 검증하려면 Playwright로 (1) 루트 추가 (2) 새로고침해서 활성 루트의 맵이 뜨는지 확인 필요. 빈 상태에서는 라이브 맵 코드 경로가 안 타짐
- 한 번에 다 빼지 말고 sub-phase로(예: `live-map-math.js` 좌표 헬퍼 먼저 → `live-map.js` 런타임)

### ✅ P1: 아키텍처 개선(원래 audit 결과)
- **GitHub Contents API → Git Trees API 배치 커밋**: 완료. `_index-store.js`가 `writeJsonMany`로 tree/commit/ref 업데이트를 묶어 처리.
- **CORS Origin 화이트리스트**: 완료. `APP_BASE_URL`/Vercel URL 기반 origin guard를 public API에 적용.
- **IP 토큰버킷**: 완료. `/api/routes`, `/api/stations`, `/api/bus-positions`에 in-memory rate limit 적용.
- `routes.js` 옵저버빌리티: 완료. candidate enrich 실패를 `console.warn`으로 남김.

### ✅ P2: 코드 정리
- 인라인 앱 로직 제거로 `tagRoutePicks`/`toPathPoint`/`dedupePathPoints` 중복을 정리.
- `state.autocompleteSelection.from` 제거.

---

## 6. 핵심 아키텍처 노트 (audit에서 정리)

### 캐시 3계층
- **read**: `memCache`(5min TTL, max 200, per-instance) → GitHub Contents API(토큰 있을 때) → 로컬 FS(`.runtime-index/`) → null
- **write**: driver write → memCache set. GitHub 단건은 Contents API, 배치 컬렉터는 Git Data API tree/commit/ref 업데이트
- **invalidation**: 시간 only (5min mem, 30s realtime, 10min XLSX workbook). 명시 purge 없음. 매핑이 영구 stale될 가능성 있지만 실제로는 거의 변화 없음

### 자가 치유 인덱스
- `/api/routes` 호출이 본 route 번호를 `enqueueRouteNos(..., "runtime_refresh")`로 큐에 넣음
- cron `0 3 * * *`이 큐 위에서 `limit=8`로 처리하며 GitHub에 커밋
- 커밋 메시지 프리픽스 `Update runtime index:`로 Vercel 빌드 스킵(`vercel.json:14`) → 영속 캐시 무료 운용

### 알려진 한계
- `pendingRouteNos` 현재 13+ — cron `limit=8`/일이면 백로그 쌓이는 추세. 검색 시점에 `_mapping-index.getOrFetchRoutes`/`getOrFetchStops`가 실시간 폴백하지만 cold cache 첫 검색이 느림
- Vercel hobby 함수 timeout 10s. fan-out 동시성 캡(4)으로 Phase 3에서 완화했지만 여전히 모호한 routeNo(예: "6")는 위험

### Boarding 도메인 모델
- `state.boardedTrip`: `{ routeId, candidateId, vehicleKey, vehicleLabel, routeNo, startedAt, alightingSeq, alightingName, lastProgressSeq, remainingStops, etaMinutes }`
- 영속화는 Phase 14에서 완료. TTL 3시간(통근 1회분 정도)
- vehicleKey로 polling 시 같은 차량 트래킹 (`isBoardedVehicle(vehicle, routeId)`)
- 하차 트리거: 수동(`endBoarding("manual")`) 또는 자동(`endBoarding("alighting")`) — 자동 트리거 로직은 인라인 polling 코드 내 (확인 필요)

---

## 7. 사용자 협업 스타일 (관찰)

- 한국어 기본, 코드/식별자/API명은 원어
- 매우 자율적 — "알아서 해" 스타일을 명시적으로 좋아함(`~/.claude/CLAUDE.md` Autonomy 룰)
- 단, **비가역적/파괴적/외부계정** 작업은 사전 확인 필수
- 배포는 명시 지시(`푸시해` 등) 있을 때만. 로컬 커밋은 자유
- 실제 사용하면서 버그/UX 이슈를 그 자리에서 보고 — 빠른 픽스 사이클 선호
- 같은 메시지를 두 번 반복하면 강조 신호(handoff 요청도 두 번 반복함)

---

## 8. 검증 방법

- **빠른 require 체크** (백엔드):
  ```bash
  cd /Users/jongyeon.kim/Desktop/transit-app
  node -e "['./api/_geo','./api/_routes/_common','./api/_routes/scoring','./api/_routes/odsay-paths','./api/_routes/candidate-builder','./api/_routes/candidate-enricher','./api/_routes/direct-bus-search','./api/_routes/overview','./api/_routes/direct-bus-eta','./api/_routes/path-type','./api/routes','./api/_mapping-index','./api/_auth','./api/_seoul-bus','./api/_index-store'].forEach(p=>require(p)); console.log('require ok')"
  ```
- **인라인 SPA 스크립트 syntax 체크**:
  ```bash
  node -e "const fs=require('fs');const html=fs.readFileSync('transit-app.html','utf8');const m=html.match(/<script type=\"module\">([\\s\\S]*?)<\\/script>\\s*<\\/body>/);require('fs').writeFileSync('/tmp/spa.mjs',m[1]);" && node --input-type=module --check < /tmp/spa.mjs
  ```
- **dev-server**: `node dev-server.js` (3000번 포트, `.env` 자동 로드)
- **라이브 스모크**:
  ```bash
  curl -s "http://localhost:3000/api/routes?fromX=127.0276&fromY=37.4979&toX=126.9223&toY=37.5563&priority=fastest&transportFilter=bus" | head -c 400
  ```
- **Playwright MCP**: `mcp__playwright__browser_navigate` → `mcp__playwright__browser_console_messages(level=error)` 0개여야 정상

---

## 9. 함정/주의사항

- `dev-server.js`는 require 캐시 모듈별로 hot-reload하지만 `js/*.js`는 정적 파일 서빙 → 변경 시 브라우저 새로고침 필요
- `state.js`가 모듈 init 시점에 `localStorage`를 읽음 → SSR 환경에선 깨짐 (현재 SSR 안 함, 영향 없음)
- `boardedTrip` TTL 3h는 출퇴근 1회분 기준. 장거리 통근/지방 출장에서는 부족할 수 있음 — 사용자 패턴 보고 조정
- 매 cron 실행은 Git Data API 배치 커밋을 사용한다. 단건 request-time 캐시 write는 여전히 Contents API 경로를 사용한다
- `priority=overview` 분기에서 `enqueueRouteNos` 호출이 routes 안에 있어서 ODSAY 매번 쓰는 priority(`fastest`/`fewest_transfers`/`best_eta` 별도 path-type)와 패턴 다름 — 변경 시 분기별로 검증 필요

---

## 10. TL;DR for GPT

1. 보안/정확성 CRITICAL은 다 막았고 push 됐다 (`origin/main` HEAD = `c96968b`).
2. 사용자가 두 번 보고한 UX 버그(빨리 도착해서 잡은 버스/탑승 상태 손실)도 해결.
3. 코드 구조: routes.js 1031줄 분할 완료, SPA 앱 로직은 `js/app.js`와 `js/*.js` domain modules로 분리 완료.
4. 사용자 액션 필요: `INDEX_ADMIN_KEY` 로테이션(필수). ODSAY/Kakao 키 점검(권장).
5. 다음 작업은 새 기능/실사용 QA 기준으로 정하면 된다. 기존 P0/P1 구조 개선 항목은 완료됨.

Good luck. 🚌
