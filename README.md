# BYOM - Bring Your Own Map

A Progressive Web App for georeferencing map photos and viewing your GPS location on them, even offline.

## ✨ Features

- 📷 **Load map images** from camera or files
- 📍 **Set reference points** to georeference maps
- 🧭 **See your GPS location** on the map image in real-time
- 📱 **Mobile-first design** with pinch-zoom, pan, and rotate gestures
- 🔄 **Works offline** with IndexedDB storage
- 🗺️ **Uses OpenStreetMap** for coordinate selection
- ⚡ **No server required** - completely serverless PWA
- 🎯 **High accuracy** - affine transform with 3+ reference points

## 🚀 Quick Start

```bash
# Install dependencies
npm install

# Run dev server
npm run dev

# Build for production
npm run build

# Deploy to GitHub Pages
npm run deploy
```

For detailed setup instructions, see [QUICKSTART.md](QUICKSTART.md)

## 📖 How It Works

### 1. Add a Map
On the landing page, use the camera or file upload to add a map image. Images are stored locally in IndexedDB.

### 2. Add Reference Points
Select at least 2 reference points by:
- **Tap on the image** to set image coordinates
- **Choose a method** to set real-world coordinates:
  - 📍 Use current GPS location
  - ⌨️ Enter coordinates manually
  - 🗺️ Pick from OpenStreetMap (requires internet)

### 3. View Your Location
Once reference points are set, your GPS position appears on the map image automatically:
- **Green dot** shows your current position
- **Circle** indicates GPS accuracy
- Updates in real-time as you move

## 🔬 Transform Methods

The app uses different mathematical transformations based on the number of reference points:

- **2 points**: Similarity transform (translation, rotation, uniform scale). Fitted in a local east/north metre plane rather than raw degrees, so it stays accurate at any latitude and map rotation.
- **3+ points**: Affine transform (least-squares fit for best accuracy)

## 📁 Project Structure

```
byom/
├── src/
│   ├── App.svelte                    # Main app with routing
│   ├── MapList.svelte                # Landing page with map gallery
│   ├── MapViewer.svelte              # Full-screen viewer with gestures
│   ├── ReferencePointPicker.svelte   # Reference point UI
│   ├── main.js                       # Entry point
│   ├── app.css                       # Global styles
│   └── lib/
│       ├── db.js                     # IndexedDB wrapper
│       └── transforms.js             # Transform algorithms
├── public/
│   ├── manifest.json                 # PWA manifest
│   ├── sw.js                         # Service worker (version placeholders)
│   └── icon-*.svg                    # App icons
├── .github/workflows/
│   └── deploy.yml                    # GitHub Actions deployment
├── index.html
├── package.json                      # App version (CalVer) - see Versioning
├── vite.config.js                    # Injects version + build id into sw.js
└── README.md
```

## 🛠️ Tech Stack

- **Svelte** - Reactive UI framework
- **Vite** - Build tool and dev server
- **MapLibre GL** - Map rendering for coordinate selection
- **IndexedDB** - Client-side storage (maps + reference points)
- **Canvas API** - Image rendering and transformations
- **Geolocation API** - GPS position tracking
- **Service Workers** - Offline support and caching

## 📱 Browser Compatibility

- **Desktop**: Chrome, Edge, Firefox, Safari (latest versions)
- **Mobile**: iOS Safari 13+, Chrome Android 80+
- **Required**: IndexedDB, Geolocation API, Canvas, Touch Events

## 📝 Documentation

- [QUICKSTART.md](QUICKSTART.md) - Comprehensive getting started guide
- [SETUP.md](SETUP.md) - Deployment and configuration instructions

## 🔖 Versioning

There are two independent identifiers, and one you should leave alone:

| Identifier | Where | Meaning | Changes |
| --- | --- | --- | --- |
| App version | `package.json` → `version` | Release identity, shown in the UI footer | On each user-facing release |
| Build id | Commit SHA, read by `vite.config.js` | Cache-busting key for the app shell | Automatically, every deploy |
| `DB_VERSION` | `src/lib/db.js` | IndexedDB schema version | Only with a schema migration |

**App version — CalVer (`YYYY.M.PATCH`).** The leading number is the release
year and the middle number is the month. The last number is a patch counter,
starting at `0` each month and incrementing for subsequent releases that month:

```
2026.9.0    first release in September 2026
2026.9.1    second release that month
2026.10.0   first release in October 2026
```

CalVer suits a continuously deployed app with no public API: the version tells
you *when* rather than inventing a compatibility guarantee nobody consumes.
Bump `version` in `package.json` as part of the release PR and keep
`package-lock.json` in sync (`npm install` does this). The
[`tag-release` workflow](.github/workflows/tag-release.yml) then tags the merge
commit on `main` automatically and publishes a GitHub Release — you do not run
`git tag` by hand.

Because the version is mapped to `__APP_VERSION__` at build time
(see `vite.config.js`), it is rendered in the MapList footer, which makes it
easy to confirm which release a device is actually running.

**Automated tagging.** On every push to `main` that touches `package.json`, the
`tag-release` workflow compares the version against its parent commit's. If it
changed, the workflow validates the format, creates an annotated tag
`v<version>`, and publishes a Release with generated notes. The tag points at
the merge commit on `main` — the same commit the deploy workflow builds from,
and whose SHA becomes the `BUILD_ID` in the service worker cache name.

It is safe to re-run. A tag that already exists is detected and skipped, so a
retry or a manual `workflow_dispatch` cannot produce a duplicate tag or a
duplicate Release, and runs are serialized by a `tag-release` concurrency
group. Because the version is checked against the *previous* commit, tags
appear once per release rather than on every merge.

**Build id — the commit SHA, never hand-edited.** `vite.config.js` substitutes
it into `public/sw.js`, producing a cache name of the form
`byom-shell-<APP_VERSION>-<BUILD_ID>`. A new cache name is what causes the
browser to install the new service worker and retire the previous shell. The
SHA is unique per deploy by construction, so there is no counter to forget;
local builds fall back to a timestamp, and each dev server run gets its own id
so development never serves a stale shell.

The app uses **two** caches, and the distinction matters:

- `byom-shell-*` — `index.html` and the manifest. Versioned per deployment and
  purged on activate, otherwise `index.html` would be served from the cache
  forever and new deploys would be invisible.
- `byom-assets` — content-hashed bundles, styles and images (e.g.
  `assets/index-CTeZ7-mB.js`). Deliberately **not** versioned: a content-hashed
  URL can never be stale, and retaining it means a tab left open across a
  deployment can still resolve the filenames it was built against. Cleanup is
  scoped to the `byom-shell-` prefix so this cache survives updates.

**`DB_VERSION` is unrelated to releases.** It tracks the shape of the IndexedDB
schema, not the app's version, and it is never purged by a service worker
update — the user's map images and reference points survive every deploy.
Raise it only when the schema changes, and pair the change with a migration in
`onupgradeneeded`.

## 🧪 Testing

Run the unit and integration test suite:

```bash
npm test                 # vitest run
npm run test:watch      # watch mode
npm run test:coverage    # vitest run --coverage, enforces coverage thresholds
```

`npm run test:coverage` measures coverage with the v8 provider and enforces **per-file line thresholds** configured in [`vitest.config.js`](vitest.config.js). The thresholds are the measured post-Svelte-5-migration values: Svelte 5's compiler emits far more instrumented statements per authored line than Svelte 4's, so Svelte-component line coverage is structurally lower despite the same underlying test coverage (MapViewer/MapList were 99%+ under Svelte 4). Values:

| File | Threshold (lines) |
| --- | --- |
| `src/lib/transforms.js` | 100% |
| `src/lib/viewport.js` | 100% |
| `src/lib/draw.js` | 100% |
| `src/lib/db.js` | 100% |
| `src/components/UserPositionMarker.svelte` | 100% |
| `src/MapViewer.svelte` | 68% |
| `src/MapList.svelte` | 62% |

`reportOnFailure` is enabled, so a threshold failure still produces a report to help diagnose regressions. A run that misses a threshold exits non-zero and breaks CI.


### How the mocks work

jsdom alone cannot exercise the browser APIs the app uses, so the suite relies on a small set of test doubles:

- **Canvas 2D context stub** - jsdom has no real 2D context. `tests/setup.js` installs a recorded `HTMLCanvasElement.getContext` stub that captures every draw call as `[method, args]` sequences (exposed via `globalThis.__canvasTestUtil`), so draw code can be asserted without a real canvas.
- **Fake `Image`** - jsdom's `Image` never fires `load`, so `tests/setup.js` provides a `FakeImage` class whose setter fires `onload` on a microtask;tests subclass it to set `width`/`height` (see `MapViewer.test.js`).
- **Geolocation stub** - `navigator.geolocation` is replaced with a stub that records `watchPosition`/`getCurrentPosition` callbacks;tests drive positions via `globalThis.__geolocationTestUtil` (`emitWatchPosition`, `emitCurrentPosition`, `emitWatchError`, and more.). `UserPositionMarker` starts a watch on mount - tests assertthe options, fire positions,,and verify cleanup on destroy.
- **MapLibre mock** - `MapViewer`'s "Select on Map" flow dynamically imports `maplibre-gl`; the component tests mock that module with fake `Map`/`Marker` classes (captured in `maplibreState`) so OSM coordinate selection can be driven headless.
- **fake-indexeddb** - the `db` layer is tested against a real-ish IndexedDB via `fake-indexeddb/auto` (installed in `tests/setup.js`.). `MapViewer` and `MapList` flows mock `src/lib/db.js` directly for speed.
- **`URL.createObjectURL`** - jsdom lacks it;the setup installs a stable fake for blob URLs.


Covered-but-unreachable,browser-only/build-infrastructure files (`src/main.js` - app bootstrap plus service-worker registration,, `public/sw.js` - service worker,, `svelte.config.js` - build config) are excluded from coverage via `coverage.exclude` in `vitest.config.js`,and each is also marked with inline `/* v8 ignore start/stop */` comments documenting why it is not unit-tested.


## 🤝 Contributing

Contributions are welcome! This is an open-source project designed for outdoor navigation, hiking, orienteering, and any scenario where you need to see your position on a custom map.

## 📄 License

MIT License - feel free to use this project for any purpose.
