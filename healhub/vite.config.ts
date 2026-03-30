import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  server: {
    // Allow phones / Expo WebView on LAN to load http://<this-machine>:5173
    host: true,
    strictPort: true,
    port: 5173,
    proxy: {
      // Owner AI bridge (npm run server:dev on port 8787). Same-origin /api in the browser.
      '/api': {
        target: 'http://127.0.0.1:8787',
        changeOrigin: true,
      },
    },
  },
  plugins: [
    react({
      babel: {
        plugins: [['babel-plugin-react-compiler']],
      },
    }),
  ],
  build: {
    chunkSizeWarningLimit: 800,
  },
})
