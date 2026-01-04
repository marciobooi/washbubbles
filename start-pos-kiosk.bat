@echo off
REM WashBubbles POS Kiosk Startup
REM Usage: start-pos-kiosk.bat [url] [kioskKey]
REM Example: start-pos-kiosk.bat http://localhost:5173
REM Example: start-pos-kiosk.bat http://192.168.1.100:3000 ksk_abc123

setlocal enabledelayedexpansion
set URL=%~1
set KIOSKKEY=%~2

REM Default to Vite dev server
if "%URL%"=="" set URL=http://localhost:5173

echo ========================================
echo  WashBubbles POS Kiosk
echo ========================================
echo.
echo Starting Electron and loading %URL%
if not "%KIOSKKEY%"=="" echo Using kiosk key: %KIOSKKEY%
echo.

REM Start Electron
if "%KIOSKKEY%"=="" (
    start "WashBubbles POS" cmd /k "npx cross-env ELECTRON_START_URL=%URL% electron ."
) else (
    start "WashBubbles POS" cmd /k "npx cross-env ELECTRON_START_URL=%URL% ELECTRON_KIOSK_API_KEY=%KIOSKKEY% electron . --kiosk-key=%KIOSKKEY%"
)

echo.
echo POS started successfully!
echo Close the Electron window to stop.
echo.
