import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'path';

export default defineConfig({
  // Relative asset paths (./assets/... instead of /assets/...): the kiosk
  // Electron app loads this build straight off disk via `file://` so it can
  // render with no network at all, and file:// resolves an absolute "/assets"
  // path against the filesystem root, not the HTML file's own folder. Safe for
  // the normal web/nginx deployment too — the app is a client-routed SPA, so
  // the HTML document is always served from the site root regardless of which
  // page is active (nginx's `try_files ... /index.html`).
  base: './',
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  server: {
    proxy: {
      // Proxy API calls to backend server
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
        secure: false,
      },
      // Proxy websocket endpoint
      '/ws': {
        target: 'ws://localhost:3000',
        ws: true,
      },
    },
  },
});
