# Frontend Architecture

`transit-app.html` owns the static shell, styles, and modal markup. Runtime behavior starts from `js/app.js` through one ESM entrypoint:

```html
<script type="module" src="./js/app.js"></script>
```

## Module Boundaries

- `js/app.js` wires the app together: startup, clock, route list composition, route tabs, top-level event delegation, and feature module configuration.
- `js/state.js` owns the shared client state, localStorage migrations, route persistence, and boarded-trip persistence.
- `js/api.js` owns browser-facing network calls, ODSAY direct fallback, station search, route normalization, and request timeout handling.
- `js/render.js` owns pure HTML helpers for candidates, journey flow, fast-flow status, bus previews, and boarded-trip DOM updates.
- `js/route-card.js` renders a complete route card from route state plus callbacks.
- `js/route-actions.js` owns route mutations: refresh, save, delete, details toggles, modal edits, current-location resolution, and boarding lifecycle.
- `js/location-ui.js` owns Leaflet previews, autocomplete, reverse geocoding, and map-pick interactions.
- `js/live-map.js` owns Kakao route maps, live vehicle overlays, location watch, polling, and map teardown.
- `js/live-map-keys.js` owns Kakao Maps key resolution and SDK loading.
- `js/route-navigation.js` owns route tabs and mobile swipe navigation.
- `js/route-selection.js` owns selected recommendation lookup and candidate switching.
- `js/commute.js` owns commute-window ordering and route pinning.
- `js/countdowns.js`, `js/tracking.js`, and `js/settings-ui.js` own small isolated UI behaviors.
- `js/constants.js` and `js/util.js` are dependency-light shared helpers.

## Guardrails

- Keep `app.js` as orchestration only. New feature behavior should live in the closest domain module.
- Prefer pure rendering helpers in `render.js` or `route-card.js`; keep state writes in action or state modules.
- Map lifecycle is intentionally centralized in `live-map.js`; route renderers should not create Kakao or Leaflet instances directly.
- Do not add another inline script to `transit-app.html`; use ESM modules instead.
- Client modules are served as browser ESM while tests run in Node CommonJS, so pure backend logic is currently easier to unit test than DOM-heavy frontend logic.

## Verification

After frontend changes, run:

```sh
for f in js/app.js js/*.js; do cp "$f" "/tmp/$(basename "$f" .js).mjs"; node --check "/tmp/$(basename "$f" .js).mjs" || exit 1; done
npm test
```

If a local server is running, also confirm the entrypoint and changed modules return HTTP 200.
