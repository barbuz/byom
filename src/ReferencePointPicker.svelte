<script>
  import { createEventDispatcher, onMount, tick } from 'svelte';
  import { addReferencePoint } from './lib/db.js';
  import 'maplibre-gl/dist/maplibre-gl.css';

  export let mapId;
  export let imageUrl;
  export let imageWidth;
  export let imageHeight;

  const dispatch = createEventDispatcher();

  // Workflow state
  let step = 'image'; // 'image', 'coordinates'
  let selectedImageCoords = null;
  let coordinateMethod = null; // 'gps', 'manual', 'map'

  // Canvas for image coordinate selection
  let imageCanvas;
  let imageCtx;
  let imageElement;
  let canvasScale = 1;

  // Coordinate inputs
  let manualLat = '';
  let manualLon = '';
  let gpsPosition = null;
  let gpsError = null;
  let mapContainer;
  let map;
  let mapMarker = null;

  // Selected coordinates
  let selectedLon = null;
  let selectedLat = null;

  $: canSave = selectedImageCoords && selectedLon !== null && selectedLat !== null;

  let imageCanvasReady = false;

  function setupImageCanvas() {
    if (!imageCanvas || !imageUrl || imageCanvasReady) return;
    imageCanvasReady = true;

    imageCtx = imageCanvas.getContext('2d');
    imageElement = new Image();
    
    imageElement.onload = () => {
      // Fit image to canvas
      const containerWidth = imageCanvas.parentElement.clientWidth;
      const containerHeight = imageCanvas.parentElement.clientHeight;
      
      const scaleX = containerWidth / imageWidth;
      const scaleY = containerHeight / imageHeight;
      canvasScale = Math.min(scaleX, scaleY, 1);
      
      const displayWidth = imageWidth * canvasScale;
      const displayHeight = imageHeight * canvasScale;
      
      imageCanvas.width = displayWidth;
      imageCanvas.height = displayHeight;
      
      imageCtx.drawImage(imageElement, 0, 0, displayWidth, displayHeight);
    };
    
    imageElement.src = imageUrl;
  }

  function handleImageClick(e) {
    const rect = imageCanvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) / canvasScale;
    const y = (e.clientY - rect.top) / canvasScale;
    
    selectedImageCoords = { x, y };
    
    // Redraw image with marker
    imageCtx.clearRect(0, 0, imageCanvas.width, imageCanvas.height);
    imageCtx.drawImage(imageElement, 0, 0, imageCanvas.width, imageCanvas.height);
    
    // Draw marker
    imageCtx.fillStyle = 'rgba(33, 150, 243, 0.7)';
    imageCtx.beginPath();
    imageCtx.arc(x * canvasScale, y * canvasScale, 12, 0, Math.PI * 2);
    imageCtx.fill();
    imageCtx.strokeStyle = 'white';
    imageCtx.lineWidth = 3;
    imageCtx.stroke();
  }

  function nextStep() {
    if (step === 'image' && selectedImageCoords) {
      step = 'coordinates';
    }
  }

  function prevStep() {
    if (step === 'coordinates') {
      step = 'image';
      coordinateMethod = null;
      selectedLon = null;
      selectedLat = null;
      imageCanvasReady = false;
      tick().then(() => setupImageCanvas());
    }
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

    map = new maplibregl.Map({
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
      center: [0, 0],
      zoom: 2,
    });

    map.on('click', (e) => {
      const { lng, lat } = e.lngLat;
      selectedLon = lng;
      selectedLat = lat;

      // Add/update marker
      if (mapMarker) {
        mapMarker.setLngLat([lng, lat]);
      } else {
        mapMarker = new maplibregl.Marker({ color: '#2196F3' })
          .setLngLat([lng, lat])
          .addTo(map);
      }
    });

    // Try to get user's location for initial center
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          map.setCenter([position.coords.longitude, position.coords.latitude]);
          map.setZoom(10);
        },
        () => {
          // Ignore error, keep default center
        }
      );
    }
  }

  async function saveReferencePoint() {
    if (!canSave) return;

    try {
      await addReferencePoint({
        mapId: parseInt(mapId),
        imageX: selectedImageCoords.x,
        imageY: selectedImageCoords.y,
        lon: selectedLon,
        lat: selectedLat,
      });

      dispatch('added');
    } catch (error) {
      console.error('Error saving reference point:', error);
      alert('Failed to save reference point');
    }
  }

  function close() {
    imageCanvasReady = false;
    dispatch('close');
  }

  onMount(async () => {
    if (step === 'image') {
      await tick();
      setupImageCanvas();
    }
  });

  // Setup image canvas when step changes
  $: if (imageCanvas && imageUrl && step === 'image' && !imageCanvasReady) {
    tick().then(() => setupImageCanvas());
  }
</script>

<div class="picker-overlay">
  <div class="picker-container">
    <div class="picker-header">
      <h2>Add Reference Point</h2>
      <button class="close-btn" on:click={close}>×</button>
    </div>

    {#if step === 'image'}
      <div class="step-content">
        <p class="instruction">Tap on the image to select a point</p>
        <div class="image-container">
          <canvas
            bind:this={imageCanvas}
            on:click={handleImageClick}
          ></canvas>
        </div>
        <div class="step-actions">
          <button class="btn btn-secondary" on:click={close}>Cancel</button>
          <button 
            class="btn btn-primary" 
            disabled={!selectedImageCoords}
            on:click={nextStep}
          >
            Next →
          </button>
        </div>
      </div>
    {:else if step === 'coordinates'}
      <div class="step-content">
        <p class="instruction">Select the real-world coordinates</p>
        
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
              <label for="lat-input">Latitude (-90 to 90)</label>
              <input 
                id="lat-input"
                type="number" 
                step="any"
                bind:value={manualLat}
                placeholder="e.g., 40.7128"
              />
            </div>
            <div class="input-group">
              <label for="lon-input">Longitude (-180 to 180)</label>
              <input 
                id="lon-input"
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

        <div class="step-actions">
          <button class="btn btn-secondary" on:click={prevStep}>← Back</button>
          <button 
            class="btn btn-primary" 
            disabled={!canSave}
            on:click={saveReferencePoint}
          >
            Save Point
          </button>
        </div>
      </div>
    {/if}
  </div>
</div>

<style>
  .picker-overlay {
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background: rgba(0, 0, 0, 0.9);
    z-index: 2000;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 1rem;
  }

  .picker-container {
    background: white;
    border-radius: 12px;
    width: 100%;
    max-width: 600px;
    max-height: 90vh;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .picker-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 1.5rem;
    border-bottom: 1px solid #eee;
  }

  .picker-header h2 {
    margin: 0;
    color: #333;
  }

  .close-btn {
    background: none;
    border: none;
    font-size: 2rem;
    color: #999;
    cursor: pointer;
    padding: 0;
    width: 32px;
    height: 32px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 50%;
    transition: background 0.2s;
  }

  .close-btn:hover {
    background: #f5f5f5;
  }

  .step-content {
    flex: 1;
    overflow-y: auto;
    padding: 1.5rem;
  }

  .instruction {
    text-align: center;
    color: #666;
    margin: 0 0 1.5rem;
    font-size: 1.1rem;
  }

  .image-container {
    width: 100%;
    height: 400px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: #f5f5f5;
    border-radius: 8px;
    overflow: hidden;
    margin-bottom: 1.5rem;
  }

  canvas {
    cursor: crosshair;
    max-width: 100%;
    max-height: 100%;
  }

  .method-selection {
    display: flex;
    flex-direction: column;
    gap: 1rem;
    margin-bottom: 1.5rem;
  }

  .method-btn {
    background: white;
    border: 2px solid #e0e0e0;
    padding: 1.5rem;
    border-radius: 8px;
    cursor: pointer;
    text-align: left;
    transition: all 0.2s;
  }

  .method-btn:hover {
    border-color: #2196F3;
    box-shadow: 0 2px 8px rgba(33, 150, 243, 0.2);
  }

  .method-icon {
    font-size: 2rem;
    margin-bottom: 0.5rem;
  }

  .method-title {
    font-weight: 600;
    color: #333;
    font-size: 1.1rem;
    margin-bottom: 0.25rem;
  }

  .method-desc {
    color: #666;
    font-size: 0.9rem;
  }

  .coordinate-input,
  .map-input {
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  .input-group {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .input-group label {
    font-weight: 500;
    color: #333;
  }

  .input-group input {
    padding: 0.75rem;
    border: 2px solid #e0e0e0;
    border-radius: 8px;
    font-size: 1rem;
  }

  .input-group input:focus {
    outline: none;
    border-color: #2196F3;
  }

  .map-container {
    width: 100%;
    height: 300px;
    border-radius: 8px;
    overflow: hidden;
  }

  .map-instruction {
    margin: 0 0 1rem;
    color: #666;
    font-size: 0.9rem;
  }

  .coords-display {
    padding: 0.75rem;
    background: #f5f5f5;
    border-radius: 8px;
    text-align: center;
    font-family: monospace;
    color: #333;
  }

  .success-message,
  .error-message,
  .loading-message {
    padding: 1rem;
    border-radius: 8px;
    text-align: center;
  }

  .success-message {
    background: #E8F5E9;
    color: #2E7D32;
  }

  .error-message {
    background: #FFEBEE;
    color: #C62828;
  }

  .loading-message {
    background: #E3F2FD;
    color: #1565C0;
  }

  .step-actions {
    display: flex;
    gap: 1rem;
    justify-content: space-between;
    margin-top: 1.5rem;
    padding-top: 1.5rem;
    border-top: 1px solid #eee;
  }

  .btn {
    padding: 0.75rem 1.5rem;
    border: none;
    border-radius: 8px;
    font-size: 1rem;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.2s;
    flex: 1;
  }

  .btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .btn-primary {
    background: #2196F3;
    color: white;
  }

  .btn-primary:not(:disabled):hover {
    background: #1976D2;
  }

  .btn-secondary {
    background: #f5f5f5;
    color: #333;
  }

  .btn-secondary:hover {
    background: #e0e0e0;
  }

  @media (max-width: 640px) {
    .picker-container {
      max-height: 95vh;
    }

    .image-container {
      height: 300px;
    }

    .map-container {
      height: 250px;
    }
  }
</style>
