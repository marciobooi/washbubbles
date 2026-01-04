@echo off
REM Hardware Agent - Development Script
REM Run this separately if you need hardware peripherals during development

echo ========================================
echo  WashBubbles Hardware Agent
echo ========================================
echo.

cd /d "%~dp0backend"

REM Check if .env.agent exists
if not exist ".env.agent" (
    echo WARNING: .env.agent not found!
    echo.
    echo Create backend\.env.agent with:
    echo   HARDWARE_SERVER_URL=ws://localhost:3000/hardware-agent
    echo   HARDWARE_AGENT_API_KEY=your-kiosk-api-key
    echo.
    echo Or set environment variables and press any key to continue...
    pause >nul
)

REM Start agent
echo Starting hardware agent...
if exist ".env.agent" (
    node --env-file=.env.agent src/agentServer.js
) else (
    node src/agentServer.js
)
