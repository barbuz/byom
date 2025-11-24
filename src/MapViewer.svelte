<script>
  import { onMount, onDestroy } from 'svelte';
  import { getMap, getReferencePoints } from './lib/db.js';
  import { calculateTransform, geoToImage } from './lib/transforms.js';
  import ReferencePointPicker from './ReferencePointPicker.svelte';

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
    <div class="modal-overlay" on:click={cancelEdit}>
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
</div>

<style>
  .viewer-container {
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    overflow: hidden;
    background: #000;
  }

  canvas {
    display: block;
    width: 100%;
    height: 100%;
    touch-action: none;
  }

  .controls {
    position: absolute;
    bottom: 2rem;
    left: 50%;
    transform: translateX(-50%);
    display: flex;
    gap: 0.75rem;
    flex-wrap: wrap;
    justify-content: center;
    padding: 0 1rem;
  }

  .control-btn {
    background: rgba(255, 255, 255, 0.95);
    border: none;
    padding: 0.75rem 1.25rem;
    border-radius: 24px;
    font-size: 0.95rem;
    font-weight: 500;
    cursor: pointer;
    box-shadow: 0 2px 8px rgba(0,0,0,0.3);
    transition: all 0.2s;
    white-space: nowrap;
  }

  .control-btn:active {
    transform: scale(0.95);
  }

  .back-btn {
    background: rgba(0, 0, 0, 0.7);
    color: white;
  }

  .add-point-btn.highlight {
    background: #FF9800;
    color: white;
    animation: pulse 2s infinite;
  }

  .edit-points-btn.active {
    background: #2196F3;
    color: white;
  }

  @keyframes pulse {
    0%, 100% { box-shadow: 0 2px 8px rgba(0,0,0,0.3); }
    50% { box-shadow: 0 2px 16px rgba(255, 152, 0, 0.6); }
  }

  .points-info {
    position: absolute;
    top: 1rem;
    left: 50%;
    transform: translateX(-50%);
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    align-items: center;
    pointer-events: none;
  }

  .points-hint {
    background: rgba(33, 150, 243, 0.95);
    color: white;
    padding: 0.75rem 1.25rem;
    border-radius: 20px;
    font-size: 0.9rem;
    box-shadow: 0 2px 8px rgba(0,0,0,0.3);
  }

  .transform-status {
    background: rgba(76, 175, 80, 0.95);
    color: white;
    padding: 0.5rem 1rem;
    border-radius: 16px;
    font-size: 0.85rem;
    font-weight: 500;
    box-shadow: 0 2px 8px rgba(0,0,0,0.3);
  }

  .point-edit-info {
    background: #f5f5f5;
    padding: 1rem;
    border-radius: 8px;
    margin-bottom: 1rem;
  }

  .info-row {
    display: flex;
    justify-content: space-between;
    gap: 1rem;
    color: #666;
    font-size: 0.9rem;
  }

  .input-group {
    margin-bottom: 1rem;
  }

  .input-group label {
    display: block;
    font-weight: 500;
    color: #333;
    margin-bottom: 0.5rem;
  }

  .input-group input {
    width: 100%;
    padding: 0.75rem;
    border: 2px solid #e0e0e0;
    border-radius: 8px;
    font-size: 1rem;
  }

  .input-group input:focus {
    outline: none;
    border-color: #2196F3;
  }

  .button-group {
    display: flex;
    gap: 0.75rem;
    margin-top: 1.5rem;
  }

  .btn {
    flex: 1;
    padding: 0.75rem;
    border: none;
    border-radius: 8px;
    font-size: 1rem;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.2s;
  }

  .btn-primary {
    background: #2196F3;
    color: white;
  }

  .btn-primary:hover {
    background: #1976D2;
  }

  .btn-secondary {
    background: #f5f5f5;
    color: #333;
  }

  .btn-secondary:hover {
    background: #e0e0e0;
  }

  .btn-danger {
    background: #f44336;
    color: white;
  }

  .btn-danger:hover {
    background: #d32f2f;
  }

  .modal-overlay {
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background: rgba(0, 0, 0, 0.8);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
    padding: 1rem;
  }

  .modal-content {
    background: white;
    border-radius: 12px;
    padding: 1.5rem;
    max-width: 500px;
    width: 100%;
    max-height: 80vh;
    overflow-y: auto;
  }

  .modal-content h2 {
    margin: 0 0 1rem;
    color: #333;
  }

  .empty-message {
    text-align: center;
    color: #999;
    padding: 2rem 0;
  }

  .points-list {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  .point-item {
    display: flex;
    gap: 1rem;
    padding: 0.75rem;
    background: #f5f5f5;
    border-radius: 8px;
  }

  .point-number {
    background: #2196F3;
    color: white;
    width: 32px;
    height: 32px;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    font-weight: 600;
    flex-shrink: 0;
  }

  .point-details {
    flex: 1;
    font-size: 0.9rem;
    color: #666;
  }

  .point-details div {
    margin: 0.25rem 0;
  }

  .transform-info {
    margin-top: 1rem;
    padding: 0.75rem;
    background: #E8F5E9;
    border-radius: 8px;
    text-align: center;
  }

  .transform-info p {
    margin: 0;
    color: #2E7D32;
    font-weight: 500;
  }

  .modal-close-btn {
    width: 100%;
    margin-top: 1.5rem;
    padding: 0.75rem;
    background: #2196F3;
    color: white;
    border: none;
    border-radius: 8px;
    font-size: 1rem;
    font-weight: 500;
    cursor: pointer;
  }

  .modal-close-btn:active {
    background: #1976D2;
  }

  @media (max-width: 640px) {
    .controls {
      bottom: 1rem;
      gap: 0.5rem;
    }

    .control-btn {
      padding: 0.6rem 1rem;
      font-size: 0.85rem;
    }
  }
</style>
