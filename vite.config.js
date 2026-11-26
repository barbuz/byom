import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { resolve } from 'path';
import { existsSync, readFileSync, writeFileSync } from 'fs';

const pkg = JSON.parse(readFileSync(resolve(__dirname, 'package.json'), 'utf8'));

const BASE = '/byom/'; // Update this to match your GitHub repo name
const SW_SOURCE = resolve(__dirname, 'public/sw.js');

// A new cache name per deployment is what makes the browser install the new
// service worker and drop the previous app shell. The commit SHA is unique by
// construction, so no number is bumped by hand; local builds fall back to a
// timestamp, and each dev server run gets its own id so dev never serves a
// stale shell.
const BUILD_ID = process.env.GITHUB_SHA?.slice(0, 7) ?? Date.now().toString(36);

const renderServiceWorker = (code) =>
  code
    .replaceAll('__APP_VERSION__', pkg.version)
    .replaceAll('__BUILD_ID__', BUILD_ID);

/**
 * Vite copies public/ verbatim, so the placeholders in public/sw.js survive
 * the build untouched. Substitute them here: sw.js sits outside the bundle
 * graph, and rewriting its bytes is also what signals the update.
 */
function serviceWorkerVersioning() {
  let isBuild = false;

  return {
    name: 'byom:service-worker-versioning',

    configResolved(config) {
      isBuild = config.command === 'build';
    },

    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const [path] = (req.url ?? '').split('?');
        if (path !== `${BASE}sw.js`) return next();

        res.setHeader('Content-Type', 'text/javascript');
        res.setHeader('Cache-Control', 'no-cache');
        res.end(renderServiceWorker(readFileSync(SW_SOURCE, 'utf8')));
      });
    },

    closeBundle() {
      // vite build --watch and closing a dev server both end up here.
      if (!isBuild) return;

      const output = resolve(__dirname, 'dist/sw.js');
      if (!existsSync(output)) {
        this.warn(`sw.js not found at ${output}; version placeholders left as-is`);
        return;
      }
      writeFileSync(output, renderServiceWorker(readFileSync(output, 'utf8')));
    },
  };
}

const VERSION_QUERY = `v=${pkg.version}`;

const withVersion = (url) => `${url}${url.includes('?') ? '&' : '?'}${VERSION_QUERY}`;

/**
 * The icon, the favicon and the manifest keep fixed URLs, and browsers cache
 * them hard — an installed PWA can keep an old home-screen icon for days after
 * a deploy. Stamping the release onto those URLs makes every release a URL the
 * browser has never seen, so the icon is fetched again.
 */
function publicAssetVersioning() {
  let isBuild = false;

  return {
    name: 'byom:public-asset-versioning',
    enforce: 'post',

    configResolved(config) {
      isBuild = config.command === 'build';
    },

    transformIndexHtml(html) {
      return html.replace(
        /href="(\/byom\/|\/)?(favicon\.svg|apple-touch-icon\.png|manifest\.json)"/g,
        (_match, prefix = '', file) => `href="${withVersion(`${prefix}${file}`)}"`,
      );
    },

    closeBundle() {
      // public/ is copied verbatim after the bundle is written, so the manifest
      // is patched on disk here rather than through generateBundle.
      if (!isBuild) return;

      const output = resolve(__dirname, 'dist/manifest.json');
      if (!existsSync(output)) {
        this.warn(`manifest.json not found at ${output}; icon URLs left unversioned`);
        return;
      }
      const manifest = JSON.parse(readFileSync(output, 'utf8'));
      manifest.icons = manifest.icons.map((icon) => ({ ...icon, src: withVersion(icon.src) }));
      writeFileSync(output, `${JSON.stringify(manifest, null, 2)}\n`);
    },
  };
}

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [svelte(), serviceWorkerVersioning(), publicAssetVersioning()],
  define: {
    // Single source of truth for the release id shown in the UI.
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  base: BASE,
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
  },
  publicDir: 'public',
  server: {
    https: {
      key: resolve(__dirname, 'localhost-key.pem'),
      cert: resolve(__dirname, 'localhost-cert.pem')
    },
    host: true,  // Allow external access (useful for mobile testing)
  },
});
