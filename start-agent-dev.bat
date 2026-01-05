@echo off
REM Hardware Agent - Development Script
REM Run this separately if you need hardware peripherals during development

echo ========================================
echo  WashBubbles Hardware Agent
echo ========================================
echo.

cd /d "%~dp0backend"

REM Check if config.json exists, create it if not
if not exist "config.json" (
    echo Creating config.json...
    (
        echo {
        echo   "serverUrl": "ws://localhost:3000/hardware-agent",
        echo   "apiKey": "b6f3c9a1d4e78b2f90c3a4d6e1f2b3c4d5e6f7890a1b2c3d",
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
    echo config.json created with localhost server and COM3 interface enabled
    echo.
)

REM Start agent with config.json
echo Starting hardware agent...
node src/agentServer.js config.json
