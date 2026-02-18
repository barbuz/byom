<script>
  import { onMount, onDestroy } from 'svelte';
  import { getMap, getReferencePoints } from './lib/db.js';
  import { calculateTransform, geoToImage } from './lib/transforms.js';
  import ReferencePointPicker from './ReferencePointPicker.svelte';
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

  // GPS state
  let userPosition = null;
  let gpsWatchId = null;
  let geoTransform = null;
  let geoTransformType = null;

  // UI state
  let showingPointPicker = false;
  let showingPoints = false;
  let editingPoint = null;
  let hoverPointIndex = -1;
  let showingDebug = false;

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
        ctx.fillStyle = 'rgba(33, 150, 243, 0.7)';
        ctx.beginPath();
        ctx.arc(point.imageX, point.imageY, 6, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = 'white';
        ctx.lineWidth = 2;
        ctx.stroke();
      }
    });

    ctx.restore();

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

        // Draw accuracy circle
        if (userPosition.accuracy) {
          // Rough approximation: 1 degree ≈ 111km
          const accuracyInDegrees = userPosition.accuracy / 111000;
          const accuracyInPixels = accuracyInDegrees * Math.abs(geoTransform.a || geoTransform.scale);
          
          ctx.strokeStyle = 'rgba(76, 175, 80, 0.3)';
          ctx.fillStyle = 'rgba(76, 175, 80, 0.1)';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(imgCoords.imageX, imgCoords.imageY, accuracyInPixels, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
        }

        // Draw user marker
        ctx.fillStyle = '#4CAF50';
        ctx.beginPath();
        ctx.arc(imgCoords.imageX, imgCoords.imageY, 10, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = 'white';
        ctx.lineWidth = 3;
        ctx.stroke();

        // Draw direction indicator
        ctx.fillStyle = 'white';
        ctx.beginPath();
        ctx.arc(imgCoords.imageX, imgCoords.imageY, 3, 0, Math.PI * 2);
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
      isPanning = true;
      const touch = e.touches[0];
      lastTouchCenter = { x: touch.clientX, y: touch.clientY };
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
      
      touchStartTransform = { ...transform };
    }
  }

  function handleTouchMove(e) {
    e.preventDefault();

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
      transform.scale = touchStartTransform.scale * scaleFactor;
      transform.scale = Math.max(0.1, Math.min(10, transform.scale));
      
      // Rotation
      const rotationDelta = angle - lastTouchAngle;
      transform.rotation = touchStartTransform.rotation + rotationDelta;
      
      // Adjust translation to keep center point fixed
      const dx = center.x - lastTouchCenter.x;
      const dy = center.y - lastTouchCenter.y;
      transform.translateX = touchStartTransform.translateX + dx;
      transform.translateY = touchStartTransform.translateY + dy;
      
      scheduleRender();
    }
  }

  function handleTouchEnd(e) {
    isPanning = false;
  }

  function handleCanvasClick(e) {
    if (!showingPoints) return;
    
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    
    const pointIndex = getPointAtScreen(x, y);
    
    if (pointIndex >= 0) {
      editingPoint = { ...referencePoints[pointIndex], index: pointIndex };
      scheduleRender();
    }
  }

  function handleCanvasMouseMove(e) {
    if (!showingPoints) {
      if (hoverPointIndex !== -1) {
        hoverPointIndex = -1;
        scheduleRender();
      }
      return;
    }
    
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    
    const pointIndex = getPointAtScreen(x, y);
    
    if (pointIndex !== hoverPointIndex) {
      hoverPointIndex = pointIndex;
      canvas.style.cursor = pointIndex >= 0 ? 'pointer' : 'default';
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

  function goBack() {
    window.location.hash = '';
  }

  function openPointPicker() {
    showingPointPicker = true;
  }

  function togglePoints() {
    showingPoints = !showingPoints;
    if (!showingPoints) {
      editingPoint = null;
      hoverPointIndex = -1;
    }
    scheduleRender();
  }

  function handlePointAdded() {
    showingPointPicker = false;
    loadMapData(); // Reload to get updated points
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
  ></canvas>

  <div class="controls">
    <button class="control-btn back-btn" on:click={goBack}>
      ← Back
    </button>

    <button 
      class="control-btn add-point-btn {needsMorePoints ? 'highlight' : ''}" 
      on:click={openPointPicker}
    >
      {needsMorePoints ? '⚠️' : '📍'} Add Point
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

  {#if map && showingPointPicker}
    <ReferencePointPicker 
      {mapId}
      {imageUrl}
      {imageWidth}
      {imageHeight}
      on:close={() => showingPointPicker = false}
      on:added={handlePointAdded}
    />
  {/if}

  {#if showingPoints && referencePoints.length > 0}
    <div class="points-info">
      <div class="points-hint">
        💡 Click on a point to edit its coordinates
      </div>
      <div class="transform-status">
        {#if referencePoints.length === 2}
          ✓ Similarity transform
        {:else if referencePoints.length >= 3}
          ✓ Affine transform ({referencePoints.length} points)
        {/if}
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
</div>
