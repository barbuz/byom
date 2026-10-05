/**
 * Shared geolocation watch, used by the map viewer's marker and the landing
 * page's "near you" classification.
 *
 * GPS is a best-effort display of an OS-owned signal. Android's fused location
 * provider can return a frozen fix whose reported `accuracy` inflates without
 * bound, and Chromium never re-requests it, so this runs a watchdog: if no fix
 * arrives within `FIRST_FIX_TIMEOUT_MS`, or the last fix is older than
 * `STALE_AFTER_MS`, it clears the watch and starts a new one (throttled by
 * `REARM_COOLDOWN_MS`), and re-arms on `visibilitychange`/`pageshow` when the
 * page was hidden for at least `MIN_HIDDEN_MS` (mirroring the "switch to
 * Google Maps" workaround).
 */

const WATCHDOG_INTERVAL_MS = 5000;
const STALE_AFTER_MS = 15000;
const FIRST_FIX_TIMEOUT_MS = 15000;
const REARM_COOLDOWN_MS = 10000;
const MIN_HIDDEN_MS = 1000;

/**
 * Start watching the user's position.
 *
 * @param {Object} handlers
 * @param {(position: {latitude: number, longitude: number, accuracy: number}) => void} [handlers.onChange]
 *   Called with each accepted fix.
 * @param {(stale: boolean) => void} [handlers.onStale]
 *   Called with `true` when a fix goes stale and `false` on the next fresh fix.
 * @param {() => void} [handlers.onResume]
 *   Called when the page becomes visible again, before any re-arm.
 * @returns {{stop: () => void}} Handle whose `stop` clears the watch, watchdog
 *   and listeners.
 */
export function createPositionWatch({ onChange, onStale, onResume } = {}) {
  let watchId = null;
  let watchdogId = null;
  let lastFixAt = null;
  let watchStartedAt = null;
  let lastRearmAt = null;
  let hiddenAt = null;
  let stopped = false;

  function startTracking() {
    if (!navigator.geolocation) {
      console.warn('Geolocation not supported');
      return;
    }

    watchStartedAt = Date.now();
    lastFixAt = null;
    lastRearmAt = watchStartedAt;

    watchId = navigator.geolocation.watchPosition(
      (position) => {
        lastFixAt = position.timestamp ?? Date.now();
        if (onStale) onStale(false);
        if (onChange) {
          onChange({
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
            accuracy: position.coords.accuracy,
          });
        }
      },
      (error) => {
        console.error('GPS error:', error);
      },
      {
        enableHighAccuracy: true,
        maximumAge: 5000,
        timeout: 10000,
      },
    );

    startWatchdog();
  }

  function stopWatch() {
    stopWatchdog();
    if (watchId !== null) {
      navigator.geolocation.clearWatch(watchId);
      watchId = null;
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

    if (onStale) onStale(true);
    rearmWatch();
  }

  function rearmWatch() {
    stopWatch();
    startTracking();
  }

  function handleVisibilityChange() {
    if (document.visibilityState === 'hidden') {
      hiddenAt = Date.now();
    } else if (document.visibilityState === 'visible') {
      handleResume();
    }
  }

  function handleResume() {
    if (watchId === null) return;
    if (onResume) onResume();
    // A watch created before the page/app was backgrounded may have been
    // deprioritised by Android, so returning is the moment to ask for a fresh
    // fix. Ignore blips shorter than MIN_HIDDEN_MS so an incidental focus
    // change does not restart the watch.
    if (hiddenAt !== null && Date.now() - hiddenAt < MIN_HIDDEN_MS) return;
    hiddenAt = null;
    rearmWatch();
  }

  function stop() {
    if (stopped) return;
    stopped = true;
    stopWatch();
    document.removeEventListener('visibilitychange', handleVisibilityChange);
    window.removeEventListener('pageshow', handleResume);
  }

  startTracking();
  document.addEventListener('visibilitychange', handleVisibilityChange);
  window.addEventListener('pageshow', handleResume);

  return { stop };
}
