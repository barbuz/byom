import { defineConfig } from 'vitest/config';
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
  },
});