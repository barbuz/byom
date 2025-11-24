import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [svelte()],
  base: '/byom/', // Update this to match your GitHub repo name
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
  },
});
