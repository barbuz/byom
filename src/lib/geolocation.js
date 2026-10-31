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
 * @param {(diagnostics: Object) => void} [handlers.onDiagnostics]
 *   Called with a fresh diagnostics snapshot after every fix, error or re-arm,
 *   for the debug window.
 * @returns {{stop: () => void, getDiagnostics: () => Object}} Handle whose
 *   `stop` clears the watch, watchdog and listeners, and whose
 *   `getDiagnostics` returns the current diagnostics snapshot.
 */
export function createPositionWatch({ onChange, onStale, onResume, onDiagnostics } = {}) {
  let watchId = null;
  let watchdogId = null;
  let lastFixAt = null;
  let watchStartedAt = null;
  let lastRearmAt = null;
  let hiddenAt = null;
  let stopped = false;

  // Cumulative diagnostics for the debug window: how many fixes arrived, how
  // often the watchdog restarted the watch and why, and the last error. These
  // are what let a user see *when* and *why* the fix stalled.
  let fixCount = 0;
  let lastLat = null;
  let lastLon = null;
  let repeatFixStreak = 0;
  let rearmCount = 0;
  let lastRearmReason = null;
  let lastRearmAtReason = null;
  let errorCount = 0;
  let lastError = null;
  let lastErrorAt = null;

  function snapshot() {
    return {
      now: Date.now(),
      active: watchId !== null,
      watchStartedAt,
      fixCount,
      lastFixAt,
      repeatFixStreak,
      rearmCount,
      lastRearmReason,
      lastRearmAt: lastRearmAtReason,
      errorCount,
      lastError,
      lastErrorAt,
    };
  }

  function notifyDiagnostics() {
    if (onDiagnostics) onDiagnostics(snapshot());
  }

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
        fixCount += 1;
        const lat = position.coords.latitude;
        const lon = position.coords.longitude;
        // Identical consecutive coordinates usually mean the OS is replaying a
        // frozen fix rather than reporting a new one, which looks "fresh" to
        // the watchdog because the timestamp keeps advancing.
        if (lat === lastLat && lon === lastLon) {
          repeatFixStreak += 1;
        } else {
          repeatFixStreak = 0;
          lastLat = lat;
          lastLon = lon;
        }
        if (onStale) onStale(false);
        if (onChange) {
          onChange({ latitude: lat, longitude: lon, accuracy: position.coords.accuracy });
        }
        notifyDiagnostics();
      },
      (error) => {
        errorCount += 1;
        lastError = error?.message || String(error);
        lastErrorAt = Date.now();
        console.error('GPS error:', error);
        notifyDiagnostics();
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
    rearmWatch(lastFixAt === null ? 'no-fix-timeout' : 'stale-fix');
  }

  function rearmWatch(reason) {
    rearmCount += 1;
    lastRearmReason = reason;
    lastRearmAtReason = Date.now();
    stopWatch();
    startTracking();
    notifyDiagnostics();
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
    rearmWatch('resume');
  }

  function stop() {
    if (stopped) return;
    stopped = true;
    stopWatch();
    document.removeEventListener('visibilitychange', handleVisibilityChange);
    window.removeEventListener('pageshow', handleResume);
    notifyDiagnostics();
  }

  startTracking();
  document.addEventListener('visibilitychange', handleVisibilityChange);
  window.addEventListener('pageshow', handleResume);
  notifyDiagnostics();

  return { stop, getDiagnostics: snapshot };
}
