import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vitest/config'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  server: {
    // WSL2: when the repo lives on /mnt/c file events are not delivered; set
    // CHOKIDAR_USEPOLLING=true to fall back to polling. Prefer keeping the repo
    // on the Linux filesystem (see docs/DEVELOPMENT_SETUP.md).
    watch: globalThis.process?.env?.CHOKIDAR_USEPOLLING === 'true' ? { usePolling: true } : undefined,
  },
  build: {
    // deck.gl + maplibre-gl are large by nature; they are split into their own chunks.
    chunkSizeWarningLimit: 2500,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/maplibre-gl')) return 'maplibre'
          if (id.includes('node_modules/@deck.gl') || id.includes('node_modules/@luma.gl') || id.includes('node_modules/@math.gl') || id.includes('node_modules/@loaders.gl')) return 'deckgl'
        },
      },
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.js'],
    include: ['src/**/*.test.{js,jsx}'],
    css: false,
  },
})
