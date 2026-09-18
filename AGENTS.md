# AGENTS.md

Persistent context for AI agents working on this repository.

## Project

BYOM (Bring Your Own Map) is a serverless, offline-first PWA built with Svelte 5 (runes mode) + Vite 5 for georeferencing map photos and viewing GPS position offline.
No backend: all data (map images, reference points) is stored in IndexedDB in the browser.

## Commands

```bash
npm install          # Install dependencies
npm run dev          # Start Vite dev server (HTTPS, host: true - see Build Notes)
npm run build        # Production build to dist/
npm run preview       # Preview production build
npm test             # vitest run (jsdom)
npm run test:watch   # vitest watch mode
npm run test:coverage # vitest run --coverage (per-file thresholds)
```

CI (.github/workflows/test.yml): Node 20, `npm ci`, `npm run build`, `npm run test:coverage`.

## Project Structure

```
src/
├── App.svelte                    # Main app with routing
├── MapList.svelte                # Landing page: map gallery
├── MapViewer.svelte             # Full-screen viewer with gestures
├── components/
│   ├── UserPositionMarker.svelte   # GPS watch, accuracy ring, marker
│   └── __tests__/                  # Colocated component tests
├── lib/                          # Pure, testable logic (see below)
├── styles/                       # Global styles (App/MapList/MapViewer.css)
├── main.js                       # Entry point + service worker registration
tests/
└── setup.js                      # Global test setup (all mocks live here)
public/
├── sw.js                         # Service worker (offline caching)
├── manifest.json                 # PWA manifest (path prefix /byom/)
.github/workflows/              # test.yml, deploy.yml (GitHub Pages, opencode.yml)
```

`src/lib/` holds pure ES modules: `db.js` (IndexedDB wrapper), `transforms.js` (similarity/affine/homography georeferencing), `viewport.js` (screen/image coordinate math, pinch-zoom), `draw.js` (canvas rendering, takes a `ctx`).

## Testing

Run tests: `npm test` or `npm run test:coverage`. Test glob: `src/**/*.test.js` (`vitest.config.js`).
`tests/setup.js` installs jsdom replacements used by tests:
  - Canvas 2D: recorded stub; assert via `globalThis.__canvasTestUtil.getCtxCalls()`, reset `.reset()`.
  - `Image`: use `FakeImage`; `src` setter fires `onload` on a microtask; subclass to set `width`/`height`.
  - Geolocation: stub records callbacks; fire positions via `globalThis.__geolocationTestUtil` (`emitWatchPosition`, `emitCurrentPosition`, `emitWatchError`, `emitCurrentError`, `getWatchers`).
  - IndexedDB: real-ish via `fake-indexeddb/auto`; component tests mock `src/lib/db.js` directly.
  - `URL.createObjectURL`: faked for blob URLs.
- `window.confirm`/`window.alert` are auto-mocked in tests/setup.js.
- Coverage: per-file line thresholds in `vitest.config.js` (e.g., `src/lib/transforms.js` 100%, `src/MapViewer.svelte` 99%). `reportOnFailure` prints a report on failure. If you improve coverage, raise thresholds; never lower them.
- Excluded from coverage: `src/main.js`, `public/sw.js`, `svelte.config.js` (browser-only/build-infra). Keep their inline `/* v8 ignore */` markers in sync with the exclude list.
- README coverage numbers may lag; trust `npm run test:coverage`.

## Conventions

- ES modules only (`"type": "module"`); import with file extensions (`./db.js`, `../lib/draw.js`).
- Keep pure logic in `src/lib/`; put DOM/canvas/geolocation access in Svelte components or `draw.js` functions taking a `ctx`.
- Transform object shape: `{ scale, translateX, translateY, rotation }` (the on-screen view transform).
- Geo transform shape (from `calculateTransform`, `src/lib/transforms.js`): `{ m, type, lon0, lat0 }` — `m` is a row-major 3x3 homogeneous matrix mapping image pixels to local east/north metres about `(lon0, lat0)`, `type` is `'similarity' | 'affine' | 'homography'`. All three models share this shape; `m[6]`/`m[7]` are 0 for similarity and affine. Callers pass the whole object (no separate type argument). Models are chosen by point count: 2 → similarity, 3 → affine, 4 → homography. Every model is fitted in the local metric plane, never in raw degrees (degree space is anisotropic by `cos(lat)`).
- Longitudes are cyclic: `wrapLongitude` folds into `[-180, 180)` (identity for in-range values, so ordinary fits are bit-unchanged), and `planeOrigin` (exported; formerly `fitOrigin`) averages wrapped offsets from the first point. Maps crossing the antimeridian therefore fit correctly. Do not reintroduce a raw arithmetic mean of `lon`.
- The homography DLT Hartley-normalizes both planes via `normalizePoints` and denormalizes with `multiplyMatrices`, restoring `m8 = 1`. The design matrix stays at cond ~3.1 regardless of map size (raw: ~2.5e7 at 1,000 px, ~3.6e9 at 12,000 px). The raw solve is still accurate at these scales, so this is robustness, not a user-visible fix. Keep any future least-squares fit on QR/SVD, not normal equations (`cond(AᵀA)` hits the float64 floor). Do not add a matrix dependency (`mathjs` etc.) — deliberate decision, see issue #31 item 5.
- Fitters validate their inputs with `assertFinitePoints`: `null`/`undefined`/`NaN`/non-numeric coordinates throw `'Reference points must have finite coordinates'` rather than silently coercing to a wrong transform.
- Style: 2-space indent, semicolons, single quotes; match surrounding code. No lint/format script configured.

## Versioning

Three independent identifiers — do not conflate them:

- **App version**: CalVer `YYYY.M.PATCH` in `package.json` (e.g. `2026.9.0`).
  Bump it in the release PR and keep `package-lock.json` in sync. Surfaced in
  the UI via the `__APP_VERSION__` define, which is set in **both**
  `vite.config.js` and `vitest.config.js` — keep those two in sync. Tagging is
  automated by `.github/workflows/tag-release.yml`; never tag by hand.
- **Build id**: commit SHA (`GITHUB_SHA`), injected into `public/sw.js` by the
  `byom:service-worker-versioning` Vite plugin. Never hand-edited; local builds
  fall back to a timestamp. This is what makes the browser pick up a new shell.
- **`DB_VERSION`** (`src/lib/db.js`): IndexedDB schema only. Unrelated to
  releases; bump it just for schema migrations, with a migration in
  `onupgradeneeded`.

`public/sw.js` uses two caches: `byom-shell-<version>-<buildId>` (versioned per
deploy, purged on activate) and `byom-assets` (never versioned — content-hashed
URLs cannot go stale, and retaining them keeps open tabs working). Cleanup is
prefix-scoped to `byom-shell-`, so never widen it to all `byom-*` caches or the
asset cache gets wiped on every deploy. Both caches are orthogonal to user data,
which lives in IndexedDB and survives all updates.

## Build / Deployment Notes

- `vite.config.js`: `base: '/byom/'` (GitHub Pages); HTTPS dev server uses `localhost-key.pem` and `localhost-cert.pem`; `host: true` for LAN testing.
- Service worker registers at `/byom/sw.js` in `src/main.js`; keep in sync with `base` and `public/manifest.json`.
- `deploy.yml` deploys `dist/` to GitHub Pages on pushes to `main`; use feature branches for dev work.

## Gotchas

- Svelte 5 components are functions, not classes. Mount with `mount(App, { target })` from `svelte`, never `new App({ target })`. The constructor form throws `effect_orphan` during bootstrap and renders a blank page. `src/main.test.js` guards this; component tests use `@testing-library/svelte`'s `mount()`, so they will not catch a broken call in `main.js`.
- `$effect` replaces `onMount` async blocks, but only if you keep the `await`. `MapViewer`'s effect loads map data and then sets up the canvas, and `setupCanvas()` reads `imageUrl`, which `loadMapData()` resolves asynchronously; dropping the `await` sets `image.src = null`, which browsers treat as a broken image, so `drawImage` throws `InvalidStateError` and the viewer stays black. The effect now awaits, `setupCanvas` bails without an `imageUrl`, and `render()` skips until `imageReady`. `FakeImage` fires `onload` regardless of `src` and hardcodes dimensions, so component tests only catch this via assertions on the recorded `src`/`drawImage` calls.
- Svelte 5 event attributes delegate, and delegated `touchstart`/`touchmove` are **passive**. That silently voids `e.preventDefault()` in the handler, so the browser still fires a compatibility `click` after a tap. In `MapViewer` this turned a mobile tap into an added reference point. The canvas binds those two events directly with `{ passive: false }` in an `$effect` (and must not also use `ontouchstart`/`ontouchmove` attributes, or they run twice); `ontouchend`/`onwheel`/`onclick`/mouse stay delegated. `MapViewer.test.js` asserts the listener options and `defaultPrevented`.
- Shallow/grafted clone: `git rev-parse --is-shallow-repository` => `true`; deepen if you need history.
- PWA/service worker caching may serve stale builds; hard-reload or unregister the SW after switching branches.
- No backend: the only network service is MapLibre OSM tiles (needs internet when picking coordinates).
- CI uses `npm ci` (`test.yml`, `deploy.yml`); keep `package-lock.json` in sync.
