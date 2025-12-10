# Washstore — Vite + React + Tailwind 4

This repository is now a Vite React app using Tailwind 4, created at the repository root (not inside a subfolder).

Quick start

1. Install dependencies:
   ```powershell
   npm install
   ```
2. Dev server:
   ```powershell
   npm run dev
   ```
3. Build:
   ```powershell
   npm run build
   ```
4. Preview production build:
   ```powershell
   npm run preview
   ```

Notes

- Tailwind content paths are configured in `tailwind.config.cjs`.
- Keep the old subfolder `washbubbles-repo` (or rename to `washstore-repo`) intact if you still want to keep older sub-projects.

---

New features
------------

- React Router (v6) with routes for `/pos` and `/admin`.
- React Query (TanStack Query) used for fetching and caching machine status.
- TailwindCSS for a touch-optimized UI.
- WebSocket helper service to connect to an Electron hardware bridge and receive real-time machine status/cycle updates.

Environment variables
---------------------
- `VITE_API_URL` - REST API endpoint to fetch machine status (default: `http://localhost:3000/api/machine`).
- `VITE_HW_BRIDGE_URL` - WebSocket URL for Electron hardware bridge (default: `ws://localhost:8080`).

Routes
------
- `/pos` → Kiosk POS interface.
- `/admin` → Admin dashboard.

Realtime support
----------------
The project uses a simple `WebSocket` wrapper located at `src/services/websocket.js` and `useMachineStatus` hook in `src/hooks/useMachineStatus.js` (React Query-based) to update the UI in real time.

Electron
--------
There is a small Electron launcher that can load a URL or a local `dist/index.html` file.

- The Electron entry is at `electron/main.js` and uses `electron/preload.js`.
- Scripts:
   - `npm run electron:start` — launches Electron and loads the Vite dev server at `http://localhost:5173` (start the dev server separately with `npm run dev`).
   - `npm run electron:load` — launches Electron and loads the built `dist/index.html` (run `npm run build` first).
   - You can also pass an explicit URL to Electron, e.g.:
      ```powershell
      electron . --url=https://example.com
      ```

Electron will open devtools when loading `http://localhost` so you can debug the app during development.
