@echo off
rem Runs the WashBubbles backend and restarts it if it ever exits.
rem Started (minimised) by start-kiosk.bat. Output goes to logs\backend.log.
cd /d "%~dp0..\backend"
if not exist "..\logs" mkdir "..\logs"
:loop
echo [%date% %time%] starting backend >> "..\logs\backend.log"
node src\index.js >> "..\logs\backend.log" 2>&1
echo [%date% %time%] backend exited with code %errorlevel% - restarting in 5s >> "..\logs\backend.log"
timeout /t 5 /nobreak >nul
goto loop
