@echo off
REM This script only starts Electron and points it to a URL. Start backend and frontend services manually first.
REM Usage: start-electron-dev.bat [url]
setlocal enabledelayedexpansion
set URL=%~1
if "%URL%"=="" set URL=http://localhost:5173
echo Starting Electron and loading %URL%
start "Electron" cmd /k "npx cross-env ELECTRON_START_URL=%URL% electron ."
