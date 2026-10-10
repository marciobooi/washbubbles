@echo off
rem WashBubbles kiosk launcher.
rem  - First run (no ".installed" marker): runs the installer, which asks for Administrator.
rem  - Every run: starts the backend (auto-restarting), waits until it is healthy,
rem    then opens the kiosk browser full screen.
setlocal
cd /d "%~dp0"

if not exist ".installed" (
  echo First run detected - running the installer...
  powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\install-windows.ps1"
  if errorlevel 1 (
    echo.
    echo Installation failed. See the newest file in the logs folder.
    pause
    exit /b 1
  )
)

if not exist "logs" mkdir "logs"

rem Read PORT from backend\.env (default 3000)
set PORT=3000
if exist "backend\.env" (
  for /f "usebackq tokens=1,* delims==" %%A in ("backend\.env") do (
    if /i "%%A"=="PORT" set PORT=%%B
  )
)

rem The boot-time task "WashBubbles Backend" runs the backend (hidden, as SYSTEM, from power-on). Only if that task does
rem not exist at all do we start our own copy here. Starting one just because the health check ran a few seconds too
rem early would leave a second backend, in a window, fighting the first for the port.
rem A normal user cannot QUERY a task that runs as SYSTEM (schtasks /query then fails and this used to start a
rem second, visible backend that fought the real one over the log file). Get-ScheduledTask can list it, and a backend
rem that already answers on the port is never started a second time.
powershell -NoProfile -Command "if(Get-ScheduledTask -TaskName 'WashBubbles Backend' -ErrorAction SilentlyContinue){exit 0}; if(Get-NetTCPConnection -LocalPort %PORT% -State Listen -ErrorAction SilentlyContinue){exit 0}; exit 1"
if errorlevel 1 start "WashBubbles backend" /min cmd /c ""%~dp0scripts\run-backend.bat""

echo Waiting for the backend on port %PORT% ...
rem Wait up to 5 minutes (the boot task starts it ~30 s after power-on and MongoDB can be slow). Whatever happens the
rem screen is opened below: this script runs hidden, so a "pause" here would just leave a blank kiosk with no hint why.
powershell -NoProfile -Command "$u='http://127.0.0.1:%PORT%/api/health'; for($i=0;$i -lt 150;$i++){ try{ if((Invoke-WebRequest $u -UseBasicParsing -TimeoutSec 2).StatusCode -eq 200){ exit 0 } }catch{}; Start-Sleep 2 }; exit 1"
if errorlevel 1 echo Backend did not become healthy in time - see logs\backend.log >> "logs\kiosk-start.log"

start "" msedge --kiosk "http://localhost:%PORT%" --edge-kiosk-type=fullscreen --no-first-run
endlocal
