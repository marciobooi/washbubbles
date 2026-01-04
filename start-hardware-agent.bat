@echo off
REM Hardware Agent Startup Script
REM This runs on the POS machine and connects all local peripherals to the remote server

echo ========================================
echo  WashBubbles Hardware Agent
echo ========================================
echo.
echo Starting hardware agent...
echo This connects local peripherals to the remote backend server
echo.

cd /d "%~dp0backend"

REM Check if .env.agent exists
if not exist ".env.agent" (
    echo ERROR: .env.agent configuration file not found!
    echo Please create backend\.env.agent with:
    echo   HARDWARE_SERVER_URL=ws://your-server-ip:3000/hardware-agent
    echo   HARDWARE_AGENT_API_KEY=your-kiosk-api-key
    echo.
    pause
    exit /b 1
)

REM Load environment and start agent
node --env-file=.env.agent src/agentServer.js

pause
