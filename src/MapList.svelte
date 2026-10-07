<script>
  import { untrack } from 'svelte';
  import { getAllMaps, getAllReferencePoints, addMap, deleteMap } from './lib/db.js';
  import { createPositionWatch } from './lib/geolocation.js';
  import { isPdfFile, loadPdf, renderPdfPageToBlob } from './lib/pdf.js';
  import {
    DEFAULT_DIRECTION,
    DEFAULT_SORT,
    SORT_OPTIONS,
    availableSortKeys,
    buildMapSummaries,
    classifyMaps,
    mapCenterDistanceMeters,
    positionDistanceMeters,
    sortSummaries,
  } from './lib/mapMatch.js';
  import './styles/MapList.css';

  // A fix this close to the last classified one is not worth a recompute.
  const MOVEMENT_THRESHOLD_M = 5;

  // Distance is shown as "from map centre" so it is never confused with the
  // badge on a map that actually contains the user.
  const DISTANCE_FROM_CENTRE = 'from map centre';

  let summaries = $state([]);
  let loading = $state(true);

  // Pending PDF page choice. While non-null, a modal asks which page to import;
  // `resolve` settles the promise that processFile is awaiting.
  let pdfPicker = $state(null);

  let userPosition = $state(null);
  let positionStale = $state(false);
  // The fix the current classification was built from; plain state, not $state,
  // because it only gates recomputation and never needs to render.
  let lastClassifiedPosition = null;

  // Each section holds its own sort key and direction. Defaults come from
  // mapMatch so the initial order matches classifyMaps' own default ordering.
  let sortState = $state(initialSortState());

  // Release id, injected from package.json by vite.config.js (see Versioning
  // in README.md).
  const APP_VERSION = __APP_VERSION__;

  $effect(() => {
    untrack(() => loadMaps());
  });

  $effect(() => {
    const watch = createPositionWatch({
      onChange: (position) => {
        // While the page is hidden, leave the classification alone; the next
        // visible fix is compared against the pre-hide position.
        if (document.visibilityState === 'hidden') return;
        if (
          !lastClassifiedPosition ||
          positionDistanceMeters(position, lastClassifiedPosition) >= MOVEMENT_THRESHOLD_M
        ) {
          lastClassifiedPosition = position;
          userPosition = position;
        }
      },
      onStale: (stale) => {
        positionStale = stale;
      },
    });

    return () => watch.stop();
  });

  const classified = $derived(classifyMaps(summaries, userPosition));
  const nearMaps = $derived(sortSection(classified.near, sortState.near, userPosition));
  const incompleteMaps = $derived(sortSection(classified.incomplete, sortState.incomplete, userPosition));
  const otherMaps = $derived(sortSection(classified.other, sortState.other, userPosition));

  // The sort keys that work for every map in a section: a section of
  // ungeoreferenced maps cannot sort by size or distance, so those options are
  // disabled rather than silently ordering by something else.
  const sortKeysFor = $derived({
    near: sectionSortKeys(classified.near),
    incomplete: sectionSortKeys(classified.incomplete),
    other: sectionSortKeys(classified.other),
  });

  function initialSortState() {
    return {
      near: { key: DEFAULT_SORT.near, direction: DEFAULT_DIRECTION[DEFAULT_SORT.near] },
      incomplete: { key: DEFAULT_SORT.incomplete, direction: DEFAULT_DIRECTION[DEFAULT_SORT.incomplete] },
      other: { key: DEFAULT_SORT.other, direction: DEFAULT_DIRECTION[DEFAULT_SORT.other] },
    };
  }

  // Intersection of the per-map sort keys that are meaningful for a section.
  function sectionSortKeys(list) {
    const available = list.map(availableSortKeys);
    return new Set(SORT_OPTIONS.map((o) => o.value).filter(
      (value) => available.every((keys) => keys.has(value)),
    ));
  }

  function sortSection(list, { key, direction }, position) {
    const copy = [...list];
    sortSummaries(copy, key, { hasFix: Boolean(position), userPosition: position, direction });
    return copy;
  }

  function toggleDirection(section) {
    const current = sortState[section];
    sortState[section] = {
      ...current,
      direction: current.direction === 'asc' ? 'desc' : 'asc',
    };
  }

  // Picking a new key resets the direction to that key's natural default, so
  // e.g. choosing "Name" starts A→Z rather than inheriting the previous key's
  // descending order.
  function changeSort(section, key) {
    sortState[section] = { key, direction: DEFAULT_DIRECTION[key] ?? 'asc' };
  }

  function distanceMeters(summary) {
    if (!userPosition || !summary.boundsGeo) return null;
    const meters = mapCenterDistanceMeters(
      summary.boundsGeo,
      userPosition.longitude,
      userPosition.latitude,
    );
    return Number.isFinite(meters) ? meters : null;
  }

  // Shown on every georeferenced card, with no "On this map" wording: the
  // number is always the distance to the map's centre, so a map the user is
  // standing on still reads a small distance rather than a containment claim.
  function formatDistance(summary) {
    const meters = distanceMeters(summary);
    if (meters === null) return '';
    const distance = meters < 1000
      ? `${Math.round(meters)} m`
      : `${(meters / 1000).toFixed(1)} km`;
    return `${distance} ${DISTANCE_FROM_CENTRE}`;
  }

  async function loadMaps() {
    loading = true;
    try {
      const [maps, points] = await Promise.all([getAllMaps(), getAllReferencePoints()]);
      // Sort by timestamp descending (newest first) as the base order; the
      // per-section sort controls reorder on top of it.
      maps.sort((a, b) => b.timestamp - a.timestamp);

      const pointsByMap = new Map();
      for (const point of points) {
        if (!pointsByMap.has(point.mapId)) pointsByMap.set(point.mapId, []);
        pointsByMap.get(point.mapId).push(point);
      }

      summaries = buildMapSummaries(maps, pointsByMap);
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
      await processFile(file);
    }

    await loadMaps();
    event.target.value = ''; // Reset input
  }

  // A PDF is rasterised to a PNG up front, so from here on the flow is the same
  // as an image upload.
  async function processFile(file) {
    try {
      const source = isPdfFile(file) ? await rasterisePdf(file) : { blob: file, name: file.name };
      if (!source) return; // page choice was cancelled

      const { thumbnail, width, height } = await createThumbnail(source.blob);
      await addMap({
        name: source.name,
        imageBlob: source.blob,
        thumbnail,
        imageWidth: width,
        imageHeight: height,
      });
    } catch (error) {
      console.error('Error processing file:', error);
      alert(`Failed to process ${file.name}`);
    }
  }

  async function rasterisePdf(file) {
    const doc = await loadPdf(file);
    const pageCount = doc.numPages;

    let pageNumber = 1;
    if (pageCount > 1) {
      // Only ask when there is a genuine choice; a single-page PDF is silent.
      pageNumber = await choosePdfPage(file.name, pageCount);
      if (!pageNumber) return null;
    }

    const blob = await renderPdfPageToBlob(doc, pageNumber);
    // Only a multi-page PDF needs the page in its name, so the single-page case
    // reads exactly like the file the user picked.
    const suffix = pageCount > 1 ? ` (page ${pageNumber}/${pageCount})` : '';
    return { blob, name: `${file.name}${suffix}` };
  }

  function choosePdfPage(name, pageCount) {
    return new Promise((resolve) => {
      pdfPicker = { name, pageCount, page: 1, resolve };
    });
  }

  function confirmPdfPage() {
    const { page, pageCount, resolve } = pdfPicker;
    pdfPicker = null;
    const clamped = Math.min(pageCount, Math.max(1, Math.trunc(Number(page)) || 1));
    resolve(clamped);
  }

  function cancelPdfPage() {
    const { resolve } = pdfPicker;
    pdfPicker = null;
    resolve(null);
  }

  async function createThumbnail(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement('canvas');
          const MAX_SIZE = 200;
          // The natural dimensions are what the georeference is expressed
          // against, so capture them before scaling the thumbnail.
          const naturalWidth = img.width;
          const naturalHeight = img.height;
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
          resolve({
            thumbnail: canvas.toDataURL('image/jpeg', 0.7),
            width: naturalWidth,
            height: naturalHeight,
          });
        };
        img.onerror = reject;
        img.src = e.target.result;
      };
      reader.onerror = reject;
      reader.readAsDataURL(blob);
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

  // Open the picker directly. A single input already lets the platform offer
  // camera and file sources in one native chooser, so a pre-menu (and any
  // capture hint) only duplicates the platform's own choice. PDF is included
  // because a map is often a sheet, and on Android/Chromium a non-image type in
  // `accept` is also what restores the Camera entry that `image/*` alone hides.
  function openFilePicker() {
    document.getElementById('file-upload').click();
  }
</script>

<div class="container">
  <header>
    <h1>🗺️ BYOM</h1>
    <p>Bring Your Own Map</p>
  </header>

  <div class="upload-section">
    <button class="upload-btn" onclick={openFilePicker}>
      📷 Add Map
    </button>

    <input
      id="file-upload"
      type="file"
      accept="image/*,application/pdf"
      onchange={handleFileSelect}
      style="display: none;"
    />
  </div>

  {#if pdfPicker}
    <div class="modal-backdrop">
      <div class="modal" role="dialog" aria-modal="true" aria-labelledby="pdf-page-title">
        <h2 id="pdf-page-title">Choose a page</h2>
        <p class="modal-subtitle">{pdfPicker.name} has {pdfPicker.pageCount} pages.</p>
        <label class="modal-field">
          Page
          <input
            type="number"
            min="1"
            max={pdfPicker.pageCount}
            bind:value={pdfPicker.page}
          />
          of {pdfPicker.pageCount}
        </label>
        <div class="modal-actions">
          <button class="menu-item" onclick={cancelPdfPage}>Cancel</button>
          <button class="menu-item primary" onclick={confirmPdfPage}>Import page</button>
        </div>
      </div>
    </div>
  {/if}

  {#if loading}
    <div class="loading">Loading maps...</div>
  {:else if summaries.length === 0}
    <div class="empty-state">
      <p>No maps yet</p>
      <p class="hint">Tap "Add Map" to get started</p>
    </div>
  {:else}
    <section class="map-section">
      <div class="section-header">
        <h2>📍 Maps here</h2>
        {#if nearMaps.length > 0}
          {@render sortControl('near', 'Maps here')}
        {/if}
      </div>
      {#if !userPosition}
        <p class="section-message">
          {positionStale ? 'Location unavailable.' : 'Waiting for your location...'}
        </p>
      {:else if nearMaps.length === 0}
        <p class="section-message">No maps contain your current location.</p>
      {:else}
        <div class="maps-grid">
          {#each nearMaps as map (map.id)}
            {@render mapCard(map, formatDistance(map))}
          {/each}
        </div>
      {/if}
    </section>

    {#if incompleteMaps.length > 0}
      <section class="map-section">
        <div class="section-header">
          <h2>📌 Incomplete</h2>
          {@render sortControl('incomplete', 'Incomplete maps')}
        </div>
        <div class="maps-grid">
          {#each incompleteMaps as map (map.id)}
            {@render mapCard(map, '')}
          {/each}
        </div>
      </section>
    {/if}

    {#if otherMaps.length > 0}
      <section class="map-section">
        <div class="section-header">
          <h2>🗺️ Other maps</h2>
          {@render sortControl('other', 'Other maps')}
        </div>
        <div class="maps-grid">
          {#each otherMaps as map (map.id)}
            {@render mapCard(map, formatDistance(map))}
          {/each}
        </div>
      </section>
    {/if}
  {/if}

  <footer class="app-version">v{APP_VERSION}</footer>
</div>

{#snippet sortControl(section, label)}
  <div class="sort-control">
    <label for={`sort-${section}`}>Sort by</label>
    <select
      id={`sort-${section}`}
      value={sortState[section].key}
      onchange={(e) => changeSort(section, e.currentTarget.value)}
      aria-label={`Sort ${label}`}
    >
      {#each SORT_OPTIONS as option (option.value)}
        <option value={option.value} disabled={!sortKeysFor[section].has(option.value)}>
          {option.label}
        </option>
      {/each}
    </select>
    <button
      type="button"
      class="direction-btn"
      onclick={() => toggleDirection(section)}
      aria-label={`Sort direction for ${label}`}
      title={sortState[section].direction === 'asc' ? 'Ascending' : 'Descending'}
    >
      {sortState[section].direction === 'asc' ? '↑' : '↓'}
    </button>
  </div>
{/snippet}

{#snippet mapCard(map, badge)}
  <div
    class="map-card"
    role="button"
    tabindex="0"
    aria-label={`Open map ${map.name}`}
    onclick={() => openMap(map.id)}
    onkeydown={(e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        openMap(map.id);
      }
    }}
  >
    <div class="map-thumbnail">
      <img src={map.thumbnail} alt={map.name} />
    </div>
    <div class="map-info">
      <div class="map-name">{map.name}</div>
      <div class="map-date">
        {new Date(map.timestamp).toLocaleDateString()}
      </div>
      {#if badge}
        <div class="map-badge">{badge}</div>
      {/if}
    </div>
    <button 
      class="delete-btn" 
      onclick={(e) => { e.stopPropagation(); handleDeleteMap(map.id, e); }}
      aria-label="Delete map"
    >
      ×
    </button>
  </div>
{/snippet}
