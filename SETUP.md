# Instructions for Setting Up BYOM

## Icon Setup

The project includes SVG placeholders for icons. To create proper PNG icons:

### Option 1: Online Converter
1. Go to https://cloudconvert.com/svg-to-png
2. Upload `public/icon-192.svg` and convert to PNG (192x192)
3. Upload `public/icon-512.svg` and convert to PNG (512x512)
4. Save the PNGs as `public/icon-192.png` and `public/icon-512.png`

### Option 2: Using Inkscape (if installed)
```bash
inkscape public/icon-192.svg -w 192 -h 192 -o public/icon-192.png
inkscape public/icon-512.svg -w 512 -h 512 -o public/icon-512.png
```

### Option 3: Using ImageMagick (if installed)
```bash
magick convert -background none -size 192x192 public/icon-192.svg public/icon-192.png
magick convert -background none -size 512x512 public/icon-512.svg public/icon-512.png
```

### Option 4: Design Your Own
Create custom PNG icons at 192x192 and 512x512 pixels using any graphics editor.

## GitHub Pages Configuration

Before deploying, update `vite.config.js`:

1. Change the `base` path to match your repository name:
   ```js
   base: '/your-repo-name/',
   ```

2. Update `src/main.js` service worker path to match:
   ```js
   navigator.serviceWorker.register('/your-repo-name/sw.js')
   ```

3. Update `public/manifest.json` paths:
   ```json
   "start_url": "/your-repo-name/",
   "icons": [
     {
       "src": "/your-repo-name/icon-192.png",
       ...
     },
     {
       "src": "/your-repo-name/icon-512.png",
       ...
     }
   ]
   ```

## Deploying to GitHub Pages

### Using GitHub Actions (Recommended)

1. Push your code to GitHub
2. Go to Settings → Pages
3. Under "Source", select "GitHub Actions"
4. Push to the `main` branch to trigger deployment

### Manual Deployment

```bash
npm run deploy
```

This will build and push to the `gh-pages` branch.

## Development

```bash
# Install dependencies
npm install

# Start dev server
npm run dev

# Build for production
npm run build

# Preview production build
npm run preview
```

## Testing Offline Functionality

1. Build and serve the production version
2. Open browser DevTools
3. Go to Application → Service Workers
4. Check "Offline" mode
5. Reload the page - the app should still work
6. IndexedDB will persist your maps and reference points

## Browser Compatibility

- **Required**: Modern browsers with IndexedDB, Geolocation API, and Canvas support
- **Recommended**: Chrome/Edge/Safari/Firefox (latest versions)
- **Mobile**: iOS Safari 13+, Chrome Android 80+

## Known Limitations

- IndexedDB storage limits vary by browser (typically 50-100MB+)
- GPS accuracy depends on device hardware
- MapLibre map requires internet connection initially
- Service worker caching improves over time with usage
