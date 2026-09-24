<script>
  import { drawUserMarker } from '../lib/draw.js';
  import {
    WATCHDOG_INTERVAL_MS,
    STALE_AFTER_MS,
    FIRST_FIX_TIMEOUT_MS,
    REARM_COOLDOWN_MS,
    MIN_HIDDEN_MS,
    GEOLOCATION_OPTIONS,
  } from '../lib/gps.js';

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
  let gpsWatchId = $state(null);
  let positionStale = $state(false);

  let watchdogId = null;
  let lastFixAt = null;
  let watchStartedAt = null;
  let lastRearmAt = null;
  let hiddenAt = null;

  // Expose state to parent
  export { userPosition, positionStale };

  $effect(() => {
    startGPSTracking();
    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('pageshow', handleResume);

    return () => {
      stopWatch();
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('pageshow', handleResume);
    };
  });

  function startGPSTracking() {
    if (!navigator.geolocation) {
      console.warn('Geolocation not supported');
      return;
    }

    watchStartedAt = Date.now();
    lastFixAt = null;
    lastRearmAt = watchStartedAt;

    gpsWatchId = navigator.geolocation.watchPosition(
      (position) => {
        userPosition = {
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracy: position.coords.accuracy,
        };
        lastFixAt = position.timestamp ?? Date.now();
        positionStale = false;
        scheduleRender();
      },
      (error) => {
        console.error('GPS error:', error);
      },
      GEOLOCATION_OPTIONS
    );

    startWatchdog();
  }

  function stopWatch() {
    stopWatchdog();
    if (gpsWatchId !== null) {
      navigator.geolocation.clearWatch(gpsWatchId);
      gpsWatchId = null;
    }
  }

  function startWatchdog() {
    if (watchdogId !== null) return;
    watchdogId = setInterval(checkForStalePosition, WATCHDOG_INTERVAL_MS);
  }

  function stopWatchdog() {
    if (watchdogId !== null) {
      clearInterval(watchdogId);
      watchdogId = null;
    }
  }

  function checkForStalePosition() {
    if (watchStartedAt === null) return;

    const now = Date.now();
    if (lastRearmAt !== null && now - lastRearmAt < REARM_COOLDOWN_MS) return;

    const reference = lastFixAt ?? watchStartedAt;
    const limit = lastFixAt === null ? FIRST_FIX_TIMEOUT_MS : STALE_AFTER_MS;
    if (now - reference < limit) return;

    positionStale = true;
    rearmWatch();
  }

  function rearmWatch() {
    stopWatch();
    startGPSTracking();
  }

  function handleVisibilityChange() {
    if (document.visibilityState === 'hidden') {
      hiddenAt = Date.now();
    } else if (document.visibilityState === 'visible') {
      handleResume();
    }
  }

  function handleResume() {
    if (gpsWatchId === null) return;
    scheduleRender();
    // A watch created before the page/app was backgrounded may have been
    // deprioritised by Android, so returning is the moment to ask for a fresh
    // fix. Ignore blips shorter than MIN_HIDDEN_MS so an incidental focus
    // change does not restart the watch.
    if (hiddenAt !== null && Date.now() - hiddenAt < MIN_HIDDEN_MS) return;
    hiddenAt = null;
    rearmWatch();
  }

  export function drawUserPosition(ctx) {
    drawUserMarker(ctx, userPosition, geoTransform, transform, imageWidth, imageHeight, positionStale);
  }
</script>
