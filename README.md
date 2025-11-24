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

## 🤝 Contributing

Contributions are welcome! This is an open-source project designed for outdoor navigation, hiking, orienteering, and any scenario where you need to see your position on a custom map.

## 📄 License

MIT License - feel free to use this project for any purpose.
