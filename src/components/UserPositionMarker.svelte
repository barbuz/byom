<script>
  import { onMount } from 'svelte';
  import { drawUserMarker } from '../lib/draw.js';
  import { createPositionWatch } from '../lib/geolocation.js';

  // Props
  let {
    geoTransform = null,
    transform = { scale: 1, translateX: 0, translateY: 0, rotation: 0 },
    imageWidth = 0,
    imageHeight = 0,
    scheduleRender = () => {},
  } = $props();

  // GPS state
  let userPosition = $state(null);

  // Expose state to parent
  export { userPosition };

  onMount(() => {
    const watch = createPositionWatch({
      onChange: (position) => {
        userPosition = position;
        scheduleRender();
      },
    });

    return () => watch.stop();
  });

  export function drawUserPosition(ctx) {
    drawUserMarker(ctx, userPosition, geoTransform, transform, imageWidth, imageHeight);
  }
</script>
