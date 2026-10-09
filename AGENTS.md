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
├── MapList.svelte                # Landing page: three classified sections + sort
├── MapViewer.svelte             # Full-screen viewer with gestures
├── components/
│   ├── UserPositionMarker.svelte   # GPS watch, stale-fix watchdog, accuracy ring, marker
│   ├── PdfPagePicker.svelte        # Page-chooser modal chrome
│   ├── PdfPagePreview.svelte       # Debounced page preview; one render effect
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

`src/lib/` holds pure ES modules: `db.js` (IndexedDB wrapper), `transforms.js` (similarity/affine/homography georeferencing), `viewport.js` (screen/image coordinate math, pinch-zoom), `draw.js` (canvas rendering, takes a `ctx`), `mapMatch.js` (landing-page containment/classification/sorting), `geolocation.js` (shared GPS watch + stale-fix watchdog), `pdf.js` (rasterise a PDF page to a PNG blob for import).

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
- Geo transform shape (from `calculateTransform`, `src/lib/transforms.js`): `{ m, type, lon0, lat0 }` — `m` is a row-major 3x3 homogeneous matrix mapping *canonical image fractions* `(x, y) = (u, -v)` to local east/north metres about `(lon0, lat0)`, `type` is `'similarity' | 'affine' | 'homography'`. All three models share this shape; `m[6]`/`m[7]` are 0 for similarity and affine. Callers pass the whole object (no separate type argument). Models are chosen by point count: 2 → similarity, 3 → affine, 4 → homography. Every model is fitted in the local metric plane, never in raw degrees (degree space is anisotropic by `cos(lat)`).
- Image coordinates are stored y-down (canvas convention): `v = imageY / D` grows downward. Fitting and projection use one canonical y-up frame `x = u`, `y = -v` (`imageFramePoint` / `imageFrameToUV`), so `y` grows upward like metric `north` and the flip happens once, at the transform boundary — `uvToGeo`/`geoToUV` convert either side. This makes every model fit an orientation-preserving map: a correct map has a *positive* determinant, and `transformIsMirrored` reports a negative one as a likely misplaced reference point (two points cannot distinguish a reflection from a rotation, so the warning only applies at 3+ points). Fitting in the raw y-down `(u, v)` frame would either mirror a similarity (reference points still land exactly, so it is invisible away from the reference line) or push the reflection into the affine/homography coefficients, leaving no uniform orientation test. `MapViewer.svelte` surfaces the mirrored case in the points panel and debug modal. Test fixtures must use this convention (`lat` decreasing as `v` increases for a north-up map); a y-up fixture looks correct against an orientation-preserving fit but does not match the app. `draw.test.js`'s "places the marker north of a lower point" pins the whole pipeline's orientation.
- Reference points are stored in image coordinates as fractions, not pixels: `u = imageX / D`, `v = imageY / D` with `D = imageDivisor(width, height) = max(width, height)`. One divisor for both axes keeps the image→fraction change a *similarity* of the plane (per-axis scaling would turn a similarity fit into an ellipse unless the image is square), and `max` (not width) keeps both coordinates within `[0, 1]` for any aspect ratio. Because `m` maps fractions to metres, `m`'s linear scale is metres-per-fraction; convert a physical distance with `geoDistanceToUV` (fractional) and multiply by `D` for pixels. Pixels remain only at the rendering/viewport edges (`draw.js`, `viewport.js`, canvas drawing in `MapViewer`), which convert at their boundary via `imageDivisor`. The exact image rectangle is therefore `[0, W/D] x [0, H/D]`, not `[0,1]^2`, for a non-square image.
- Map records carry `imageWidth`/`imageHeight` (natural dimensions, additive field; old rows get them from `backfillImageDimensions`, a boot-time sweep called from `App.svelte` that reuses `decodeImageSize`). This keeps the landing-page classifier off the blob-decode path. The sweep is idempotent and crash-safe per map and retries a blob that failed to decode on the next boot. It replaced the removed legacy pixel→fraction migration (`migrateLegacyPoints`), which is gone now that the schema is fraction-only; `DB_VERSION` is unchanged because neither change is structural.
- The user marker is a screen-space overlay with a constant CSS-pixel radius, so zooming in does not let it cover the map. `drawUserMarker` places it in image space, then cancels the map scale about the marker center via `scaleAbout` (one `ctx.transform` matrix; post-multiplication keeps the fixed point in the current, image coordinate space). The accuracy ring is a real ground distance and is drawn *before* that cancellation so it still shrinks and grows with the map. Do not cancel the scale with `translate/scale/translate` — besides being equivalent, the extra `translate` calls perturb `MapViewer.test.js`'s `viewOffset()` heuristic. Because a rotated map is still scaled uniformly, cancelling the scale keeps the marker circular; only a non-uniform (sheared) map would distort it, which the app never fits.
- Longitudes are cyclic: `wrapLongitude` folds into `[-180, 180)` (identity for in-range values, so ordinary fits are bit-unchanged), and `planeOrigin` (exported; formerly `fitOrigin`) averages wrapped offsets from the first point. Maps crossing the antimeridian therefore fit correctly. Do not reintroduce a raw arithmetic mean of `lon`.
- GPS is a best-effort display of an OS-owned signal. Android's fused location provider can return a frozen fix whose reported `accuracy` inflates without bound, and Chromium never re-requests it, so `src/lib/geolocation.js` runs a watchdog (shared by `UserPositionMarker.svelte` and `MapList.svelte` via `createPositionWatch`): if no fix arrives within `FIRST_FIX_TIMEOUT_MS` or the last fix is older than `STALE_AFTER_MS`, it clears the watch and starts a new one (throttled by `REARM_COOLDOWN_MS`), and re-arms on `visibilitychange`/`pageshow` when the page was hidden for at least `MIN_HIDDEN_MS` (mirroring the "switch to Google Maps" workaround). While stale it reports `stale`, which `UserPositionMarker` mirrors into `positionStale` and `drawUserMarker` renders as a hollow dashed marker instead of a meaningless accuracy ring. Tests must use `vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] })` rather than a blanket `useFakeTimers()`, so real `setTimeout` keeps `flushPromises` and Svelte scheduling working.
- The landing page classifies maps into three sections (maps-here / incomplete / other) in `src/lib/mapMatch.js`. `buildMapSummaries` does all heavy per-map work once (fit, invert, bounds); `classifyMaps` is the cheap per-fix path and only applies the precomputed inverse. Membership uses a two-tier test: a metric-plane AABB of the four projected image corners (Tier 1, wrap-free), then the exact `[0, W/D] x [0, H/D]` check (Tier 2). `MapList` recomputes only when the fix moves at least `MOVEMENT_THRESHOLD_M` (5 m) and skips recompute while the page is hidden. Every section is labelled "Sort by" and offers the same four keys (`SORT_OPTIONS`: distance, size, lastModified, name) with an asc/desc toggle; per-section defaults are `DEFAULT_SORT` (maps-here: size, incomplete: lastModified, other: distance) and each key's natural direction is `DEFAULT_DIRECTION` (size/distance/name ascending, lastModified descending). Changing the key resets the direction to that key's default. `availableSortKeys` reports which keys a single map supports — `distance` and `size` need `boundsGeo`, `lastModified` and `name` always apply — and `MapList` disables an option when any map in the section does not support it (so "Incomplete" greys out size and distance).
- "Add Map" opens the file input directly (`accept="image/*,application/pdf"`, no `capture` attribute) with no in-app pre-menu. Android browsers (Firefox included) treat `capture="environment"` as a *preference*, not a routing decision, so the old Take Photo / Choose File menu duplicated the platform's own Camera/Files sheet. One `accept` input already surfaces exactly one native chooser, so do not reintroduce a second chooser or a `capture` hint in front of it. The non-image `application/pdf` type is deliberate: on Android/Chromium an image-only `accept` routes straight to the system Photo Picker, which has no Camera entry, whereas any non-image type makes Chromium show its Camera + Files sheet again (see the Android 14+ Chromium bug).
- PDFs are supported by rasterising a page at import time (`src/lib/pdf.js`), not by teaching the rest of the app about PDFs. `renderPdfPageToBlob` draws the chosen page to a canvas and returns a PNG blob, which then flows through the unchanged image path (thumbnail, `imageBlob`, georeference, viewer). PDF.js is loaded by dynamic import and the worker is resolved with `new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url)` so Vite emits and base-prefixes it (`/byom/assets/...`); it stays out of the initial shell. A multi-page PDF opens `PdfPagePicker`; a single-page one imports silently. Page render is capped at `MAX_RENDER_DIMENSION` (3000 px long edge) so a full-sheet map cannot exhaust canvas memory on a phone. Imports are processed sequentially so several PDFs each get their own page prompt.
- `PdfPagePicker` is the modal chrome (title, slider, page field, Import/Cancel) and delegates the preview to `PdfPagePreview.svelte`. `PdfPagePicker` is the only caller passing `doc` in; `MapList` supplies the already-loaded document so the picker never re-parses the PDF. The backdrop is the `role="dialog"` root and follows the `MapViewer` modal pattern (`tabindex="-1"`, click-outside and Escape both `oncancel`, `.modal-backdrop:focus { outline: none }`), so keep those handlers if you restructure it.
- `PdfPagePreview` owns the rasterising and is the only consumer of `renderPdfPageToCanvas`, which returns PDF.js's render task rather than awaiting it so the effect can `cancel()` a render a newer page has superseded. It imports `PREVIEW_DIMENSION` itself (1400 px; the page picker does not pass a cap) and renders a single `.pdf-preview-stage` root — the canvas host plus the `{#if failed}` error underneath it — so the component is one flex item in the parent's preview frame and the error cannot be pushed out of the frame beside the canvas. Keep the single root: two sibling roots from this component land as competing flex items of the frame.
- `PdfPagePreview` uses **one** `$effect` for the whole render lifecycle: it reads `page`, debounces by `DEBOUNCE_MS` (120 ms), creates a fresh `<canvas>` into a `bind:this` host, starts the render, and on cleanup clears the timer and cancels in-flight work. Debouncing in the effect's own cleanup means a fast slider drag restarts the timer and exactly one render starts — the page the user settles on (measured: 20 renders → 1 over a fast 20-page drag). It is deliberately not split into a "debounce writes state / canvas-keyed effect reads it" pair: that needs `{#key}` plus `untrack` to keep the two from re-triggering each other, and a single effect owns the whole lifecycle with no cross-effect coupling. Rasterising a canvas is an imperative side effect, which is the legitimate use of `$effect` — do not try to move it into the template; it is not derived state.
- A fresh canvas per render is what keeps PDF.js happy: PDF.js guards a canvas with a `WeakSet` (`Cannot use the same canvas during multiple render() operations`) and a superseded render can still be starting — its task exists only after `getPage` resolves, so there is nothing to `cancel()` yet — but a new element shares no state with it, so that collision cannot happen (measured: 0 errors over three 20-render drags, versus 1 error per drag when one canvas was reused). Painting straight onto the shown canvas also lets PDF.js draw the page in stages (background, then text and images) so the preview fills in as it is drawn, rather than staying blank until a finished copy is swapped in; there is no scratch-canvas copy step.
- The canvas host is `<div class="pdf-preview-host" bind:this>` with `.pdf-preview-host { display: contents }`, so the canvas inside is still the flex item of `.pdf-preview-frame`. The host exists so `replaceChildren` never touches a node Svelte owns: doing that on the stage itself removes the `{#if failed}` anchor comment and the error can then never render. Keep the `{ doc, page }` props contract — the picker does not pass a render cap.
- The distance a map card shows and the distance the "Distance" sort uses are the *same* measure: `mapCenterDistanceMeters`, the ground distance to the centre of the map's footprint bounds. Do not reintroduce a bounding-box-clamped distance for the badge: a rotated footprint's bounding box extends past the actual map, so clamping reports 0 m for points that are outside it, which produced a card in "Other maps" still badged "On this map". Containment is a separate, exact test in `classifyMaps`; a map in "Maps here" may still be several hundred metres from the fix if it is large. Cards show this as "<n> m from map centre" with no "On this map" wording, so a large map the user is standing on reads a small distance rather than a containment claim.
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
- Lifecycle vs. reactive work: `$effect` is only for syncing to *ongoing* reactive change. `App.svelte` (init + `hashchange`), `MapList.svelte` (`loadMaps`), `UserPositionMarker.svelte` and `MapList.svelte` (the `createPositionWatch` subscriptions) run once and use `onMount`; `PdfPagePreview.svelte` reads `page` and keeps its `$effect`. No `$effect` reads nothing reactive. `MapViewer.svelte` is the one tracked effect: it keys on `mapId` (`const id = mapId;` in the tracked part) so a deep-link from `#map/1` to `#map/2` reloads the viewer, and passes `id` into `loadMapData(id)`. Reads after an `await` are untracked, so the async body cannot supply the dependency � the read must sit before the IIFE.
- `$effect`/`onMount` async blocks must keep the `await`. `MapViewer` loads map data and then sets up the canvas, and `setupCanvas()` reads `imageUrl`, which `loadMapData()` resolves asynchronously; dropping the `await` sets `image.src = null`, which browsers treat as a broken image, so `drawImage` throws `InvalidStateError` and the viewer stays black. The effect awaits, `setupCanvas` bails without an `imageUrl`, and `render()` skips until `imageReady`. `FakeImage` fires `onload` regardless of `src` and hardcodes dimensions, so component tests only catch this via assertions on the recorded `src`/`drawImage` calls.
- `MapViewer` input is click-driven, on both mouse and touch: a click on an existing point opens the edit modal, any other click starts a new reference point. There is no long-press path. Touch pan/pinch runs through `touchstart`/`touchmove` and never emits a `click`, so a touch drag cannot add a point. A *mouse* drag does emit a trailing `click`, so `mouseDragged` (set past a 5px threshold) suppresses it. Do not add `e.preventDefault()` in `handleTouchStart`/`handleTouchMove`: Svelte 5 delegates those as passive listeners, so it silently no-ops, and suppressing the compat click would break tap-to-add on touch.
- Two-finger gestures anchor on `touchStartCenter`, the pinch center captured at `touchstart`, not on the moving current center. `pinchZoomTransform(center, startTransform, newScale, startCenter)` maps the image point that was under `startCenter` to `center`, so a simultaneous pinch+pan follows the fingers. Feeding it the moving center as the anchor makes zooming in drive the map opposite the fingers and zooming out crawl. `startCenter` defaults to `center` for the anchor-stays-put case.
- Shallow/grafted clone: `git rev-parse --is-shallow-repository` => `true`; deepen if you need history.
- PWA/service worker caching may serve stale builds; hard-reload or unregister the SW after switching branches.
- No backend: the only network service is MapLibre OSM tiles (needs internet when picking coordinates).
- CI uses `npm ci` (`test.yml`, `deploy.yml`); keep `package-lock.json` in sync.
