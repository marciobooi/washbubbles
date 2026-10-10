@echo off
rem Runs the WashBubbles backend and restarts it if it ever exits.
rem Started (minimised) by start-kiosk.bat. Output goes to logs\backend.log.
cd /d "%~dp0..\backend"
if not exist "..\logs" mkdir "..\logs"
rem Never run a second copy: if something already listens on the backend port, stop here (quietly).
set PORT=3000
if exist ".env" (
  for /f "usebackq tokens=1,* delims==" %%A in (".env") do (
    if /i "%%A"=="PORT" set PORT=%%B
  )
)
powershell -NoProfile -Command "if(Get-NetTCPConnection -LocalPort %PORT% -State Listen -ErrorAction SilentlyContinue){exit 1}else{exit 0}"
if errorlevel 1 exit /b 0
:loop
echo [%date% %time%] starting backend >> "..\logs\backend.log"
node src\index.js >> "..\logs\backend.log" 2>&1
echo [%date% %time%] backend exited with code %errorlevel% - restarting in 5s >> "..\logs\backend.log"
timeout /t 5 /nobreak >nul
goto loop
