<script>
  import { initDB } from './lib/db.js';
  import MapList from './MapList.svelte';
  import MapViewer from './MapViewer.svelte';

  let currentView = $state('list'); // 'list' or 'viewer'
  let currentMapId = $state(null);

  $effect(() => {
    // Initialize the database
    initDB();

    // Handle hash-based routing
    handleHashChange();
    window.addEventListener('hashchange', handleHashChange);

    return () => {
      window.removeEventListener('hashchange', handleHashChange);
    };
  });

  function handleHashChange() {
    const hash = window.location.hash;

    if (hash.startsWith('#map/')) {
      const mapId = hash.substring(5);
      currentMapId = mapId;
      currentView = 'viewer';
    } else {
      currentView = 'list';
      currentMapId = null;
    }
  }
</script>

{#if currentView === 'list'}
  <MapList />
{:else if currentView === 'viewer' && currentMapId}
  <MapViewer mapId={currentMapId} />
{/if}
