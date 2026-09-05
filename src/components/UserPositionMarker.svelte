<svelte:options accessors />

<script>
  import { onMount, onDestroy } from 'svelte';
  import { drawUserMarker } from '../lib/draw.js';

  // Props
  export let geoTransform = null;
  export let geoTransformType = null;
  export let transform = {
    scale: 1,
    translateX: 0,
    translateY: 0,
    rotation: 0,
  };
  export let imageWidth = 0;
  export let imageHeight = 0;
  export let scheduleRender = () => {};

  // GPS state
  let userPosition = null;
  let gpsWatchId = null;

  // Expose userPosition to parent
  export { userPosition };

  onMount(() => {
    startGPSTracking();
  });

  onDestroy(() => {
    if (gpsWatchId !== null) {
      navigator.geolocation.clearWatch(gpsWatchId);
    }
  });

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

  export function drawUserPosition(ctx) {
    drawUserMarker(ctx, userPosition, geoTransform, geoTransformType, transform, imageWidth, imageHeight);
  }
</script>
