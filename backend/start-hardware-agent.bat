@echo off
REM WashBubbles Standalone Hardware Agent
REM Bridges local serial peripherals to the remote backend over WebSocket.
REM Configure backend/.env.agent first (see HARDWARE_AGENT_README.md).

setlocal

cd /d "%~dp0"

where node >nul 2>nul
if %ERRORLEVEL% neq 0 (
    echo ERROR: Node.js is not installed! Get it from https://nodejs.org/
    pause
    exit /b 1
)

if not exist "node_modules" (
    echo Installing dependencies...
    call npm install
    if %ERRORLEVEL% neq 0 (
        echo ERROR: Failed to install dependencies!
        pause
        exit /b 1
    )
)

if not exist ".env.agent" (
    echo ERROR: backend\.env.agent not found. Copy .env.agent and fill in HARDWARE_SERVER_URL / HARDWARE_AGENT_API_KEY first.
    pause
    exit /b 1
)

echo Starting Hardware Agent...
node --env-file=.env.agent src/agentServer.js

pause
