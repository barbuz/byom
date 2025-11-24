<script>
  import { onMount } from 'svelte';
  import { getAllMaps, addMap, deleteMap } from './lib/db.js';

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

<style>
  :global(body) {
    margin: 0;
    padding: 0;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
    background: #f5f5f5;
    -webkit-font-smoothing: antialiased;
  }

  .container {
    max-width: 800px;
    margin: 0 auto;
    padding: 1rem;
    min-height: 100vh;
  }

  header {
    text-align: center;
    padding: 2rem 0;
  }

  h1 {
    margin: 0;
    font-size: 2.5rem;
    color: #2196F3;
  }

  header p {
    margin: 0.5rem 0 0;
    color: #666;
    font-size: 1.1rem;
  }

  .upload-section {
    margin: 2rem 0;
    text-align: center;
  }

  .upload-btn {
    display: inline-block;
    background: #2196F3;
    color: white;
    padding: 1rem 2rem;
    border-radius: 8px;
    font-size: 1.1rem;
    font-weight: 500;
    cursor: pointer;
    transition: background 0.2s;
    box-shadow: 0 2px 4px rgba(0,0,0,0.1);
  }

  .upload-btn:hover {
    background: #1976D2;
  }

  .upload-btn:active {
    transform: scale(0.98);
  }

  .loading, .empty-state {
    text-align: center;
    padding: 3rem 1rem;
    color: #666;
  }

  .empty-state p {
    margin: 0.5rem 0;
  }

  .hint {
    font-size: 0.9rem;
    color: #999;
  }

  .maps-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
    gap: 1rem;
    margin-top: 2rem;
  }

  .map-card {
    background: white;
    border-radius: 12px;
    overflow: hidden;
    cursor: pointer;
    transition: transform 0.2s, box-shadow 0.2s;
    box-shadow: 0 2px 8px rgba(0,0,0,0.1);
    position: relative;
  }

  .map-card:hover {
    transform: translateY(-4px);
    box-shadow: 0 4px 12px rgba(0,0,0,0.15);
  }

  .map-card:active {
    transform: translateY(-2px);
  }

  .map-thumbnail {
    width: 100%;
    aspect-ratio: 4/3;
    background: #eee;
    overflow: hidden;
  }

  .map-thumbnail img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .map-info {
    padding: 1rem;
  }

  .map-name {
    font-weight: 500;
    color: #333;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .map-date {
    font-size: 0.85rem;
    color: #999;
    margin-top: 0.25rem;
  }

  .delete-btn {
    position: absolute;
    top: 0.5rem;
    right: 0.5rem;
    width: 32px;
    height: 32px;
    border: none;
    border-radius: 50%;
    background: rgba(0, 0, 0, 0.6);
    color: white;
    font-size: 1.5rem;
    line-height: 1;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    opacity: 0.8;
    transition: opacity 0.2s, background 0.2s;
  }

  .delete-btn:hover {
    opacity: 1;
    background: rgba(244, 67, 54, 0.9);
  }

  @media (max-width: 640px) {
    .maps-grid {
      grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
      gap: 0.75rem;
    }

    h1 {
      font-size: 2rem;
    }
  }
</style>
