@echo off
REM Start Vite dev server in a new window and then start Electron with the dev URL
start "Vite dev" cmd /k "npm run dev"
REM Wait a short time for Vite to boot (adjust if needed)
ping -n 5 127.0.0.1 > nul
REM Start Electron pointing to the dev server URL; uses cross-env to set ELECTRON_START_URL (if npx cross-env is available)
start "Electron" cmd /k "npx cross-env ELECTRON_START_URL=http://localhost:5173 electron ."
