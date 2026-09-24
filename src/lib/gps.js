/**
 * GPS watchdog and geolocation tuning, shared by UserPositionMarker and its
 * tests so a timing change is made in exactly one place.
 *
 * Android's fused location provider can hand out a frozen fix whose reported
 * accuracy grows without bound, and Chromium's single long-lived watch never
 * re-requests one. These values drive a watchdog that re-arms the watch.
 */

// How often the watchdog inspects the age of the last fix.
export const WATCHDOG_INTERVAL_MS = 2000;

// A fix older than this is treated as stale and triggers a re-arm. Kept above
// GEOLOCATION_OPTIONS.timeout so a slow provider reports a timeout before the
// watchdog tears the watch down, and above WATCHDOG_INTERVAL_MS so a fix
// delivered by a healthy provider is not already stale when it is inspected.
export const STALE_AFTER_MS = 5000;

// If the first fix of a watch never arrives, give up on it and re-arm.
export const FIRST_FIX_TIMEOUT_MS = 5000;

// Floor between watchdog-driven re-arms; without it a provider that never
// answers would be torn down and rebuilt on every tick.
export const REARM_COOLDOWN_MS = 2500;

// A tab or app switch long enough to matter. Shorter blips (e.g. an
// incidental focus change) are not worth resetting the watch for.
export const MIN_HIDDEN_MS = 1000;

// Passed straight to watchPosition. timeout must stay below STALE_AFTER_MS,
// and maximumAge below STALE_AFTER_MS too: a provider is allowed to return a
// cached fix up to maximumAge old, and handing the watchdog one that is
// already at the staleness boundary would re-arm on a still-valid fix.
export const GEOLOCATION_OPTIONS = {
  enableHighAccuracy: true,
  maximumAge: 1000,
  timeout: 4000,
};
