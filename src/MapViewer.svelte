<script>
  import { untrack } from 'svelte';
  import { getMap, getReferencePoints } from './lib/db.js';
  import { calculateTransform, geoToUV, geoDistanceToUV, imageDivisor } from './lib/transforms.js';
  import { screenToImage, getPointAtScreen, pinchZoomTransform, centerOnImagePoint } from './lib/viewport.js';
  import UserPositionMarker from './components/UserPositionMarker.svelte';
  import './styles/MapViewer.css';

  let { mapId } = $props();

  let map = $state(null);
  let imageUrl = $state(null);
  let referencePoints = $state([]);
  let canvas = $state(null);
  let ctx = $state(null);
  let imageElement = $state(null);
  let imageReady = false;

  // Transform state
  let transform = $state({
    scale: 1,
    translateX: 0,
    translateY: 0,
    rotation: 0,
  });

  // Image dimensions
  let imageWidth = $state(0);
  let imageHeight = $state(0);

  // Canvas dimensions
  let canvasWidth = $state(0);
  let canvasHeight = $state(0);

  // Touch/gesture state
  let isPanning = $state(false);
  let lastTouchDistance = $state(0);
  let lastTouchAngle = $state(0);
  let lastTouchCenter = $state({ x: 0, y: 0 });
  let touchStartCenter = $state({ x: 0, y: 0 });
  let touchStartTransform = $state(null);

  // Mouse interaction state
  let isMouseDown = $state(false);
  let mouseStartPos = $state(null);
  let mouseStartTransform = $state(null);
  let mouseDragged = $state(false);

  // Transform state for GPS
  let geoTransform = $state(null);
  let geoTransformError = $state(null);
  let userPositionMarker = $state(null);


  // UI state
  let showingPoints = $state(false);
  let editingPoint = $state(null);
  let hoverPointIndex = $state(-1);
  let showingDebug = $state(false);
  let pendingReferencePoint = $state(null);
  let showingCoordinateSelection = $state(false);
  let coordinateMethod = $state(null);
  let manualLat = $state('');
  let manualLon = $state('');
  let gpsPosition = $state(null);
  let gpsError = $state(null);
  let selectedLon = $state(null);
  let selectedLat = $state(null);
  let selectedAccuracy = $state(null);
  let mapContainer = $state(null);
  let osmMap = $state(null);
  let osmMapMarker = $state(null);

  // Rendering state
  let animationFrameId = $state(null);
  let needsRender = $state(false);

    $effect(() => {
    untrack(() => {
      // setupCanvas reads imageUrl, which loadMapData resolves asynchronously;
      // awaiting here keeps the image source from being set to null.
      (async () => {
        await loadMapData();
        setupCanvas();
      })();
    });
    window.addEventListener('resize', handleResize);

    return () => {
      if (imageUrl) {
        URL.revokeObjectURL(imageUrl);
      }
      if (animationFrameId) {
        cancelAnimationFrame(animationFrameId);
      }
      window.removeEventListener('resize', handleResize);
    };
  });



  async function loadMapData() {
    try {
      map = await getMap(parseInt(mapId));
      if (!map) {
        alert('Map not found');
        goBack();
        return;
      }

      // Convert blob to URL
      imageUrl = URL.createObjectURL(map.imageBlob);

      // Load reference points
      referencePoints = await getReferencePoints(parseInt(mapId));
      updateGeoTransform();

    } catch (error) {
      console.error('Error loading map:', error);
      alert('Failed to load map');
      goBack();
    }
  }

  function setupCanvas() {
    if (!canvas || !imageUrl) return;

    ctx = canvas.getContext('2d');
    handleResize();

    // Load image
    imageReady = false;
    imageElement = new Image();
    imageElement.onload = () => {
      imageWidth = imageElement.width;
      imageHeight = imageElement.height;
      imageReady = true;
      fitImageToCanvas();
      scheduleRender();
    };
    imageElement.onerror = () => {
      imageReady = false;
      console.error('Failed to load map image:', imageUrl);
    };
    imageElement.src = imageUrl;
  }

  function handleResize() {
    if (!canvas) return;
    canvasWidth = window.innerWidth;
    canvasHeight = window.innerHeight;
    canvas.width = canvasWidth;
    canvas.height = canvasHeight;
    
    if (imageWidth > 0) {
      scheduleRender();
    }
  }

  function fitImageToCanvas() {
    const scaleX = canvasWidth / imageWidth;
    const scaleY = canvasHeight / imageHeight;
    transform.scale = Math.min(scaleX, scaleY) * 0.9;
    transform.translateX = canvasWidth / 2;
    transform.translateY = canvasHeight / 2;
  }

  /** Pixels -> [0,1] fractions using the single divisor D = max(width, height). */
  function pixelsToUV(x, y) {
    const divisor = imageDivisor(imageWidth, imageHeight);
    return { u: x / divisor, v: y / divisor };
  }

  /** [0,1] fractions -> pixels, for the pixel-space rendering/viewport edges. */
  function uvToPixels(point) {
    const divisor = imageDivisor(imageWidth, imageHeight);
    return { ...point, imageX: point.u * divisor, imageY: point.v * divisor };
  }

  function scheduleRender() {
    if (needsRender) return;
    needsRender = true;
    if (animationFrameId) cancelAnimationFrame(animationFrameId);
    animationFrameId = requestAnimationFrame(render);
  }

  function render() {
    needsRender = false;
    // drawImage throws InvalidStateError on a broken or not-yet-loaded image,
    // so skip until the source has decoded.
    if (!ctx || !imageElement || !imageReady) return;

    ctx.clearRect(0, 0, canvasWidth, canvasHeight);
    ctx.save();

    // Apply transformations
    ctx.translate(transform.translateX, transform.translateY);
    ctx.rotate(transform.rotation);
    ctx.scale(transform.scale, transform.scale);
    ctx.translate(-imageWidth / 2, -imageHeight / 2);

    // Draw image
    ctx.drawImage(imageElement, 0, 0, imageWidth, imageHeight);

    // Draw reference points
    ctx.restore();
    ctx.save();
    ctx.translate(transform.translateX, transform.translateY);
    ctx.rotate(transform.rotation);
    ctx.scale(transform.scale, transform.scale);
    ctx.translate(-imageWidth / 2, -imageHeight / 2);

    referencePoints.forEach((point, index) => {
      const isHovered = hoverPointIndex === index;
      const isEditing = editingPoint && editingPoint.id === point.id;
      const { imageX, imageY } = uvToPixels(point);
      
      if (showingPoints || isEditing) {
        // Draw accuracy ring if the point was captured with GPS accuracy
        if (point.accuracy && geoTransform) {
          const accuracyRadius = geoDistanceToUV(
            point.lon,
            point.lat,
            point.accuracy,
            geoTransform
          ) * imageDivisor(imageWidth, imageHeight);
          ctx.fillStyle = 'rgba(33, 150, 243, 0.1)';
          ctx.strokeStyle = 'rgba(33, 150, 243, 0.35)';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(imageX, imageY, accuracyRadius, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
        }

        ctx.fillStyle = isEditing ? 'rgba(255, 152, 0, 0.9)' : isHovered ? 'rgba(33, 150, 243, 0.9)' : 'rgba(33, 150, 243, 0.7)';
        ctx.beginPath();
        ctx.arc(imageX, imageY, isHovered || isEditing ? 12 : 8, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = 'white';
        ctx.lineWidth = isEditing ? 3 : 2;
        ctx.stroke();
        
        // Draw number label
        ctx.save();
        ctx.translate(imageX, imageY);
        ctx.scale(1 / transform.scale, 1 / transform.scale);
        ctx.rotate(-transform.rotation);
        
        ctx.font = 'bold 14px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        
        const labelY = -25;
        const labelText = (index + 1).toString();
        const textWidth = ctx.measureText(labelText).width;
        
        ctx.fillStyle = isEditing ? '#FF9800' : '#2196F3';
        ctx.fillRect(-(textWidth / 2 + 6), labelY - 10, textWidth + 12, 20);
        
        ctx.fillStyle = 'white';
        ctx.fillText(labelText, 0, labelY);
        
        ctx.restore();
      } else {
        // ctx.fillStyle = 'rgba(33, 150, 243, 0.7)';
        // ctx.beginPath();
        // ctx.arc(point.imageX, point.imageY, 6, 0, Math.PI * 2);
        // ctx.fill();
        // ctx.strokeStyle = 'white';
        // ctx.lineWidth = 2;
        // ctx.stroke();
      }
    });

    ctx.restore();

    // Draw pending reference point
    if (pendingReferencePoint) {
      const pending = uvToPixels(pendingReferencePoint);
      ctx.save();
      ctx.translate(transform.translateX, transform.translateY);
      ctx.rotate(transform.rotation);
      ctx.scale(transform.scale, transform.scale);
      ctx.translate(-imageWidth / 2, -imageHeight / 2);

      // Draw pending point marker
      ctx.fillStyle = 'rgba(255, 152, 0, 0.9)';
      ctx.beginPath();
      ctx.arc(pending.imageX, pending.imageY, 15, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'white';
      ctx.lineWidth = 3;
      ctx.stroke();

      // Draw pulsing effect
      ctx.strokeStyle = 'rgba(255, 152, 0, 0.5)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(pending.imageX, pending.imageY, 20, 0, Math.PI * 2);
      ctx.stroke();

      ctx.restore();
    }

    // Draw user position marker
    if (userPositionMarker) {
      userPositionMarker.drawUserPosition(ctx);
    }
  }

  function updateGeoTransform() {
    try {
      geoTransform = calculateTransform(referencePoints);
      geoTransformError = null;
    } catch (error) {
      // A degenerate point set (e.g. two points sharing GPS coordinates but
      // not image coordinates) has no valid georeference. That is a property
      // of the stored points, not a load failure: keep the map usable so the
      // offending points can be edited or deleted.
      console.error('Error computing georeference:', error);
      geoTransform = null;
      geoTransformError = error.message;
    }
  }


  // Touch event handlers
  function handleTouchStart(e) {
    if (e.touches.length === 1) {
      isPanning = true;
      lastTouchCenter = { x: e.touches[0].clientX, y: e.touches[0].clientY };
      touchStartTransform = { ...transform };
    } else if (e.touches.length === 2) {
      isPanning = false;
      const touch1 = e.touches[0];
      const touch2 = e.touches[1];
      
      lastTouchDistance = Math.hypot(
        touch2.clientX - touch1.clientX,
        touch2.clientY - touch1.clientY
      );
      
      lastTouchAngle = Math.atan2(
        touch2.clientY - touch1.clientY,
        touch2.clientX - touch1.clientX
      );
      
      lastTouchCenter = {
        x: (touch1.clientX + touch2.clientX) / 2,
        y: (touch1.clientY + touch2.clientY) / 2,
      };
      touchStartCenter = { ...lastTouchCenter };

      touchStartTransform = { ...transform };
    }
  }

  function handleTouchMove(e) {
    if (e.touches.length === 1 && isPanning) {
      const touch = e.touches[0];
      const dx = touch.clientX - lastTouchCenter.x;
      const dy = touch.clientY - lastTouchCenter.y;
      
      transform.translateX = touchStartTransform.translateX + dx;
      transform.translateY = touchStartTransform.translateY + dy;
      scheduleRender();
    } else if (e.touches.length === 2) {
      const touch1 = e.touches[0];
      const touch2 = e.touches[1];
      
      const distance = Math.hypot(
        touch2.clientX - touch1.clientX,
        touch2.clientY - touch1.clientY
      );
      
      const angle = Math.atan2(
        touch2.clientY - touch1.clientY,
        touch2.clientX - touch1.clientX
      );
      
      const center = {
        x: (touch1.clientX + touch2.clientX) / 2,
        y: (touch1.clientY + touch2.clientY) / 2,
      };
      
      // Scale
      const scaleFactor = distance / lastTouchDistance;
      const newScale = touchStartTransform.scale * scaleFactor;
      const clampedScale = Math.max(0.1, Math.min(10, newScale));

      // Zoom to the gesture scale and pan so the image point that was under
      // the starting pinch center follows the (moving) current center.
      const zoomed = pinchZoomTransform(center, touchStartTransform, clampedScale, touchStartCenter);
      transform.translateX = zoomed.translateX;
      transform.translateY = zoomed.translateY;
      transform.scale = zoomed.scale;

      // Rotation disabled for the moment 
      // const rotationDelta = angle - lastTouchAngle;
      // transform.rotation = touchStartTransform.rotation + rotationDelta;
      
      scheduleRender();
    }
  }

  function handleTouchEnd() {
    isPanning = false;
  }

  function startNewPoint(screenX, screenY) {
    // Convert screen coordinates to image coordinates
    const imageCoords = screenToImage(screenX, screenY, transform, imageWidth, imageHeight);
    
    if (imageCoords) {
      const { u, v } = pixelsToUV(imageCoords.x, imageCoords.y);
      pendingReferencePoint = {
        u,
        v,
        screenX: screenX,
        screenY: screenY
      };
      
      scheduleRender();
      showCoordinateSelection();
    }
  }

  /** @returns {boolean} whether an existing point was hit and opened for editing */
  function handlePointEditing(screenX, screenY) {
    if (!showingPoints) return false;
    
    const pointIndex = getPointAtScreen(screenX, screenY, referencePoints.map(uvToPixels), transform, imageWidth, imageHeight);

    if (pointIndex < 0) return false;
    
    editingPoint = { ...referencePoints[pointIndex], index: pointIndex };
    scheduleRender();
    return true;
  }

  function handleCanvasClick(e) {
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    
    // A mouse drag to pan still emits a trailing click; ignore it so panning
    // never adds a point. Touch drags emit no click at all.
    if (mouseDragged) {
      mouseDragged = false;
      return;
    }

    // A tap on an existing point edits it; any other tap starts a new point.
    if (!handlePointEditing(x, y)) {
      startNewPoint(x, y);
    }
  }

  function handleCanvasMouseMove(e) {
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    
    // Handle hover effects for points
    if (showingPoints) {
      const pointIndex = getPointAtScreen(x, y, referencePoints.map(uvToPixels), transform, imageWidth, imageHeight);
      
      if (pointIndex !== hoverPointIndex) {
        hoverPointIndex = pointIndex;
        canvas.style.cursor = pointIndex >= 0 ? 'pointer' : 'default';
        scheduleRender();
      }
    } else {
      if (hoverPointIndex !== -1) {
        hoverPointIndex = -1;
        canvas.style.cursor = 'default';
        scheduleRender();
      }
    }
    
    // Handle panning with mouse drag
    if (isMouseDown && mouseStartPos) {
      const dx = x - mouseStartPos.x;
      const dy = y - mouseStartPos.y;

      if (Math.abs(dx) > 5 || Math.abs(dy) > 5) mouseDragged = true;

      transform.translateX = mouseStartTransform.translateX + dx;
      transform.translateY = mouseStartTransform.translateY + dy;
      scheduleRender();
    }
  }

  function handleWheel(e) {
    e.preventDefault();
    const scaleFactor = e.deltaY > 0 ? 0.9 : 1.1;
    transform.scale *= scaleFactor;
    transform.scale = Math.max(0.1, Math.min(10, transform.scale));
    scheduleRender();
  }

  function handleMouseDown(e) {
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    
    isMouseDown = true;
    mouseDragged = false;
    mouseStartPos = { x, y };
    mouseStartTransform = { ...transform };
  }

  function handleMouseUp(e) {
    isMouseDown = false;
    mouseStartPos = null;
    mouseStartTransform = null;
  }

  function goBack() {
    window.location.hash = '';
  }

  function centerOnUser() {
    const position = userPositionMarker?.userPosition;
    if (!position || !geoTransform) return;

    let imageCoords;
    try {
      const { u, v } = geoToUV(position.longitude, position.latitude, geoTransform);
      const divisor = imageDivisor(imageWidth, imageHeight);
      imageCoords = { imageX: u * divisor, imageY: v * divisor };
    } catch (error) {
      console.error('Error centering on user position:', error);
      return;
    }

    transform = centerOnImagePoint(
      imageCoords.imageX,
      imageCoords.imageY,
      transform,
      imageWidth,
      imageHeight,
      { x: canvasWidth / 2, y: canvasHeight / 2 },
    );
    scheduleRender();
  }

  function togglePoints() {
    showingPoints = !showingPoints;
    if (!showingPoints) {
      editingPoint = null;
      hoverPointIndex = -1;
    }
    scheduleRender();
  }

  function isValidCoordinate(lat, lon) {
    return Number.isFinite(lat) && Number.isFinite(lon) &&
      lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180;
  }

  /**
   * Return the fitter's error message for a candidate point set, or null when
   * it georeferences cleanly. Reusing calculateTransform's own validation
   * catches every degenerate case (duplicate GPS coordinates, collinear
   * points, ...), not just the ones enumerated here.
   */
  function transformErrorFor(points) {
    try {
      calculateTransform(points);
      return null;
    } catch (error) {
      return error.message;
    }
  }

  async function saveEditedPoint() {
    if (!editingPoint) return;

    // An emptied numeric field binds to null/undefined; persisting that would
    // leave the map unloadable once the fitters reject the point.
    if (!isValidCoordinate(editingPoint.lat, editingPoint.lon)) {
      alert('Latitude must be between -90 and 90 and longitude between -180 and 180');
      return;
    }

    // Guard the edited set too, so a correction cannot itself brick the map.
    // This is also the recovery path: an edit that makes the points distinct
    // validates cleanly and is allowed through.
    const candidate = referencePoints.map((point) =>
      point.id === editingPoint.id
        ? { ...point, lon: editingPoint.lon, lat: editingPoint.lat }
        : point,
    );
    const transformError = transformErrorFor(candidate);
    if (transformError) {
      alert(`Cannot save this point: ${transformError}`);
      return;
    }

    try {
      const { updateReferencePoint } = await import('./lib/db.js');
      await updateReferencePoint(editingPoint.id, {
        lon: editingPoint.lon,
        lat: editingPoint.lat,
      });
      
      editingPoint = null;
      await loadMapData();
      scheduleRender();
    } catch (error) {
      console.error('Error updating point:', error);
      alert('Failed to update point');
    }
  }

  async function deleteEditingPoint() {
    if (!editingPoint || !confirm('Delete this reference point?')) return;
    
    try {
      const { deleteReferencePoint } = await import('./lib/db.js');
      await deleteReferencePoint(editingPoint.id);
      
      editingPoint = null;
      await loadMapData();
      scheduleRender();
    } catch (error) {
      console.error('Error deleting point:', error);
      alert('Failed to delete point');
    }
  }

  function cancelEdit() {
    editingPoint = null;
    scheduleRender();
  }

  function toggleDebug() {
    showingDebug = !showingDebug;
  }

  function showCoordinateSelection() {
    showingCoordinateSelection = true;
    coordinateMethod = null;
    selectedLon = null;
    selectedLat = null;
    selectedAccuracy = null;
    manualLat = '';
    manualLon = '';
    gpsPosition = null;
    gpsError = null;
  }

  function hideCoordinateSelection() {
    showingCoordinateSelection = false;
    pendingReferencePoint = null;
    scheduleRender();
  }

  function selectCoordinateMethod(method) {
    coordinateMethod = method;
    
    if (method === 'gps') {
      getCurrentGPS();
    } else if (method === 'map') {
      setTimeout(() => initMap(), 100);
    }
  }

  function getCurrentGPS() {
    gpsError = null;
    
    if (!navigator.geolocation) {
      gpsError = 'Geolocation not supported';
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        gpsPosition = {
          lat: position.coords.latitude,
          lon: position.coords.longitude,
          accuracy: position.coords.accuracy,
        };
        selectedLat = gpsPosition.lat;
        selectedLon = gpsPosition.lon;
        selectedAccuracy = gpsPosition.accuracy;
      },
      (error) => {
        gpsError = `GPS error: ${error.message}`;
      },
      {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 0,
      }
    );
  }

  function useManualCoordinates() {
    const lat = parseFloat(manualLat);
    const lon = parseFloat(manualLon);
    
    if (isNaN(lat) || isNaN(lon)) {
      alert('Please enter valid numbers');
      return;
    }
    
    if (lat < -90 || lat > 90) {
      alert('Latitude must be between -90 and 90');
      return;
    }
    
    if (lon < -180 || lon > 180) {
      alert('Longitude must be between -180 and 180');
      return;
    }
    
    selectedLat = lat;
    selectedLon = lon;
    selectedAccuracy = null;
  }

  async function initMap() {
    if (!mapContainer) return;

    // Dynamically import MapLibre
    const maplibregl = await import('maplibre-gl');

    // Calculate initial center and zoom
    let initialCenter = [0, 0];
    let initialZoom = 2;

    if (referencePoints.length > 0) {
      // Calculate bounds of existing reference points
      let minLat = Infinity, maxLat = -Infinity;
      let minLon = Infinity, maxLon = -Infinity;
      
      referencePoints.forEach(point => {
        minLat = Math.min(minLat, point.lat);
        maxLat = Math.max(maxLat, point.lat);
        minLon = Math.min(minLon, point.lon);
        maxLon = Math.max(maxLon, point.lon);
      });
      
      // Calculate center
      const avgLat = (minLat + maxLat) / 2;
      const avgLon = (minLon + maxLon) / 2;
      initialCenter = [avgLon, avgLat];
      
      // Calculate zoom to fit all points with padding
      const latDiff = maxLat - minLat;
      const lonDiff = maxLon - minLon;
      const maxDiff = Math.max(latDiff, lonDiff);
      
      // Adjust zoom based on the spread of points
      if (maxDiff > 10) {
        initialZoom = 4; // Very large area (country/continental)
      } else if (maxDiff > 5) {
        initialZoom = 6; // Large area (state/province)
      } else if (maxDiff > 1) {
        initialZoom = 8; // Medium area (city/region)
      } else if (maxDiff > 0.1) {
        initialZoom = 10; // Small area (neighborhood)
      } else if (maxDiff > 0.01) {
        initialZoom = 12; // Very small area (street level)
      } else {
        initialZoom = 14; // Tiny area (building level)
      }
    } else if (userPositionMarker?.userPosition) {
      // Use current GPS location
      initialCenter = [userPositionMarker.userPosition.longitude, userPositionMarker.userPosition.latitude];
      initialZoom = 14; // Street level zoom for GPS location
    }

    osmMap = new maplibregl.Map({
      container: mapContainer,
      style: {
        version: 8,
        sources: {
          osm: {
            type: 'raster',
            tiles: [
              'https://a.tile.openstreetmap.org/{z}/{x}/{y}.png',
              'https://b.tile.openstreetmap.org/{z}/{x}/{y}.png',
              'https://c.tile.openstreetmap.org/{z}/{x}/{y}.png',
            ],
            tileSize: 256,
            attribution: '© OpenStreetMap contributors',
          },
        },
        layers: [
          {
            id: 'osm',
            type: 'raster',
            source: 'osm',
          },
        ],
      },
      center: initialCenter,
      zoom: initialZoom,
    });

    osmMap.on('click', (e) => {
      const { lng, lat } = e.lngLat;
      selectedLon = lng;
      selectedLat = lat;
      selectedAccuracy = null;

      // Add/update marker
      if (osmMapMarker) {
        osmMapMarker.setLngLat([lng, lat]);
      } else {
        osmMapMarker = new maplibregl.Marker({ color: '#2196F3' })
          .setLngLat([lng, lat])
          .addTo(osmMap);
      }
    });

    // Fallback: try to get user's location if we still don't have a good center
    if (referencePoints.length === 0 && !userPositionMarker?.userPosition && navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          osmMap.setCenter([position.coords.longitude, position.coords.latitude]);
          osmMap.setZoom(14); // Street level zoom
        },
        () => {
          // Ignore error, keep default center
        }
      );
    }
  }

  async function saveReferencePoint() {
    if (!pendingReferencePoint || selectedLon === null || selectedLat === null) return;

    // Refuse a point that would leave the map without a valid georeference,
    // rather than persisting a set that renders the map unusable.
    const candidate = [
      ...referencePoints,
      { u: pendingReferencePoint.u, v: pendingReferencePoint.v, lon: selectedLon, lat: selectedLat },
    ];
    const transformError = transformErrorFor(candidate);
    if (transformError) {
      alert(`Cannot add this point: ${transformError}`);
      return;
    }

    try {
      const { addReferencePoint } = await import('./lib/db.js');
      await addReferencePoint({
        mapId: parseInt(mapId),
        u: pendingReferencePoint.u,
        v: pendingReferencePoint.v,
        lon: selectedLon,
        lat: selectedLat,
        accuracy: selectedAccuracy,
      });

      hideCoordinateSelection();
      await loadMapData();
      scheduleRender();
    } catch (error) {
      console.error('Error saving reference point:', error);
      alert('Failed to save reference point');
    }
  }

  let canSavePoint = $derived(pendingReferencePoint && selectedLon !== null && selectedLat !== null);
  let needsMorePoints = $derived(referencePoints.length < 3);
  let canCenterOnUser = $derived(Boolean(userPositionMarker?.userPosition && geoTransform));
</script>

<div class="viewer-container">
  <UserPositionMarker
    bind:this={userPositionMarker}
    {geoTransform}
    {transform}
    {imageWidth}
    {imageHeight}
    scheduleRender={scheduleRender}
  />
  
  <canvas
    bind:this={canvas}
    ontouchstart={handleTouchStart}
    ontouchmove={handleTouchMove}
    ontouchend={handleTouchEnd}
    onwheel={handleWheel}
    onclick={handleCanvasClick}
    onmousemove={handleCanvasMouseMove}
    onmousedown={handleMouseDown}
    onmouseup={handleMouseUp}
    onmouseleave={handleMouseUp}
  ></canvas>

  <div class="controls">
    <button class="control-btn back-btn" onclick={goBack}>
      ← Back
    </button>

    <button 
      class="control-btn edit-points-btn {showingPoints ? 'active' : ''}" 
      onclick={togglePoints}
    >
      {showingPoints ? '👁️' : '📝'} Points ({referencePoints.length})
    </button>

    <button 
      class="control-btn debug-btn {showingDebug ? 'active' : ''}" 
      onclick={toggleDebug}
    >
      🐛 Debug
    </button>
  </div>

  <button
    class="center-user-btn"
    onclick={centerOnUser}
    disabled={!canCenterOnUser}
    aria-label="Center on me"
    title="Center the map on your current location"
  >
    <!-- Crosshair: circle plus four arms. Drawn inline so the control keeps a
         crisp look independent of emoji font support. -->
    <svg
      class="center-user-icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      aria-hidden="true"
      focusable="false"
    >
      <circle cx="12" cy="12" r="7" />
      <line x1="12" y1="1" x2="12" y2="5" />
      <line x1="12" y1="19" x2="12" y2="23" />
      <line x1="1" y1="12" x2="5" y2="12" />
      <line x1="19" y1="12" x2="23" y2="12" />
    </svg>
  </button>

  {#if showingPoints && referencePoints.length > 0}
    <div class="points-info">
      <div class="points-hint">
        💡 Tap or click a point to edit
      </div>
      <div class="points-hint">
        📍 Add points: tap or click on the map
      </div>
      {#if geoTransformError}
        <div class="transform-status transform-error">
          ⚠️ Georeference unavailable: {geoTransformError}
        </div>
      {:else}
        <div class="transform-status">
          {#if referencePoints.length === 2}
            ✓ Similarity transform
          {:else if referencePoints.length === 3}
            ✓ Affine transform ({referencePoints.length} points)
          {:else if referencePoints.length >= 4}
            ✓ Homography transform ({referencePoints.length} points)
          {/if}
        </div>
      {/if}
    </div>
  {:else if !showingPoints}
    <div class="points-info">
      {#if geoTransformError}
        <div class="points-hint hint-error">
          ⚠️ Georeference unavailable: {geoTransformError}
        </div>
      {:else}
        <div class="points-hint">
          📍 Add reference points: tap or click on the map
        </div>
      {/if}
    </div>
  {/if}

  {#if editingPoint}
    <div class="modal-overlay" role="dialog" aria-modal="true" tabindex="-1" onclick={(e) => { if (e.target === e.currentTarget) cancelEdit(); }} onkeydown={(e) => { if (e.key === 'Escape') cancelEdit(); }}>
      <div class="modal-content">
        <h2>Edit Point #{editingPoint.index + 1}</h2>
        
        <div class="point-edit-info">
          <div class="info-row">
            <strong>Image coordinates:</strong>
            <span>({editingPoint.u.toFixed(3)}, {editingPoint.v.toFixed(3)})</span>
          </div>
        </div>
        
        <div class="input-group">
          <label for="edit-lat">Latitude</label>
          <input 
            id="edit-lat"
            type="number" 
            step="any"
            bind:value={editingPoint.lat}
          />
        </div>
        
        <div class="input-group">
          <label for="edit-lon">Longitude</label>
          <input 
            id="edit-lon"
            type="number" 
            step="any"
            bind:value={editingPoint.lon}
          />
        </div>
        
        <div class="button-group">
          <button class="btn btn-danger" onclick={deleteEditingPoint}>
            🗑️ Delete
          </button>
          <button class="btn btn-secondary" onclick={cancelEdit}>
            Cancel
          </button>
          <button class="btn btn-primary" onclick={saveEditedPoint}>
            Save
          </button>
        </div>
      </div>
    </div>
  {/if}

  {#if showingDebug}
    <div class="modal-overlay" role="dialog" aria-modal="true" tabindex="-1" onclick={(e) => { if (e.target === e.currentTarget) toggleDebug(); }} onkeydown={(e) => { if (e.key === 'Escape') toggleDebug(); }}>
      <div class="modal-content debug-modal">
        <h2>🐛 Debug Information</h2>
        
        <div class="debug-section">
          <h3>Current GPS Position</h3>
          {#if userPositionMarker?.userPosition}
            <div class="debug-info">
              <div class="info-row">
                <strong>Latitude:</strong>
                <span>{userPositionMarker.userPosition.latitude.toFixed(6)}</span>
              </div>
              <div class="info-row">
                <strong>Longitude:</strong>
                <span>{userPositionMarker.userPosition.longitude.toFixed(6)}</span>
              </div>
              <div class="info-row">
                <strong>Accuracy:</strong>
                <span>{userPositionMarker.userPosition.accuracy?.toFixed(0)}m</span>
              </div>
              {#if userPositionMarker.positionStale}
                <div class="info-row">
                  <strong>Status:</strong>
                  <span>⚠️ Stale fix — refreshing</span>
                </div>
              {/if}
              {#if geoTransform}
                {@const imgCoords = geoToUV(userPositionMarker.userPosition.longitude, userPositionMarker.userPosition.latitude, geoTransform)}
                <div class="info-row">
                  <strong>Image Coordinates:</strong>
                  <span>({imgCoords.u.toFixed(3)}, {imgCoords.v.toFixed(3)})</span>
                </div>
              {/if}
            </div>
          {:else}
            <div class="debug-info">
              <em>No GPS data available</em>
            </div>
          {/if}
        </div>

        <div class="debug-section">
          <h3>Transform Information</h3>
          <div class="debug-info">
            <div class="info-row">
              <strong>Transform Type:</strong>
              <span>{geoTransform?.type || 'None'}</span>
            </div>
            {#if geoTransform}
              <div class="info-row">
                <strong>Transform Data:</strong>
                <pre>{JSON.stringify(geoTransform, null, 2)}</pre>
              </div>
            {/if}
          </div>
        </div>

        <div class="debug-section">
          <h3>Reference Points ({referencePoints.length})</h3>
          {#if referencePoints.length > 0}
            <div class="debug-info">
              {#each referencePoints as point, index}
                <div class="point-debug">
                  <div class="point-header">Point {index + 1}</div>
                  <div class="info-row">
                    <strong>GPS:</strong>
                    <span>({point.lat.toFixed(6)}, {point.lon.toFixed(6)})</span>
                  </div>
                  <div class="info-row">
                    <strong>Image:</strong>
                    <span>({point.u.toFixed(3)}, {point.v.toFixed(3)})</span>
                  </div>
                  {#if point.accuracy}
                    <div class="info-row">
                      <strong>Accuracy:</strong>
                      <span>±{point.accuracy.toFixed(0)}m</span>
                    </div>
                  {/if}
                </div>
              {/each}
            </div>
          {:else}
            <div class="debug-info">
              <em>No reference points defined</em>
            </div>
          {/if}
        </div>

        <div class="debug-section">
          <h3>Image Information</h3>
          <div class="debug-info">
            <div class="info-row">
              <strong>Dimensions:</strong>
              <span>{imageWidth} × {imageHeight}</span>
            </div>
            <div class="info-row">
              <strong>Canvas:</strong>
              <span>{canvasWidth} × {canvasHeight}</span>
            </div>
            <div class="info-row">
              <strong>Scale:</strong>
              <span>{transform.scale.toFixed(3)}</span>
            </div>
            <div class="info-row">
              <strong>Translation:</strong>
              <span>({transform.translateX.toFixed(1)}, {transform.translateY.toFixed(1)})</span>
            </div>
            <div class="info-row">
              <strong>Rotation:</strong>
              <span>{(transform.rotation * 180 / Math.PI).toFixed(1)}°</span>
            </div>
          </div>
        </div>
        
        <div class="button-group">
          <button class="btn btn-secondary" onclick={toggleDebug}>
            Close
          </button>
        </div>
      </div>
    </div>
  {/if}

  {#if showingCoordinateSelection}
    <div class="modal-overlay" role="dialog" aria-modal="true" tabindex="-1" onclick={(e) => { if (e.target === e.currentTarget) hideCoordinateSelection(); }} onkeydown={(e) => { if (e.key === 'Escape') hideCoordinateSelection(); }}>
      <div class="modal-content">
        <h2>📍 Add Reference Point</h2>
        
        <div class="point-edit-info">
          <div class="info-row">
            <strong>Image coordinates:</strong>
            <span>({pendingReferencePoint.u.toFixed(3)}, {pendingReferencePoint.v.toFixed(3)})</span>
          </div>
        </div>

        <p class="instruction">Select the real-world coordinates for this point</p>
        
        {#if !coordinateMethod}
          <div class="method-selection">
            <button class="method-btn" onclick={() => selectCoordinateMethod('gps')}>
              <div class="method-icon">📍</div>
              <div class="method-title">Use GPS</div>
              <div class="method-desc">Use current device location</div>
            </button>
            
            <button class="method-btn" onclick={() => selectCoordinateMethod('manual')}>
              <div class="method-icon">⌨️</div>
              <div class="method-title">Manual Entry</div>
              <div class="method-desc">Type coordinates</div>
            </button>
            
            <button class="method-btn" onclick={() => selectCoordinateMethod('map')}>
              <div class="method-icon">🗺️</div>
              <div class="method-title">Select on Map</div>
              <div class="method-desc">Choose from OSM map (online)</div>
            </button>
          </div>
        {:else if coordinateMethod === 'gps'}
          <div class="coordinate-input">
            {#if gpsError}
              <div class="error-message">{gpsError}</div>
              <button class="btn btn-secondary" onclick={getCurrentGPS}>Try Again</button>
            {:else if gpsPosition}
              <div class="success-message">
                ✓ GPS location acquired
                <div class="coords-display">
                  Lat: {gpsPosition.lat.toFixed(6)}<br>
                  Lon: {gpsPosition.lon.toFixed(6)}
                  {#if gpsPosition.accuracy}
                    <br>
                    Accuracy: ±{gpsPosition.accuracy.toFixed(0)}m
                  {/if}
                </div>
              </div>
            {:else}
              <div class="loading-message">📡 Getting GPS location...</div>
            {/if}
            <button class="btn btn-secondary" onclick={() => coordinateMethod = null}>
              Choose Different Method
            </button>
          </div>
        {:else if coordinateMethod === 'manual'}
          <div class="coordinate-input">
            <div class="input-group">
              <label for="manual-lat">Latitude (-90 to 90)</label>
              <input 
                id="manual-lat"
                type="number" 
                step="any"
                bind:value={manualLat}
                placeholder="e.g., 40.7128"
              />
            </div>
            <div class="input-group">
              <label for="manual-lon">Longitude (-180 to 180)</label>
              <input 
                id="manual-lon"
                type="number" 
                step="any"
                bind:value={manualLon}
                placeholder="e.g., -74.0060"
              />
            </div>
            <button class="btn btn-primary" onclick={useManualCoordinates}>
              Use These Coordinates
            </button>
            <button class="btn btn-secondary" onclick={() => coordinateMethod = null}>
              Choose Different Method
            </button>
          </div>
        {:else if coordinateMethod === 'map'}
          <div class="map-input">
            <p class="map-instruction">Click on the map to select coordinates</p>
            <div class="map-container" bind:this={mapContainer}></div>
            {#if selectedLon !== null && selectedLat !== null}
              <div class="coords-display">
                Selected: {selectedLat.toFixed(6)}, {selectedLon.toFixed(6)}
              </div>
            {/if}
            <button class="btn btn-secondary" onclick={() => coordinateMethod = null}>
              Choose Different Method
            </button>
          </div>
        {/if}
        
        <div class="button-group">
          <button class="btn btn-secondary" onclick={hideCoordinateSelection}>
            Cancel
          </button>
          <button 
            class="btn btn-primary" 
            disabled={!canSavePoint}
            onclick={saveReferencePoint}
          >
            Save Point
          </button>
        </div>
      </div>
    </div>
  {/if}
</div>
