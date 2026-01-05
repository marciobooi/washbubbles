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

REM Default kiosk API key (from database seed)
if "%KIOSKKEY%"=="" set KIOSKKEY=b6f3c9a1d4e78b2f90c3a4d6e1f2b3c4d5e6f7890a1b2c3d

echo ========================================
echo  WashBubbles POS Kiosk
echo ========================================
echo.
echo Starting hardware agent and Electron...
if not "%KIOSKKEY%"=="" echo Using kiosk key: %KIOSKKEY%
echo.

REM Create config.json for hardware agent if it doesn't exist
cd /d "%~dp0backend"
if not exist "config.json" (
    echo Creating config.json for hardware agent...
    (
        echo {
        echo   "serverUrl": "ws://localhost:3000/hardware-agent",
        echo   "apiKey": "%KIOSKKEY%",
        echo   "peripherals": {
        echo     "coin_acceptor": { "enabled": false },
        echo     "bill_acceptor": { "enabled": false },
        echo     "interface": { "enabled": true, "port": "COM3" },
        echo     "hopper": { "enabled": false },
        echo     "card_dispenser": { "enabled": false },
        echo     "printer": { "enabled": false },
        echo     "rfid_reader": { "enabled": false }
        echo   }
        echo }
    ) > config.json
    echo config.json created
)
cd /d "%~dp0"

REM Start Hardware Agent in background
start "Hardware Agent" cmd /k "cd /d %~dp0backend && node src/agentServer.js config.json"

REM Wait a moment for agent to initialize
timeout /t 2 /nobreak >nul

REM Start Electron POS with kiosk API key
start "WashBubbles POS" cmd /k "npx cross-env ELECTRON_START_URL=%URL% ELECTRON_KIOSK_API_KEY=%KIOSKKEY% electron ."

echo.
echo POS and Hardware Agent started successfully!
echo Close both windows to stop.
echo.
