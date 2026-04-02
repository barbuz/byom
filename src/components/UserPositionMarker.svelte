<script>
  import { onMount, onDestroy } from 'svelte';
  import { geoToImage } from '../lib/transforms.js';

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
    if (!userPosition || !geoTransform) return;

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

      // Draw accuracy circle - currently not working?
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
      // Draw inner dot
      ctx.fillStyle = 'white';
      ctx.beginPath();
      ctx.arc(imgCoords.imageX, imgCoords.imageY, 6, 0, Math.PI * 2);
      ctx.fill();

      ctx.restore();
    } catch (error) {
      console.error('Error drawing user position:', error);
    }
  }
</script>
