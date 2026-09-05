# BYOM Quick Start Guide

## What You Have Now

A complete Progressive Web App for georeferencing map photos! Here's what's been created:

### Core Application Files
- ✅ `src/App.svelte` - Main app with routing
- ✅ `src/MapList.svelte` - Landing page with map gallery
- ✅ `src/MapViewer.svelte` - Full-screen map viewer with gestures
- ✅ `src/ReferencePointPicker.svelte` - Reference point creation UI
- ✅ `src/lib/db.js` - IndexedDB storage layer
- ✅ `src/lib/transforms.js` - Similarity & affine transform algorithms
- ✅ `src/main.js` - App entry point with service worker registration
- ✅ `src/app.css` - Global styles

### Configuration Files
- ✅ `package.json` - Dependencies and scripts
- ✅ `vite.config.js` - Build configuration
- ✅ `svelte.config.js` - Svelte configuration
- ✅ `index.html` - HTML entry point

### PWA Files
- ✅ `public/manifest.json` - PWA manifest
- ✅ `public/sw.js` - Service worker for offline support
- ✅ `public/icon-192.svg` - App icon (192x192, needs PNG conversion)
- ✅ `public/icon-512.svg` - App icon (512x512, needs PNG conversion)

### Deployment
- ✅ `.github/workflows/deploy.yml` - Automated GitHub Pages deployment

## Getting Started

### 1. Install Dependencies

```powershell
cd c:\Users\z5154862\byom
npm install
```

### 2. Start Development Server

```powershell
npm run dev
```

Open your browser to the URL shown (usually http://localhost:5173)

### 3. Test the App

**On Desktop:**
- Click "Add Map" to upload a map image
- Click on the map to open the viewer
- Use mouse wheel to zoom, click and drag to pan
- Add reference points to georeference the map

**On Mobile (for best experience):**
- Use Chrome's device emulation (F12 → Toggle device toolbar)
- Or access via your phone on the same network
- Test camera capture and GPS functionality

## Key Features Implemented

### 🗺️ Map Management
- Load images from files or camera
- Store in IndexedDB (no server needed!)
- Generate thumbnails automatically
- Delete maps with all associated data

### 📍 Reference Points
- **Add Points**: Tap image location, then select GPS coordinates
- **3 Methods**: Use current GPS, manual entry, or pick from OSM map
- **Transform Types**: 
  - 2 points → Similarity transform (scale, rotation, translation)
  - 3+ points → Affine transform (least-squares fit)

### 🧭 GPS Tracking
- Real-time position display on map
- Accuracy circle visualization
- Works once reference points are set
- Updates automatically as you move

### 👆 Gesture Support
- **Single finger**: Pan the map
- **Two fingers**: Pinch to zoom, rotate
- **Mouse wheel**: Zoom in/out
- Smooth, responsive touch interactions

### 📱 PWA Features
- **Offline Mode**: Works without internet (after first load)
- **Installable**: Add to home screen on mobile
- **Persistent Storage**: Maps saved locally
- **Service Worker**: Caches assets for offline use

## Before Deploying to GitHub Pages

### 1. Create PNG Icons

You need to convert the SVG icons to PNG. Choose one method:

**Online (Easiest):**
1. Visit https://cloudconvert.com/svg-to-png
2. Upload `public/icon-192.svg`, convert to 192x192 PNG
3. Upload `public/icon-512.svg`, convert to 512x512 PNG
4. Save as `public/icon-192.png` and `public/icon-512.png`

**Command Line (if you have ImageMagick):**
```powershell
magick convert -background none -size 192x192 public/icon-192.svg public/icon-192.png
magick convert -background none -size 512x512 public/icon-512.svg public/icon-512.png
```

### 2. Update Repository Name

If your GitHub repo isn't named "byom", update these files:

**vite.config.js:**
```js
base: '/your-repo-name/',
```

**src/main.js:**
```js
navigator.serviceWorker.register('/your-repo-name/sw.js')
```

**public/manifest.json:**
```json
"start_url": "/your-repo-name/",
```

And update icon paths in manifest.json.

### 3. Deploy

**Option A: GitHub Actions (Automatic)**
1. Push to GitHub
2. Go to Settings → Pages → Source → GitHub Actions
3. Push to `main` branch triggers deployment

**Option B: Manual**
```powershell
npm run deploy
```

## Architecture Overview

```
┌─────────────────────────────────────────────┐
│              User Interface                  │
├─────────────────────────────────────────────┤
│  MapList.svelte    MapViewer.svelte         │
│  (Landing Page)    (Image Viewer)           │
│                    ReferencePointPicker      │
├─────────────────────────────────────────────┤
│           Business Logic                     │
├─────────────────────────────────────────────┤
│  transforms.js     db.js                    │
│  (Math)            (Storage)                │
├─────────────────────────────────────────────┤
│         Browser APIs                         │
├─────────────────────────────────────────────┤
│  IndexedDB  Geolocation  Canvas  MapLibre   │
│  Service Worker  Touch Events               │
└─────────────────────────────────────────────┘
```

### Data Flow

1. **Image Upload** → Blob stored in IndexedDB → Thumbnail generated
2. **Reference Point** → User selects image coords + GPS coords → Stored with map ID
3. **Transform Calculation** → Points retrieved → Similarity/Affine computed
4. **GPS Position** → Current coords → Transform applied → Rendered on canvas

### Storage Schema

**IndexedDB Database: `byom-db`**

**Maps Store:**
```js
{
  id: 1,                    // Auto-increment
  name: "trail-map.jpg",    // Original filename
  imageBlob: Blob,          // Full image
  thumbnail: DataURL,       // Base64 thumbnail
  timestamp: 1234567890     // Creation time
}
```

**Reference Points Store:**
```js
{
  id: 1,                    // Auto-increment
  mapId: 1,                 // Foreign key to maps
  imageX: 1024,             // Image pixel X
  imageY: 768,              // Image pixel Y
  lon: -122.4194,           // Longitude
  lat: 37.7749,             // Latitude
  timestamp: 1234567890     // Creation time
}
```

## Customization Ideas

### Easy Modifications

1. **Change Theme Color**: Edit `theme_color` in `manifest.json` and update button colors in `.svelte` files

2. **Add Map Metadata**: Extend map object in `db.js` to include description, tags, etc.

3. **Export/Import**: Add functions to export maps as JSON and import from files

4. **Share Maps**: Generate shareable links with map data encoded

### Advanced Features

1. **Multiple Layers**: Support overlaying multiple map images

2. **Track Recording**: Record GPS paths and display on map

3. **Offline Maps**: Pre-cache MapLibre tiles for offline coordinate selection

4. **Calibration Quality**: Show residual errors for reference points

5. **Map Rotation Lock**: Option to disable rotation for scanned maps

## Troubleshooting

**Service worker not updating:**
```js
// In DevTools: Application → Service Workers → "Update on reload"
```

**IndexedDB quota exceeded:**
```js
// Check usage in DevTools: Application → Storage
// Consider adding image compression or cleanup
```

**GPS not working:**
- Ensure HTTPS (required for geolocation)
- Check browser permissions
- GitHub Pages provides HTTPS automatically

**Gestures not responsive:**
- Ensure `touch-action: none` on canvas
- Check for event.preventDefault() calls

## Tests

Run the test suite (unit tests for the lib, mocked component flows, and the test harness mocks):

```bash
npm test
```

Run tests with coverage (enforces per-file line-coverage thresholds configured in `vitest.config.js`):

```bash
npm run test:coverage
```

The mocking strategy (canvas stub, fake `Image`, geolocation, maplibre, fake-indexeddb) is documented in the **Testing** section of [README.md](README.md).

## Next Steps

1. ✅ Install dependencies: `npm install`
2. ✅ Test locally: `npm run dev`
3. 🔲 Convert icons to PNG (see above)
4. 🔲 Update repo name in configs
5. 🔲 Push to GitHub
6. 🔲 Enable GitHub Pages
7. 🔲 Test on mobile device
8. 🔲 Share with users!

## Support

- Check `SETUP.md` for detailed deployment instructions
- See `README.md` for project overview
- Review component files for inline documentation

---

Enjoy georeferencing your maps! 🗺️📍
