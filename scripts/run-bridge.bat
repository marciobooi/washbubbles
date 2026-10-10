@echo off
rem Runs the WashBubbles hardware bridge: the one long-lived connection to the shop controller.
rem The backend connects to it on 127.0.0.1:16853 instead of to the controller, so restarting or updating
rem the backend never makes the controller see a disconnect (that switches the bill acceptor off).
rem Started at boot by the "WashBubbles Bridge" task; restarts itself if it ever exits.
cd /d "%~dp0..\backend"
if not exist "..\logs" mkdir "..\logs"
if exist ".env" (
  for /f "usebackq tokens=1,* delims==" %%A in (".env") do (
    if /i "%%A"=="CONTROLLER_HOST" set CONTROLLER_HOST=%%B
    if /i "%%A"=="CONTROLLER_PORT" set CONTROLLER_PORT=%%B
  )
)
:loop
echo [%date% %time%] starting bridge >> "..\logs\bridge.log"
node src\hardwareBridge.js >> "..\logs\bridge.log" 2>&1
echo [%date% %time%] bridge exited with code %errorlevel% - restarting in 3s >> "..\logs\bridge.log"
timeout /t 3 /nobreak >nul
goto loop
