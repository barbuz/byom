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

- **2 points**: Similarity transform (translation, rotation, uniform scale)
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
│   ├── sw.js                         # Service worker
│   └── icon-*.svg                    # App icons
├── .github/workflows/
│   └── deploy.yml                    # GitHub Actions deployment
├── index.html
├── package.json
├── vite.config.js
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

## 🧪 Testing

Run the unit and integration test suite:

```bash
npm test                 # vitest run
npm run test:watch      # watch mode
npm run test:coverage    # vitest run --coverage, enforces coverage thresholds
```

`npm run test:coverage` measures coverage with the v8 provider and enforces **per-file line thresholds** configured in [`vitest.config.js`](vitest.config.js). The thresholds were recorded from the real numbers captured during the close-out pass:

| File | Threshold (lines) |
| --- | --- |
| `src/lib/transforms.js` | 100% |
| `src/lib/viewport.js` | 100% |
| `src/lib/draw.js` | 100% |
| `src/lib/db.js` | 100% |
| `src/components/UserPositionMarker.svelte` | 100% |
| `src/MapViewer.svelte` | 99% |
| `src/MapList.svelte` | 100% |

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
