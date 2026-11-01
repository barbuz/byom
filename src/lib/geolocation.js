/**
 * Shared geolocation watch, used by the map viewer's marker and the landing
 * page's "near you" classification.
 *
 * GPS is a best-effort display of an OS-owned signal. Android's fused location
 * provider can return a frozen fix, and Chromium never re-requests it, so this
 * runs a watchdog: if no fix arrives within `FIRST_FIX_TIMEOUT_MS`, or no *new*
 * position (a coordinate change, or the first fix) arrives within
 * `STALE_AFTER_MS`, it clears the watch and starts a new one (throttled by
 * `REARM_COOLDOWN_MS`), and re-arms on `visibilitychange`/`pageshow` when the
 * page was hidden for at least `MIN_HIDDEN_MS`.
 *
 * Firefox for Android is the case this exists for. GeckoView used to ignore
 * `enableHighAccuracy` and return Android's cached `getLastKnownLocation()`
 * regardless of accuracy (Mozilla bug 1765835, fixed in GeckoView 106); the
 * reporting user's own workaround was to switch to another GPS app and back,
 * which forces the OS to acquire a fresh fix that the next geolocation call then
 * returns. This watchdog automates the "and back" half by re-arming, and
 * reproduces the "another app" half by passing `maximumAge: 0` on a re-arm so
 * the browser cannot answer from the cache it is stuck on. That workaround is
 * still needed because two follow-ups remain open: `watchPosition` on Android
 * fires slower than Chrome (Mozilla bug 1790405) and accuracy is lower than
 * pre-Fenix Android (bug 1790485). Ageing the last *coordinate change* rather
 * than the last *callback* is what catches the replay, since the timestamp keeps
 * advancing even though the position is frozen.
 */

const WATCHDOG_INTERVAL_MS = 5000;
const STALE_AFTER_MS = 15000;
const FIRST_FIX_TIMEOUT_MS = 15000;
// A re-armed watch forbids a cached fix (`maximumAge: 0`), so it must acquire a
// real one. Android's fix rate is slow and variable (Mozilla bug 1790405:
// callbacks average 1-5s and can take much longer), and a cold fix can exceed
// the normal first-fix window; cancelling it and re-arming again would restart
// the wait every time and never converge, so a re-armed watch gets a longer
// window before the watchdog gives up on it.
const FIRST_FIX_TIMEOUT_FRESH_MS = 30000;
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
  let lastChangeAt = null;
  let watchStartedAt = null;
  let firstFixWindow = FIRST_FIX_TIMEOUT_MS;
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
      lastChangeAt,
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

  function startTracking({ forceFresh = false } = {}) {
    if (!navigator.geolocation) {
      console.warn('Geolocation not supported');
      return;
    }

    watchStartedAt = Date.now();
    lastFixAt = null;
    // Give the new watch a full window to report a *changed* coordinate. The
    // last seen coordinate (`lastLat`/`lastLon`) is deliberately kept, so a
    // replayed frozen fix is still recognised as a repeat rather than looking
    // like a fresh first fix.
    lastChangeAt = null;
    firstFixWindow = forceFresh ? FIRST_FIX_TIMEOUT_FRESH_MS : FIRST_FIX_TIMEOUT_MS;
    lastRearmAt = watchStartedAt;

    watchId = navigator.geolocation.watchPosition(
      (position) => {
        lastFixAt = position.timestamp ?? Date.now();
        fixCount += 1;
        const lat = position.coords.latitude;
        const lon = position.coords.longitude;
        // Only a coordinate *change* is new information. Firefox for Android
        // replays a cached fix with an advancing timestamp, so treating every
        // callback as fresh would keep a frozen position looking live; a replay
        // is counted as a repeat and leaves `lastChangeAt` (and the stale flag)
        // alone.
        if (lat !== lastLat || lon !== lastLon) {
          repeatFixStreak = 0;
          lastLat = lat;
          lastLon = lon;
          lastChangeAt = lastFixAt;
          if (onStale) onStale(false);
        } else {
          repeatFixStreak += 1;
        }
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
        // A re-arm exists to escape a fix the browser is replaying from its
        // cache, so it must not be allowed to satisfy the request from that
        // same cache. `maximumAge: 0` forces a fresh acquisition; the initial
        // watch tolerates a small cache to stay responsive.
        maximumAge: forceFresh ? 0 : 5000,
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

    // Age the last *position change*, not the last callback: a frozen replay
    // keeps advancing the callback time without ever moving the coordinate.
    const reference = lastChangeAt ?? watchStartedAt;
    const limit = lastChangeAt === null ? firstFixWindow : STALE_AFTER_MS;
    if (now - reference < limit) return;

    if (onStale) onStale(true);
    rearmWatch(rearmReason(now));
  }

  function rearmReason(now) {
    if (lastFixAt === null) return 'no-fix-timeout';
    // Fixes are still arriving but the coordinate has not moved: the browser is
    // replaying a frozen fix rather than reporting a new one.
    if (repeatFixStreak > 0 && now - lastFixAt < STALE_AFTER_MS) return 'frozen-fix';
    return 'stale-fix';
  }

  function rearmWatch(reason) {
    rearmCount += 1;
    lastRearmReason = reason;
    lastRearmAtReason = Date.now();
    stopWatch();
    startTracking({ forceFresh: true });
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
