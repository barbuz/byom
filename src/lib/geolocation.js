/**
 * Shared geolocation watch, used by the map viewer's marker and the landing
 * page's "near you" classification.
 *
 * This is deliberately a thin wrapper over `navigator.geolocation.watchPosition`
 * and nothing more. It previously ran a "watchdog" that restarted the watch
 * when fixes stalled, but that could not fix the underlying browser behaviour
 * (see the Firefox note in README.md) and only added moving parts, so it was
 * removed. A browser that reports a stale or coarse position is a browser bug
 * to report upstream, not something to paper over here.
 */

const WATCH_OPTIONS = {
  enableHighAccuracy: true,
  maximumAge: 5000,
  timeout: 10000,
};

/**
 * Start watching the user's position.
 *
 * @param {Object} handlers
 * @param {(position: {latitude: number, longitude: number, accuracy: number}) => void} [handlers.onChange]
 *   Called with each fix.
 * @returns {{stop: () => void}} Handle whose `stop` clears the watch.
 */
export function createPositionWatch({ onChange } = {}) {
  if (!navigator.geolocation) {
    console.warn('Geolocation not supported');
    return { stop() {} };
  }

  const watchId = navigator.geolocation.watchPosition(
    (position) => {
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
    WATCH_OPTIONS,
  );

  return {
    stop() {
      navigator.geolocation.clearWatch(watchId);
    },
  };
}
