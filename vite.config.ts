import { fileURLToPath, URL } from 'node:url'

import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import vueDevTools from 'vite-plugin-vue-devtools'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    vue(),
    // Keep Vue DevTools out of production bundles.
    process.env.NODE_ENV !== 'production' && vueDevTools(),
  ].filter(Boolean),
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  build: {
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            {
              name: 'vue-vendor',
              test: /node_modules[\\/](vue|vue-router|pinia)([\\/]|$)/,
              priority: 20,
            },
            {
              name: 'mind-map',
              test: /node_modules[\\/]simple-mind-map([\\/]|$)/,
              priority: 30,
            },
            {
              name: 'markdown',
              test: /node_modules[\\/](marked|dompurify)([\\/]|$)/,
              priority: 20,
            },
            {
              name: 'vendor',
              test: /node_modules[\\/]/,
              priority: 10,
            },
          ],
        },
      },
    },
  },
  server: {
    port: 5199,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8787',
        changeOrigin: true,
      },
      '/screenshots': {
        target: 'http://127.0.0.1:8787',
        changeOrigin: true,
      },
    },
  },
})
