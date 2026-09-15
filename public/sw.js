/* v8 ignore start -- service worker runs in the browser, not in jsdom */

// Substituted at build time by vite.config.js. Neither value is edited by hand:
// APP_VERSION comes from package.json, BUILD_ID from the deployed commit.
const APP_VERSION = '__APP_VERSION__';
const BUILD_ID = '__BUILD_ID__';

// The app shell is versioned per deployment. Changing this name is what makes
// the browser install a new worker and drop the previous shell: without it,
// index.html would be served from the cache forever (see TROUBLESHOOTING.md).
const SHELL_CACHE = `byom-shell-${APP_VERSION}-${BUILD_ID}`;

// Deliberately NOT versioned. Vite gives bundled assets content-hashed names,
// so a cached copy can never be stale, and keeping them means a tab left open
// across a deployment can still resolve the hashes it was built against.
const ASSET_CACHE = 'byom-assets';

// Anything cached under a `byom-` prefix that is no longer current is cleared
// on activate -- including the legacy un-split `byom-v1` cache.
const CURRENT_CACHES = [SHELL_CACHE, ASSET_CACHE];

const OFFLINE_URL = '/byom/index.html';
const SHELL_ASSETS = [
  '/byom/',
  OFFLINE_URL,
  '/byom/manifest.json',
];

const CACHEABLE_DESTINATIONS = ['script', 'style', 'image', 'font'];

// Install event - cache essential assets
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) => {
      return cache.addAll(SHELL_ASSETS);
    })
  );
  self.skipWaiting();
});

// Activate event - clean up old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((name) => name.startsWith('byom-') && !CURRENT_CACHES.includes(name))
          .map((name) => caches.delete(name))
      );
    })
  );
  self.clients.claim();
});

function isCacheable(response) {
  return !!response && response.status === 200 && response.type !== 'error';
}

// Cache-first: the app is offline-first, so a cached response always wins.
async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) return cached;

  const response = await fetch(request);
  if (isCacheable(response)) {
    // Caching is best-effort: a failed write must not fail the response.
    await cache.put(request, response.clone()).catch(() => {});
  }
  return response;
}

async function serveShell(request) {
  try {
    return await cacheFirst(request, SHELL_CACHE);
  } catch (error) {
    // Offline navigation to a path that was never cached: fall back to the
    // precached shell so the client-side router can handle the route.
    const offline = await caches.match(OFFLINE_URL, { cacheName: SHELL_CACHE });
    if (offline) return offline;
    throw error;
  }
}

// Fetch event - serve from cache, fallback to network
self.addEventListener('fetch', (event) => {
  const { request } = event;

  if (request.method !== 'GET') return;

  // Skip cross-origin requests
  if (!request.url.startsWith(self.location.origin)) {
    return;
  }

  if (request.mode === 'navigate') {
    event.respondWith(serveShell(request));
    return;
  }

  if (CACHEABLE_DESTINATIONS.includes(request.destination)) {
    event.respondWith(cacheFirst(request, ASSET_CACHE));
  }
});
/* v8 ignore stop */
