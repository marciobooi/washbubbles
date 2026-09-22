@echo off
rem Double-click on the NEW kiosk PC to install everything (asks for Administrator).
rem Add options after the name, e.g.:  INSTALL-FIRST-RUN.bat -HardwareNic "Ethernet"
rem Preview without changing anything:  INSTALL-FIRST-RUN.bat -DryRun
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\install-windows.ps1" %*
echo.
pause
