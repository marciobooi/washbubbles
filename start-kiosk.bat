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

rem The boot-time task "WashBubbles Backend" normally has it running already;
rem only start another copy if nothing answers (e.g. the task is not installed).
powershell -NoProfile -Command "try{ if((Invoke-WebRequest 'http://127.0.0.1:%PORT%/api/health' -UseBasicParsing -TimeoutSec 2).StatusCode -eq 200){ exit 0 } }catch{}; exit 1"
if errorlevel 1 start "WashBubbles backend" /min cmd /c ""%~dp0scripts\run-backend.bat""

echo Waiting for the backend on port %PORT% ...
powershell -NoProfile -Command "$u='http://127.0.0.1:%PORT%/api/health'; for($i=0;$i -lt 60;$i++){ try{ if((Invoke-WebRequest $u -UseBasicParsing -TimeoutSec 2).StatusCode -eq 200){ exit 0 } }catch{}; Start-Sleep 2 }; exit 1"
if errorlevel 1 (
  echo Backend did not become healthy - see logs\backend.log
  pause
  exit /b 1
)

start "" msedge --kiosk "http://localhost:%PORT%" --edge-kiosk-type=fullscreen --no-first-run
endlocal
