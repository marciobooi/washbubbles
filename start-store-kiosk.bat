@echo off
REM This script starts Electron and points it to a URL. Start backend and frontend services manually first.
REM Usage: start-store-kiosk.bat [url] [kioskKey]
setlocal enabledelayedexpansion
set URL=%~1
set KIOSKKEY=%~2
if "%URL%"=="" set URL=http://localhost:5173
echo Starting Electron and loading %URL% with kiosk key %KIOSKKEY%
if "%KIOSKKEY%"=="" (
	start "Electron" cmd /k "npx cross-env ELECTRON_START_URL=%URL% electron ."
) else (
	start "Electron" cmd /k "npx cross-env ELECTRON_START_URL=%URL% ELECTRON_KIOSK_API_KEY=%KIOSKKEY% electron . --kiosk-key=%KIOSKKEY%"
)
