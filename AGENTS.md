# AGENTS.md

Persistent context for AI agents working on this repository.

## Project

BYOM (Bring Your Own Map) is a serverless, offline-first PWA built with Svelte 4 + Vite 5 for georeferencing map photos and viewing GPS position offline.
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

`src/lib/` holds pure ES modules: `db.js` (IndexedDB wrapper), `transforms.js` (similarity/affine transforms), `viewport.js` (screen/image coordinate math, pinch-zoom), `draw.js` (canvas rendering, takes a `ctx`).

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
- Transform object shape: `{ scale, translateX, translateY, rotation }`.
- Style: 2-space indent, semicolons, single quotes; match surrounding code. No lint/format script configured.

## Build / Deployment Notes

- `vite.config.js`: `base: '/byom/'` (GitHub Pages); HTTPS dev server uses `localhost-key.pem` and `localhost-cert.pem`; `host: true` for LAN testing.
- Service worker registers at `/byom/sw.js` in `src/main.js`; keep in sync with `base` and `public/manifest.json`.
- `deploy.yml` deploys `dist/` to GitHub Pages on pushes to `main`; use feature branches for dev work.

## Gotchas

- Shallow/grafted clone: `git rev-parse --is-shallow-repository` => `true`; deepen if you need history.
- PWA/service worker caching may serve stale builds; hard-reload or unregister the SW after switching branches.
- No backend: the only network service is MapLibre OSM tiles (needs internet when picking coordinates).
- CI uses `npm ci` (`test.yml`, `deploy.yml`); keep `package-lock.json` in sync.
