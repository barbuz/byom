import { defineConfig, coverageConfigDefaults } from 'vitest/config';
import { svelte } from '@sveltejs/vite-plugin-svelte';

const browserCondition = () => ({
  name: 'byom:browser-condition',
  config() {
    return {
      resolve: {
        // Vitest web-mode externalizes deps and loads them via Node. Without
        // the "browser" condition, svelte's exports map resolves to the SSR
        // runtime (`.  ./src/runtime/ssr.js`), where onMount is a no-op and
        // stubs @testing-library/svelte's expectations of client lifecycle hooks.
        conditions: ['browser'],
      },
    };
  },
});

// https://vitest.dev/config/
export default defineConfig({
  plugins: [svelte(), browserCondition()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./tests/setup.js'],
    include: ['src/**/*.test.js'],
    coverage: {
      provider: 'v8',
      reportOnFailure: true,
      // Browser-only/build-infrastructure files are excluded from coverage:
      // see the Testing section of README.md.
      exclude: [
        ...coverageConfigDefaults.exclude,
        'src/main.js',
        'public/sw.js',
        'svelte.config.js',
      ],
      // Per-file line-coverage thresholds, recorded from the values measured
      // at the time of the Phase 5 close-out pass (see README.md). Raise the
      // thresholds as coverage improves.
      thresholds: {
        perFile: true,
        'src/lib/transforms.js': { lines: 100 },
        'src/lib/viewport.js': { lines:  99 },
        'src/lib/draw.js': { lines:  99 },
        'src/lib/db.js': { lines:  99 },
        'src/components/UserPositionMarker.svelte': { lines:  99 },
        'src/MapViewer.svelte': { lines:  99 },
        'src/MapList.svelte': { lines:  99 },
      },
    },
  },
});