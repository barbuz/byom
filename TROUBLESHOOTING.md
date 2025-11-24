# BYOM - Troubleshooting Guide

Common issues and solutions for the BYOM (Bring Your Own Map) app.

## Installation Issues

### `npm install` fails

**Problem**: Dependencies fail to install

**Solutions**:
```powershell
# Clear npm cache
npm cache clean --force

# Delete node_modules and package-lock.json
Remove-Item -Recurse -Force node_modules
Remove-Item package-lock.json

# Reinstall
npm install
```

### Svelte compilation errors

**Problem**: "Cannot find module '@sveltejs/vite-plugin-svelte'"

**Solution**: Ensure all devDependencies are installed:
```powershell
npm install --save-dev @sveltejs/vite-plugin-svelte svelte vite
```

## Development Server Issues

### Port already in use

**Problem**: "Port 5173 is already in use"

**Solutions**:
```powershell
# Find process using port 5173
Get-NetTCPConnection -LocalPort 5173 | Select-Object OwningProcess
Stop-Process -Id <ProcessId>

# Or specify different port
npm run dev -- --port 3000
```

### Changes not reflecting

**Problem**: Code changes don't appear in browser

**Solutions**:
1. Hard refresh: `Ctrl+Shift+R` or `Cmd+Shift+R`
2. Clear browser cache
3. Restart dev server
4. Check for console errors

## Runtime Issues

### IndexedDB not working

**Problem**: Maps don't persist or "Failed to load maps" error

**Solutions**:
1. **Check browser compatibility**: IndexedDB requires modern browsers
2. **Check browser settings**: Ensure cookies/storage not blocked
3. **Private/Incognito mode**: IndexedDB may be disabled
4. **Clear storage**:
   ```js
   // In browser console
   indexedDB.deleteDatabase('byom-db')
   location.reload()
   ```

### GPS not working

**Problem**: "GPS error" or position not updating

**Solutions**:

1. **HTTPS required**: Geolocation API requires secure context
   - Use `localhost` (automatically secure)
   - Or use HTTPS (GitHub Pages provides this)

2. **Browser permissions**: 
   - Check browser address bar for location permission
   - Grant permission when prompted
   - Reset in browser settings if denied

3. **Device GPS**:
   - Enable location services on device
   - Ensure GPS signal (outdoors or near window)
   - Wait 10-30 seconds for first fix

4. **Desktop testing**:
   - Some browsers simulate location
   - Chrome: DevTools → Sensors → Location

### Images not loading

**Problem**: Blank thumbnails or "Failed to load map" 

**Solutions**:

1. **File size**: Very large images may fail
   - Try smaller images (< 5MB recommended)
   - Browser may limit IndexedDB storage

2. **File format**: 
   - Use JPG, PNG, or WebP
   - Some browsers don't support all formats

3. **Blob issues**:
   ```js
   // In browser console, check if blob stored correctly
   const db = await indexedDB.open('byom-db', 1)
   // Inspect maps store
   ```

### MapLibre not loading

**Problem**: OSM map doesn't appear when selecting coordinates

**Solutions**:

1. **Internet required**: MapLibre needs internet for first load
2. **CORS issues**: Should work from localhost or HTTPS
3. **Check console**: Look for network errors
4. **Fallback**: Use GPS or manual coordinate entry

### Touch gestures not working

**Problem**: Can't zoom/pan/rotate on mobile

**Solutions**:

1. **Viewport meta tag**: Check index.html has:
   ```html
   <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
   ```

2. **Touch-action**: Canvas should have `touch-action: none`

3. **Event handlers**: Check browser console for errors

4. **Device compatibility**: Test on different devices

## Build Issues

### Build fails

**Problem**: `npm run build` errors

**Solutions**:

```powershell
# Clear Vite cache
Remove-Item -Recurse -Force node_modules/.vite
Remove-Item -Recurse -Force dist

# Rebuild
npm run build
```

### Assets not loading in production

**Problem**: Icons/images 404 in built version

**Solutions**:

1. **Base path**: Ensure `vite.config.js` base matches repo name:
   ```js
   base: '/byom/',  // Must match GitHub repo name
   ```

2. **Check paths**: All assets should use relative or base-aware paths

3. **Public folder**: Files in `public/` are copied as-is

## Deployment Issues

### GitHub Pages 404

**Problem**: Page not found after deployment

**Solutions**:

1. **Enable GitHub Pages**:
   - Settings → Pages → Source: "GitHub Actions"

2. **Base path**: Update vite.config.js:
   ```js
   base: '/repository-name/',
   ```

3. **Update all paths**:
   - manifest.json
   - service worker registration
   - Icons in manifest

4. **Check workflow**: 
   - Actions tab → Check for failed builds
   - View workflow logs

### Service Worker not updating

**Problem**: Old version cached after deployment

**Solutions**:

1. **Hard refresh**: `Ctrl+Shift+F5`

2. **Unregister old worker**:
   - DevTools → Application → Service Workers
   - Click "Unregister"
   - Refresh page

3. **Update cache name**: In `public/sw.js`:
   ```js
   const CACHE_NAME = 'byom-v2';  // Increment version
   ```

4. **Clear site data**:
   - DevTools → Application → Clear storage
   - Check all boxes → "Clear site data"

### Icons not showing

**Problem**: Default browser icon instead of app icon

**Solutions**:

1. **Convert to PNG**: Manifest requires PNG, not SVG
   - See QUICKSTART.md for conversion methods

2. **Check paths**: Icon paths in manifest.json must be absolute:
   ```json
   "/byom/icon-192.png"
   ```

3. **Clear cache**: PWA icons are aggressively cached

4. **Reinstall**: Remove app from home screen, reinstall

## Performance Issues

### Slow rendering

**Problem**: Canvas rendering laggy

**Solutions**:

1. **Reduce image size**: Scale images before storing
2. **Optimize transforms**: Limit render() calls
3. **Throttle GPS**: Reduce update frequency
4. **Device limitations**: Lower-end devices may struggle

### Storage quota exceeded

**Problem**: "QuotaExceededError" when adding maps

**Solutions**:

1. **Check usage**:
   - DevTools → Application → Storage
   - See IndexedDB size

2. **Delete old maps**: Remove unused maps

3. **Compress images**:
   - Reduce quality when creating thumbnails
   - Scale down full images before storing

4. **Browser limits**: 
   - Chrome: ~50% of available disk space
   - Safari: More restrictive, especially on iOS

## Testing Tips

### Test offline mode

```
1. Open DevTools → Application → Service Workers
2. Check "Offline"
3. Refresh page
4. App should still load and function
```

### Test on mobile

```
1. Get your local IP: ipconfig (Windows) or ifconfig (Mac/Linux)
2. On phone, browse to http://YOUR_IP:5173
3. Test camera, GPS, gestures
```

### Debug IndexedDB

```js
// In browser console
const request = indexedDB.open('byom-db', 1);
request.onsuccess = () => {
  const db = request.result;
  const tx = db.transaction(['maps'], 'readonly');
  const store = tx.objectStore('maps');
  const getAllRequest = store.getAll();
  getAllRequest.onsuccess = () => {
    console.log('All maps:', getAllRequest.result);
  };
};
```

### Debug transforms

```js
// In browser console after selecting MapViewer component
// Check if transform is calculated
console.log(geoTransform, geoTransformType);
```

## Getting Help

If you're still experiencing issues:

1. **Check browser console**: Most errors logged there
2. **Check network tab**: For failed requests
3. **Check application tab**: For storage/service worker issues
4. **Test in different browser**: Isolate browser-specific issues
5. **Test on different device**: Check mobile vs desktop
6. **Create minimal reproduction**: Isolate the problem

## Known Limitations

- **Storage**: Browser-dependent, typically 50-100MB+
- **GPS accuracy**: Depends on device hardware (5-50m typical)
- **Offline maps**: MapLibre requires internet initially
- **Image formats**: Not all browsers support all image types
- **Battery**: GPS tracking can drain battery quickly
- **CORS**: Some tile servers may have restrictions

## Browser-Specific Issues

### Safari/iOS

- More restrictive storage quotas
- Requires user gesture for geolocation
- Service workers may behave differently
- "Add to Home Screen" for full PWA experience

### Firefox

- IndexedDB implementation may differ slightly
- Check `about:config` → `dom.indexedDB.enabled`

### Chrome/Edge

- Generally best compatibility
- Can inspect service workers more easily
- Better DevTools for debugging

## Performance Optimization

For better performance:

1. **Compress images** before uploading
2. **Limit reference points** to necessary minimum (2-4 is usually enough)
3. **Close unused maps** to free memory
4. **Clear old data** periodically
5. **Use WiFi** for initial load/map selection

---

Still stuck? Check the code comments in the source files for implementation details.
