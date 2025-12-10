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
- `VITE_API_URL` - Base API URL for the backend (default: `http://localhost:3000`).
- `VITE_HW_BRIDGE_URL` - WebSocket URL for the hardware bridge (default: `ws://localhost:3000/ws`).
 - Backend: `VITE_API_URL` should be `http://localhost:3000` and the backend websocket path is `ws://localhost:3000/ws`.

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

- The Electron entry is at `electron/main.cjs` and uses `electron/preload.cjs`.
- Scripts:
   - `npm run electron:start` — launches Electron and loads the Vite dev server at `http://localhost:5173` (start the dev server separately with `npm run dev`).
   - `npm run electron:load` — launches Electron and loads the built `dist/index.html` (run `npm run build` first).
   - You can also pass an explicit URL to Electron, e.g.:
      ```powershell
      electron . --url=https://example.com
      ```

Electron will open devtools when loading `http://localhost` so you can debug the app during development.

Local DB + optional Docker
--------------------------
By default development runs against a locally installed MongoDB (recommended). If you prefer containers, that option is still in this repository — however the default `npm run dev` expects a local MongoDB instance listening on port `27017`.

Local (recommended):

1. Install MongoDB (Windows installer / Homebrew / apt). Ensure MongoDB is running and listening on `localhost:27017`.
2. Create the database if not present:

```powershell
# No explicit creation needed for MongoDB — it will create the database on first write
```

Optional Docker (containers):

```powershell
docker compose -f deployment/docker-compose.yml up --build
```

Dev start (backend + frontend + Electron)
-------------------------------
You can start a combined development environment that runs both the Vite dev server and Electron pointing at the dev server.

From a PowerShell or command prompt in the project root (recommended):
```powershell
npm install
# Start services manually, then start Electron to load the page

# Start backend + frontend with a single command
If you prefer to start both backend and frontend automatically, run the following from the root directory:

```powershell
npm install
npm run dev
```

This uses `concurrently` to run the backend (`backend` package) and the Vite dev server at the same time.

Notes on `dev` scripts:

- `npm run dev` — Starts the dev environment and expects a local MongoDB instance listening on `localhost:27017`. It attempts to detect and auto-start the Mongo service (Windows PowerShell) if present (best-effort), waits for the DB TCP port to be available, installs backend dependencies, runs seed and starts the backend & frontend concurrently.
- `npm run dev:no-db` — Shortcut to start the backend & frontend without waiting for or attempting to start a MongoDB instance (useful for UI-only work or if your DB is already running).

If you want to start MongoDB locally on Windows, you can start the installed MongoDB service using PowerShell (service name varies depending on installer and version):

```powershell
# Attempt to determine the MongoDB service name and start it
Get-Service | Where-Object { $_.Name -match 'mongo|mongod' -or $_.DisplayName -match 'Mongo' }
Start-Service -Name 'MongoDB' # or the service name you find above
```

If you use MongoDB from a package manager (e.g., Chocolatey) or the official installer, make sure `mongo` is on your `PATH` and MongoDB is running on `localhost:27017`.

To start Electron as well, use one of the following options:

- Start the services and Electron concurrently:
   ```powershell
   npm run dev:full
   ```

- Or, start the services manually and then start Electron:
   ```powershell
   npm run electron:start
   ```

# Option B — run backend + frontend + electron (recommended for full stack)
npm run dev:full
```

On Windows, you can use the provided batch file to open Electron and point it to the dev server (starts only Electron):
```powershell
.\\start-electron-dev.bat [optional-url]
```

This will build the backend image, create a MongoDB instance with `washstore` DB, run the seed script (if present) and start NGINX serving the built `dist` (if present). Edit `deployment/docker-compose.yml` to mount code for dev or set environment variables.

Notes about dev warnings & backend availability
---------------------------------------------
- The Electron security console warning `Insecure Content-Security-Policy` is expected during development when Vite uses `eval` for HMR. You can safely ignore this during development; it disappears when the app is bundled for distribution.
- If the front-end shows `ERR_CONNECTION_REFUSED` or the WebSocket connection is failing, confirm the backend is running and listening on port 3000 (or your configured `VITE_API_URL`). The Electron window just loads the front-end URL — you must run backend and front services manually if you want to test integration.
