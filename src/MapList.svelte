<script>
  import { onMount } from 'svelte';
  import { getAllMaps, addMap, deleteMap } from './lib/db.js';
  import './styles/MapList.css';

  let maps = [];
  let loading = true;

  onMount(async () => {
    await loadMaps();
  });

  async function loadMaps() {
    loading = true;
    try {
      maps = await getAllMaps();
      // Sort by timestamp descending (newest first)
      maps.sort((a, b) => b.timestamp - a.timestamp);
    } catch (error) {
      console.error('Error loading maps:', error);
      alert('Failed to load maps');
    } finally {
      loading = false;
    }
  }

  async function handleFileSelect(event) {
    const files = event.target.files;
    if (!files || files.length === 0) return;

    for (const file of files) {
      await processImageFile(file);
    }
    
    await loadMaps();
    event.target.value = ''; // Reset input
  }

  async function processImageFile(file) {
    try {
      // Create thumbnail
      const thumbnail = await createThumbnail(file);
      
      // Store full image as blob
      const mapData = {
        name: file.name,
        imageBlob: file,
        thumbnail: thumbnail,
      };

      await addMap(mapData);
    } catch (error) {
      console.error('Error processing image:', error);
      alert(`Failed to process ${file.name}`);
    }
  }

  async function createThumbnail(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement('canvas');
          const MAX_SIZE = 200;
          let width = img.width;
          let height = img.height;

          if (width > height) {
            if (width > MAX_SIZE) {
              height *= MAX_SIZE / width;
              width = MAX_SIZE;
            }
          } else {
            if (height > MAX_SIZE) {
              width *= MAX_SIZE / height;
              height = MAX_SIZE;
            }
          }

          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, width, height);
          resolve(canvas.toDataURL('image/jpeg', 0.7));
        };
        img.onerror = reject;
        img.src = e.target.result;
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  async function handleDeleteMap(mapId, event) {
    event.stopPropagation();
    if (!confirm('Delete this map and all its reference points?')) return;

    try {
      await deleteMap(mapId);
      await loadMaps();
    } catch (error) {
      console.error('Error deleting map:', error);
      alert('Failed to delete map');
    }
  }

  function openMap(mapId) {
    window.location.hash = `#map/${mapId}`;
  }
</script>

<div class="container">
  <header>
    <h1>🗺️ BYOM</h1>
    <p>Bring Your Own Map</p>
  </header>

  <div class="upload-section">
    <label for="file-upload" class="upload-btn">
      📷 Add Map
    </label>
    <input 
      id="file-upload"
      type="file" 
      accept="image/*" 
      capture="environment"
      multiple
      on:change={handleFileSelect}
      style="display: none;"
    />
  </div>

  {#if loading}
    <div class="loading">Loading maps...</div>
  {:else if maps.length === 0}
    <div class="empty-state">
      <p>No maps yet</p>
      <p class="hint">Tap "Add Map" to get started</p>
    </div>
  {:else}
    <div class="maps-grid">
      {#each maps as map (map.id)}
        <div class="map-card" on:click={() => openMap(map.id)}>
          <div class="map-thumbnail">
            <img src={map.thumbnail} alt={map.name} />
          </div>
          <div class="map-info">
            <div class="map-name">{map.name}</div>
            <div class="map-date">
              {new Date(map.timestamp).toLocaleDateString()}
            </div>
          </div>
          <button 
            class="delete-btn" 
            on:click={(e) => handleDeleteMap(map.id, e)}
            aria-label="Delete map"
          >
            ×
          </button>
        </div>
      {/each}
    </div>
  {/if}
</div>
