@echo off
REM This script is for TESTING the hardware agent locally
REM The server must be running on localhost:3000

echo ========================================
echo  WashBubbles Hardware Agent (LOCAL TEST)
echo ========================================
echo.
echo WARNING: This is for local testing only!
echo For production POS machines, use start-hardware-agent.bat with .env.agent configured
echo.
echo Make sure the backend server is running on localhost:3000
echo.
pause

cd /d "%~dp0backend"

REM Use localhost for testing
set HARDWARE_SERVER_URL=ws://localhost:3000/hardware-agent
set HARDWARE_AGENT_API_KEY=test-key-change-me

node src/agentServer.js

pause
