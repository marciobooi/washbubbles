@echo off
REM WashBubbles POS Client
REM Connects to remote server and manages local hardware

setlocal enabledelayedexpansion

REM ========================================
REM  CONFIGURATION - Edit these values!
REM ========================================
set SERVER_URL=http://localhost:5173
set KIOSK_API_KEY=b6f3c9a1d4e78b2f90c3a4d6e1f2b3c4d5e6f7890a1b2c3d

REM ========================================
echo.
echo  WashBubbles POS Client
echo  Server: %SERVER_URL%
echo ========================================
echo.

REM Change to script directory
cd /d "%~dp0"

REM Check if Node.js is installed
where node >nul 2>nul
if %ERRORLEVEL% neq 0 (
    echo ERROR: Node.js is not installed!
    echo Please install Node.js from https://nodejs.org/
    pause
    exit /b 1
)

echo Node.js found: 
node --version
echo.

REM Install dependencies if needed
if not exist "node_modules" (
    echo Installing dependencies...
    call npm install
    if %ERRORLEVEL% neq 0 (
        echo ERROR: Failed to install dependencies!
        pause
        exit /b 1
    )
    echo Dependencies installed successfully.
    echo.
)

REM Extract host:port from SERVER_URL for WebSocket
for /f "tokens=2 delims=/" %%a in ("%SERVER_URL%") do set SERVER_HOST=%%a

REM Create/update config.json with server settings
echo Creating config.json...
(
    echo {
    echo   "serverUrl": "ws://%SERVER_HOST%/hardware-agent",
    echo   "apiKey": "%KIOSK_API_KEY%",
    echo   "peripherals": {
    echo     "coin_acceptor": { "enabled": false, "port": "COM1" },
    echo     "bill_acceptor": { "enabled": false, "port": "COM2" },
    echo     "interface": { "enabled": true, "port": "COM3" },
    echo     "hopper": { "enabled": false, "port": "COM4" },
    echo     "card_dispenser": { "enabled": false, "port": "COM5" },
    echo     "printer": { "enabled": false, "port": "COM6" },
    echo     "rfid_reader": { "enabled": false, "port": "COM7" }
    echo   }
    echo }
) > config.json

echo config.json created.
echo.

echo Starting Hardware Agent...
start "Hardware Agent" cmd /k "cd /d %~dp0 && node agent.js config.json"

REM Wait for agent to initialize
echo Waiting for agent to start...
timeout /t 3 /nobreak >nul

echo.
echo Starting POS in Electron...
start "WashBubbles POS" cmd /k "cd /d %~dp0 && npx electron ."

echo.
echo ========================================
echo  POS started successfully!
echo  - Hardware Agent: Running in background
echo  - POS Interface: Running in Electron
echo ========================================
echo.
echo Press any key to close this window...
pause >nul
