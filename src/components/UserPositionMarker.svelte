<script>
  import { drawUserMarker } from '../lib/draw.js';

  // Props
  let {
    geoTransform = null,
    geoTransformType = null,
    transform = { scale: 1, translateX: 0, translateY: 0, rotation: 0 },
    imageWidth = 0,
    imageHeight = 0,
    scheduleRender = () => {},
  } = $props();

  // GPS state
  let userPosition = $state(null);
  let gpsWatchId = $state(null);

  // Expose userPosition to parent
  export { userPosition };

  $effect(() => {
    startGPSTracking();

    return () => {
      if (gpsWatchId !== null) {
        navigator.geolocation.clearWatch(gpsWatchId);
      }
    };
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
