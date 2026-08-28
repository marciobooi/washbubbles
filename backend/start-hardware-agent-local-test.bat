@echo off
REM WashBubbles Hardware Agent — local test variant.
REM Points at a backend running on this same machine (npm start in another window)
REM instead of whatever HARDWARE_SERVER_URL is set in .env.agent.

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
    echo ERROR: backend\.env.agent not found. Copy .env.agent and fill in HARDWARE_AGENT_API_KEY first.
    pause
    exit /b 1
)

set HARDWARE_SERVER_URL=ws://localhost:3000/hardware-agent

echo Starting Hardware Agent against local backend (%HARDWARE_SERVER_URL%)...
node --env-file=.env.agent src/agentServer.js

pause
