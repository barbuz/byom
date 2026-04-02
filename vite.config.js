import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { resolve } from 'path';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [svelte()],
  base: '/byom/', // Update this to match your GitHub repo name
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
