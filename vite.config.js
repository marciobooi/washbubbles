import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'path';

// This SPA is served two genuinely different ways and they need different
// asset paths — one `base` cannot satisfy both:
//
// - Web (nginx): the app is served from the domain root, but it's a
//   client-routed SPA using history-API routing (BrowserRouter), and nginx's
//   `try_files ... /index.html` returns the SAME index.html for a deep URL
//   like /admin/machines while the browser's address bar keeps that deep
//   path. A RELATIVE asset path in that document (`./assets/x.js`) resolves
//   against the CURRENT URL, not the file's real location — on that route it
//   would resolve to /admin/assets/x.js and 404. Absolute-from-root
//   (`/assets/x.js`, Vite's default `base: '/'`) is the only thing that's
//   safe here, exactly as it always was before the kiosk build existed.
// - Kiosk (Electron): loads its bundle straight off disk via `file://`, with
//   no server at all. An absolute `/assets/x.js` there resolves against the
//   filesystem root, not the HTML file's own folder, and 404s immediately —
//   this build needs relative paths (`base: './'`).
//
// So there are two builds, not one: `npm run build` (web, base '/', → dist/)
// and `npm run build:electron` (kiosk, base './', → dist-electron/). Never
// point the kiosk's LOCAL_UI_PATH (pos-client/electron/main.cjs) at dist/ —
// see AUDIT-FINDINGS.md Round 9 for how this went wrong the first time.
export default defineConfig(({ mode }) => {
  const isElectron = mode === 'electron'
  return {
    base: isElectron ? './' : '/',
    build: {
      outDir: isElectron ? 'dist-electron' : 'dist',
    },
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, 'src'),
      },
    },
    server: {
      proxy: {
        // Proxy API calls to backend server
        // DEV_API_TARGET=https://freshbubbles.pt points the local screen at the live server (no local backend needed)
        '/api': {
          target: process.env.DEV_API_TARGET || 'http://localhost:3000',
          changeOrigin: true,
          secure: false,
        },
        // Proxy websocket endpoint
        '/ws': {
          target: (process.env.DEV_API_TARGET || 'http://localhost:3000').replace(/^http/, 'ws'),
          ws: true,
          changeOrigin: true,
        },
      },
    },
  }
});
