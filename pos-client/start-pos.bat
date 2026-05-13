@echo off
REM WashBubbles POS Client — Offline-First
REM Everything runs inside Electron: local DB, hardware agent, sync engine

setlocal enabledelayedexpansion

REM ========================================
REM  CONFIGURATION - Edit these values!
REM ========================================
set SERVER_URL=http://localhost:5173
set API_BASE=http://localhost:3000/api
set KIOSK_API_KEY=b6f3c9a1d4e78b2f90c3a4d6e1f2b3c4d5e6f7890a1b2c3d
set TENANT_ID=

REM ========================================
echo.
echo  WashBubbles POS Client (Offline-First)
echo  UI Server: %SERVER_URL%
echo  API Server: %API_BASE%
echo ========================================
echo.

REM Change to script directory
cd /d "%~dp0"

REM Check if Node.js is installed
where node >nul 2>nul
if %ERRORLEVEL% neq 0 (
    echo ERROR: Node.js is not installed!
    echo Please install Node.js from https://nodejs.org/
    pause
    exit /b 1
)

echo Node.js found:
node --version
echo.

REM Install dependencies if needed
if not exist "node_modules" (
    echo Installing dependencies...
    call npm install
    if %ERRORLEVEL% neq 0 (
        echo ERROR: Failed to install dependencies!
        pause
        exit /b 1
    )
    echo Dependencies installed successfully.
    echo.
)

REM Rebuild better-sqlite3 for Electron if needed
echo Rebuilding native modules for Electron...
call npx electron-rebuild -f -w better-sqlite3 2>nul
echo.

REM Set environment variables
set ELECTRON_START_URL=%SERVER_URL%
set ELECTRON_API_BASE=%API_BASE%
set ELECTRON_KIOSK_API_KEY=%KIOSK_API_KEY%
set ELECTRON_TENANT_ID=%TENANT_ID%

echo Starting WashBubbles POS...
echo  - Local SQLite database: Embedded
echo  - Hardware agent: Embedded in Electron
echo  - Sync engine: Background auto-sync
echo.

REM Start Electron (single process — no separate agent needed!)
start "WashBubbles POS" cmd /k "cd /d %~dp0 && npx electron ."

echo.
echo ========================================
echo  POS started successfully!
echo  Everything runs inside one Electron app:
echo  - Local database (SQLite)
echo  - Hardware agent (serial ports)
echo  - Sync engine (background)
echo  - POS interface (React UI)
echo ========================================
echo.
echo Press any key to close this window...
pause >nul
