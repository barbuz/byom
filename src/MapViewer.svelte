<script>
  import { onMount, onDestroy } from 'svelte';
  import { getMap, getReferencePoints } from './lib/db.js';
  import { calculateTransform, geoToImage } from './lib/transforms.js';
  import './styles/MapViewer.css';

  export let mapId;

  let map = null;
  let imageUrl = null;
  let referencePoints = [];
  let canvas;
  let ctx;
  let imageElement;
  
  // Transform state
  let transform = {
    scale: 1,
    translateX: 0,
    translateY: 0,
    rotation: 0,
  };

  // Image dimensions
  let imageWidth = 0;
  let imageHeight = 0;

  // Canvas dimensions
  let canvasWidth = 0;
  let canvasHeight = 0;

  // Touch/gesture state
  let isPanning = false;
  let lastTouchDistance = 0;
  let lastTouchAngle = 0;
  let lastTouchCenter = { x: 0, y: 0 };
  let touchStartTransform = null;
  
  // Long touch detection
  let longTouchTimer = null;
  let longTouchStartPos = null;
  let isLongTouch = false;

  // Mouse interaction state
  let isMouseDown = false;
  let mouseStartPos = null;
  let mouseStartTransform = null;

  // GPS state
  let userPosition = null;
  let gpsWatchId = null;
  let geoTransform = null;
  let geoTransformType = null;

  // UI state
  let showingPoints = false;
  let editingPoint = null;
  let hoverPointIndex = -1;
  let showingDebug = false;
  let pendingReferencePoint = null;
  let showingCoordinateSelection = false;
  let coordinateMethod = null;
  let manualLat = '';
  let manualLon = '';
  let gpsPosition = null;
  let gpsError = null;
  let selectedLon = null;
  let selectedLat = null;
  let mapContainer;
  let osmMap;
  let osmMapMarker = null;

  // Rendering state
  let animationFrameId = null;
  let needsRender = false;

  onMount(async () => {
    await loadMapData();
    setupCanvas();
    startGPSTracking();
    window.addEventListener('resize', handleResize);
  });

  onDestroy(() => {
    if (gpsWatchId !== null) {
      navigator.geolocation.clearWatch(gpsWatchId);
    }
    if (imageUrl) {
      URL.revokeObjectURL(imageUrl);
    }
    if (animationFrameId) {
      cancelAnimationFrame(animationFrameId);
    }
    window.removeEventListener('resize', handleResize);
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
    if (!canvas) return;
    
    ctx = canvas.getContext('2d');
    handleResize();

    // Load image
    imageElement = new Image();
    imageElement.onload = () => {
      imageWidth = imageElement.width;
      imageHeight = imageElement.height;
      fitImageToCanvas();
      scheduleRender();
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

  function getPointAtScreen(screenX, screenY) {
    if (!showingPoints) return -1;
    
    const clickRadius = 20;
    
    for (let i = 0; i < referencePoints.length; i++) {
      const point = referencePoints[i];
      
      const cos_r = Math.cos(transform.rotation);
      const sin_r = Math.sin(transform.rotation);
      
      // Account for image centering offset
      const offsetX = point.imageX - imageWidth / 2;
      const offsetY = point.imageY - imageHeight / 2;
      
      const scaledX = offsetX * transform.scale;
      const scaledY = offsetY * transform.scale;
      
      const rotatedX = cos_r * scaledX - sin_r * scaledY;
      const rotatedY = sin_r * scaledX + cos_r * scaledY;
      
      const screenPointX = rotatedX + transform.translateX;
      const screenPointY = rotatedY + transform.translateY;
      
      const dist = Math.hypot(screenX - screenPointX, screenY - screenPointY);
      
      if (dist <= clickRadius) return i;
    }
    
    return -1;
  }

  function scheduleRender() {
    if (needsRender) return;
    needsRender = true;
    if (animationFrameId) cancelAnimationFrame(animationFrameId);
    animationFrameId = requestAnimationFrame(render);
  }

  function render() {
    needsRender = false;
    if (!ctx || !imageElement) return;

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
      
      if (showingPoints || isEditing) {
        ctx.fillStyle = isEditing ? 'rgba(255, 152, 0, 0.9)' : isHovered ? 'rgba(33, 150, 243, 0.9)' : 'rgba(33, 150, 243, 0.7)';
        ctx.beginPath();
        ctx.arc(point.imageX, point.imageY, isHovered || isEditing ? 12 : 8, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = 'white';
        ctx.lineWidth = isEditing ? 3 : 2;
        ctx.stroke();
        
        // Draw number label
        ctx.save();
        ctx.translate(point.imageX, point.imageY);
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
      ctx.save();
      ctx.translate(transform.translateX, transform.translateY);
      ctx.rotate(transform.rotation);
      ctx.scale(transform.scale, transform.scale);
      ctx.translate(-imageWidth / 2, -imageHeight / 2);

      // Draw pending point marker
      ctx.fillStyle = 'rgba(255, 152, 0, 0.9)';
      ctx.beginPath();
      ctx.arc(pendingReferencePoint.imageX, pendingReferencePoint.imageY, 15, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'white';
      ctx.lineWidth = 3;
      ctx.stroke();

      // Draw pulsing effect
      ctx.strokeStyle = 'rgba(255, 152, 0, 0.5)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(pendingReferencePoint.imageX, pendingReferencePoint.imageY, 20, 0, Math.PI * 2);
      ctx.stroke();

      ctx.restore();
    }

    // Draw user position
    if (userPosition && geoTransform) {
      try {
        const imgCoords = geoToImage(
          userPosition.longitude,
          userPosition.latitude,
          geoTransform,
          geoTransformType
        );

        ctx.save();
        ctx.translate(transform.translateX, transform.translateY);
        ctx.rotate(transform.rotation);
        ctx.scale(transform.scale, transform.scale);
        ctx.translate(-imageWidth / 2, -imageHeight / 2);

        // Draw accuracy circle
        if (userPosition.accuracy) {
          // Rough approximation: 1 degree ≈ 111km
          const accuracyInDegrees = userPosition.accuracy / 111000;
          
          // Use average scale factor from transform coefficients for more accurate representation
          let scaleFactor;
          if (geoTransformType === 'affine') {
            // For affine transform, use average of x and y scale factors
            const scaleX = Math.sqrt(geoTransform.a * geoTransform.a + geoTransform.d * geoTransform.d);
            const scaleY = Math.sqrt(geoTransform.b * geoTransform.b + geoTransform.e * geoTransform.e);
            scaleFactor = (scaleX + scaleY) / 2;
          } else {
            // For similarity transform, use the scale factor
            scaleFactor = geoTransform.scale;
          }
          
          const accuracyInPixels = accuracyInDegrees * scaleFactor;
          
          ctx.strokeStyle = 'rgba(225, 26, 30, 0.3)';
          ctx.fillStyle = 'rgba(175, 86, 80, 0.1)';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(imgCoords.imageX, imgCoords.imageY, accuracyInPixels, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
        }

        // Draw user marker
        ctx.fillStyle = '#AF4C50';
        ctx.beginPath();
        ctx.arc(imgCoords.imageX, imgCoords.imageY, 20, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = 'white';
        ctx.lineWidth = 3;
        ctx.stroke();

        // Draw direction indicator
        ctx.fillStyle = 'white';
        ctx.beginPath();
        ctx.arc(imgCoords.imageX, imgCoords.imageY, 6, 0, Math.PI * 2);
        ctx.fill();

        ctx.restore();
      } catch (error) {
        console.error('Error drawing user position:', error);
      }
    }
  }

  function updateGeoTransform() {
    const result = calculateTransform(referencePoints);
    if (result) {
      geoTransform = result.transform;
      geoTransformType = result.type;
    } else {
      geoTransform = null;
      geoTransformType = null;
    }
  }

  function startGPSTracking() {
    if (!navigator.geolocation) {
      console.warn('Geolocation not supported');
      return;
    }

    gpsWatchId = navigator.geolocation.watchPosition(
      (position) => {
        userPosition = {
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracy: position.coords.accuracy,
        };
        scheduleRender();
      },
      (error) => {
        console.error('GPS error:', error);
      },
      {
        enableHighAccuracy: true,
        maximumAge: 5000,
        timeout: 10000,
      }
    );
  }

  // Touch event handlers
  function handleTouchStart(e) {
    e.preventDefault();
    
    if (e.touches.length === 1) {
      const touch = e.touches[0];
      longTouchStartPos = { x: touch.clientX, y: touch.clientY };
      isLongTouch = false;
      
      // Start long touch timer
      longTouchTimer = setTimeout(() => {
        isLongTouch = true;
        handleLongPress(touch.clientX, touch.clientY);
      }, 500); // 500ms for long touch
      
      isPanning = true;
      lastTouchCenter = { x: touch.clientX, y: touch.clientY };
      touchStartTransform = { ...transform };
    } else if (e.touches.length === 2) {
      clearTimeout(longTouchTimer);
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
      
      touchStartTransform = { ...transform };
    }
  }

  function handleTouchMove(e) {
    e.preventDefault();

    // Cancel long touch if finger moved too much
    if (e.touches.length === 1 && longTouchStartPos) {
      const touch = e.touches[0];
      const moveDistance = Math.hypot(
        touch.clientX - longTouchStartPos.x,
        touch.clientY - longTouchStartPos.y
      );
      
      if (moveDistance > 10) { // Moved more than 10px
        clearTimeout(longTouchTimer);
      }
    }

    if (e.touches.length === 1 && isPanning && !isLongTouch) {
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
      
      // Calculate zoom center adjustment
      // We want to zoom around the current pinch center, not the image center
      const scaleChange = clampedScale / touchStartTransform.scale;
      
      // Adjust translation to keep the pinch center fixed during zoom
      const pinchCenterOffsetX = center.x - touchStartTransform.translateX;
      const pinchCenterOffsetY = center.y - touchStartTransform.translateY;
      
      // Apply the scale change to the offset
      const scaledOffsetX = pinchCenterOffsetX * scaleChange;
      const scaledOffsetY = pinchCenterOffsetY * scaleChange;
      
      // Calculate new translation to keep pinch center fixed
      transform.translateX = center.x - scaledOffsetX;
      transform.translateY = center.y - scaledOffsetY;
      transform.scale = clampedScale;
      
      // Rotation disabled for the moment 
      // const rotationDelta = angle - lastTouchAngle;
      // transform.rotation = touchStartTransform.rotation + rotationDelta;
      
      scheduleRender();
    }
  }

  function handleTouchEnd(e) {
    clearTimeout(longTouchTimer);
    
    // Handle tap for point editing (mobile)
    if (e.changedTouches.length === 1 && !isLongTouch && showingPoints) {
      const touch = e.changedTouches[0];
      const rect = canvas.getBoundingClientRect();
      const x = touch.clientX - rect.left;
      const y = touch.clientY - rect.top;
      
      handlePointEditing(x, y);
    }
    
    longTouchStartPos = null;
    isLongTouch = false;
    isPanning = false;
  }

  function handleLongPress(screenX, screenY) {
    // Convert screen coordinates to image coordinates
    const imageCoords = screenToImage(screenX, screenY);
    
    if (imageCoords) {
      pendingReferencePoint = {
        imageX: imageCoords.x,
        imageY: imageCoords.y,
        screenX: screenX,
        screenY: screenY
      };
      
      // Show a visual feedback
      scheduleRender();
      
      // Show coordinate selection modal after a short delay
      setTimeout(() => {
        showCoordinateSelection();
      }, 100);
    }
  }

  function handlePointEditing(screenX, screenY) {
    if (!showingPoints) return;
    
    const pointIndex = getPointAtScreen(screenX, screenY);
    
    if (pointIndex >= 0) {
      editingPoint = { ...referencePoints[pointIndex], index: pointIndex };
      scheduleRender();
    }
  }

  function screenToImage(screenX, screenY) {
    if (!imageWidth || !imageHeight) return null;
    
    // Apply inverse transformations to get image coordinates
    const cos_r = Math.cos(-transform.rotation);
    const sin_r = Math.sin(-transform.rotation);
    
    // Translate to origin
    let x = screenX - transform.translateX;
    let y = screenY - transform.translateY;
    
    // Apply inverse rotation
    const rotatedX = cos_r * x - sin_r * y;
    const rotatedY = sin_r * x + cos_r * y;
    
    // Apply inverse scale and translate to image coordinates
    const imageX = (rotatedX / transform.scale) + (imageWidth / 2);
    const imageY = (rotatedY / transform.scale) + (imageHeight / 2);
    
    // Check if coordinates are within image bounds
    if (imageX >= 0 && imageX <= imageWidth && imageY >= 0 && imageY <= imageHeight) {
      return { x: imageX, y: imageY };
    }
    
    return null;
  }

  function handleCanvasClick(e) {
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    
    // Handle point editing (both click and tap)
    handlePointEditing(x, y);
    
    // Handle click for adding points (desktop) - only when not in edit mode
    if (!showingPoints) {
      handleLongPress(x, y);
    }
  }

  function handleCanvasMouseMove(e) {
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    
    // Handle hover effects for points
    if (showingPoints) {
      const pointIndex = getPointAtScreen(x, y);
      
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

  function togglePoints() {
    showingPoints = !showingPoints;
    if (!showingPoints) {
      editingPoint = null;
      hoverPointIndex = -1;
    }
    scheduleRender();
  }

  async function saveEditedPoint() {
    if (!editingPoint) return;
    
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
        };
        selectedLat = gpsPosition.lat;
        selectedLon = gpsPosition.lon;
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
    } else if (userPosition) {
      // Use current GPS location
      initialCenter = [userPosition.longitude, userPosition.latitude];
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
    if (referencePoints.length === 0 && !userPosition && navigator.geolocation) {
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

    try {
      const { addReferencePoint } = await import('./lib/db.js');
      await addReferencePoint({
        mapId: parseInt(mapId),
        imageX: pendingReferencePoint.imageX,
        imageY: pendingReferencePoint.imageY,
        lon: selectedLon,
        lat: selectedLat,
      });

      hideCoordinateSelection();
      await loadMapData();
      scheduleRender();
    } catch (error) {
      console.error('Error saving reference point:', error);
      alert('Failed to save reference point');
    }
  }

  $: canSavePoint = pendingReferencePoint && selectedLon !== null && selectedLat !== null;

  $: needsMorePoints = referencePoints.length < 3;
</script>

<div class="viewer-container">
  <canvas
    bind:this={canvas}
    on:touchstart={handleTouchStart}
    on:touchmove={handleTouchMove}
    on:touchend={handleTouchEnd}
    on:wheel={handleWheel}
    on:click={handleCanvasClick}
    on:mousemove={handleCanvasMouseMove}
    on:mousedown={handleMouseDown}
    on:mouseup={handleMouseUp}
    on:mouseleave={handleMouseUp}
  ></canvas>

  <div class="controls">
    <button class="control-btn back-btn" on:click={goBack}>
      ← Back
    </button>

    <button 
      class="control-btn edit-points-btn {showingPoints ? 'active' : ''}" 
      on:click={togglePoints}
    >
      {showingPoints ? '👁️' : '📝'} Points ({referencePoints.length})
    </button>

    <button 
      class="control-btn debug-btn {showingDebug ? 'active' : ''}" 
      on:click={toggleDebug}
    >
      🐛 Debug
    </button>
  </div>

  {#if showingPoints && referencePoints.length > 0}
    <div class="points-info">
      <div class="points-hint">
        💡 Desktop: Click on a point to edit | Mobile: Tap on a point to edit
      </div>
      <div class="points-hint">
        📍 Add points: Desktop: Click | Mobile: Long touch
      </div>
      <div class="transform-status">
        {#if referencePoints.length === 2}
          ✓ Similarity transform
        {:else if referencePoints.length >= 3}
          ✓ Affine transform ({referencePoints.length} points)
        {/if}
      </div>
    </div>
  {:else if !showingPoints}
    <div class="points-info">
      <div class="points-hint">
        📍 Add reference points: Desktop: Click | Mobile: Long touch
      </div>
    </div>
  {/if}

  {#if editingPoint}
    <div class="modal-overlay" role="dialog" aria-modal="true" on:click={cancelEdit} on:keydown={(e) => { if (e.key === 'Escape') cancelEdit(); }}>
      <div class="modal-content" on:click|stopPropagation>
        <h2>Edit Point #{editingPoint.index + 1}</h2>
        
        <div class="point-edit-info">
          <div class="info-row">
            <strong>Image coordinates:</strong>
            <span>({editingPoint.imageX.toFixed(0)}, {editingPoint.imageY.toFixed(0)})</span>
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
          <button class="btn btn-danger" on:click={deleteEditingPoint}>
            🗑️ Delete
          </button>
          <button class="btn btn-secondary" on:click={cancelEdit}>
            Cancel
          </button>
          <button class="btn btn-primary" on:click={saveEditedPoint}>
            Save
          </button>
        </div>
      </div>
    </div>
  {/if}

  {#if showingDebug}
    <div class="modal-overlay" role="dialog" aria-modal="true" on:click={toggleDebug} on:keydown={(e) => { if (e.key === 'Escape') toggleDebug(); }}>
      <div class="modal-content debug-modal" on:click|stopPropagation>
        <h2>🐛 Debug Information</h2>
        
        <div class="debug-section">
          <h3>Current GPS Position</h3>
          {#if userPosition}
            <div class="debug-info">
              <div class="info-row">
                <strong>Latitude:</strong>
                <span>{userPosition.latitude.toFixed(6)}</span>
              </div>
              <div class="info-row">
                <strong>Longitude:</strong>
                <span>{userPosition.longitude.toFixed(6)}</span>
              </div>
              <div class="info-row">
                <strong>Accuracy:</strong>
                <span>{userPosition.accuracy?.toFixed(0)}m</span>
              </div>
              {#if geoTransform}
                {@const imgCoords = geoToImage(userPosition.longitude, userPosition.latitude, geoTransform, geoTransformType)}
                <div class="info-row">
                  <strong>Image Coordinates:</strong>
                  <span>({imgCoords.imageX.toFixed(1)}, {imgCoords.imageY.toFixed(1)})</span>
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
              <span>{geoTransformType || 'None'}</span>
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
                    <span>({point.imageX.toFixed(1)}, {point.imageY.toFixed(1)})</span>
                  </div>
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
          <button class="btn btn-secondary" on:click={toggleDebug}>
            Close
          </button>
        </div>
      </div>
    </div>
  {/if}

  {#if showingCoordinateSelection}
    <div class="modal-overlay" role="dialog" aria-modal="true" on:click={hideCoordinateSelection} on:keydown={(e) => { if (e.key === 'Escape') hideCoordinateSelection(); }}>
      <div class="modal-content" on:click|stopPropagation>
        <h2>📍 Add Reference Point</h2>
        
        <div class="point-edit-info">
          <div class="info-row">
            <strong>Image coordinates:</strong>
            <span>({pendingReferencePoint.imageX.toFixed(0)}, {pendingReferencePoint.imageY.toFixed(0)})</span>
          </div>
        </div>

        <p class="instruction">Select the real-world coordinates for this point</p>
        
        {#if !coordinateMethod}
          <div class="method-selection">
            <button class="method-btn" on:click={() => selectCoordinateMethod('gps')}>
              <div class="method-icon">📍</div>
              <div class="method-title">Use GPS</div>
              <div class="method-desc">Use current device location</div>
            </button>
            
            <button class="method-btn" on:click={() => selectCoordinateMethod('manual')}>
              <div class="method-icon">⌨️</div>
              <div class="method-title">Manual Entry</div>
              <div class="method-desc">Type coordinates</div>
            </button>
            
            <button class="method-btn" on:click={() => selectCoordinateMethod('map')}>
              <div class="method-icon">🗺️</div>
              <div class="method-title">Select on Map</div>
              <div class="method-desc">Choose from OSM map (online)</div>
            </button>
          </div>
        {:else if coordinateMethod === 'gps'}
          <div class="coordinate-input">
            {#if gpsError}
              <div class="error-message">{gpsError}</div>
              <button class="btn btn-secondary" on:click={getCurrentGPS}>Try Again</button>
            {:else if gpsPosition}
              <div class="success-message">
                ✓ GPS location acquired
                <div class="coords-display">
                  Lat: {gpsPosition.lat.toFixed(6)}<br>
                  Lon: {gpsPosition.lon.toFixed(6)}
                </div>
              </div>
            {:else}
              <div class="loading-message">📡 Getting GPS location...</div>
            {/if}
            <button class="btn btn-secondary" on:click={() => coordinateMethod = null}>
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
            <button class="btn btn-primary" on:click={useManualCoordinates}>
              Use These Coordinates
            </button>
            <button class="btn btn-secondary" on:click={() => coordinateMethod = null}>
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
            <button class="btn btn-secondary" on:click={() => coordinateMethod = null}>
              Choose Different Method
            </button>
          </div>
        {/if}
        
        <div class="button-group">
          <button class="btn btn-secondary" on:click={hideCoordinateSelection}>
            Cancel
          </button>
          <button 
            class="btn btn-primary" 
            disabled={!canSavePoint}
            on:click={saveReferencePoint}
          >
            Save Point
          </button>
        </div>
      </div>
    </div>
  {/if}
</div>
